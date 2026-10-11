/**
 * Semana 6 — ciclo de sesión con dobles y reloj controlable: inicio, expiración,
 * renovación compartida, fallo de renovación y cierre. Sólo valores ficticios.
 */
import { SessionError, type SessionSnapshot, type TokenGrant } from '../../domain/session';
import {
  deferred,
  EXPIRES_IN_MS,
  FakeClock,
  FakeSessionGateway,
  MemorySessionStore,
  MemorySink,
  tokenGrant,
} from '../../testing/sessionDoubles';

import { SessionManager } from './sessionManager';

function setup() {
  const clock = new FakeClock();
  const gateway = new FakeSessionGateway();
  const store = new MemorySessionStore();
  const telemetry = new MemorySink();
  const manager = new SessionManager({ gateway, store, clock, telemetry });
  const snapshots: SessionSnapshot[] = [];
  manager.subscribe((snapshot) => snapshots.push(snapshot));
  return { clock, gateway, store, telemetry, manager, snapshots };
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return (error as SessionError).kind;
  }
}

describe('inicio de sesión', () => {
  test('auth-login-ok: guarda los tokens en el store y la sesión visible no los contiene', async () => {
    const { manager, store, gateway } = setup();

    await expect(manager.login('technician-1')).resolves.toEqual({ actorId: 'technician-1', role: 'technician' });

    expect(gateway.loginCalls).toEqual(['technician-1']);
    expect(manager.getSnapshot()).toEqual({
      status: 'authenticated',
      session: { actorId: 'technician-1', role: 'technician' },
    });
    expect(store.value).toEqual({
      actorId: 'technician-1',
      role: 'technician',
      accessToken: 'course-token-g0',
      refreshToken: 'course-refresh-g0',
      expiresAt: EXPIRES_IN_MS,
    });
    expect(JSON.stringify(manager.getSnapshot())).not.toContain('course-token');
  });

  test('auth-login-rejected: un actor rechazado no deja sesión ni tokens guardados', async () => {
    const { manager, store, gateway } = setup();
    gateway.loginImpl = async () => {
      throw new SessionError('invalid_credentials');
    };

    expect(await kindOf(manager.login('actor-desconocido'))).toBe('invalid_credentials');

    expect(manager.getSnapshot()).toEqual({ status: 'anonymous', reason: 'initial' });
    expect(store.value).toBeNull();
    expect(store.saves).toBe(0);
    expect(await kindOf(manager.authorize('request-1'))).toBe('unauthenticated');
  });

  test('auth-restore: recupera una sesión vigente sin llamar al servicio y descarta una vencida', async () => {
    const valid = setup();
    valid.store.value = {
      actorId: 'coordinator-1',
      role: 'coordinator',
      accessToken: 'course-token-g0',
      refreshToken: 'course-refresh-g0',
      expiresAt: 1_000,
    };
    await expect(valid.manager.restore()).resolves.toEqual({
      status: 'authenticated',
      session: { actorId: 'coordinator-1', role: 'coordinator' },
    });
    expect(valid.gateway.loginCalls).toEqual([]);

    const expired = setup();
    expired.store.value = { ...valid.store.value, expiresAt: 1_000 };
    expired.clock.advance(1_000);
    await expect(expired.manager.restore()).resolves.toEqual({ status: 'anonymous', reason: 'expired' });
    expect(expired.store.value).toBeNull();

    const broken = setup();
    broken.store.load = async () => {
      throw new Error('almacenamiento no disponible');
    };
    await expect(broken.manager.restore()).resolves.toEqual({ status: 'anonymous', reason: 'initial' });
  });
});

describe('expiración con reloj controlable', () => {
  test('auth-expiry-boundary: a 59 999 ms no renueva; a 60 000 ms renueva una vez', async () => {
    const { manager, clock, gateway } = setup();
    await manager.login('technician-1');

    clock.advance(EXPIRES_IN_MS - 1);
    await expect(manager.authorize('request-1')).resolves.toEqual({
      accessToken: 'course-token-g0',
      actorId: 'technician-1',
      generation: 0,
    });
    expect(gateway.refreshCalls).toHaveLength(0);

    clock.advance(1);
    await expect(manager.authorize('request-2')).resolves.toEqual({
      accessToken: 'course-token-g1',
      actorId: 'technician-1',
      generation: 1,
    });
    expect(gateway.refreshCalls).toEqual(['course-refresh-g0']);
  });

  test('auth-expiry-shared: tres solicitudes que encuentran el token vencido comparten una renovación', async () => {
    const { manager, clock, gateway, store } = setup();
    await manager.login('technician-1');
    clock.advance(EXPIRES_IN_MS);

    const credentials = await Promise.all([
      manager.authorize('request-1'),
      manager.authorize('request-2'),
      manager.authorize('request-3'),
    ]);

    expect(gateway.refreshCalls).toHaveLength(1);
    expect(credentials.map((item) => item.generation)).toEqual([1, 1, 1]);
    expect(store.value?.expiresAt).toBe(EXPIRES_IN_MS * 2);
  });
});

describe('renovación compartida ante 401', () => {
  test('conc-single-flight: tres 401 simultáneos esperan una sola renovación y se reintentan una vez', async () => {
    const { manager, gateway, store } = setup();
    await manager.login('technician-1');
    const pending = deferred<TokenGrant>();
    gateway.refreshImpl = () => pending.promise;

    const results = Promise.all([
      manager.onUnauthorized('request-1', 0),
      manager.onUnauthorized('request-2', 0),
      manager.onUnauthorized('request-3', 0),
    ]);
    await Promise.resolve();

    // Mientras la renovación está en curso sólo existe una llamada y nadie se reintentó.
    expect(gateway.refreshCalls).toHaveLength(1);
    expect(manager.getRefreshStats()).toEqual({ refreshCalls: 1, retriedRequests: 0, generation: 0 });

    pending.resolve(tokenGrant(1));
    await expect(results).resolves.toEqual([true, true, true]);

    expect(gateway.refreshCalls).toHaveLength(1);
    expect(manager.getRefreshStats()).toEqual({ refreshCalls: 1, retriedRequests: 3, generation: 1 });
    expect(store.value).toMatchObject({ accessToken: 'course-token-g1', refreshToken: 'course-refresh-g1' });
  });

  test('conc-bounded-retry: un segundo 401 de la misma solicitud no renueva otra vez', async () => {
    const { manager, gateway } = setup();
    await manager.login('technician-1');

    await expect(manager.onUnauthorized('request-1', 0)).resolves.toBe(true);
    await expect(manager.onUnauthorized('request-1', 1)).resolves.toBe(false);
    await expect(manager.onUnauthorized('request-1', 1)).resolves.toBe(false);

    expect(gateway.refreshCalls).toHaveLength(1);
    expect(manager.getRefreshStats().refreshCalls).toBe(1);
  });

  test('conc-late-401: un 401 tardío de la generación anterior usa el token ya renovado', async () => {
    const { manager, gateway } = setup();
    await manager.login('technician-1');
    await manager.onUnauthorized('request-1', 0);

    await expect(manager.onUnauthorized('request-2', 0)).resolves.toBe(true);

    expect(gateway.refreshCalls).toHaveLength(1);
    await expect(manager.authorize('request-2')).resolves.toMatchObject({ accessToken: 'course-token-g1', generation: 1 });
  });

  test('conc-new-generation: cuando vence el token renovado se permite una renovación nueva', async () => {
    const { manager, gateway } = setup();
    await manager.login('technician-1');
    await manager.onUnauthorized('request-1', 0);

    await expect(
      Promise.all([manager.onUnauthorized('request-2', 1), manager.onUnauthorized('request-3', 1)]),
    ).resolves.toEqual([true, true]);

    expect(gateway.refreshCalls).toEqual(['course-refresh-g0', 'course-refresh-g1']);
    expect(manager.getRefreshStats()).toEqual({ refreshCalls: 2, retriedRequests: 3, generation: 2 });
  });
});

describe('fallo de renovación', () => {
  test('auth-refresh-failed: regresa a no autenticado, borra los tokens y no entra en bucle', async () => {
    const { manager, gateway, store, snapshots } = setup();
    await manager.login('technician-1');
    const pending = deferred<TokenGrant>();
    gateway.refreshImpl = () => pending.promise;

    const results = Promise.all([
      manager.onUnauthorized('request-1', 0),
      manager.onUnauthorized('request-2', 0),
    ]);
    pending.reject(new SessionError('expired'));

    await expect(results).resolves.toEqual([false, false]);
    expect(manager.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(snapshots.at(-1)).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(store.value).toBeNull();

    // Después del fallo nada vuelve a llamar al servicio de renovación.
    await expect(manager.onUnauthorized('request-1', 0)).resolves.toBe(false);
    await expect(manager.onUnauthorized('request-3', 0)).resolves.toBe(false);
    expect(await kindOf(manager.authorize('request-4'))).toBe('unauthenticated');
    expect(gateway.refreshCalls).toHaveLength(1);
  });

  test('auth-refresh-unavailable: si el servicio no responde también se cierra la sesión', async () => {
    const { manager, gateway, store, clock } = setup();
    await manager.login('technician-1');
    gateway.refreshImpl = async () => {
      throw new Error('ECONNREFUSED');
    };
    clock.advance(EXPIRES_IN_MS);

    expect(await kindOf(manager.authorize('request-1'))).toBe('expired');

    expect(manager.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(store.value).toBeNull();
    expect(gateway.refreshCalls).toHaveLength(1);
  });

  test('auth-refresh-stale-after-logout: una renovación que llega después del cierre no guarda nada', async () => {
    const { manager, gateway, store } = setup();
    await manager.login('technician-1');
    const pending = deferred<TokenGrant>();
    gateway.refreshImpl = () => pending.promise;

    const waiting = manager.onUnauthorized('request-1', 0);
    await manager.logout();
    pending.resolve(tokenGrant(1));

    await expect(waiting).resolves.toBe(false);
    expect(manager.getSnapshot()).toEqual({ status: 'anonymous', reason: 'logout' });
    expect(store.value).toBeNull();
  });

  test('auth-refresh-stale-other-session: la renovación de una sesión cerrada no toca la sesión nueva', async () => {
    const { manager, gateway, store } = setup();
    await manager.login('technician-1');
    const pending = deferred<TokenGrant>();
    gateway.refreshImpl = () => pending.promise;

    const waiting = manager.onUnauthorized('request-1', 0);
    await manager.logout();
    await manager.login('coordinator-1');
    pending.resolve({ accessToken: 'course-token-obsoleto', refreshToken: 'course-refresh-obsoleto', expiresInMs: 1 });

    await expect(waiting).resolves.toBe(false);
    expect(store.value).toMatchObject({ actorId: 'coordinator-1', accessToken: 'course-token-g0' });
    await expect(manager.authorize('request-2')).resolves.toMatchObject({ accessToken: 'course-token-g0', generation: 0 });
  });
});

describe('cierre de sesión', () => {
  test('auth-logout-clears: después del cierre no queda token persistido ni se autorizan solicitudes', async () => {
    const { manager, gateway, store, snapshots } = setup();
    await manager.login('technician-1');
    expect(store.value).not.toBeNull();

    await manager.logout();

    expect(store.value).toBeNull();
    expect(store.clears).toBe(1);
    expect(snapshots.at(-1)).toEqual({ status: 'anonymous', reason: 'logout' });
    expect(await kindOf(manager.authorize('request-1'))).toBe('unauthenticated');
    await expect(manager.onUnauthorized('request-1', 0)).resolves.toBe(false);
    expect(gateway.refreshCalls).toHaveLength(0);
  });
});

describe('tokens fuera de los registros', () => {
  test('auth-no-token-in-logs: ni los eventos de sesión ni los errores contienen tokens o actor', async () => {
    const { manager, gateway, telemetry } = setup();
    await manager.login('technician-1');
    await manager.onUnauthorized('request-1', 0);
    gateway.refreshImpl = async () => {
      throw new Error('fallo con Bearer course-token-g1 y course-refresh-g1 de technician-1');
    };
    await manager.onUnauthorized('request-2', 1);

    gateway.loginImpl = async () => {
      throw new Error('login fallido para technician-1 con course-refresh-g0');
    };
    const loginError = await manager.login('technician-1').catch((error: unknown) => error);

    await manager.login('coordinator-1').catch(() => undefined);
    await manager.logout();

    const serialized = JSON.stringify(telemetry.events);
    expect(serialized).toContain('session.login.succeeded');
    expect(serialized).toContain('session.refresh.succeeded');
    expect(serialized).toContain('session.refresh.failed');
    expect(serialized).toContain('session.login.failed');
    for (const secret of ['course-token', 'course-refresh', 'Bearer', 'technician-1']) {
      expect(serialized).not.toContain(secret);
    }
    expect(loginError).toBeInstanceOf(SessionError);
    expect((loginError as SessionError).message).toBe('Sesión: unavailable');
  });
});
