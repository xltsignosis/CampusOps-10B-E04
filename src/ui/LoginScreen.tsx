import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CampusRole } from '../campusops/contracts';

interface LoginScreenProps {
  busy: boolean;
  message: string | null;
  onLogin: (actorId: string) => void;
}

export const ROLE_LABELS: Readonly<Record<CampusRole, string>> = {
  reporter: 'Reportante',
  technician: 'Técnico',
  coordinator: 'Coordinación',
};

// Actores públicos del backend didáctico: no son cuentas ni matrículas reales.
const TEST_ACTORS: readonly Readonly<{ actorId: string; role: CampusRole }>[] = [
  { actorId: 'reporter-1', role: 'reporter' },
  { actorId: 'reporter-2', role: 'reporter' },
  { actorId: 'technician-1', role: 'technician' },
  { actorId: 'technician-2', role: 'technician' },
  { actorId: 'coordinator-1', role: 'coordinator' },
];

export function LoginScreen({ busy, message, onLogin }: LoginScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Iniciar sesión</Text>
      <Text style={styles.hint}>
        Selector de actores de prueba del curso. No es autenticación de producción: los permisos los
        valida el servicio en cada operación.
      </Text>
      {message ? (
        <Text testID="session-message" accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {TEST_ACTORS.map((actor) => (
        <Pressable
          key={actor.actorId}
          testID={`login-${actor.actorId}`}
          style={({ pressed }) => [styles.actor, (pressed || busy) && styles.actorDimmed]}
          disabled={busy}
          onPress={() => onLogin(actor.actorId)}
          accessibilityRole="button"
          accessibilityLabel={`Entrar como ${actor.actorId}`}
        >
          <Text style={styles.actorId}>{actor.actorId}</Text>
          <Text style={styles.actorRole}>{ROLE_LABELS[actor.role]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    gap: 10,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
  },
  hint: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
  },
  message: {
    fontSize: 13,
    fontWeight: '600',
    color: '#b91c1c',
  },
  actor: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  actorDimmed: {
    opacity: 0.6,
  },
  actorId: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  actorRole: {
    fontSize: 12,
    color: '#6b7280',
  },
});
