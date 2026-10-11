/**
 * Reglas de renovación de sesión de CampusOps. Las usa el SessionManager de la app
 * evento por evento y el adaptador de evaluación (src/course-evaluation) sobre una lista.
 */
export type AuthEvent = Readonly<{
  type: 'request401' | 'refreshSucceeded' | 'refreshFailed' | 'logout';
  requestId?: string;
  generation?: number;
  token?: string;
}>;

export type RefreshState = Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  persistedToken: string | null;
  refreshCalls: number;
  /** Generación que se está renovando; null cuando no hay renovación en curso. */
  refreshingGeneration: number | null;
  sessionClosed: boolean;
  pendingRequestIds: ReadonlySet<string>;
  retriedRequestIds: ReadonlySet<string>;
}>;

export type RefreshSummary = Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}>;

export const initialRefreshState: RefreshState = {
  status: 'anonymous',
  activeGeneration: null,
  persistedToken: null,
  refreshCalls: 0,
  refreshingGeneration: null,
  sessionClosed: false,
  pendingRequestIds: new Set<string>(),
  retriedRequestIds: new Set<string>(),
};

/** Estado de una sesión recién iniciada: el token del login es la generación 0. */
export function stateAfterLogin(token: string): RefreshState {
  return { ...initialRefreshState, status: 'authenticated', activeGeneration: 0, persistedToken: token };
}

function closeSession(state: RefreshState): RefreshState {
  return {
    ...state,
    status: 'anonymous',
    activeGeneration: null,
    persistedToken: null,
    refreshingGeneration: null,
    pendingRequestIds: new Set<string>(),
    sessionClosed: true,
  };
}

/** Agrupa los 401 de una generación y limita cada solicitud a un reintento. */
export function applyAuthEvent(state: RefreshState, event: AuthEvent): RefreshState {
  // No hay un evento de login en este contrato: el cierre es definitivo.
  if (state.sessionClosed) return state;

  switch (event.type) {
    case 'request401': {
      if (!event.requestId || state.retriedRequestIds.has(event.requestId)) return state;

      const generation: number = event.generation ?? state.activeGeneration ?? 0;
      const activeGeneration: number = state.activeGeneration ?? generation;
      const next: RefreshState =
        state.activeGeneration === null ? { ...state, activeGeneration, status: 'authenticated' } : state;

      // Un 401 tardío puede reintentarse con el token que ya se renovó.
      if (generation < activeGeneration && next.persistedToken !== null) {
        return { ...next, retriedRequestIds: new Set([...next.retriedRequestIds, event.requestId]) };
      }
      if (generation !== activeGeneration) return next;

      const pendingRequestIds = new Set([...next.pendingRequestIds, event.requestId]);
      if (next.refreshingGeneration !== null) return { ...next, pendingRequestIds };
      return { ...next, pendingRequestIds, refreshingGeneration: generation, refreshCalls: next.refreshCalls + 1 };
    }
    case 'refreshSucceeded': {
      if (state.refreshingGeneration === null || !event.token) return state;

      const generation: number = event.generation ?? state.refreshingGeneration + 1;
      // Solo la respuesta del refresh vigente puede reemplazar el token.
      if (generation !== state.refreshingGeneration + 1) return state;

      return {
        ...state,
        status: 'authenticated',
        activeGeneration: generation,
        persistedToken: event.token,
        retriedRequestIds: new Set([...state.retriedRequestIds, ...state.pendingRequestIds]),
        pendingRequestIds: new Set<string>(),
        refreshingGeneration: null,
      };
    }
    case 'refreshFailed': {
      if (state.refreshingGeneration === null) return state;
      // Los resultados identifican la generación esperada del nuevo token.
      if (event.generation !== undefined && event.generation !== state.refreshingGeneration + 1) return state;
      return closeSession(state);
    }
    case 'logout':
      return closeSession(state);
  }
}

export function summarizeRefresh(state: RefreshState): RefreshSummary {
  return {
    status: state.status,
    activeGeneration: state.activeGeneration,
    refreshCalls: state.refreshCalls,
    retriedRequestIds: [...state.retriedRequestIds],
    persistedToken: state.persistedToken,
  };
}

export function coordinateRefresh(events: readonly AuthEvent[]): RefreshSummary {
  return summarizeRefresh(events.reduce(applyAuthEvent, initialRefreshState));
}
