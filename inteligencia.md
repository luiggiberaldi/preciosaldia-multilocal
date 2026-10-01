# Inteligencia — PreciosAlDía Multilocal

Aprendizajes reutilizables del proyecto. Lo operativo del día a día va en `bitacora.md`.

---

## 2026-10-01 — QUOTA-003: deltas diarios en vez de snapshots para egress
- Patrón: cuando un documento sincronizado crece con el tiempo (ventas,
  ledger), el push no debe re-subir el snapshot completo. Un doc diario
  (`prefijo_YYYY-MM-DD`) con solo lo nuevo + fusión idempotente por id en el
  receptor (`mergeSales`) convierte O(ventana) en O(delta). El snapshot
  completo pasa a ser nocturno/bajo demanda.
- La key dinámica no cabe en una allowlist exacta: validar por
  prefijo+formato (`isSalesDeltaKey`) tanto en el contrato como en el
  receptor. El validador del payload va por su propio contrato
  (`isValidSalesDelta`), no por la tabla de validadores estáticos.
- E2E contra Supabase real: el RLS de `sync_documents` exige (1) JWT del
  usuario Auth (no basta la anon key) y (2) dispositivo registrado en
  `device_sessions` ANTES de cualquier DELETE (el DELETE con RLS que filtra
  devuelve 200 con 0 filas, no error — silencioso). Para aislamiento entre
  corridas, device IDs únicos por run (`E2E-...-${Date.now().toString(36)}`)
  en vez de confiar en la limpieza.
- PostgREST upsert por REST necesita `Prefer: resolution=merge-duplicates`
  además de `on_conflict`; sin eso el segundo POST da 409.

## 2026-09-30 — CloudGate: un solo build, N proyectos Supabase por cliente
- Patrón que funcionó: cliente Supabase perezoso vía `Proxy` — todo el código
  existente sigue usando `supabaseCloud.from(...)` / `.auth...` sin cambios;
  si se toca antes de resolver el proyecto lanza un error claro en vez de
  fallar en silencio. La auditoría de "usos antes del gate" se hace buscando
  accesos a nivel de módulo (los imports solos no disparan el Proxy).
- Directorio central mínimo: la Estación solo expone `lookup_customer_project`
  (código → url + anon key) con RLS; el email del dueño nunca sale del
  directorio. El cliente del directorio es separado, sin `persistSession`.
- Orden de gates en `main.jsx`: recovery-url → CloudGate → App(PIN). El
  listener de `PASSWORD_RECOVERY` solo se ata con proyecto recordado; en
  primera activación no hay sesión que escuchar todavía.
- Lección de fechas: `date -u` puede decir 2026-10-01 mientras en Caracas
  (tz de luigi) sigue siendo 2026-09-30. Las entradas de bitácora usan la
  fecha local de luigi; verificar con `TZ=America/Caracas date` antes de
  fechar. (Casi se fechó mal esta entrada por mirar el reloj UTC.)
- `npm run build` no detecta imports rotos en archivos que nadie importa:
  `CloudGate.jsx` tenía `../config` en vez de `../../config` y el build
  pasaba igual porque aún no estaba conectado. Integrar primero, compilar
  después.

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

## 2026-09-30 — Multi-dispositivo con Supabase Auth + RLS (patrón anti-egress)

Patrón para sincronizar N dispositivos de un mismo dueño sin polling y sin quemar la cuota gratis:
1. **Raíz de confianza = cuenta Auth del dueño**, no el device_id. Tabla `account_devices(user_id, device_id, revoked)`; el dispositivo se auto-registra al entrar o al canjear código.
2. **Vinculación de caja sin escribir la contraseña:** tabla `pairing_codes(code 6 dígitos, user_id, expires_at, used)` + RPC `redeem_pairing_code` que valida expiración/uso único y registra el dispositivo en una sola llamada. La caja opera con sesión anónima (`is_anonymous`) y descubre a sus hermanos con un RPC `SECURITY DEFINER` (`my_account_device_ids()`) que solo devuelve device_ids — nunca datos de otros usuarios.
3. **RLS:** políticas "owner gestiona sus device_ids" + "dispositivo lee `sync_documents` donde `device_id` ∈ sus device_ids". Sin service_role en el cliente.
4. **Pull con watermark por cuenta** (`gt('updated_at', watermark)` en localStorage, orden ascendente, límite) en vez de traer todo en cada arranque. La corrección NO depende del watermark: el applier ignora lo que no sea más nuevo que la metadata local por documento (idempotente).
5. **Lección de edición:** al insertar una rama nueva en un hook largo, verificar con `node --check`/esbuild + correr la suite ANTES de seguir: un bloque pegado en la rama equivocada deja un `else` inalcanzable que solo se ve revisando el flujo. Hacer backup del archivo antes de ediciones quirúrgicas con python (`cp` a /tmp).

## 2026-09-30 — Tope de equipos por cuenta aplicado en el servidor

Lección reutilizable del límite de 6 equipos:
1. **El tope vive en un RPC `SECURITY DEFINER`, nunca en el cliente.** `register_account_device` cuenta los equipos activos del dueño (`auth.uid()`) sin contar el que se registra y falla con `LIMIT_REACHED` si ya hay 6. El cliente solo mapea ese token a UI (banner de límite). Así ningún cliente viejo o modificado puede saltarse el cupo.
2. **Re-vincular no consume cupo** (upsert idempotente); un equipo revocado que vuelve a entrar con la contraseña sí pasa por el conteo — si la cuenta está llena, se rechaza igual que uno nuevo.
3. **Ante el límite, no dejar sesiones a medias:** si el login es válido pero el equipo no se pudo vincular, se cierra la sesión de inmediato. Una sesión "conectada" que no sincroniza es peor que un error claro.
4. **En modo cuenta, el pull multi-dispositivo mezcla `doc_id` de hermanos:** cualquier lógica de "¿ya existe en la nube?" debe filtrar por `device_id` propio (traerlo en el `select`), o un hermano suprime el push propio.

## 2026-09-30 — `vi.unmock` también se eleva (hoisting) en Vitest

Lección del plan de tests CloudGate: llamar `vi.unmock('...')` dentro de un
`it()` desactivó el `vi.mock` de **todo el archivo** (los tests anteriores
empezaron a cargar el módulo real y fallaron con "[CloudGate] Proyecto sin
resolver"). El unmock no es solo "para lo que sigue": el registro de mocks
se evalúa elevado. Regla: si un archivo necesita el mock y otro caso necesita
el módulo real, van en **archivos de test separados** (`cloudGateFlows`
mockeado vs `cloudGateRealConfig` sin mock), no con unmock a mitad de archivo.

## 2026-10-01 — Lecciones de Fase 3 (sync multi-equipo)
- Las guardas de los tests que verifican texto fuente (`supervisorLifecycle.test.js`) se rompen en cada refactor del hook: al renombrar `subscriptionRef` → `subscriptionsRef` el test falló. Actualizar el guardrail junto con el refactor (la intención —"sin duplicar el canal"— sigue viva, solo cambió la forma).
- En reconciliación LWW, el "updatedAt más nuevo gana" es insuficiente para estados terminales (anulaciones): agregar una regla de dominancia explícita (ANULADA gana siempre) antes de comparar timestamps.
- Para mapas absolutos compartidos (stock), reconciliar por delta contra el último valor conocido de cada fuente es barato y evita el pisoteo de ventas concurrentes; la primera observación de cada fuente conserva asignación absoluta como semilla.
- Conflictos LWW silenciosos: detectar es barato (comparar hash del descartado vs el confirmado, o hash local vs último confirmado antes de sobrescribir) y el aviso en UI (badge ámbar en el indicador de sync) convierte una pérdida silenciosa en algo revisable.
