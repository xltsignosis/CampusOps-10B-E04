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
(`npm run bundle:release`), la auditoría de dependencias (`npm run
audit:ci`) y la búsqueda de secretos (`secret_scan`). Además ejecuta
`npm run test:security`, que comprueba los controles de las amenazas 1 a
4 contra el backend didáctico real. Los resultados se conservan como
artefacto descargable (`academic-evidence-week-03-ci-amenazas`),
cumpliendo el requisito de reportes verificables.

## Amenazas priorizadas

| Prioridad | Amenaza | Por qué importa | Control | Prueba que lo verifica |
|---:|---|---|---|---|
| 1 | Un técnico consulta incidencias que no le fueron asignadas | Viola la confidencialidad entre perfiles; el reportante espera que solo su incidencia y el técnico asignado la vean | El backend valida el rol y la asignación en el servidor (`GET /v1/incidents` filtra por actor), no solo se oculta en la UI | Prueba de integración `course-tests/security/threat-controls.test.ts` › *Amenaza 1* (`npm run test:security`, también en el workflow): `technician-2` y `reporter-2` piden `GET /v1/incidents` y `GET /v1/incidents/campus-inc-001` (asignada a `technician-1`); la lista no la incluye y el detalle responde 403. Incluye control positivo (el técnico asignado, el reportante y el coordinador sí la ven) para que la prueba no pase en vacío. Checks `t1-*` en `reports/week-03/security.json` |
| 2 | Alguien altera la asignación de una incidencia sin autorización | Rompe la integridad del flujo de estados y la trazabilidad de responsabilidades | El backend rechaza la acción `assign` si el rol del actor no es `coordinator` (403 ante rol/asignación incompatible, según `CAMPUSOPS_API.md`) | Prueba `course-tests/security/threat-controls.test.ts` › *Amenaza 2*: `technician-1` (y `reporter-1`) ejecutan `POST /v1/incidents/campus-inc-001/actions` con `action: assign` y esperan 403; después la incidencia sigue en versión 1, con `technician-1` asignado y sin historial nuevo. Control positivo: `coordinator-1` sí asigna (201). Check `t2-assign-by-technician-403` en `reports/week-03/security.json` |
| 3 | Se filtran datos sensibles en registros técnicos (logs) | Un log con datos de ubicación o identificadores personales sería una fuga de privacidad grave en un escenario con datos reales | Sanitización de logs mediante la función `redactForTelemetry` (contrato definido en `CAMPUSOPS_API.md` para semana 4), que reemplaza campos como `location`, `latitude`, `email` o `token` por `[REDACTED]` | Esta semana sólo hay una guarda provisional: `course-tests/security/threat-controls.test.ts` › *Amenaza 3* comprueba que el código de la app (`src/**`, `App.tsx`, `index.ts`) no escribe en consola. La prueba unitaria de `redactForTelemetry` se implementa en semana 4 (`course-tests/public/week-04.test.ts`); hoy la función lanza "must be implemented", por eso el check `t3-log-redaction-pending` se declara `not_applicable` y no `pass` |
| 4 | Se exponen credenciales o secretos reales en el repositorio | Comprometería cualquier cuenta real asociada, aunque el proyecto use datos sintéticos | El repositorio usa únicamente fixtures públicos documentados como no sensibles (`course-valid-token`, actores como `technician-1`); el workflow de CI ejecuta el toolchain de verificación en cada push, con permisos de solo lectura | El check `secret_scan` de `tools/course_public_evaluator.py` (parte de `make verify-week-03`) recorre el árbol y falla, con código de salida 1, si encuentra alguno de cuatro patrones: cabecera de clave privada PEM, token de GitHub (prefijo `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`), clave de acceso de AWS (prefijo `AKIA`) o una variable pública de Expo cuyo nombre termina en `SECRET`, `PRIVATE_KEY` o `ACCESS_TOKEN` con valor asignado. Se demuestra con una falla controlada (valor falso, sólo local): checks `secret-scan-baseline`, `secret-scan-injected-fail` y `secret-scan-fixed` en `reports/week-03/security.json`; y `course-tests/security/threat-controls.test.ts` › *Amenaza 4* |

## Verificación: de la amenaza al resultado

Cada control se comprueba con un comando y queda indexado en
`reports/week-03/security.json`. Para las amenazas 1 y 4 se demostró
además que la comprobación **detecta el fallo**: se retiró o se violó el
control de forma temporal y local (sin commit), el comando terminó con
error y luego se restauró.

| Amenaza | Comando de verificación | Checks en `security.json` | Fallo demostrado |
|---|---|---|---|
| 1. Incidencias ajenas | `npm run test:security` | `t1-foreign-incidents-blocked`, `t1-control-removed-detected`, `t1-control-restored` | Con el filtro de visibilidad del backend desactivado, la prueba falla; restaurado, pasa |
| 2. Alterar asignaciones | `npm run test:security` | `t2-assign-by-technician-403` | — (control por rol; se verifica en verde con control positivo) |
| 3. Datos en registros | `npm run test:security` (guarda provisional) | `t3-log-redaction-pending` | No aplica todavía: `redactForTelemetry` es de semana 4 |
| 4. Credenciales | `make verify-week-03` (equivale a `python tools/course_public_evaluator.py --week 3 --mode verify` más la cadena de herramientas) | `secret-scan-baseline`, `secret-scan-injected-fail`, `secret-scan-fixed` | Con un valor falso de variable pública secreta el evaluador termina con código 1; sin él, con código 0 |

## Riesgo que atenderíamos primero y por qué

Atenderíamos primero la **amenaza 1** (consulta de incidencias ajenas),
porque compromete la confidencialidad básica del sistema: si cualquier
perfil puede ver información de incidencias que no le corresponden, se
rompe la garantía central de que "una sola app presenta las funciones
según el perfil" (`CAMPUSOPS.md`). Es también la amenaza con la prueba
más simple y directa de verificar (una sola llamada HTTP con un actor
incorrecto), lo que permite demostrarla y corregirla esta misma semana
con evidencia clara en `reports/week-03/security.json`: allí se
documenta que, al retirar temporalmente el control, la prueba falla, y que
al restaurarlo vuelve a pasar.

## Riesgo residual

Aun con estos controles, queda un riesgo residual: el backend didáctico
es un simulador en memoria sin persistencia ni auditoría a largo plazo,
por lo que estas pruebas verifican el comportamiento del contrato actual,
pero no garantizan que una implementación futura de backend real
mantenga las mismas validaciones sin pruebas equivalentes en ese entorno.
Además, la sanitización de logs (amenaza 3) todavía no tiene una prueba
automatizada propia esta semana, ya que su implementación corresponde
formalmente a la semana 4 del curso; sólo existe la guarda provisional
que impide escribir en consola.

Sobre la amenaza 4, el escáner de secretos sólo conoce cuatro patrones.
Un valor sensible con otro formato (por ejemplo, una constante `apiKey`
con una cadena cualquiera, o un token de otro proveedor) **no se
detecta**, y `.env.example` y las imágenes se excluyen del recorrido. Los
fixtures públicos del curso (`course-valid-token`, `technician-1`, etc.)
no son secretos, pero un secreto real subido al historial de Git seguiría
ahí aunque se borre después: por eso se usan sólo datos ficticios y valores
falsos temporales que nunca se guardan en un commit.