import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import type { Incident, IncidentAction, IncidentActionName } from '../domain/incident';
import type { IncidentStatus } from '../campusops/contracts';

interface IncidentDetailProps {
  incident: Incident;
  onBack: () => void;
  /** Operaciones que el perfil puede intentar. Vacío o ausente: sólo lectura. */
  actions?: readonly IncidentActionName[];
  busy?: boolean;
  onAction?: (action: IncidentAction) => void;
}

const ACTION_LABELS: Readonly<Record<IncidentActionName, string>> = {
  start: 'Iniciar atención',
  resolve: 'Marcar resuelta',
  close: 'Cerrar incidencia',
  reopen: 'Reabrir incidencia',
};

const statusBadgeStyles: Record<IncidentStatus, ViewStyle> = {
  open: { backgroundColor: '#fef3c7' },
  assigned: { backgroundColor: '#dbeafe' },
  in_progress: { backgroundColor: '#e0e7ff' },
  resolved: { backgroundColor: '#dcfce7' },
  closed: { backgroundColor: '#f3f4f6' },
};

export function IncidentDetail({ incident, onBack, actions = [], busy = false, onAction }: IncidentDetailProps) {
  const [diagnosis, setDiagnosis] = useState<string>('');

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
          <Text style={styles.value}>{incident.reportedAt ?? 'No disponible'}</Text>
        </View>
      </View>

      {onAction && actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.includes('resolve') ? (
            <TextInput
              testID="action-diagnosis"
              style={styles.input}
              placeholder="Diagnóstico de la resolución"
              value={diagnosis}
              onChangeText={setDiagnosis}
              editable={!busy}
              accessibilityLabel="Diagnóstico de la resolución"
            />
          ) : null}
          {actions.map((name) => {
            const disabled = busy || (name === 'resolve' && diagnosis.trim().length === 0);
            return (
              <Pressable
                key={name}
                testID={`action-${name}`}
                style={[styles.actionButton, disabled && styles.actionDisabled]}
                disabled={disabled}
                onPress={() =>
                  onAction(name === 'resolve' ? { action: 'resolve', diagnosis: diagnosis.trim() } : { action: name })
                }
                accessibilityRole="button"
                accessibilityLabel={ACTION_LABELS[name]}
              >
                <Text style={styles.actionText}>{ACTION_LABELS[name]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
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
  actions: {
    marginTop: 12,
    gap: 8,
  },
  input: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  actionButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});

