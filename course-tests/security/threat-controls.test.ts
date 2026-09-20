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

  test.todo('redactForTelemetry sustituye claves sensibles por [REDACTED] (se implementa y prueba en semana 4)');
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
