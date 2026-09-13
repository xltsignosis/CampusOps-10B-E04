import { FlatList, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { Incident } from '../domain/incident';
import type { IncidentStatus } from '../campusops/contracts';

interface IncidentListProps {
  incidents: readonly Incident[];
  onSelectIncident: (id: string) => void;
}

const statusBadgeStyles: Record<IncidentStatus, ViewStyle> = {
  open: { backgroundColor: '#fef3c7' },
  assigned: { backgroundColor: '#dbeafe' },
  in_progress: { backgroundColor: '#e0e7ff' },
  resolved: { backgroundColor: '#dcfce7' },
  closed: { backgroundColor: '#f3f4f6' },
};

export function IncidentList({ incidents, onSelectIncident }: IncidentListProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>Incidencias Reportadas ({incidents.length})</Text>
      <FlatList
        data={incidents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            testID={`incident-item-${item.id}`}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onSelectIncident(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`Ver detalle de incidencia ${item.title}`}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.incidentId}>{item.id}</Text>
              <View style={[styles.badge, statusBadgeStyles[item.status]]}>
                <Text style={styles.badgeText}>{item.status}</Text>
              </View>
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.location}>📍 {item.location.label}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>Categoría: {item.category}</Text>
              <Text style={styles.meta}>Prioridad: {item.priority}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 12,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 6,
  },
  cardPressed: {
    backgroundColor: '#f3f4f6',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  incidentId: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  location: {
    fontSize: 13,
    color: '#4b5563',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  meta: {
    fontSize: 12,
    color: '#6b7280',
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

