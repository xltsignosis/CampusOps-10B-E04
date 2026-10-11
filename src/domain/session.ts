import type { CampusRole } from '../campusops/contracts';

/** Lo que la app conoce de quien inició sesión. Los tokens no forman parte de este objeto. */
export type Session = Readonly<{
  actorId: string;
  role: CampusRole;
}>;

export type TokenGrant = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresInMs: number;
}>;

export type LoginGrant = Session & TokenGrant;

/** Sesión tal como se guarda en el almacenamiento seguro del dispositivo. */
export type StoredSession = Session &
  Readonly<{
    accessToken: string;
    refreshToken: string;
    /** Milisegundos del reloj de la app en que vence el token de acceso. */
    expiresAt: number;
  }>;

/** Puerto hacia el servicio de sesión (login y renovación). */
export interface SessionGateway {
  login(actorId: string): Promise<LoginGrant>;
  refresh(refreshToken: string): Promise<TokenGrant>;
}

/** Puerto hacia el almacenamiento seguro de la sesión. */
export interface SessionStore {
  save(session: StoredSession): Promise<void>;
  load(): Promise<StoredSession | null>;
  clear(): Promise<void>;
}

/** Reloj inyectable para comprobar la expiración sin esperas reales. */
export interface Clock {
  now(): number;
}

export type RequestCredentials = Readonly<{
  accessToken: string;
  actorId: string;
  /** Generación del token con que se envía la solicitud. */
  generation: number;
}>;

/** Puerto que usa el cliente HTTP para autenticar solicitudes y reaccionar a un 401. */
export interface RequestAuthorizer {
  authorize(requestId: string): Promise<RequestCredentials>;
  /** Devuelve true si la solicitud puede reintentarse una vez con el token vigente. */
  onUnauthorized(requestId: string, generation: number): Promise<boolean>;
}

export type SessionSnapshot =
  | Readonly<{ status: 'authenticated'; session: Session }>
  | Readonly<{ status: 'anonymous'; reason: 'initial' | 'logout' | 'expired' }>;

/** Puerto que consume la interfaz; no expone tokens. */
export interface SessionController {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
  restore(): Promise<SessionSnapshot>;
  login(actorId: string): Promise<Session>;
  logout(): Promise<void>;
}

/**
 * - unauthenticated: no hay sesión iniciada.
 * - invalid_credentials: el servicio rechazó el inicio de sesión.
 * - expired: la sesión venció y no pudo renovarse.
 * - unavailable: el servicio de sesión no respondió o respondió algo inválido.
 */
export type SessionErrorKind = 'unauthenticated' | 'invalid_credentials' | 'expired' | 'unavailable';

export class SessionError extends Error {
  readonly kind: SessionErrorKind;
  /** Lo usa la telemetría sanitizada, que conserva `code` y descarta `message`. */
  readonly code: SessionErrorKind;

  constructor(kind: SessionErrorKind) {
    super(`Sesión: ${kind}`);
    this.name = 'SessionError';
    this.kind = kind;
    this.code = kind;
  }
}
