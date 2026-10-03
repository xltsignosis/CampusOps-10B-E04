/**
 * Semana 5 — la pantalla consume puertos del dominio: distingue cada tipo de fallo
 * con un mensaje genérico, no muestra datos sensibles y crea mediante el caso de uso.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  IncidentSourceError,
  type IncidentDraft,
  type IncidentEntry,
  type IncidentSource,
  type IncidentSourceErrorKind,
  type IncidentWriter,
} from '../domain/incident';
import type { TelemetrySink } from '../domain/telemetry';

import { CampusOpsApp } from './CampusOpsApp';

const SENSITIVE = 'Bearer course-valid-token reporter-1 Edificio secreto';

class FailingSource implements IncidentSource {
  constructor(private readonly kind: IncidentSourceErrorKind) {}
  async getAll(): Promise<readonly IncidentEntry[]> {
    throw new IncidentSourceError(this.kind, 500);
  }
  async getById(): Promise<IncidentEntry | null> {
    return null;
  }
}

class MemorySink implements TelemetrySink {
  readonly events: unknown[] = [];
  record(event: unknown): void {
    this.events.push(event);
  }
}

test.each([
  ['timeout', 'El servidor tardó demasiado en responder. Intenta de nuevo.'],
  ['unavailable', 'El servicio de incidencias no está disponible en este momento.'],
  ['invalid_response', 'El servidor envió datos inválidos y no se mostraron.'],
  ['network', 'No hay conexión con el servidor de incidencias.'],
  ['rejected', 'No se pudieron cargar las incidencias.'],
] as const)('fallo %s → mensaje distinguible y sin datos técnicos', async (kind, message) => {
  const telemetry = new MemorySink();
  const view = await render(<CampusOpsApp repository={new FailingSource(kind)} telemetry={telemetry} />);

  await waitFor(() => expect(view.getByTestId('campusops-error').props.children).toBe(message));
  expect(JSON.stringify(telemetry.events)).toContain(`"code":"${kind}"`);
});

test('una incidencia con payload null se lista como "detalle no disponible"', async () => {
  const source: IncidentSource = {
    getAll: async () => [{ id: 'campus-inc-001', status: 'assigned', detailsAvailable: false }],
    getById: async () => ({ id: 'campus-inc-001', status: 'assigned', detailsAvailable: false }),
  };
  const view = await render(<CampusOpsApp repository={source} />);

  await waitFor(() => expect(view.getByText(/Detalle no disponible/)).toBeTruthy());
  expect(view.getByText('Incidencias Reportadas (1)')).toBeTruthy();
});

test('crear usa el writer, reutiliza la clave al reintentar y no muestra el error técnico', async () => {
  const keys: string[] = [];
  const drafts: IncidentDraft[] = [];
  let attempt = 0;
  const writer: IncidentWriter = {
    create: async (draft, key) => {
      keys.push(key);
      drafts.push(draft);
      attempt += 1;
      if (attempt === 1) throw Object.assign(new IncidentSourceError('timeout'), { detail: SENSITIVE });
      return { id: 'campus-inc-101', status: 'open', detailsAvailable: false };
    },
  };
  const source: IncidentSource = { getAll: async () => [], getById: async () => null };
  const view = await render(<CampusOpsApp repository={source} writer={writer} />);

  await waitFor(() => expect(view.getByText('Incidencias Reportadas (0)')).toBeTruthy());
  await fireEvent.press(view.getByTestId('report-category-water'));
  await fireEvent.changeText(view.getByTestId('report-description'), 'Fuga ficticia');
  await fireEvent.changeText(view.getByTestId('report-location'), 'Edificio B');

  await act(async () => {
    await fireEvent.press(view.getByTestId('report-submit'));
  });
  await waitFor(() =>
    expect(view.getByTestId('campusops-error').props.children).toBe(
      'El servidor tardó demasiado en responder. Intenta de nuevo.',
    ),
  );
  expect(view.queryByText(new RegExp(SENSITIVE))).toBeNull();

  await act(async () => {
    await fireEvent.press(view.getByTestId('report-submit'));
  });
  await waitFor(() => expect(view.getByTestId('campusops-notice').props.children).toBe('Incidencia creada: campus-inc-101'));

  expect(drafts[0]).toEqual({ category: 'water', description: 'Fuga ficticia', location: 'Edificio B' });
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(view.getByText('Incidencias Reportadas (1)')).toBeTruthy();
});
