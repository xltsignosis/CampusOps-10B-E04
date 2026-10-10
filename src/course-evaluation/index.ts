import type {
  AuthEvent,
  JsonObject,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
  SyncRecord,
} from './contracts';
import type { IncidentLocation } from '../campusops/contracts';
import { redactForTelemetry as redactCampusOpsTelemetry } from '../application/telemetry';
import { parseRemoteResource as parseCampusOpsRemoteResource } from '../infrastructure/remoteResource';

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

/** Week 04: delega en la sanitización que usan los casos de uso de CampusOps. */
export function redactForTelemetry(input: unknown): unknown {
  return redactCampusOpsTelemetry(input);
}

export function parseRemoteResource(input: unknown): ParseResult {
  return parseCampusOpsRemoteResource(input);
}

/** Agrupa los 401 de una generación y limita cada solicitud a un reintento. */
export function coordinateRefresh(events: readonly AuthEvent[]): Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}> {
  let status: 'anonymous' | 'authenticated' = 'anonymous';
  let activeGeneration: number | null = null;
  let persistedToken: string | null = null;
  let refreshCalls = 0;
  let refreshingGeneration: number | null = null;
  let sessionClosed = false;
  const pendingRequestIds = new Set<string>();
  const retriedRequestIds = new Set<string>();

  for (const event of events) {
    // No hay un evento de login en este contrato: el cierre es definitivo.
    if (sessionClosed) continue;

    switch (event.type) {
      case 'request401': {
        if (!event.requestId || retriedRequestIds.has(event.requestId)) break;

        const generation: number = event.generation ?? activeGeneration ?? 0;
        if (activeGeneration === null) {
          activeGeneration = generation;
          status = 'authenticated';
        }

        // Un 401 tardío puede reintentarse con el token que ya se renovó.
        if (generation < activeGeneration && persistedToken !== null) {
          retriedRequestIds.add(event.requestId);
          break;
        }
        if (generation !== activeGeneration) break;

        pendingRequestIds.add(event.requestId);
        if (refreshingGeneration === null) {
          refreshingGeneration = generation;
          refreshCalls += 1;
        }
        break;
      }
      case 'refreshSucceeded': {
        if (refreshingGeneration === null || !event.token) break;

        const generation: number = event.generation ?? refreshingGeneration + 1;
        // Solo la respuesta del refresh vigente puede reemplazar el token.
        if (generation !== refreshingGeneration + 1) break;

        status = 'authenticated';
        activeGeneration = generation;
        persistedToken = event.token;
        for (const requestId of pendingRequestIds) {
          retriedRequestIds.add(requestId);
        }
        pendingRequestIds.clear();
        refreshingGeneration = null;
        break;
      }
      case 'refreshFailed':
      case 'logout':
        if (event.type === 'refreshFailed') {
          if (refreshingGeneration === null) break;
          // Los resultados identifican la generación esperada del nuevo token.
          if (
            event.generation !== undefined &&
            event.generation !== refreshingGeneration + 1
          ) {
            break;
          }
        }
        status = 'anonymous';
        activeGeneration = null;
        persistedToken = null;
        refreshingGeneration = null;
        pendingRequestIds.clear();
        sessionClosed = true;
        break;
    }
  }

  return {
    status,
    activeGeneration,
    refreshCalls,
    retriedRequestIds: [...retriedRequestIds],
    persistedToken,
  };
}

export function resolveSync(
  _base: SyncRecord,
  _local: SyncRecord,
  _remote: SyncRecord,
): Readonly<{ kind: 'merged'; fields: JsonObject } | { kind: 'conflict'; fields: readonly string[] }> {
  return pending('resolveSync');
}

export function deduplicateOperations<T extends Readonly<{ operationId: string }>>(
  _operations: readonly T[],
): readonly T[] {
  return pending('deduplicateOperations');
}

export function planRetry(_input: Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>): Readonly<{ retry: boolean; delayMs: number; requiresStableIdempotencyKey: boolean }> {
  return pending('planRetry');
}

export function reduceRemoteResponses(_input: Readonly<{
  activeRequestId: string;
  responses: readonly RemoteResponse[];
}>): Readonly<{ state: 'success' | 'error' | 'loading'; value?: unknown; error?: string }> {
  return pending('reduceRemoteResponses');
}

export function reducePermissionLifecycle(
  _events: readonly PermissionEvent[],
): Readonly<{ status: 'available' | 'denied' | 'blocked'; resourceActive: boolean }> {
  return pending('reducePermissionLifecycle');
}

/** Week 09: see docs/CAMPUSOPS_API.md; this is not a completed solution. */
export function selectIncidentLocation(_provider: unknown, _manualLabel: string): IncidentLocation {
  return pending('selectIncidentLocation');
}
