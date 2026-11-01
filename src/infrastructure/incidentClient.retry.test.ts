/** @jest-environment node */
import { writeFileSync } from 'node:fs';
import type { RequestAuthorizer, RequestCredentials } from '../domain/session';
import { SessionError } from '../domain/session';
import { nodeHttpFetch, startLocalBackend, type LocalBackend } from '../testing/localBackend';
import { IncidentClient } from './incidentClient';
import { InMemoryTelemetrySink } from './inMemoryTelemetrySink';

const observations: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.CAMPUSOPS_RETRY_OBSERVATIONS) {
    writeFileSync(process.env.CAMPUSOPS_RETRY_OBSERVATIONS, JSON.stringify(observations, null, 2));
  }
});

function response(status: number, body: unknown = { items: [] }, retryAfter?: string): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body,
    headers: { get: (name: string) => name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null },
  } as unknown as Response;
}

/** Esperas y duración de transporte observables con reloj virtual. No se usa red. */
function harness() {
  let now = Date.UTC(2026, 9, 31, 18);
  const sends: number[] = [];
  const delays: number[] = [];
  const telemetry = new InMemoryTelemetrySink();
  const fetchImpl = jest.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    sends.push(now);
    now += 7;
    return response(503);
  }) as jest.MockedFunction<typeof fetch>;
  const options = {
    fetchImpl, telemetry, clock: { now: () => now },
    wait: async (delayMs: number) => { delays.push(delayMs); now += delayMs; },
  };
  return { options, fetchImpl, delays, sends, telemetry,
    metrics: () => ({ clock: 'virtual', attempts: fetchImpl.mock.calls.length, delaysMs: delays,
      events: telemetry.getEvents() }),
  };
}

test('retry-bound: el cuarto fallo termina sin quinta solicitud ni cuarta espera', async () => {
  const h = harness();
  await expect(new IncidentClient(h.options).getIncidents()).rejects.toMatchObject({ status: 503 });
  expect(h.fetchImpl).toHaveBeenCalledTimes(4);
  expect(h.delays).toEqual([250, 500, 1000]);
  expect(h.sends.map((time) => time - h.sends[0]!)).toEqual([0, 257, 764, 1771]);
  observations.bounded = h.metrics();
});

test('retry-config: límites menores se aplican en el transporte real', async () => {
  const h = harness();
  const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 150 };
  await expect(new IncidentClient({ ...h.options, retryPolicy: policy }).getIncidents()).rejects.toMatchObject({ status: 503 });
  expect(h.fetchImpl).toHaveBeenCalledTimes(3);
  expect(h.delays).toEqual([100, 150]);
  observations.configured = h.metrics();
});

test.each([
  ['seconds', '2', 2000], ['date', 'Sat, 31 Oct 2026 18:00:03 GMT', 3000],
  ['invalid', '1.5', 250], ['past', 'Sat, 31 Oct 2026 17:59:59 GMT', 250],
] as const)('retry-after-%s: respeta encabezado en el cliente HTTP', async (id, header, expectedDelay) => {
  const h = harness();
  h.fetchImpl.mockResolvedValueOnce(response(429, {}, header)).mockResolvedValueOnce(response(200));
  await expect(new IncidentClient(h.options).getIncidents()).resolves.toEqual([]);
  expect(h.delays).toEqual([expectedDelay]);
  expect(h.fetchImpl).toHaveBeenCalledTimes(2);
  observations[`header-${id}`] = h.metrics();
});

test('retry-after-too-long: se informa el fallo sin adelantar el envío', async () => {
  const h = harness();
  h.fetchImpl.mockResolvedValue(response(503, {}, '11'));
  await expect(new IncidentClient(h.options).getIncidents()).rejects.toMatchObject({ status: 503, retryAfterMs: 11000 });
  expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  expect(h.delays).toEqual([]);
  observations.headerExceedsLimit = h.metrics();
});

test('retry-post-identity: sin clave válida no se envía ningún POST', async () => {
  const h = harness();
  const client = new IncidentClient(h.options);
  for (const key of ['', ' ', 'short', '       a']) {
    await expect(client.performAction('campus-inc-001', 3, { action: 'close' }, key)).rejects.toThrow('idempotencia');
    await expect(client.createIncident({ category: 'water', description: 'Ficticia', location: 'Zona' }, key)).rejects.toThrow('idempotencia');
  }
  expect(h.fetchImpl).not.toHaveBeenCalled();
  observations.missingIdentity = h.metrics();
});

test('retry-post-snapshot: misma clave y bytes aunque el borrador cambie durante el envío', async () => {
  const h = harness();
  const draft = { category: 'water', description: 'Diagnóstico ficticio', location: 'Zona ficticia' } as const;
  const mutable = { ...draft } as { category: 'water'; description: string; location: string };
  h.fetchImpl.mockImplementationOnce(async () => {
    mutable.description = 'Otro contenido';
    return response(503);
  }).mockResolvedValueOnce(response(201, { incident: { id: 'campus-inc-101', status: 'open', version: 1, payload: null } }));
  await new IncidentClient(h.options).createIncident(mutable, 'stable-creation-0001');
  const requests = h.fetchImpl.mock.calls.map((call) => call[1]!);
  expect(requests[0]!.body).toBe(JSON.stringify(draft));
  expect(requests[1]!.body).toBe(requests[0]!.body);
  expect(requests.map((item) => (item.headers as Record<string, string>)['Idempotency-Key']))
    .toEqual(['stable-creation-0001', 'stable-creation-0001']);
  observations.immutablePayload = { ...h.metrics(), sameBody: true, sameKey: true };
});

test('retry-network: la desconexión se acota y no registra el mensaje original', async () => {
  const h = harness();
  h.fetchImpl.mockRejectedValue(new Error('Bearer token-ficticio ubicación privada'));
  await expect(new IncidentClient(h.options).getIncidents()).rejects.toMatchObject({ kind: 'network' });
  expect(h.fetchImpl).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(h.telemetry.getEvents())).not.toContain('token-ficticio');
  observations.network = h.metrics();
});

test.each(['resolve', 'close'] as const)('retry-action-%s: conserva clave, contenido y versión base', async (action) => {
  const h = harness();
  const input = action === 'resolve' ? { action, diagnosis: 'Diagnóstico ficticio' } : { action };
  h.fetchImpl.mockRejectedValueOnce(new Error('Respuesta no disponible'))
    .mockResolvedValueOnce(response(200, {
      incident: { id: 'campus-inc-001', version: 4, status: 'closed', payload: null }, operationId: 'stable-action-0001',
    }));
  await new IncidentClient(h.options).performAction('campus-inc-001', 3, input, 'stable-action-0001');
  const first = h.fetchImpl.mock.calls[0]!;
  const retry = h.fetchImpl.mock.calls[1]!;
  expect(first[0]).toBe(retry[0]);
  expect(first[1]!.body).toBe(JSON.stringify({ ...input, baseVersion: 3 }));
  expect(retry[1]!.body).toBe(first[1]!.body);
  expect((retry[1]!.headers as Record<string, string>)['Idempotency-Key']).toBe('stable-action-0001');
  observations[`action-${action}`] = { ...h.metrics(), sameBody: true, sameKey: true, sameBaseVersion: true };
});

test.each([400, 403, 409, 422])('retry-definitive-%s: no reintentar rechazo del servidor', async (status) => {
  const h = harness();
  h.fetchImpl.mockResolvedValue(response(status));
  await expect(new IncidentClient(h.options).performAction('campus-inc-001', 3, { action: 'close' }, 'stable-close-0001'))
    .rejects.toMatchObject({ status });
  expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  expect(h.delays).toEqual([]);
});

test('retry-auth-budget: el reenvío por 401 consume el mismo máximo de cuatro envíos', async () => {
  const h = harness();
  h.fetchImpl.mockResolvedValueOnce(response(401)).mockResolvedValue(response(503));
  const auth: RequestAuthorizer = {
    authorize: async () => ({ actorId: 'technician-1', accessToken: 'token-ficticio', generation: 0 }),
    onUnauthorized: jest.fn(async () => true),
  };
  await expect(new IncidentClient({ ...h.options, auth }).getIncidents()).rejects.toMatchObject({ status: 503 });
  expect(h.fetchImpl).toHaveBeenCalledTimes(4);
  expect(auth.onUnauthorized).toHaveBeenCalledTimes(1);
  expect(h.delays).toEqual([500, 1000]);
  observations.authBudget = h.metrics();
});

test.each(['logout', 'actor-change'])('retry-session-%s: cancelar antes de reenviar si cambia la sesión', async (change) => {
  const h = harness();
  let credentials: RequestCredentials | null = { actorId: 'technician-1', accessToken: 'token-ficticio', generation: 0 };
  const auth: RequestAuthorizer = {
    authorize: async () => {
      if (!credentials) throw new SessionError('unauthenticated');
      return credentials;
    },
    onUnauthorized: async () => false,
  };
  const wait = async () => {
    credentials = change === 'logout' ? null : { actorId: 'technician-2', accessToken: 'otro-token', generation: 1 };
  };
  await expect(new IncidentClient({ ...h.options, auth, wait }).performAction('campus-inc-001', 3,
    { action: 'close' }, 'stable-close-0001')).rejects.toMatchObject({ status: 401 });
  expect(h.fetchImpl).toHaveBeenCalledTimes(1);
});

test('retry-sanitized: sólo metadatos técnicos; falla del registro no impide confirmar', async () => {
  const h = harness();
  h.fetchImpl.mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200, {
    incident: { id: 'campus-inc-001', status: 'resolved', version: 3, payload: null }, operationId: 'resolve-private-key',
  }));
  await new IncidentClient(h.options).performAction('campus-inc-001', 2,
    { action: 'resolve', diagnosis: 'Texto privado de diagnóstico' }, 'resolve-private-key');
  const serialized = JSON.stringify(h.telemetry.getEvents());
  for (const secret of ['Texto privado', 'resolve-private-key', 'course-valid-token', 'reporter-1', 'Authorization']) {
    expect(serialized).not.toContain(secret);
  }
  for (const event of h.telemetry.getEvents()) {
    expect(Object.keys(event as object).sort()).toEqual([
      'attempt', 'delayMs', 'durationMs', 'elapsedMs', 'event', 'method', 'outcome', 'retry', 'status',
    ]);
  }
  observations.sanitized = h.metrics();
  h.fetchImpl.mockResolvedValue(response(200));
  await expect(new IncidentClient({ ...h.options, telemetry: { record: () => { throw new Error('sink unavailable'); } } })
    .getIncidents()).resolves.toEqual([]);
});

test('retry-timers: timeout y esperas reales usan temporizadores; también se limita un cuerpo que no llega', async () => {
  jest.useFakeTimers();
  try {
    const telemetry = new InMemoryTelemetrySink();
    const fetchImpl = jest.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      ({ ...response(200), json: () => new Promise<never>(() => undefined) })) as jest.MockedFunction<typeof fetch>;
    const pending = new IncidentClient({ fetchImpl, timeoutMs: 100, telemetry }).getIncidents();
    const result = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await jest.advanceTimersByTimeAsync(99);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(249);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await jest.runAllTimersAsync();
    await result;
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
    observations.timeout = { clock: 'jest-fake-timers', attempts: fetchImpl.mock.calls.length, events: telemetry.getEvents() };
  } finally {
    jest.useRealTimers();
  }
});

describe('política contra el backend HTTP local con tiempo real', () => {
  let backend: LocalBackend;
  beforeAll(async () => { backend = await startLocalBackend(); });
  afterAll(() => backend?.stop());

  test('retry-http-header: se espera Retry-After real antes del segundo envío', async () => {
    const telemetry = new InMemoryTelemetrySink();
    const sentAt: number[] = [];
    const fetchImpl = (async (input, init) => {
      sentAt.push(Date.now());
      // Sólo el primer envío recibe la variante 429 del servidor.
      const headers = { ...init?.headers, 'X-Course-Scenario': sentAt.length === 1 ? 'rate_limited' : 'success' };
      return nodeHttpFetch(input, { ...init, headers });
    }) as typeof fetch;
    await expect(new IncidentClient({ baseUrl: backend.baseUrl, fetchImpl, telemetry }).getIncidents()).resolves.toHaveLength(1);
    expect(sentAt).toHaveLength(2);
    const gapMs = sentAt[1]! - sentAt[0]!;
    expect(gapMs).toBeGreaterThanOrEqual(1000);
    observations.httpRetryAfter = { clock: 'real', attempts: sentAt.length, gapMs, events: telemetry.getEvents() };
  });

});
