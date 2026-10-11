import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  hasDetails,
  IncidentSourceError,
  type Incident,
  type IncidentAction,
  type IncidentActions,
  type IncidentDraft,
  type IncidentEntry,
  type IncidentSource,
  type IncidentWriter,
} from '../domain/incident';
import { availableActions } from '../domain/incidentPermissions';
import type { Session } from '../domain/session';
import type { TelemetrySink } from '../domain/telemetry';
import {
  createIncident,
  getIncidentDetail,
  getIncidentList,
  newIdempotencyKey,
  performIncidentAction,
} from '../application/incidentUseCases';
import { IncidentList } from './IncidentList';
import { IncidentDetail } from './IncidentDetail';
import { IncidentReportForm } from './IncidentReportForm';

interface CampusOpsAppProps {
  repository: IncidentSource;
  /** Si se omite, la app sólo consulta y no muestra el formulario de reporte. */
  writer?: IncidentWriter;
  /** Operaciones sobre incidencias existentes (iniciar, resolver, cerrar, reabrir). */
  actions?: IncidentActions;
  /** Perfil con sesión iniciada: decide qué se ofrece en pantalla, no qué se autoriza. */
  session?: Session;
  telemetry?: TelemetrySink;
}

// Mensajes genéricos: el detalle técnico sólo va, sanitizado, al registro de telemetría.
const LIST_ERROR = 'No se pudieron cargar las incidencias.';
const DETAIL_ERROR = 'No se pudo cargar la incidencia.';
const CREATE_ERROR = 'No se pudo crear la incidencia.';
const ACTION_ERROR = 'No se pudo aplicar la operación.';
const NO_DETAILS = 'El servidor no envió el detalle de esta incidencia.';

// Rechazos del servicio que la persona puede entender sin detalle técnico.
const REJECTION_MESSAGES: Readonly<Record<number, string>> = {
  401: 'Tu sesión ya no es válida. Inicia sesión de nuevo.',
  403: 'No tienes permiso para esta operación.',
  409: 'La incidencia cambió en el servidor. Vuelve a abrirla.',
};

// Un mensaje distinto por tipo de fallo, para que la persona sepa si conviene reintentar.
const FAILURE_MESSAGES: Readonly<Record<IncidentSourceError['kind'], string | null>> = {
  timeout: 'El servidor tardó demasiado en responder. Intenta de nuevo.',
  unavailable: 'El servicio de incidencias no está disponible en este momento.',
  invalid_response: 'El servidor envió datos inválidos y no se mostraron.',
  network: 'No hay conexión con el servidor de incidencias.',
  rejected: null,
};

function describeFailure(error: unknown, fallback: string): string {
  if (!(error instanceof IncidentSourceError)) return fallback;
  if (error.kind === 'rejected' && error.status !== undefined) {
    return REJECTION_MESSAGES[error.status] ?? fallback;
  }
  return FAILURE_MESSAGES[error.kind] ?? fallback;
}

export function CampusOpsApp({ repository, writer, actions, session, telemetry }: CampusOpsAppProps) {
  const [incidents, setIncidents] = useState<readonly IncidentEntry[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Se conserva entre reintentos del mismo borrador para que el backend no duplique.
  const pendingKey = useRef<string | null>(null);
  const pendingAction = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    getIncidentList(repository, telemetry)
      .then((data) => {
        if (active) {
          setIncidents(data);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(describeFailure(error, LIST_ERROR));
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [repository, telemetry]);

  const handleSelectIncident = async (id: string) => {
    setLoading(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const detail = await getIncidentDetail(repository, id, telemetry);
      if (detail !== null && !hasDetails(detail)) {
        setErrorMessage(NO_DETAILS);
      } else {
        setSelectedIncident(detail);
      }
    } catch (error) {
      setErrorMessage(describeFailure(error, DETAIL_ERROR));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (draft: IncidentDraft) => {
    if (!writer) return;
    pendingKey.current ??= newIdempotencyKey();
    setSubmitting(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const created = await createIncident(writer, draft, pendingKey.current, telemetry);
      pendingKey.current = null;
      setIncidents((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setNotice(`Incidencia creada: ${created.id}`);
    } catch (error) {
      setErrorMessage(describeFailure(error, CREATE_ERROR));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDraftChange = () => {
    // Un borrador distinto es otra operación: necesita otra clave.
    pendingKey.current = null;
  };

  const handleAction = async (action: IncidentAction) => {
    if (!actions || !selectedIncident || selectedIncident.version === undefined) return;
    const { id, version } = selectedIncident;
    // El mismo intento repetido conserva su clave; otra operación o versión usa una nueva.
    const signature = JSON.stringify([id, version, action]);
    if (pendingAction.current?.signature !== signature) {
      pendingAction.current = { signature, key: newIdempotencyKey(action.action) };
    }
    setSubmitting(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const updated = await performIncidentAction(actions, id, version, action, pendingAction.current.key, telemetry);
      pendingAction.current = null;
      setIncidents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedIncident(hasDetails(updated) ? updated : null);
      setNotice(`Incidencia actualizada: ${updated.id}`);
    } catch (error) {
      setErrorMessage(describeFailure(error, ACTION_ERROR));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    setSelectedIncident(null);
  };

  // Sin sesión (pruebas de semanas anteriores) se conserva el comportamiento previo.
  const canReport = writer !== undefined && (session === undefined || session.role === 'reporter');
  const detailActions =
    session && actions && selectedIncident && selectedIncident.version !== undefined
      ? availableActions(session, selectedIncident)
      : [];

  if (loading && incidents.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color="#2563eb" />
        <Text style={styles.loadingText}>Cargando incidencias...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {errorMessage ? (
        <Text testID="campusops-error" accessibilityRole="alert" style={styles.errorText}>
          {errorMessage}
        </Text>
      ) : null}
      {notice ? (
        <Text testID="campusops-notice" style={styles.noticeText}>
          {notice}
        </Text>
      ) : null}
      {selectedIncident ? (
        <IncidentDetail
          incident={selectedIncident}
          onBack={handleBack}
          actions={detailActions}
          busy={submitting}
          onAction={handleAction}
        />
      ) : (
        <>
          {canReport ? (
            <IncidentReportForm
              submitting={submitting}
              onSubmit={handleCreate}
              onDraftChange={handleDraftChange}
            />
          ) : null}
          <IncidentList incidents={incidents} onSelectIncident={handleSelectIncident} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#6b7280',
  },
  noticeText: {
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#047857',
  },
  errorText: {
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#b91c1c',
  },
});
