/**
 * Semana 6 — pantalla de sesión y botones por perfil. La pantalla sólo decide qué
 * ofrecer; el rechazo real (403) viene del servicio y aquí se comprueba que se muestra.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { SessionManager } from '../application/session/sessionManager';
import {
  IncidentSourceError,
  type Incident,
  type IncidentAction,
  type IncidentActions,
  type IncidentSource,
  type IncidentWriter,
} from '../domain/incident';
import { SessionError, type Session } from '../domain/session';
import { FakeClock, FakeSessionGateway, MemorySessionStore } from '../testing/sessionDoubles';

import { CampusOpsApp } from './CampusOpsApp';
import { SessionGate } from './SessionGate';

function sessionSetup() {
  const gateway = new FakeSessionGateway();
  const store = new MemorySessionStore();
  const manager = new SessionManager({ gateway, store, clock: new FakeClock() });
  return { gateway, store, manager };
}

const actorText = (view: Awaited<ReturnType<typeof render>>) =>
  (view.getByTestId('session-actor').props.children as string[]).join('');

describe('pantalla de sesión', () => {
  test('ui-login-logout: sin sesión muestra el selector; al entrar muestra el perfil y al salir borra la sesión', async () => {
    const { store, manager } = sessionSetup();
    const view = await render(
      <SessionGate controller={manager}>{(session) => <Text testID="private-area">{session.role}</Text>}</SessionGate>,
    );

    await waitFor(() => expect(view.getByText('Iniciar sesión')).toBeTruthy());
    expect(view.queryByTestId('private-area')).toBeNull();
    for (const actorId of ['reporter-1', 'reporter-2', 'technician-1', 'technician-2', 'coordinator-1']) {
      expect(view.getByTestId(`login-${actorId}`)).toBeTruthy();
    }

    await act(async () => {
      await fireEvent.press(view.getByTestId('login-technician-1'));
    });
    await waitFor(() => expect(actorText(view)).toBe('Sesión: technician-1 · Técnico'));
    expect(view.getByTestId('private-area').props.children).toBe('technician');
    expect(store.value).not.toBeNull();

    await act(async () => {
      await fireEvent.press(view.getByTestId('session-logout'));
    });
    await waitFor(() => expect(view.getByText('Iniciar sesión')).toBeTruthy());
    expect(view.queryByTestId('private-area')).toBeNull();
    expect(store.value).toBeNull();
  });

  test('ui-login-rejected: un inicio rechazado muestra un mensaje y no abre la app', async () => {
    const { gateway, manager } = sessionSetup();
    gateway.loginImpl = async () => {
      throw new SessionError('invalid_credentials');
    };
    const view = await render(
      <SessionGate controller={manager}>{() => <Text testID="private-area">privado</Text>}</SessionGate>,
    );
    await waitFor(() => expect(view.getByText('Iniciar sesión')).toBeTruthy());

    await act(async () => {
      await fireEvent.press(view.getByTestId('login-reporter-1'));
    });

    await waitFor(() => expect(view.getByTestId('session-message').props.children).toBe('Ese actor de prueba no existe.'));
    expect(view.queryByTestId('private-area')).toBeNull();
  });

  test('ui-session-expired: si la renovación falla la pantalla regresa al inicio de sesión', async () => {
    const { gateway, manager } = sessionSetup();
    const view = await render(
      <SessionGate controller={manager}>{() => <Text testID="private-area">privado</Text>}</SessionGate>,
    );
    await waitFor(() => expect(view.getByText('Iniciar sesión')).toBeTruthy());
    await act(async () => {
      await fireEvent.press(view.getByTestId('login-coordinator-1'));
    });
    await waitFor(() => expect(view.getByTestId('private-area')).toBeTruthy());

    gateway.refreshImpl = async () => {
      throw new SessionError('expired');
    };
    await act(async () => {
      await manager.onUnauthorized('request-1', 0);
    });

    await waitFor(() =>
      expect(view.getByTestId('session-message').props.children).toBe('Tu sesión expiró. Inicia sesión de nuevo.'),
    );
    expect(view.queryByTestId('private-area')).toBeNull();
  });
});

describe('operaciones por perfil', () => {
  const base: Incident = {
    id: 'campus-inc-001',
    title: 'Sin conexión en laboratorio ficticio',
    description: 'Sin conexión en laboratorio ficticio',
    category: 'connectivity',
    status: 'assigned',
    priority: 'medium',
    location: { source: 'manual', label: 'Edificio de prueba A' },
    reportedAt: null,
    assignedTechnicianId: 'technician-1',
    version: 1,
  };
  const writer: IncidentWriter = { create: async () => base };

  function sourceOf(incident: Incident): IncidentSource {
    return { getAll: async () => [incident], getById: async () => incident };
  }

  async function openDetail(session: Session, incident: Incident, actions?: IncidentActions) {
    const view = await render(
      <CampusOpsApp
        repository={sourceOf(incident)}
        writer={writer}
        session={session}
        {...(actions ? { actions } : {})}
      />,
    );
    await waitFor(() => expect(view.getByText('Incidencias Reportadas (1)')).toBeTruthy());
    const formVisible = view.queryByTestId('report-submit') !== null;
    await act(async () => {
      await fireEvent.press(view.getByTestId(`incident-item-${incident.id}`));
    });
    await waitFor(() => expect(view.getByTestId('back-to-list-button')).toBeTruthy());
    return { view, formVisible };
  }

  const noop: IncidentActions = { perform: async () => base };
  const visibleActions = (view: Awaited<ReturnType<typeof render>>) =>
    (['start', 'resolve', 'close', 'reopen'] as const).filter((name) => view.queryByTestId(`action-${name}`) !== null);

  test('ui-role-reporter: el reportante ve el formulario y ninguna operación de atención', async () => {
    const { view, formVisible } = await openDetail({ actorId: 'reporter-1', role: 'reporter' }, base, noop);

    expect(formVisible).toBe(true);
    expect(visibleActions(view)).toEqual([]);
  });

  test('ui-role-technician: sólo el técnico asignado ve "Iniciar atención" y luego "Marcar resuelta"', async () => {
    const assigned = await openDetail({ actorId: 'technician-1', role: 'technician' }, base, noop);
    expect(assigned.formVisible).toBe(false);
    expect(visibleActions(assigned.view)).toEqual(['start']);

    const inProgress = await openDetail(
      { actorId: 'technician-1', role: 'technician' },
      { ...base, status: 'in_progress', version: 2 },
      noop,
    );
    expect(visibleActions(inProgress.view)).toEqual(['resolve']);

    const other = await openDetail({ actorId: 'technician-2', role: 'technician' }, base, noop);
    expect(visibleActions(other.view)).toEqual([]);
  });

  test('ui-role-coordinator: coordinación ve cerrar y reabrir sólo cuando corresponde', async () => {
    const coordinator: Session = { actorId: 'coordinator-1', role: 'coordinator' };

    const assigned = await openDetail(coordinator, base, noop);
    expect(assigned.formVisible).toBe(false);
    expect(visibleActions(assigned.view)).toEqual([]);

    const resolved = await openDetail(coordinator, { ...base, status: 'resolved', version: 3 }, noop);
    expect(visibleActions(resolved.view)).toEqual(['close', 'reopen']);

    const closed = await openDetail(coordinator, { ...base, status: 'closed', version: 4 }, noop);
    expect(visibleActions(closed.view)).toEqual(['reopen']);
  });

  test('ui-action-flow: el técnico inicia y resuelve; la resolución exige diagnóstico', async () => {
    const calls: { baseVersion: number; action: IncidentAction; key: string }[] = [];
    const actions: IncidentActions = {
      perform: async (_id, baseVersion, action, key) => {
        calls.push({ baseVersion, action, key });
        return action.action === 'start'
          ? { ...base, status: 'in_progress', version: 2 }
          : { ...base, status: 'resolved', version: 3 };
      },
    };
    const { view } = await openDetail({ actorId: 'technician-1', role: 'technician' }, base, actions);

    await act(async () => {
      await fireEvent.press(view.getByTestId('action-start'));
    });
    await waitFor(() => expect(view.getByTestId('action-resolve')).toBeTruthy());

    // Sin diagnóstico el botón está deshabilitado y no se envía nada.
    await act(async () => {
      await fireEvent.press(view.getByTestId('action-resolve'));
    });
    expect(calls).toHaveLength(1);

    await fireEvent.changeText(view.getByTestId('action-diagnosis'), 'Cable de red ficticio reemplazado');
    await act(async () => {
      await fireEvent.press(view.getByTestId('action-resolve'));
    });
    await waitFor(() =>
      expect(view.getByTestId('campusops-notice').props.children).toBe('Incidencia actualizada: campus-inc-001'),
    );

    expect(calls.map(({ baseVersion, action }) => ({ baseVersion, action }))).toEqual([
      { baseVersion: 1, action: { action: 'start' } },
      { baseVersion: 2, action: { action: 'resolve', diagnosis: 'Cable de red ficticio reemplazado' } },
    ]);
    expect(visibleActions(view)).toEqual([]);
  });

  test('ui-action-403: si el servicio responde 403 se avisa y la incidencia no cambia en pantalla', async () => {
    const keys: string[] = [];
    const actions: IncidentActions = {
      perform: async (_id, _baseVersion, _action, key) => {
        keys.push(key);
        throw new IncidentSourceError('rejected', 403);
      },
    };
    const { view } = await openDetail({ actorId: 'technician-1', role: 'technician' }, base, actions);

    await act(async () => {
      await fireEvent.press(view.getByTestId('action-start'));
    });
    await waitFor(() =>
      expect(view.getByTestId('campusops-error').props.children).toBe('No tienes permiso para esta operación.'),
    );
    expect(visibleActions(view)).toEqual(['start']);

    // Repetir el mismo intento conserva la clave de idempotencia.
    await act(async () => {
      await fireEvent.press(view.getByTestId('action-start'));
    });
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
  });
});
