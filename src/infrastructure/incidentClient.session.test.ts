/**
 * Semana 6 — el cliente de incidencias con la sesión real de la app y un fetch doble:
 * varias solicitudes reciben 401 a la vez y comparten una sola renovación.
 */
import { SessionManager } from '../application/session/sessionManager';
import type { TokenGrant } from '../domain/session';
import { deferred, FakeClock, FakeSessionGateway, MemorySessionStore, tokenGrant } from '../testing/sessionDoubles';

import { IncidentClient, IncidentClientError } from './incidentClient';

const incident = {
  id: 'campus-inc-001',
  version: 1,
  status: 'assigned',
  payload: {
    category: 'connectivity',
    description: 'Sin conexión en laboratorio ficticio',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
    priority: 'medium',
  },
};

type Call = Readonly<{ url: string; method: string; authorization: string; actor: string; key: string | undefined }>;

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** Backend doble: sólo acepta los tokens indicados; cualquier otro recibe 401. */
function backendAccepting(validTokens: readonly string[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.Authorization ?? '',
      actor: headers['X-Course-Actor'] ?? '',
      key: headers['Idempotency-Key'],
    };
    calls.push(call);
    if (!validTokens.some((token) => call.authorization === `Bearer ${token}`)) {
      return response(401, { code: 'unauthorized' });
    }
    return call.method === 'POST'
      ? response(201, { incident, operationId: call.key, duplicate: false })
      : response(200, { items: [incident] });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function setup(validTokens: readonly string[]) {
  const gateway = new FakeSessionGateway();
  const store = new MemorySessionStore();
  const manager = new SessionManager({ gateway, store, clock: new FakeClock() });
  const backend = backendAccepting(validTokens);
  const client = new IncidentClient({ baseUrl: 'http://backend.test', fetchImpl: backend.fetchImpl, auth: manager });
  await manager.login('technician-1');
  return { gateway, store, manager, client, calls: backend.calls };
}

test('conc-client-three-401: tres consultas con 401 → una renovación y un reintento por consulta', async () => {
  const { gateway, manager, client, calls } = await setup(['course-token-g1']);
  const pending = deferred<TokenGrant>();
  gateway.refreshImpl = () => pending.promise;

  const results = Promise.all([client.getIncidents(), client.getIncidents(), client.getIncidents()]);
  await new Promise((done) => setTimeout(done, 0));

  // Las tres ya recibieron 401 y esperan la misma renovación; nadie reintentó todavía.
  expect(calls).toHaveLength(3);
  expect(gateway.refreshCalls).toHaveLength(1);

  pending.resolve(tokenGrant(1));
  const lists = await results;

  expect(lists.map((list) => list.map((item) => item.id))).toEqual([
    ['campus-inc-001'],
    ['campus-inc-001'],
    ['campus-inc-001'],
  ]);
  expect(gateway.refreshCalls).toHaveLength(1);
  expect(calls.map((call) => call.authorization)).toEqual([
    'Bearer course-token-g0',
    'Bearer course-token-g0',
    'Bearer course-token-g0',
    'Bearer course-token-g1',
    'Bearer course-token-g1',
    'Bearer course-token-g1',
  ]);
  expect(manager.getRefreshStats()).toEqual({ refreshCalls: 1, retriedRequests: 3, generation: 1 });
});

test('conc-client-no-loop: si el backend sigue respondiendo 401, cada consulta se envía dos veces y termina', async () => {
  const { gateway, manager, client, calls } = await setup([]);

  const results = await Promise.allSettled([client.getIncidents(), client.getIncidents(), client.getIncidents()]);

  for (const result of results) {
    expect(result.status).toBe('rejected');
    expect((result as PromiseRejectedResult).reason).toMatchObject({ kind: 'http', status: 401 });
  }
  expect(calls).toHaveLength(6);
  expect(gateway.refreshCalls).toHaveLength(1);
  expect(manager.getRefreshStats().refreshCalls).toBe(1);
});

test('conc-client-refresh-failed: si la renovación falla no hay reintentos y la sesión queda cerrada', async () => {
  const { gateway, store, manager, client, calls } = await setup(['course-token-g1']);
  gateway.refreshImpl = async () => {
    throw new Error('invalid_grant');
  };

  const results = await Promise.allSettled([client.getIncidents(), client.getIncidents(), client.getIncidents()]);

  expect(results.every((result) => result.status === 'rejected')).toBe(true);
  expect(calls).toHaveLength(3);
  expect(gateway.refreshCalls).toHaveLength(1);
  expect(manager.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
  expect(store.value).toBeNull();
});

test('auth-client-after-logout: sin sesión el cliente no envía la solicitud', async () => {
  const { manager, client, calls } = await setup(['course-token-g0']);
  await expect(client.getIncidents()).resolves.toHaveLength(1);
  await manager.logout();

  const error = await client.getIncidents().catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(IncidentClientError);
  expect(error).toMatchObject({ kind: 'http', status: 401 });
  expect((error as IncidentClientError).message).not.toContain('course-token');
  expect(calls).toHaveLength(1);
});

test('conc-client-retry-keeps-key: el reintento de una escritura conserva actor y clave de idempotencia', async () => {
  const { client, calls } = await setup(['course-token-g1']);

  await client.performAction('campus-inc-001', 1, { action: 'start' }, 'start-key-0001');

  expect(calls).toEqual([
    {
      url: 'http://backend.test/v1/incidents/campus-inc-001/actions',
      method: 'POST',
      authorization: 'Bearer course-token-g0',
      actor: 'technician-1',
      key: 'start-key-0001',
    },
    {
      url: 'http://backend.test/v1/incidents/campus-inc-001/actions',
      method: 'POST',
      authorization: 'Bearer course-token-g1',
      actor: 'technician-1',
      key: 'start-key-0001',
    },
  ]);
});
