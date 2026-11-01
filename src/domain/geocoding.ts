import type { IncidentLocation } from '../campusops/contracts';

export interface GeocodingResolver {
  resolve(
    query: string,
    manualLabel: string,
  ): Promise<IncidentLocation>;
}