import type { PendingIncidentOperation } from '../campusops/contracts';
import { hasDetails, IncidentSourceError, type IncidentAction, type IncidentActions, type IncidentEntry, type IncidentSource } from '../domain/incident';
import type { OfflineStore, VersionedIncident } from '../domain/offlineStore';
import type { Session } from '../domain/session';
import { deduplicateOperations, incidentSyncRecord, resolveSync } from './syncPolicy';

export type SyncOperationResult = Readonly<{
  operationId: string;
  status: 'confirmed' | 'conflict' | 'pending' | 'forbidden' | 'invalid';
  reason?: string;
  fields?: readonly string[];
  remote?: IncidentEntry;
  merge?: ReturnType<typeof resolveSync>;
}>;
export type SyncResult = Readonly<{
  results: readonly SyncOperationResult[];
  confirmed: number; pending: number; conflicts: number; forbidden: number; invalid: number;
}>;
export type SyncOptions = Readonly<{ source?: IncidentSource; isCurrentSession?: () => boolean }>;

function toAction(operation: PendingIncidentOperation): IncidentAction | null {
  switch (operation.action) {
    case 'start':
      if (operation.payload.notes !== undefined && typeof operation.payload.notes !== 'string') return null;
      return { action: 'start' };
    case 'resolve':
      return typeof operation.payload.diagnosis === 'string' && operation.payload.diagnosis.trim()
        ? { action: 'resolve', diagnosis: operation.payload.diagnosis } : null;
    case 'comment':
      return typeof operation.payload.text === 'string' && operation.payload.text.trim()
        ? { action: 'comment', text: operation.payload.text } : null;
    case 'close': return { action: 'close' };
    case 'reopen': return { action: 'reopen' };
    default: return null;
  }
}

export function versioned(entry: IncidentEntry | null): entry is VersionedIncident {
  return entry !== null && hasDetails(entry) && Number.isSafeInteger(entry.version) && (entry.version ?? 0) > 0;
}

/** Un intento nunca cambia su base ni su clave. 409 requiere revisión, aunque haya una combinación compatible. */
export async function syncPendingOperations(store: OfflineStore, actions: IncidentActions, session: Session, options: SyncOptions = {}): Promise<SyncResult> {
  const operations = [...deduplicateOperations(await store.listPendingOperations())];
  const results: SyncOperationResult[] = [];
  const blocked = new Set<string>();
  for (const operation of operations) {
    if (operation.actorId !== session.actorId || options.isCurrentSession?.() === false) {
      results.push({ operationId: operation.operationId, status: 'forbidden', reason: 'author_session_required' });
      continue;
    }
    if (blocked.has(operation.incidentId)) {
      results.push({ operationId: operation.operationId, status: 'pending', reason: 'previous_operation_unconfirmed' });
      continue;
    }
    const action = toAction(operation);
    if (!action) {
      results.push({ operationId: operation.operationId, status: 'invalid', reason: 'unsupported_content' });
      blocked.add(operation.incidentId);
      continue;
    }
    try {
      const updated = await actions.perform(operation.incidentId, operation.baseVersion, action, operation.operationId);
      if (!versioned(updated) || updated.id !== operation.incidentId || updated.version <= operation.baseVersion) {
        results.push({ operationId: operation.operationId, status: 'pending', reason: 'invalid_confirmation' });
        blocked.add(operation.incidentId);
        continue;
      }
      const notes = operation.action === 'start' ? operation.payload.notes : undefined;
      const followup: PendingIncidentOperation | undefined = typeof notes === 'string' && notes.trim() ? {
        operationId: `${operation.operationId}:note`, incidentId: operation.incidentId, actorId: operation.actorId,
        baseVersion: updated.version, action: 'comment', payload: { text: notes },
      } : undefined;
      const removed = await store.removeConfirmedOperation({
        operationId: operation.operationId, incidentId: operation.incidentId, actorId: operation.actorId,
        serverVersion: updated.version, confirmed: true, serverIncident: updated,
        ...(followup ? { followup } : {}),
      });
      if (removed && followup) operations.push(followup);
      results.push({ operationId: operation.operationId, status: removed ? 'confirmed' : 'pending',
        ...(removed ? {} : { reason: 'confirmation_not_persisted' }) });
    } catch (error) {
      const rejected = error instanceof IncidentSourceError && error.kind === 'rejected';
      const local = await store.getIncident(operation.incidentId);
      if (rejected && error.status === 409) {
        let remote: IncidentEntry | null = null;
        try { remote = await options.source?.getById(operation.incidentId) ?? null; } catch { /* La intención permanece aun si tampoco se puede leer. */ }
        const merge = local && versioned(remote) ? resolveSync(incidentSyncRecord(local.base), incidentSyncRecord(local.local), incidentSyncRecord(remote)) : undefined;
        results.push({ operationId: operation.operationId,
          status: error.serverCode === 'idempotency_key_reused' ? 'invalid' : 'conflict',
          reason: error.serverCode ?? 'version_or_transition_changed',
          ...(remote ? { remote } : {}), ...(merge ? { merge } : {}),
          ...(merge?.kind === 'conflict' ? { fields: merge.fields } : {}),
        });
      } else if (rejected && error.status === 403 && operation.action === 'start' && session.role === 'technician' &&
        local?.base.assignedTechnicianId === session.actorId && local.base.status === 'assigned') {
        // El técnico era elegible en la base. El 403 exige revisar asignación/permisos; no concede acceso remoto.
        results.push({ operationId: operation.operationId, status: 'conflict', fields: ['work'], reason: 'assignment_or_permission_changed' });
      } else if (rejected && (error.status === 401 || error.status === 403)) {
        results.push({ operationId: operation.operationId, status: 'forbidden', reason: 'authorization_required' });
      } else {
        results.push({ operationId: operation.operationId, status: 'pending', reason: 'unconfirmed_response' });
      }
      blocked.add(operation.incidentId);
    }
  }
  return {
    results, confirmed: results.filter((item) => item.status === 'confirmed').length,
    pending: results.filter((item) => item.status === 'pending').length,
    conflicts: results.filter((item) => item.status === 'conflict').length,
    forbidden: results.filter((item) => item.status === 'forbidden').length,
    invalid: results.filter((item) => item.status === 'invalid').length,
  };
}
