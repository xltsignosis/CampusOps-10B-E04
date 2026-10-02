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

- **UI nunca llama `fetch` directamente.** Solo interactúa con
  `IncidentClient` (`getIncidents`, `getIncident`, `createIncident`),
  que internamente usa `requestJson` como único punto de llamada HTTP.
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

## Casos de prueba cubiertos (ver `incidentClient.test.ts`)

- Respuesta válida con payload completo
- Payload nulo (válido, no es un error)
- Sobre malformado (campo faltante o tipo incorrecto)
- Timeout (vía `AbortController` y `timeoutMs` configurable)
- Error de servidor (HTTP ≥ 500)
- 404 traducido a `null` en `getIncident`

## Riesgo residual

El cliente confía en que `EXPO_PUBLIC_COURSE_BACKEND_URL` apunte siempre
al backend didáctico correcto; no valida el origen de la respuesta más
allá del contrato de datos. En un entorno de producción real, se
necesitaría además validar certificados/origen de forma explícita, lo
cual queda fuera del alcance de esta semana.