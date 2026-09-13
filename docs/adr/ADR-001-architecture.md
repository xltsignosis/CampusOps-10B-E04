# ADR-001 — Arquitectura en capas para CampusOps

## Contexto
CampusOps tendrá pantallas, reglas de incidencias, sesión, almacenamiento y
servicios de ubicación. Necesitamos separar responsabilidades para probar
la lógica de negocio sin depender de React Native, Expo, HTTP o
almacenamiento real, y para cambiar de proveedor sin reescribir pantallas.

## Alternativas consideradas

**Alternativa 1: Arquitectura en 4 capas (UI, Application, Domain, Infrastructure)**
- Facilidad de prueba: alta — domain no importa React Native, Expo ni HTTP.
- Complejidad: media — requiere definir contratos entre capas.
- Cambio de proveedor: bajo costo — se reemplaza solo el adaptador de infrastructure.

**Alternativa 2: MVVM simple**
- Facilidad de prueba: media — el ViewModel mezcla presentación y llamadas a servicios.
- Complejidad: baja — menos capas.
- Cambio de proveedor: costo más alto — el ViewModel conoce el servicio directamente.

## Decisión
Adoptamos la arquitectura en 4 capas (ui, application, domain,
infrastructure), conservando React Native, Expo y TypeScript ya definidos.

## Consecuencias y trade-off
Beneficio: domain y application se prueban de forma aislada, y sustituir
el proveedor de incidencias o ubicación solo requiere un nuevo adaptador
de infrastructure, sin tocar ui. Costo: mayor cantidad de interfaces y
archivos que en MVVM, con una curva de aprendizaje inicial para el equipo.