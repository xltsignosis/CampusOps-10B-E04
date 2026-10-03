import {
  IncidentSourceError,
  type IncidentDraft,
  type IncidentEntry,
  type IncidentSource,
  type IncidentSourceErrorKind,
  type IncidentWriter,
} from '../domain/incident';
import {
  IncidentClientError,
  type IncidentClient,
  type IncidentClientErrorKind,
  type IncidentSnapshot,
} from './incidentClient';

const ERROR_KINDS: Readonly<Record<IncidentClientErrorKind, IncidentSourceErrorKind>> = {
  contract: 'invalid_response',
  timeout: 'timeout',
  server: 'unavailable',
  network: 'network',
  http: 'rejected',
};

/**
 * Convierte el objeto ya validado por IncidentClient en una entrada del dominio.
 * El contrato remoto no publica título ni fecha de reporte: el título se toma de
 * la descripción y la fecha queda en null, en lugar de inventarla.
 */
export function toIncidentEntry(snapshot: IncidentSnapshot): IncidentEntry {
  const { details } = snapshot;
  if (details === null) {
    return { id: snapshot.id, status: snapshot.status, detailsAvailable: false };
  }
  return {
    id: snapshot.id,
    title: details.description,
    description: details.description,
    category: details.category,
    status: snapshot.status,
    priority: details.priority,
    location: { source: 'manual', label: details.location },
    reportedAt: null,
    assignedTechnicianId: details.assignedTechnicianId,
  };
}

/** Traduce cualquier fallo del cliente HTTP a un error de dominio sin detalles de transporte. */
export function toIncidentSourceError(error: unknown): IncidentSourceError {
  if (error instanceof IncidentSourceError) return error;
  if (error instanceof IncidentClientError) {
    return new IncidentSourceError(ERROR_KINDS[error.kind], error.status);
  }
  // Errores de validación de entrada del cliente (ID vacío, borrador inválido, etc.).
  return new IncidentSourceError('rejected');
}

/** Adaptador que expone IncidentClient a los casos de uso mediante los puertos del dominio. */
export class RemoteIncidentRepository implements IncidentSource<IncidentEntry>, IncidentWriter {
  private readonly client: IncidentClient;

  constructor(client: IncidentClient) {
    this.client = client;
  }

  async getAll(): Promise<readonly IncidentEntry[]> {
    try {
      const snapshots = await this.client.getIncidents();
      return snapshots.map(toIncidentEntry);
    } catch (error) {
      throw toIncidentSourceError(error);
    }
  }

  async getById(id: string): Promise<IncidentEntry | null> {
    try {
      const snapshot = await this.client.getIncident(id);
      return snapshot === null ? null : toIncidentEntry(snapshot);
    } catch (error) {
      throw toIncidentSourceError(error);
    }
  }

  async create(draft: IncidentDraft, idempotencyKey: string): Promise<IncidentEntry> {
    try {
      return toIncidentEntry(await this.client.createIncident(draft, idempotencyKey));
    } catch (error) {
      throw toIncidentSourceError(error);
    }
  }
}
