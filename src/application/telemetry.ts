import type { TelemetryEvent, TelemetrySink } from '../domain/telemetry';

export const REDACTED = '[REDACTED]';
export const CIRCULAR = '[Circular]';

/**
 * Claves sensibles normalizadas (minúsculas, sin `_` ni `-`).
 * Las primeras 19 son el contrato de docs/CAMPUSOPS_API.md (semana 4); el
 * contrato es un mínimo, así que se añaden credenciales y texto libre de CampusOps.
 */
const SENSITIVE_TELEMETRY_KEYS: ReadonlySet<string> = new Set([
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
  // Extensión del equipo: credenciales, identidad del actor y texto libre.
  'cookie',
  'setcookie',
  'apikey',
  'secret',
  'sessiontoken',
  'xcourseactor',
  'actorid',
  'description',
  'diagnosis',
  'comment',
  'text',
]);

export function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

export function isSensitiveTelemetryKey(key: string): boolean {
  return SENSITIVE_TELEMETRY_KEYS.has(normalizeTelemetryKey(key));
}

/**
 * Un error se reduce a su tipo y, si existe, a un código técnico. `message` y
 * `stack` se descartan porque pueden contener texto libre (tokens, nombres, rutas).
 * Se usa `errorType` y no `name` porque `name` es una clave sensible del contrato.
 */
function describeError(error: Error): Record<string, unknown> {
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? { errorType: error.name, code }
    : { errorType: error.name };
}

/**
 * Devuelve una copia sanitizada para registros técnicos, sin mutar la entrada.
 * Recorre objetos y listas anidados; si la clave es sensible sustituye el valor
 * completo (aunque sea objeto o lista) por `[REDACTED]`.
 */
export function redactForTelemetry(input: unknown): unknown {
  const ancestors = new Set<object>();

  const redact = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (value instanceof Error) return describeError(value);
    if (ancestors.has(value)) return CIRCULAR;

    ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.map(redact);
      const copy: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        copy[key] = isSensitiveTelemetryKey(key) ? REDACTED : redact(item);
      }
      return copy;
    } finally {
      ancestors.delete(value);
    }
  };

  return redact(input);
}

/**
 * Sanitiza y entrega el evento al sink. Registrar nunca debe romper el flujo de
 * la app: si el sink falla, el error se descarta sin relanzar datos del evento.
 */
export function recordTelemetry(sink: TelemetrySink | undefined, event: TelemetryEvent): void {
  if (!sink) return;
  try {
    sink.record(redactForTelemetry(event));
  } catch {
    // La telemetría es de mejor esfuerzo; no se propaga ni se registra en consola.
  }
}
