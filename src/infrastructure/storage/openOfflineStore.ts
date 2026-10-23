import { openDatabaseAsync } from 'expo-sqlite';
import { SqliteOfflineStore } from './sqliteOfflineStore';
import { TransactionalSqliteConnection } from './sqliteConnection';

/** Abrir después de restaurar una sesión válida; cerrar al cambiar de actor. Android/iOS. */
export async function openOfflineStore(actorId: string): Promise<SqliteOfflineStore> {
  const db = await openDatabaseAsync('campusops-offline.db', { useNewConnection: true });
  const connection = new TransactionalSqliteConnection({
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params) => db.runAsync(sql, params),
    getFirstAsync: <T>(sql: string, params: (string | number | null)[] = []) => db.getFirstAsync<T>(sql, params),
    getAllAsync: <T>(sql: string, params: (string | number | null)[] = []) => db.getAllAsync<T>(sql, params),
    closeAsync: () => db.closeAsync(),
  });
  return SqliteOfflineStore.open(connection, actorId);
}
