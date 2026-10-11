/**
 * @jest-environment node
 *
 * Semana 5 — el cliente real contra el backend didáctico local (course-backend/server.mjs).
 * Se levanta en 127.0.0.1 con un puerto libre; no se usa Internet público ni proveedores reales.
 */
import { nodeHttpFetch, startLocalBackend, type LocalBackend } from '../testing/localBackend';

import { IncidentClient, IncidentClientError } from './incidentClient';

let backend: LocalBackend;
let baseUrl = '';

beforeAll(async () => {
  backend = await startLocalBackend();
  baseUrl = backend.baseUrl;
});

afterAll(() => {
  backend.stop();
});

function client(scenario?: string, timeoutMs = 3_000): IncidentClient {
  return new IncidentClient({ baseUrl, timeoutMs, fetchImpl: nodeHttpFetch, ...(scenario ? { scenario } : {}) });
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    expect(error).toBeInstanceOf(IncidentClientError);
    return (error as IncidentClientError).kind;
  }
}

test('be-success: lista y detalle de campus-inc-001 como objetos de aplicación', async () => {
  const list = await client('success').getIncidents();
  const detail = await client('success').getIncident('campus-inc-001');

  expect(list.map((item) => item.id)).toContain('campus-inc-001');
  expect(detail).toMatchObject({
    id: 'campus-inc-001',
    status: 'assigned',
    details: { category: 'connectivity', priority: 'medium', assignedTechnicianId: 'technician-1' },
  });
});

test('be-nullable: payload null del backend → details null, sin error', async () => {
  const list = await client('nullable').getIncidents();
  expect(list.length).toBeGreaterThan(0);
  expect(list.every((item) => item.details === null)).toBe(true);
  await expect(client('nullable').getIncident('campus-inc-001')).resolves.toMatchObject({ details: null });
});

test('be-malformed: JSON roto del backend → contract', async () => {
  expect(await kindOf(client('malformed').getIncidents())).toBe('contract');
});

test('be-slow: 1200 ms del backend con timeout de 300 ms → timeout', async () => {
  expect(await kindOf(client('slow', 300).getIncidents())).toBe('timeout');
});

test('be-slow-boundary: 1200 ms del backend con timeout de 3000 ms → éxito', async () => {
  await expect(client('slow', 3_000).getIncidents()).resolves.not.toHaveLength(0);
});

test('be-server-error: 500 → server', async () => {
  await expect(client('server_error').getIncidents()).rejects.toMatchObject({ kind: 'server', status: 500 });
});

test('be-rate-limited: 429 → http 429', async () => {
  await expect(client('rate_limited').getIncidents()).rejects.toMatchObject({ kind: 'http', status: 429 });
});

test('be-not-found: detalle inexistente → null', async () => {
  await expect(client().getIncident('campus-inc-999')).resolves.toBeNull();
});

test('be-create-idempotent: crear y repetir con la misma clave no duplica', async () => {
  const draft = { category: 'water', description: 'Fuga ficticia de prueba', location: 'Edificio B' } as const;
  const first = await client().createIncident(draft, 'create-be-0001');
  const replay = await client().createIncident(draft, 'create-be-0001');
  const list = await client().getIncidents();

  expect(first).toMatchObject({ status: 'open', details: { category: 'water', reporterId: 'reporter-1' } });
  expect(replay.id).toBe(first.id);
  expect(list.filter((item) => item.id === first.id)).toHaveLength(1);
});
