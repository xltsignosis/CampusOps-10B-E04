import { IncidentClient, IncidentClientError } from './incidentClient';

const validIncident = {
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

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function fetchReturning(result: Response): jest.MockedFunction<typeof fetch> {
  return jest.fn().mockResolvedValue(result) as jest.MockedFunction<typeof fetch>;
}

test('consulta la lista mediante el cliente y separa el DTO del objeto de aplicación', async () => {
  const fetchImpl = fetchReturning(response({ items: [validIncident] }));
  const client = new IncidentClient({ baseUrl: 'http://backend.test', fetchImpl });

  await expect(client.getIncidents()).resolves.toEqual([
    {
      id: 'campus-inc-001',
      version: 1,
      status: 'assigned',
      details: {
        category: 'connectivity',
        description: 'Sin conexión en laboratorio ficticio',
        location: 'Edificio de prueba A',
        reporterId: 'reporter-1',
        assignedTechnicianId: 'technician-1',
        priority: 'medium',
      },
    },
  ]);
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://backend.test/v1/incidents',
    expect.objectContaining({ method: 'GET', signal: expect.anything() }),
  );
});

test('conserva payload null como ausencia válida sin inventar datos', async () => {
  const fetchImpl = fetchReturning(response({
    items: [{ ...validIncident, payload: null }],
  }));
  const client = new IncidentClient({ fetchImpl });

  const result = await client.getIncidents();
  expect(result[0]).toEqual({
    id: 'campus-inc-001',
    version: 1,
    status: 'assigned',
    details: null,
  });
});

test('rechaza un DTO malformado antes de devolverlo', async () => {
  const fetchImpl = fetchReturning(response({
    items: [{ ...validIncident, version: '1' }],
  }));
  const client = new IncidentClient({ fetchImpl });

  await expect(client.getIncidents()).rejects.toMatchObject({ kind: 'contract' });
});

test('distingue un error de servidor', async () => {
  const client = new IncidentClient({ fetchImpl: fetchReturning(response({ code: 'controlled_failure' }, 500)) });

  await expect(client.getIncidents()).rejects.toEqual(
    expect.objectContaining<Partial<IncidentClientError>>({ kind: 'server', status: 500 }),
  );
});

test('crea mediante POST con autenticación y clave de idempotencia', async () => {
  const fetchImpl = fetchReturning(response({ incident: validIncident }, 201));
  const client = new IncidentClient({ baseUrl: 'http://backend.test/', fetchImpl });

  await client.createIncident(
    { category: 'connectivity', description: 'Falla ficticia', location: 'Laboratorio A' },
    'create-001',
  );

  expect(fetchImpl).toHaveBeenCalledWith(
    'http://backend.test/v1/incidents',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer course-valid-token',
        'X-Course-Actor': 'reporter-1',
        'Idempotency-Key': 'create-001',
      }),
      body: JSON.stringify({
        category: 'connectivity',
        description: 'Falla ficticia',
        location: 'Laboratorio A',
      }),
    }),
  );
});

test('aborta y representa una respuesta lenta como timeout', async () => {
  const fetchImpl = jest.fn((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as jest.MockedFunction<typeof fetch>;
  const client = new IncidentClient({ fetchImpl, timeoutMs: 5 });

  await expect(client.getIncidents()).rejects.toMatchObject({ kind: 'timeout' });
});
