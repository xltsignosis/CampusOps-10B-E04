import type {
  IncidentDraft,
  IncidentEntry,
  IncidentSource,
  IncidentWriter,
} from '../domain/incident';
import type { TelemetrySink } from '../domain/telemetry';
import { recordTelemetry } from './telemetry';

export async function getIncidentList<T extends IncidentEntry>(
  repository: IncidentSource<T>,
  telemetry?: TelemetrySink,
): Promise<readonly T[]> {
  const startedAt = Date.now();
  try {
    const incidents = await repository.getAll();
    recordTelemetry(telemetry, {
      event: 'incident.list.loaded',
      status: 'ok',
      durationMs: Date.now() - startedAt,
      count: incidents.length,
    });
    return incidents;
  } catch (error) {
    recordTelemetry(telemetry, {
      event: 'incident.list.failed',
      status: 'error',
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

export async function getIncidentDetail<T extends IncidentEntry>(
  repository: IncidentSource<T>,
  id: string,
  telemetry?: TelemetrySink,
): Promise<T | null> {
  const startedAt = Date.now();
  try {
    const incident = await repository.getById(id);
    recordTelemetry(telemetry, {
      event: 'incident.detail.loaded',
      status: 'ok',
      durationMs: Date.now() - startedAt,
      incidentId: id,
      found: incident !== null,
    });
    return incident;
  } catch (error) {
    recordTelemetry(telemetry, {
      event: 'incident.detail.failed',
      status: 'error',
      durationMs: Date.now() - startedAt,
      incidentId: id,
      error,
    });
    throw error;
  }
}

/**
 * Crea una incidencia. La misma idempotencyKey debe reutilizarse al reintentar el
 * mismo envío para que el backend no duplique la incidencia. El borrador no se
 * registra: descripción y ubicación son texto libre.
 */
export async function createIncident(
  writer: IncidentWriter,
  draft: IncidentDraft,
  idempotencyKey: string,
  telemetry?: TelemetrySink,
): Promise<IncidentEntry> {
  const startedAt = Date.now();
  try {
    const created = await writer.create(draft, idempotencyKey);
    recordTelemetry(telemetry, {
      event: 'incident.create.succeeded',
      status: 'ok',
      durationMs: Date.now() - startedAt,
      incidentId: created.id,
    });
    return created;
  } catch (error) {
    recordTelemetry(telemetry, {
      event: 'incident.create.failed',
      status: 'error',
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

/** Clave de idempotencia para un envío nuevo (el backend exige al menos 8 caracteres). */
export function newIdempotencyKey(): string {
  return `create-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
