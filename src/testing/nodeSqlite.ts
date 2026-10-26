import { createRequire } from 'node:module';
import type { DatabaseSync as Database } from 'node:sqlite';
import { TransactionalSqliteConnection } from '../infrastructure/storage/sqliteConnection';

// El cargador nativo evita que el resolvedor de Jest intente resolver node:sqlite como archivo.
const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite');

/** SQLite real en disco; sólo sustituye el enlace nativo de Expo, no SQL ni transacciones. */
export function openNodeSqlite(path: string): TransactionalSqliteConnection {
  const native: Database = new DatabaseSync(path);
  return new TransactionalSqliteConnection({
    execAsync: async (sql) => { native.exec(sql); },
    runAsync: async (sql, params) => ({ changes: Number(native.prepare(sql).run(...params).changes) }),
    getFirstAsync: async <T>(sql: string, params: (string | number | null)[] = []) =>
      (native.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, params: (string | number | null)[] = []) =>
      native.prepare(sql).all(...params) as T[],
    closeAsync: async () => { native.close(); },
  });
}
