import type { IncidentLocation } from '../campusops/contracts';

/** Shared by the app and public evaluation facade. */
export function selectIncidentLocation(provider: unknown, manualLabel: string): IncidentLocation {
  const manual: IncidentLocation = { source: 'manual', label: manualLabel };
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return manual;
  const value = provider as Record<string, unknown>;
  if (value.error || (typeof value.status === 'number' && value.status >= 400) ||
    typeof value.label !== 'string' || !value.label.trim() ||
    typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) ||
    value.latitude < -90 || value.latitude > 90 ||
    typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) ||
    value.longitude < -180 || value.longitude > 180) return manual;
  return { source: 'provider', label: value.label, latitude: value.latitude, longitude: value.longitude };
}
