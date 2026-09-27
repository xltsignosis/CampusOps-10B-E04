/**
 * Semana 3 — controles del modelo de amenazas (docs/threat-model.md), ejecutables.
 * Usa únicamente datos ficticios: el backend didáctico en memoria y actores públicos de prueba.
 *
 * @jest-environment node
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { recordTelemetry } from '../../src/application/telemetry';
import { getIncidentDetail, getIncidentList } from '../../src/application/incidentUseCases';
import { redactForTelemetry } from '../../src/course-evaluation';
import type { Incident as DomainIncident, IncidentRepository } from '../../src/domain/incident';
import { InMemoryTelemetrySink } from '../../src/infrastructure/inMemoryTelemetrySink';

jest.setTimeout(30000);

const ROOT = resolve(__dirname, '..', '..');
const INCIDENT = 'campus-inc-001';

type Incident = {
  id: string;
  version: number;
  status: string;
  payload: { assignedTechnicianId: string | null; history: unknown[] };
};

let backend: ChildProcess | undefined;
let baseUrl = '';

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

// node:http en lugar de fetch: jest-expo sustituye el fetch global por un polyfill de Expo.
function call(path: string, actor: string, init: { body?: unknown; key?: string } = {}) {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolveCall, reject) => {
    const req = request(
      `${baseUrl}${path}`,
      {
        agent: false,
        method: payload === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer course-valid-token',
          'X-Course-Actor': actor,
          'Content-Type': 'application/json',
          ...(init.key ? { 'Idempotency-Key': init.key } : {}),
          ...(payload === undefined ? {} : { 'Content-Length': Buffer.byteLength(payload) }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolveCall({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const listedIds = (body: Record<string, unknown>) =>
  ((body.items ?? []) as Incident[]).map((item) => item.id);

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(ROOT, 'course-backend', 'server.mjs')], {
    env: { ...process.env, COURSE_BACKEND_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  backend = child;
  await new Promise<void>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('el backend didáctico no arrancó a tiempo')), 10000);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (String(chunk).includes('listening')) {
        clearTimeout(timer);
        ready();
      }
    });
    child.once('exit', (code) => reject(new Error(`el backend didáctico terminó antes de tiempo (código ${code})`)));
  });
});

afterAll(() => {
  backend?.kill();
});

describe('Amenaza 1 — consultar incidencias ajenas', () => {
  test('technician-2 no ve la incidencia asignada a technician-1 (lista y detalle)', async () => {
    const list = await call('/v1/incidents', 'technician-2');
    expect(list.status).toBe(200);
    expect(listedIds(list.body)).not.toContain(INCIDENT);

    const detail = await call(`/v1/incidents/${INCIDENT}`, 'technician-2');
    expect(detail.status).toBe(403);
    expect(detail.body).toEqual({ code: 'forbidden' });
  });

  test('reporter-2 no ve la incidencia reportada por reporter-1 (lista y detalle)', async () => {
    const list = await call('/v1/incidents', 'reporter-2');
    expect(list.status).toBe(200);
    expect(listedIds(list.body)).toEqual([]);

    const detail = await call(`/v1/incidents/${INCIDENT}`, 'reporter-2');
    expect(detail.status).toBe(403);
  });

  test('control positivo: el técnico asignado, el reportante y el coordinador sí la ven', async () => {
    for (const actor of ['technician-1', 'reporter-1', 'coordinator-1']) {
      const list = await call('/v1/incidents', actor);
      expect(list.status).toBe(200);
      expect(listedIds(list.body)).toContain(INCIDENT);
      expect((await call(`/v1/incidents/${INCIDENT}`, actor)).status).toBe(200);
    }
  });
});

describe('Amenaza 2 — alterar asignaciones', () => {
  const assign = { action: 'assign', baseVersion: 1, technicianId: 'technician-2' };

  test('technician-1 no puede reasignar la incidencia: 403 y el recurso queda intacto', async () => {
    const attempt = await call(`/v1/incidents/${INCIDENT}/actions`, 'technician-1', { body: assign, key: 'assign-by-technician' });
    expect(attempt.status).toBe(403);

    const after = (await call(`/v1/incidents/${INCIDENT}`, 'coordinator-1')).body as unknown as Incident;
    expect(after.version).toBe(1);
    expect(after.payload.assignedTechnicianId).toBe('technician-1');
    expect(after.payload.history).toEqual([]);
  });

  test('reporter-1 tampoco puede reasignar la incidencia', async () => {
    const attempt = await call(`/v1/incidents/${INCIDENT}/actions`, 'reporter-1', { body: assign, key: 'assign-by-reporter' });
    expect(attempt.status).toBe(403);
  });

  test('control positivo: coordinator-1 sí puede reasignar (queda historial)', async () => {
    const attempt = await call(`/v1/incidents/${INCIDENT}/actions`, 'coordinator-1', { body: assign, key: 'assign-by-coordinator' });
    expect(attempt.status).toBe(201);
    const incident = attempt.body.incident as Incident;
    expect(incident.version).toBe(2);
    expect(incident.payload.assignedTechnicianId).toBe('technician-2');
  });
});

describe('Amenaza 3 — datos sensibles en registros', () => {
  const sources = (): string[] => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(entry) ? [path] : [];
      });
    return [...walk(join(ROOT, 'src')), join(ROOT, 'App.tsx'), join(ROOT, 'index.ts')];
  };

  test('guarda provisional: el código de la app no escribe en consola', () => {
    const offenders = sources().filter((file) => /\bconsole\.(log|info|debug|warn|error|trace)\s*\(/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

});

describe('Amenaza 3 — sanitización de registros con redactForTelemetry (semana 4)', () => {
  // Valores ficticios: si alguno aparece en un registro, hubo filtración.
  const FAKE = {
    token: 'course-token-ficticio-t3',
    email: 'persona.ficticia@campusops.test',
    displayName: 'Persona Ficticia T3',
    location: 'Edificio ficticio T3 - Aula 0',
    technicianId: 'technician-ficticio-t3',
    comment: 'Comentario interno ficticio T3',
  };
  const leaked = (value: unknown) => Object.values(FAKE).filter((secret) => JSON.stringify(value).includes(secret));

  test('t3-nested-object: oculta claves sensibles en objetos anidados a varios niveles', () => {
    const result = redactForTelemetry({
      incidentId: 'campus-inc-001',
      session: { user: { profile: { email: FAKE.email, displayName: FAKE.displayName }, token: FAKE.token } },
      request: { headers: { authorization: `Bearer ${FAKE.token}`, accept: 'application/json' } },
    });
    expect(result).toEqual({
      incidentId: 'campus-inc-001',
      session: { user: { profile: { email: '[REDACTED]', displayName: '[REDACTED]' }, token: '[REDACTED]' } },
      request: { headers: { authorization: '[REDACTED]', accept: 'application/json' } },
    });
    expect(leaked(result)).toEqual([]);
  });

  test('t3-array-of-objects: recorre listas de incidencias y oculta cada elemento sensible', () => {
    const result = redactForTelemetry({
      items: [
        { incidentId: 'campus-inc-001', status: 'assigned', reporterId: 'reporter-1', location: FAKE.location },
        { incidentId: 'campus-inc-002', status: 'open', assignedTechnicianId: FAKE.technicianId, latitude: 19.4, longitude: -99.1 },
      ],
    });
    expect(result).toEqual({
      items: [
        { incidentId: 'campus-inc-001', status: 'assigned', reporterId: '[REDACTED]', location: '[REDACTED]' },
        { incidentId: 'campus-inc-002', status: 'open', assignedTechnicianId: '[REDACTED]', latitude: '[REDACTED]', longitude: '[REDACTED]' },
      ],
    });
  });

  test('t3-whole-value: una clave sensible oculta el valor completo aunque sea objeto o lista', () => {
    const result = redactForTelemetry({
      evidence: [{ evidenceId: 'synthetic-photo-1' }],
      assignmentHistory: [{ technicianId: 'technician-1', at: '2026-09-22T10:00:00Z' }],
      internalComments: [FAKE.comment],
    });
    expect(result).toEqual({ evidence: '[REDACTED]', assignmentHistory: '[REDACTED]', internalComments: '[REDACTED]' });
  });

  test('t3-key-normalization: normaliza mayúsculas, guiones y guiones bajos antes de comparar', () => {
    const result = redactForTelemetry({
      AUTHORIZATION: 'x',
      Access_Token: 'x',
      'refresh-token': 'x',
      assigned_technician_id: 'x',
      'User-Id': 'x',
      PASSWORD: 'x',
    });
    expect(Object.values(result as Record<string, unknown>)).toEqual(Array(6).fill('[REDACTED]'));
  });

  test('t3-technical-context-kept: conserva el contexto técnico seguro del contrato', () => {
    const technical = { incidentId: 'campus-inc-001', correlationId: 'corr-42', status: 'error', attempt: 2, durationMs: 18 };
    expect(redactForTelemetry({ ...technical, token: FAKE.token })).toEqual({ ...technical, token: '[REDACTED]' });
    expect(redactForTelemetry([1, 'texto', null, true])).toEqual([1, 'texto', null, true]);
  });

  test('t3-no-mutation: no modifica la entrada original y devuelve copias nuevas en cada nivel', () => {
    const input = {
      incidentId: 'campus-inc-001',
      profile: { email: FAKE.email, tags: ['a', 'b'] },
      items: [{ location: FAKE.location, status: 'open' }],
    };
    const snapshot = structuredClone(input);
    const result = redactForTelemetry(input) as typeof input;
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
    expect(result.profile).not.toBe(input.profile);
    expect(result.profile.tags).not.toBe(input.profile.tags);
    expect(result.items).not.toBe(input.items);
    expect(result.items[0]).not.toBe(input.items[0]);
  });

  test('t3-circular-boundary: una referencia circular no provoca excepción ni bucle y el resultado es serializable', () => {
    const input: Record<string, unknown> = { incidentId: 'campus-inc-001', token: FAKE.token };
    input.self = input;
    const result = redactForTelemetry(input);
    expect(result).toEqual({ incidentId: 'campus-inc-001', token: '[REDACTED]', self: '[Circular]' });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test('t3-error-object: un Error se reduce a tipo y código, sin message ni stack con datos', () => {
    const error = Object.assign(new TypeError(`fallo con Bearer ${FAKE.token} de ${FAKE.email}`), { code: 'E_REPO' });
    const result = redactForTelemetry({ incidentId: 'campus-inc-001', error });
    expect(result).toEqual({ incidentId: 'campus-inc-001', error: { errorType: 'TypeError', code: 'E_REPO' } });
    expect(leaked(result)).toEqual([]);
  });

  class FailingRepository implements IncidentRepository {
    async getAll(): Promise<readonly DomainIncident[]> {
      throw this.failure();
    }
    async getById(): Promise<DomainIncident | null> {
      throw this.failure();
    }
    // El error lleva en su mensaje y propiedades los datos que la UI ya no muestra.
    private failure() {
      return Object.assign(new Error(`timeout leyendo ${FAKE.location} para ${FAKE.email} con ${FAKE.token}`), {
        code: 'E_TIMEOUT',
        location: FAKE.location,
        assignedTechnicianId: FAKE.technicianId,
        internalComments: [FAKE.comment],
      });
    }
  }

  test('t3-error-path-detail: al fallar el detalle, el registro conserva contexto técnico sin datos sensibles', async () => {
    const sink = new InMemoryTelemetrySink();
    await expect(getIncidentDetail(new FailingRepository(), 'campus-inc-001', sink)).rejects.toThrow('timeout');

    const events = sink.getEvents();
    expect(events).toEqual([
      expect.objectContaining({
        event: 'incident.detail.failed',
        status: 'error',
        incidentId: 'campus-inc-001',
        durationMs: expect.any(Number),
        error: { errorType: 'Error', code: 'E_TIMEOUT' },
      }),
    ]);
    expect(leaked(events)).toEqual([]);
  });

  test('t3-error-path-list: al fallar la lista, el registro tampoco contiene datos sensibles', async () => {
    const sink = new InMemoryTelemetrySink();
    await expect(getIncidentList(new FailingRepository(), sink)).rejects.toThrow('timeout');
    expect(sink.getEvents()).toEqual([expect.objectContaining({ event: 'incident.list.failed', status: 'error' })]);
    expect(leaked(sink.getEvents())).toEqual([]);
  });

  test('t3-sink-failure: si el registro falla, la operación de la app no se rompe', () => {
    const brokenSink = {
      record: () => {
        throw new Error('sink no disponible');
      },
    };
    expect(() =>
      recordTelemetry(brokenSink, { event: 'incident.detail.loaded', status: 'ok', durationMs: 1, token: FAKE.token }),
    ).not.toThrow();
  });
});

describe('Amenaza 4 — credenciales expuestas (escáner de secretos del evaluador)', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const evaluator = join(ROOT, 'tools', 'course_public_evaluator.py');
  const projectFiles = [
    'course-contracts.json',
    'package.json',
    'package-lock.json',
    'app.json',
    'tsconfig.json',
    'Makefile',
    join('src', 'course-evaluation', 'index.ts'),
  ];
  const workdirs: string[] = [];

  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'campusops-scan-'));
    workdirs.push(dir);
    for (const file of projectFiles) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      copyFileSync(join(ROOT, file), join(dir, file));
    }
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }

  function verify(dir: string) {
    const run = spawnSync(python, [evaluator, '--week', '3', '--mode', 'verify', '--repo', dir], { encoding: 'utf8' });
    const report = JSON.parse(run.stdout) as { status: string; checks: { id: string; status: string; detail: string }[] };
    return { exitCode: run.status, report, scan: report.checks.find((check) => check.id === 'secret_scan') };
  }

  afterAll(() => {
    for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
  });

  test('un árbol sin credenciales pasa el escáner y el evaluador termina con código 0', () => {
    const { exitCode, report, scan } = verify(fixture({ [join('src', 'config.ts')]: "export const label = 'CampusOps';\n" }));
    expect(scan?.status).toBe('pass');
    expect(report.status).toBe('pass');
    expect(exitCode).toBe(0);
  });

  test('un valor falso con nombre de variable pública secreta hace fallar el escáner y el evaluador termina con código 1', () => {
    // La cadena se arma en tiempo de ejecución para que este archivo no dispare el propio escáner.
    const name = ['EXPO', 'PUBLIC', 'DEMO', 'SECRET'].join('_');
    const { exitCode, report, scan } = verify(fixture({ [join('src', 'fake-config.ts')]: `${name}=valor-falso-de-prueba\n` }));
    expect(scan?.status).toBe('fail');
    expect(scan?.detail).toContain('public_secret_name');
    expect(scan?.detail).toContain('fake-config.ts');
    expect(report.status).toBe('fail');
    expect(exitCode).toBe(1);
    // El fallo es atribuible únicamente al escáner: ningún otro check obligatorio cambió.
    expect(report.checks.filter((check) => check.status === 'fail').map((check) => check.id)).toEqual(['secret_scan']);
  });
});
