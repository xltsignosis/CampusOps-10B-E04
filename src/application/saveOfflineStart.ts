import { availableActions } from '../domain/incidentPermissions';
import type { OfflineStore, PendingPhotoReference, VersionedIncident } from '../domain/offlineStore';
import type { Session } from '../domain/session';

/** Guarda la intención; no afirma haber aplicado la acción en el servidor. */
export async function saveOfflineStart(
  store: OfflineStore,
  session: Session,
  base: VersionedIncident,
  operationId: string,
  notes: string,
  photos: readonly PendingPhotoReference[] = [],
): Promise<void> {
  if (!availableActions(session, base).includes('start')) throw new Error('offline_start_forbidden');
  await store.savePendingChange({
    base,
    local: { ...base, status: 'in_progress' },
    operation: {
      operationId,
      incidentId: base.id,
      actorId: session.actorId,
      baseVersion: base.version,
      action: 'start',
      payload: { notes, photoReferenceIds: photos.map((photo) => photo.referenceId) },
    },
    photos,
  });
}
