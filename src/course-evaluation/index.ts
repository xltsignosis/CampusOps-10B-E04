import type {
  AuthEvent,
  JsonObject,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
  SyncRecord,
} from './contracts';
import type { IncidentLocation } from '../campusops/contracts';

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

const SENSITIVE_TELEMETRY_KEYS = new Set([
  'authorization',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'email',
  'displayname',
  'name',
  'userid',
  'reporterid',
  'technicianid',
  'assignedtechnicianid',
  'location',
  'latitude',
  'longitude',
  'photos',
  'evidence',
  'internalcomments',
  'assignmenthistory',
]);

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/**
 * Produce una copia sanitizada para telemetría técnica.
 * Los campos sensibles se sustituyen por '[REDACTED]' sin mutar la entrada original.
 */
export function redactForTelemetry(input: unknown): unknown {
  const visited = new WeakMap<object, unknown>();

  const redact = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    const previous = visited.get(value);
    if (previous !== undefined) {
      return previous;
    }

    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      visited.set(value, copy);
      for (const item of value) {
        copy.push(redact(item));
      }
      return copy;
    }

    const copy: Record<string, unknown> = {};
    visited.set(value, copy);
    for (const [key, item] of Object.entries(value)) {
      copy[key] = SENSITIVE_TELEMETRY_KEYS.has(normalizeTelemetryKey(key))
        ? '[REDACTED]'
        : redact(item);
    }
    return copy;
  };

  return redact(input);
}

export function parseRemoteResource(_input: unknown): ParseResult {
  return pending('parseRemoteResource');
}

export function coordinateRefresh(_events: readonly AuthEvent[]): Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}> {
  return pending('coordinateRefresh');
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
