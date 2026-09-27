# Controles de seguridad — CampusOps

## Almacenamiento seguro

El token de sesión se guarda usando `expo-secure-store`, que cifra los
datos a nivel de sistema operativo (Keychain en iOS, Keystore/
EncryptedSharedPreferences en Android), en vez de `AsyncStorage`, que
guarda la información en texto plano.

## Relación con el modelo de amenazas (semana 3)

Este control atiende la amenaza 4 identificada en `docs/threat-model.md`
("exponer credenciales o secretos reales"), reduciendo el riesgo de que
un token de sesión quede expuesto si el dispositivo es accedido sin
autorización.

## Eliminación de secretos hardcodeados

Se revisó el código en busca de valores de credenciales escritos
directamente. Los únicos valores de tipo "token" que permanecen son los
fixtures públicos documentados en `CAMPUSOPS_API.md` (ej.
`course-valid-token`), declarados explícitamente como no sensibles.

## Control de registros (logs)

El proyecto mantiene la restricción de que el código de la aplicación no
debe contener llamadas a `console.log`, `console.error` ni similares,
verificado por `course-tests/security/threat-controls.test.ts`. Por eso,
`secure-session.ts` no registra errores en consola: los errores de
SecureStore se propagan naturalmente, sin exponer el token en ningún
registro técnico.

## Sanitización de registros (`redactForTelemetry`)

Atiende la **amenaza 3** de `docs/threat-model.md` ("se filtran datos
sensibles en registros técnicos").

**Dónde se aplica.** La lógica vive en `src/application/telemetry.ts`.
Los casos de uso `getIncidentList` y `getIncidentDetail`
(`src/application/incidentUseCases.ts`) registran un evento técnico al
terminar, con éxito o con error, mediante `recordTelemetry`, que siempre
pasa el evento por `redactForTelemetry` antes de entregarlo al puerto
`TelemetrySink` (`src/domain/telemetry.ts`). `App.tsx` inyecta
`InMemoryTelemetrySink` (`src/infrastructure/`), un buffer acotado a 50
eventos que no persiste en el dispositivo ni envía nada por red. El
adaptador evaluable `src/course-evaluation/index.ts` delega en la misma
función, así que la prueba pública ejercita el código que usa la app.

**Qué hace.**

- Recorre objetos y listas anidados y devuelve copias nuevas. Nunca muta
  la entrada.
- Normaliza cada clave (minúsculas, sin `_` ni `-`). Si coincide con el
  contrato de `docs/CAMPUSOPS_API.md` (`authorization`, `password`,
  `token`, `accessToken`, `refreshToken`, `email`, `displayName`,
  `name`, `userId`, `reporterId`, `technicianId`,
  `assignedTechnicianId`, `location`, `latitude`, `longitude`, `photos`,
  `evidence`, `internalComments`, `assignmentHistory`), sustituye el
  **valor completo** por `[REDACTED]`, aunque sea un objeto o una lista.
- Como el contrato es un mínimo, el equipo añade credenciales y texto
  libre: `cookie`, `setCookie`, `apiKey`, `secret`, `sessionToken`,
  `X-Course-Actor`, `actorId`, `description`, `diagnosis`, `comment` y
  `text`.
- Conserva el contexto técnico: `incidentId`, `correlationId`, `status`,
  `attempt`, `durationMs`, el nombre del evento y cabeceras como
  `accept`.
- Un `Error` se reduce a `{ errorType, code }`. Se descartan `message`,
  `stack` y cualquier propiedad adicional, porque son texto libre que
  puede traer tokens, correos o ubicaciones. Se usa `errorType` y no
  `name` porque `name` es una clave sensible del contrato.
- Una referencia circular se sustituye por `[Circular]`, así que no hay
  bucle ni excepción y el resultado siempre se puede serializar.
- Si el sink falla, `recordTelemetry` descarta el error: registrar nunca
  rompe el flujo de la app.

**Errores en la interfaz.** `CampusOpsApp` muestra sólo mensajes
genéricos ("No se pudo cargar la incidencia.") y nunca el `message` del
error. El detalle técnico va, sanitizado, al registro.

**Pruebas que lo verifican** (`npm run test:security` y
`npm test -- --ci --runInBand course-tests/public/week-04.test.ts`):

| Prueba | Qué demuestra |
|---|---|
| `t3-nested-object`, `t3-array-of-objects`, `t3-whole-value` | Oculta datos en objetos anidados, en listas y en valores completos |
| `t3-key-normalization` | Detecta `Access_Token`, `refresh-token`, `AUTHORIZATION`, etc. |
| `t3-technical-context-kept` | No borra el contexto técnico seguro |
| `t3-no-mutation` | La entrada queda igual y cada nivel del resultado es una copia |
| `t3-circular-boundary`, `t3-error-object` | Casos límite: ciclos y `Error` con datos en el mensaje |
| `t3-error-path-detail`, `t3-error-path-list` | Camino de error real: el repositorio falla y el registro no contiene token, correo, ubicación ni técnico |
| `t3-sink-failure` | Un sink roto no tumba la operación |
| `t3-ui-error-path` (`course-tests/security/redaction-ui.test.tsx`) | La UI oculta el dato y el registro tampoco lo conserva |

**Falla controlada.** Al quitar temporalmente `email` del conjunto de
claves (sin commit), fallan `t3-nested-object` y la prueba pública de
semana 4 (código 1). Al restaurarla pasan 22/22 (código 0). Los
registros están en `reports/week-04/diagnostics/t3-control-*`.

**Riesgo residual de la sanitización.**

- Es una lista de claves prohibidas. Un dato sensible bajo una clave no
  listada (por ejemplo `phone`) o incrustado en un texto con clave
  neutra (`note: "correo x@y"`) **no se detecta**. Cada campo nuevo del
  dominio debe revisarse contra la lista.
- Al descartar `message` se pierde detalle útil para depurar. Sólo quedan
  `errorType`, `code`, `incidentId` y `durationMs`.
- `InMemoryTelemetrySink` no persiste. Si en el futuro se envía a un
  servicio externo, ese transporte (TLS, retención, acceso) queda fuera
  de este control.

## Riesgo residual

`expo-secure-store` protege los datos en reposo, pero no protege contra
un dispositivo con jailbreak/root, capturas de pantalla mientras se
muestra información sensible, ni que un usuario comparta voluntariamente
sus credenciales. Estos riesgos quedan fuera del alcance de esta semana.