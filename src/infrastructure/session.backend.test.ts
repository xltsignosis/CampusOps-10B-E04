/**
 * @jest-environment node
 *
 * Semana 6 — sesión y autorización reales contra el backend didáctico local
 * (course-backend/server.mjs en 127.0.0.1). Actores y tokens son fixtures públicos.
 */
import { SessionManager } from '../application/session/sessionManager';
import { IncidentSourceError } from '../domain/incident';
import { SessionError } from '../domain/session';
import { EXPIRES_IN_MS, FakeClock, MemorySessionStore } from '../testing/sessionDoubles';
import { nodeHttpFetch, startLocalBackend, type LocalBackend } from '../testing/localBackend';

import { IncidentClient } from './incidentClient';
import { RemoteIncidentRepository } from './remoteIncidentRepository';
import { HttpSessionGateway } from './sessionGateway';

const INCIDENT = 'campus-inc-001';

let backend: LocalBackend;

beforeAll(async () => {
  backend = await startLocalBackend();
});

afterAll(() => {
  backend.stop();
});

/** Sesión + cliente reales; sólo el reloj y el almacenamiento son dobles. */
function stack(scenario?: string) {
  const paths: string[] = [];
  const countingFetch = ((input: string | URL | Request, init?: RequestInit) => {
    paths.push(new URL(String(input)).pathname);
    return nodeHttpFetch(input, init);
  }) as typeof fetch;
  const clock = new FakeClock();
  const store = new MemorySessionStore();
  const gateway = new HttpSessionGateway({
    baseUrl: backend.baseUrl,
    fetchImpl: countingFetch,
    timeoutMs: 3_000,
    ...(scenario ? { scenario } : {}),
  });
  const manager = new SessionManager({ gateway, store, clock });
  const client = new IncidentClient({ baseUrl: backend.baseUrl, fetchImpl: countingFetch, timeoutMs: 3_000, auth: manager });
  return { paths, clock, store, manager, client, repository: new RemoteIncidentRepository(client) };
}

async function loggedIn(actorId: string, scenario?: string) {
  const current = stack(scenario);
  await current.manager.login(actorId);
  return current;
}

const refreshCount = (paths: readonly string[]) => paths.filter((path) => path === '/v1/session/refresh').length;

describe('inicio de sesión contra el backend', () => {
  test.each([
    ['reporter-1', 'reporter'],
    ['technician-1', 'technician'],
    ['coordinator-1', 'coordinator'],
  ] as const)('be-login-%s: el backend entrega el perfil %s', async (actorId, role) => {
    const { manager, store } = stack();

    await expect(manager.login(actorId)).resolves.toEqual({ actorId, role });
    expect(store.value).toMatchObject({ actorId, role, expiresAt: EXPIRES_IN_MS });
  });

  test('be-login-unknown: un actor que no existe recibe 401 y no queda sesión', async () => {
    const { manager, store, client, paths } = stack();

    const error = await manager.login('intruso-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SessionError);
    expect(error).toMatchObject({ kind: 'invalid_credentials' });
    expect(store.value).toBeNull();
    await expect(client.getIncidents()).rejects.toMatchObject({ kind: 'http', status: 401 });
    expect(paths).toEqual(['/v1/session/login']);
  });
});

describe('expiración y renovación contra el backend', () => {
  test('be-refresh-shared: tres consultas con el token vencido hacen una sola renovación real', async () => {
    const { clock, client, manager, store, paths } = await loggedIn('technician-1');
    clock.advance(EXPIRES_IN_MS);

    const lists = await Promise.all([client.getIncidents(), client.getIncidents(), client.getIncidents()]);

    expect(lists.map((list) => list.map((item) => item.id))).toEqual([[INCIDENT], [INCIDENT], [INCIDENT]]);
    expect(refreshCount(paths)).toBe(1);
    expect(manager.getRefreshStats()).toEqual({ refreshCalls: 1, retriedRequests: 3, generation: 1 });
    expect(store.value).toMatchObject({ refreshToken: 'course-refresh-1', expiresAt: EXPIRES_IN_MS * 2 });
  });

  test('be-refresh-stale-token: el backend rechaza el token de renovación ya usado y la sesión se cierra', async () => {
    const { clock, client, manager, store, paths } = await loggedIn('technician-1');
    clock.advance(EXPIRES_IN_MS);
    await client.getIncidents();
    clock.advance(EXPIRES_IN_MS);

    // El simulador sólo acepta course-refresh-0: la segunda renovación recibe 401 invalid_grant.
    const results = await Promise.allSettled([client.getIncidents(), client.getIncidents()]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(refreshCount(paths)).toBe(2);
    expect(manager.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(store.value).toBeNull();

    // Sin sesión ya no se envía nada al backend.
    const sent = paths.length;
    await expect(client.getIncidents()).rejects.toMatchObject({ kind: 'http', status: 401 });
    expect(paths).toHaveLength(sent);
  });

  test('be-refresh-invalid: con la variante invalid_refresh la primera renovación falla y no hay reintentos', async () => {
    const { clock, client, manager, store, paths } = await loggedIn('coordinator-1', 'invalid_refresh');
    clock.advance(EXPIRES_IN_MS);

    await expect(client.getIncident(INCIDENT)).rejects.toMatchObject({ kind: 'http', status: 401 });

    expect(refreshCount(paths)).toBe(1);
    expect(paths.filter((path) => path.startsWith('/v1/incidents'))).toEqual([]);
    expect(manager.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(store.value).toBeNull();
  });
});

describe('cierre de sesión contra el backend', () => {
  test('be-logout: después de cerrar sesión no hay token guardado ni solicitudes al backend', async () => {
    const { client, manager, store, paths } = await loggedIn('reporter-1');
    await expect(client.getIncidents()).resolves.toHaveLength(1);

    await manager.logout();
    const sent = paths.length;

    expect(store.value).toBeNull();
    await expect(client.getIncidents()).rejects.toMatchObject({ kind: 'http', status: 401 });
    expect(paths).toHaveLength(sent);
  });
});

describe('autorización por perfil: la decide el backend, no la pantalla', () => {
  // Estas pruebas comparten el estado de campus-inc-001 y dependen del orden.
  test('be-authz-technician-not-assigned: technician-2 no puede iniciar ni resolver una incidencia ajena', async () => {
    const other = await loggedIn('technician-2');

    await expect(other.client.performAction(INCIDENT, 1, { action: 'start' }, 'authz-t2-start'))
      .rejects.toMatchObject({ kind: 'http', status: 403 });
    await expect(
      other.client.performAction(INCIDENT, 1, { action: 'resolve', diagnosis: 'Diagnóstico ficticio' }, 'authz-t2-resolve'),
    ).rejects.toMatchObject({ kind: 'http', status: 403 });

    const coordinator = await loggedIn('coordinator-1');
    await expect(coordinator.client.getIncident(INCIDENT)).resolves.toMatchObject({ version: 1, status: 'assigned' });
  });

  test('be-authz-close-needs-coordinator: reportante y técnico asignado no pueden cerrar ni reabrir', async () => {
    const reporter = await loggedIn('reporter-1');
    const technician = await loggedIn('technician-1');

    for (const action of ['close', 'reopen'] as const) {
      await expect(reporter.client.performAction(INCIDENT, 1, { action }, `authz-r1-${action}-01`))
        .rejects.toMatchObject({ kind: 'http', status: 403 });
      await expect(technician.client.performAction(INCIDENT, 1, { action }, `authz-t1-${action}-01`))
        .rejects.toMatchObject({ kind: 'http', status: 403 });
    }
    await expect(reporter.repository.perform(INCIDENT, 1, { action: 'close' }, 'authz-r1-close-02'))
      .rejects.toMatchObject({ kind: 'rejected', status: 403 });
  });

  test('be-authz-technician-resolves: el técnico asignado inicia y resuelve su incidencia', async () => {
    const technician = await loggedIn('technician-1');

    const started = await technician.client.performAction(INCIDENT, 1, { action: 'start' }, 'authz-t1-start-01');
    expect(started).toMatchObject({ version: 2, status: 'in_progress' });

    const resolved = await technician.repository.perform(
      INCIDENT,
      started.version,
      { action: 'resolve', diagnosis: 'Cable de red ficticio reemplazado' },
      'authz-t1-resolve-01',
    );
    expect(resolved).toMatchObject({ id: INCIDENT, status: 'resolved', version: 3 });
  });

  test('be-authz-reporter-cannot-coordinate: resuelta la incidencia, el reportante sigue sin poder cerrarla', async () => {
    const reporter = await loggedIn('reporter-1');

    const error = await reporter.repository
      .perform(INCIDENT, 3, { action: 'close' }, 'authz-r1-close-03')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncidentSourceError);
    expect(error).toMatchObject({ kind: 'rejected', status: 403 });
    await expect(reporter.client.getIncident(INCIDENT)).resolves.toMatchObject({ version: 3, status: 'resolved' });
  });

  test('be-authz-coordinator-closes-reopens: coordinación cierra y reabre', async () => {
    const coordinator = await loggedIn('coordinator-1');

    const closed = await coordinator.client.performAction(INCIDENT, 3, { action: 'close' }, 'authz-c1-close-01');
    expect(closed).toMatchObject({ version: 4, status: 'closed' });

    const reopened = await coordinator.client.performAction(INCIDENT, 4, { action: 'reopen' }, 'authz-c1-reopen-01');
    expect(reopened).toMatchObject({ version: 5, status: 'assigned' });
  });

  test('be-authz-visibility: reporter-2 no puede leer la incidencia de reporter-1', async () => {
    const stranger = await loggedIn('reporter-2');

    await expect(stranger.client.getIncident(INCIDENT)).rejects.toMatchObject({ kind: 'http', status: 403 });
    await expect(stranger.client.getIncidents()).resolves.toEqual([]);
  });

  test('be-authz-no-token: un token inválido recibe 401 aunque el actor exista', async () => {
    const client = new IncidentClient({
      baseUrl: backend.baseUrl,
      fetchImpl: nodeHttpFetch,
      actorId: 'coordinator-1',
      accessToken: 'token-invalido-ficticio',
    });

    await expect(client.getIncidents()).rejects.toMatchObject({ kind: 'http', status: 401 });
  });
});
