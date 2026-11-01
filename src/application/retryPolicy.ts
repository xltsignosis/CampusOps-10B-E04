export type RetryInput = Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  /** Número del envío que acaba de fallar, empezando en 1. */
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>;

export type RetryPlan = Readonly<{
  retry: boolean;
  delayMs: number;
  requiresStableIdempotencyKey: boolean;
}>;

export type RetryPolicy = Readonly<{
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}>;

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 10_000,
});

// Evita el desbordamiento de setTimeout que convertiría una espera larga en inmediata.
const MAX_TIMER_MS = 2_147_483_647;

export function configureRetryPolicy(input: Partial<RetryPolicy> = {}): RetryPolicy {
  const policy = { ...DEFAULT_RETRY_POLICY, ...input };
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 4 ||
    !Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs <= 0 ||
    !Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs ||
    policy.maxDelayMs > MAX_TIMER_MS) {
    throw new Error('Política inválida: 1 a 4 envíos y demoras positivas, finitas y acotadas.');
  }
  return Object.freeze(policy);
}

/** Política compartida por el cliente real y el adaptador de evaluación. */
export function planRetry(input: RetryInput, configuration: Partial<RetryPolicy> = {}): RetryPlan {
  const policy = configureRetryPolicy(configuration);
  const requiresStableIdempotencyKey = input.method === 'POST' &&
    !(typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim().length >= 8);
  const stop: RetryPlan = { retry: false, delayMs: 0, requiresStableIdempotencyKey };
  if (requiresStableIdempotencyKey || !Number.isInteger(input.attempt) ||
    input.attempt < 1 || input.attempt >= policy.maxAttempts) return stop;

  const transient = input.status === 'timeout' || input.status === 408 || input.status === 429 ||
    (Number.isInteger(input.status) && input.status >= 500 && input.status <= 599);
  if (!transient) return stop;

  const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (input.attempt - 1));
  const serverDelay = (input.status === 429 || input.status === 503) &&
    typeof input.retryAfterMs === 'number' && Number.isFinite(input.retryAfterMs) && input.retryAfterMs >= 0
    ? input.retryAfterMs : 0;
  // Nunca recortar Retry-After y enviar antes de lo solicitado por el servidor.
  if (serverDelay > policy.maxDelayMs) return stop;
  return { retry: true, delayMs: Math.max(backoff, serverDelay), requiresStableIdempotencyKey: false };
}

/** Retry-After admite segundos enteros o una fecha HTTP. No acepta números ambiguos. */
export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | undefined {
  if (typeof value !== 'string' || !Number.isFinite(nowMs)) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const delay = Number(text) * 1_000;
    return Number.isFinite(delay) ? delay : undefined;
  }
  // Date.parse también acepta '-1', '1.5' y fechas no HTTP: se excluyen explícitamente.
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
    return undefined;
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== text) return undefined;
  return Math.max(0, timestamp - nowMs);
}
