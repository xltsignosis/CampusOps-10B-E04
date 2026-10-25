import type { IncidentCategory, IncidentStatus } from '../campusops/contracts';
import { SessionError, type RequestAuthorizer, type RequestCredentials } from '../domain/session';
import { parseRemoteResource, type RemoteResource } from './remoteResource';

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';
const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_ACTOR_ID = 'reporter-1';
const DEFAULT_ACCESS_TOKEN = 'course-valid-token';

const INCIDENT_CATEGORIES: ReadonlySet<string> = new Set([
  'electrical',
  'laboratory',
  'water',
  'connectivity',
  'equipment',
  'safety',
  'maintenance',
]);

const INCIDENT_STATUSES: ReadonlySet<string> = new Set([
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
]);

const INCIDENT_PRIORITIES = new Set(['low', 'medium', 'high']);

export type IncidentDetails = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
  reporterId: string;
  assignedTechnicianId: string | null;
  priority: 'low' | 'medium' | 'high';
}>;

/** Objeto de aplicación separado del DTO recibido por HTTP. */
export type IncidentSnapshot = Readonly<{
  id: string;
  version: number;
  status: IncidentStatus;
  details: IncidentDetails | null;
}>;

export type CreateIncidentInput = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
}>;

/** Operaciones sobre una incidencia existente; el backend decide si el perfil puede ejecutarlas. */
export type IncidentActionInput =
  | Readonly<{ action: 'start' }>
  | Readonly<{ action: 'resolve'; diagnosis: string }>
  | Readonly<{ action: 'close' }>
  | Readonly<{ action: 'reopen' }>
  | Readonly<{ action: 'comment'; text: string }>;

export type IncidentClientErrorKind =
  | 'contract'
  | 'timeout'
  | 'network'
  | 'server'
  | 'http';

export class IncidentClientError extends Error {
  readonly kind: IncidentClientErrorKind;
  readonly status: number | undefined;

  constructor(kind: IncidentClientErrorKind, message: string, status?: number, readonly serverCode?: string) {
    super(message);
    this.name = 'IncidentClientError';
    this.kind = kind;
    this.status = status;
  }
}

export type IncidentClientOptions = Readonly<{
  baseUrl?: string;
  actorId?: string;
  accessToken?: string;
  timeoutMs?: number;
  scenario?: string;
  fetchImpl?: typeof fetch;
  /** Sesión de la app. Si se omite, se usan actorId y accessToken fijos. */
  auth?: RequestAuthorizer;
}>;

type RequestOptions = Readonly<{
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toIncidentSnapshot(resource: RemoteResource): IncidentSnapshot {
  if (!INCIDENT_STATUSES.has(resource.status)) {
    throw new IncidentClientError('contract', 'La respuesta contiene un estado de incidencia inválido.');
  }

  if (resource.payload === null) {
    return {
      id: resource.id,
      version: resource.version,
      status: resource.status as IncidentStatus,
      details: null,
    };
  }

  const payload = resource.payload;
  const assignedTechnicianId = payload.assignedTechnicianId;
  if (
    !isNonEmptyString(payload.category) ||
    !INCIDENT_CATEGORIES.has(payload.category) ||
    !isNonEmptyString(payload.description) ||
    !isNonEmptyString(payload.location) ||
    !isNonEmptyString(payload.reporterId) ||
    !(
      assignedTechnicianId === null ||
      isNonEmptyString(assignedTechnicianId)
    ) ||
    !isNonEmptyString(payload.priority) ||
    !INCIDENT_PRIORITIES.has(payload.priority)
  ) {
    throw new IncidentClientError('contract', 'El payload de la incidencia no cumple el contrato.');
  }

  return {
    id: resource.id,
    version: resource.version,
    status: resource.status as IncidentStatus,
    details: {
      category: payload.category as IncidentCategory,
      description: payload.description,
      location: payload.location,
      reporterId: payload.reporterId,
      assignedTechnicianId,
      priority: payload.priority as IncidentDetails['priority'],
    },
  };
}

function parseIncident(input: unknown): IncidentSnapshot {
  const parsed = parseRemoteResource(input);
  if (!parsed.ok) {
    throw new IncidentClientError('contract', 'La respuesta no cumple el contrato remoto.');
  }
  return toIncidentSnapshot(parsed.value);
}

export class IncidentClient {
  private readonly baseUrl: string;
  private readonly actorId: string;
  private readonly accessToken: string;
  private readonly timeoutMs: number;
  private readonly scenario: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly auth: RequestAuthorizer | undefined;
  private requestSequence = 0;

  constructor(options: IncidentClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_BASE_URL)
      .replace(/\/$/, '');
    this.actorId = options.actorId ?? DEFAULT_ACTOR_ID;
    this.accessToken = options.accessToken ?? DEFAULT_ACCESS_TOKEN;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scenario = options.scenario;
    // Se resuelve fetch global al llamar, no al construir, y sin depender de `this`.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.auth = options.auth;

    if (!isNonEmptyString(this.baseUrl) || !isNonEmptyString(this.actorId)) {
      throw new Error('La configuración del cliente de incidencias es inválida.');
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('timeoutMs debe ser un número positivo.');
    }
  }

  async getIncidents(): Promise<readonly IncidentSnapshot[]> {
    const input = await this.requestJson('/v1/incidents');
    if (!isRecord(input) || !Array.isArray(input.items)) {
      throw new IncidentClientError('contract', 'La lista de incidencias no cumple el contrato.');
    }
    return input.items.map(parseIncident);
  }

  async getIncident(id: string): Promise<IncidentSnapshot | null> {
    if (!isNonEmptyString(id)) {
      throw new Error('El ID de la incidencia no puede estar vacío.');
    }

    try {
      const input = await this.requestJson(`/v1/incidents/${encodeURIComponent(id)}`);
      return parseIncident(input);
    } catch (error) {
      if (error instanceof IncidentClientError && error.kind === 'http' && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async createIncident(
    input: CreateIncidentInput,
    idempotencyKey: string,
  ): Promise<IncidentSnapshot> {
    if (
      !INCIDENT_CATEGORIES.has(input.category) ||
      !isNonEmptyString(input.description) ||
      !isNonEmptyString(input.location)
    ) {
      throw new Error('Los datos para crear la incidencia son inválidos.');
    }
    if (!isNonEmptyString(idempotencyKey) || idempotencyKey.length < 8) {
      throw new Error('La clave de idempotencia debe contener al menos 8 caracteres.');
    }

    const response = await this.requestJson('/v1/incidents', {
      method: 'POST',
      body: input,
      idempotencyKey,
    });
    if (!isRecord(response) || !('incident' in response)) {
      throw new IncidentClientError('contract', 'La creación no devolvió una incidencia válida.');
    }
    return parseIncident(response.incident);
  }

  async performAction(
    id: string,
    baseVersion: number,
    input: IncidentActionInput,
    idempotencyKey: string,
  ): Promise<IncidentSnapshot> {
    if (!isNonEmptyString(id) || !Number.isInteger(baseVersion) || baseVersion < 0) {
      throw new Error('La incidencia o su versión son inválidas.');
    }
    if (input.action === 'resolve' && !isNonEmptyString(input.diagnosis)) {
      throw new Error('La resolución necesita un diagnóstico.');
    }
    if (input.action === 'comment' && !isNonEmptyString(input.text)) throw new Error('La nota necesita contenido.');
    if (!isNonEmptyString(idempotencyKey) || idempotencyKey.length < 8) {
      throw new Error('La clave de idempotencia debe contener al menos 8 caracteres.');
    }

    const response = await this.requestJson(`/v1/incidents/${encodeURIComponent(id)}/actions`, {
      method: 'POST',
      body: { ...input, baseVersion },
      idempotencyKey,
    });
    if (!isRecord(response) || !('incident' in response) || response.operationId !== idempotencyKey) {
      throw new IncidentClientError('contract', 'La operación no devolvió una incidencia válida.');
    }
    return parseIncident(response.incident);
  }

  private async credentialsFor(requestId: string): Promise<RequestCredentials> {
    if (!this.auth) {
      return { accessToken: this.accessToken, actorId: this.actorId, generation: 0 };
    }
    try {
      return await this.auth.authorize(requestId);
    } catch (error) {
      if (error instanceof SessionError) {
        throw new IncidentClientError('http', 'No hay una sesión válida para esta solicitud.', 401);
      }
      throw error;
    }
  }

  private async requestJson(path: string, options: RequestOptions = {}): Promise<unknown> {
    this.requestSequence += 1;
    const requestId = `request-${this.requestSequence}`;

    let credentials = await this.credentialsFor(requestId);
    let response = await this.send(path, options, credentials);
    // Un 401 se consulta con la sesión; a lo más se reenvía una vez por solicitud.
    if (response.status === 401 && this.auth && await this.auth.onUnauthorized(requestId, credentials.generation)) {
      credentials = await this.credentialsFor(requestId);
      response = await this.send(path, options, credentials);
    }

    if (!response.ok) {
      const kind: IncidentClientErrorKind = response.status >= 500 ? 'server' : 'http';
      throw new IncidentClientError(kind, `El backend respondió con HTTP ${response.status}.`, response.status);
    }

    try {
      return await response.json() as unknown;
    } catch {
      throw new IncidentClientError('contract', 'El backend devolvió JSON inválido.');
    }
  }

  private async send(path: string, options: RequestOptions, credentials: RequestCredentials): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${credentials.accessToken}`,
      'X-Course-Actor': credentials.actorId,
    };

    if (this.scenario) {
      headers['X-Course-Scenario'] = this.scenario;
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      if (controller.signal.aborted) {
        throw new IncidentClientError('timeout', 'El backend excedió el tiempo de espera.');
      }
      throw new IncidentClientError('network', 'No fue posible conectar con el backend.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
