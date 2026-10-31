import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { IncidentWriter } from '../domain/incident';
import type { Session } from '../domain/session';
import type { TelemetrySink } from '../domain/telemetry';
import type { OfflineIncidentRepository } from '../application/offlineIncidentRepository';
import { CampusOpsApp } from './CampusOpsApp';
import type { GeocodingResolver } from '../domain/geocoding';

export function OfflineSession({
  session,
  open,
  writer,
  telemetry,
  geocodingClient,
}: {
  session: Session;
  open: (session: Session) => Promise<OfflineIncidentRepository>;
  writer: IncidentWriter;
  telemetry: TelemetrySink;
  geocodingClient: GeocodingResolver;
}) {
  const [repository, setRepository] = useState<OfflineIncidentRepository | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let current: OfflineIncidentRepository | undefined;
    open(session).then(async (opened) => {
      current = opened;
      if (disposed) { await opened.close(); return; }
      setRepository(opened);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; void current?.close().catch(() => undefined); };
  }, [open, session]);
  if (failed) return <Text accessibilityRole="alert">No se pudo abrir el almacenamiento local. Los datos se conservaron para recuperación.</Text>;
  if (!repository) return <View><ActivityIndicator /><Text>Recuperando incidencias...</Text></View>;
  return (
    <CampusOpsApp
      repository={repository}
      actions={repository}
      writer={writer}
      session={session}
      telemetry={telemetry}
      offline={repository}
      geocodingClient={geocodingClient}
    />
  );
}