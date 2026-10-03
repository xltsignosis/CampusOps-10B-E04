# Contrato de datos — Cliente de incidencias (CampusOps)

## Propósito

Este documento describe qué datos se envían y reciben al consultar lista,
detalle y crear incidencias contra el backend didáctico, y justifica el
límite entre el DTO remoto, el objeto de dominio que usa la aplicación, y
la representación de errores.

## Las tres capas de datos

### 1. DTO — `RemoteResource` (src/infrastructure/remoteResource.ts)

Es el "sobre" crudo tal como lo publica el backend, validado únicamente en
su forma genérica, sin conocer nada sobre incidencias:

```typescript
type RemoteResource = {
  id: string;
  version: number;   // entero, no negativo
  status: string;
  payload: Record<string, unknown> | null;
};
```

`parseRemoteResource` valida solo esta forma genérica: `id` y `status` no
vacíos, `version` entera no negativa, y `payload` como objeto **o null**
(un payload nulo es un valor válido del contrato, no un error — por
ejemplo, una incidencia cerrada puede no requerir detalle adicional).
Cualquier campo adicional del sobre que el backend agregue en el futuro
se ignora sin romper la validación (compatibilidad hacia adelante).

### 2. Dominio — `IncidentSnapshot` (src/infrastructure/incidentClient.ts)

Es el objeto que realmente usa el resto de la aplicación, construido a
partir del DTO ya validado:

```typescript
type IncidentDetails = {
  category: IncidentCategory;
  description: string;
  location: string;
  reporterId: string;
  assignedTechnicianId: string | null;
  priority: 'low' | 'medium' | 'high';
};

type IncidentSnapshot = {
  id: string;
  version: number;
  status: IncidentStatus;
  details: IncidentDetails | null;
};
```

La función `toIncidentSnapshot` traduce el `payload` genérico del DTO a
`IncidentDetails`, validando reglas propias del dominio de incidencias
que `parseRemoteResource` no conoce: que `category` sea una de las
categorías válidas (`electrical`, `laboratory`, `water`, etc.), que
`status` sea uno de los estados del flujo de CampusOps, y que `priority`
sea uno de los tres valores permitidos. Si el DTO es válido como sobre
genérico pero el payload no cumple estas reglas de dominio, se lanza el
mismo tipo de error de contrato — el límite entre "sobre válido" y
"incidencia válida" es exactamente la frontera entre estas dos capas.

### 3. Representación de errores — `IncidentClientError`

Los errores se representan con un tipo distinguible, nunca como
excepciones genéricas sin clasificar:

```typescript
type IncidentClientErrorKind = 'contract' | 'timeout' | 'network' | 'server' | 'http';

class IncidentClientError extends Error {
  readonly kind: IncidentClientErrorKind;
  readonly status?: number;
}
```

| `kind` | Cuándo ocurre |
|---|---|
| `contract` | El sobre o el payload no cumplen el contrato (DTO o dominio) |
| `timeout` | El `AbortController` canceló la petición por exceder `timeoutMs` |
| `network` | Falló la conexión antes de recibir cualquier respuesta |
| `server` | El backend respondió con HTTP ≥ 500 |
| `http` | El backend respondió con otro código de error (ej. 404, 403) |

Un caso especial: `getIncident(id)` captura específicamente un error
`http` con `status === 404` y lo traduce a `null` (incidencia no
encontrada), en vez de propagar la excepción — esta es una decisión de
dominio: "no encontrado" es un resultado válido de la consulta, no un
fallo del cliente.

## Por qué se separan estas tres capas

- **UI nunca llama `fetch` directamente.** Usa los casos de uso, que
  reciben `RemoteIncidentRepository`; éste delega en `IncidentClient`
  (`getIncidents`, `getIncident`, `createIncident`), cuyo `requestJson` es
  el único punto de llamada HTTP.
- **Cambios en el formato del DTO del backend** (ej. un campo nuevo, o
  un cambio de nombre no documentado) se absorben en `remoteResource.ts`
  sin tocar la lógica de incidencias.
- **Cambios en las reglas de negocio de incidencias** (ej. una categoría
  nueva, un estado nuevo) se absorben en `incidentClient.ts` sin tocar
  la validación genérica del sobre.
- **Los errores se distinguen por tipo**, permitiendo que la UI decida
  qué mostrar según el `kind` (ej. "reintentar" para `timeout`/`network`,
  "no disponible" para `server`, mensaje específico para `contract`).

## Idempotencia en creación

`createIncident` exige una `idempotencyKey` de al menos 8 caracteres,
enviada como encabezado `Idempotency-Key`. Esto permite reintentar una
creación que falló por timeout sin generar una incidencia duplicada:
el backend reconoce la misma clave como la misma operación.

## Del cliente a la pantalla: adaptador y error de dominio

`IncidentSnapshot` e `IncidentClientError` siguen siendo tipos de
infraestructura. La UI no los importa (lo comprueba
`course-tests/architecture-boundaries.test.ts`); los recibe traducidos por
`RemoteIncidentRepository` (src/infrastructure/remoteIncidentRepository.ts),
que implementa los puertos del dominio `IncidentSource` e `IncidentWriter`
(src/domain/incident.ts). `App.tsx` es el único lugar donde se instancia
`new RemoteIncidentRepository(new IncidentClient())`.

| Del cliente | Al dominio |
|---|---|
| `details` completo | `Incident` (title = description porque el contrato no publica título; `reportedAt: null` porque el backend no publica fecha) |
| `details: null` | `IncidentWithoutDetails { id, status, detailsAvailable: false }`; la lista muestra "Detalle no disponible" |
| `getIncident` → `null` (404) | `null` |

| `IncidentClientError.kind` | `IncidentSourceError.kind` | Mensaje en pantalla |
|---|---|---|
| `contract` | `invalid_response` | "El servidor envió datos inválidos y no se mostraron." |
| `timeout` | `timeout` | "El servidor tardó demasiado en responder. Intenta de nuevo." |
| `server` | `unavailable` | "El servicio de incidencias no está disponible en este momento." |
| `network` | `network` | "No hay conexión con el servidor de incidencias." |
| `http` (401/403/422/429…) | `rejected` | Mensaje genérico de la operación |

`IncidentSourceError` expone `code = kind`; la telemetría sanitizada conserva
`errorType` y `code` y descarta `message`/`stack`, así que el registro distingue
el tipo de fallo sin guardar tokens, actor ni texto libre.

La creación se hace desde el formulario de `CampusOpsApp` mediante el caso de
uso `createIncident` (src/application/incidentUseCases.ts). La pantalla genera
una `Idempotency-Key` por borrador y la reutiliza si el envío se reintenta
tras un fallo; si el borrador cambia, se genera otra.

## Pruebas que verifican este contrato

- `course-tests/public/week-05.test.ts`: los 5 casos públicos de `parseRemoteResource`.
- `src/infrastructure/incidentClient.test.ts`: consulta, payload null, DTO
  malformado, HTTP 500, creación POST con idempotencia y timeout.
- `src/infrastructure/incidentClient.failures.test.ts`: matriz de fallos con
  dobles que copian el cuerpo real de cada variante del backend (JSON roto,
  DTO corrupto, dominio inválido, lento con y sin timeout, 500, 429, 401,
  404 → null, red caída) y que ningún rechazo sale sin tipo ni con datos sensibles.
- `src/infrastructure/incidentClient.backend.test.ts`: el cliente real contra
  `course-backend/server.mjs` levantado en 127.0.0.1 con `X-Course-Scenario`
  (success, nullable, malformed, slow, server_error, rate_limited) y creación
  repetida con la misma clave sin duplicar.
- `src/infrastructure/remoteIncidentRepository.test.ts`: conversión al dominio y
  traducción de errores.
- `src/ui/CampusOpsApp.test.tsx`: un mensaje distinto por tipo de fallo,
  incidencias sin detalle y creación con reintento con la misma clave.

Los resultados observados están en `reports/week-05/contract-tests.json` y
`reports/week-05/failure-matrix.json`.

## Riesgo residual

El cliente confía en que `EXPO_PUBLIC_COURSE_BACKEND_URL` apunte siempre
al backend didáctico correcto; no valida el origen de la respuesta más
allá del contrato de datos. En un entorno de producción real, se
necesitaría además validar certificados/origen de forma explícita, lo
cual queda fuera del alcance de esta semana.