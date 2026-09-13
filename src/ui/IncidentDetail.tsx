import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { Incident } from '../domain/incident';
import type { IncidentStatus } from '../campusops/contracts';

interface IncidentDetailProps {
  incident: Incident;
  onBack: () => void;
}

const statusBadgeStyles: Record<IncidentStatus, ViewStyle> = {
  open: { backgroundColor: '#fef3c7' },
  assigned: { backgroundColor: '#dbeafe' },
  in_progress: { backgroundColor: '#e0e7ff' },
  resolved: { backgroundColor: '#dcfce7' },
  closed: { backgroundColor: '#f3f4f6' },
};

export function IncidentDetail({ incident, onBack }: IncidentDetailProps) {
  return (
    <View style={styles.container}>
      <Pressable
        testID="back-to-list-button"
        style={styles.backButton}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Regresar a la lista de incidencias"
      >
        <Text style={styles.backButtonText}>← Regresar a la lista</Text>
      </Pressable>

      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.incidentId}>{incident.id}</Text>
          <View style={[styles.badge, statusBadgeStyles[incident.status]]}>
            <Text style={styles.badgeText}>{incident.status}</Text>
          </View>
        </View>

        <Text style={styles.title}>{incident.title}</Text>
        <Text style={styles.description}>{incident.description}</Text>

        <View style={styles.divider} />

        <View style={styles.detailRow}>
          <Text style={styles.label}>Ubicación:</Text>
          <Text style={styles.value}>{incident.location.label}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.label}>Categoría:</Text>
          <Text style={styles.value}>{incident.category}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.label}>Prioridad:</Text>
          <Text style={styles.value}>{incident.priority}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.label}>Técnico asignado:</Text>
          <Text style={styles.value}>
            {incident.assignedTechnicianId ?? 'Sin asignar'}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.label}>Fecha de reporte:</Text>
          <Text style={styles.value}>{incident.reportedAt}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 12,
  },
  backButton: {
    paddingVertical: 8,
    marginBottom: 12,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563eb',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  incidentId: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  description: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  value: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});

