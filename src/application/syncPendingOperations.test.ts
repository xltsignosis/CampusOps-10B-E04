/** @jest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveOfflineStart } from './saveOfflineStart';
import { OfflineIncidentRepository } from './offlineIncidentRepository';
import { syncPendingOperations } from './syncPendingOperations';
import { SessionManager } from './session/sessionManager';
import type { VersionedIncident } from '../domain/offlineStore';
import { IncidentSourceError } from '../domain/incident';
import type { Session } from '../domain/session';
import { deduplicateOperations, resolveSync } from '../course-evaluation';
import { IncidentClient } from '../infrastructure/incidentClient';
import { RemoteIncidentRepository } from '../infrastructure/remoteIncidentRepository';
import { HttpSessionGateway } from '../infrastructure/sessionGateway';
import { SqliteOfflineStore } from '../infrastructure/storage/sqliteOfflineStore';
import { nodeHttpFetch, startLocalBackend, type LocalBackend } from '../testing/localBackend';
import { openNodeSqlite } from '../testing/nodeSqlite';
import { FakeClock, MemorySessionStore } from '../testing/sessionDoubles';

const incidentId = 'campus-inc-001';
const session: Session = { actorId: 'technician-1', role: 'technician' };
const operationId = 'week08-ariel-start-001';
const photo = {
  referenceId: 'week08-photo-001', incidentId, actorId: session.actorId,
  localUri: 'file:///ficticio/week08.jpg', status: 'pending' as const,
};
const observations: Record<string, unknown> = {};
let backend: LocalBackend;
let directory: string;
let store: SqliteOfflineStore;
let base: VersionedIncident;

type WireCall = { path: string; key?: string; body?: unknown; status?: number; error?: string };
function stack(actorId: string, scenario?: string, offline = false) {
  const calls: WireCall[] = [];
  const transport = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: WireCall = { path: new URL(String(input)).pathname };
    const headers = init?.headers as Record<string, string>;
    if (headers['Idempotency-Key']) call.key = headers['Idempotency-Key'];
    if (typeof init?.body === 'string') call.body = JSON.parse(init.body);
    calls.push(call);
    try {
      // Falla controlada sólo del transporte; cliente, repositorio y cola son reales.
      if (offline && call.path.includes('/incidents')) throw new Error('offline transport');
      const response = await nodeHttpFetch(input, init);
      call.status = response.status;
      return response;
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }) as typeof fetch;
  const manager = new SessionManager({
    gateway: new HttpSessionGateway({ baseUrl: backend.baseUrl, fetchImpl: transport }),
    store: new MemorySessionStore(), clock: new FakeClock(),
  });
  const client = new IncidentClient({
    baseUrl: backend.baseUrl, auth: manager, fetchImpl: transport,
    timeoutMs: scenario === 'timeout_after_commit' ? 350 : 3000,
    ...(scenario ? { scenario } : {}),
  });
  return { actorId, calls, manager, client, repository: new RemoteIncidentRepository(client) };
}

async function loggedIn(actor = session.actorId, scenario?: string, offline = false) {
  const current = stack(actor, scenario, offline);
  await current.manager.login(actor);
  return current;
}

async function rawAction(action: Record<string, unknown>, key: string) {
  const coordinator = await loggedIn('coordinator-1');
  const credentials = await coordinator.manager.authorize('week08-fixture-action');
  const response = await nodeHttpFetch(`${backend.baseUrl}/v1/incidents/${incidentId}/actions`, {
    method: 'POST', headers: {
      Authorization: `Bearer ${credentials.accessToken}`, 'X-Course-Actor': credentials.actorId,
      'Content-Type': 'application/json', 'Idempotency-Key': key,
    }, body: JSON.stringify(action),
  });
  return { status: response.status, body: await response.json() };
}

async function remote() {
  const coordinator = await loggedIn('coordinator-1');
  const snapshot = await coordinator.client.getIncident(incidentId);
  if (!snapshot) throw new Error('fixture remoto ausente');
  const credentials = await coordinator.manager.authorize('week08-observe');
  const response = await nodeHttpFetch(`${backend.baseUrl}/v1/incidents/${incidentId}`, {
    headers: { Authorization: `Bearer ${credentials.accessToken}`, 'X-Course-Actor': credentials.actorId },
  });
  const raw = await response.json() as { payload: { history: unknown[]; notes: unknown[] } };
  return { ...snapshot, history: raw.payload.history, notes: raw.payload.notes };
}

async function pending() {
  return { incident: await store.getIncident(incidentId), operations: await store.listPendingOperations(),
    photos: await store.listPendingPhotos(incidentId) };
}

async function save() {
  await saveOfflineStart(store, session, base, operationId, 'Synthetic offline note', [photo]);
}

beforeEach(async () => {
  backend = await startLocalBackend();
  directory = mkdtempSync(join(tmpdir(), 'campusops-week08-'));
  store = await SqliteOfflineStore.open(openNodeSqlite(join(directory, 'offline.db')), session.actorId);
  const technician = await loggedIn();
  const entry = await technician.repository.getById(incidentId);
  if (!entry || !('version' in entry) || entry.version === undefined) throw new Error('fixture sin versión');
  base = { ...entry, version: entry.version };
});

afterEach(async () => {
  await store?.close();
  backend?.stop();
  if (directory) {
    if (!directory.startsWith(join(tmpdir(), 'campusops-week08-'))) throw new Error('directorio temporal inesperado');
    rmSync(directory, { recursive: true, force: true });
  }
});

afterAll(() => {
  const output = process.env.CAMPUSOPS_SYNC_OBSERVATIONS;
  if (output) writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), observations }, null, 2) + '\n');
});

test('sync-confirmed: 2xx retira sólo la operación confirmada; el replay tiene un efecto y la foto sigue pendiente', async () => {
  await save();
  const technician = await loggedIn();
  const result = await syncPendingOperations(store, technician.repository, session);
  const replay = await technician.repository.perform(incidentId, base.version, { action: 'start' }, operationId);
  const after = await pending();
  const server = await remote();
  observations.confirmed = { result, replay, after, server, calls: technician.calls };
  expect(result).toMatchObject({ confirmed: 2, pending: 0 });
  expect(after.operations).toEqual([]);
  expect(after.photos).toEqual([photo]);
  expect(server).toMatchObject({ version: 3, status: 'in_progress' });
  expect(server.history).toHaveLength(2);
  expect(server.notes).toEqual([{ actorId: session.actorId, text: 'Synthetic offline note' }]);
  expect((await store.getIncident(incidentId))?.base.version).toBe(3);
  const posts = technician.calls.filter((call) => call.path.endsWith('/actions'));
  expect(posts.map(({ key, body, status }) => ({ key, body, status }))).toEqual([
    { key: operationId, body: { action: 'start', baseVersion: 1 }, status: 201 },
    { key: `${operationId}:note`, body: { action: 'comment', text: 'Synthetic offline note', baseVersion: 2 }, status: 201 },
    { key: operationId, body: { action: 'start', baseVersion: 1 }, status: 200 },
  ]);
});

test('sync-lost-response: timeout_after_commit conserva identidad tras reabrir y el reintento no duplica el efecto', async () => {
  await save();
  const before = await pending();
  const technician = await loggedIn(session.actorId, 'timeout_after_commit');
  const first = await syncPendingOperations(store, technician.repository, session);
  const committed = await remote();
  await store.close();
  store = await SqliteOfflineStore.open(openNodeSqlite(join(directory, 'offline.db')), session.actorId);
  const reopened = await pending();
  const retry = await syncPendingOperations(store, technician.repository, session);
  const notePending = await pending();
  await store.close();
  store = await SqliteOfflineStore.open(openNodeSqlite(join(directory, 'offline.db')), session.actorId);
  const noteRetry = await syncPendingOperations(store, technician.repository, session);
  const after = await pending();
  const server = await remote();
  observations.lostResponse = { before, first, committed, reopened, retry, notePending, noteRetry, after, server, calls: technician.calls };
  expect(first).toMatchObject({ pending: 1, confirmed: 0 });
  expect(committed).toMatchObject({ version: 2, status: 'in_progress' });
  expect(reopened).toEqual(before);
  expect(retry).toMatchObject({ confirmed: 1 });
  expect(after.operations).toEqual([]);
  expect(notePending.operations.map((operation) => operation.operationId)).toEqual([`${operationId}:note`]);
  expect(noteRetry).toMatchObject({ confirmed: 1, pending: 0 });
  expect(server.history).toHaveLength(2);
  expect(server.notes).toHaveLength(1);
  expect(technician.calls.filter((call) => call.path.endsWith('/actions')).map((call) => call.key))
    .toEqual([operationId, operationId, `${operationId}:note`, `${operationId}:note`]);
});

test('sync-network: red caída conserva la cola y al reconectar usa la identidad original', async () => {
  await save();
  const before = await pending();
  const disconnected = await loggedIn(session.actorId, undefined, true);
  const first = await syncPendingOperations(store, disconnected.repository, session);
  const duringFailure = await pending();
  const technician = await loggedIn();
  const retry = await syncPendingOperations(store, technician.repository, session);
  observations.network = { before, first, duringFailure, retry, after: await pending() };
  expect(first).toMatchObject({ pending: 1, confirmed: 0 });
  expect(duringFailure).toEqual(before);
  expect(retry).toMatchObject({ confirmed: 2 });
});

test('sync-reassignment: el 403 real conserva ambas intenciones y debe informarse como conflicto de reasignación', async () => {
  await save();
  const before = await pending();
  const assigned = await rawAction({ action: 'assign', technicianId: 'technician-2', baseVersion: 1 }, 'week08-reassign-001');
  const technician = await loggedIn();
  const result = await syncPendingOperations(store, technician.repository, session);
  const after = await pending();
  const server = await remote();
  observations.reassignment = { before, assigned, result, after, server, calls: technician.calls };
  expect(assigned.status).toBe(201);
  expect(technician.calls.find((call) => call.path.endsWith('/actions'))?.status).toBe(403);
  expect(after).toEqual(before);
  expect(server).toMatchObject({ version: 2, status: 'assigned', details: { assignedTechnicianId: 'technician-2' } });
  // El enunciado exige informar el conflicto en aplicación incluso cuando autorización precede a versión.
  expect(result).toMatchObject({ confirmed: 0, conflicts: 1 });
});

test('sync-version-conflict: un 409 conserva intención local y prioridad remota sin descartar la cola', async () => {
  await save();
  const before = await pending();
  expect((await rawAction({ action: 'prioritize', priority: 'high', baseVersion: 1 }, 'week08-priority-001')).status).toBe(201);
  const technician = await loggedIn();
  const result = await syncPendingOperations(store, technician.repository, session);
  const after = await pending();
  const server = await remote();
  observations.versionConflict = { before, result, after, server, calls: technician.calls };
  expect(result).toMatchObject({ conflicts: 1, confirmed: 0 });
  expect(after).toEqual(before);
  expect(server).toMatchObject({ version: 2, details: { priority: 'high' } });
});

test('sync-independent: combina intención persistida y cambio remoto independiente sin mutar los registros', async () => {
  await save();
  await rawAction({ action: 'prioritize', priority: 'high', baseVersion: 1 }, 'week08-independent-001');
  const local = await store.getIncident(incidentId);
  const server = await remote();
  if (!local || !server?.details) throw new Error('fixture incompleto');
  const records = [
    { id: incidentId, version: 1, fields: { work: { status: local.base.status, assignedTechnicianId: local.base.assignedTechnicianId }, priority: local.base.priority } },
    { id: incidentId, version: 1, fields: { work: { status: local.local.status, assignedTechnicianId: local.local.assignedTechnicianId }, priority: local.local.priority } },
    { id: incidentId, version: server.version, fields: { work: { status: server.status, assignedTechnicianId: server.details.assignedTechnicianId }, priority: server.details.priority } },
  ] as const;
  const before = JSON.stringify(records);
  const result = resolveSync(...records);
  observations.independent = { records, result, inputsUnchanged: JSON.stringify(records) === before };
  expect(result).toEqual({ kind: 'merged', fields: { work: { status: 'in_progress', assignedTechnicianId: 'technician-1' }, priority: 'high' } });
  expect(JSON.stringify(records)).toBe(before);
});

test('sync-author: la sesión de otro autor no envía ni elimina operaciones ajenas', async () => {
  await save();
  const before = await pending();
  const other = await loggedIn('technician-2');
  const result = await syncPendingOperations(store, other.repository, { actorId: 'technician-2', role: 'technician' });
  const after = await pending();
  observations.author = { before, result, after, sentActions: other.calls.filter((call) => call.path.endsWith('/actions')) };
  expect(result).toMatchObject({ forbidden: 1, confirmed: 0 });
  expect(other.calls.filter((call) => call.path.endsWith('/actions'))).toEqual([]);
  expect(after).toEqual(before);
});

test('sync-key-reuse: otro contenido con la misma identidad es rechazado por SQLite y backend', async () => {
  await save();
  const [operation] = await store.listPendingOperations();
  if (!operation) throw new Error('fixture sin operación');
  await expect(store.savePendingChange({ base, local: { ...base, status: 'in_progress' }, photos: [photo],
    operation: { ...operation, payload: { notes: 'Contenido distinto' } } })).rejects.toThrow('offline_operation_identity_reused');
  const technician = await loggedIn();
  await syncPendingOperations(store, technician.repository, session);
  const result = await rawAction({ action: 'prioritize', priority: 'high', baseVersion: 3 }, 'week08-reused-key-001');
  const reused = await rawAction({ action: 'prioritize', priority: 'low', baseVersion: 3 }, 'week08-reused-key-001');
  const server = await remote();
  observations.keyReuse = { first: result, reused, server };
  expect(result.status).toBe(201);
  expect(reused).toEqual({ status: 409, body: { code: 'idempotency_key_reused' } });
  expect(server).toMatchObject({ version: 4, details: { priority: 'high' } });
});

test('sync-json-boundaries: JSON por contenido, ausencia distinta de null y conflictos ordenados', () => {
  const record = (fields: Record<string, unknown>) => ({ id: 'variant', version: 9, fields });
  const records = [record({ z: 0, a: 0 }), record({ z: 1, a: 1 }), record({ z: 2, a: 2 })] as const;
  const before = JSON.stringify(records);
  const ordered = resolveSync(...records);
  const objectOrder = resolveSync(record({ nested: { x: 1, y: 2 } }), record({ nested: { y: 2, x: 1 } }), record({ nested: { x: 3, y: 2 } }));
  const missingNull = resolveSync(record({ value: null }), record({}), record({ value: 'remote' }));
  const arrayOrder = resolveSync(record({ value: [1, 2] }), record({ value: [2, 1] }), record({ value: [1, 3] }));
  observations.jsonBoundaries = { ordered, objectOrder, missingNull, arrayOrder };
  expect(ordered).toEqual({ kind: 'conflict', fields: ['a', 'z'] });
  expect(objectOrder).toEqual({ kind: 'merged', fields: { nested: { x: 3, y: 2 } } });
  expect(missingNull).toEqual({ kind: 'conflict', fields: ['value'] });
  expect(arrayOrder).toEqual({ kind: 'conflict', fields: ['value'] });
  expect(JSON.stringify(records)).toBe(before);
});

test('sync-deduplication: conserva la primera operación y el orden sin mutar las entradas', () => {
  const first = Object.freeze({ operationId: 'variant-1', payload: Object.freeze({ value: 7 }) });
  const second = Object.freeze({ operationId: 'variant-2', payload: Object.freeze({ value: 9 }) });
  const input = Object.freeze([first, { ...first, payload: { value: 12 } }, second]);
  const before = JSON.stringify(input);
  const result = deduplicateOperations(input);
  observations.deduplication = { input, result, inputsUnchanged: JSON.stringify(input) === before };
  expect(result).toEqual([first, second]);
  expect(result[0]).toBe(first);
  expect(JSON.stringify(input)).toBe(before);
});

test('sync-notes: confirmar el inicio no debe perder la nota pendiente que el motor omitió del envío', async () => {
  await save();
  const before = await pending();
  const technician = await loggedIn();
  const result = await syncPendingOperations(store, technician.repository, session);
  const after = await pending();
  const server = await remote();
  const note = 'Synthetic offline note';
  const notePreserved = JSON.stringify({ after, server }).includes(note);
  observations.notes = { before, result, after, server, notePreserved, calls: technician.calls };
  expect(notePreserved).toBe(true);
});


test('workspace-offline: la app recupera el caché, persiste un inicio y sincroniza tras reabrir sin conexión', async () => {
  const technician = await loggedIn();
  const online = new OfflineIncidentRepository(store, technician.repository, session, () => true);
  expect(await online.getAll()).toHaveLength(1);
  const offline = await loggedIn(session.actorId, undefined, true);
  const repository = new OfflineIncidentRepository(store, offline.repository, session, () => true);
  const updated = await repository.perform(incidentId, 1, { action: 'start', notes: 'Nota de integración' }, 'workspace-offline-001');
  expect(updated).toMatchObject({ status: 'in_progress', version: 1 });
  const before = await pending();
  await store.close();
  store = await SqliteOfflineStore.open(openNodeSqlite(join(directory, 'offline.db')), session.actorId);
  const reopened = new OfflineIncidentRepository(store, offline.repository, session, () => true);
  expect(await reopened.getAll()).toEqual([updated]);
  expect(await pending()).toEqual(before);
  const connected = new OfflineIncidentRepository(store, technician.repository, session, () => true);
  const [first, shared] = await Promise.all([connected.sync(), connected.sync()]);
  expect(first).toBe(shared);
  expect(first).toMatchObject({ confirmed: 2, pending: 0 });
  expect((await pending()).operations).toEqual([]);
  expect((await store.getIncident(incidentId))?.base).toMatchObject({ version: 3, status: 'in_progress' });
  expect((await remote()).notes).toEqual([{ actorId: session.actorId, text: 'Nota de integración' }]);
});

test('workspace-merge: el repositorio usado por la app combina campos independientes conservando la cola y base', async () => {
  await save();
  await rawAction({ action: 'prioritize', priority: 'high', baseVersion: 1 }, 'workspace-priority-001');
  const technician = await loggedIn();
  const repository = new OfflineIncidentRepository(store, technician.repository, session, () => true);
  const display = await repository.getById(incidentId);
  expect(display).toMatchObject({ priority: 'high', status: 'in_progress', assignedTechnicianId: session.actorId });
  expect((await store.getIncident(incidentId))?.base.version).toBe(1);
  const result = await repository.sync();
  expect(result.results[0]?.merge).toMatchObject({ kind: 'merged' });
  expect(await store.listPendingOperations()).toHaveLength(1);
});

test('workspace-logout: cambiar de sesión impide consultar caché y enviar la cola del autor anterior', async () => {
  await save();
  let active = true;
  const technician = await loggedIn();
  const repository = new OfflineIncidentRepository(store, technician.repository, session, () => active);
  active = false;
  expect(() => repository.sync()).toThrow(IncidentSourceError);
  await expect(repository.getAll()).rejects.toMatchObject({ status: 401 });
  expect(await store.listPendingOperations()).toHaveLength(1);
  expect(technician.calls.filter((call) => call.path.endsWith('/actions'))).toEqual([]);
});

test('sync-receipt-identity: un 2xx con otra identidad no retira la cola; el reintento confirma sin duplicar', async () => {
  await save();
  const before = await pending();
  const technician = await loggedIn();
  const corruptReceipt = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await nodeHttpFetch(input, init);
    if (init?.method !== 'POST') return response;
    const body = await response.json() as Record<string, unknown>;
    return { ...response, json: async () => ({ ...body, operationId: 'incorrect-receipt-id' }) } as Response;
  }) as typeof fetch;
  const client = new IncidentClient({ baseUrl: backend.baseUrl, auth: technician.manager, fetchImpl: corruptReceipt });
  const first = await syncPendingOperations(store, new RemoteIncidentRepository(client), session);
  expect(first).toMatchObject({ pending: 1, confirmed: 0 });
  expect(await pending()).toEqual(before);
  expect((await remote()).version).toBe(2);
  const retry = await syncPendingOperations(store, technician.repository, session);
  expect(retry).toMatchObject({ confirmed: 2 });
  expect((await remote()).history).toHaveLength(2);
});

test('workspace-session-race: un cambio de sesión tras confirmar inicio impide enviar la nota sucesora', async () => {
  await save();
  const technician = await loggedIn();
  let active = true;
  const actions = { perform: async (...args: Parameters<typeof technician.repository.perform>) => {
    const result = await technician.repository.perform(...args);
    active = false;
    return result;
  } };
  const result = await syncPendingOperations(store, actions, session, { isCurrentSession: () => active });
  expect(result).toMatchObject({ confirmed: 1, forbidden: 1 });
  expect((await store.listPendingOperations()).map((operation) => operation.operationId)).toEqual([`${operationId}:note`]);
  expect((await remote()).notes).toEqual([]);
});
