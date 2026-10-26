import type { PendingIncidentOperation } from '../campusops/contracts';
import type { Incident } from './incident';

export type VersionedIncident = Incident & Readonly<{ version: number }>;

/** La base remota no se reemplaza con la intención local durante el trabajo offline. */
export type LocalIncident = Readonly<{
  base: VersionedIncident;
  local: VersionedIncident;
}>;

/** Referencia local: no es un comprobante de carga ni contiene bytes de la imagen. */
export type PendingPhotoReference = Readonly<{
  referenceId: string;
  incidentId: string;
  actorId: string;
  localUri: string;
  status: 'pending';
}>;

export type PendingLocalChange = LocalIncident & Readonly<{
  operation: PendingIncidentOperation;
  photos: readonly PendingPhotoReference[];
}>;

/** El sincronizador construye este recibo sólo después de validar una respuesta exitosa. */
export type OperationConfirmation = Readonly<{
  operationId: string;
  incidentId: string;
  actorId: string;
  serverVersion: number;
  confirmed: true;
  serverIncident?: VersionedIncident;
  followup?: PendingIncidentOperation;
}>;

/** Puerto acotado al actor de la sesión; no guarda ni restablece credenciales. */
export interface OfflineStore {
  savePendingChange(change: PendingLocalChange): Promise<void>;
  cacheIncident(incident: VersionedIncident): Promise<void>;
  listIncidents(): Promise<readonly LocalIncident[]>;
  getIncident(incidentId: string): Promise<LocalIncident | null>;
  listPendingOperations(): Promise<readonly PendingIncidentOperation[]>;
  listPendingPhotos(incidentId: string): Promise<readonly PendingPhotoReference[]>;
  removeConfirmedOperation(confirmation: OperationConfirmation): Promise<boolean>;
  close(): Promise<void>;
}
