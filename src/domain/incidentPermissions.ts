import type { Incident, IncidentActionName } from './incident';
import type { Session } from './session';

/**
 * Operaciones que la interfaz ofrece según el perfil y el estado de la incidencia.
 * Sólo decide qué botones mostrar: quien autoriza de verdad es el servicio, que
 * responde 403 aunque la solicitud se envíe sin pasar por la pantalla.
 */
export function availableActions(session: Session, incident: Incident): readonly IncidentActionName[] {
  if (session.role === 'technician' && incident.assignedTechnicianId === session.actorId) {
    if (incident.status === 'assigned') return ['start'];
    if (incident.status === 'in_progress') return ['resolve'];
    return [];
  }
  if (session.role === 'coordinator') {
    if (incident.status === 'resolved') return ['close', 'reopen'];
    if (incident.status === 'closed') return ['reopen'];
  }
  return [];
}
