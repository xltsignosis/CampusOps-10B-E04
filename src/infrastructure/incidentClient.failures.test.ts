/**
 * Semana 5 — matriz de fallos con dobles predecibles (sin red).
 * Cada stub reproduce el status y el cuerpo crudo que devuelve course-backend/campusops.mjs
 * para la variante indicada de X-Course-Scenario. Sólo datos ficticios.
 */
import { IncidentClient, IncidentClientError } from './incidentClient';

const TOKEN = 'course-valid-token';
const ACTOR = 'reporter-1';

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
    notes: [],
    evidence: [],
    history: [],
  },
};

/** Respuesta con el cuerpo crudo del backend; json() falla igual que con JSON roto real. */
function backendResponse(status: number, rawBody: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve().then(() => JSON.parse(rawBody) as unknown),
  } as unknown as Response;
}

function clientReturning(status: number, body: unknown, timeoutMs = 1_000) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const fetchImpl = jest.fn().mockResolvedValue(backendResponse(status, raw)) as jest.MockedFunction<typeof fetch>;
  return { client: new IncidentClient({ fetchImpl, timeoutMs }), fetchImpl };
}

/** Doble que tarda `delayMs` en responder y respeta la cancelación por AbortSignal. */
function slowClient(delayMs: number, timeoutMs: number, body: unknown) {
  const fetchImpl = jest.fn((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(backendResponse(200, JSON.stringify(body))), delayMs);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      });
    })) as jest.MockedFunction<typeof fetch>;
  return new IncidentClient({ fetchImpl, timeoutMs });
}

async function captureError(promise: Promise<unknown>): Promise<IncidentClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(IncidentClientError);
    return error as IncidentClientError;
  }
  throw new Error('se esperaba un rechazo');
}

function expectSanitized(error: IncidentClientError) {
  for (const sensitive of [TOKEN, ACTOR, 'Edificio de prueba A', 'technician-1', 'Sin conexión']) {
    expect(error.message).not.toContain(sensitive);
  }
}

describe('fm-01 success: respuesta válida', () => {
  test('lista, detalle y creación devuelven objetos de aplicación sin campos extra del DTO', async () => {
    const list = await clientReturning(200, { items: [incident] }).client.getIncidents();
    const detail = await clientReturning(200, incident).client.getIncident('campus-inc-001');
    const created = await clientReturning(201, {
      incident: { ...incident, id: 'campus-inc-101', status: 'open' },
      operationId: 'create-fm-01',
      duplicate: false,
    }).client.createIncident(
      { category: 'connectivity', description: 'Falla ficticia', location: 'Laboratorio A' },
      'create-fm-01',
    );

    expect(list).toHaveLength(1);
    expect(detail).toEqual(list[0]);
    expect(Object.keys(detail?.details ?? {})).not.toContain('history');
    expect(created).toMatchObject({ id: 'campus-inc-101', status: 'open' });
  });
});

describe('fm-02 nullable: payload null permitido', () => {
  test('lista y detalle conservan details null sin inventar datos ni marcar error', async () => {
    const list = await clientReturning(200, { items: [{ ...incident, payload: null }] }).client.getIncidents();
    const detail = await clientReturning(200, { ...incident, payload: null }).client.getIncident('campus-inc-001');

    expect(list).toEqual([{ id: 'campus-inc-001', version: 1, status: 'assigned', details: null }]);
    expect(detail).toEqual({ id: 'campus-inc-001', version: 1, status: 'assigned', details: null });
  });
});

describe('fm-03 malformed: cuerpo JSON roto del backend', () => {
  test('el cuerpo literal \'{"items": [}\' se rechaza como contract', async () => {
    const error = await captureError(clientReturning(200, '{"items": [}').client.getIncidents());
    expect(error.kind).toBe('contract');
    expectSanitized(error);
  });
});

describe('fm-04 DTO corrupto: el sobre no cumple el contrato', () => {
  test.each([
    ['version textual', { ...incident, version: '1' }],
    ['id vacío', { ...incident, id: '' }],
    ['versión negativa', { ...incident, version: -1 }],
    ['payload arreglo', { ...incident, payload: [] }],
    ['sin status', { id: incident.id, version: 1, payload: incident.payload }],
    ['elemento null', null],
  ])('%s → contract', async (_name, item) => {
    const error = await captureError(clientReturning(200, { items: [item] }).client.getIncidents());
    expect(error.kind).toBe('contract');
  });

  test('una lista sin items → contract', async () => {
    const error = await captureError(clientReturning(200, { data: [incident] }).client.getIncidents());
    expect(error.kind).toBe('contract');
  });

  test('una creación sin incident → contract', async () => {
    const error = await captureError(
      clientReturning(201, { operationId: 'create-fm-04' }).client.createIncident(
        { category: 'water', description: 'Fuga ficticia', location: 'Edificio B' },
        'create-fm-04',
      ),
    );
    expect(error.kind).toBe('contract');
  });
});

describe('fm-05 dominio inválido: sobre válido, incidencia inválida', () => {
  test.each([
    ['estado fuera del flujo', { ...incident, status: 'archived' }],
    ['categoría desconocida', { ...incident, payload: { ...incident.payload, category: 'plumbing' } }],
    ['sin prioridad', { ...incident, payload: { ...incident.payload, priority: undefined } }],
    ['ubicación no textual', { ...incident, payload: { ...incident.payload, location: { lat: 0 } } }],
  ])('%s pasa parseRemoteResource pero el cliente lo rechaza → contract', async (_name, item) => {
    const error = await captureError(clientReturning(200, item).client.getIncident('campus-inc-001'));
    expect(error.kind).toBe('contract');
  });
});

describe('fm-06 slow: respuesta lenta', () => {
  test('si excede timeoutMs se aborta y se representa como timeout', async () => {
    const error = await captureError(slowClient(200, 20, { items: [incident] }).getIncidents());
    expect(error.kind).toBe('timeout');
  });

  test('límite: si llega antes de timeoutMs se acepta normalmente', async () => {
    await expect(slowClient(10, 500, { items: [incident] }).getIncidents()).resolves.toHaveLength(1);
  });
});

describe('fm-07 server_error / rate_limited / rechazos HTTP', () => {
  test('500 controlled_failure → server con status 500', async () => {
    const error = await captureError(clientReturning(500, { code: 'controlled_failure' }).client.getIncidents());
    expect(error).toMatchObject({ kind: 'server', status: 500 });
    expect(error.message).not.toContain('controlled_failure');
  });

  test('429 rate_limited → http con status 429 (no se confunde con server)', async () => {
    const error = await captureError(clientReturning(429, { code: 'rate_limited' }).client.getIncidents());
    expect(error).toMatchObject({ kind: 'http', status: 429 });
  });

  test('401 unauthorized → http con status 401', async () => {
    const error = await captureError(clientReturning(401, { code: 'unauthorized' }).client.getIncidents());
    expect(error).toMatchObject({ kind: 'http', status: 401 });
  });

  test('404 en detalle → null (no encontrada), no excepción', async () => {
    await expect(clientReturning(404, { code: 'not_found' }).client.getIncident('campus-inc-999')).resolves.toBeNull();
  });

  test('404 en la lista sí es error http', async () => {
    const error = await captureError(clientReturning(404, { code: 'not_found' }).client.getIncidents());
    expect(error).toMatchObject({ kind: 'http', status: 404 });
  });
});

describe('fm-08 red: fetch falla sin respuesta', () => {
  test('una conexión rechazada → network, sin filtrar el error original', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(
      new TypeError(`connect ECONNREFUSED 127.0.0.1:4310 Bearer ${TOKEN}`),
    ) as jest.MockedFunction<typeof fetch>;
    const error = await captureError(new IncidentClient({ fetchImpl }).getIncidents());
    expect(error.kind).toBe('network');
    expectSanitized(error);
    expect(error.message).not.toContain('ECONNREFUSED');
  });
});

describe('fm-09 ninguna excepción sin controlar', () => {
  const cases: readonly [string, () => IncidentClient][] = [
    ['malformed', () => clientReturning(200, '{"items": [}').client],
    ['server_error', () => clientReturning(500, { code: 'controlled_failure' }).client],
    ['rate_limited', () => clientReturning(429, { code: 'rate_limited' }).client],
    ['slow', () => slowClient(200, 20, { items: [incident] })],
    ['dto corrupto', () => clientReturning(200, { items: [{ ...incident, version: '1' }] }).client],
  ];

  test.each(cases)('%s: getIncidents rechaza sólo con IncidentClientError tipado', async (_name, build) => {
    const error = await captureError(build().getIncidents());
    expect(['contract', 'timeout', 'network', 'server', 'http']).toContain(error.kind);
    expectSanitized(error);
  });
});
