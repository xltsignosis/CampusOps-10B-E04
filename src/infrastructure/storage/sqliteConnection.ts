/** Subconjunto de expo-sqlite; permite probar el mismo SQL con un motor SQLite real. */
export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: (string | number | null)[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params?: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: (string | number | null)[]): Promise<T[]>;
}

export interface SqliteConnection extends SqlExecutor {
  withExclusiveTransactionAsync(task: (transaction: SqlExecutor) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

/**
 * Una conexión privada y una cola de acceso: ninguna lectura/escritura se cuela
 * entre BEGIN y COMMIT. BEGIN IMMEDIATE reserva la escritura antes de migrar.
 * A diferencia de la transacción exclusiva de Expo, no abre una conexión nueva
 * que pierda PRAGMA foreign_keys = ON.
 */
export class TransactionalSqliteConnection implements SqliteConnection {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly connection: SqlExecutor & { closeAsync(): Promise<void> }) {}

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  execAsync(sql: string): Promise<void> {
    return this.serialize(() => this.connection.execAsync(sql));
  }

  runAsync(sql: string, params: (string | number | null)[]): Promise<{ changes: number }> {
    return this.serialize(() => this.connection.runAsync(sql, params));
  }

  getFirstAsync<T>(sql: string, params?: (string | number | null)[]): Promise<T | null> {
    return this.serialize(() => this.connection.getFirstAsync<T>(sql, params));
  }

  getAllAsync<T>(sql: string, params?: (string | number | null)[]): Promise<T[]> {
    return this.serialize(() => this.connection.getAllAsync<T>(sql, params));
  }

  withExclusiveTransactionAsync(task: (transaction: SqlExecutor) => Promise<void>): Promise<void> {
    return this.serialize(async () => {
      await this.connection.execAsync('BEGIN IMMEDIATE');
      try {
        await task(this.connection);
        await this.connection.execAsync('COMMIT');
      } catch (error) {
        await this.connection.execAsync('ROLLBACK');
        throw error;
      }
    });
  }

  closeAsync(): Promise<void> {
    return this.serialize(() => this.connection.closeAsync());
  }
}
