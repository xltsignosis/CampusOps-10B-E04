/** @jest-environment node */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { selectIncidentLocation } from '../application/selectIncidentLocation';
import { nodeHttpFetch, startLocalBackend } from '../testing/localBackend';
import { GeocodingClient } from './geocodingClient';

const observations: Record<string, unknown> = {};
afterAll(() => { if (process.env.CAMPUSOPS_FAULT_OBSERVATIONS) writeFileSync(join(process.env.CAMPUSOPS_FAULT_OBSERVATIONS, 'location.json'), JSON.stringify(observations)); });
const valid = { label: 'Zona ficticia', latitude: 0, longitude: 0 };
const manual = { source: 'manual', label: 'Edificio ficticio E04' };
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body }) as Response;

test.each([null, [], {}, { label: 'Incompleta' }, { ...valid, latitude: 91 }, { ...valid, longitude: -181 },
  { ...valid, latitude: NaN }, { ...valid, longitude: Infinity }, { ...valid, latitude: '0' },
  { ...valid, label: ' ' }, { ...valid, status: 429 }, { ...valid, error: 'failure' }])(
  'location-validation: datos inválidos %j conservan la referencia sin coordenadas', (value) => {
    expect(selectIncidentLocation(value, manual.label)).toEqual(manual);
  });
test('location-zero: acepta cero y límites inclusivos', () => {
  expect(selectIncidentLocation(valid, manual.label)).toEqual({ source: 'provider', ...valid });
  expect(selectIncidentLocation({ ...valid, latitude: -90, longitude: 180 }, manual.label).source).toBe('provider');
});
test('location-cache: normalización, TTL exacto, expulsión y limpieza', async () => {
  let now = 0;
  const fetchImpl = jest.fn(async () => response(valid));
  const client = new GeocodingClient({ fetchImpl, clock: { now: () => now }, cacheTtlMs: 10, maxCacheEntries: 2 });
  await client.resolve(' A ', manual.label);
  await client.resolve('a', manual.label);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  now = 10;
  await client.resolve('a', manual.label);
  await client.resolve('b', manual.label);
  await client.resolve('c', manual.label);
  await client.resolve('a', manual.label);
  expect(fetchImpl).toHaveBeenCalledTimes(5);
  client.clearCache();
  await client.resolve('a', manual.label);
  expect(fetchImpl).toHaveBeenCalledTimes(6);
  observations.cache = { clock: 'virtual', ttlMs: 10, limit: 2, requests: fetchImpl.mock.calls.length, hitAvoidedRequest: true, expiredAtExactTtl: true, eviction: true, clear: true };
});
test('location-no-cache: fallos y manual no se guardan como éxito; consulta vacía no envía', async () => {
  const fetchImpl = jest.fn(async () => response({}, 429));
  const client = new GeocodingClient({ fetchImpl });
  expect(await client.resolve('a', manual.label)).toEqual(manual);
  expect(await client.resolve('a', 'Otra zona ficticia')).toEqual({ source: 'manual', label: 'Otra zona ficticia' });
  expect(await client.resolve('  ', manual.label)).toEqual(manual);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
test.each(['fetch', 'body'] as const)('location-deadline-%s: plazo completo aun si el transporte ignora abort', async (stage) => {
  jest.useFakeTimers();
  try {
    const never = () => new Promise<never>(() => undefined);
    const fetchImpl = jest.fn(stage === 'fetch' ? never : async () => ({ ...response(valid), json: never }));
    const pending = new GeocodingClient({ fetchImpl, timeoutMs: 100 }).resolve('a', manual.label);
    await jest.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual(manual);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
test.each([0, -1, Infinity, NaN, 2_147_483_648])('location-config: rechaza timeout inválido %s', (timeoutMs) => {
  expect(() => new GeocodingClient({ timeoutMs })).toThrow();
});
test('location-photon: transforma longitud/latitud sin filtrar credenciales del curso', async () => {
  const auth = { authorize: jest.fn(), onUnauthorized: jest.fn() };
  const fetchImpl = jest.fn(async () => response({ features: [{ geometry: { type: 'Point', coordinates: [-99, 19] }, properties: { name: 'Referencia pública' } }] }));
  const result = await new GeocodingClient({ provider: 'photon', auth, fetchImpl }).resolve('Referencia pública', manual.label);
  expect(result).toEqual({ source: 'provider', label: 'Referencia pública', latitude: 19, longitude: -99 });
  expect(auth.authorize).not.toHaveBeenCalled();
  const call = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(call[0]).toContain('https://photon.komoot.io/api/');
  expect(call[1].headers).toEqual({ Accept: 'application/json' });
  observations.photonContract = { coordinateOrder: 'longitude,latitude mapped correctly', courseCredentialsSent: false };
});
test.each([{ features: [] }, { features: [{ geometry: { type: 'LineString', coordinates: [0,0] } }] }, { features: [{ geometry: { type: 'Point', coordinates: [999,0] }, properties: { name: 'Inválida' } }] }])('location-photon-invalid: respuesta %j conserva manual', async (body) => {
  expect(await new GeocodingClient({ provider: 'photon', fetchImpl: async () => response(body) }).resolve('a', manual.label)).toEqual(manual);
});
test('location-http: éxito y fallos reales del doble controlado', async () => {
  const backend = await startLocalBackend();
  try {
    for (const scenario of ['success', 'incomplete', 'invalid_coordinates', 'malformed', 'rate_limited', 'server_error', 'slow']) {
      const started = Date.now();
      const result = await new GeocodingClient({ baseUrl: backend.baseUrl, scenario, fetchImpl: nodeHttpFetch, timeoutMs: scenario === 'slow' ? 80 : 1000 }).resolve('Zona ficticia E04', manual.label);
      expect(result).toEqual(scenario === 'success' ? { source: 'provider', label: 'Edificio de prueba A', latitude: 0, longitude: 0 } : manual);
      observations[scenario] = { source: result.source, hasCoordinates: 'latitude' in result, durationMs: Date.now() - started, clock: 'real' };
    }
  } finally { backend.stop(); }
});
test('location-disconnect: un socket desconectado conserva la captura manual', async () => {
  const server = createServer((req) => { req.socket.destroy(); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const address = server.address() as { port: number };
    expect(await new GeocodingClient({ baseUrl: 'http://127.0.0.1:' + address.port, fetchImpl: nodeHttpFetch }).resolve('a', manual.label)).toEqual(manual);
    observations.disconnect = { source: 'manual', hasCoordinates: false, transport: 'real local socket disconnect' };
  } finally { await new Promise<void>((done) => server.close(() => done())); }
});
test('location-body-http: headers llegan pero el cuerpo no termina, se recupera en tiempo real', async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const address = server.address() as { port: number };
    const start = Date.now();
    expect(await new GeocodingClient({ baseUrl: 'http://127.0.0.1:' + address.port, fetchImpl: nodeHttpFetch, timeoutMs: 80 }).resolve('a', manual.label)).toEqual(manual);
    expect(Date.now() - start).toBeGreaterThanOrEqual(70);
    observations.bodyTimeout = { clock: 'real', timeoutMs: 80, elapsedMs: Date.now() - start, source: 'manual' };
  } finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
});

test('location-auth: el doble del curso conserva renovación y detiene cambio de actor', async () => {
  let generation = 0;
  const auth = { authorize: jest.fn(async () => ({ accessToken: 'synthetic-token-' + generation, actorId: 'reporter-1', generation })),
    onUnauthorized: jest.fn(async () => { generation++; return true; }) };
  const fetchImpl = jest.fn().mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response(valid));
  expect((await new GeocodingClient({ auth, fetchImpl }).resolve('a', manual.label)).source).toBe('provider');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[1]![1].headers.Authorization).toBe('Bearer synthetic-token-1');
  const changingAuth = { authorize: jest.fn().mockResolvedValueOnce({ accessToken: 'first', actorId: 'reporter-1', generation: 0 })
    .mockResolvedValueOnce({ accessToken: 'second', actorId: 'reporter-2', generation: 1 }), onUnauthorized: async () => true };
  const changedFetch = jest.fn(async () => response({}, 401));
  expect(await new GeocodingClient({ auth: changingAuth, fetchImpl: changedFetch }).resolve('a', manual.label)).toEqual(manual);
  expect(changedFetch).toHaveBeenCalledTimes(1);
});
