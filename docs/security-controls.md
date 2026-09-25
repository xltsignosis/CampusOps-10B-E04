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

## Riesgo residual

`expo-secure-store` protege los datos en reposo, pero no protege contra
un dispositivo con jailbreak/root, capturas de pantalla mientras se
muestra información sensible, ni que un usuario comparta voluntariamente
sus credenciales. Estos riesgos quedan fuera del alcance de esta semana.