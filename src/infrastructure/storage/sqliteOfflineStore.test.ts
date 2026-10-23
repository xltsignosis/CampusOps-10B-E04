/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { saveOfflineStart } from '../../application/saveOfflineStart';
import type { OperationConfirmation, PendingLocalChange, VersionedIncident } from '../../domain/offlineStore';
import { openNodeSqlite } from '../../testing/nodeSqlite';
import { migrateOfflineDatabase, SCHEMA_V1 } from './migrations';
import type { SqliteConnection } from './sqliteConnection';
import { SqliteOfflineStore } from './sqliteOfflineStore';

const base: VersionedIncident = {
  id: 'campus-inc-001', version: 1, title: 'Fuga ficticia', description: 'Caso sintético de persistencia',
  category: 'water', status: 'assigned', priority: 'medium',
  assignedTechnicianId: 'technician-1', location: { source: 'manual', label: 'Aula ficticia' }, reportedAt: null,
};
const change: PendingLocalChange = {
  base,
  local: { ...base, status: 'in_progress' },
  operation: {
    operationId: 'offline-start-001', incidentId: base.id, baseVersion: 1, actorId: 'technician-1',
    action: 'start', payload: { notes: 'Inspección pendiente sin conexión', photoReferenceIds: ['photo-pending-001'] },
  },
  photos: [{
    referenceId: 'photo-pending-001', incidentId: base.id, actorId: 'technician-1',
    localUri: 'file:///ficticio/photo-001.jpg', status: 'pending',
  }],
};
const confirmation: OperationConfirmation = {
  operationId: change.operation.operationId, incidentId: base.id, actorId: 'technician-1',
  serverVersion: 2, confirmed: true,
};

const observations: Record<string, unknown> = {};
let directory: string;
let path: string;
const connections: SqliteConnection[] = [];

function connect(): SqliteConnection {
  const db = openNodeSqlite(path);
  connections.push(db);
  return db;
}

async function open(actor = 'technician-1'): Promise<SqliteOfflineStore> {
  return SqliteOfflineStore.open(connect(), actor);
}

async function snapshot(db: SqliteConnection) {
  return {
    version: (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    columns: (await db.getAllAsync<{ name: string }>('PRAGMA table_info(pending_operations)')).map((row) => row.name),
    tables: (await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )).map((row) => row.name),
    incidents: await db.getAllAsync('SELECT * FROM local_incidents ORDER BY incident_id'),
    operations: await db.getAllAsync('SELECT * FROM pending_operations ORDER BY sequence'),
  };
}

async function seedV1(db: SqliteConnection) {
  await db.execAsync(`${SCHEMA_V1} PRAGMA user_version = 1;`);
  await db.runAsync('INSERT INTO local_incidents VALUES (?, ?, ?, ?)',
    ['technician-1', base.id, JSON.stringify(base), JSON.stringify(change.local)]);
  await db.runAsync(`INSERT INTO pending_operations
    (operation_id, actor_id, incident_id, base_version, action, payload_json) VALUES (?, ?, ?, ?, ?, ?)`,
  [change.operation.operationId, 'technician-1', base.id, 1, 'start', JSON.stringify(change.operation.payload)]);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'campusops-storage-'));
  path = join(directory, 'offline.db');
});

afterEach(async () => {
  for (const db of connections.splice(0)) {
    // Algunas pruebas cierran expresamente para representar un reinicio.
    await db.closeAsync().catch(() => undefined);
  }
  rmSync(directory, { recursive: true, force: true });
});

afterAll(() => {
  const output = process.env.CAMPUSOPS_STORAGE_OBSERVATIONS;
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify({
      generatedAt: new Date().toISOString(),
      scope: 'Pruebas del almacén y caso de uso en árbol de trabajo; no representa la entrega completa ni una ejecución nativa.',
      observations,
    }, null, 2) + '\n');
  }
});

test('storage-restart: recupera identidad, notas, base, intención local y referencia tras cerrar y reabrir', async () => {
  const store = await open();
  await saveOfflineStart(store, { actorId: 'technician-1', role: 'technician' }, base,
    change.operation.operationId, String(change.operation.payload.notes), change.photos);
  const before = {
    incident: await store.getIncident(base.id), operations: await store.listPendingOperations(),
    photos: await store.listPendingPhotos(base.id),
  };
  await store.close();
  // Un proceso independiente confirma que los datos existen en el archivo, sin memoria compartida.
  const count = execFileSync(process.execPath, ['--no-warnings', '-e',
    "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);process.stdout.write(JSON.stringify(db.prepare('SELECT operation_id, payload_json FROM pending_operations').all()));db.close();",
    path], { encoding: 'utf8' });
  expect(JSON.parse(count)).toEqual([{
    operation_id: change.operation.operationId, payload_json: JSON.stringify(change.operation.payload),
  }]);
  const reopened = await open();
  const after = {
    incident: await reopened.getIncident(base.id), operations: await reopened.listPendingOperations(),
    photos: await reopened.listPendingPhotos(base.id),
  };
  expect(after).toEqual(before);
  expect(after.operations).toEqual([change.operation]);
  expect(after.incident).toEqual({ base, local: change.local });
  expect(after.photos).toEqual(change.photos);
  observations.restart = { before, independentProcess: JSON.parse(count), after };
});

test('storage-confirmation: rechaza confirmaciones inválidas y no elimina la foto al confirmar la acción', async () => {
  const store = await open();
  await store.savePendingChange(change);
  for (const receipt of [
    { ...confirmation, confirmed: false }, { ...confirmation, incidentId: 'otra-incidencia' },
    { ...confirmation, actorId: 'technician-2' }, { ...confirmation, serverVersion: 1 },
  ]) {
    await expect(store.removeConfirmedOperation(receipt as OperationConfirmation)).rejects.toThrow('offline_invalid_confirmation');
    expect(await store.listPendingOperations()).toEqual([change.operation]);
  }
  // No hay una API de borrado genérico: errores HTTP/conflictos no producen un recibo.
  await store.close();
  const reopened = await open();
  expect(await reopened.listPendingOperations()).toEqual([change.operation]);
  expect(await reopened.removeConfirmedOperation(confirmation)).toBe(true);
  expect(await reopened.removeConfirmedOperation(confirmation)).toBe(false);
  await reopened.close();
  const final = await open();
  expect(await final.listPendingOperations()).toEqual([]);
  expect(await final.listPendingPhotos(base.id)).toEqual(change.photos);
  observations.confirmation = {
    invalidReceiptsRejected: 4, pendingAfterReopen: [change.operation],
    afterConfirmation: await final.listPendingOperations(), photos: await final.listPendingPhotos(base.id),
  };
});

test('storage-migration: conserva los datos v1, revierte una falla después del DDL y recupera a v2', async () => {
  let db = connect();
  await seedV1(db);
  const before = await snapshot(db);
  await expect(migrateOfflineDatabase(db, {
    beforeVersionUpdate: () => { throw new Error('injected_migration_failure'); },
  })).rejects.toThrow('injected_migration_failure');
  const afterFailure = await snapshot(db);
  expect(afterFailure).toEqual(before);
  await db.closeAsync();
  db = connect();
  expect(await snapshot(db)).toEqual(before);
  await migrateOfflineDatabase(db);
  const afterRecovery = await snapshot(db);
  expect(afterRecovery.version).toBe(2);
  expect(afterRecovery.incidents).toEqual(before.incidents);
  expect(afterRecovery.operations).toEqual(before.operations.map((row) => ({ ...row as object, created_at: null })));
  expect(afterRecovery.tables).toContain('pending_photo_references');
  await migrateOfflineDatabase(db);
  expect(await snapshot(db)).toEqual(afterRecovery);
  const store = await SqliteOfflineStore.open(db, 'technician-1');
  expect(await store.listPendingOperations()).toEqual([change.operation]);
  expect(await store.getIncident(base.id)).toEqual({ base, local: change.local });
  observations.migration = { before, afterFailure, afterRecovery };
});

test('storage-atomic-write: revierte incidencia y cola si una foto colisiona durante la escritura', async () => {
  const store = await open();
  await store.savePendingChange(change);
  await expect(store.savePendingChange({
    ...change,
    local: { ...change.local, description: 'No debe persistirse' },
    operation: { ...change.operation, operationId: 'offline-start-002' },
    photos: [{ ...change.photos[0]!, localUri: 'file:///ficticio/otra.jpg' }],
  })).rejects.toThrow('offline_photo_identity_reused');
  expect(await store.getIncident(base.id)).toEqual({ base, local: change.local });
  expect(await store.listPendingOperations()).toEqual([change.operation]);
  expect(await store.listPendingPhotos(base.id)).toEqual(change.photos);
});

test('storage-identity: conserva primera escritura, orden y rechaza reutilizar identidad con otro contenido', async () => {
  const store = await open();
  await Promise.all([store.savePendingChange(change), store.savePendingChange(change)]);
  const reordered = { ...change, operation: { ...change.operation,
    payload: { photoReferenceIds: ['photo-pending-001'], notes: 'Inspección pendiente sin conexión' } } };
  await store.savePendingChange(reordered);
  await expect(store.savePendingChange({ ...change,
    operation: { ...change.operation, payload: { notes: 'Contenido distinto' } },
  })).rejects.toThrow('offline_operation_identity_reused');
  await store.savePendingChange({ ...change, operation: { ...change.operation, operationId: 'offline-start-002' } });
  expect((await store.listPendingOperations()).map((op) => op.operationId)).toEqual(['offline-start-001', 'offline-start-002']);
});

test('storage-base: no reemplaza la base original mientras exista una operación pendiente', async () => {
  const store = await open();
  await store.savePendingChange(change);
  await expect(store.savePendingChange({
    ...change, base: { ...base, version: 2 }, local: { ...change.local, version: 2 },
    operation: { ...change.operation, operationId: 'offline-start-002', baseVersion: 2 },
  })).rejects.toThrow('offline_pending_base_changed');
  expect(await store.getIncident(base.id)).toEqual({ base, local: change.local });
  expect(await store.listPendingOperations()).toEqual([change.operation]);
});

test('storage-actor: no lee ni confirma datos de otro actor y valida la autoría de la escritura', async () => {
  const store = await open();
  await store.savePendingChange(change);
  const other = await open('technician-2');
  expect(await other.listPendingOperations()).toEqual([]);
  expect(await other.getIncident(base.id)).toBeNull();
  expect(await other.listPendingPhotos(base.id)).toEqual([]);
  await expect(other.savePendingChange(change)).rejects.toThrow('offline_invalid_change');
  await expect(other.removeConfirmedOperation(confirmation)).rejects.toThrow('offline_invalid_confirmation');
  expect(await store.listPendingOperations()).toEqual([change.operation]);
});

test('storage-permissions: el inicio offline requiere el técnico asignado; la cola no crea una sesión', async () => {
  const store = await open();
  for (const session of [
    { actorId: 'technician-2', role: 'technician' as const },
    { actorId: 'reporter-1', role: 'reporter' as const },
    { actorId: 'coordinator-1', role: 'coordinator' as const },
  ]) {
    await expect(saveOfflineStart(store, session, base, 'forbidden-op', 'nota')).rejects.toThrow('offline_start_forbidden');
  }
  expect(await store.listPendingOperations()).toEqual([]);
});

test('storage-schema: rechaza una versión futura sin cambiarla ni eliminar información', async () => {
  const db = connect();
  await seedV1(db);
  await db.execAsync('PRAGMA user_version = 99');
  const before = await snapshot(db);
  await expect(migrateOfflineDatabase(db)).rejects.toThrow('offline_schema_too_new');
  expect(await snapshot(db)).toEqual(before);
});

test('storage-fresh-failure: una instalación fallida queda en v0 y permite reabrir limpiamente', async () => {
  const db = connect();
  await expect(migrateOfflineDatabase(db, {
    beforeVersionUpdate: () => { throw new Error('injected_migration_failure'); },
  })).rejects.toThrow('injected_migration_failure');
  expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(0);
  expect(await db.getAllAsync("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([]);
  await migrateOfflineDatabase(db);
  expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(2);
});
