# Modelo de amenazas — CampusOps

## Activos a proteger

- **Sesiones de usuario**: tokens/identificadores que autentican a
  reportante, técnico o coordinador dentro de la app.
- **Fotografías de evidencia**: imágenes sintéticas adjuntas a una
  incidencia, que en un escenario real podrían mostrar información
  sensible de instalaciones.
- **Ubicaciones**: coordenadas o referencias de dónde ocurrió una
  incidencia.
- **Asignaciones de técnicos**: qué persona está asignada a atender
  cada incidencia, y el historial de esos cambios.
- **Registros técnicos (logs)**: información generada durante la
  operación de la app, que podría filtrar datos si no se sanitiza.

## Fronteras de confianza

- **App (cliente) ↔ Backend didáctico**: los datos cruzan de un
  entorno controlado por el usuario (dispositivo) a un servicio
  simulado; aquí es donde se valida rol, sesión e idempotencia
  (`CAMPUSOPS_API.md`).
- **UI ↔ Almacenamiento local**: información persistida en el
  dispositivo (cola offline, incidencias cacheadas) que podría
  exponerse si el dispositivo se pierde o es compartido.
- **App ↔ Proveedor de geocodificación/mapas**: frontera hacia un
  servicio externo (o su doble de prueba), donde no debe filtrarse
  información sensible de la incidencia.
- **Repositorio ↔ Historial de Git/CI**: frontera donde código,
  configuración y artefactos de evidencia podrían exponer
  accidentalmente un secreto si no se revisa antes de subir.

## Controles automatizados existentes

El workflow `.github/workflows/week-03-ci-amenazas-feedback.yml` corre
con permisos mínimos (`permissions: contents: read`) y ejecuta, a través
de `make verify-week-03` y `make public-test-week-03`
(`tools/course_public_evaluator.py`), un conjunto de comprobaciones que
incluye —según el `Makefile` del proyecto— revisión de tipos
(`npm run typecheck`), estilo (`npm run lint`) y pruebas (`npm run
test:smoke`), además de la generación del paquete Android
(`npm run bundle:release`). Los resultados se conservan como artefacto
descargable (`academic-evidence-week-03-ci-amenazas`), cumpliendo el
requisito de reportes verificables.

## Amenazas priorizadas

| Prioridad | Amenaza | Por qué importa | Control | Prueba que lo verifica |
|---:|---|---|---|---|
| 1 | Un técnico consulta incidencias que no le fueron asignadas | Viola la confidencialidad entre perfiles; el reportante espera que solo su incidencia y el técnico asignado la vean | El backend valida el rol y la asignación en el servidor (`GET /v1/incidents` filtra por actor), no solo se oculta en la UI | Prueba de integración que solicita `GET /v1/incidents` con `X-Course-Actor: technician-2` sobre una incidencia asignada a `technician-1`, y verifica que no aparezca en la respuesta |
| 2 | Alguien altera la asignación de una incidencia sin autorización | Rompe la integridad del flujo de estados y la trazabilidad de responsabilidades | El backend rechaza la acción `assign` si el rol del actor no es `coordinator` (403 ante rol/asignación incompatible, según `CAMPUSOPS_API.md`) | Prueba que ejecuta `POST /v1/incidents/:id/actions` con `action: assign` usando `X-Course-Actor: technician-1`, y espera un 403 |
| 3 | Se filtran datos sensibles en registros técnicos (logs) | Un log con datos de ubicación o identificadores personales sería una fuga de privacidad grave en un escenario con datos reales | Sanitización de logs mediante la función `redactForTelemetry` (contrato definido en `CAMPUSOPS_API.md` para semana 4), que reemplaza campos como `location`, `latitude`, `email` o `token` por `[REDACTED]` | Se declara como control esperado desde esta semana; su prueba unitaria se implementa en semana 4 según el cronograma del curso |
| 4 | Se exponen credenciales o secretos reales en el repositorio | Comprometería cualquier cuenta real asociada, aunque el proyecto use datos sintéticos | El repositorio usa únicamente fixtures públicos documentados como no sensibles (`course-valid-token`, actores como `technician-1`); el workflow de CI ejecuta el toolchain de verificación en cada push, con permisos de solo lectura | El pipeline (`make verify-week-03` / `make public-test-week-03`) falla si el evaluador detecta un patrón de credencial o dato sensible no declarado |

## Riesgo que atenderíamos primero y por qué

Atenderíamos primero la **amenaza 1** (consulta de incidencias ajenas),
porque compromete la confidencialidad básica del sistema: si cualquier
perfil puede ver información de incidencias que no le corresponden, se
rompe la garantía central de que "una sola app presenta las funciones
según el perfil" (`CAMPUSOPS.md`). Es también la amenaza con la prueba
más simple y directa de verificar (una sola llamada HTTP con un actor
incorrecto), lo que permite demostrarla y corregirla esta misma semana
con evidencia clara en `reports/week-03/security.json`.

## Riesgo residual

Aun con estos controles, queda un riesgo residual: el backend didáctico
es un simulador en memoria sin persistencia ni auditoría a largo plazo,
por lo que estas pruebas verifican el comportamiento del contrato actual,
pero no garantizan que una implementación futura de backend real
mantenga las mismas validaciones sin pruebas equivalentes en ese entorno.
Además, la sanitización de logs (amenaza 3) todavía no tiene una prueba
automatizada propia esta semana, ya que su implementación corresponde
formalmente a la semana 4 del curso.