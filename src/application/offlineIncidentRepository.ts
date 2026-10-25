import type { Incident, IncidentAction, IncidentActions, IncidentEntry, IncidentSource } from '../domain/incident';
import { IncidentSourceError } from '../domain/incident';
import { availableActions } from '../domain/incidentPermissions';
import type { OfflineStore, VersionedIncident } from '../domain/offlineStore';
import type { Session } from '../domain/session';
import { saveOfflineStart } from './saveOfflineStart';
import { incidentSyncRecord, resolveSync } from './syncPolicy';
import { syncPendingOperations, versioned, type SyncResult } from './syncPendingOperations';

export interface OfflineController {
  sync(): Promise<SyncResult>;
  getSyncResult(): SyncResult | null;
  subscribe(listener: (result: SyncResult) => void): () => void;
}

/** Repositorio de la app: caché por autor, intención durable y sincronización compartida. */
export class OfflineIncidentRepository implements IncidentSource, IncidentActions, OfflineController {
  private inFlight: Promise<SyncResult> | null = null;
  private latest: SyncResult | null = null;
  private closed = false;
  private readonly listeners = new Set<(result: SyncResult) => void>();

  constructor(private readonly store: OfflineStore, private readonly remote: IncidentSource & IncidentActions,
    private readonly session: Session, private readonly isCurrentSession: () => boolean) {}

  private authorize(): void {
    if (this.closed || !this.isCurrentSession()) throw new IncidentSourceError('rejected', 401);
  }

  private canUseCache(error: unknown): boolean {
    return error instanceof IncidentSourceError && ['network', 'timeout', 'unavailable'].includes(error.kind);
  }

  private async project(remote: IncidentEntry): Promise<IncidentEntry> {
    if (!versioned(remote)) return remote;
    const pending = (await this.store.listPendingOperations()).some((operation) => operation.incidentId === remote.id);
    const cached = pending ? await this.store.getIncident(remote.id) : null;
    if (!cached) {
      await this.store.cacheIncident(remote);
      return (await this.store.getIncident(remote.id))?.local ?? remote;
    }
    const combined = resolveSync(incidentSyncRecord(cached.base), incidentSyncRecord(cached.local), incidentSyncRecord(remote));
    if (combined.kind === 'conflict') return remote; // La intención permanece en SQLite; no se impone su asignación.
    const { work, ...fields } = combined.fields;
    const state = work as Pick<Incident, 'status' | 'assignedTechnicianId'>;
    return { ...remote, ...fields, ...state } as VersionedIncident;
  }

  async getAll(): Promise<readonly IncidentEntry[]> {
    this.authorize();
    try {
      const entries = await this.remote.getAll();
      this.authorize();
      const projected = await Promise.all(entries.map((entry) => this.project(entry)));
      const ids = new Set(projected.map((entry) => entry.id));
      const pending = new Set((await this.store.listPendingOperations()).map((operation) => operation.incidentId));
      const localOnly = (await this.store.listIncidents()).filter((entry) => pending.has(entry.local.id) && !ids.has(entry.local.id));
      return [...projected, ...localOnly.map((entry) => entry.local)];
    } catch (error) {
      this.authorize();
      if (!this.canUseCache(error)) throw error;
      return (await this.store.listIncidents()).map((entry) => entry.local);
    }
  }

  async getById(id: string): Promise<IncidentEntry | null> {
    this.authorize();
    try {
      const remote = await this.remote.getById(id);
      this.authorize();
      return remote ? this.project(remote) : null;
    } catch (error) {
      this.authorize();
      if (!this.canUseCache(error)) throw error;
      return (await this.store.getIncident(id))?.local ?? null;
    }
  }

  async perform(id: string, baseVersion: number, action: IncidentAction, key: string): Promise<IncidentEntry> {
    this.authorize();
    const cached = await this.store.getIncident(id);
    if (!cached || action.action === 'comment' || !availableActions(this.session, cached.local).includes(action.action)) {
      throw new IncidentSourceError('rejected', 403);
    }
    if (cached.local.version !== baseVersion) throw new IncidentSourceError('rejected', 409);
    const queued = await this.store.listPendingOperations();
    if (queued.some((operation) => operation.incidentId === id && operation.operationId !== key)) {
      throw new IncidentSourceError('rejected', 409);
    }
    if (action.action === 'start') {
      await saveOfflineStart(this.store, this.session, cached.base, key, action.notes ?? '');
    } else {
      const status = action.action === 'resolve' ? 'resolved' : action.action === 'close' ? 'closed' : 'assigned';
      await this.store.savePendingChange({ base: cached.base, local: { ...cached.local, status }, photos: [], operation: {
        operationId: key, incidentId: id, actorId: this.session.actorId, baseVersion,
        action: action.action, payload: action.action === 'resolve' ? { diagnosis: action.diagnosis } : {},
      } });
    }
    await this.sync();
    this.authorize();
    const updated = await this.store.getIncident(id);
    if (!updated) throw new IncidentSourceError('invalid_response');
    return updated.local;
  }

  sync(): Promise<SyncResult> {
    this.authorize();
    if (this.inFlight) return this.inFlight;
    const current = syncPendingOperations(this.store, this.remote, this.session, {
      source: this.remote, isCurrentSession: () => !this.closed && this.isCurrentSession(),
    }).then((result) => {
      if (!this.closed && this.isCurrentSession()) {
        this.latest = result;
        for (const listener of this.listeners) listener(result);
      }
      return result;
    }).finally(() => { if (this.inFlight === current) this.inFlight = null; });
    this.inFlight = current;
    return current;
  }

  getSyncResult(): SyncResult | null { return this.latest; }
  subscribe(listener: (result: SyncResult) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
    await this.inFlight?.catch(() => undefined);
    await this.store.close();
  }
}
