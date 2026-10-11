import type {
  Clock,
  RequestAuthorizer,
  RequestCredentials,
  Session,
  SessionController,
  SessionGateway,
  SessionSnapshot,
  SessionStore,
  TokenGrant,
} from '../../domain/session';
import { SessionError } from '../../domain/session';
import type { TelemetrySink } from '../../domain/telemetry';
import { recordTelemetry } from '../telemetry';
import {
  applyAuthEvent,
  initialRefreshState,
  stateAfterLogin,
  type RefreshState,
} from './refreshCoordinator';

type ActiveSession = Readonly<{
  session: Session;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}>;

export type SessionManagerOptions = Readonly<{
  gateway: SessionGateway;
  store: SessionStore;
  clock?: Clock;
  telemetry?: TelemetrySink;
}>;

const ANONYMOUS: SessionSnapshot = { status: 'anonymous', reason: 'initial' };

/**
 * Ciclo de sesión de CampusOps: inicio, expiración, renovación compartida y cierre.
 * Las transiciones de renovación las decide applyAuthEvent (refreshCoordinator.ts);
 * aquí sólo se ejecutan sus efectos: llamar al servicio, guardar o borrar los tokens.
 */
export class SessionManager implements SessionController, RequestAuthorizer {
  private readonly gateway: SessionGateway;
  private readonly store: SessionStore;
  private readonly clock: Clock;
  private readonly telemetry: TelemetrySink | undefined;
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();

  private active: ActiveSession | null = null;
  private refreshState: RefreshState = initialRefreshState;
  private refreshInFlight: Promise<void> | null = null;
  private snapshot: SessionSnapshot = ANONYMOUS;
  // Cambia en cada inicio, cierre o expiración: un resultado de otra época es obsoleto.
  private epoch = 0;

  constructor(options: SessionManagerOptions) {
    this.gateway = options.gateway;
    this.store = options.store;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.telemetry = options.telemetry;
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Conteos de la renovación, sin tokens, para pruebas y diagnóstico. */
  getRefreshStats(): Readonly<{ refreshCalls: number; retriedRequests: number; generation: number | null }> {
    return {
      refreshCalls: this.refreshState.refreshCalls,
      retriedRequests: this.refreshState.retriedRequestIds.size,
      generation: this.refreshState.activeGeneration,
    };
  }

  /** Recupera la sesión guardada al abrir la app. Si no se puede leer o ya venció, queda sin sesión. */
  async restore(): Promise<SessionSnapshot> {
    const epoch = this.epoch;
    let stored = null;
    try {
      stored = await this.store.load();
    } catch {
      stored = null;
    }
    if (epoch !== this.epoch || this.active !== null || stored === null) return this.snapshot;

    if (this.clock.now() >= stored.expiresAt) {
      await this.close('expired');
      return this.snapshot;
    }

    this.epoch += 1;
    this.active = {
      session: { actorId: stored.actorId, role: stored.role },
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
    };
    this.refreshState = stateAfterLogin(stored.accessToken);
    this.publish({ status: 'authenticated', session: this.active.session });
    return this.snapshot;
  }

  async login(actorId: string): Promise<Session> {
    const startedAt = this.clock.now();
    let grant;
    try {
      grant = await this.gateway.login(actorId);
    } catch (error) {
      recordTelemetry(this.telemetry, {
        event: 'session.login.failed',
        status: 'error',
        durationMs: this.clock.now() - startedAt,
        error,
      });
      throw error instanceof SessionError ? error : new SessionError('unavailable');
    }

    this.epoch += 1;
    this.refreshInFlight = null;
    const session: Session = { actorId: grant.actorId, role: grant.role };
    this.active = {
      session,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: this.clock.now() + grant.expiresInMs,
    };
    this.refreshState = stateAfterLogin(grant.accessToken);

    try {
      await this.persist(this.active);
    } catch {
      // Sin almacenamiento seguro no se conserva una sesión a medias.
      await this.close('initial');
      throw new SessionError('unavailable');
    }

    recordTelemetry(this.telemetry, {
      event: 'session.login.succeeded',
      status: 'ok',
      durationMs: this.clock.now() - startedAt,
      role: session.role,
    });
    this.publish({ status: 'authenticated', session });
    return session;
  }

  /** Cierra la sesión: desde aquí ninguna respuesta tardía puede restaurarla. */
  async logout(): Promise<void> {
    const hadSession = this.active !== null;
    this.refreshState = applyAuthEvent(this.refreshState, { type: 'logout' });
    await this.close('logout');
    if (hadSession) {
      recordTelemetry(this.telemetry, { event: 'session.logout', status: 'ok', durationMs: 0 });
    }
  }

  async authorize(requestId: string): Promise<RequestCredentials> {
    if (this.active === null) throw new SessionError('unauthenticated');

    // Vencida según el reloj: entra a la misma renovación compartida que un 401.
    if (this.clock.now() >= this.active.expiresAt) {
      const renewed = await this.onUnauthorized(requestId, this.refreshState.activeGeneration ?? 0);
      if (!renewed) throw new SessionError('expired');
    }

    const active = this.active;
    if (active === null) throw new SessionError('expired');
    return {
      accessToken: active.accessToken,
      actorId: active.session.actorId,
      generation: this.refreshState.activeGeneration ?? 0,
    };
  }

  async onUnauthorized(requestId: string, generation: number): Promise<boolean> {
    if (this.active === null) return false;
    // Cada solicitud tiene un solo reintento: un segundo 401 no vuelve a renovar.
    if (this.refreshState.retriedRequestIds.has(requestId)) return false;

    const before = this.refreshState;
    this.refreshState = applyAuthEvent(before, { type: 'request401', requestId, generation });

    if (this.refreshState.refreshCalls > before.refreshCalls) {
      this.refreshInFlight = this.runRefresh(this.epoch, this.active.refreshToken, generation);
    }
    if (this.refreshState.pendingRequestIds.has(requestId) && this.refreshInFlight !== null) {
      await this.refreshInFlight;
    }
    return this.active !== null && this.refreshState.retriedRequestIds.has(requestId);
  }

  /** Única llamada de renovación por generación. No rechaza: deja el resultado en el estado. */
  private async runRefresh(epoch: number, refreshToken: string, generation: number): Promise<void> {
    const startedAt = this.clock.now();
    let grant: TokenGrant | null = null;
    let failure: unknown;
    try {
      grant = await this.gateway.refresh(refreshToken);
    } catch (error) {
      failure = error;
    }

    // Hubo cierre o un inicio nuevo mientras tanto: el resultado es obsoleto y no se guarda.
    if (epoch !== this.epoch || this.active === null) return;

    if (grant === null) {
      this.refreshState = applyAuthEvent(this.refreshState, { type: 'refreshFailed', generation: generation + 1 });
      recordTelemetry(this.telemetry, {
        event: 'session.refresh.failed',
        status: 'error',
        durationMs: this.clock.now() - startedAt,
        generation,
        error: failure,
      });
      await this.close('expired');
      return;
    }

    const sharedRequests = this.refreshState.pendingRequestIds.size;
    this.refreshState = applyAuthEvent(this.refreshState, {
      type: 'refreshSucceeded',
      generation: generation + 1,
      token: grant.accessToken,
    });
    this.active = {
      session: this.active.session,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: this.clock.now() + grant.expiresInMs,
    };
    this.refreshInFlight = null;

    try {
      await this.persist(this.active);
    } catch {
      if (epoch === this.epoch) await this.close('expired');
      return;
    }
    if (epoch !== this.epoch) {
      // La sesión se cerró mientras se guardaba: no debe quedar nada persistido.
      await this.clearStore();
      return;
    }

    recordTelemetry(this.telemetry, {
      event: 'session.refresh.succeeded',
      status: 'ok',
      durationMs: this.clock.now() - startedAt,
      generation: generation + 1,
      sharedRequests,
    });
  }

  private persist(active: ActiveSession): Promise<void> {
    return this.store.save({
      actorId: active.session.actorId,
      role: active.session.role,
      accessToken: active.accessToken,
      refreshToken: active.refreshToken,
      expiresAt: active.expiresAt,
    });
  }

  private async clearStore(): Promise<void> {
    try {
      await this.store.clear();
    } catch {
      // El estado en memoria ya es anónimo; restore() descarta lo que quede vencido.
    }
  }

  /** Regreso al estado no autenticado: se olvidan los tokens en memoria y en el dispositivo. */
  private async close(reason: 'initial' | 'logout' | 'expired'): Promise<void> {
    this.epoch += 1;
    this.active = null;
    this.refreshInFlight = null;
    if (!this.refreshState.sessionClosed) this.refreshState = initialRefreshState;
    await this.clearStore();
    this.publish({ status: 'anonymous', reason });
  }

  private publish(snapshot: SessionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
