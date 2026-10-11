import type { CampusRole } from '../campusops/contracts';
import { SessionError, type LoginGrant, type SessionGateway, type TokenGrant } from '../domain/session';

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';
const DEFAULT_TIMEOUT_MS = 1_000;

const ROLES: ReadonlySet<string> = new Set(['reporter', 'technician', 'coordinator']);

export type SessionGatewayOptions = Readonly<{
  baseUrl?: string;
  timeoutMs?: number;
  scenario?: string;
  fetchImpl?: typeof fetch;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toTokenGrant(input: unknown): TokenGrant {
  if (
    !isRecord(input) ||
    !isNonEmptyString(input.accessToken) ||
    !isNonEmptyString(input.refreshToken) ||
    typeof input.expiresIn !== 'number' ||
    !Number.isFinite(input.expiresIn) ||
    input.expiresIn <= 0
  ) {
    throw new SessionError('unavailable');
  }
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresInMs: input.expiresIn * 1_000,
  };
}

/**
 * Servicio de sesión del backend didáctico. Los errores sólo llevan el tipo de fallo:
 * nunca el cuerpo de la respuesta ni los tokens enviados o recibidos.
 */
export class HttpSessionGateway implements SessionGateway {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly scenario: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SessionGatewayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_BASE_URL)
      .replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scenario = options.scenario;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async login(actorId: string): Promise<LoginGrant> {
    const input = await this.post('/v1/session/login', { actorId }, 'invalid_credentials');
    if (!isRecord(input) || !isNonEmptyString(input.actorId) || !isNonEmptyString(input.role) || !ROLES.has(input.role)) {
      throw new SessionError('unavailable');
    }
    return { actorId: input.actorId, role: input.role as CampusRole, ...toTokenGrant(input) };
  }

  async refresh(refreshToken: string): Promise<TokenGrant> {
    return toTokenGrant(await this.post('/v1/session/refresh', { refreshToken }, 'expired'));
  }

  private async post(
    path: string,
    body: unknown,
    rejectedAs: 'invalid_credentials' | 'expired',
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.scenario) {
      headers['X-Course-Scenario'] = this.scenario;
    }

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        throw new SessionError('unavailable');
      }

      if (response.status === 401) throw new SessionError(rejectedAs);
      if (!response.ok) throw new SessionError('unavailable');

      try {
        return await response.json() as unknown;
      } catch {
        throw new SessionError('unavailable');
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
