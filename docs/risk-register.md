# Registro de riesgos — CampusOps

Tres riesgos del producto CampusOps, ordenados del más al menos prioritario.

| Prioridad | Riesgo | Probabilidad | Impacto | Mitigación | Cómo comprobar la mitigación |
|---:|---|---|---|---|---|
| 1 | El técnico atiende una incidencia sin conexión y, al sincronizar, su cambio se pierde en silencio o lo pisa una reasignación que el coordinador hizo mientras tanto | Media — el trabajo offline con concurrencia es frágil; el campo compuesto `work` junta técnico asignado y estado, así que un inicio local y una reasignación remota chocan sobre el mismo campo | Alto — se pierde trabajo ya hecho, el técnico deja de confiar en la app, se incumple "sin pérdida silenciosa" y el criterio AC-04 | Cola local con identidad estable por operación (`operationId`, `incidentId`, `baseVersion`, autor) que sobrevive al reinicio; al sincronizar, si hubo cambio remoto sobre el mismo campo se marca conflicto y se conserva la intención pendiente, no se descarta ni se pisa | Prueba: agregar un cambio, reiniciar la app y ver que sigue en la cola como "pendiente de sincronización"; prueba unitaria de `resolveSync` con reasignación remota + inicio local que devuelve `{ kind: 'conflict', fields: ['work'] }` sin vaciar la cola |
| 2 | Se registran incidencias duplicadas: dos personas reportan la misma falla, o un reintento de red / doble toque en "enviar" crea otra copia | Alta — es de los errores más comunes en apps de reportes; muchas personas ven la misma fuga o apagón y los reintentos al crear son normales en móvil | Medio — el coordinador ve reportes repetidos, asigna técnicos distintos a lo mismo y las cuentas de incidencias quedan infladas; se limpia cerrando duplicados y no se pierde información | `Idempotency-Key` estable al crear una incidencia para que reenviar la misma operación no cree otra; avisar al reportante si ya hay una incidencia abierta con misma categoría y ubicación aproximada | Prueba que llama dos veces a `POST /v1/incidents` con la misma `Idempotency-Key` y verifica que la segunda respuesta trae el mismo `id`, la lista no crece y el historial no se duplica |
| 3 | La autorización por perfil se controla sólo ocultando botones en la UI, y un técnico ejecuta acciones sobre incidencias que no tiene asignadas (o alguien que no es coordinador cierra un caso) | Media — es el atajo natural al construir la pantalla primero; se cae en él sin querer si ninguna prueba lo vigila | Alto — rompe el modelo de perfiles completo y expone datos de incidencias ajenas (posible penalización de la rúbrica); corregirlo tarde obliga a rehacer la capa de servicio | Validar rol y asignación en el backend en cada acción, sin confiar en el rol que envía el cliente; responder `403` cuando el actor no tiene permiso o la incidencia no le está asignada, sin modificar el recurso | Prueba negativa: `technician-2` intenta `start`/`resolve`/`comment` sobre `campus-inc-001` (asignada a `technician-1`) y el servicio responde `403` con la incidencia sin cambios (misma versión e historial) |

## Detalle por riesgo

### Riesgo 1 — Pérdida de cambios del técnico sin conexión

- **Evento:** el técnico inicia atención, agrega notas o evidencias sin conexión; al reconectar, el cambio no llega al servidor, o entra en conflicto con una reasignación del coordinador y gana el cambio remoto sin avisar.
- **Por qué es problema:** CampusOps promete cola persistente y "sin pérdida silenciosa de cambios pendientes" (`docs/CAMPUSOPS.md`). Si el técnico pierde lo que registró, vuelve al papel y se incumple el criterio de aceptación AC-04 de `docs/problem-definition.md`.
- **Probabilidad (Media):** no ocurre siempre, pero sí en cuanto dos personas tocan la misma incidencia; el campo `work` (asignado + estado) hace que un inicio local y una reasignación remota choquen sobre el mismo campo.
- **Impacto (Alto):** se pierde trabajo real, no una molestia visual; rompe una capacidad central y un criterio duro; la pérdida es silenciosa y difícil de detectar después.
- **Mitigación:** cola local con identidad estable de operación que sobrevive al reinicio; al sincronizar se compara `baseVersion` y, si hubo cambio remoto sobre el mismo campo, se marca conflicto y se conserva la intención pendiente; la interfaz muestra "pendiente" y "en conflicto".
- **Evidencia de que sirvió:** (a) prueba de reinicio con un cambio pendiente que sigue en la cola; (b) prueba unitaria de `resolveSync` que reporta `{ kind: 'conflict', fields: ['work'] }` sin vaciar la cola; (c) ambos resultados en el reporte de la semana 8.

### Riesgo 2 — Incidencias duplicadas

- **Evento:** se crean varias incidencias para la misma falla, por reporte de varias personas o por un reintento de red al momento de crear.
- **Por qué es problema:** el coordinador prioriza mal con datos inflados y se asignan técnicos distintos al mismo problema; el desperdicio de tiempo es directo.
- **Probabilidad (Alta):** es un error muy común en apps de reportes; hay reintentos de red y varias personas viendo la misma falla en el campus.
- **Impacto (Medio):** ensucia los datos y desperdicia tiempo, pero no se pierde información ni se bloquea el flujo; se limpia cerrando los duplicados. No sube a "alto" porque no afecta seguridad ni un criterio de aceptación duro.
- **Mitigación:** exigir una `Idempotency-Key` estable al crear una incidencia, de modo que reenviar la misma operación no cree una segunda; avisar al reportante si ya existe una incidencia abierta con la misma categoría y ubicación aproximada antes de confirmar.
- **Evidencia de que sirvió:** prueba que llama dos veces a `POST /v1/incidents` con la misma `Idempotency-Key` y verifica que la segunda respuesta devuelve la misma incidencia (mismo `id`), la lista no crece y el historial no se duplica.

### Riesgo 3 — Permisos controlados sólo en la interfaz

- **Evento:** un técnico ejecuta acciones sobre incidencias que no tiene asignadas, o alguien que no es coordinador cierra un caso, porque la autorización sólo esconde botones en la pantalla.
- **Por qué es problema:** `docs/CAMPUSOPS.md` lo dice explícito ("Ocultar un botón no sustituye comprobar permisos en el servicio" y "Un técnico no modifica una incidencia que ya fue reasignada a otra persona"); es un problema de privacidad (ve datos de incidencias ajenas) y de integridad (cambia estados que no le corresponden).
- **Probabilidad (Media):** es el atajo natural cuando se arma la UI primero; se cae en él sin querer si ninguna prueba lo vigila.
- **Impacto (Alto):** rompe el modelo de perfiles completo, y exponer datos personales de incidencias ajenas puede caer en la penalización de la rúbrica; corregirlo tarde implica rehacer la capa de servicio.
- **Mitigación:** validar rol y asignación en el backend/capa de servicio en cada acción, sin confiar en el rol que manda el cliente; responder `403` cuando el actor no tiene permiso o la incidencia no le está asignada, sin modificar el recurso.
- **Evidencia de que sirvió:** prueba negativa donde `technician-2` intenta `start`/`resolve`/`comment` sobre `campus-inc-001` (asignada a `technician-1`) y el servicio responde `403` y la incidencia queda sin cambios (misma versión, mismo historial).

## Riesgo que atenderíamos primero

El **Riesgo 1** (pérdida de cambios del técnico sin conexión). Aunque el Riesgo 2 es más probable, su impacto es sólo medio y se limpia cerrando duplicados; el Riesgo 1 destruye trabajo ya hecho y la confianza en la app, incumple el criterio AC-04 y su naturaleza silenciosa lo hace difícil de detectar si no se diseñan la cola y `resolveSync` desde el principio. El Riesgo 3, también de impacto alto, se puede blindar más tarde con pruebas negativas sin rediseñar la capa de servicio; el Riesgo 1, en cambio, obliga a decidir la forma de la cola y del merge antes de escribir el código de sincronización, así que es el que hay que atender primero.
