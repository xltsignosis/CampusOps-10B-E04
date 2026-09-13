import type { Incident, IncidentRepository } from '../domain/incident';

export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly incidents: Incident[];

  constructor(initialData?: Incident[]) {
    this.incidents = initialData ? [...initialData] : [
      {
        id: 'INC-2026-001',
        title: 'Fuga de agua en Laboratorio 3B',
        description: 'Tubería rota bajo la tarja central; el agua se está filtrando hacia el pasillo.',
        category: 'water',
        status: 'open',
        priority: 'high',
        location: {
          source: 'manual',
          label: 'Edificio de Química - Planta Baja - Lab 3B',
        },
        reportedAt: '2026-09-12T08:30:00-06:00',
        assignedTechnicianId: null,
      },
      {
        id: 'INC-2026-002',
        title: 'Falla eléctrica en luminarias del pasillo',
        description: 'Intermitencia y zumbido constante en el circuito de iluminación norte.',
        category: 'electrical',
        status: 'assigned',
        priority: 'medium',
        location: {
          source: 'manual',
          label: 'Edificio de Ingeniería - Segundo Piso',
        },
        reportedAt: '2026-09-12T09:15:00-06:00',
        assignedTechnicianId: 'TECH-401',
      },
      {
        id: 'INC-2026-003',
        title: 'Pérdida de conectividad Wi-Fi',
        description: 'Punto de acceso no responde; estudiantes sin acceso a red universitaria.',
        category: 'connectivity',
        status: 'in_progress',
        priority: 'high',
        location: {
          source: 'manual',
          label: 'Biblioteca Central - Sala de Lectura A',
        },
        reportedAt: '2026-09-12T10:00:00-06:00',
        assignedTechnicianId: 'TECH-402',
      },
      {
        id: 'INC-2026-004',
        title: 'Mantenimiento preventivo en compresor de aire',
        description: 'Revisión semestral de válvulas y niveles de lubricación.',
        category: 'maintenance',
        status: 'resolved',
        priority: 'low',
        location: {
          source: 'manual',
          label: 'Taller de Mecatrónica - Área de Máquinas',
        },
        reportedAt: '2026-09-11T14:20:00-06:00',
        assignedTechnicianId: 'TECH-401',
      },
    ];
  }

  async getAll(): Promise<readonly Incident[]> {
    return [...this.incidents];
  }

  async getById(id: string): Promise<Incident | null> {
    const found = this.incidents.find((incident) => incident.id === id);
    return found ? { ...found } : null;
  }
}

