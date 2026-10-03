import type {
  IncidentCategory,
  IncidentLocation,
  IncidentStatus,
} from '../campusops/contracts';

export type IncidentPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: IncidentCategory;
  readonly status: IncidentStatus;
  readonly priority: IncidentPriority;
  readonly location: IncidentLocation;
  /** null cuando la fuente no publica la fecha; la app no la inventa. */
  readonly reportedAt: string | null;
  readonly assignedTechnicianId: string | null;
}

/**
 * Incidencia cuyo payload remoto llegó como null válido: sólo se conocen los
 * datos del sobre. No se rellenan título, categoría ni ubicación con valores falsos.
 */
export interface IncidentWithoutDetails {
  readonly id: string;
  readonly status: IncidentStatus;
  readonly detailsAvailable: false;
}

export type IncidentEntry = Incident | IncidentWithoutDetails;

export function hasDetails(entry: IncidentEntry): entry is Incident {
  return !('detailsAvailable' in entry);
}

/** Puerto de lectura; T permite fuentes que sólo devuelven incidencias completas. */
export interface IncidentSource<T extends IncidentEntry = IncidentEntry> {
  getAll(): Promise<readonly T[]>;
  getById(id: string): Promise<T | null>;
}

export type IncidentRepository = IncidentSource<Incident>;

/** Datos que la app envía para reportar una incidencia nueva. */
export type IncidentDraft = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
}>;

/** Puerto de escritura, separado para que una fuente de sólo lectura siga siendo válida. */
export interface IncidentWriter {
  create(draft: IncidentDraft, idempotencyKey: string): Promise<IncidentEntry>;
}

/**
 * Fallos de una fuente de incidencias, expresados en términos de la app y no de HTTP.
 * - invalid_response: la respuesta no cumple el contrato y no se usa.
 * - timeout: la fuente no respondió dentro del límite.
 * - unavailable: la fuente falló de su lado (5xx).
 * - network: no hubo conexión con la fuente.
 * - rejected: la fuente rechazó la solicitud (4xx, p. ej. 401, 403, 422, 429).
 */
export type IncidentSourceErrorKind =
  | 'invalid_response'
  | 'timeout'
  | 'unavailable'
  | 'network'
  | 'rejected';

export class IncidentSourceError extends Error {
  readonly kind: IncidentSourceErrorKind;
  /** Lo usa la telemetría sanitizada, que conserva `code` y descarta `message`. */
  readonly code: IncidentSourceErrorKind;
  readonly status: number | undefined;

  constructor(kind: IncidentSourceErrorKind, status?: number) {
    super(`Fuente de incidencias: ${kind}`);
    this.name = 'IncidentSourceError';
    this.kind = kind;
    this.code = kind;
    this.status = status;
  }
}
