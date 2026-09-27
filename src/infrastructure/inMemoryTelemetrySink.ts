import type { TelemetrySink } from '../domain/telemetry';

const DEFAULT_CAPACITY = 50;

/**
 * Registro técnico en memoria: conserva los últimos eventos ya sanitizados.
 * No persiste en el dispositivo ni envía nada por red.
 */
export class InMemoryTelemetrySink implements TelemetrySink {
  private readonly events: unknown[] = [];

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  record(event: unknown): void {
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
  }

  getEvents(): readonly unknown[] {
    // Los eventos ya vienen sanitizados (JSON-seguros); se entrega una copia.
    return JSON.parse(JSON.stringify(this.events)) as unknown[];
  }
}
