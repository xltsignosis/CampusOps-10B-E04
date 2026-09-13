import type {
  IncidentCategory,
  IncidentLocation,
  IncidentStatus,
} from '../campusops/contracts';

export type IncidentPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: IncidentCategory;
  readonly status: IncidentStatus;
  readonly priority: IncidentPriority;
  readonly location: IncidentLocation;
  readonly reportedAt: string;
  readonly assignedTechnicianId: string | null;
}

export interface IncidentRepository {
  getAll(): Promise<readonly Incident[]>;
  getById(id: string): Promise<Incident | null>;
}

