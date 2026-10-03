import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { IncidentCategory } from '../campusops/contracts';
import type { IncidentDraft } from '../domain/incident';

const CATEGORIES: readonly IncidentCategory[] = [
  'electrical',
  'laboratory',
  'water',
  'connectivity',
  'equipment',
  'safety',
  'maintenance',
];

interface IncidentReportFormProps {
  submitting: boolean;
  onSubmit: (draft: IncidentDraft) => void;
  onDraftChange: () => void;
}

export function IncidentReportForm({ submitting, onSubmit, onDraftChange }: IncidentReportFormProps) {
  const [category, setCategory] = useState<IncidentCategory>('connectivity');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const canSubmit = !submitting && description.trim().length > 0 && location.trim().length > 0;

  const update = (apply: () => void) => {
    apply();
    onDraftChange();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.header}>Reportar incidencia</Text>
      <View style={styles.categories}>
        {CATEGORIES.map((item) => (
          <Pressable
            key={item}
            testID={`report-category-${item}`}
            accessibilityRole="button"
            accessibilityState={{ selected: item === category }}
            style={[styles.chip, item === category && styles.chipSelected]}
            onPress={() => update(() => setCategory(item))}
          >
            <Text style={styles.chipText}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        testID="report-description"
        style={styles.input}
        placeholder="Descripción"
        value={description}
        onChangeText={(text) => update(() => setDescription(text))}
      />
      <TextInput
        testID="report-location"
        style={styles.input}
        placeholder="Ubicación"
        value={location}
        onChangeText={(text) => update(() => setLocation(text))}
      />
      <Pressable
        testID="report-submit"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        style={[styles.submit, !canSubmit && styles.submitDisabled]}
        onPress={() => onSubmit({ category, description: description.trim(), location: location.trim() })}
      >
        <Text style={styles.submitText}>{submitting ? 'Enviando...' : 'Enviar reporte'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 12,
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  header: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f2937',
  },
  categories: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
  },
  chipSelected: {
    backgroundColor: '#dbeafe',
  },
  chipText: {
    fontSize: 11,
    color: '#1f2937',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  submit: {
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  submitDisabled: {
    backgroundColor: '#93c5fd',
  },
  submitText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
});
