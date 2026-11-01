import { useEffect, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { IncidentCategory, IncidentLocation } from '../campusops/contracts';
import type { IncidentDraft } from '../domain/incident';
import type { GeocodingResolver } from '../domain/geocoding';

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
  geocodingClient?: GeocodingResolver | undefined;
}

export function IncidentReportForm({
  submitting,
  onSubmit,
  onDraftChange,
  geocodingClient,
}: IncidentReportFormProps) {
  const [category, setCategory] =
    useState<IncidentCategory>('connectivity');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [resolving, setResolving] = useState(false);
  const [suggestion, setSuggestion] = useState<IncidentLocation | null>(null);
  const [accepted, setAccepted] = useState<IncidentLocation | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const searchSequence = useRef(0);
  useEffect(() => () => { searchSequence.current += 1; }, []);

  const canSubmit = !submitting && description.trim().length > 0 && location.trim().length > 0;
  const update = (apply: () => void) => { apply(); onDraftChange(); };
  const invalidateSearch = () => {
    searchSequence.current += 1;
    setResolving(false);
    setSuggestion(null);
    setAccepted(null);
    setLocationNotice(null);
  };
  const search = async () => {
    if (!geocodingClient || resolving || !location.trim()) return;
    const sequence = ++searchSequence.current;
    const manual = location.trim();
    setResolving(true);
    setSuggestion(null);
    setAccepted(null);
    onDraftChange();
    setLocationNotice(null);
    try {
      const result = await geocodingClient.resolve(manual, manual);
      if (sequence !== searchSequence.current) return;
      if (result.source === 'provider') setSuggestion(result);
      else setLocationNotice('Ubicación externa no disponible. Puedes enviar tu referencia manual.');
    } catch {
      if (sequence === searchSequence.current) setLocationNotice('Puedes continuar con tu referencia manual.');
    } finally {
      if (sequence === searchSequence.current) setResolving(false);
    }
  };
  const handleSubmit = () => {
    if (!canSubmit) return;
    searchSequence.current += 1;
    setResolving(false);
    const coordinates = accepted?.source === 'provider' ? {
      latitude: accepted.latitude!, longitude: accepted.longitude!,
    } : undefined;
    onSubmit({ category, description: description.trim(), location: accepted?.label ?? location.trim(),
      ...(coordinates ? { coordinates } : {}) });
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
            style={[
              styles.chip,
              item === category && styles.chipSelected,
            ]}
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
        onChangeText={(text) =>
          update(() => setDescription(text))
        }
      />

      <TextInput
        testID="report-location"
        style={styles.input}
        placeholder="Edificio, zona o referencia"
        value={location}
        onChangeText={(text) =>
          update(() => { invalidateSearch(); setLocation(text); })
        }
      />

      {geocodingClient ? <View style={{ gap: 8 }}>
        <Pressable testID="location-search" accessibilityRole="button" disabled={resolving || submitting || !location.trim()}
          onPress={() => { void search(); }}><Text>{resolving ? 'Buscando ubicación...' : 'Buscar ubicación (opcional)'}</Text></Pressable>
        {suggestion ? <View>
          <Text testID="location-suggestion">{suggestion.label}</Text>
          <Pressable testID="location-accept" accessibilityRole="button" onPress={() => update(() => {
            setAccepted(suggestion); setSuggestion(null); setLocationNotice('Ubicación externa seleccionada.');
          })}><Text>Usar esta ubicación</Text></Pressable>
        </View> : null}
        {accepted ? <Text testID="location-selected">{accepted.label}</Text> : null}
        {suggestion || accepted ? <Text accessibilityRole="link" onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright'); }}>
          Photon · © OpenStreetMap contributors
        </Text> : null}
        {accepted ? <Pressable testID="location-manual" accessibilityRole="button"
          onPress={() => update(invalidateSearch)}><Text>Usar mi referencia manual</Text></Pressable> : null}
        {locationNotice ? <Text testID="location-notice">{locationNotice}</Text> : null}
      </View> : null}

      <Pressable
        testID="report-submit"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        style={[
          styles.submit,
          !canSubmit && styles.submitDisabled,
        ]}
        onPress={handleSubmit}
      >
        <Text style={styles.submitText}>
          {submitting ? 'Enviando...' : 'Enviar reporte'}
        </Text>
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
