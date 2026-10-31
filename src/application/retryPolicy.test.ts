import { planRetry as evaluatedPlanRetry } from '../course-evaluation';
import { configureRetryPolicy, DEFAULT_RETRY_POLICY, parseRetryAfter, planRetry } from './retryPolicy';

test('retry-policy: el adaptador usa la política real de CampusOps', () => {
  const input = { method: 'POST', status: 'timeout', attempt: 1, idempotencyKey: 'operation-0001' } as const;
  expect(evaluatedPlanRetry(input)).toEqual(planRetry(input));
});

test('retry-policy: progresión 250/500/1000 y ningún envío desde el intento 4', () => {
  expect([1, 2, 3].map((attempt) => planRetry({ method: 'GET', status: 500, attempt }).delayMs))
    .toEqual([250, 500, 1000]);
  for (const attempt of [4, 5, 100, Number.MAX_SAFE_INTEGER]) {
    expect(planRetry({ method: 'GET', status: 'timeout', attempt, retryAfterMs: 800 }))
      .toEqual({ retry: false, delayMs: 0, requiresStableIdempotencyKey: false });
  }
});

test.each([0, -1, 1.5, NaN, Infinity, -Infinity])('retry-policy: rechaza intento inválido %s', (attempt) => {
  expect(planRetry({ method: 'GET', status: 503, attempt }).retry).toBe(false);
});

test.each(['timeout', 408, 429, 500, 502, 503, 504] as const)('retry-policy: fallo transitorio %s', (status) => {
  expect(planRetry({ method: 'GET', status, attempt: 1 }).retry).toBe(true);
});

test.each([200, 201, 400, 401, 403, 404, 409, 422, 499, 600, NaN, Infinity])(
  'retry-policy: no repetir rechazo definitivo %s', (status) => {
    expect(planRetry({ method: 'GET', status, attempt: 1 }).retry).toBe(false);
  },
);

test.each([undefined, '', '   ', 'short', '       a'])('retry-policy: POST sin identidad estable (%s)', (idempotencyKey) => {
  expect(planRetry({ method: 'POST', status: 503, attempt: 1,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }) }))
    .toEqual({ retry: false, delayMs: 0, requiresStableIdempotencyKey: true });
});

test('retry-policy: identidad válida no omite el máximo ni autoriza repetir un 409', () => {
  for (const input of [{ status: 503, attempt: 4 }, { status: 409, attempt: 1 }]) {
    expect(planRetry({ method: 'POST', idempotencyKey: 'operation-0001', ...input }))
      .toEqual({ retry: false, delayMs: 0, requiresStableIdempotencyKey: false });
  }
});

test('retry-policy: Retry-After es un mínimo; no reduce el backoff progresivo', () => {
  expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 800 }).delayMs).toBe(800);
  expect(planRetry({ method: 'GET', status: 503, attempt: 2, retryAfterMs: 100 }).delayMs).toBe(500);
  expect(planRetry({ method: 'GET', status: 500, attempt: 1, retryAfterMs: 800 }).delayMs).toBe(250);
});

test.each([NaN, Infinity, -Infinity, -1])('retry-policy: Retry-After inválido %s usa espera finita', (retryAfterMs) => {
  expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs }).delayMs).toBe(250);
});

test('retry-policy: límites configurables sin ampliar el máximo absoluto de cuatro', () => {
  const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 150 };
  expect([1, 2, 3, 4].map((attempt) => planRetry({ method: 'GET', status: 500, attempt }, policy).delayMs))
    .toEqual([100, 150, 0, 0]);
  expect(planRetry({ method: 'GET', status: 500, attempt: 1 }, { maxAttempts: 1 }).retry).toBe(false);
  expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 10_001 }).retry).toBe(false);
  expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 10_000 }).delayMs).toBe(10_000);
  expect(Object.isFrozen(DEFAULT_RETRY_POLICY)).toBe(true);
});

test.each([
  { maxAttempts: 0 }, { maxAttempts: 5 }, { maxAttempts: 1.5 }, { maxAttempts: Infinity },
  { baseDelayMs: 0 }, { baseDelayMs: -1 }, { baseDelayMs: Infinity }, { baseDelayMs: NaN },
  { maxDelayMs: 0 }, { maxDelayMs: Infinity }, { maxDelayMs: 2_147_483_648 },
])('retry-policy: rechaza configuración peligrosa %j', (policy) => {
  expect(() => configureRetryPolicy(policy)).toThrow('Política inválida');
});

test('retry-header: segundos enteros y fecha HTTP con reloj fijo', () => {
  const now = Date.UTC(2026, 9, 31, 18, 0, 0);
  expect(parseRetryAfter(' 2 ', now)).toBe(2000);
  expect(parseRetryAfter('0', now)).toBe(0);
  expect(parseRetryAfter('Sat, 31 Oct 2026 18:00:03 GMT', now)).toBe(3000);
  expect(parseRetryAfter('Sat, 31 Oct 2026 17:59:59 GMT', now)).toBe(0);
});

test.each([null, undefined, '', 'foo', '-1', '1.5', 'Infinity', '1e3', '2026-10-31',
  'Sat, 31 Feb 2026 18:00:00 GMT', 'Sat, 31 Oct 2026 99:00:00 GMT', '9'.repeat(400)])(
  'retry-header: ignora valor inválido %s', (value) => {
    expect(parseRetryAfter(value)).toBeUndefined();
  },
);
