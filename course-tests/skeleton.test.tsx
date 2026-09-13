import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { Incident, IncidentRepository } from '../src/domain/incident';
import { getIncidentDetail, getIncidentList } from '../src/application/incidentUseCases';
import { InMemoryIncidentRepository } from '../src/infrastructure/inMemoryIncidentRepository';
import { CampusOpsApp } from '../src/ui/CampusOpsApp';

describe('Esqueleto de arquitectura de CampusOps (AC-01 y AC-02)', () => {
  const fakeIncidents: readonly Incident[] = [
    {
      id: 'TEST-1',
      title: 'Fuga de prueba',
      description: 'Descripción de prueba detallada',
      category: 'water',
      status: 'open',
      priority: 'high',
      location: { source: 'manual', label: 'Edificio A' },
      reportedAt: '2026-09-12T00:00:00Z',
      assignedTechnicianId: null,
    },
  ];

  class MockRepository implements IncidentRepository {
    async getAll(): Promise<readonly Incident[]> {
      return fakeIncidents;
    }
    async getById(id: string): Promise<Incident | null> {
      return fakeIncidents.find((i) => i.id === id) ?? null;
    }
  }

  test('los casos de uso de aplicación funcionan con repositorio mock aislado', async () => {
    const mockRepo = new MockRepository();
    const list = await getIncidentList(mockRepo);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('TEST-1');

    const detail = await getIncidentDetail(mockRepo, 'TEST-1');
    expect(detail?.title).toBe('Fuga de prueba');
    expect(detail?.location.label).toBe('Edificio A');
  });

  test('InMemoryIncidentRepository proporciona incidencias sintéticas desde la capa de infraestructura', async () => {
    const inMemoryRepo = new InMemoryIncidentRepository();
    const list = await inMemoryRepo.getAll();
    expect(list.length).toBeGreaterThanOrEqual(3);

    const first = list[0];
    expect(first).toBeDefined();
    if (first) {
      const detail = await inMemoryRepo.getById(first.id);
      expect(detail).toEqual(first);
    }
  });

  test('la capa UI renderiza la lista de incidencias y navega al detalle al seleccionarla', async () => {
    const repo = new MockRepository();
    const view = await render(<CampusOpsApp repository={repo} />);

    await waitFor(() => {
      expect(view.getByText('Incidencias Reportadas (1)')).toBeTruthy();
      expect(view.getByText('Fuga de prueba')).toBeTruthy();
    });

    // Presionar la incidencia para ver el detalle envuelto en act
    await act(async () => {
      fireEvent.press(view.getByTestId('incident-item-TEST-1'));
    });

    await waitFor(() => {
      expect(view.getByText('Descripción de prueba detallada')).toBeTruthy();
      expect(view.getByText('Edificio A')).toBeTruthy();
      expect(view.getByText('← Regresar a la lista')).toBeTruthy();
    });

    // Presionar el botón para regresar a la lista envuelto en act
    await act(async () => {
      fireEvent.press(view.getByTestId('back-to-list-button'));
    });

    await waitFor(() => {
      expect(view.getByText('Incidencias Reportadas (1)')).toBeTruthy();
    });
  });
});
