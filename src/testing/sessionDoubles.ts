/**
 * Dobles de prueba de la sesión: reloj controlable, almacenamiento en memoria y
 * servicio de sesión programable. Todos los valores son ficticios.
 */
import type {
  Clock,
  LoginGrant,
  SessionGateway,
  SessionStore,
  StoredSession,
  TokenGrant,
} from '../domain/session';
import type { TelemetrySink } from '../domain/telemetry';

export const EXPIRES_IN_MS = 60_000;

/** Reloj que sólo avanza cuando la prueba lo indica. */
export class FakeClock implements Clock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export class MemorySessionStore implements SessionStore {
  value: StoredSession | null = null;
  saves = 0;
  clears = 0;

  async save(session: StoredSession): Promise<void> {
    this.saves += 1;
    this.value = session;
  }

  async load(): Promise<StoredSession | null> {
    return this.value;
  }

  async clear(): Promise<void> {
    this.clears += 1;
    this.value = null;
  }
}

export class MemorySink implements TelemetrySink {
  readonly events: unknown[] = [];

  record(event: unknown): void {
    this.events.push(event);
  }
}

export type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}>;

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function tokenGrant(generation: number): TokenGrant {
  return {
    accessToken: `course-token-g${generation}`,
    refreshToken: `course-refresh-g${generation}`,
    expiresInMs: EXPIRES_IN_MS,
  };
}

/** Servicio de sesión cuyo login y refresh decide cada prueba. */
export class FakeSessionGateway implements SessionGateway {
  readonly loginCalls: string[] = [];
  readonly refreshCalls: string[] = [];
  loginImpl: (actorId: string) => Promise<LoginGrant> = async (actorId) => ({
    actorId,
    role: 'technician',
    ...tokenGrant(0),
  });
  refreshImpl: (refreshToken: string) => Promise<TokenGrant> = async () => tokenGrant(this.refreshCalls.length);

  login(actorId: string): Promise<LoginGrant> {
    this.loginCalls.push(actorId);
    return this.loginImpl(actorId);
  }

  refresh(refreshToken: string): Promise<TokenGrant> {
    this.refreshCalls.push(refreshToken);
    return this.refreshImpl(refreshToken);
  }
}
