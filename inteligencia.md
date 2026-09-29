# Inteligencia — PreciosAlDía Multilocal

Aprendizajes reutilizables del proyecto. Lo operativo del día a día va en `bitacora.md`.

---

## 2026-09-29 — Multi-negocio: router de storage con clave lógica vs física
- Patrón que funcionó: UNA función (`routeStorageKey`) decide el prefijo; el resto
  de la app sigue hablando en claves lógicas. Eventos, colas y circuit breakers
  usan la lógica; solo el acceso físico (localforage/localStorage) usa la enrutada.
  Idempotencia obligatoria: enrutar dos veces no debe duplicar el prefijo.
- Cambiar de tenant con `window.location.reload()` es la forma más segura de
  rehidratar N stores zustand + contextos React sin dejar estado cruzado.
  Documentarlo como decisión intencional, no como parche.
- El boot/migración debe correr ANTES del primer render y ser idempotente:
  si el registro existe, no toca nada. "Mover, no copiar": escribir destino,
  verificar, y recién borrar origen.
- Espejo de compatibilidad: cuando mucho código legacy lee `business_*`, no
  reescribirlo todo — mantener un espejo sincronizado con el tenant activo y
  declarar el registro como fuente de verdad.
- Auth por tenant: el adapter de persistencia de zustand puede enrutar el nombre
  de la clave dinámicamente en cada operación (no hace falta recrear el store).
- En tests con jsdom, mockear `localforage` con un Map cubre la lógica de
  migración sin necesidad de fake-indexeddb.
- `persist.clearStorage()` de zustand BORRA el estado persistido — nunca usarlo
  como "limpiar caché" antes de un rehydrate.
