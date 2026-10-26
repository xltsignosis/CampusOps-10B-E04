# Política de sincronización — semana 8

La app guarda la intención antes de enviar. `OfflineIncidentRepository` compone caché, cola y sesión; `syncPendingOperations` procesa la cola y `syncPolicy` contiene la combinación de tres vías y deduplicación que también usan los adaptadores públicos de evaluación.

## Identidad y confirmación

Cada fila pendiente guarda `operationId`, incidencia, autor, acción, contenido y `baseVersion`. El POST a `/v1/incidents/:id/actions` usa `Idempotency-Key: operationId` y esa versión base. Un reintento no modifica ninguno de esos valores. SQLite rechaza reutilizar una identidad con otro contenido; el backend responde 409 `idempotency_key_reused`. Ese rechazo se informa como contenido inválido y no retira la fila.

Sólo una respuesta 2xx con la identidad solicitada, incidencia correcta y versión válida permite construir el recibo. La transacción retira exclusivamente esa operación y actualiza el caché confirmado si no hay otras intenciones pendientes. Una respuesta incompleta, error, timeout o red caída conserva la cola. Un timeout puede ocurrir después del commit: se consulta repitiendo la misma solicitud, nunca generando otra clave.

## Notas y fotos

`start` no admite una nota en el contrato del servidor. Por eso su confirmación crea, **en la misma transacción que retira el inicio**, una operación `comment` con ID `${operationId}:note`, texto original y base igual a la versión confirmada. Si falla esa transacción, tampoco se borra el inicio. Al repetir el inicio, el servidor devuelve su resultado anterior y la transacción puede intentarse nuevamente.

La nota sucesora se procesa con su propia clave estable. Si su respuesta se pierde, sigue en SQLite y se recupera al reiniciar. No se repite su efecto. Las referencias de foto mantienen `pending`; confirmar un inicio o comentario no prueba que existan bytes ni que se hayan subido.

## Conflictos y autorización

El backend real comprueba autorización antes que versión. En el cruce de inicio local y reasignación a otro técnico, responde **403**, no 409. Si el autor era el técnico asignado y el inicio era válido en la base guardada, ese 403 se informa como conflicto de asignación/permisos (`assignment_or_permission_changed`, campo `work`). Esto no concede permiso para leer o escribir la incidencia reasignada. Otros 403/401 se conservan como rechazo de autorización. No se usa la sesión de coordinación para enviar una operación de un técnico.

Un 409 de versión o transición mantiene la fila. Si el autor puede consultar el estado actual, el resultado de aplicación incluye el remoto y la comparación de base/local/remoto. Si no puede leerlo, se conserva la intención y se requiere revisión autorizada. No se impone la asignación antigua ni se reescribe la solicitud con una base nueva conservando su clave.

`work` agrupa estado y asignación para detectar su incompatibilidad semántica. El repositorio de la app combina campos independientes para su representación: por ejemplo, inicio local más prioridad remota. Comparar objetos JSON ignora el orden de claves, conserva el orden de arrays y distingue ausencia de `null`. Los campos incompatibles se devuelven ordenados. No se mutan las entradas. Deduplicar mantiene la primera ocurrencia; no reemplaza la validación de identidad del almacén o servidor.

La combinación visual compatible no convierte un 409 en confirmación. Resolver una incompatibilidad requiere revisar el estado con permisos válidos y, si procede, expresar una nueva intención con nueva identidad y versión base. El caso de esta semana conserva ambos hechos y señala el bloqueo; el diseño completo de resolución en interfaz corresponde a semana 10.

## Ciclo de vida de la app

`App.tsx` abre el almacén después de restaurar/iniciar sesión. El listado remoto se guarda como caché sin sobrescribir intenciones pendientes ni regresar a una versión anterior. Sin conexión se recuperan caché y cola del autor. Las acciones se guardan antes del primer envío. Al abrir, volver a primer plano, pulsar sincronizar o recuperar conexión durante el sondeo de 15 segundos, se reintenta la cola; el repositorio comparte una sola sincronización en curso.

Cerrar o cambiar sesión desmonta el repositorio, detiene nuevos envíos y cierra SQLite después de terminar el envío en curso. Cada operación vuelve a comprobar la sesión antes de enviarse, incluida la nota sucesora. La cola no contiene tokens ni restaura credenciales. No se aceptan acciones dependientes nuevas sobre una incidencia que aún tiene un cambio pendiente de confirmar.

## Verificación

`npm run test:week08` ejecuta todas las pruebas acumuladas hasta esta semana, incluidas sesión, permisos y refresh compartido. Las pruebas usan el mismo motor y SQL de la app, SQLite en disco y el backend HTTP local. Incluyen reinicio, migración válida y rollback tras falla, 403 de reasignación, 409, combinación en el repositorio real, respuesta perdida en inicio y nota, colisión de identidad, recibo incorrecto y cambio de sesión durante sincronización. `make verify-week-08` ejecuta también esta suite; un fallo conserva salida distinta de cero.

El índice `reports/week-08/migration-tests.json` se genera después de ejecutar y conserva los estados observados. La comprobación nativa se registra separadamente de las pruebas de Node y de la exportación de Expo.

Para repetir la comprobación Android se requiere un emulador iniciado, Java/SDK Android, Node 22.22.0 y el APK de depuración instalado:

```text
node node_modules/expo/bin/cli prebuild --platform android --no-install
android\gradlew.bat -p android assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon --max-workers=2
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
node node_modules/expo/bin/cli start --localhost --port 8081 --max-workers 2
```

Con Metro activo, en otra terminal:

```text
python tools/check-week08-android.py --node <ruta-a-node-22.22.0> --reset-test-data
```

`--reset-test-data` reinicia exclusivamente los datos de la app académica en el emulador para repetir los actores ficticios. El script inicia su propio backend local en 4310, lo interrumpe para producir el cambio offline, fuerza el cierre de la app y compara las filas SQLite antes y después de reabrir. Luego restablece el backend y verifica inicio, comentario, base y cola confirmados. Guarda el resultado real en `reports/week-08/native-tests.json`; no acepta un dispositivo físico ni detiene un servidor ajeno que ya ocupe ese puerto.
