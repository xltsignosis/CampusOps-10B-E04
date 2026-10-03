/**
 * @jest-environment node
 *
 * Semana 5 — el cliente real contra el backend didáctico local (course-backend/server.mjs).
 * Se levanta en 127.0.0.1 con un puerto libre; no se usa Internet público ni proveedores reales.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { request } from 'node:http';
import { resolve } from 'node:path';

import { IncidentClient, IncidentClientError } from './incidentClient';

/**
 * jest-expo sustituye el fetch global por un doble incluso en entorno node, así que
 * aquí se usa un transporte HTTP real mínimo con node:http. Respeta AbortSignal
 * igual que fetch, de modo que el timeout del cliente se prueba de verdad.
 */
const nodeHttpFetch = ((input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((done, fail) => {
    const signal = init?.signal;
    if (signal?.aborted) return fail(new Error('aborted'));
    const req = request(
      String(input),
      { method: init?.method ?? 'GET', headers: init?.headers as Record<string, string> },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          done({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve().then(() => JSON.parse(raw) as unknown),
          } as unknown as Response);
        });
        res.on('error', fail);
      },
    );
    req.on('error', fail);
    signal?.addEventListener('abort', () => {
      req.destroy();
      fail(new Error('aborted'));
    });
    if (typeof init?.body === 'string') req.write(init.body);
    req.end();
  })) as typeof fetch;

let backend: ChildProcessWithoutNullStreams;
let baseUrl = '';

beforeAll(async () => {
  backend = spawn(process.execPath, [resolve(__dirname, '..', '..', 'course-backend', 'server.mjs')], {
    env: { ...process.env, COURSE_BACKEND_HOST: '127.0.0.1', COURSE_BACKEND_PORT: '0' },
  });
  baseUrl = await new Promise<string>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('el backend didáctico no arrancó')), 10_000);
    backend.stdout.on('data', (chunk: Buffer) => {
      const match = /listening at (http:\/\/[^\s]+)/.exec(chunk.toString());
      if (match?.[1]) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    backend.once('exit', (code) => fail(new Error(`el backend terminó con código ${String(code)}`)));
  });
});

afterAll(() => {
  backend.kill();
});

function client(scenario?: string, timeoutMs = 3_000): IncidentClient {
  return new IncidentClient({ baseUrl, timeoutMs, fetchImpl: nodeHttpFetch, ...(scenario ? { scenario } : {}) });
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    expect(error).toBeInstanceOf(IncidentClientError);
    return (error as IncidentClientError).kind;
  }
}

test('be-success: lista y detalle de campus-inc-001 como objetos de aplicación', async () => {
  const list = await client('success').getIncidents();
  const detail = await client('success').getIncident('campus-inc-001');

  expect(list.map((item) => item.id)).toContain('campus-inc-001');
  expect(detail).toMatchObject({
    id: 'campus-inc-001',
    status: 'assigned',
    details: { category: 'connectivity', priority: 'medium', assignedTechnicianId: 'technician-1' },
  });
});

test('be-nullable: payload null del backend → details null, sin error', async () => {
  const list = await client('nullable').getIncidents();
  expect(list.length).toBeGreaterThan(0);
  expect(list.every((item) => item.details === null)).toBe(true);
  await expect(client('nullable').getIncident('campus-inc-001')).resolves.toMatchObject({ details: null });
});

test('be-malformed: JSON roto del backend → contract', async () => {
  expect(await kindOf(client('malformed').getIncidents())).toBe('contract');
});

test('be-slow: 1200 ms del backend con timeout de 300 ms → timeout', async () => {
  expect(await kindOf(client('slow', 300).getIncidents())).toBe('timeout');
});

test('be-slow-boundary: 1200 ms del backend con timeout de 3000 ms → éxito', async () => {
  await expect(client('slow', 3_000).getIncidents()).resolves.not.toHaveLength(0);
});

test('be-server-error: 500 → server', async () => {
  await expect(client('server_error').getIncidents()).rejects.toMatchObject({ kind: 'server', status: 500 });
});

test('be-rate-limited: 429 → http 429', async () => {
  await expect(client('rate_limited').getIncidents()).rejects.toMatchObject({ kind: 'http', status: 429 });
});

test('be-not-found: detalle inexistente → null', async () => {
  await expect(client().getIncident('campus-inc-999')).resolves.toBeNull();
});

test('be-create-idempotent: crear y repetir con la misma clave no duplica', async () => {
  const draft = { category: 'water', description: 'Fuga ficticia de prueba', location: 'Edificio B' } as const;
  const first = await client().createIncident(draft, 'create-be-0001');
  const replay = await client().createIncident(draft, 'create-be-0001');
  const list = await client().getIncidents();

  expect(first).toMatchObject({ status: 'open', details: { category: 'water', reporterId: 'reporter-1' } });
  expect(replay.id).toBe(first.id);
  expect(list.filter((item) => item.id === first.id)).toHaveLength(1);
});
