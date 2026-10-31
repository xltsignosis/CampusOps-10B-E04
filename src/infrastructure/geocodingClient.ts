
import type { IncidentLocation } from '../campusops/contracts';
import type {
  RequestAuthorizer,
  RequestCredentials,
} from '../domain/session';
import { selectIncidentLocation } from '../course-evaluation';

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ACCESS_TOKEN = 'course-valid-token';
const DEFAULT_ACTOR_ID = 'reporter-1';

export type GeocodingErrorKind =
  | 'timeout'
  | 'network'
  | 'http'
  | 'contract';

export class GeocodingClientError extends Error {
  readonly status: number | undefined;

  constructor(
    readonly kind: GeocodingErrorKind,
    status?: number,
  ) {
    super(`Geocodificación no disponible: ${kind}`);
    this.name = 'GeocodingClientError';
    this.status = status;
  }
}

export type GeocodingClientOptions = Readonly<{
  baseUrl?: string;
  timeoutMs?: number;
  scenario?: string;
  fetchImpl?: typeof fetch;
  auth?: RequestAuthorizer;
}>;

type CacheEntry = Readonly<{
  location: IncidentLocation;
  expiresAt: number;
}>;

/**
 * Adaptador HTTP y caché para el contrato GET /v1/geocoding?q=...
 * Sólo conserva resultados que selectIncidentLocation valida.
 */
export class GeocodingClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly scenario: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly auth: RequestAuthorizer | undefined;
  private requestSequence = 0;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: GeocodingClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, '');

    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scenario = options.scenario;
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.auth = options.auth;

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('timeoutMs debe ser positivo.');
    }
  }

  async resolve(
    query: string,
    manualLabel: string,
  ): Promise<IncidentLocation> {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return selectIncidentLocation(null, manualLabel);
    }

    const cached = this.cache.get(normalizedQuery);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.location;
    }

    if (cached) {
      this.cache.delete(normalizedQuery);
    }

    try {
      const providerResult = await this.search(normalizedQuery);
      const location = selectIncidentLocation(
        providerResult,
        manualLabel,
      );

      if (location.source === 'provider') {
        this.cache.set(normalizedQuery, {
          location,
          expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
        });

        // Limita el tamaño de la caché.
        if (this.cache.size > 50) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey !== undefined) {
            this.cache.delete(oldestKey);
          }
        }
      }

      return location;
    } catch {
      // Timeout, desconexión, 429 o respuesta inválida:
      // se conserva la etiqueta manual sin inventar coordenadas.
      return selectIncidentLocation(null, manualLabel);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async search(query: string): Promise<unknown> {
    this.requestSequence += 1;
    const requestId = `geocoding-${this.requestSequence}`;

    let credentials: RequestCredentials = this.auth
      ? await this.auth.authorize(requestId)
      : {
          accessToken: DEFAULT_ACCESS_TOKEN,
          actorId: DEFAULT_ACTOR_ID,
          generation: 0,
        };

    let response = await this.send(query, credentials);

    if (
      response.status === 401 &&
      this.auth &&
      await this.auth.onUnauthorized(requestId, credentials.generation)
    ) {
      credentials = await this.auth.authorize(requestId);
      response = await this.send(query, credentials);
    }

    if (!response.ok) {
      throw new GeocodingClientError('http', response.status);
    }

    try {
      return await response.json() as unknown;
    } catch {
      throw new GeocodingClientError('contract');
    }
  }

  private async send(
    query: string,
    credentials: RequestCredentials,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${credentials.accessToken}`,
      'X-Course-Actor': credentials.actorId,
    };

    if (this.scenario) {
      headers['X-Course-Scenario'] = this.scenario;
    }

    const url =
      `${this.baseUrl}/v1/geocoding?q=${encodeURIComponent(query)}`;

    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new GeocodingClientError('timeout');
      }

      throw new GeocodingClientError('network');
    } finally {
      clearTimeout(timeout);
    }
  }
}
