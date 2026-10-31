import { resolveSync as resolveCampusOpsSync, deduplicateOperations as deduplicateCampusOpsOperations } from '../application/syncPolicy';
import type {
  AuthEvent,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
} from './contracts';
import type { IncidentLocation } from '../campusops/contracts';
import {
  redactForTelemetry as redactCampusOpsTelemetry,
} from '../application/telemetry';
import {
  coordinateRefresh as coordinateCampusOpsRefresh,
} from '../application/session/refreshCoordinator';
import {
  parseRemoteResource as parseCampusOpsRemoteResource,
} from '../infrastructure/remoteResource';

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

/** Week 04: delegates to the application's telemetry sanitization. */
export function redactForTelemetry(input: unknown): unknown {
  return redactCampusOpsTelemetry(input);
}

export function parseRemoteResource(input: unknown): ParseResult {
  return parseCampusOpsRemoteResource(input);
}

/** Week 06: delegates to the application's session refresh rules. */
export function coordinateRefresh(
  events: readonly AuthEvent[],
): Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}> {
  return coordinateCampusOpsRefresh(events);
}

/** Week 08: delegates to the policy used by the offline repository. */
export const resolveSync = resolveCampusOpsSync;
export const deduplicateOperations = deduplicateCampusOpsOperations;

export function planRetry(
  _input: Readonly<{
    method: 'GET' | 'POST';
    status: number | 'timeout';
    attempt: number;
    retryAfterMs?: number;
    idempotencyKey?: string;
  }>,
): Readonly<{
  retry: boolean;
  delayMs: number;
  requiresStableIdempotencyKey: boolean;
}> {
  return pending('planRetry');
}

export function reduceRemoteResponses(
  _input: Readonly<{
    activeRequestId: string;
    responses: readonly RemoteResponse[];
  }>,
): Readonly<{
  state: 'success' | 'error' | 'loading';
  value?: unknown;
  error?: string;
}> {
  return pending('reduceRemoteResponses');
}

export function reducePermissionLifecycle(
  _events: readonly PermissionEvent[],
): Readonly<{
  status: 'available' | 'denied' | 'blocked';
  resourceActive: boolean;
}> {
  return pending('reducePermissionLifecycle');
}

export function selectIncidentLocation(
  provider: unknown,
  manualLabel: string,
): IncidentLocation {
  // La ubicación manual debe estar disponible como alternativa.
  const fallback: IncidentLocation = {
    source: 'manual',
    label: manualLabel,
  };

  // Validar que el proveedor haya devuelto un objeto.
  if (
    provider === null ||
    typeof provider !== 'object' ||
    Array.isArray(provider)
  ) {
    return fallback;
  }

  const result = provider as Record<string, unknown>;

  // Validar la etiqueta.
  if (
    typeof result.label !== 'string' ||
    result.label.trim().length === 0
  ) {
    return fallback;
  }

  // Validar las coordenadas.
  if (
    typeof result.latitude !== 'number' ||
    typeof result.longitude !== 'number' ||
    !Number.isFinite(result.latitude) ||
    !Number.isFinite(result.longitude) ||
    result.latitude < -90 ||
    result.latitude > 90 ||
    result.longitude < -180 ||
    result.longitude > 180
  ) {
    return fallback;
  }

  // Si todos los datos son correctos, aceptar la ubicación externa.
  return {
    source: 'provider',
    label: result.label,
    latitude: result.latitude,
    longitude: result.longitude,
  };
}
