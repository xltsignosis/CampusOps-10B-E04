/**
 * Semana 4 — Amenaza 3 (docs/threat-model.md): un dato que la interfaz ya no muestra
 * tampoco debe quedar en el registro técnico cuando la carga falla. Sólo datos ficticios.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { Incident, IncidentRepository } from '../../src/domain/incident';
import { InMemoryTelemetrySink } from '../../src/infrastructure/inMemoryTelemetrySink';
import { CampusOpsApp } from '../../src/ui/CampusOpsApp';

const FAKE_TOKEN = 'course-token-ficticio-ui';
const FAKE_EMAIL = 'persona.ui@campusops.test';
const FAKE_LOCATION = 'Edificio ficticio UI - Aula 9';

const incident: Incident = {
  id: 'TEST-UI-1',
  title: 'Incidencia ficticia de UI',
  description: 'Descripción ficticia',
  category: 'water',
  status: 'open',
  priority: 'high',
  location: { source: 'manual', label: FAKE_LOCATION },
  reportedAt: '2026-09-22T00:00:00Z',
  assignedTechnicianId: 'technician-1',
};

class DetailFailingRepository implements IncidentRepository {
  async getAll(): Promise<readonly Incident[]> {
    return [incident];
  }
  async getById(): Promise<Incident | null> {
    throw Object.assign(new Error(`sesión ${FAKE_TOKEN} de ${FAKE_EMAIL} expirada en ${FAKE_LOCATION}`), {
      code: 'E_SESSION',
      email: FAKE_EMAIL,
    });
  }
}

test('t3-ui-error-path: la UI muestra un mensaje genérico y el registro no conserva datos sensibles', async () => {
  const telemetry = new InMemoryTelemetrySink();
  const view = await render(<CampusOpsApp repository={new DetailFailingRepository()} telemetry={telemetry} />);

  await waitFor(() => expect(view.getByText('Incidencias Reportadas (1)')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByTestId('incident-item-TEST-UI-1'));
  });

  await waitFor(() => expect(view.getByTestId('campusops-error').props.children).toBe('No se pudo cargar la incidencia.'));
  expect(view.queryByText(new RegExp(FAKE_TOKEN))).toBeNull();
  expect(view.queryByText(new RegExp(FAKE_EMAIL))).toBeNull();

  const serialized = JSON.stringify(telemetry.getEvents());
  expect(serialized).toContain('incident.detail.failed');
  expect(serialized).toContain('TEST-UI-1');
  for (const secret of [FAKE_TOKEN, FAKE_EMAIL, FAKE_LOCATION, 'technician-1']) {
    expect(serialized).not.toContain(secret);
  }
});
