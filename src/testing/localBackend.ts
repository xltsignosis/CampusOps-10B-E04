/**
 * Arranque del backend didáctico (course-backend/server.mjs) para pruebas de integración.
 * Sólo escucha en 127.0.0.1 con un puerto libre; no se usa Internet público.
 */
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { resolve } from 'node:path';

/**
 * jest-expo sustituye el fetch global por un doble incluso en entorno node, así que
 * aquí se usa un transporte HTTP real mínimo con node:http. Respeta AbortSignal
 * igual que fetch, de modo que el timeout del cliente se prueba de verdad.
 */
export const nodeHttpFetch = ((input: string | URL | Request, init?: RequestInit) =>
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

export type LocalBackend = Readonly<{ baseUrl: string; stop: () => void }>;

/** Cada llamada levanta un proceso nuevo, con el estado inicial del backend. */
export async function startLocalBackend(): Promise<LocalBackend> {
  const backend = spawn(process.execPath, [resolve(__dirname, '..', '..', 'course-backend', 'server.mjs')], {
    env: { ...process.env, COURSE_BACKEND_HOST: '127.0.0.1', COURSE_BACKEND_PORT: '0' },
  });
  const baseUrl = await new Promise<string>((done, fail) => {
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
  return { baseUrl, stop: () => void backend.kill() };
}
