import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Incident, IncidentRepository } from '../domain/incident';
import type { TelemetrySink } from '../domain/telemetry';
import { getIncidentDetail, getIncidentList } from '../application/incidentUseCases';
import { IncidentList } from './IncidentList';
import { IncidentDetail } from './IncidentDetail';

interface CampusOpsAppProps {
  repository: IncidentRepository;
  telemetry?: TelemetrySink;
}

// Mensajes genéricos: el detalle técnico sólo va, sanitizado, al registro de telemetría.
const LIST_ERROR = 'No se pudieron cargar las incidencias.';
const DETAIL_ERROR = 'No se pudo cargar la incidencia.';

export function CampusOpsApp({ repository, telemetry }: CampusOpsAppProps) {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getIncidentList(repository, telemetry)
      .then((data) => {
        if (active) {
          setIncidents(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setErrorMessage(LIST_ERROR);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [repository, telemetry]);

  const handleSelectIncident = async (id: string) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const detail = await getIncidentDetail(repository, id, telemetry);
      setSelectedIncident(detail);
    } catch {
      setErrorMessage(DETAIL_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setSelectedIncident(null);
  };

  if (loading && incidents.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color="#2563eb" />
        <Text style={styles.loadingText}>Cargando incidencias...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {errorMessage ? (
        <Text testID="campusops-error" accessibilityRole="alert" style={styles.errorText}>
          {errorMessage}
        </Text>
      ) : null}
      {selectedIncident ? (
        <IncidentDetail incident={selectedIncident} onBack={handleBack} />
      ) : (
        <IncidentList incidents={incidents} onSelectIncident={handleSelectIncident} />
      )}
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
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#6b7280',
  },
  errorText: {
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#b91c1c',
  },
});
