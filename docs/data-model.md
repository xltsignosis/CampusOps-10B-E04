# Modelo de datos local — semana 08

El almacén conserva una atención iniciada sin conexión, su identidad de operación,
notas y referencias a fotos después de cerrar y reabrir. Conserva por separado la
base conocida del servidor y la intención local, para que la sincronización pueda
detectar una reasignación concurrente sin sobrescribir ninguno de esos hechos.

## Alcance y estado de integración

Esta aportación incluye el puerto `src/domain/offlineStore.ts`, la implementación
`src/infrastructure/storage/`, el caso de uso `src/application/saveOfflineStart.ts`
y pruebas con SQLite real en disco. `App.tsx` todavía utiliza el repositorio remoto:
la pantalla y el sincronizador del equipo deben conectar estos puntos de entrada.
No se declara implementada la sincronización completa, la resolución de conflictos
ni la carga de imágenes por tener implementado el almacén.

## Almacenamiento elegido

- **Motor:** SQLite mediante `expo-sqlite` 57.0.4, compatible con el Expo SDK 57 del proyecto.
- **Archivo nativo:** `campusops-offline.db`, en el directorio de bases de datos de
  la aplicación administrado por Expo. El archivo se reutiliza al abrir nuevamente.
- **Versión actual:** `PRAGMA user_version = 2`. Este número corresponde al esquema
  SQLite; es independiente del `schemaVersion: 1` de las evidencias del curso.
- **Integridad:** claves primarias, claves foráneas activas, consultas con parámetros
  y transacciones `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.
- **Acceso:** una conexión privada serializa lecturas y escrituras. Las operaciones
  del almacén no pueden intercalarse dentro de una transacción. Otra conexión que
  encuentre la base ocupada recibe un error; eso no autoriza a descartar la cola.
- **Plataformas de esta integración:** Android e iOS. No se configura SQLite web.

SQLite permite confirmar conjuntamente incidencia, cola y fotos y revertir cambios
de esquema. Una lista en memoria pierde los datos al reiniciar; un documento JSON
en almacenamiento de claves requiere resolver por separado las escrituras parciales
y relaciones. El costo elegido es una dependencia nativa, SQL y migraciones explícitas.
No se configura cifrado de la base: se usan exclusivamente los datos ficticios del
curso. Los tokens siguen en SecureStore, conforme a la sesión de la semana 6.

Referencia del proveedor: [SQLite para Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).

## Entidades y relaciones

| Entidad | Identidad | Contenido y relación |
|---|---|---|
| Incidencia local (`LocalIncident`) | Actor + ID de incidencia | `base` conserva la última versión remota utilizada; `local` conserva la intención. Ambas contienen los campos de `Incident` y una `version` obligatoria. |
| Operación pendiente (`PendingIncidentOperation`) | `operationId` único | Referencia una incidencia del mismo actor. Guarda `incidentId`, `actorId`, `baseVersion`, `action` y `payload` JSON. |
| Referencia de foto pendiente (`PendingPhotoReference`) | `referenceId` único | Referencia una incidencia del mismo actor. Guarda `localUri`, `actorId`, `incidentId` y `status: pending`. |

Una incidencia tiene cero o más operaciones y cero o más referencias de fotos.
El `payload.photoReferenceIds` del inicio offline relaciona la intención con sus fotos.
Las fotos pertenecen a la incidencia y no se eliminan al confirmar una acción.
Una incidencia no puede eliminarse mientras otras tablas la referencien.

El actor identifica al autor y separa sus datos locales; no es una credencial ni
demuestra autorización remota. Abrir el almacén no inicia una sesión. El caso de uso
de inicio comprueba que el perfil sea técnico, que esté asignado y que el estado sea
`assigned`. El servidor debe volver a autorizar cada envío con la sesión vigente.

### Tablas del esquema 2

| Tabla | Columnas y restricciones |
|---|---|
| `local_incidents` | `actor_id`, `incident_id` forman la clave primaria; `base_json` y `local_json` son obligatorios. |
| `pending_operations` | `sequence` entero autoincremental, `operation_id` único, `actor_id`, `incident_id`, `base_version >= 1`, `action`, `payload_json`, `created_at`. Clave foránea compuesta hacia `local_incidents`, con borrado restringido. |
| `pending_photo_references` | `reference_id` clave primaria; `actor_id`, `incident_id`, `local_uri` y `status` obligatorio, limitado a `pending`. Clave foránea compuesta hacia `local_incidents`, con borrado restringido. |

`sequence` mantiene el orden de inserción de la cola; `created_at` no decide su orden.
La fecha de operaciones nuevas es ISO 8601. En operaciones heredadas queda `NULL`
porque el esquema anterior no registraba esa fecha; no se inventa una fecha histórica.

Las consultas filtran por el actor con el que se abrió el almacén. Dos actores pueden
tener copias distintas de la misma incidencia. `operationId` y `referenceId` no se
reutilizan para contenidos distintos, aunque cambie el actor.

## Guardar, leer y retirar operaciones

### Guardar

`savePendingChange({ base, local, operation, photos })` guarda las tres entidades
en una única transacción. Verifica que coincidan incidencia, actor y versión base.
Si falla una escritura, tampoco persisten la incidencia ni las demás escrituras
realizadas dentro de esa transacción.

El llamador genera `operationId` **una sola vez**, antes del primer guardado. Puede
usar `newIdempotencyKey('start')`. Después del reinicio debe leer el identificador
guardado, sin crear uno nuevo para el mismo envío.

Si ya existe el mismo identificador y contenido de operación, se conserva la
primera escritura. Si el contenido es diferente, se rechaza con
`offline_operation_identity_reused`; no se reemplaza silenciosamente. Si hay trabajo
pendiente, otra escritura tampoco puede sustituir su base remota original.

### Leer y reabrir

- `getIncident(incidentId)` recupera la base y la intención del actor.
- `listPendingOperations()` recupera su cola en orden de inserción, incluyendo
  el mismo `operationId`, notas y versión base.
- `listPendingPhotos(incidentId)` recupera las referencias pendientes.
- `close()` espera los accesos previamente encolados y cierra la conexión.
- `openOfflineStore(actorId)` abre el mismo archivo y comprueba/migra su esquema.
  Debe llamarse después de restaurar una sesión válida, y cerrar el almacén al
  cambiar de actor. La restauración de la cola no restaura la autenticación.

### Retirar sólo tras confirmación

No hay un método público de borrado por ID. El sincronizador debe validar una
respuesta exitosa del servidor y construir un `OperationConfirmation` con
`confirmed: true`, `operationId`, `incidentId`, `actorId` y `serverVersion`.
`removeConfirmedOperation(receipt)` exige que coincidan las identidades y que la
versión confirmada sea superior a la base. El borrado se confirma transaccionalmente.

El recibo es un contrato interno, no una firma criptográfica: el almacén no hace
HTTP ni puede verificar el origen de un objeto construido por otro módulo. El
sincronizador es responsable de construirlo sólo desde una respuesta validada.
Un timeout, un error, un 401/403, un 409 o la ausencia de respuesta no son confirmación.
En esos casos no se llama al método y la operación permanece pendiente. Repetir una
confirmación ya procesada devuelve `false`, sin afectar las demás operaciones.

Después de retirar una operación, el almacén no conserva un historial de sus claves
confirmadas. La deduplicación de reenvíos en el servidor sigue siendo necesaria:
la cola persistente y sus restricciones locales no sustituyen la idempotencia remota.

## Referencias de fotografías

`file:///ficticio/photo-001.jpg` en las pruebas es sólo una URI sintética. Registrar
esa URI **no demuestra que exista una imagen ni que se haya subido**. El almacén no
captura, copia, lee ni carga bytes y no devuelve un identificador remoto de evidencia.
Confirmar `start` deja la referencia con `status: pending`.

En el flujo nativo, quien capture la fotografía debe copiarla primero a un archivo
duradero, comprobar su existencia y entonces guardar la referencia. Una URI de
caché temporal puede dejar de existir después del reinicio. La carga y confirmación
de fotografías requieren su propia implementación y evidencia por el equipo.

## Migración y recuperación

La semana 6 no tenía este almacén SQLite. El esquema 1 es un formato anterior
preparado explícitamente para demostrar la actualización, no una afirmación de que
ya existiera una base desplegada. Está definido en `SCHEMA_V1` y la prueba inserta
una incidencia y una operación pendiente antes de migrar.

| Versión | Estructura |
|---|---|
| 0 | Base nueva, sin tablas del almacén. |
| 1 | `local_incidents` y `pending_operations`, sin `created_at` ni tabla de fotos. |
| 2 | Conserva las tablas y datos anteriores; agrega `created_at`, `pending_photo_references` e índice de cola por actor y secuencia. |

Procedimiento en `migrateOfflineDatabase`:

1. Activar claves foráneas y WAL en la conexión privada.
2. Abrir una transacción de escritura y leer `user_version` dentro de ella.
3. Si es 0, crear la estructura inicial; si es 1, conservarla.
4. Agregar la columna, la tabla de fotos y el índice de versión 2.
5. En la prueba fallida, lanzar `injected_migration_failure` en este punto, cuando
   ya se ejecutó el cambio estructural pero todavía no se actualizó la versión.
6. Si todo funciona, fijar `user_version = 2` y confirmar. Si algo falla, ejecutar
   `ROLLBACK`, propagar el error y no permitir usar el almacén parcialmente abierto.
7. Reabrir y repetir la migración sin inyectar la falla. No borrar ni reconstruir
   destructivamente la base para aparentar recuperación.

Una versión superior a 2 se rechaza con `offline_schema_too_new`, sin intentar un
retroceso destructivo. Reabrir una base de versión 2 no repite la transformación.

## Comprobaciones reproducibles y resultados

Con las dependencias instaladas y Node.js 22.22.x:

```bash
CAMPUSOPS_STORAGE_OBSERVATIONS=reports/week-08/storage-observations.json npm test -- --ci --runInBand src/infrastructure/storage/sqliteOfflineStore.test.ts
npm run typecheck
npm run lint
```

La suite utiliza archivos temporales y el motor SQLite de Node. Ejecuta el mismo
SQL, la serialización de accesos, la migración y el repositorio que la integración
nativa; sustituye el enlace Expo al motor por `src/testing/nodeSqlite.ts`. Además,
un proceso independiente lee el archivo después de cerrar la conexión inicial.
Las bases temporales se eliminan al finalizar. El enlace nativo de Expo y el cierre
forzado de una app Android/iOS requieren una comprobación adicional en dispositivo.

`reports/week-08/storage-observations.json` registra contenido observado, no sólo
mensajes de éxito. Incluye el reinicio y los tres estados exigidos de migración:

| Estado | Resultado comprobado |
|---|---|
| Antes | Versión 1; una incidencia; operación `offline-start-001` con su contenido original; sin columna `created_at` ni tabla de fotos. |
| Tras la falla | Exactamente el mismo esquema y los mismos registros que antes. El reinicio previo a recuperar también conserva ese estado. |
| Tras recuperar | Versión 2; misma incidencia y operación; `created_at: null`; nueva tabla de fotos. Repetir la migración no cambia los datos. |

Otros casos comprueban confirmaciones inválidas, conservación de fotos al retirar
una operación, rollback durante un guardado, aislamiento por actor, permisos del
inicio, identidad estable, preservación de la base y rechazo de esquemas futuros.

Comprobaciones ejecutadas el 23 de octubre de 2026 con Node.js 22.22.2:

| Comando | Resultado observado |
|---|---|
| Suite del almacén indicada arriba | 10 pruebas aprobadas. |
| `npm run typecheck` | Código de salida 0, sin errores de tipos. |
| `npm run lint` | Código de salida 0, sin errores de estilo. |
| `npm test -- --ci --runInBand src course-tests/architecture-boundaries.test.ts course-tests/public/week-06.test.ts course-tests/smoke.test.tsx` | 15 suites, 132 pruebas aprobadas; incluye las 10 del almacén y regresiones de sesión, permisos, API y UI. |
| `npm run bundle:release` | Exportación Android de la app actual terminada con código 0. No demuestra instalación ni ejercicio nativo del nuevo almacén, que aún no está conectado a `App.tsx`. |

El registro es evidencia parcial del almacén sobre el árbol de trabajo, no el
reporte final de toda la semana. Al integrar, el equipo debe fijar el commit técnico
y referenciar estos resultados en `reports/week-08/migration-tests.json` conforme a
`docs/EVIDENCE_CONTRACT.md`, agregando sus pruebas de conflicto, combinación y
sincronización. Cada integrante registra únicamente las pruebas o revisiones que
haya realizado y pueda explicar. Se utilizó asistencia de Codex para esta aportación;
la verificación ejecutable queda en los comandos y observaciones anteriores.

## Integración con la app

1. `App.tsx` compone `OfflineSession` y abre `openOfflineStore(session.actorId)` después de autenticar. Un error de apertura conserva el archivo para recuperación. Desmontar la sesión cierra el repositorio y bloquea nuevos envíos.
2. `OfflineIncidentRepository` guarda las lecturas remotas para consultar el caché sin conexión. `cacheIncident` no sobrescribe intenciones pendientes ni versiones más recientes. `listIncidents` recupera las filas del autor.
3. Un inicio se persiste mediante `saveOfflineStart` antes de llamar al motor. Al reintentar se conservan autor, versión base, contenido e identidad. La app sincroniza al abrir, volver a primer plano, pulsar sincronizar y mediante sondeo de reconexión.
4. El repositorio utiliza la política compartida de tres vías para combinar cambios independientes en su representación. El motor informa incompatibilidades como estado de aplicación y conserva la cola; no impone una asignación antigua.
5. `removeConfirmedOperation` admite un `serverIncident` validado y una operación `followup` de nota. Dentro de la misma transacción retira el inicio confirmado, actualiza la base cuando no hay otras intenciones y guarda el comentario sucesor con ID `${operationId}:note` y su versión base confirmada. Si hay una colisión o falla, todo revierte. No hace falta cambiar el esquema 2: se usan las mismas tablas y relaciones.
6. La nota se envía como `comment` porque el contrato de `start` no guarda texto. Su identidad y contenido sobreviven si se pierde la respuesta, y sólo su confirmación permite retirarla. Las fotos siguen pendientes independientemente de ambas confirmaciones.

Las ejecuciones históricas del 23 de octubre descritas arriba corresponden al almacén aislado. La integración y sus comprobaciones actuales se indexan en `reports/week-08/migration-tests.json`; `docs/sync-policy.md` describe el comportamiento de la versión integrada.
