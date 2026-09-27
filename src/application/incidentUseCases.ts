import type { Incident, IncidentRepository } from '../domain/incident';
import type { TelemetrySink } from '../domain/telemetry';
import { recordTelemetry } from './telemetry';

export async function getIncidentList(
  repository: IncidentRepository,
  telemetry?: TelemetrySink,
): Promise<readonly Incident[]> {
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

export async function getIncidentDetail(
  repository: IncidentRepository,
  id: string,
  telemetry?: TelemetrySink,
): Promise<Incident | null> {
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
