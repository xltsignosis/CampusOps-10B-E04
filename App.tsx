import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import { SessionManager } from './src/application/session/sessionManager';
import { IncidentClient } from './src/infrastructure/incidentClient';
import { RemoteIncidentRepository } from './src/infrastructure/remoteIncidentRepository';
import { InMemoryTelemetrySink } from './src/infrastructure/inMemoryTelemetrySink';
import { SecureSessionStore } from './src/infrastructure/secureTokenStore';
import { HttpSessionGateway } from './src/infrastructure/sessionGateway';
import { OfflineSession } from './src/ui/OfflineSession';
import { OfflineIncidentRepository } from './src/application/offlineIncidentRepository';
import { openOfflineStore } from './src/infrastructure/storage/openOfflineStore';
import type { Session } from './src/domain/session';
import { SessionGate } from './src/ui/SessionGate';
import { GeocodingClient } from './src/infrastructure/geocodingClient';


export default function App() {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>('checking');
  // Composition root: la UI recibe puertos del dominio; sólo aquí se eligen sesión y cliente HTTP.
  const telemetry = useMemo(() => new InMemoryTelemetrySink(), []);
  const sessionManager = useMemo(
    () => new SessionManager({ gateway: new HttpSessionGateway(), store: new SecureSessionStore(), telemetry }),
    [telemetry],
  );
  const incidentRepository = useMemo(
    () => new RemoteIncidentRepository(new IncidentClient({ auth: sessionManager })),
    [sessionManager],
  );

  const geocodingClient = useMemo(
    () => new GeocodingClient({ auth: sessionManager }),
    [sessionManager],
  );

  const openOfflineSession = useCallback(async (session: Session) => {
    const store = await openOfflineStore(session.actorId);
    return new OfflineIncidentRepository(store, incidentRepository, session, () => {
      const active = sessionManager.getSnapshot();
      return active.status === 'authenticated' && active.session.actorId === session.actorId;
    });
  }, [incidentRepository, sessionManager]);

  useEffect(() => {
    let active = true;
    getBackendHealth()
      .then(() => active && setStatus('available'))
      .catch(() => active && setStatus('offline'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={styles.screen}>
      <View accessibilityRole="summary" style={styles.card}>
        <Text style={styles.title}>CampusOps</Text>
        <Text style={styles.subtitle}>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status" style={styles.status}>Backend: {status}</Text>
      </View>

      <View style={styles.content}>
        <SessionGate controller={sessionManager}>
          {(session) => (
            <OfflineSession
              key={session.actorId}
              open={openOfflineSession}
              writer={incidentRepository}
              session={session}
              telemetry={telemetry}
              geocodingClient={geocodingClient}
            />
          )}
        </SessionGate>
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  card: {
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
});
