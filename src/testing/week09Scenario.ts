import { nodeHttpFetch, type LocalBackend } from './localBackend';
export const incidentId = 'campus-inc-001';
export type RawIncident = { version: number; status: string; payload: { history: { action: string; operationId: string }[]; evidence: unknown[]; notes: unknown[] } };
export async function readIncident(backend: LocalBackend): Promise<RawIncident> {
  const response = await nodeHttpFetch(backend.baseUrl + '/v1/incidents/' + incidentId, {
    headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'coordinator-1' },
  });
  if (!response.ok) throw new Error('Fixture read failed');
  return await response.json() as RawIncident;
}
export async function fixtureAction(backend: LocalBackend, action: Record<string, unknown>, key: string, actor = 'technician-1') {
  const before = await readIncident(backend);
  return nodeHttpFetch(backend.baseUrl + '/v1/incidents/' + incidentId + '/actions', { method: 'POST',
    headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': actor, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ ...action, baseVersion: before.version }),
  });
}
export async function prepareAction(backend: LocalBackend, action: 'resolve' | 'close') {
  const start = await fixtureAction(backend, { action: 'start' }, 'week09-fixture-start');
  if (!start.ok) throw new Error('Fixture start failed');
  const evidence = await fixtureAction(backend, { action: 'add_evidence', evidenceId: 'synthetic-evidence-E04' }, 'week09-fixture-evidence');
  if (!evidence.ok) throw new Error('Fixture evidence failed');
  if (action === 'close') {
    const resolution = await fixtureAction(backend, { action: 'resolve', diagnosis: 'Diagnóstico ficticio' }, 'week09-fixture-resolve');
    if (!resolution.ok) throw new Error('Fixture resolution failed');
  }
  return readIncident(backend);
}
