# Bitácora — PreciosAlDía Multi

Registro de cambios del proyecto. Cada commit lleva su entrada: qué cambió y por qué.

---

## 2026-10-01 — QUOTA-003: ventas como delta diario (fix de egress)

**Qué:** Cada venta subía la ventana completa de 90 días (~16MB por push con
100 ventas/día por vendedor → 46.6GB/mes realista, revienta los 5GB del tier
gratis). Ahora cada venta solo sube el delta del día
(`bodega_sales_delta_YYYY-MM-DD`, ~KB). La ventana de 90 días se sube solo al
cierre (`pushSalesWindow`) o bajo demanda. Tráfico modelado: 339MB/mes (138x menos).

**Cambios:**
- `src/utils/syncDelta.js`: `SALES_DELTA_KEY_PREFIX`, `salesDeltaKeyForDate()`,
  `isSalesDeltaKey()`, `filterTicketsForDay()`, `buildSalesDeltaPayload()`,
  `isValidSalesDelta()`, `salesDeltaTickets()`.
- `src/hooks/useCloudSync.js`: `pushCloudSync('bodega_sales_v1')` ahora delega
  en `pushSalesDelta()` (hash-gating propio por día); nuevo `pushSalesWindow()`
  exportado para el cierre; `_applyFromCloud` fusiona deltas entrantes con
  `mergeSales` sobre `bodega_sales_v1` local (idempotente).
- `src/hooks/useMonitorSync.js`: el monitor fusiona deltas en la vista de
  ventas del negocio pareado (feed en vivo sin ventana completa).
- `src/services/supervisorContracts.js`: `isSupervisorSyncKey` y
  `validateSupervisorSyncDocument` aceptan deltas por prefijo+formato (la key
  es dinámica por día, no cabe en la allowlist exacta).
- `tests/syncDelta.test.js`: 6 tests nuevos (formato, filtro por día,
  validación, idempotencia, contrato, extracción).

**Verificado (sin commit):**
- `npx vitest run tests/syncDelta.test.js` → 19/19 verde.
- `npx vitest run tests/supervisorSync.test.js` → 8/8 verde.
- E2E `estacion-2026/scripts/e2e_quota003.mjs` contra el proyecto del cliente
  (LIC-8P3CQY): 12/12 verde ×2 corridas — vendedor A (5) → supervisor ve 5;
  vendedor B (3) → 8 sin duplicados; offline (2 más) → 7 en el delta;
  re-pull idempotente → 10 únicos; la ventana completa jamás se sube.
- `capacity_free_tier.mjs` re-ejecutado: 46,594MB/mes hoy vs 339MB/mes con
  el fix (S7, 138x).

**Por qué:** El tier gratis de Supabase (5GB egress/mes) no aguanta re-subir
16MB por venta. El delta es O(tickets de hoy) en vez de O(ventana de 90 días).

**Rama:** `fix/quota-003-sales-delta` → merge a `main` (`6a37f2d6`) + push +
deploy a producción. **Desplegado 2026-10-01:** `preciosaldia-multilocal.vercel.app`
status Ready (200 OK). luigi autorizó merge+deploy en el chat.

## 2026-09-30 — Pro: modo demo eliminado + CloudGate (código → login nube → PIN)

**Qué:** El Pro quedó sin rastro de demo ni mensualidad (decisión de luigi: Pro
siempre Premium, pago único permanente) y con la puerta de entrada a la nube
por cliente: código de licencia (una vez) → login del dueño en su Supabase
propio (una vez) → PIN local. Después, proyecto y sesión se recuerdan y la
caja abre sin internet.

**Demo eliminado (verificado, sin commit):**
- Borrado `src/hooks/useDemoCountdown.js`; sin `isDemo`, `demoTimeLeft`,
  `activateDemo`, countdown ni gracia mensual en todo `src/` (solo quedan la
  llave legada `pda_demo_flag_v1` en listas de claves protegidas y comentarios
  que documentan que demo ya no existe).
- `PremiumGuard` quedó como gate puro de Premium (sin variantes demo).
- QA: `npx vitest run` → 774 pasan, 11 saltados; 2 fallos PREEXISTENTES ajenos
  a demo: `supervisorLifecycle.test.js` (lee `PairingManager.jsx`, borrado en
  el commit 2987dd4 de esta mañana) y `receivablesDeterministic.test.js`
  (fixture con fecha 2026-09-20, deriva con el día actual).
- `npm run build` OK (PWA genera sw.js + workbox).

**CloudGate (integrado, sin commit):**
- Nuevo `src/components/security/CloudGate.jsx`: estados
  checking → code → login → ready (+ limit si la cuenta llegó a 6 equipos,
  con opción de liberar uno). Offline-first: con proyecto + sesión guardados
  entra sin red.
- `src/config/supabaseCloud.js`: cliente perezoso por cliente (Proxy que
  lanza error claro si se usa antes de resolver el proyecto) + cliente fijo
  del directorio de la Estación (`VITE_DIRECTORY_URL` /
  `VITE_DIRECTORY_ANON_KEY`).
- Nuevo `src/services/customerDirectory.js`: `lookupProjectByCode` normaliza
  el código y llama al RPC `lookup_customer_project` del directorio.
- `src/main.jsx`: `AppRouter` ahora muestra `<CloudGate onReady={...}/>` antes
  de `<App/>` (el PIN local queda después, como se aprobó). El listener de
  `PASSWORD_RECOVERY` solo se ata si ya hay proyecto recordado; el flujo de
  recuperación por email sigue pasando por `ResetPasswordView`.
- Corregido bug: `CloudGate.jsx` importaba con `../config` y `../services`
  (apuntaban a `src/components/...`); ahora usa `../../`.
- Auditoría de usos tempranos de `supabaseCloud`: 18 archivos lo importan,
  todos dentro de funciones/hooks que solo corren tras el gate. Ningún acceso
  a nivel de módulo.
- `.env.example`: documentadas `VITE_DIRECTORY_URL`,
  `VITE_DIRECTORY_ANON_KEY`, `VITE_SUPERVISOR_E2E_STAGING`,
  `VITE_SUPABASE_STAGING_URL/KEY`.
- Nuevo `tests/cloudGate.test.js`: 9 tests (normalización de código,
  directorio sin configurar, código inexistente, error de RPC, formato del
  proyecto, Proxy antes/después de resolver). Todos pasan.

**No tocado:** los cambios del importador Excel de luigi (`package.json`,
`package-lock.json`, `ProductsToolbar.jsx`, `ProductsView.jsx`,
`ExcelImportModal.jsx`, `excelImport.js`, `excelImport.test.js`) siguen
intactos en el working tree.

**Pendiente (requiere a luigi):** commit/push/deploy con autorización
separada; recuperación de contraseña desde el gate; aplicar la migración 003
del directorio en la Estación para probar el flujo real código → proyecto.

---

## 2026-09-29 — Limpieza de consola: guard del backend de dispositivos (404s)

**Qué:** La consola del navegador se llenaba de 404s contra Supabase
(`backup_requests`, `licenses`, RPCs `get_license_status`,
`auto_register_device`, `heartbeat_device`), varios en `setInterval`
(cada 60 s y cada 3 min). Esos endpoints no existen: el backend de
licencias/dispositivos nunca se creó porque el modelo comercial no está
decidido. Chrome pinta un 404 por cada fetch fallido y desde JS no se puede
silenciar — la única forma de limpiar el log es dejar de hacer las peticiones.

**Cómo:**
- Nuevo `src/utils/deviceBackend.js`: guard puro que detecta el
  "no implementado" (`isBackendMissingError`: códigos PGRST2xx, status 404,
  mensajes "not found"/"does not exist"). Errores de red, 401/403 o 500 NO
  marcan como caído (el backend existe pero no responde → se sigue intentando).
- Al primer 404 se marca caído (`markDeviceBackendDown`) y se persiste en
  localStorage con TTL de 24 h: en siguientes sesiones ni se intenta.
  Vencido el TTL se reintenta solo, así cuando luigi cree las tablas/RPCs
  la app lo detecta y reactiva todo sin deploy.
- Aplicado en `useLicenseMonitoring` (verifyStatus, sendHeartbeat cada 3 min,
  suscripción Realtime `licenses_sync_`), `useSecurity` (`_fetchRemoteLicense`,
  registro + heartbeat al arrancar, `forceHeartbeat`) y `useAutoBackup`
  (poll de `backup_requests` cada 60 s + canal Realtime).
- Un solo `console.info` por sesión explica el estado (no es error).
- 11 tests nuevos en `tests/deviceBackend.test.js`.

**Verificación:** 717 tests pasan (1 fallo preexistente sensible a fecha en
`receivablesDeterministic`, no relacionado), build verde.

**Nota para luigi:** la app sigue 100% funcional en local; esto solo quita
ruido de la consola y ahorra datos/batería en el teléfono. Cuando decidas el
modelo comercial y creemos `licenses` + `backup_requests` en Supabase, todo
se reactiva solo.

---

## 2026-09-29 — Nace el proyecto
- Se usa el repo `luiggiberaldi/preciosaldia-multilocal` (creado por luigi) como clon de
  `luiggiberaldi/preciosaldia2026` (commit base `09b5b6e`).
- Decisión: repo nuevo + proyecto Supabase nuevo, separados del producto original.
  El cliente (dueño de 2 negocios: bodega + cosméticos) no comparte infraestructura
  con PreciosAlDía.
- Se escribe `ROADMAP.md` con las fases: Fundación → Multi-negocio core →
  Experiencia del dueño → Futuro (vertical cosméticos, sucursales).
- Alcance Fase 1 fijado con luigi: mismo vertical BODEGA en ambos negocios;
  el requerimiento es puro multi-negocio con datos aislados.
- `BRIEF-FASE1.md` existió como guía de implementación y se eliminó tras
  volcarse su contenido esencial en el roadmap (era temporal, no se pushea).
- Estado: en pausa por luigi antes de iniciar la implementación.

## 2026-09-29 — Push inicial al repo oficial
- Se fusionó el `init` del remoto (README de luigi) con el código base local
  (historias sin ancestro común): merge con `--allow-unrelated-histories`.
- Conflicto add/add en `README.md` resuelto conservando el cuerpo documental
  local con el título del proyecto nuevo: `# PreciosAlDía Multilocal`.
- Push inicial a `luiggiberaldi/preciosaldia-multilocal` vía git-push.py
  (Git Database API, fast-forward). El repo remoto ya tiene el código base,
  el roadmap y esta bitácora. `BRIEF-FASE1.md` no se pushea (temporal).

## 2026-09-29 — Fase 1 (1/4): núcleo multi-negocio + router de storage + migración
- Qué: `src/utils/negocioContext.js` (fuente de verdad: negocio activo en memoria,
  `routeStorageKey`/`routeAuthKey`, doc IDs `nb_<id>:<clave>`, lista de claves
  globales, espejo fiscal `syncFiscalMirror`), `src/hooks/store/useNegociosStore.js`
  (registro global `pda-negocios-registry`: crear/actualizar/eliminar/activar; cambiar
  de negocio RECARGA la app para rehidratar todo desde el namespace correcto),
  `src/utils/bootNegocios.js` (migración automática una sola vez: mueve —no copia—
  las claves existentes a `nb_neg-1:` y crea "Mi negocio" heredando datos fiscales),
  `src/utils/appForage.js` (wrapper de localforage con routing para el código que
  accede directo a IndexedDB).
- Por qué: sin este núcleo nada puede aislarse por negocio. El router es una sola
  función para que ninguna otra parte decida qué lleva prefijo.
- Cambios en código existente:
  - `storageService.js`: get/set/removeItem enrutan por negocio (clave lógica intacta
    para eventos y cola cloud); circuit breaker y sombras usan la clave física;
    la cola de reintentos guarda la clave física; `clearAllData()` solo limpia el
    namespace activo y preserva globales/otros negocios.
  - `shadowBackupService.js`: sombras namespaced por negocio.
  - `useAuthStore.js`: adapter de persistencia con routing dinámico
    (`nb_<id>:abasto-auth-storage`) + sesión `abasto-device-session` namespaced →
    usuarios/PIN separados por negocio. `RemoteUsersManager` y `OwnerMonitorView`
    leen el auth del negocio activo.
  - `main.jsx`: `startApp()` corre `bootNegocios()` y rehidrata stores ANTES del
    primer render; la app no monta hasta terminar.
- Decisiones: cambiar de negocio recarga la app (seguridad > fluidez: imposible
  mezclar datos por un store sin rehidratar); tasas/identidad/registro son globales
  por diseño; `business_*` queda como espejo del negocio activo para no reescribir
  todo el código fiscal existente; tenant.js intacto (vertical BODEGA en ambos).
- Tests: `tests/negocioContext.test.js` + `tests/bootNegocios.test.js` (16 tests:
  routing, idempotencia, doc IDs cloud, aislamiento de dos negocios, migración sin
  pérdida). Los 4 archivos de test que fallan en el repo (`dailyCloseDetail`,
  `stockBatchModal`, `supervisorCommands`, `receivablesDeterministic`) ya fallaban
  antes de estos cambios (verificado con stash).

## 2026-09-29 — Fase 1 (3/4): sync cloud y backups por negocio
- Qué: `doc_id = nb_<negocioId>:<clave>` en `sync_documents` (la columna
  `collection` ya existía, no se duplica en el doc_id). Las tasas y demás
  claves globales quedan sin prefijo y se comparten.
- Por qué: dos negocios no pueden pisarse los documentos en la nube.
- Cambios:
  - `useCloudSync.js`: `pushCloudSync` genera el doc_id namespaced; hash de
    último push por doc_id (estado separado por negocio); pull inicial y
    `_applyFromCloud` solo aplican docs del negocio activo o globales
    (`isDocForActiveBusiness`); los docs legacy sin prefijo se ignoran (el push
    local los re-publica namespaced); validación de supervisor y schemas con la
    clave BASE; lecturas/escrituras vía `appForage` (namespace activo).
  - `useMonitorSync.js`: valida con la clave base; escribe con el doc_id
    completo (clave física) para no mezclar datos del primario con los del
    monitor; rechaza legacy y auth (SEC-002). Limitación Fase 1: el monitor
    muestra bien los datos cuando ambos dispositivos usan el mismo id de negocio
    (caso común: `neg-1`); selección de negocio en el monitor queda a futuro.
  - `useCloudBackup.js`: la inyección P2P en `sync_documents` usa doc_ids
    namespaced.
  - `backupRestoreService.js`, `SettingsModal` (restaurar archivo),
    `ShareInventoryModal` (importar), `ErrorBoundary` (recuperación): accesos
    directos a IndexedDB ahora vía `appForage` (namespace del negocio activo).
  - `OwnerMonitorView` (desvincular): ya no hace `localforage.clear()` global;
    borra solo claves `nb_*` (datos del primario), preserva registro y globales.
- Tests: `isDocForActiveBusiness` cubierto (activo/globales/otro negocio/legacy/
  auth). 20/20 en los tests nuevos.

## 2026-09-29 — Fase 1 (4/4): datos fiscales por negocio, auditoría y docs
- Qué: los formularios que escribían `business_name`/`business_rif` directo
  (Ajustes, términos iniciales) ahora actualizan el negocio activo en el
  registro (`actualizarNegocio`), que refresca el espejo fiscal solo.
- Por qué: el registro es la fuente de verdad fiscal; antes había dos fuentes
  (registro vs espejo) que podían divergir.
- Además:
  - `storageService.js`: el fallback de localStorage por cuota/error ahora usa
    la clave física namespaced (`rkey`); antes escribía con la clave lógica y
    fugaba datos entre negocios en ese caso borde. La lectura intenta `rkey`
    primero y luego el residuo legacy.
  - Auditoría completa de accesos directos: los restantes (`bootNegocios`,
    `eliminarNegocio`, monitor, router) son intencionales y documentados.
- Docs: `docs/storage-scope.md` (globales vs por negocio, reglas de sync,
  backup y fiscal).

## 2026-09-29 — Fase 1 (2/4): selector de negocio en el header
- Qué: `src/components/NegocioSelector.jsx` (pill compacta en el header con el
  negocio activo + modal de gestión) y `src/components/NegocioModal.jsx`
  (formulario crear/editar: nombre obligatorio, RIF, dirección, teléfono).
- Por qué: el dueño cambia, crea, edita y elimina negocios desde el header sin
  salir del flujo. Eliminar pide ConfirmModal y purga los datos namespaced del
  negocio (no deja huérfanos en IndexedDB/localStorage).
- Integrado en `DashboardView.jsx`: fila dedicada bajo la fila superior del
  header sticky, visible en móvil y escritorio.
- Decisiones: cambiar de negocio recarga la app a propósito (rehidratación total
  de stores/contextos, cero fuga entre negocios); no se permite eliminar el
  negocio activo ni el último; al crear, se sugiere cambiarse desde el selector.
- UI: modal redondeado, sin `<select>` nativo, sin alert/confirm/prompt, iconos
  lucide, una sola señal de foco (`focus:ring-brand/50`).

## 2026-09-29 — Push Fase 1 completa
- 4 commits pusheados a `main` (fast-forward, vía git-push.py):
  `045cfb0` → `7fd75f1` → `b2829dd` → `175f61b`.
- Build `npm run build` ok (15s, PWA). Suite: 619 pasan, 4 fallos preexistentes
  sin cambios. `BRIEF-FASE1.md` eliminado antes del push.
- Fase 1 completa según ROADMAP: multi-negocio operativo local, selector en
  header, sync cloud por negocio, datos fiscales por negocio. Pendiente de
  luigi: Supabase nuevo (config cloud real) y verificación visual en su teléfono.

## 2026-09-29 — vercel.json para preview deploy
- Se agrega `vercel.json` con rewrite `/(.*) → /index.html` (SPA: el router del
  cliente maneja las rutas; Vercel sirve primero los archivos estáticos que
  existen, así que `/assets/*`, PWA y demás no se ven afectados).
- Por qué: luigi autorizó subir un preview a Vercel para probar la Fase 1 en su
  teléfono (el sandbox no puede verificar visualmente apps locales).

## 2026-09-29 — Plan Fase 1.5: roles y vista supervisor
- luigi aprobó evolucionar el modo supervisor (pairing) a un modelo de roles:
  el modo actual se congela (no se elimina, no se le invierte más).
- Se documenta la Fase 1.5 en ROADMAP.md: PIN maestro global del dueño, roles
  `supervisor`/`cajero` por negocio, y vista Supervisión (por sede + consolidado
  de solo lectura, adelanta la Fase 2).

## 2026-09-29 — Fase 1.5 (1/5): PIN maestro global del dueño
- Qué: `src/utils/duenoAuth.js` — PIN maestro global del dueño: hash PBKDF2
  (mismo `hashPin`/`verifyPin` que los usuarios), bloqueo progresivo por intentos
  fallidos con la MISMA política `LOGIN_RATE_LIMIT` que el login de usuarios
  (5 intentos, lockout 30s con backoff x2 hasta 15 min, ventana de reset 30 min),
  y sesión global `{ id: 'dueno', nombre: 'Dueño', rol: 'DUENO', global: true }`.
  Las 3 claves (`pda-dueno-pin`, `pda-dueno-session`, `pda-dueno-pin-lock`) se
  registraron en `GLOBAL_STORAGE_KEYS` de `negocioContext.js`: ningún prefijo
  `nb_<id>:` las toca jamás. Tests nuevos: `tests/duenoAuth.test.js` (12 tests).
- Por qué: el dueño no está atado a ningún negocio (decisión de luigi 2026-09-29).
  El PIN maestro vive fuera de los namespaces por negocio para que cambiar de
  sede nunca lo pierda y el router de storage nunca lo cruce.
- Decisión: se replicó la política de lockout exacta de `useAuthStore` en vez de
  inventar otra, para no tener dos reglas de seguridad distintas en la misma app.

## 2026-09-29 — Fase 1.5 (2/5): sesión de dueño en useAuthStore + helpers de roles
- Qué: `useAuthStore` ahora acepta la sesión global del dueño: `loginAsDueno(pin)`
  verifica el PIN maestro y persiste la sesión en `pda-dueno-session` (global);
  `_readPersistedSession` revisa la sesión global primero (sobrevive al cambio de
  negocio); `logout` limpia también la sesión global; `_validateSessionShape`
  acepta `{ id:'dueno', rol:'DUENO', global:true }` además del formato de usuarios.
  Nuevo `src/utils/roles.js`: `isOwner/isSupervisor/isCashier`, `hasAdminAccess`
  (dueño o supervisor — reemplaza los `rol === 'ADMIN'` dispersos), `canManageBusinesses`
  (solo dueño), `canCreateRole`/`canManageUser` (dueño: todo; supervisor: solo cajeros),
  `visibleTabIds` (cajero: solo ventas+clientes; dueño/supervisor: todo + supervisión),
  `landingTab` (cajero→ventas, dueño→supervisión, supervisor→inicio). Tests:
  `tests/roles.test.js` (11 tests).
- Por qué: centralizar la matriz de permisos en un solo módulo evita que cada vista
  reinvente qué puede cada rol. El dueño se trata como admin en todos los gates
  existentes para no degradar su acceso.
- Decisión: los valores almacenados siguen siendo `'ADMIN'`/`'CAJERO'` (no se migran
  a minúsculas): el modo supervisor por pairing —congelado, no se toca— compara
  esos strings literalmente, y migrarlos rompería RemoteUsersManager y varios
  servicios. El significado documentado de `ADMIN` pasa a ser "supervisor del negocio".

## 2026-09-29 — Fase 1.5 (3/5): login del dueño + vista Supervisión
- Qué (login): `MasterPinSetupModal.jsx` — creación única del PIN maestro
  (se muestra al arrancar si `requireLogin` está activo y no hay PIN; bloquea
  hasta crearlo). `LockScreen.jsx` — botón "Soy el dueño" (solo si hay PIN
  maestro) que abre el PIN pad y llama `loginAsDueno`. `EmergencyPinResetModal`
  ahora incluye "Dueño (PIN maestro)" en la lista y `resetPinEmergency('dueno')`
  restablece el PIN maestro (misma clave de emergencia de 7 toques al logo).
  `App.jsx` — redirección por rol al iniciar sesión (`roles.landingTab`:
  cajero→ventas, dueño→supervisión, supervisor→inicio).
- Qué (Supervisión): `src/utils/supervisionData.js` — lectura cross-negocio de
  SOLO LECTURA: lee `nb_<id>:bodega_{sales,customers,products}_v1` directo de
  IndexedDB sin cambiar el negocio activo; `summarizeSales` (hoy/7 días/mes/
  ticket) con el mismo criterio de filtrado que `useDashboardMetrics`.
  `src/views/SupervisionView.jsx` — tab "Supervisión" (icono Building2): el dueño
  ve píldoras [Consolidado] + cada sede; el supervisor ve solo su sede. Por sede:
  KPIs (hoy/semana/mes/ticket), top 5 productos, stock bajo/agotado, fiados
  pendientes (reusa `useDashboardMetrics` por sede). Consolidado: tabla
  comparativa por sede + fila de totales, 100% lectura. Botón "Entrar a la sede"
  (solo dueño) para operar — cambia de negocio con `activarNegocio`.
- Por qué: el dueño necesita ver todas las sedes sin entrar a cada una; el
  supervisor necesita su panel sin salir de su sede. La lectura directa evita
  el reload de Fase 1 para un caso que es solo consulta.
- Decisión: tras "Entrar a la sede" la app recarga (Fase 1) y el login se pierde
  (regla existente: reload = logout) — el dueño reingresa su PIN. Se mantiene
  así por seguridad antes que por comodidad.

## 2026-09-29 — Fase 1.5 (4/5): enforcement de permisos en UI
- Qué: tabs filtrados por rol en `App.jsx` (`roles.visibleTabIds`): cajero solo
  ve Vender+Clientes; dueño y supervisor ven todo + Supervisión. `NegocioSelector`:
  crear/editar/eliminar negocios solo para el dueño (`canManageBusinesses`); el
  supervisor solo cambia de sede. `UsersManager`: el supervisor solo crea
  cajeros (selector de rol filtrado + validación en `handleAdd`) y solo administra
  filas de cajeros (`canManageUser`); cada quien conserva la gestión de su propia
  fila (su PIN, su nombre, su acceso). Etiqueta visible `ADMIN`→"Supervisor" en
  `UsersManager` y `UserCard`. `agregarUsuario` rechaza roles fuera de
  `ADMIN`/`CAJERO` (el dueño nunca es usuario de negocio). Gates actualizados a
  `hasAdminAccess` (dueño o supervisor): `CustomersView`, `SettingsView`,
  `auditService.clearAuditLog`, `customerWalletService` (ajustes de cartera),
  `useAutoLock` (timeout estricto también para el dueño).
- Por qué: ocultar pestañas no basta; la matriz de permisos se aplica también a
  nivel de servicio para que el dueño nunca quede degradado frente al supervisor.
- Decisión: los strings almacenados siguen siendo `ADMIN`/`CAJERO` (compat con el
  pairing congelado); solo cambia su significado documentado y las etiquetas.

## 2026-09-29 — Fase 1.5 (5/5): tests de supervisión + cierre de fase
- Qué: `tests/supervisionData.test.js` (5 tests deterministas con fecha fija:
  hoy/semana/mes/ticket, exclusión de anuladas/caja cerrada/no-ventas, ventana
  de 7 días, ceros sin NaN, aislamiento entre sedes). `ROADMAP.md`: Fase 1.5
  marcada como implementada.
- Estado de la suite: 682 tests pasan; 1 fallo PREEXISTENTE y no relacionado
  (`receivablesDeterministic.test.js` — falla igual con los cambios en stash;
  test determinista sensible a la fecha). `npm run build` verde.
  `src/config/tenant.js` intacto (sin cambios).

## 2026-09-29 — Fase 1.5 (6/6): auto-lock del dueño + gate de vistas + reglas UI
- Qué: `useAuthStore.unlock()` ahora verifica la sesión `DUENO` con
  `verifyMasterPin` (antes fallaba con "Usuario no encontrado" porque el dueño
  no vive en `usuarios`); el fallo cae al rate-limiting común del store.
  `App.jsx`: gate que redirige cualquier `activeTab` no permitido por el rol a
  su `landingTab` (ocultar pestañas ya no es la única defensa).
  `EmergencyPinResetModal`: `<select>` nativo reemplazado por `CustomSelect`.
  `MasterPinSetupModal`: input del PIN con una sola señal de foco
  (solo `focus:border`, sin ring).
- Decisión (criterio): el cajero conserva `['ventas', 'clientes']` — "POS y sus
  ventas" incluye la lista operativa de clientes para el fiado; la parte
  administrativa (proveedores, ajustes de cartera, tasas, usuarios) ya está
  vetada para el cajero por `isCajero`/`hasAdminAccess`.

## 2026-09-29 — Fix SEC-021 en producción (sin commit de código)

**Qué cambió:** Se agregaron `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` al `.env` local y a Vercel (production + preview), apuntando al mismo proyecto nuevo `oshexsmweswzbwaksvra`. Luego redeploy `--prod`.

**Por qué:** `src/core/supabaseClient.js` (cliente "licencias", usado por useSecurity/useLicenseMonitoring/DevicesManager) lee esas dos variables y, en build de producción, LANZA el error SEC-021 al importarse si faltan. Solo habíamos configurado las `VITE_SUPABASE_CLOUD_*` (cliente de sync), así que producción cargaba pero tiraba `Uncaught Error ... Configuración incompleta (SEC-021)` en consola. Ambas parejas apuntan al mismo proyecto nuevo: el modelo comercial/licencias no está decidido y el cliente de licencias cae a flujo local en try/catch silencioso.

## 2026-09-29 — Fix onboarding + T&C para lógica multi-local (auditoría de luigi)

**Qué cambió:**
1. `src/components/TermsOverlay.jsx`: se redujo al paso 1 (términos). El paso 2 (configuración del negocio) se extrajo a `BusinessSetupOverlay.jsx`. T&C actualizados: sección 2 suma bullet de gestión multi-negocio con datos separados; sección 4 reescrita por completo (el modelo viejo de licenciamiento por hardware/Estación Maestra/QR ya no existe → ahora describe el modelo de acceso por roles: PIN maestro del dueño, supervisor/cajero por negocio, responsabilidad sobre los PIN); sección 5 suma aislamiento de datos por negocio y límite por rol; fecha a Septiembre 2026; "sus negocios" en plural; pie "Tus Negocios Inteligentes".
2. `src/components/BusinessSetupOverlay.jsx` (nuevo): paso de configuración del primer negocio con el `import` de `useNegociosStore` correcto (el viejo TermsOverlay lo usaba sin importar y el try/catch ocultaba el ReferenceError: el nombre nunca llegaba al registro). Copy nuevo: "Tu primer negocio", aclara que podrá agregar más desde el selector y que los datos van separados; el correo se etiqueta como "Correo del Dueño" (global, las novedades son de la app).
3. `src/App.jsx`: nuevo orden de primer arranque — Términos → PIN maestro → configuración del primer negocio → app. Flag `pda_business_config_done`; instalaciones que ya aceptaron términos con el flujo anterior no ven el paso de nuevo (migración silenciosa).

**Por qué:** la auditoría del flujo de bienvenida mostró que el onboarding seguía pensado para un solo negocio (copy en singular, T&C con licenciamiento obsoleto de la app original) y tenía un bug real que impedía guardar el nombre en el registro de negocios.

## 2026-09-29 — Ocultar "Entrar en Modo Supervisor" del lock screen

**Qué cambió:** Se eliminó el botón "Entrar en Modo Supervisor" de `LockScreen.jsx` (y el prop `onOpenPairing` que solo él usaba). En `App.jsx` se retiró el estado `showPairingScan` y el render de `PairingScanScreen`, que solo eran alcanzables desde ese botón. Los archivos del modo pairing (`PairingScanScreen.jsx`, `PairingManager.jsx`, etc.) se conservan intactos: congelado, no eliminado.

**Por qué:** luigi reportó que el botón seguía saliendo en la pantalla de bloqueo. El modo supervisor por pairing está congelado desde Fase 1.5 (la supervisión ahora es por roles: dueño/supervisor/cajero), así que no debe ofrecerse en la UI. Nota: en Ajustes → Sistema sigue visible la sección "Celular del Supervisor" (PairingManager) solo para admin — pendiente decidir con luigi si también se oculta.

## 2026-09-29 — Fase B "Modo Jefe": renombre a administrador + monitor monetario en vivo

**Qué cambió:**
1. **Renombre supervisor → administrador** (`src/utils/roles.js`): `ROL_ADMINISTRADOR`,
   `isAdministrador`, `TABS_DUENO_ADMIN`. Los valores guardados `'ADMIN'`/`'CAJERO'` no
   cambian (compat con datos existentes); se dejan alias deprecated una versión.
   UI actualizada: `UsersManager` (label del rol), `UserCard` (tarjeta de perfil),
   comentarios en `LockScreen`, `SupervisionView`, `useAuthStore`. No se tocó el
   modo pairing congelado (`services/supervisor*`, otro concepto).
2. **Motor `src/utils/modoJefe.js`** (funciones puras, sin I/O): plata de hoy con
   desglose por moneda (USD/Bs/COP desde `payments[]`) y por método de pago,
   descuentos, anuladas, mejor hora; fiados otorgados vs cobrados; movimiento de
   caja (apertura + ventas cobradas + cobros − egresos = caja esperada); feed de
   últimas ventas; comparativas ayer/hace 7 días; alertas (anuladas, descuento
   ≥15% o ≥$5, caja sin apertura); `combinarPlata` para el consolidado.
3. **UI `src/views/ModoJefePanel.jsx`**: bloques "Plata de hoy · detalle",
   "En vivo" (feed), "Ojo de jefe", "Fiados en movimiento", "Comparativas" y
   "Alertas" por sede; `ConsolidadoJefe` para el dueño (agregados + ranking de
   sedes + alertas de todas). Integrado en `SupervisionView` (sede y consolidado).
4. **Railes:** R1 solo lectura (ningún botón del monitor muta datos); R2 refresco
   cada 10 s solo con la vista activa y pestaña visible, sin parpadeo del loader;
   R3 helper `num()` anti-NaN; R4 el cajero nunca recibe el tab supervisión;
   R5 badge "actualizado hace Xs".
5. **Arneses:** `tests/modoJefe.test.js` con 23 tests (fixtures: contado,
   multi-método, fiada, anulada, cobro, gastos con/sin afectaCaja, apertura,
   descuento alto, cashea, COP, ayer, hace 7 días, caja cerrada).

**Por qué:** luigi pidió que la Supervisión sea "lo más de jefe posible": monitor
en vivo y máximo detalle monetario; y confirmó la terna dueño/administrador/cajero
(el nombre "supervisor" chocaba con el modo pairing congelado).

**Verificación:** 706 tests pasan (682 previos + 24 nuevos); 1 fallo preexistente no
relacionado (`receivablesDeterministic`, sensible a fecha). Build verde. Plan
detallado en `docs/PLAN-FASE-B-MODO-JEFE.md`.

---

## 2026-09-30 — Fix respaldos silenciosos (lado POS, rama Pro)

**Qué:** `useAutoBackup.js` ahora reporta honestamente:

1. `performBackup()` devuelve `{ ok, driveUrl, error }` en vez de `undefined`.
2. Eliminado el fallback muerto a Supabase directo (requería sesión Auth que el
   POS anónimo nunca tiene; los errores se silenciaban con `.catch(() => null)`).
3. Si la estación rechaza los metadatos (`!res.ok` en `/api/backup/complete`),
   se devuelve `ok:false` con el motivo en vez de fingir éxito.
4. Nuevo helper `markBackupRequestFailed(requestId, reason)`: marca la solicitud
   `failed` (reintenta sin la columna `error` si la migración aún no está
   aplicada).
5. El procesamiento de solicitudes (poll + realtime) solo marca `completed`
   cuando el respaldo tuvo éxito real; revisa el resultado del UPDATE; en fallo
   marca `failed` con el motivo en vez de imprimir "procesado exitosamente".

**Por qué:** el pipeline convertía cualquier fallo en estado invisible:
solicitudes `pending` eternas, cero completadas históricamente, y la estación
mostrando "Solicitado" para siempre.

**Pendiente (IMPORTANTE):** este fix vive en el multilocal (Pro). Los equipos
en campo hoy corren **Lite (la app original)**, que aún tiene el código viejo
con éxito falso. luigi debe decidir si se porta el fix al repo original o se
migra el campo a Pro antes de reactivar solicitudes de respaldo. Además falta
sincronizar `VITE_ESTACION_BACKUP_SECRET` (POS) con `BACKUP_SHARED_SECRET`
(Estación) — el endpoint es fail-closed si no coinciden.

**Verificación:** 31 tests de backup pasan (backupRelay + backupRestore).
`node --check` limpio.

---

## 2026-09-30 — Botón Importar Excel en Pro (sede activa)

**Qué:** nuevo flujo para cargar el inventario de una sede desde un archivo
`.xlsx`, sin tocar la otra sede:

1. `src/utils/excelImport.js` (nuevo): lógica pura y testeable.
   - `detectarColumnas()`: localiza la fila de encabezado y mapea
     PRODUCTO→nombre, CODIGO→código, VENTA*→precio USD, EXISTENCIA→stock.
     Tolera variantes ("VENTA USD" en bodega, "VENTA " en cosméticos).
   - `parseNumero()`: entiende es-VE ("160,00", "1.234,56") y US ("1,234.56").
   - `mapInventarioRows()`: reglas de limpieza —
     * filas sin nombre se omiten;
     * código duplicado dentro del archivo: el primero lo conserva, los demás
       se importan SIN código (evita que el POS cobre el producto equivocado);
     * existencia negativa se importa tal cual (dato fiel) y se reporta;
     * existencia decimal se redondea a entero (la app solo admite decimales
       en granel);
     * nombres en MAYÚSCULAS se normalizan a formato título;
     * códigos grandes se preservan como texto (sin notación científica).
   - Construye el payload con `buildProductPayload()` (mismo esquema que el
     formulario manual) + `id: crypto.randomUUID()`.
2. `src/components/Products/ExcelImportModal.jsx` (nuevo): modal en 3 pasos —
   elegir archivo → vista previa (stats, advertencias, muestra de 8 filas y
   selector Agregar/Reemplazar si la sede ya tiene productos) → resultado.
   Usa el `Modal` propio de la app y iconos lucide (`FileSpreadsheet`).
3. `ProductsView.jsx`: estado `isExcelImportOpen`, handler `handleExcelImport`
   que persiste con `storageService.setItem('bodega_products_v1', …)` — la
   clave ya va prefijada por negocio (`nb_<id>:`), así que la importación
   **siempre cae en la sede activa**. En modo agregar omite códigos que ya
   existen en la sede. Registra auditoría `INVENTARIO / IMPORTACION_EXCEL`.
   El `EmptyState` de inventario vacío ganó acción secundaria "IMPORTAR EXCEL".
4. `ProductsToolbar.jsx`: ítem "Importar Excel" en el menú Herramientas
   (icono violeta `FileSpreadsheet`).
5. Nueva dependencia `xlsx@^0.18.5` (solo se usa en el cliente al elegir
   archivo; el parseo ocurre 100% local, nada se sube).

**Por qué:** el cliente multi-negocio (bodega + cosméticos) entregó sus
inventarios en Excel (2.423 y 2.988 productos). Cargarlos a mano es inviable;
el importador los deja listos en minutos, por sede, con vista previa y sin
confirmaciones del navegador (regla de UI: sin `confirm()`).

**Verificación:** 14 tests nuevos en `tests/excelImport.test.js` (encabezados
de ambos archivos, duplicados, negativos, decimales, precios cero,
códigos alfanuméricos como `M01`). Suite completa: 729 pasan; 3 fallos
preexistentes no relacionados (`modoJefe` ×2, `receivablesDeterministic` ×1 —
fallan también en árbol limpio). Build de producción verde. Prueba con los
Excel reales de luigi: bodega 2.423 importados (18 duplicados sin código,
996 negativos, 5 precio $0, 152 decimales redondeados); cosméticos 2.988
(1 duplicado, 2.147 negativos, 1 precio $0, 2 decimales) — cifras idénticas
al informe PDF entregado. Cero códigos en notación científica.

**Pendiente (NO pusheado):** commit y push a `luiggiberaldi/preciosaldia-multilocal`
cuando luigi lo autorice; luego él prueba la importación real desde su
teléfono en cada sede.

---

## 2026-09-30 — Distintivo PRO dorado en la pantalla de acceso

**Qué:** badge "PRO" en dorado pegado debajo del logo en `LockScreen.jsx`
(pantalla "Quien esta operando?"). Píldora redondeada con degradado dorado
(`#E7C65A → #C9962E`), texto oscuro, sombra suave — sin tocar `logo.png`.

**Por qué:** luigi pidió el distintivo PRO en la pantalla de acceso. Primera
propuesta (esquina superior derecha, verde petróleo) rechazada; segunda
(debajo del logo, dorado) aprobada con el badge más pegado al logo, como
parte del lockup. Mockups en `~/workspace/mockup-pro/` (v3 aprobada).

**Verificación:** build de producción verde. Revisión visual final en el
teléfono de luigi.

---

## 2026-09-30 — Versión 1.7.2 (distintivo PRO visible)

**Qué:** bump de versión 1.7.1 → 1.7.2 (`LockScreen.jsx`, `SettingsView.jsx`,
`package.json`). El badge PRO dorado ya estaba en producción desde el deploy
anterior, pero el caché del navegador mostraba la versión vieja; la versión
visible en la píldora sirve para confirmar que cargó lo nuevo.

---

## 2026-09-30 — Fix responsividad: modales cortados y solapamiento del bottom nav

**Qué:** 
- Modales del flujo de negocios (`NegocioSelector`, `NegocioModal`,
  `ConfirmModal`) y el `Modal` genérico: el overlay usaba `fixed inset-0`
  (viewport con la barra de URL de Chrome Android), lo que cortaba la parte
  superior de la tarjeta. Cambiado a `h-dvh` + `max-h-[85/90dvh]`.
- `App.jsx`: el contenido (`pb-16`) quedaba parcialmente tapado por el bottom
  nav fijo → `pb-28` en móvil.
- Tab "Supervisión" se truncaba ("Supervisi…"): se eliminó el `px-0.5` del
  botón y las variantes muertas `xs:` (no existe ese breakpoint), dándole más
  ancho al label.

**Por qué:** captura de luigi mostrando el modal "Mis negocios" cortado arriba,
la tarjeta "Registrar Gasto" tapada por el nav inferior y el tab truncado.

**Verificación:** build de producción verde. Revisión visual final en el
teléfono de luigi.

---

## 2026-09-30 — Pro: se elimina "Celular del Supervisor" de Ajustes > Sistema

**Qué:** se quitó la tarjeta "Celular del Supervisor" (vinculación QR del modo
supervisor) de `SettingsTabSistema.jsx`, junto con su import y el componente
`PairingManager.jsx` (quedó huérfano). También se actualizó la línea que
documentaba ese flujo en el prompt del asistente interno
(`chatSystemPrompt.js`).

**Por qué:** era el mecanismo de supervisión remota del Lite y seguía
apareciendo en Pro. En Pro la supervisión vive en la pestaña Supervisión
(Modo Jefe, multi-negocio). El monitor en vivo (`MonitorView`) no se tocó:
sigue usándose en Supervisión.

**Verificación:** build de producción verde. Revisión visual final en el
teléfono de luigi.

## 2026-09-30 — Pro: optimización de cuotas Supabase (tier gratis) + plan de purga

**Qué:** auditoría de consumo vs cuotas gratis (500MB DB, 5GB egress/mes, 1GB
Storage) con 5.000+ productos y fotos por sede. Implementado:

- **Sync delta de productos (QUOTA-001):** nuevo doc `bodega_stock_v1`
  (`{productId: stock}`, ~40KB) que se empuja en cada venta; el catálogo
  completo `bodega_products_v1` (~3MB) solo viaja cuando cambia algo
  estructural (precio/nombre/foto/alta/baja), detectado por hash que ignora
  `stock`/`updatedAt`. Fusión al recibir en POS (`_applyFromCloud`) y en el
  monitor (`applyDocToLocal`): el stock nunca reemplaza el catálogo.
- **Ventas podadas a 90 días (QUOTA-002):** el push envía la ventana reciente;
  el receptor fusiona por id (`mergeSales`, gana la más nueva), así la poda
  jamás borra historial local ni del monitor.
- **Audit log fuera del sync:** `abasto_audit_log_v1` sale de
  `SYNC_VALIDATORS` (era diagnóstico por dispositivo que crecía sin cota y se
  re-subía entero). Su retención local no se toca: respeta la regla fiscal
  (5 años, VENTA/CLIENTE/PAGO intocables).
- **Reintento de fotos (`imageMaintenance.js`):** las fotos que quedaron en
  base64 por falta de internet se suben a Storage al abrir la app y al
  recuperar red (tope 25 por ejecución).
- **Purga diaria (`purgeService.js`):** 1 vez al día, negocio activo. Tickets
  con más de 12 meses se compactan a resúmenes mensuales (totales por moneda
  y método; el detalle vive en los respaldos). SEGURO: solo corre con
  respaldo exitoso < 24h.
- **Purga mensual de huérfanas de Storage:** borra objetos de
  `product-images` que ningún producto de ningún negocio referencia; solo
  corre con sesión del dueño.
- Constantes centralizadas en `retentionPolicy.js`; 19 tests nuevos
  (`syncDelta`, `purgeService`); suite completa 746/758 (2 fallos
  preexistentes verificados sin estos cambios).

**Por qué:** con el esquema anterior, cada venta re-subía el doc de productos
completo y el monitor lo recibía por Realtime (~180MB/día → ~5,4GB/mes,
por encima de la cuota gratis). Ahora una venta típica mueve ~40KB.

**Archivos:** `src/utils/syncDelta.js`, `retentionPolicy.js`,
`purgeService.js`, `imageMaintenance.js` (nuevos);
`src/services/supervisorContracts.js`, `src/hooks/useCloudSync.js`,
`src/hooks/useMonitorSync.js`, `src/App.jsx`; `tests/syncDelta.test.js`,
`tests/purgeService.test.js`.

**Verificación:** build de producción verde. Prueba real desde los teléfonos
de las sedes pendiente.

---

## 2026-09-30 — Pro: Fase 1 sync multi-dispositivo (cuenta del dueño + códigos de 6 dígitos)

**Qué:** los dispositivos del mismo dueño ahora sincronizan entre sí sin depender del pairing monitor/caja. La cuenta Supabase del dueño es la raíz de confianza: cada dispositivo se registra en `account_devices` y lee los documentos de sus hermanos.

- **DB (Supabase `oshexsmweswzbwaksvra`, aplicadas):**
  - Migración `002_account_devices.sql`: tabla `account_devices` (user_id, device_id, alias, revoked, last_seen) y `pairing_codes` (código 6 dígitos, expira 10 min, un solo uso); RPC `redeem_pairing_code(p_code, p_device_id)`; RLS: dueño gestiona sus dispositivos; dispositivo ve documentos de sus hermanos (`sync_documents_account_read`).
  - Migración `003_my_account_device_ids.sql`: RPC `my_account_device_ids()` para que un dispositivo vinculado por código (sesión anónima) descubra solo los device_id de su cuenta.
- **Cliente:** `src/services/cloudAccount.js` (nuevo): signUp/signIn/signOut del dueño, registro del dispositivo, generación y canje de códigos, lista y revocación de dispositivos, `getAccountSyncContext()` (modo owner / modo linked por código).
- **`useCloudSync`:** si hay contexto de cuenta, el gate de pairing no bloquea; el pull inicial trae documentos de **todos** los dispositivos de la cuenta con watermark por cuenta (`gt('updated_at', watermark)`, límite 2000, orden ascendente) para cuidar egress; el push sigue por dispositivo propio. `forceSyncAllPOSData(deviceId, !accountCtx)`.
- **UI:** `src/components/CloudAccountSection.jsx` (nuevo) integrado en Ajustes → Sistema → Datos y Respaldo: entrar/crear cuenta, vincular con código, generar código para otro dispositivo (con expiración visible), lista de dispositivos vinculados con revocar, estado de conexión.
- **Tests:** `tests/cloudAccount.test.js` (21 tests: auth, códigos, RPC, contextos, revocación).

**Por qué:** el dueño necesita abrir su cuenta desde cualquier dispositivo/país y ver los mismos datos; el monitor del jefe en tiempo real viene en la Fase 2 sobre esta base. Se mantiene offline-first (IndexedDB operativo, la nube como espejo) y sin polling: pull condicionado por `updated_at`, realtime solo para eventos mínimos (Fase 2), restore completo solo al vincular.

**Archivos:** `src/services/cloudAccount.js`, `src/components/CloudAccountSection.jsx`, `tests/cloudAccount.test.js` (nuevos); `src/hooks/useCloudSync.js`, `src/components/Settings/tabs/SettingsTabSistema.jsx`; `supabase/migrations/002_account_devices.sql`, `003_my_account_device_ids.sql`; `docs/PLAN-SYNC-MULTIDISPOSITIVO.md`.

**Verificación:** 21/21 tests nuevos verdes; suite completa 767/779 (2 ficheros con fallos preexistentes verificados sin estos cambios: `supervisorLifecycle`, `receivablesDeterministic`). Sintaxis de los 4 archivos tocados validada. E2E real con 2 teléfonos pendiente. Realtime del Modo Jefe = Fase 2.

## 2026-09-30 — Pro: Cuenta en la nube simplificada (solo Entrar + tope de 6 equipos)

**Qué:** luigi aprobó el mockup simplificado ("Me gusta"): se eliminó crear-cuenta y códigos de la UI; solo queda Entrar con email + contraseña, y el equipo se vincula solo al entrar. Tope de 6 equipos por cuenta, aplicado en el servidor. La cuenta de prueba del cliente (`medina180276@gmail.com`, email pre-confirmado) se creó directo en `auth.users` + `auth.identities` vía SQL (Management API) con bcrypt de pgcrypto; contraseña verificada contra el hash.

- **DB (Supabase `oshexsmweswzbwaksvra`, aplicada y verificada):** migración `004_device_limit.sql`:
  - RPC `register_account_device(p_device_id, p_alias)` (SECURITY DEFINER, solo `authenticated`): registra el equipo del dueño (`auth.uid()`). Re-vincular un equipo conocido no consume cupo; un equipo nuevo con 6 activos falla con `LIMIT_REACHED`.
  - `redeem_pairing_code` parcheado con la misma regla (el flujo de códigos está oculto de la UI por ahora, pero la DB no queda sin tope).
- **Cliente:** `src/services/cloudAccount.js`: `registerCurrentDevice` ahora llama al RPC en vez del upsert directo (el tope no depende del cliente); `MAX_DEVICES_PER_ACCOUNT = 6`; `signInOwner`/`signUpOwner` ante `LIMIT_REACHED` cierran la sesión a medias y devuelven `limitReached: true` (una sesión sin equipo vinculado no sincroniza nada: mejor no dejarla).
- **UI:** `src/components/CloudAccountSection.jsx` reescrito según el mockup aprobado: sin pestañas, formulario directo de Entrar, banner rojo "Límite de 6 equipos alcanzado. Revoca uno para liberar un cupo." cuando el login choca con el tope, lista con contador "(N de 6)", y diálogo propio (bottom sheet) para revocar — se eliminó el `window.confirm()`.
- **Fix de sync:** en `src/hooks/useCloudSync.js` el `existingCloudKeys` del auto-recovery mezclaba documentos de dispositivos hermanos en modo cuenta (el pull ya no traía `device_id`): un hermano con el mismo `doc_id` podía suprimir el push del equipo propio. Ahora el pull trae `device_id` y el set solo cuenta documentos propios (con fallback para el modo anterior).
- **Tests:** `tests/cloudAccount.test.js` 28/28 (7 nuevos: tope = 6, RPC con alias, mapeo de `LIMIT_REACHED`, signIn/signUp cierran sesión ante el límite, sin sesión no hay RPC).

**Por qué:** la prueba será con un solo cliente y una sola cuenta; simple gana: sin códigos, sin crear-cuenta en la app (la cuenta se crea en el dashboard de Supabase). El tope en el servidor evita que un cliente llene la cuenta sin control, y cerrar la sesión ante el límite evita equipos "conectados" que no sincronizan.

**Archivos:** `src/services/cloudAccount.js`, `src/components/CloudAccountSection.jsx`, `tests/cloudAccount.test.js`, `src/hooks/useCloudSync.js`, `supabase/migrations/004_device_limit.sql` (nueva).

**Verificación:** 28/28 tests del módulo verdes; suite completa 774/786 (los 2 ficheros con fallos son los preexistentes ya verificados: `supervisorLifecycle`, `receivablesDeterministic`). Sintaxis validada. Migración 004 aplicada al proyecto real y verificada (función existe, contiene `LIMIT_REACHED`, grant a `authenticated`). Sin commit/push/deploy (pendiente de autorización). E2E real con teléfonos y realtime del Modo Jefe siguen pendientes.

---

## 2026-09-30 — Plan de tests deterministas CloudGate (luigi: "que todo funcione a la perfección")

**Qué:** se creó `docs/PLAN-TEST-CLOUDGATE.md` con la matriz de 24 flujos
(F1–F24) + 4 fuera de alcance honesto (X1–X4: provisionamiento real, límite
real de 6, flujo visual en navegador, y si keepalive evita la pausa del free
tier — nada de eso es afirmable sin la infra/prueba real).

**Tests nuevos (todos deterministas, sin red):**
- `tests/cloudGateFlows.test.js` — F7 (cuenta llena → revocar → reintentar →
  ready, secuencia exacta del componente), F8 (offline con sesión guardada no
  toca la red).
- `tests/cloudGateRealConfig.test.js` — F9 con el módulo real (persistencia
  `pda_customer_project`, cliente construido sin red, clear deja el proxy sin
  resolver).
- `tests/provisionContract.test.js` — F13/F14: los 7 SQL en orden exacto
  (`pairing` antes de `001`, con prueba de que 001 referencia
  `device_pairings`), cada archivo existe y es idempotente.
- Estación `scripts/test_keepalive_fleet.py` — F15–F18 (vacío, éxito,
  2 fallos → status error, dry-run puro).
- Estación `scripts/test_ui_rules.py` — F20/F21 (12 reglas estáticas).

**Suite completa:** 799 pasan, 11 omitidos; los únicos 2 fallos son los
preexistentes ajenos (`supervisorLifecycle` — referencia un archivo borrado en
`2987dd4`; `receivablesDeterministic` — esperaba 43.59, obtuvo 0). Ningún
archivo de esos tests fue tocado.

**Verificaciones LIVE hechas hoy:** migración 003 aplicada en producción,
RPC con anon key → 200 y `[]` ante código inexistente, RLS (anon no lee la
tabla directa), keepalive `--dry-run` contra la Estación real.

## 2026-10-01 — Fixes Supervisión (cápsulas + COP)
- **Cápsulas recortadas** (`SupervisionView.jsx`): el contenedor usaba
  `overflow-x-auto` sin padding arriba; el navegador fuerza `overflow-y:auto`
  y recortaba la sombra de la cápsula activa. Fix: `pt-2` al contenedor.
- **COP en Supervisión** (`ModoJefePanel.jsx`, `MonedaChips`): el chip de COP
  se mostraba siempre. Ahora solo aparece si `cop_enabled==='true'` en
  localStorage (regla de luigi: sin COP activado, no aparece en el sistema).
  El grid pasa de 3 a 2 columnas cuando el COP está desactivado. Aplica a
  "Plata de hoy · detalle" y "Plata de hoy · consolidado".

## 2026-10-01 — El dueño retoma su última pestaña al entrar
- Pedido de luigi: si el dueño dejó abierto el modo supervisor, al volver a
  entrar la app debe abrir en supervisión (solo el dueño).
- `src/App.jsx`: la pestaña activa se guarda en `localStorage` (`pda_last_tab`)
  en cada cambio; al establecerse la sesión, si el usuario es dueño y la
  pestaña guardada sigue permitida para su rol, se restaura; si no,
  `landingTab` como antes. Cajero y administrador sin cambios.
- El gate existente (`allowedTabIds`) sigue protegiendo contra pestañas no
  permitidas.

## 2026-10-01 — El cajero no se desloguea solo
- Pedido de luigi: el cajero no debe salir al login de PIN automáticamente,
  pase el tiempo que pase o cambie de pestaña; solo sale con logout manual.
- Tres mecanismos lo sacaban; los tres eximen ahora al cajero:
  1. `src/App.jsx`: al recargar la página se hacía `logout()` si el login
     estaba activado. Ahora se revisa la sesión persistida y si es cajero
     no se toca.
  2. `src/hooks/useAutoLock.js`: el bloqueo por inactividad (5 min) ya no
     aplica al cajero.
  3. `src/hooks/useAutoLock.js`: el bloqueo al minimizar/cambiar de pestaña
     (`visibilitychange`) ya no aplica al cajero.
- Dueño y administrador sin cambios (siguen con auto-bloqueo).
- Tests: 805/817 verdes; 2 archivos con fallas preexistentes verificadas sin
  estos cambios (`supervisorLifecycle` referencia un archivo borrado,
  `receivablesDeterministic` falla en el inyector).

## 2026-10-01 — Versión 2.0.0
- Bump de versión pedido por luigi: `1.7.2` → `2.0.0`.
- Tocados: `package.json` (solo el campo `version`; se preserva la
  dependencia `xlsx` del trabajo del importador Excel, sin commitear),
  `src/components/security/LockScreen.jsx` (badge `v2.0.0`),
  `src/views/SettingsView.jsx` (`PreciosAlDía Bodegas v2.0.0`).
- Incluye todo lo de la sesión: QUOTA-003 (deltas de ventas), fix cápsulas
  Supervisión, COP solo si está activado, dueño retoma última pestaña,
  cajero sin deslogueo automático.
- **Desplegado a producción 2026-10-01:** `preciosaldia-multilocal.vercel.app`
  (deploy `hqnanr503`, status Ready, 200 OK).

## 2026-10-01 — Rediseño CloudGate (login correo/clave) con paleta del sistema
- luigi pidió rediseño profesional del inicio de sesión con logo Pro + zona de código; aprobó mockup (`~/workspace/mockup-cloudgate-pro.html`) con la paleta del sistema (crema cálida `#fbfaf7` + teal `#01696f`, NO navy).
- `src/components/security/CloudGate.jsx`: nuevo `Shell` (fondo crema + blobs teal, tarjeta blanca redondeada), `BrandHeader` (logo real + badge PRO dorado), `Steps` (1 Código → 2 Cuenta), `Title`; inputs blancos con iconos y foco teal, botón primario `bg-brand`, chip de licencia `LIC-XXXXXX`, contacto `0412 405 1793` en paso código.
- Lógica intacta (checking/code/login/limit/ready, tope 6 equipos, offline resume). Solo presentación.
- Verificado: `npm run build` OK, 14/14 tests CloudGate OK, captura con CSS real compilado (modo claro verificado visualmente).
- Nota: `dark:` usa la escala surface invertida de tokens.css (intencional); modo oscuro conserva las clases del original sin regresión. App en modo claro por defecto.
- **Desplegado a producción 2026-10-01** (autorizado por luigi): `preciosaldia-multilocal.vercel.app` (deploy `preciosaldia-multilocal-13a9eigju-luiggi2`, status Ready, 200 OK).

## 2026-10-01 — Auditoría de debugging de todos los flujos y modales
- luigi pidió auditoría minuciosa de debugging de todos los flujos y modales + informe completo.
- 8 áreas auditadas en paralelo (análisis estático, solo lectura, sin modificar archivos): Auth/seguridad, POS/venta, Productos/inventario, Fiados, Sync/nube, Supervisión/Modo Jefe, Ajustes, inventario de ~40 modales.
- Resultado: **63 hallazgos** — 5 críticos, 9 altos, 30 medios, 19 bajos. Los 5 críticos fueron re-verificados contra el código.
- Críticos: (1) clave maestra de emergencia '24457713' hardcodeada en el bundle + admin puede escalar a dueño; (2) ventas offline fuera del día actual nunca se sincronizan (`pushSalesWindow` es código muerto); (3) VENTA_CASHEA nunca registra `casheaDeuda` → remesa incobrable; (4) chip COP de "Plata de hoy" siempre $0 (`amountCop` jamás se escribe); (5) admin configura la clave de emergencia sin re-autenticación.
- Informe completo entregado: `~/workspace/your_files/auditoria-debugging-pro-2026-10-01.md`.
- Sin cambios de código en esta pasada (pendiente autorización de luigi para corregir).
