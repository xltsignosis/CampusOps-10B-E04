import type { IncidentLocation } from '../campusops/contracts';
import type { Clock, RequestAuthorizer, RequestCredentials } from '../domain/session';
import { selectIncidentLocation } from '../application/selectIncidentLocation';

export type GeocodingProvider = 'course' | 'photon';
export type GeocodingErrorKind = 'timeout' | 'network' | 'http' | 'contract';
export class GeocodingClientError extends Error {
  constructor(readonly kind: GeocodingErrorKind, readonly status?: number) {
    super('Geocodificación no disponible: ' + kind);
    this.name = 'GeocodingClientError';
  }
}
export type GeocodingClientOptions = Readonly<{
  provider?: GeocodingProvider;
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  clock?: Clock;
  scenario?: string;
  fetchImpl?: typeof fetch;
  auth?: RequestAuthorizer;
}>;

function photonLocation(input: unknown): unknown {
  if (!input || typeof input !== 'object') return null;
  const features = (input as { features?: unknown }).features;
  if (!Array.isArray(features) || !features.length) return null;
  const feature = features[0];
  if (!feature || typeof feature !== 'object' || feature.geometry?.type !== 'Point') return null;
  const coordinates: unknown = feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  return { label: feature.properties?.name, latitude: coordinates[1], longitude: coordinates[0] };
}

/** Course fixture or public Photon. Credentials are never shared between providers. */
export class GeocodingClient {
  private readonly provider: GeocodingProvider;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly clock: Clock;
  private readonly fetchImpl: typeof fetch;
  private requestSequence = 0;
  private readonly cache = new Map<string, { location: IncidentLocation; expiresAt: number }>();

  constructor(private readonly options: GeocodingClientOptions = {}) {
    this.provider = options.provider ?? 'course';
    this.baseUrl = (options.baseUrl ?? (this.provider === 'photon'
      ? 'https://photon.komoot.io' : process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? 'http://127.0.0.1:4310')).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.maxCacheEntries = options.maxCacheEntries ?? 50;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    if (![this.timeoutMs, this.cacheTtlMs].every((n) => Number.isFinite(n) && n > 0 && n <= 2_147_483_647) ||
      !Number.isInteger(this.maxCacheEntries) || this.maxCacheEntries < 1) {
      throw new Error('Timeout, TTL y límite de caché deben ser positivos y finitos.');
    }
  }

  async resolve(query: string, manualLabel: string): Promise<IncidentLocation> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return selectIncidentLocation(null, manualLabel);
    const cached = this.cache.get(normalized);
    if (cached && cached.expiresAt > this.clock.now()) return cached.location;
    this.cache.delete(normalized);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new GeocodingClientError('timeout')); }, this.timeoutMs);
    });
    try {
      // Authorization, headers AND body are bounded, even if transport ignores abort.
      const result = await Promise.race([this.search(normalized, controller.signal), deadline]);
      const location = selectIncidentLocation(result, manualLabel);
      if (location.source === 'provider') {
        this.cache.set(normalized, { location: Object.freeze(location), expiresAt: this.clock.now() + this.cacheTtlMs });
        if (this.cache.size > this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value!);
      }
      return location;
    } catch {
      return selectIncidentLocation(null, manualLabel);
    } finally {
      clearTimeout(timer!);
    }
  }

  clearCache(): void { this.cache.clear(); }

  private async search(query: string, signal: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const requestId = 'geocoding-' + (++this.requestSequence);
    let credentials: RequestCredentials | undefined;
    if (this.provider === 'course') {
      credentials = this.options.auth ? await this.options.auth.authorize(requestId)
        : { accessToken: 'course-valid-token', actorId: 'reporter-1', generation: 0 };
      headers.Authorization = 'Bearer ' + credentials.accessToken;
      headers['X-Course-Actor'] = credentials.actorId;
      if (this.options.scenario) headers['X-Course-Scenario'] = this.options.scenario;
    }
    const path = this.provider === 'photon' ? '/api/?limit=1&q=' : '/v1/geocoding?q=';
    const send = () => {
      if (signal.aborted) throw new GeocodingClientError('timeout');
      return this.fetchImpl(this.baseUrl + path + encodeURIComponent(query), { method: 'GET', headers, signal });
    };
    let response = await send();
    if (response.status === 401 && this.provider === 'course' && this.options.auth && credentials &&
      await this.options.auth.onUnauthorized(requestId, credentials.generation)) {
      const refreshed = await this.options.auth.authorize(requestId);
      if (refreshed.actorId !== credentials.actorId) throw new GeocodingClientError('http', 401);
      headers.Authorization = 'Bearer ' + refreshed.accessToken;
      response = await send();
    }
    if (!response.ok) throw new GeocodingClientError('http', response.status);
    const body: unknown = await response.json();
    return this.provider === 'photon' ? photonLocation(body) : body;
  }
}
