import { resolveSync as resolveCampusOpsSync, deduplicateOperations as deduplicateCampusOpsOperations } from '../application/syncPolicy';
import { planRetry as planCampusOpsRetry } from '../application/retryPolicy';
import type {
  AuthEvent,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
} from './contracts';
import {
  redactForTelemetry as redactCampusOpsTelemetry,
} from '../application/telemetry';
import {
  coordinateRefresh as coordinateCampusOpsRefresh,
} from '../application/session/refreshCoordinator';
import {
  parseRemoteResource as parseCampusOpsRemoteResource,
} from '../infrastructure/remoteResource';

export { selectIncidentLocation } from '../application/selectIncidentLocation';

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
  input: Readonly<{
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
  return planCampusOpsRetry(input);
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
