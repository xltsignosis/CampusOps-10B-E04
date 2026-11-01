/** @jest-environment node */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nodeHttpFetch, startLocalBackend } from '../testing/localBackend';
import { fixtureAction, incidentId, prepareAction, readIncident } from '../testing/week09Scenario';
import { IncidentClient } from './incidentClient';
import { InMemoryTelemetrySink } from './inMemoryTelemetrySink';

const observations: Record<string, unknown> = {};
afterAll(() => { if (process.env.CAMPUSOPS_FAULT_OBSERVATIONS) writeFileSync(join(process.env.CAMPUSOPS_FAULT_OBSERVATIONS, 'lost-response.json'), JSON.stringify(observations)); });

test.each(['resolve', 'close'] as const)('http-lost-%s: servidor guarda antes del timeout y el replay no duplica efectos', async (action) => {
  const backend = await startLocalBackend();
  try {
    const before = await prepareAction(backend, action);
    const key = 'week09-lost-' + action;
    const input = action === 'resolve' ? { action, diagnosis: 'Diagnóstico ficticio E04' } : { action };
    const telemetry = new InMemoryTelemetrySink();
    const calls: { key: unknown; body: unknown; sentAt: number; duplicate?: boolean }[] = [];
    let committedVersion: number | undefined;
    const delays: number[] = [];
    const fetchImpl = (async (url, init) => {
      const call = { key: (init?.headers as Record<string, string>)['Idempotency-Key'], body: init?.body, sentAt: Date.now() };
      calls.push(call);
      const result = await nodeHttpFetch(url, init);
      const raw = await result.json() as { duplicate?: boolean };
      Object.assign(call, { duplicate: raw.duplicate });
      return result;
    }) as typeof fetch;
    const client = new IncidentClient({ baseUrl: backend.baseUrl, actorId: action === 'resolve' ? 'technician-1' : 'coordinator-1',
      scenario: 'timeout_after_commit', fetchImpl, timeoutMs: 100, telemetry,
      wait: async (delay) => {
        committedVersion = (await readIncident(backend)).version;
        delays.push(delay);
        await new Promise((done) => setTimeout(done, delay));
      },
    });
    const result = await client.performAction(incidentId, before.version, input, key);
    const after = await readIncident(backend);
    expect(committedVersion).toBe(before.version + 1);
    expect(result.status).toBe(action === 'resolve' ? 'resolved' : 'closed');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.key).toBe(key);
    expect(calls[1]!.key).toBe(calls[0]!.key);
    expect(calls[1]!.body).toBe(calls[0]!.body);
    expect(calls[1]!.duplicate).toBe(true);
    expect(delays).toEqual([250]);
    expect(calls[1]!.sentAt - calls[0]!.sentAt).toBeGreaterThanOrEqual(340);
    expect(after.version).toBe(before.version + 1);
    expect(after.payload.history).toHaveLength(before.payload.history.length + 1);
    expect(after.payload.history.filter((event) => event.operationId === key)).toHaveLength(1);
    expect(after.payload.evidence).toEqual(before.payload.evidence);
    expect(after.payload.notes).toEqual(before.payload.notes);
    // Changed content with a consumed identity must fail, never perform a second operation.
    await expect(client.performAction(incidentId, before.version, { action: 'comment', text: 'Contenido diferente' }, key)).rejects.toMatchObject({ status: 409 });
    expect((await readIncident(backend))).toEqual(after);
    const serialized = JSON.stringify(telemetry.getEvents());
    for (const secret of [key, 'Diagnóstico ficticio', 'course-valid-token', 'Authorization', 'synthetic-evidence-E04']) expect(serialized).not.toContain(secret);
    observations[action] = { clock: 'real', attemptsForLostResponse: 2, delaysMs: delays,
      sendGapMs: calls[1]!.sentAt - calls[0]!.sentAt, committedBeforeRetry: true, sameKey: true, sameBody: true,
      duplicateAcknowledged: true, versionBefore: before.version, versionAfter: after.version,
      historyDelta: after.payload.history.length - before.payload.history.length,
      evidenceBefore: before.payload.evidence.length, evidenceAfter: after.payload.evidence.length,
      notesBefore: before.payload.notes.length, notesAfter: after.payload.notes.length,
      changedPayloadStatus: 409, events: telemetry.getEvents() };
  } finally { backend.stop(); }
});
test('evidence-replay: una referencia sintética no se duplica al perderse su respuesta', async () => {
  const backend = await startLocalBackend();
  try {
    const before = await readIncident(backend);
    const key = 'week09-lost-evidence';
    const body = JSON.stringify({ action: 'add_evidence', evidenceId: 'synthetic-E04-001', baseVersion: before.version });
    const headers = { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'technician-1', 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Course-Scenario': 'timeout_after_commit' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100);
    try { await expect(nodeHttpFetch(backend.baseUrl + '/v1/incidents/' + incidentId + '/actions', { method: 'POST', headers, body, signal: controller.signal })).rejects.toThrow(); }
    finally { clearTimeout(timeout); }
    const committed = await readIncident(backend);
    expect(committed.payload.evidence).toHaveLength(1);
    const replay = await nodeHttpFetch(backend.baseUrl + '/v1/incidents/' + incidentId + '/actions', { method: 'POST', headers, body });
    expect(await replay.json()).toMatchObject({ duplicate: true });
    const after = await readIncident(backend);
    expect(after).toEqual(committed);
    expect(after.payload.history).toHaveLength(1);
    observations.evidence = { clock: 'real', attempts: 2, sameKey: true, sameBody: true, evidenceCount: after.payload.evidence.length, historyCount: after.payload.history.length };
    // A different key is a different operation, and stale version must still reject.
    expect((await fixtureAction(backend, { action: 'comment', text: 'Nota sintética' }, 'week09-extra-note')).ok).toBe(true);
  } finally { backend.stop(); }
});
