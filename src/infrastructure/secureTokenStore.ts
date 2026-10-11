import type { SessionStore, StoredSession } from '../domain/session';
import { clearSessionToken, getSessionToken, saveSessionToken } from '../lib/session/secure-session';

const ROLES: ReadonlySet<string> = new Set(['reporter', 'technician', 'coordinator']);

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.actorId === 'string' &&
    typeof item.role === 'string' &&
    ROLES.has(item.role) &&
    typeof item.accessToken === 'string' &&
    typeof item.refreshToken === 'string' &&
    typeof item.expiresAt === 'number' &&
    Number.isFinite(item.expiresAt)
  );
}

/**
 * Guarda la sesión completa en el almacenamiento cifrado de semana 4
 * (expo-secure-store). Un valor que no se puede interpretar se trata como ausente.
 */
export class SecureSessionStore implements SessionStore {
  async save(session: StoredSession): Promise<void> {
    await saveSessionToken(JSON.stringify(session));
  }

  async load(): Promise<StoredSession | null> {
    const raw = await getSessionToken();
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isStoredSession(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await clearSessionToken();
  }
}
