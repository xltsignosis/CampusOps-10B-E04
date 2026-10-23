import type { SqliteConnection } from './sqliteConnection';

export const OFFLINE_SCHEMA_VERSION = 2;

/** Esquema anterior documentado y usado por la prueba de actualización v1 -> v2. */
export const SCHEMA_V1 = `
  CREATE TABLE local_incidents (
    actor_id TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    base_json TEXT NOT NULL,
    local_json TEXT NOT NULL,
    PRIMARY KEY (actor_id, incident_id)
  );
  CREATE TABLE pending_operations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    actor_id TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    base_version INTEGER NOT NULL CHECK (base_version >= 1),
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY (actor_id, incident_id)
      REFERENCES local_incidents(actor_id, incident_id) ON DELETE RESTRICT
  );
`;

/** Hook de prueba: no se activa por ambiente ni se ejecuta desde el arranque normal. */
export type MigrationOptions = Readonly<{
  beforeVersionUpdate?: () => void;
}>;

export async function migrateOfflineDatabase(
  db: SqliteConnection,
  options: MigrationOptions = {},
): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const version = (await transaction.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    if (version > OFFLINE_SCHEMA_VERSION) throw new Error('offline_schema_too_new');
    if (version === OFFLINE_SCHEMA_VERSION) return;
    if (version === 0) await transaction.execAsync(SCHEMA_V1);
    await transaction.execAsync(`
      ALTER TABLE pending_operations ADD COLUMN created_at TEXT;
      CREATE TABLE pending_photo_references (
        reference_id TEXT PRIMARY KEY NOT NULL,
        actor_id TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        local_uri TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
        FOREIGN KEY (actor_id, incident_id)
          REFERENCES local_incidents(actor_id, incident_id) ON DELETE RESTRICT
      );
      CREATE INDEX pending_operations_by_actor ON pending_operations(actor_id, sequence);
    `);
    options.beforeVersionUpdate?.();
    // DDL, datos y versión se confirman juntos, o SQLite revierte todos los cambios.
    await transaction.execAsync(`PRAGMA user_version = ${OFFLINE_SCHEMA_VERSION}`);
  });
}
