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

## 2026-09-29 — Verificar nombres de iconos lucide contra la versión instalada
`ReceiptX` no existe en la versión de lucide-react del repo y rompió el build
(vite-plugin-pwa/rollup falla con "not exported"). Antes de usar un icono
nuevo, verificar con `node -e "import('lucide-react').then(l => console.log(typeof l.Icono))"`.

## 2026-09-29 — Los 404 de la consola no se silencian, se evitan
Chrome pinta `GET url 404 (Not Found)` por cada fetch fallido y desde JS no
hay forma de suprimirlo (no es un `console.error` del código). Cuando un
backend opcional no existe (tablas/RPCs sin crear), la solución no es bajar el
volumen del log sino dejar de hacer las peticiones: detectar el primer 404
(códigos PGRST2xx = objeto no existe en el schema cache), cachear el estado
"no implementado" con TTL (localStorage) y saltear las llamadas. Distinguir
de errores de red/401/500, que NO deben marcar como caído. Al crear el
backend después, el TTL expira y todo se reactiva solo, sin deploy.

## 2026-09-30 — Sync delta en documentos JSON (patrón anti-cuota)

Cuando un documento JSON completo se sincroniza por upsert en cada cambio,
separar lo volátil de lo estable ahorra órdenes de magnitud: un mapa liviano
(`{id: campo}`) para lo que cambia en cada operación + el documento completo
solo cuando cambia lo estructural, detectado por hash que ignora los campos
volátiles. Al recibir, FUSIONAR (merge por id / aplicar mapa sobre el array
local), nunca reemplazar: así se puede podar la ventana enviada sin perder
historial. Regla de oro: el receptor nunca debe poder borrar datos con un
snapshot parcial. (Caso: `bodega_stock_v1` ~40KB vs catálogo ~3MB por venta;
ventas podadas a 90 días con `mergeSales`.)
