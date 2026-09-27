/**
 * Evento técnico que CampusOps puede registrar. Antes de llegar a un sink
 * siempre pasa por redactForTelemetry (src/application/telemetry.ts).
 */
export type TelemetryEvent = Readonly<{
  event: string;
  status: 'ok' | 'error';
  durationMs: number;
  [key: string]: unknown;
}>;

/** Puerto de salida de registros técnicos; la infraestructura decide dónde se guardan. */
export interface TelemetrySink {
  record(event: unknown): void;
}
