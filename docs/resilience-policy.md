# Política de resiliencia — Semana 09

## 1. Integración de geocodificación

La aplicación CampusOps utiliza un adaptador de infraestructura para consultar el servicio de geocodificación del backend del curso. Esta integración permite obtener una ubicación mediante una búsqueda de texto y conservar una alternativa manual cuando el proveedor no está disponible.

## 2. Validación de respuestas

Una respuesta del proveedor solamente se considera válida cuando contiene:

- Una etiqueta (`label`) de tipo texto y no vacía.
- Una latitud (`latitude`) numérica y finita, dentro del rango de -90 a 90.
- Una longitud (`longitude`) numérica y finita, dentro del rango de -180 a 180.

Si la respuesta es nula, incompleta, malformada o contiene coordenadas fuera de rango, la aplicación conserva la ubicación manual introducida por el usuario.

## 3. Manejo de fallos

La consulta al proveedor puede fallar por errores HTTP, límites de solicitudes, tiempos de espera o problemas de conexión.

Ante estos casos, el adaptador evita interrumpir el registro del incidente y devuelve una ubicación manual como alternativa. La interfaz mantiene la posibilidad de registrar el incidente sin depender de que el servicio externo esté disponible.

## 4. Caché

El adaptador conserva temporalmente las respuestas válidas de geocodificación para reducir solicitudes repetidas.

La caché utiliza un tiempo de vida limitado y una cantidad máxima de entradas. Las respuestas manuales o inválidas no se almacenan como resultados exitosos del proveedor.

## 5. Separación de responsabilidades

La interfaz utiliza una abstracción de dominio (`GeocodingResolver`) y no depende directamente de la implementación de infraestructura (`GeocodingClient`).

El adaptador de infraestructura se encarga de la comunicación HTTP, la validación de errores de transporte y la caché. La selección de ubicación determina si se utiliza el resultado del proveedor o la alternativa manual.

## 6. Limitaciones

El servicio utilizado corresponde al proveedor de pruebas del curso y no representa una integración con un servicio comercial de geocodificación.

La persistencia de coordenadas depende del contrato del repositorio y del backend. No se debe asumir que las coordenadas se guardan remotamente si el contrato de creación de incidentes solamente acepta una ubicación textual.

## 7. Verificación

La integración se verifica mediante pruebas que comprueban la aceptación de respuestas válidas y el uso de la ubicación manual ante respuestas inválidas o no disponibles. También se verifica la compilación TypeScript y los límites de dependencia entre capas.