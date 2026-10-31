# Política de resiliencia — Semana 09

## Proveedor y límites

La app usa Photon (demo público de Komoot sobre datos OpenStreetMap) mediante GeocodingClient y el puerto GeocodingResolver. La configuración EXPO_PUBLIC_GEOCODING_PROVIDER=course permite usar el doble HTTP del curso; por defecto la app elige photon. El constructor del adaptador conserva course como predeterminado para compatibilidad y pruebas. El proveedor externo recibe únicamente la consulta solicitada y Accept: application/json: no recibe sesión, tokens ni encabezados del curso.

Photon permite solicitudes moderadas; no publica una cuota numérica garantizada, puede limitar o bloquear uso excesivo, cambiar sin aviso y no garantiza disponibilidad. Política y contrato: https://github.com/komoot/photon#demo-server y https://github.com/komoot/photon/blob/master/docs/api-v1.md. El software Photon usa Apache-2.0; los datos OpenStreetMap requieren atribución y se rigen por ODbL: https://www.openstreetmap.org/copyright. La interfaz muestra la atribución junto al resultado sugerido o seleccionado. Esta demo no es una dependencia adecuada para cargas institucionales sin otro acuerdo o instancia propia.

No hay autocompletado, rastreo GPS ni consultas periódicas al geocodificador. La búsqueda es una acción opcional del usuario. No se envían datos personales en las comprobaciones. La selección externa debe confirmarse antes de usarla; una coincidencia textual no demuestra que un edificio ficticio exista.

## Alternativa manual y caché

El formulario conserva edificio, zona o referencia textual. Enviar reporte puede usarse sin consultar al proveedor, incluso mientras una búsqueda está pendiente. Editar la referencia invalida resultados tardíos y coordenadas aceptadas. Se puede regresar a la captura manual después de aceptar un resultado.

selectIncidentLocation es lógica de aplicación compartida con la fachada pública de evaluación. Sólo acepta objetos con etiqueta no vacía y coordenadas numéricas finitas en [-90,90] y [-180,180], incluido 0,0. Null, errores representados como datos, tipos incorrectos, respuestas incompletas y coordenadas inválidas devuelven exactamente la etiqueta manual sin coordenadas. Photon devuelve GeoJSON en orden longitud,latitud; el adaptador lo convierte explícitamente.

La caché es por instancia y proveedor, en memoria: TTL predeterminado de 300000 ms (cinco minutos), máximo 50 entradas, clave con trim y minúsculas; expira al alcanzar el TTL y expulsa la entrada insertada más antigua al superar el máximo. Sólo almacena ubicaciones válidas e inmutables. No almacena fallos ni resultados manuales. TTL, capacidad y reloj son configurables para comprobar sus límites; clearCache invalida los resultados. Reiniciar la app pierde esta caché temporal, sin borrar la cola SQLite.

El plazo predeterminado de 1500 ms cubre autorización, conexión, encabezados y lectura del cuerpo. Promise.race y AbortController impiden una espera indefinida incluso con un transporte que ignore abort. Timeout, JSON malformado, 429, 5xx o desconexión conducen a la alternativa manual; geocodificación no hace reintentos automáticos. La renovación de sesión sólo aplica al doble del curso, una vez y sin cambiar de actor.

El contrato remoto de creación persiste una ubicación textual: las coordenadas del borrador no se presentan como persistidas remotamente. No se inventan coordenadas para completar ese contrato.

## Cuándo reintentar y cuándo informar un fallo

IncidentClient y la fachada pública utilizan la misma planRetry de aplicación. attempt es el envío que acaba de fallar, comenzando en 1. Se permiten como máximo cuatro envíos totales: desde el intento 4 no se programa otro. Las esperas predeterminadas son 250, 500 y 1000 ms. maxAttempts (1 a 4), baseDelayMs y maxDelayMs son configurables y validados; el máximo predeterminado es 10000 ms y nunca puede exceder el rango de temporizadores de 2147483647 ms.

Son transitorios timeout, desconexión (mapeada a timeout por el cliente), 408, 429 y 5xx. Para 429/503 se interpreta Retry-After como segundos enteros o fecha HTTP válida y se espera el máximo entre backoff y lo solicitado por el servidor. Valores inválidos utilizan backoff. Si la espera del servidor excede maxDelayMs se informa el fallo sin recortarla ni enviar anticipadamente.

POST requiere una identidad estable de al menos ocho caracteres no vacíos. El cliente serializa una sola vez antes del primer await y conserva clave, ruta, contenido y baseVersion. Nunca se genera otra clave dentro de un reintento. La cola previa conserva operationId en SQLite y la interfaz conserva la clave del mismo intento manual. Cambiar el contenido define otra operación; reutilizar una clave consumida con contenido distinto produce 409.

401 permite una renovación de sesión y su reenvío consume el mismo presupuesto. Logout o cambio de actor cancelan nuevos envíos. 400, 403, 409, 422, contrato inválido o presupuesto agotado se informan mediante errores tipados y mensajes genéricos. Un conflicto requiere revisión y no reintento ciego. Las operaciones previamente encoladas permanecen pendientes hasta una confirmación válida: no se descartan por no recibir respuesta.

## Respuesta perdida y alcance de los avisos

La prueba crítica usa el backend del curso, sin modificarlo: timeout_after_commit aplica la operación y guarda su recibo, pero demora la respuesta 1500 ms. El cliente de prueba vence a los 100 ms; antes de reenviar se consulta el estado remoto y se verifica que la versión ya avanzó. Tras 250 ms, el mismo POST obtiene el recibo duplicate=true. La versión e historial avanzan una sola vez y las evidencias y notas preexistentes no cambian. También se pierde y repite una operación add_evidence sintética para comprobar que no crezca dos veces la lista.

Las pruebas de componentes usan CampusOpsApp, RemoteIncidentRepository, IncidentClient y HTTP local reales. Verifican cero avisos de éxito antes del reintento, un solo evento de aplicación exitoso y una sola confirmación visible al terminar. Notificaciones significa aquí avisos dentro de la app: no hay implementación ni comprobación de push nativo. No se afirma haber ejecutado un emulador o E2E en dispositivo. La exportación Android verifica el paquete JavaScript de Expo y tampoco equivale a instalar un APK.

## Reproducción y evidencia

Con Node 22.22.0, npm, GNU Make y Python 3: make setup; make feedback; make verify-week-09; make public-test-week-09. verify-week-09 ejecuta además la matriz específica y las métricas de reintento. npm run test:week09 genera reports/week-09/fault-injection.json desde aserciones de Jest y observaciones sanitizadas. npm run test:week09:retry regenera retry-metrics.json. Los ejecutores preservan el código de fallo y eliminan un reporte anterior antes de ejecutar, para no reutilizar éxitos antiguos.

npm run test:week09:regression conserva todas las suites acumuladas hasta semana 09 y genera regression.json. python tools/check-week09-evidence.py comprueba esquemas y procedencia SHA sin crear ni exigir una etiqueta.

La comprobación externa es optativa y separada de CI: npm run test:week09:provider. Usa el mismo adaptador con un incidente ficticio E04, una referencia pública (Ciudad de México) y una cadena de edificio inventada sin coincidencias. Verifica HTTP 200, resultado válido, caché y respuesta vacía, con sólo dos solicitudes separadas por al menos 1100 ms. Guarda fecha, duración, estado, cantidad de resultados y solicitudes en reports/week-09/provider-execution.json; no guarda tokens, texto de incidentes ni coordenadas. Este reporte documenta una ejecución observada, no garantiza disponibilidad futura. No se provocan errores reales para agotar cuotas externas.

Los reportes distinguen reloj real, temporizadores de Jest y reloj virtual. La telemetría contiene únicamente metadatos técnicos: método, intento, resultado, decisión de reintento y tiempos, sin cuerpos, diagnóstico, credenciales, actor ni claves de idempotencia. El diagrama docs/resilience-sequence.mmd representa ambas alternativas y el replay seguro.

Los JSON finales referencian el commit de código; el siguiente commit modifica exclusivamente reports/ y evidence/. La etiqueta y make evidence-week-09 corresponden al cierre posterior del equipo y no se realizan en esta intervención.
