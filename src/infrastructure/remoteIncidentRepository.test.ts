import { IncidentSourceError } from '../domain/incident';
import { IncidentClient } from './incidentClient';
import { RemoteIncidentRepository } from './remoteIncidentRepository';

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

function repositoryReturning(status: number, body: unknown, timeoutMs = 1_000): RemoteIncidentRepository {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve().then(() => JSON.parse(raw) as unknown),
  }) as jest.MockedFunction<typeof fetch>;
  return new RemoteIncidentRepository(new IncidentClient({ fetchImpl, timeoutMs }));
}

test('convierte el objeto validado en Incident del dominio sin inventar la fecha', async () => {
  await expect(repositoryReturning(200, { items: [incident] }).getAll()).resolves.toEqual([
    {
      id: 'campus-inc-001',
      title: 'Sin conexión en laboratorio ficticio',
      description: 'Sin conexión en laboratorio ficticio',
      category: 'connectivity',
      status: 'assigned',
      priority: 'medium',
      location: { source: 'manual', label: 'Edificio de prueba A' },
      reportedAt: null,
      assignedTechnicianId: 'technician-1',
    },
  ]);
});

test('payload null se convierte en una entrada sin detalles, no en datos ficticios', async () => {
  await expect(repositoryReturning(200, { ...incident, payload: null }).getById('campus-inc-001')).resolves.toEqual({
    id: 'campus-inc-001',
    status: 'assigned',
    detailsAvailable: false,
  });
});

test('404 en detalle sigue siendo null para la app', async () => {
  await expect(repositoryReturning(404, { code: 'not_found' }).getById('campus-inc-999')).resolves.toBeNull();
});

test.each([
  ['respuesta malformada', 200, '{"items": [}', 'invalid_response'],
  ['error 500', 500, { code: 'controlled_failure' }, 'unavailable'],
  ['429 rate_limited', 429, { code: 'rate_limited' }, 'rejected'],
])('%s se traduce a IncidentSourceError(%s)', async (_name, status, body, kind) => {
  const failure = repositoryReturning(status, body).getAll();
  await expect(failure).rejects.toBeInstanceOf(IncidentSourceError);
  await expect(failure).rejects.toMatchObject({ kind });
});

test('timeout se traduce a IncidentSourceError(timeout)', async () => {
  const fetchImpl = jest.fn((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_done, fail) => {
      init?.signal?.addEventListener('abort', () => fail(new Error('aborted')));
    })) as jest.MockedFunction<typeof fetch>;
  const repository = new RemoteIncidentRepository(new IncidentClient({ fetchImpl, timeoutMs: 5 }));

  await expect(repository.getAll()).rejects.toMatchObject({ kind: 'timeout' });
});

test('un borrador inválido se rechaza sin llamar al backend', async () => {
  const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
  const repository = new RemoteIncidentRepository(new IncidentClient({ fetchImpl }));

  await expect(
    repository.create({ category: 'water', description: '   ', location: 'Edificio B' }, 'create-0001'),
  ).rejects.toMatchObject({ kind: 'rejected' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('crear devuelve la incidencia del dominio', async () => {
  const repository = repositoryReturning(201, {
    incident: { ...incident, id: 'campus-inc-101', status: 'open', payload: { ...incident.payload, assignedTechnicianId: null } },
    operationId: 'create-0002',
    duplicate: false,
  });

  await expect(
    repository.create({ category: 'connectivity', description: 'Falla ficticia', location: 'Edificio A' }, 'create-0002'),
  ).resolves.toMatchObject({ id: 'campus-inc-101', status: 'open', assignedTechnicianId: null });
});
