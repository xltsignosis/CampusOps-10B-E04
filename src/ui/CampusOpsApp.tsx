import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Incident, IncidentRepository } from '../domain/incident';
import { getIncidentDetail, getIncidentList } from '../application/incidentUseCases';
import { IncidentList } from './IncidentList';
import { IncidentDetail } from './IncidentDetail';

interface CampusOpsAppProps {
  repository: IncidentRepository;
}

export function CampusOpsApp({ repository }: CampusOpsAppProps) {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    getIncidentList(repository)
      .then((data) => {
        if (active) {
          setIncidents(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [repository]);

  const handleSelectIncident = async (id: string) => {
    setLoading(true);
    try {
      const detail = await getIncidentDetail(repository, id);
      setSelectedIncident(detail);
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
});
