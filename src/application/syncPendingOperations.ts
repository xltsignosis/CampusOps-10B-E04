
import type { PendingIncidentOperation } from '../campusops/contracts';
import {
  IncidentSourceError,
  type IncidentAction,
  type IncidentActions,
} from '../domain/incident';
import type {
  OfflineStore,
  OperationConfirmation,
} from '../domain/offlineStore';
import type { Session } from '../domain/session';

export type SyncOperationResult = Readonly<{
  operationId: string;
  status: 'confirmed' | 'conflict' | 'pending' | 'forbidden' | 'invalid';
}>;

export type SyncResult = Readonly<{
  results: readonly SyncOperationResult[];
  confirmed: number;
  pending: number;
  conflicts: number;
  forbidden: number;
  invalid: number;
}>;

function deduplicateOperations(
  operations: readonly PendingIncidentOperation[],
): readonly PendingIncidentOperation[] {
  const seen = new Set<string>();
  const result: PendingIncidentOperation[] = [];

  for (const operation of operations) {
    if (seen.has(operation.operationId)) continue;
    seen.add(operation.operationId);
    result.push(operation);
  }

  return result;
}

function toAction(
  operation: PendingIncidentOperation,
): IncidentAction | null {
  switch (operation.action) {
    case 'start':
      return { action: 'start' };

    case 'resolve': {
      const diagnosis = operation.payload.diagnosis;
      if (typeof diagnosis !== 'string' || !diagnosis.trim()) return null;
      return { action: 'resolve', diagnosis };
    }

    case 'close':
      return { action: 'close' };

    case 'reopen':
      return { action: 'reopen' };

    default:
      return null;
  }
}

function isHttpStatus(
  error: unknown,
  status: number,
): boolean {
  return error instanceof IncidentSourceError &&
    error.kind === 'rejected' &&
    error.status === status;
}

/**
 * Procesa la cola local usando la sesión activa.
 * Sólo elimina una operación después de recibir una respuesta válida
 * del servidor y confirmar su nueva versión.
 */
export async function syncPendingOperations(
  store: OfflineStore,
  actions: IncidentActions,
  session: Session,
): Promise<SyncResult> {
  const operations = deduplicateOperations(
    await store.listPendingOperations(),
  );

  const results: SyncOperationResult[] = [];

  for (const operation of operations) {
    if (operation.actorId !== session.actorId) {
      results.push({
        operationId: operation.operationId,
        status: 'forbidden',
      });
      continue;
    }

    const action = toAction(operation);

    if (!action) {
      results.push({
        operationId: operation.operationId,
        status: 'invalid',
      });
      continue;
    }

    try {
      const updated = await actions.perform(
        operation.incidentId,
        operation.baseVersion,
        action,
        operation.operationId,
      );

      if (
        !('version' in updated) ||
        typeof updated.version !== 'number' ||
        !Number.isSafeInteger(updated.version) ||
        updated.version <= operation.baseVersion ||
        updated.id !== operation.incidentId
      ) {
        results.push({
          operationId: operation.operationId,
          status: 'pending',
        });
        continue;
      }

      const confirmation: OperationConfirmation = {
        operationId: operation.operationId,
        incidentId: operation.incidentId,
        actorId: operation.actorId,
        serverVersion: updated.version,
        confirmed: true,
      };

      await store.removeConfirmedOperation(confirmation);

      results.push({
        operationId: operation.operationId,
        status: 'confirmed',
      });
    } catch (error) {
      if (isHttpStatus(error, 409)) {
        results.push({
          operationId: operation.operationId,
          status: 'conflict',
        });
      } else if (isHttpStatus(error, 401) || isHttpStatus(error, 403)) {
        results.push({
          operationId: operation.operationId,
          status: 'forbidden',
        });
      } else {
        // Un timeout no demuestra que el servidor no ejecutara la acción.
        // Se conserva la operación y se reintenta con la misma identidad.
        results.push({
          operationId: operation.operationId,
          status: 'pending',
        });
      }
    }
  }

  return {
    results,
    confirmed: results.filter((item) => item.status === 'confirmed').length,
    pending: results.filter((item) => item.status === 'pending').length,
    conflicts: results.filter((item) => item.status === 'conflict').length,
    forbidden: results.filter((item) => item.status === 'forbidden').length,
    invalid: results.filter((item) => item.status === 'invalid').length,
  };
}
