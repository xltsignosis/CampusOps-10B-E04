/**
 * Semana 6 — la app completa (App.tsx) con el almacenamiento seguro simulado y un
 * backend doble: iniciar sesión guarda la sesión cifrada y cerrarla la elimina.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import App from '../App';

const mockSecureItems = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureItems.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockSecureItems.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureItems.delete(key);
  }),
}));

jest.mock('./api/courseBackend', () => ({
  getBackendHealth: jest.fn().mockResolvedValue({ ok: true, service: 'dmi-controlled-backend', contractVersion: 1 }),
}));

const incident = {
  id: 'campus-inc-001',
  version: 1,
  status: 'assigned',
  payload: {
    category: 'connectivity',
    description: 'Sin conexión en laboratorio ficticio',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
    priority: 'medium',
  },
};

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const originalFetch = global.fetch;
const requests: { path: string; authorization: string | undefined }[] = [];

beforeEach(() => {
  mockSecureItems.clear();
  requests.length = 0;
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({ path, authorization: headers.Authorization });
    if (path === '/v1/session/login') {
      return response(200, {
        actorId: 'technician-1',
        role: 'technician',
        accessToken: 'course-valid-token',
        refreshToken: 'course-refresh-0',
        expiresIn: 60,
      });
    }
    return headers.Authorization === 'Bearer course-valid-token'
      ? response(200, { items: [incident] })
      : response(401, { code: 'unauthorized' });
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('auth-app-secure-store: la sesión se guarda cifrada al entrar y no queda nada al cerrar', async () => {
  const view = await render(<App />);
  await waitFor(() => expect(view.getByText('Iniciar sesión')).toBeTruthy());
  expect(mockSecureItems.size).toBe(0);
  // Sin sesión la app no consulta incidencias.
  expect(requests).toEqual([]);

  await act(async () => {
    await fireEvent.press(view.getByTestId('login-technician-1'));
  });
  await waitFor(() => expect(view.getByText('Incidencias Reportadas (1)')).toBeTruthy());

  expect([...mockSecureItems.keys()]).toEqual(['campusops-session-token']);
  expect(JSON.parse(mockSecureItems.get('campusops-session-token') ?? '{}')).toMatchObject({
    actorId: 'technician-1',
    role: 'technician',
    refreshToken: 'course-refresh-0',
  });
  expect(requests.map((request) => request.path)).toEqual(['/v1/session/login', '/v1/incidents']);

  await act(async () => {
    await fireEvent.press(view.getByTestId('session-logout'));
  });
  await waitFor(() => expect(view.getByText('Iniciar sesión')).toBeTruthy());

  expect(mockSecureItems.size).toBe(0);
  expect(view.queryByText('Incidencias Reportadas (1)')).toBeNull();
});

test('auth-app-restore: al abrir la app con una sesión guardada vigente no se pide iniciar sesión otra vez', async () => {
  mockSecureItems.set(
    'campusops-session-token',
    JSON.stringify({
      actorId: 'technician-1',
      role: 'technician',
      accessToken: 'course-valid-token',
      refreshToken: 'course-refresh-0',
      expiresAt: Date.now() + 60_000,
    }),
  );

  const view = await render(<App />);

  await waitFor(() => expect(view.getByText('Incidencias Reportadas (1)')).toBeTruthy());
  expect(requests.map((request) => request.path)).toEqual(['/v1/incidents']);
});

test('auth-app-restore-invalid: un valor guardado que no se puede interpretar se trata como sin sesión', async () => {
  mockSecureItems.set('campusops-session-token', 'valor-que-no-es-json');

  const view = await render(<App />);

  await waitFor(() => expect(view.getByText('Iniciar sesión')).toBeTruthy());
  expect(requests).toEqual([]);
});
