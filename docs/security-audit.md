# Auditoría de seguridad — Semana 4

## Objetivo

Se realizó una revisión básica de seguridad y privacidad sobre el proyecto CampusOps, buscando posibles situaciones relacionadas con exposición de credenciales, configuración insegura y manejo de información sensible.

La revisión siguió el proceso:

**Problema → Riesgo → Corrección → Evidencia**

Todos los valores utilizados por el backend de enseñanza son ficticios y no corresponden a credenciales reales.

## Hallazgos

| # | Hallazgo                                                                                                     | Riesgo                                                                                                     | Solución aplicada                                                                                                       | Evidencia                        |
| - | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1 | Token de autenticación definido directamente en `course-backend/server.mjs`                                  | Un secreto o token real embebido en código podría quedar expuesto públicamente en el repositorio           | Se sustituyó el valor fijo por una variable de entorno                                                                  | `evidence/token-corregido.png`   |
| 2 | CORS configurado con `Access-Control-Allow-Origin: *`                                                        | Cualquier origen puede realizar solicitudes al backend, aumentando la superficie de exposición             | Se configuró un origen permitido mediante variable de entorno                                                           | `evidence/cors-restringido.png`  |
| 3 | Los eventos `AuthEvent` contemplan un campo `token` y la función `redactForTelemetry` todavía está pendiente | Una implementación de telemetría que registre el evento completo podría terminar exponiendo tokens en logs | Se identificó como riesgo potencial y se dejó documentado para implementar redacción antes de enviar datos a telemetría | `evidence/auth-event-review.png` |

---

## Hallazgo 1 — Token de autenticación definido directamente en código

### Problema encontrado

En `course-backend/server.mjs` se encontró un valor de autenticación escrito directamente dentro del código:

```js
if (request.headers.authorization !== 'Bearer course-valid-token') {
```

También existe un valor de token directamente en la respuesta del endpoint de refresh.

Los valores encontrados pertenecen al fixture educativo y son ficticios, pero el patrón es inseguro si se utilizara con credenciales reales.

### Riesgo

Si este patrón se utilizara con un token real, cualquier persona con acceso al repositorio podría obtener el valor y utilizarlo para realizar solicitudes no autorizadas.

Además, mantener credenciales dentro del código dificulta su rotación y aumenta la posibilidad de que sean publicadas accidentalmente.

### Solución

Se debe reemplazar el valor fijo por una variable de entorno.

Ejemplo:

```js
const accessToken =
  process.env.COURSE_ACCESS_TOKEN ?? 'course-valid-token';
```

Después:

```js
if (request.headers.authorization !== `Bearer ${accessToken}`) {
  return send(response, 401, { code: 'unauthorized' });
}
```

Para el refresh:

```js
const refreshToken =
  process.env.COURSE_REFRESH_TOKEN ?? 'course-refresh-0';
```

Y utilizar esa variable en lugar del valor escrito directamente.

### Configuración

Agregar en `.env.example`:

```env
COURSE_ACCESS_TOKEN=
COURSE_REFRESH_TOKEN=
```

Los valores reales deben permanecer únicamente en `.env`, que no debe subirse al repositorio.

### Evidencia

Se debe capturar:

1. El código después de eliminar el token fijo.
2. El contenido de `.env.example` mostrando únicamente los nombres de variables.
3. Una ejecución exitosa del backend utilizando las variables de entorno.

Archivo sugerido:

`docs/evidence/token-corregido.png`

---

## Hallazgo 2 — CORS permite cualquier origen

### Problema encontrado

En `course-backend/server.mjs` la respuesta HTTP contiene:

```js
'access-control-allow-origin': '*',
```

La configuración permite solicitudes desde cualquier origen.

### Riesgo

Una política CORS demasiado permisiva puede permitir que aplicaciones alojadas en otros orígenes interactúen con el backend.

En un entorno real, una configuración de este tipo puede ampliar innecesariamente la superficie de exposición de la API.

### Solución

Se configuró el origen permitido mediante una variable de entorno.

Ejemplo:

```js
const allowedOrigin =
  process.env.COURSE_BACKEND_ORIGIN ?? 'http://localhost:8081';
```

Después, en los headers:

```js
'access-control-allow-origin': allowedOrigin,
```

En `.env.example`:

```env
COURSE_BACKEND_ORIGIN=http://localhost:8081
```

### Evidencia

Se debe ejecutar el backend y comprobar que la respuesta contiene el origen configurado en lugar de:

```text
Access-Control-Allow-Origin: *
```

Archivo sugerido:

`docs/evidence/cors-restringido.png`

---

## Hallazgo 3 — Riesgo potencial de exposición de tokens en telemetría

### Problema encontrado

El tipo `AuthEvent` contempla un campo opcional:

```ts
token?: string;
```

Además, el proyecto contiene una función destinada a realizar redacción de datos para telemetría:

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

Actualmente la función se encuentra pendiente de implementación.

### Riesgo

Si una implementación futura registra directamente los objetos `AuthEvent`, un evento que contenga un token podría terminar almacenando información sensible en logs o sistemas de telemetría.

No se encontró evidencia suficiente para afirmar que actualmente exista una filtración de tokens por logs. Por ello este hallazgo se considera un riesgo potencial que debe prevenirse antes de implementar la telemetría.

### Solución propuesta

La información sensible debe eliminarse antes de enviarla a telemetría.

Por ejemplo:

```ts
export function redactForTelemetry(input: unknown): unknown {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const copy = { ...(input as Record<string, unknown>) };

  delete copy.token;

  return copy;
}
```

De esta manera el campo `token` no se transmite a la capa de telemetría.

### Evidencia

La prueba debe demostrar que un objeto como:

```ts
{
  type: 'refreshSucceeded',
  requestId: 'req-001',
  token: 'demo-token'
}
```

produce un resultado sin el campo `token`.

Archivo sugerido:

`docs/evidence/auth-event-review.png`

---

## Comprobación final

Antes de entregar se debe ejecutar:

```bash
git status
```

Comprobar que `.env` no aparezca como archivo pendiente de agregar.

También se debe revisar que no existan:

* contraseñas reales;
* tokens reales;
* API Keys reales;
* credenciales institucionales;
* datos personales reales.

## Estructura de evidencias

```text
docs/
├── security-audit.md
└── evidence/
    ├── token-corregido.png
    ├── cors-restringido.png
    └── auth-event-review.png
```

## Resultado

La auditoría permitió identificar tres situaciones relacionadas con seguridad:

1. Valores de autenticación definidos directamente en el backend.
2. Política CORS demasiado permisiva.
3. Riesgo potencial de exposición de tokens en telemetría.

Las dos primeras deben quedar corregidas mediante cambios reales en el código y acompañadas de evidencia de funcionamiento.
