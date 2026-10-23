import type { PendingIncidentOperation } from '../../campusops/contracts';
import type {
  LocalIncident,
  OfflineStore,
  OperationConfirmation,
  PendingLocalChange,
  PendingPhotoReference,
} from '../../domain/offlineStore';
import { migrateOfflineDatabase, type MigrationOptions } from './migrations';
import type { SqliteConnection } from './sqliteConnection';

type IncidentRow = { base_json: string; local_json: string };
type OperationRow = {
  operation_id: string;
  actor_id: string;
  incident_id: string;
  base_version: number;
  action: string;
  payload_json: string;
};

const toOperation = (row: OperationRow): PendingIncidentOperation => ({
  operationId: row.operation_id,
  actorId: row.actor_id,
  incidentId: row.incident_id,
  baseVersion: row.base_version,
  action: row.action,
  payload: JSON.parse(row.payload_json),
});

/** Comparación de contenido para impedir reutilizar una identidad con otros datos. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
    }
    return item;
  });
}

export class SqliteOfflineStore implements OfflineStore {
  private constructor(private readonly db: SqliteConnection, private readonly actorId: string) {}

  static async open(db: SqliteConnection, actorId: string, options?: MigrationOptions): Promise<SqliteOfflineStore> {
    try {
      if (!actorId.trim()) throw new Error('offline_actor_required');
      await migrateOfflineDatabase(db, options);
      return new SqliteOfflineStore(db, actorId);
    } catch (error) {
      await db.closeAsync();
      throw error;
    }
  }

  async savePendingChange(change: PendingLocalChange): Promise<void> {
    // Serializar antes del primer await: el llamador no puede modificar lo que se guardará.
    const { base, local, operation, photos } = JSON.parse(JSON.stringify(change)) as PendingLocalChange;
    if (
      operation.actorId !== this.actorId || !operation.operationId.trim() || !operation.action.trim() ||
      !operation.incidentId.trim() || base.id !== operation.incidentId || local.id !== base.id ||
      !Number.isSafeInteger(operation.baseVersion) || operation.baseVersion < 1 ||
      base.version !== operation.baseVersion || local.version !== base.version ||
      photos.some((photo) => photo.actorId !== this.actorId || photo.incidentId !== base.id ||
        !photo.referenceId.trim() || !photo.localUri.trim() || photo.status !== 'pending')
    ) throw new Error('offline_invalid_change');

    await this.db.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await transaction.getFirstAsync<OperationRow>(
        'SELECT * FROM pending_operations WHERE operation_id = ?', [operation.operationId],
      );
      if (existing) {
        if (canonicalJson(toOperation(existing)) !== canonicalJson(operation)) {
          throw new Error('offline_operation_identity_reused');
        }
        // Primera escritura gana: un reintento no altera ni la incidencia ni sus fotos.
        return;
      }
      const pending = await transaction.getFirstAsync<OperationRow>(
        'SELECT * FROM pending_operations WHERE actor_id = ? AND incident_id = ? LIMIT 1',
        [this.actorId, base.id],
      );
      const previous = await transaction.getFirstAsync<IncidentRow>(
        'SELECT base_json, local_json FROM local_incidents WHERE actor_id = ? AND incident_id = ?',
        [this.actorId, base.id],
      );
      if (pending && previous && canonicalJson(JSON.parse(previous.base_json)) !== canonicalJson(base)) {
        throw new Error('offline_pending_base_changed');
      }
      await transaction.runAsync(`
        INSERT INTO local_incidents(actor_id, incident_id, base_json, local_json) VALUES (?, ?, ?, ?)
        ON CONFLICT(actor_id, incident_id) DO UPDATE SET base_json = excluded.base_json, local_json = excluded.local_json
      `, [this.actorId, base.id, JSON.stringify(base), JSON.stringify(local)]);
      await transaction.runAsync(`
        INSERT INTO pending_operations(operation_id, actor_id, incident_id, base_version, action, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [operation.operationId, this.actorId, base.id, operation.baseVersion, operation.action,
        JSON.stringify(operation.payload), new Date().toISOString()]);
      for (const photo of photos) {
        const previousPhoto = await transaction.getFirstAsync<{
          actor_id: string; incident_id: string; local_uri: string;
        }>('SELECT * FROM pending_photo_references WHERE reference_id = ?', [photo.referenceId]);
        if (previousPhoto) {
          if (previousPhoto.actor_id !== photo.actorId || previousPhoto.incident_id !== photo.incidentId ||
            previousPhoto.local_uri !== photo.localUri) throw new Error('offline_photo_identity_reused');
        } else {
          await transaction.runAsync(`
            INSERT INTO pending_photo_references(reference_id, actor_id, incident_id, local_uri)
            VALUES (?, ?, ?, ?)
          `, [photo.referenceId, this.actorId, photo.incidentId, photo.localUri]);
        }
      }
    });
  }

  async getIncident(incidentId: string): Promise<LocalIncident | null> {
    const row = await this.db.getFirstAsync<IncidentRow>(
      'SELECT base_json, local_json FROM local_incidents WHERE actor_id = ? AND incident_id = ?',
      [this.actorId, incidentId],
    );
    return row ? { base: JSON.parse(row.base_json), local: JSON.parse(row.local_json) } : null;
  }

  async listPendingOperations(): Promise<readonly PendingIncidentOperation[]> {
    const rows = await this.db.getAllAsync<OperationRow>(
      'SELECT * FROM pending_operations WHERE actor_id = ? ORDER BY sequence', [this.actorId],
    );
    return rows.map(toOperation);
  }

  async listPendingPhotos(incidentId: string): Promise<readonly PendingPhotoReference[]> {
    const rows = await this.db.getAllAsync<{
      reference_id: string; incident_id: string; actor_id: string; local_uri: string; status: 'pending';
    }>('SELECT * FROM pending_photo_references WHERE actor_id = ? AND incident_id = ? ORDER BY reference_id',
    [this.actorId, incidentId]);
    return rows.map((row) => ({
      referenceId: row.reference_id, incidentId: row.incident_id, actorId: row.actor_id,
      localUri: row.local_uri, status: row.status,
    }));
  }

  async removeConfirmedOperation(confirmation: OperationConfirmation): Promise<boolean> {
    if (confirmation.confirmed !== true || confirmation.actorId !== this.actorId ||
      !Number.isSafeInteger(confirmation.serverVersion)) throw new Error('offline_invalid_confirmation');
    let removed = false;
    await this.db.withExclusiveTransactionAsync(async (transaction) => {
      const row = await transaction.getFirstAsync<OperationRow>(
        'SELECT * FROM pending_operations WHERE operation_id = ? AND actor_id = ?',
        [confirmation.operationId, this.actorId],
      );
      if (!row) return;
      if (row.incident_id !== confirmation.incidentId || confirmation.serverVersion <= row.base_version) {
        throw new Error('offline_invalid_confirmation');
      }
      const result = await transaction.runAsync(
        'DELETE FROM pending_operations WHERE operation_id = ? AND actor_id = ?',
        [confirmation.operationId, this.actorId],
      );
      removed = result.changes === 1;
      // Confirmar una acción no confirma ni elimina fotografías pendientes.
    });
    return removed;
  }

  close(): Promise<void> {
    return this.db.closeAsync();
  }
}
