import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SessionError, type Session, type SessionController, type SessionSnapshot } from '../domain/session';
import { LoginScreen, ROLE_LABELS } from './LoginScreen';

interface SessionGateProps {
  controller: SessionController;
  /** Contenido que sólo existe mientras hay una sesión iniciada. */
  children: (session: Session) => ReactNode;
}

const EXPIRED_MESSAGE = 'Tu sesión expiró. Inicia sesión de nuevo.';
const UNKNOWN_ACTOR_MESSAGE = 'Ese actor de prueba no existe.';
const LOGIN_ERROR = 'No se pudo iniciar sesión. Revisa que el servicio esté disponible.';
const LOGOUT_ERROR = 'No se pudo cerrar la sesión. Intenta de nuevo.';

export function SessionGate({ controller, children }: SessionGateProps) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => controller.getSnapshot());
  const [restoring, setRestoring] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = controller.subscribe((next) => {
      if (active) setSnapshot(next);
    });
    controller
      .restore()
      .catch(() => undefined)
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [controller]);

  const handleLogin = async (actorId: string) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      await controller.login(actorId);
    } catch (error) {
      const unknownActor = error instanceof SessionError && error.kind === 'invalid_credentials';
      setErrorMessage(unknownActor ? UNKNOWN_ACTOR_MESSAGE : LOGIN_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setErrorMessage(null);
    try {
      await controller.logout();
    } catch {
      setErrorMessage(LOGOUT_ERROR);
    } finally {
      setBusy(false);
    }
  };

  if (restoring) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color="#2563eb" />
      </View>
    );
  }

  if (snapshot.status === 'anonymous') {
    const message = errorMessage ?? (snapshot.reason === 'expired' ? EXPIRED_MESSAGE : null);
    return <LoginScreen busy={busy} message={message} onLogin={handleLogin} />;
  }

  const { session } = snapshot;
  return (
    <View style={styles.container}>
      <View style={styles.sessionBar}>
        <Text testID="session-actor" style={styles.sessionText}>
          Sesión: {session.actorId} · {ROLE_LABELS[session.role]}
        </Text>
        <Pressable
          testID="session-logout"
          disabled={busy}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión"
        >
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </Pressable>
      </View>
      {errorMessage ? (
        <Text testID="session-message" accessibilityRole="alert" style={styles.errorText}>
          {errorMessage}
        </Text>
      ) : null}
      {children(session)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    padding: 24,
    alignItems: 'center',
  },
  sessionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  sessionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  logoutText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#b91c1c',
  },
  errorText: {
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#b91c1c',
  },
});
