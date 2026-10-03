import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import { IncidentClient } from './src/infrastructure/incidentClient';
import { RemoteIncidentRepository } from './src/infrastructure/remoteIncidentRepository';
import { InMemoryTelemetrySink } from './src/infrastructure/inMemoryTelemetrySink';
import { CampusOpsApp } from './src/ui/CampusOpsApp';

export default function App() {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>('checking');
  // Composition root: la UI recibe puertos del dominio; sólo aquí se elige el cliente HTTP.
  const incidentRepository = useMemo(() => new RemoteIncidentRepository(new IncidentClient()), []);
  const telemetry = useMemo(() => new InMemoryTelemetrySink(), []);

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
        <CampusOpsApp repository={incidentRepository} writer={incidentRepository} telemetry={telemetry} />
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
