# Definición del problema — CampusOps

> Sustituyan todas las indicaciones entre corchetes por el trabajo del equipo.

## Problema

En el campus ficticio, las fallas de infraestructura y mantenimiento —por ejemplo, problemas eléctricos, fugas de agua, equipos descompuestos o falta de conectividad— pueden reportarse por canales dispersos y sin seguimiento claro. CampusOps centraliza el registro, la priorización, la asignación y el seguimiento de estas incidencias para que el reportante conozca su estado y el personal responsable pueda atenderlas de forma ordenada. Esto importa porque permite identificar incidencias pendientes, dar trazabilidad a cada cambio y reducir el riesgo de que una falla que afecta la seguridad, las clases o los laboratorios quede sin atención.

## Alcance

### Incluye

- Inicio y cierre de sesión seguro para los perfiles de reportante, técnico y coordinador, con funciones y permisos acordes con cada perfil.
- Registro y consulta de incidencias con categoría, descripción, ubicación y evidencia fotográfica sintética.
- Priorización, asignación o reasignación de técnicos, cambios de estado, diagnóstico, historial y cierre por coordinación.
- Consulta y actualización de incidencias sin conexión mediante una cola persistente, con sincronización y aviso de conflictos.
- Consulta de ubicación por un servicio de mapas o geocodificación, con edificio, zona o referencia escrita manualmente cuando el servicio no esté disponible o se deniegue el permiso.
- Notificaciones push para informar cambios relevantes en una incidencia, sin impedir la consulta de la aplicación si el usuario las rechaza o no las habilita.

### No incluye

- Atención de emergencias reales, uso de datos personales reales, planos sensibles o integración con sistemas institucionales reales.
- Chat en tiempo real, pagos, reconocimiento de imágenes con IA, panel web administrativo completo o publicación obligatoria en tiendas.

## Actores y responsabilidades

- **Reportante:** crea una incidencia, selecciona su categoría, describe el problema, indica una ubicación, adjunta evidencia sintética si es necesaria, consulta sus reportes y agrega información posterior.
- **Técnico:** consulta únicamente las incidencias que tiene asignadas, inicia la atención, registra diagnóstico, notas y evidencias, marca la resolución y conserva sus cambios para sincronizarlos cuando recupere conexión.
- **Coordinador:** consulta el conjunto de incidencias, determina prioridad, asigna o reasigna técnicos, revisa el historial y las evidencias, cierra una resolución o reabre un caso cuando corresponda.

## Flujo principal

1. Reportar: el reportante registra una incidencia con categoría, descripción y ubicación. El sistema la guarda con estado `open` y muestra el reporte en la consulta del reportante.
2. Asignar: el coordinador revisa la incidencia, establece su prioridad y asigna un técnico. El estado cambia a `assigned` y se registra el cambio en el historial.
3. Atender: el técnico asignado inicia el trabajo; el estado cambia a `in_progress`. Añade diagnóstico, notas o evidencias y, al terminar, marca la incidencia como `resolved`.
4. Cerrar: el coordinador revisa la resolución y cierra el caso cambiándolo a `closed`. Si la solución no es suficiente, puede reabrirlo hacia `assigned` siempre que exista un técnico asignado; cada transición queda en el historial.

## Criterios de aceptación verificables

1. Dado un reportante autenticado, cuando registra una incidencia con categoría, descripción y ubicación válidas, entonces se crea con estado `open` y puede verla en su lista de reportes.
2. Dada una incidencia en estado `open`, cuando el coordinador asigna un técnico y establece una prioridad, entonces la incidencia cambia a `assigned`, muestra el técnico asignado y el historial conserva el evento de asignación.
3. Dada una incidencia asignada a un técnico, cuando ese técnico registra un diagnóstico y la marca como resuelta, entonces el estado cambia a `resolved`; sólo un coordinador puede cambiarla posteriormente a `closed` o reabrirla.
4. Dado un técnico sin conexión que inicia la atención de una incidencia asignada, cuando reinicia la aplicación antes de recuperar conexión, entonces el cambio permanece pendiente en la cola local y se muestra como pendiente de sincronización.
