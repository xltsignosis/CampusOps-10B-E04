import type { Incident, IncidentRepository } from '../domain/incident';

export async function getIncidentList(repository: IncidentRepository): Promise<readonly Incident[]> {
  return repository.getAll();
}

export async function getIncidentDetail(
  repository: IncidentRepository,
  id: string,
): Promise<Incident | null> {
  return repository.getById(id);
}

