# Auditoría de seguridad — Semana 4

**Proyecto:** CampusOps (app Expo/React Native + backend fixture en Node)
**Autor:** Ariel Abimael Chacón Herrera — Grupo 10B
**Rama:** `week4/security-audit-ariel-chacon`

## Metodología

Se revisó el código fuente completo (`src/`, `course-backend/`) buscando: credenciales/tokens embebidos, información sensible enviada a consola/telemetría, almacenamiento innecesario de datos personales, mensajes de error que filtren detalles internos, y el manejo del archivo `.env`. Todos los datos usados en esta auditoría (tokens, correos, emails) son ficticios, ya que el proyecto es en sí mismo un fixture de curso (`course-backend/campusops.mjs:1`: *"Public, in-memory teaching fixture. Never deploy as institutional authentication."*).

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Token de sesión (`course-valid-token`) escrito directamente en el código del backend, igual para todos los actores | Cualquiera con acceso al repositorio conoce la credencial completa; no es rotable ni configurable por entorno | Se externalizó a la variable de entorno `COURSE_FIXTURE_TOKEN` | `docs/evidence/token-fix-selftest-pass.txt`, `docs/evidence/token-fix-custom-env-rejects-old-token.txt` |
| 2 | La función `redactForTelemetry` no estaba implementada (lanzaba error), por lo que no existía ningún control que evitara que tokens, emails, nombres, ubicación o fotos terminaran en logs/telemetría | Si en el futuro se agrega logging o envío de eventos a un servicio externo, datos personales y credenciales podrían exponerse sin ningún filtro | Se implementó la función con redacción recursiva por nombre de campo sensible | `docs/evidence/redact-fix-test-pass.txt` |
| 3 | El backend respondía con `access-control-allow-origin: *` en todas las rutas, incluidas las autenticadas | Combinado con el hallazgo 1 (token estático compartido), cualquier origen web que conociera el token podía invocar la API sin restricción de origen | Se restringió a un origen configurable vía `COURSE_BACKEND_ALLOWED_ORIGIN` | `docs/evidence/cors-fix-header.txt` |

Adicionalmente se verificó un control ya existente y correcto: el archivo `.env` está en `.gitignore` y nunca ha sido trackeado por git (ver `docs/evidence/env-gitignore-status.txt`). No se cuenta como hallazgo corregido porque ya estaba bien implementado; se documenta como evidencia de buena práctica presente en el proyecto.

---

## Hallazgo 1 — Token de sesión fijo hardcodeado en el backend

### Problema encontrado

El backend fixture (`course-backend/campusops.mjs` y `course-backend/server.mjs`) usaba el literal `'course-valid-token'` directamente en el código como única credencial de autenticación (`Authorization: Bearer course-valid-token`), igual para **todos** los actores (reporter, technician, coordinator).

### Riesgo

Cualquier persona con acceso al repositorio obtiene automáticamente la credencial completa. El valor no se puede rotar ni configurar sin editar el código fuente, y al estar repetido en varios archivos, un cambio de credencial obliga a tocar múltiples puntos del código en vez de un único lugar de configuración.

### Solución

Se movió el token a la variable de entorno `COURSE_FIXTURE_TOKEN`, con un valor por defecto igual al anterior (`course-valid-token`) para no romper el comportamiento actual si nadie configura la variable. Se agregó `COURSE_FIXTURE_TOKEN=` (vacío) a `.env.example`.

### Antes

```js
// course-backend/campusops.mjs
if (request.headers.authorization !== 'Bearer course-valid-token' || !Object.hasOwn(actors, actorId)) {
  return send(response, 401, { code: 'unauthorized' });
}
```

### Después

```js
// course-backend/server.mjs
const FIXTURE_TOKEN = process.env.COURSE_FIXTURE_TOKEN ?? 'course-valid-token';
...
return await handleCampusOps(request, response, url, { send, readJson, scenario, fixtureToken: FIXTURE_TOKEN });

// course-backend/campusops.mjs
export async function handleCampusOps(request, response, url, { send, readJson, scenario, fixtureToken }) {
  ...
  if (request.headers.authorization !== `Bearer ${fixtureToken}` || !Object.hasOwn(actors, actorId)) {
    return send(response, 401, { code: 'unauthorized' });
  }
```

### Evidencia

1. `docs/evidence/token-fix-selftest-pass.txt` — `npm run backend:self-test` sigue pasando con el valor por defecto (el fix no rompió el comportamiento existente).
2. `docs/evidence/token-fix-custom-env-rejects-old-token.txt` — se arrancó el backend con `COURSE_FIXTURE_TOKEN=demo-rotated-token-999` y se probó con `curl`: el token viejo (`course-valid-token`) ahora devuelve **401**, y el nuevo token devuelve **200**. Esto demuestra que la credencial ya es configurable/rotable y no está fija en el código.

---

## Hallazgo 2 — Falta el control de redacción de datos sensibles antes de telemetría

### Problema encontrado

`src/course-evaluation/index.ts` definía `redactForTelemetry` como un stub que únicamente lanzaba un error (`must be implemented in the assigned week`). No existía ninguna función real que limpiara datos sensibles antes de enviarlos a telemetría o logs.

### Riesgo

Si en algún momento se agrega logging de requests o envío de eventos a un servicio de analítica/monitoreo (algo común a medida que crece una app), sin este control se registrarían tal cual: el token de autorización, el email y nombre del usuario, la ubicación del incidente, las fotos de evidencia y comentarios internos. Es exactamente el tipo de fuga que ocurre cuando se hace `console.log(response)` o se manda un objeto completo a un sistema externo sin filtrar.

### Solución

Se implementó `redactForTelemetry` con una redacción recursiva: recorre el objeto y, para cualquier campo cuyo nombre esté en la lista de campos sensibles (`authorization`, `email`, `displayName`, `location`, `photos`, `internalComments`), reemplaza el valor completo por `'[REDACTED]'`; el resto de los campos (por ejemplo `incidentId`) se preserva intacto.

### Antes

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

### Después

```ts
const SENSITIVE_TELEMETRY_KEYS = new Set([
  'authorization', 'email', 'displayName', 'location', 'photos', 'internalComments',
]);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_TELEMETRY_KEYS.has(key) ? '[REDACTED]' : redactValue(item),
      ]),
    );
  }
  return value;
}

export function redactForTelemetry(input: unknown): unknown {
  return redactValue(input);
}
```

### Evidencia

`docs/evidence/redact-fix-test-pass.txt` — ejecución de `npx jest course-tests/public/week-04.test.ts`, que verifica exactamente que `authorization`, `profile.email`, `profile.displayName`, `location`, `photos` e `internalComments` queden como `'[REDACTED]'` mientras el resto de los campos (como `incidentId`) se preservan. Resultado: **1 passed, 1 total**.

---

## Hallazgo 3 — CORS abierto a cualquier origen (`*`)

### Problema encontrado

La función `send()` en `course-backend/server.mjs` fijaba el header `access-control-allow-origin: '*'` para **todas** las respuestas del backend, incluyendo endpoints que requieren autenticación (`/v1/resources`, `/v1/incidents/*`).

### Riesgo

Un header CORS abierto a cualquier origen, combinado con el Hallazgo 1 (un token de autenticación estático y compartido), significa que cualquier página web que conociera el token podría invocar la API desde el navegador sin ninguna restricción de origen. Aunque este backend es un fixture local de curso, es el mismo patrón que en un backend real habilitaría ataques desde sitios maliciosos usando credenciales filtradas.

### Solución

Se restringió el header a un origen configurable vía la variable de entorno `COURSE_BACKEND_ALLOWED_ORIGIN`, con valor por defecto `http://localhost:8081` (puerto típico de Expo web/Metro en desarrollo local). Se agregó `COURSE_BACKEND_ALLOWED_ORIGIN=` a `.env.example`.

### Antes

```js
response.writeHead(status, {
  'access-control-allow-origin': '*',
  ...
});
```

### Después

```js
const ALLOWED_ORIGIN = process.env.COURSE_BACKEND_ALLOWED_ORIGIN ?? 'http://localhost:8081';
...
response.writeHead(status, {
  'access-control-allow-origin': ALLOWED_ORIGIN,
  ...
});
```

### Evidencia

`docs/evidence/cors-fix-header.txt` — salida de `curl -i http://127.0.0.1:4398/health` mostrando `access-control-allow-origin: http://localhost:8081` en vez de `*`.

---

## Control positivo verificado (no corregido, ya cumplía)

`.env` está correctamente incluido en `.gitignore` y **nunca** ha sido trackeado por git. Se verificó creando un `.env` ficticio de prueba (`TEST_API_KEY=demo_key_123`), confirmando con `git check-ignore -v .env` que está ignorado, y con `git status --porcelain` que no aparece como archivo pendiente de subir. El archivo de prueba se eliminó inmediatamente después de la verificación.

**Evidencia:** `docs/evidence/env-gitignore-status.txt`
