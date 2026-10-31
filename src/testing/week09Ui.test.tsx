import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CampusOpsApp } from '../ui/CampusOpsApp';
import { IncidentClient } from '../infrastructure/incidentClient';
import { RemoteIncidentRepository } from '../infrastructure/remoteIncidentRepository';
import { InMemoryTelemetrySink } from '../infrastructure/inMemoryTelemetrySink';
import { nodeHttpFetch, startLocalBackend } from './localBackend';
import { incidentId, prepareAction, readIncident } from './week09Scenario';

const observations: Record<string, unknown> = {};
afterAll(() => { if (process.env.CAMPUSOPS_FAULT_OBSERVATIONS) writeFileSync(join(process.env.CAMPUSOPS_FAULT_OBSERVATIONS, 'ui.json'), JSON.stringify(observations)); });

test.each(['resolve', 'close'] as const)('ui-lost-%s: pantalla real y HTTP muestran una sola confirmación', async (action) => {
  const backend = await startLocalBackend();
  let view: Awaited<ReturnType<typeof render>> | undefined;
  try {
    const before = await prepareAction(backend, action);
    const telemetry = new InMemoryTelemetrySink();
    const actorId = action === 'resolve' ? 'technician-1' : 'coordinator-1';
    let posts = 0;
    let noticesBeforeRetry = -1;
    const fetchImpl = (async (url, init) => {
      if (init?.method === 'POST') posts += 1;
      return nodeHttpFetch(url, init);
    }) as typeof fetch;
    const client = new IncidentClient({ baseUrl: backend.baseUrl, actorId, fetchImpl, telemetry,
      scenario: 'timeout_after_commit', timeoutMs: 100,
      wait: async (delay) => {
        noticesBeforeRetry = view!.queryAllByTestId('campusops-notice').length;
        await new Promise((done) => setTimeout(done, delay));
      },
    });
    const repository = new RemoteIncidentRepository(client);
    const perform = jest.spyOn(repository, 'perform');
    view = await render(<CampusOpsApp repository={repository} actions={repository} telemetry={telemetry}
      session={{ actorId, role: action === 'resolve' ? 'technician' : 'coordinator' }} />);
    await waitFor(() => expect(view!.getByTestId('incident-item-' + incidentId)).toBeTruthy());
    await act(async () => { await fireEvent.press(view!.getByTestId('incident-item-' + incidentId)); });
    await waitFor(() => expect(view!.getByTestId('action-' + action)).toBeTruthy());
    if (action === 'resolve') await fireEvent.changeText(view.getByTestId('action-diagnosis'), 'Diagnóstico ficticio E04');
    await act(async () => { await fireEvent.press(view!.getByTestId('action-' + action)); });
    await waitFor(() => expect(view!.getByTestId('campusops-notice').props.children).toBe('Incidencia actualizada: ' + incidentId), { timeout: 4000 });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(posts).toBe(2);
    expect(noticesBeforeRetry).toBe(0);
    expect(view.queryAllByTestId('campusops-notice')).toHaveLength(1);
    expect(view.queryByTestId('campusops-error')).toBeNull();
    expect(telemetry.getEvents().filter((event) => (event as { event?: string }).event === 'incident.action.succeeded')).toHaveLength(1);
    const after = await readIncident(backend);
    expect(after.payload.history).toHaveLength(before.payload.history.length + 1);
    expect(after.payload.evidence).toEqual(before.payload.evidence);
    observations[action] = { appActionCalls: perform.mock.calls.length, httpAttempts: posts, noticesBeforeRetry,
      visibleConfirmations: view.queryAllByTestId('campusops-notice').length, historyDelta: 1,
      evidenceCount: after.payload.evidence.length, notificationScope: 'in-app confirmation; no native push', events: telemetry.getEvents() };
  } finally { await view?.unmount(); backend.stop(); }
});
