# Bitácora — PreciosAlDía Multi

Registro de cambios del proyecto. Cada commit lleva su entrada: qué cambió y por qué.

---

## 2026-10-01 — Admin conserva sesión al cambiar de sede (FIX-ADMIN-SWITCH)

**Qué:** luigi reportó que al cambiar de sede desde el usuario admin, la app retornaba con estado de cajero.

**Causa:** la sesión es por sede (`routeAuthKey`: cada negocio tiene su personal). Al cambiar de sede, la app cargaba la última sesión guardada de la sede destino — si un cajero la había usado, el admin caía a vista de cajero.

**Fix** (`src/components/NegocioSelector.jsx`, `src/hooks/store/useAuthStore.js`):
- `SESSION_KEY` ahora exportada.
- En `handleSwitch`: si quien cambia es ADMIN o DUEÑO, su sesión se pre-guarda bajo la clave de la sede destino (`nb_<id>:abasto-device-session`) antes del reload. Así conserva su rol.
- Los cajeros siguen con sesiones por sede (sin cambios).

---

## 2026-10-01 — Cajero ve Inventario en solo-lectura (ROL-CAJERO)

**Qué:** luigi pidió que a los cajeros les salga el inventario (antes solo veían Vender y Clientes). `ProductsView` ya traía soporte de solo-lectura para cajero (`isCajero`: sin onEdit/onDelete, `readOnly`, sin columna de costo, sin botones ± de stock, toolbar con acciones ocultas) — solo faltaba el permiso del tab.

**Cambios** (`src/utils/roles.js`, `tests/roles.test.js`):
- `TABS_CAJERO`: `['ventas', 'clientes']` → `['inicio', 'ventas', 'catalogo', 'clientes']` (el orden visual lo da `ALL_TABS` en App.jsx: Inicio, Vender, Inventario, Clientes).
- `DashboardView` ya traía render especial para cajero ("Caja Activa · {nombre}", sin finanzas) — solo faltaba el permiso del tab.
- Docstring del rol CAJERO actualizado.
- Test `visibleTabIds` del cajero actualizado.

**Nota:** el estado vacío de ProductsView muestra "NUEVO PRODUCTO"/"IMPORTAR EXCEL" sin chequear `isCajero` (código del tercero, no tocado por regla). Con los inventarios sembrados no aparece; coordinar con el tercero si se quiere ocultar.

**Deploy:** 2026-10-01 ~21:10 — `vercel --prod` manual → `preciosaldia-multilocal-b6x6oppsy-luiggi2.vercel.app` ● Ready (Production). Incluye: fix admin-switch (5a8514a) + fix paginador (c5aad57).

---

## 2026-10-01 — Deploy a producción: fix GATE-CLOUD (`5e9b492`)

**Qué:** luigi autorizó ("deployalo"). Deploy manual con `vercel --prod` (Git↔Vercel sigue sin conectar): `✓ Ready in 2m`, target production, commit `5e9b492`. Los equipos activados vía CloudGate ya no caen en "Solicitar Licencia". Verificación HTTP 200 pendiente: la red del sandbox se cayó justo después del deploy (ni google.com respondía); el Ready lo confirmó el propio CLI de Vercel.

---

## 2026-10-01 — Fix: equipos activados por CloudGate caían en "Solicitar Licencia" (GATE-CLOUD)

**Qué:** luigi reportó que la pantalla "Solicitar Licencia" (PremiumGuard) seguía saliendo en un equipo del cliente. Causa raíz: `useSecurity.checkLicense` nunca fue actualizado para reconocer el flujo CloudGate — solo aceptaba el token RSA legacy (`pda_premium_token`), el fetch remoto está stub (`_fetchRemoteLicense` siempre retorna null) y el monitoreo legacy es no-op. CloudGate sí completa bien (código válido → login → `register_account_device` en el servidor con tope de 6 → `pda_account_linked='true'`), pero nada de eso llegaba a `isPremium`. Peor: el integrity check periódico revocaba el premium a los ~30 min en equipos sin token RSA.

**Cambios** (`src/hooks/useSecurity.jsx`):
- Import de `isAccountLinkedLocally` desde `services/cloudAccount.js`.
- En `checkLicense`: si no hay token RSA pero el equipo está vinculado vía CloudGate (`pda_account_linked='true'`), se otorga `isPremium` directamente — el vínculo solo existe tras validación en el servidor.
- En el integrity check periódico: si el equipo está vinculado vía CloudGate, se retorna temprano sin revocar.

**Verificación:** `tests/security.test.js` + `tests/securityFase1.test.js` (38 passed / 8 skipped); `vite build` exitoso.

---

## 2026-10-01 — Deploy a producción: catálogo de usuarios (`bf7a514`)

**Qué:** luigi autorizó ("Si"). Deploy manual con `vercel --prod` (Git↔Vercel sigue sin conectar en este proyecto): `✓ Ready in 1m`, target production, commit `bf7a514`. `https://preciosaldia-multilocal.vercel.app` → 200 OK; el bundle de producción contiene `bodega_users_catalog_v1` y la versión visible sigue `v2.0.0`. Producción ahora tiene: QUOTA-003 (ventas por delta), fixes Fases 0–6, fixes post-plan y el sync del catálogo de usuarios (PINs nunca viajan).

---

## 2026-10-01 — Catálogo de usuarios sincronizado entre equipos (sin PINs)

**Qué:** Luigi preguntó si al crear un usuario en un equipo se sincroniza con los demás. No se hacía: los usuarios/PINs eran 100% locales por equipo. Ahora el **catálogo de usuarios se sincroniza** (crear, renombrar, cambiar rol, eliminar) vía `sync_documents`, pero los **PINs jamás viajan** (SEC-002 intacto: ni hashes ni texto plano; el validador rechaza docs que los incluyan). Cada equipo conserva sus PINs; un usuario que llega de otro equipo aparece con badge "PIN pendiente" hasta que un admin defina su PIN ahí.

**Cambios:**
- `src/utils/userCatalog.js`: `buildUserCatalogDoc()` (doc `{v:1, users:[{id,uid,nombre,rol,requirePin}], deleted:[tombstones]}`), `mergeUserCatalog()` (match por `uid` estable — distingue renombrado de colisión de id; preserva PINs locales; tombstones de borrado podados a 30 días; ids numéricos nunca se reutilizan en el merge), `isValidUserCatalogDoc()`, helpers de tombstones en localStorage (por negocio).
- `src/services/supervisorContracts.js`: `bodega_users_catalog_v1` entra a la allowlist con validador estricto (rechaza `pin`/`plainPin` en el doc — defensa en profundidad).
- `src/hooks/useCloudSync.js`: `STORE_SCHEMAS` += validador del catálogo; `_applyFromCloud` fusiona el doc remoto con `mergeUserCatalog` y lo aplica al auth store (sin eco); `forceSyncAllPOSData` también empuja el catálogo.
- `src/hooks/store/useAuthStore.js`: `_pushUserCatalog()` (fire-and-forget, import dinámico) tras `agregarUsuario`, `eliminarUsuario` (registra tombstone), `editarUsuario` y `_ensureDefaultUsers`; nueva acción `aplicarCatalogoRemoto()`; `uid` estable (`crypto.randomUUID`) en usuarios nuevos y por defecto; `cambiarPin`/`resetPinEmergency`/`editarUsuario` limpian `pinPendiente`.
- `src/components/Settings/UsersManager.jsx`: badge "PIN pendiente" en la fila del usuario que llegó de otro equipo sin PIN local.
- `tests/userCatalogSync.test.js`: 20 tests (sanitizado, doc sin PINs, merge por uid, tombstones, colisiones, allowlist).
- `tests/supervisorSync.test.js`: actualizado — el catálogo ahora SÍ está allowlisted (sanitizado); `abasto-auth-storage` sigue bloqueado.

**Verificación:** suite completa 923 passed / 11 skipped / 0 failed; `npm run build` exitoso. Dos bugs atrapados por los tests durante el desarrollo: (1) en colisión de id el usuario local se perdía del merge; (2) renombrado vs colisión eran indistinguibles sin `uid`.

**Nota operativa:** el PIN sigue siendo por equipo a propósito. Si el dueño cambia su PIN o crea un cajero, el usuario aparece en todos los equipos pero el PIN debe definirse en cada uno.

---

## 2026-10-01 — Fixeo Fase 4: barcode duplicado, restore con confirmación, backup completo

**Qué:** se cierran los hallazgos ALTO restantes implementables. (1) Guardar un producto con un código de barras ya usado por otro producto ahora pide confirmación explícita: antes, el POS escaneaba y cobraba el producto equivocado en silencio (first-match). (2) Restaurar un backup ya no borra los datos a ciegas: valida, muestra fecha del backup vs última venta local, advierte si el backup es más antiguo y solo restaura tras confirmación. (3) El backup manual ahora incluye las claves que faltaban: ventas en espera (`bodega_pending_holds_v1`), modo de tasa, Cashea, modos de redondeo, modos de moneda de recibo/etiqueta, reportes, datos del negocio y preferencias de UI.

**Cambios:**
- `src/utils/barcodeNormalizer.js`: nuevo `findBarcodeCollision(rawBarcode, products, editingId)` — resuelve el código como lo haría un escaneo (des-shifteo ES/LATAM) y detecta colisión en otro producto; función pura y testeable.
- `src/views/ProductsView.jsx`: `handleSave` usa `findBarcodeCollision`; modal de advertencia con "Corregir" / "Guardar igual" (ack por intento, se invalida si cambia el código). No toca el flujo del importador Excel.
- `src/hooks/useDataImportExport.js`: `handleFileChange` ahora valida el JSON y guarda `{json, backupDate, lastSaleDate, backupIsOlder}` en estado `restoreConfirm` sin borrar nada; nuevo `confirmRestore()` (limpieza selectiva + `applyBackupToStorage` + auditoría + reload) y `cancelRestore()`. Nuevo helper `getLastLocalSaleDate()` que lee `bodega_sales_v1` (timestamp/fecha/date).
- `src/views/SettingsView.jsx`: modal de confirmación de restore con fecha del backup, última venta local y advertencia fuerte si el backup es más antiguo ("restaurar hará que se pierdan las ventas recientes").
- `src/config/backupKeys.js`: `IDB_KEYS` += `bodega_pending_holds_v1` (y orden alfabético corregido: `bodega_customer_ledger_v1` antes que `bodega_customers_v1`); `LS_KEYS` += 22 claves duraderas (tasas, redondeo, Cashea, reportes, negocio, UI). Excluidos deliberadamente: sesión/pairing, flags de migración, cachés, timestamps operativos, onboarding y `pda_emergency_pin` (secreto).
- `tests/fase4.test.js`: 11 tests nuevos (colisión exacta, edición del mismo producto, des-shifteo, match por id, cobertura de listas, sin secretos en backup, PROTECTED_KEYS intactas, orden alfabético).
- Documento de coordinación (fuera del repo): `~/workspace/your_files/fase-4-diffs-coordinacion-tercero-2026-10-01.md` con los diffs exactos de ALTO-6 (Excel "Reemplazar" vs Circuit Breaker) y M-8 (`parseNumero` con múltiples comas) — NO aplicados, pendientes de revisión con el tercero.

**Verificación:** suite completa 865 passed / 11 skipped / 0 failed; `npm run build` exitoso.

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

## 2026-10-01 — Plan de fixeo: Fase 0 (baseline limpio)
- Inicio de la implementación del plan de fixeo (`~/workspace/your_files/plan-fixeo-general-pro-2026-10-01.md`).
- M-19: `tests/supervisorLifecycle.test.js` leía `PairingManager.jsx`, eliminado a propósito en `2987dd4` (era flujo del Lite). Se retiró el test del flujo eliminado; los otros 3 guardrails siguen verificando archivos existentes.
- M-16: `injectDeterministicSales` no aceptaba `dateStr` → inyectaba con fecha de hoy pero el test filtraba `2026-09-18..2026-09-22` (0 ventas en rango, 43.59 vs 0). El injector ahora acepta `dateStr` opcional y el test pasa `DETERMINISTIC_DATE`. Era bug del harness, no del motor.
- Baseline: suite completa 809 passed / 11 skipped / 0 failed; `npm run build` OK. Tag `pre-fixeo-2026-10-01` como punto de rollback.

## 2026-10-01 — Plan de fixeo: Fase 1 (seguridad crítica)
- CRÍTICO-1: eliminada la clave de fábrica hardcodeada (`EmergencyPinResetModal.jsx`). Sin clave personalizada configurada, el flujo de emergencia queda DESHABILITADO (ya no hay fallback). Intentos con rate-limit persistido (LOGIN_RATE_LIMIT: 5 intentos → lockout 30s con backoff x2 hasta 15min). grep confirma 0 ocurrencias en `src/`.
- CRÍTICO-5: la sección "Clave Maestra de Emergencia" en `UsersManager.jsx` solo se muestra con sesión de dueño; configurarla exige verificar el PIN maestro (paso previo en el modal). Vacío = deshabilitar (antes: volvía a la clave de fábrica). El flujo de emergencia nunca puede restablecer el PIN maestro: filtrado en el modal + rechazo en `resetPinEmergency` (defensa en profundidad, evento `PIN_MAESTRO_RESET_BLOQUEADO`).
- ALTO-2: usuarios iniciales con PINs aleatorios (`_generateRandomPin()`) y `requirePin: true` (antes: '000000' + acceso directo). Nuevo `InitialPinsModal` muestra los PINs UNA sola vez tras el setup del PIN maestro (flag `pda_initial_pins_shown`). Usuarios nuevos también nacen con `requirePin: true`.
- M-1: eliminado bloque `storage:` muerto en el persist (el enrutado por negocio nunca estuvo activo; modelo real: usuarios globales, solo la sesión se enruta por negocio).
- M-2: `unlock()` del dueño ahora lee `result.ok` (antes `result.valid` → nunca desbloqueaba).
- M-23: chequeo "PIN ya en uso" ahora verifica contra los hashes con `verifyPin` (en crear y cambiar PIN).
- M-24: `cambiarPin`/`agregarUsuario` son async reales; la UI espera al hash antes del toast de éxito.
- B-2: queda como decisión pendiente (documentar riesgo de sesión local vs HMAC atado al PIN).
- B-3: NO verificado plenamente — el lookup de licencias es un RPC público directo de Supabase (no se encontró endpoint/migración de rate-limit en la búsqueda local, pero no se confirmó server-side). Pendiente de verificación; rate-limit server-side requeriría Edge Function (trabajo futuro). No se afirma riesgo aceptado.
- Tests: nuevo `tests/securityFase1.test.js` (10 guardrails). Suite: 819 passed / 0 failed. Build OK. Tag `fix-fase-1`.
- NOTA para luigi: debes configurar tu Clave Maestra de Emergencia en Ajustes → Usuarios (con tu sesión de dueño) para activar la recuperación de emergencia. Sin ella, el flujo queda deshabilitado.

## 2026-10-01 — Plan de fixeo: Fase 2 (dinero y datos críticos)
- CRÍTICO-3: `VENTA_CASHEA` ahora incrementa `casheaDeuda` vía movement `CASHEA_SALE` en el ledger (antes la deuda Cashea nunca subía). Idempotente por `sourceId`.
- CRÍTICO-4: `amountCop` se persiste en pagos normales, Cashea y saldo a favor (chip COP ya no queda en $0).
- ALTO-3: guardia anti doble-submit en `registrarGasto`/`registrarAutoconsumo` (`inFlightRef` + lectura fresca de ventas) y botón deshabilitado con `isSubmitting` en `GastosInternosModal`.
- ALTO-4: `anularGasto` con busy-flag por gasto + idempotencia (`status === 'ANULADA'` chequeado en storage fresco); botón "Sí, Anular" deshabilitado durante el proceso.
- ALTO-5: guardia anti doble-tap en `handleTransaction` (abonos/créditos) y `handleCasheaRemittance` en `CustomersView`; botón del `TransactionModal` deshabilitado con "Procesando…".
- M-13: campo `limiteCredito` por cliente (USD, 0 = sin límite, default preserva comportamiento actual) en modales de crear/editar; el checkout bloquea fiados que superen el límite con mensaje claro.
- M-14: `fiadosHoy` simétrico — la porción `casheaUsd` de `VENTA_CASHEA` suma a otorgado (antes solo la remesa sumaba a cobrado).
- M-15: anular `VENTA_FIADA` con cobros parciales se BLOQUEA con mensaje ("anule primero los cobros") en vez de crear favor fantasma.
- Corrección Fase 1: el commit `99664d99` incluyó por error archivos del importador Excel de un tercero (estaban sin commitear en el árbol; `git add -A`). Contenido preservado intacto; solo la atribución del commit es incorrecta. Lección: stagear rutas explícitas, nunca `git add -A`.
- Corrección Fase 1: retirado el literal de la antigua clave de fábrica de `tests/securityFase1.test.js`; el guardrail ahora es indirecto (ningún literal numérico de 8 dígitos en el código de seguridad).
- Corrección Fase 1: entrada B-3 reescrita — rate-limit del lookup NO verificado plenamente, pendiente.
- Tests: nuevos `tests/casheaDeudaVenta.test.js`, `tests/copAmountPersistido.test.js`, `tests/dineroFase2.test.js`. Suite: 837 passed / 11 skipped / 0 failed. Build OK.
- Pendiente decisión de luigi: default del límite de crédito (¿sin límite o con tope sugerido por cliente?).

## 2026-10-01 — Plan de fixeo: Fase 3 (sync crítico)
- CRÍTICO-2(a): `pushSalesDelta` (solo empujaba el día actual) ahora reintenta deltas de días previos no confirmados (ventana 90 días, tope 7 días/ciclo, salta hashes ya confirmados sin consumir el tope). Nueva `pushPendingSalesDeltas` + `pushSingleSalesDelta`.
- CRÍTICO-2(b): `pushSalesWindow()` (90 días podados) ahora se invoca al cierre de caja (`DashboardView.handleConfirmCashRecon`, fire-and-forget) y una vez al día vía `maybePushDailySalesWindow` dentro de `pushSalesDelta` (los pushes normales son full-catalogo en QUOTA-001 solo ante cambio estructural, así que el gasto extra es solo la ventana diaria).
- ALTO-1: `useMonitorSync` ahora resuelve todos los `device_ids` de la cuenta (`getAccountSyncContext`, fallback al input legacy) en vez de uno solo. Pull inicial multi-equipo (`.in()`), Realtime con un canal por equipo y `subscriptionsRef` array, metadata/watermarks por `device_id:docId` (antes colisionaban documentos del mismo día de fuentes distintas), reintento robusto sin early-return que dejara canales huérfanos.
- M-3: `mergeSales` trata la anulación como terminal — una venta `ANULADA`/`voidedAt` ya no resucita aunque la contraparte tenga timestamp mayor.
- M-6: `applyStockMapDelta(products, stockMap, lastRemoteMap)` — deltas por `device_id` en vez de asignación absoluta LWW: dos cajas vendiendo a la vez ya no se pisan (10→8 local + mapa 10→7 ⇒ 5). Primera vista de la fuente conserva el comportamiento absoluto anterior.
- M-17: detección de conflictos LWW en documentos no append-only (`src/utils/syncConflicts.js`): remoto-descartado-divergente y local-sobrescrito se registran (tope 20) y emiten `pda_sync_conflict`. `SyncStatus` muestra aviso ámbar con conteo; al tocarlo se marcan como revisados.
- M-22: `handleDeleteAllData` se BLOQUEA con mensaje claro si el sync está activo (`isCloudSyncActiveNow()`), porque el borrado local no es durable (mergeSales aditivo → las ventas resucitan en el próximo pull). Nuevo getter exportado en `useCloudSync`.
- Tests: nuevo `tests/syncFase3.test.js` (17: anulación terminal, deltas de stock concurrentes, flujo E2E simulado venta-offline-ayer→monitor-hoy, conflictos). Guardrail `supervisorLifecycle.test.js` actualizado al refactor multi-canal. Suite: 854 passed / 11 skipped / 0 failed. Build OK. Tag `fix-fase-3`.
## 2026-10-01 — Plan de fixeo: Fase 5 (medios por área)

**Qué:** se cierran los 16 hallazgos medios. (1) POS: la tolerancia del drift USD/Bs en el checkout ahora escala con nº de líneas (`max(5, 0.005×tasa×nLineas)`) — antes el fijo de 5 Bs rechazaba "Venta Libre en Bs" legítimas DESPUÉS de cobrar; y restaurar una venta en espera ya no pierde líneas ni falsifica precios (usa `resyncCartItems`: lookup por `_originalId`, precio vía `deriveCartFields`). (2) Productos: `useInventoryVelocity` excluye `AJUSTE_ENTRADA`/`AJUSTE_SALIDA`; el formulario limita el stock inicial negativo a 0 salvo `allow_negative_stock` (helper `clampInitialStock`); el modal de eliminar muestra stock + valor del inventario; el nombre se valida con trim; el filtrado/orden ya no crashea si un producto no tiene nombre. (3) Supervisión: el dueño retoma su última pestaña (lazy-init desde `pda_last_tab` — antes el efecto de guardado la destruía en el mount); "Recaudación total" → "Ventas totales" (incluye fiados otorgados, el rótulo era engañoso). (4) Ajustes: `applyBackupToStorage` filtra contra `IDB_KEYS`/`LS_KEYS` (un backup manipulado ya no envenena claves fuera del catálogo). (5) Modales: X con `relative` en `ConfirmModal`/`CashReconciliationModal`; nuevo hook `useModalBehavior` (Escape solo en el modal superior, scroll-lock del body, focus trap + foco inicial + retorno); backdrop-click en `CasheaRemittanceModal`, `SettingsModal`, `CustomAmountModal`, `TransactionModal`, `HoldsModal`.

**Cambios:**
- `src/utils/checkoutProcessor.js`: tolerancia FIN-022 escalada por líneas.
- `src/views/SalesView.jsx`: `handleRestoreHold` reescrito sobre `resyncCartItems` (la línea de un producto eliminado sobrevive marcada `_productMissing`).
- `src/hooks/useInventoryVelocity.js`: excluye ajustes de stock del cálculo de velocidad.
- `src/utils/productProcessor.js`: nuevo `clampInitialStock(stock)` + trim del nombre en `buildProductPayload`.
- `src/views/ProductsView.jsx`: `handleSave` valida `name?.trim()`, aplica `clampInitialStock` con toast; modal de eliminar con stock/valor.
- `src/components/Monitor/RemoteProductFormModal.jsx`: aplica `clampInitialStock`.
- `src/hooks/useProductFiltering.js`: guard `(p.name||'').toLowerCase()` en filtro y orden.
- `src/App.jsx`: `activeTab` con lazy-init desde `pda_last_tab`.
- `src/views/ModoJefePanel.jsx`: rótulo "Ventas totales".
- `src/utils/backupRestoreService.js`: allowlist en `applyBackupToStorage`.
- `src/components/Modal.jsx`: nuevo `useModalBehavior` exportado; el `Modal` base lo usa (Escape/scroll-lock/foco).
- `src/components/ConfirmModal.jsx`, `src/components/Dashboard/CashReconciliationModal.jsx`: `relative` en el panel + `useModalBehavior`.
- `src/components/Customers/CasheaRemittanceModal.jsx`, `src/components/SettingsModal.jsx`, `src/components/Sales/CustomAmountModal.jsx`, `src/components/Customers/TransactionModal.jsx`, `src/components/Sales/HoldsModal.jsx`: `useModalBehavior` + backdrop-click.
- `tests/fase5.test.js`: 10 tests nuevos (clamp, trim, allowlist de restore, tolerancia escalada incl. 40 líneas/drift 7 Bs).

**Corrección en curso:** el clamp M-9 se puso primero dentro de `buildProductPayload` y rompió el test del importador Excel del tercero ("conserva negativos y los cuenta"); se movió a los formularios vía `clampInitialStock`. También se detectó y eliminó un duplicado accidental `docs/bitacora.md`/`docs/inteligencia.md` (los canónicos viven en la raíz).

**Verificación:** suite completa 875 passed / 11 skipped / 0 failed; `npm run build` exitoso.

---
## 2026-10-01 — Plan de fixeo: Fase 6 (bajos)

**Qué:** se cierran 16 de los 19 hallazgos bajos (B-10 excluido por tocar el importador del tercero; B-2/B-3 son decisiones pendientes). (1) Seguridad: `CloudGate.handleRevoke` muestra error si el registro del equipo falla tras liberar el cupo (B-1). (2) POS: eliminado el parámetro muerto `imprimir` de `CheckoutModalPOS` (la impresión vive en `ReceiptModal`) (B-4); "Entregar en Bs" ahora entrega TODO el vuelto en Bs vía `bsOnlyChange` (antes aplicaba el split mixto con rótulo engañoso) (B-5); el avance de efectivo en USD ya no se divide entre el BCV (`advancePriceUsdt`) (B-6); un pago COP sin tasa válida aporta 0 en USD y en Bs (`copToUsd`/`paymentMethodToBs`, antes caía al divisor de Bs) (B-7). (3) Sync: `_debouncePush` ya no traga errores en silencio — `recordSyncPushError` + evento `pda_sync_push_error` (B-13a); la reconexión del monitor tiene tope de 12 intentos y luego expone `syncError` para reintento manual (B-13b); el fallback de `withLock` ahora es un mutex cross-tab vía localStorage con lease+token (B-8, antes solo en memoria). (4) Productos: advertencia (no bloqueo) al guardar precio $0 (B-9); capitalización Unicode (`titleCaseUnicode`, la ñ ya capitaliza) (B-11). (5) Supervisión: `calculateSupervisorPaymentBreakdown` filtra ANULADA por sí solo (`isVoidedSale`) (B-12); los chips de moneda reaccionan al toggle de COP vía evento `pda_cop_enabled_changed` + `storage` (B-14); el prompt de IA omite la línea de tasa COP si está desactivado (B-15); los 3 modales remotos usan `useMountedRef` para no hacer setState tras desmontaje durante el ack (B-19). (6) Ajustes: nombre/RIF con trim + límites (60/20, RIF en mayúsculas) vía `cleanBusinessData` (B-16); eliminar método de pago pide confirmación (`ConfirmModal`) y no se puede desactivar el último método activo (B-17). (7) Modales: `Modal` acepta `disableClose` (bloquea X/backdrop/Escape durante el envío); `RemoteProductFormModal` lo usa con `isSubmitting`; `SupervisorRateModal` ignora cierres durante el envío (`SupervisorInventoryBatchModal` ya lo hacía) (B-18).

**No implementado (documentado):** B-10 (heurística de encabezado Excel — toca el importador del tercero, pendiente de coordinación junto con ALTO-6 y M-8). B-2: sesión local manipulable desde devtools — riesgo aceptado del auth 100% cliente, decisión pendiente con Luigi (HMAC atado al PIN vs documentar). B-3: verificado — `lookup_customer_project` (RPC público en el proyecto del cliente) no tiene rate-limit server-side; un throttle real requiere Edge Function/gateway (no se afirma como resuelto).

**Cambios:**
- `src/utils/fase6Money.js`: nuevo — `advancePriceUsdt`, `copToUsd`, `bsOnlyChange`, `paymentMethodToBs`, `isVoidedSale`, `cleanBusinessData`, `titleCaseUnicode` (+ re-export `divR`).
- `src/components/security/CloudGate.jsx`: error visible en `handleRevoke`.
- `src/components/Sales/CheckoutModalPOS/index.jsx`, `components/PaymentFooter.jsx`: fuera `imprimir`.
- `src/components/Sales/CheckoutModal.jsx`: `deliverAllBsChange` sobre `bsOnlyChange`; `MobileChangeAllocation` recibe `onDeliverAllBs`.
- `src/views/SalesView.jsx`: avance usa `advancePriceUsdt`.
- `src/components/Sales/CheckoutModalPOS/hooks/usePaymentCalculations.js`: COP vía `copToUsd`.
- `src/utils/withLock.js`: nivel intermedio `_storageMutex` (lease 8s, timeout 10s, verificación de token).
- `src/hooks/useCloudSync.js`: `recordSyncPushError`/`getLastSyncPushError`/`SYNC_PUSH_ERROR_EVENT`.
- `src/hooks/useMonitorSync.js`: `MAX_RECONNECT_ATTEMPTS = 12`; `triggerRefresh` resetea contador y limpia error.
- `src/hooks/useMountedRef.js`: nuevo hook.
- `src/components/Modal.jsx`: prop `disableClose`.
- `src/components/Monitor/RemoteProductFormModal.jsx`, `SupervisorRateModal.jsx`, `SupervisorInventoryBatchModal.jsx`: `useMountedRef` + bloqueo de cierre durante envío.
- `src/views/ProductsView.jsx`: advertencia de precio $0.
- `src/utils/productProcessor.js`: `titleCaseUnicode` en `buildProductPayload`.
- `src/services/supervisorFinancials.js`: `isVoidedSale` en el breakdown.
- `src/views/ModoJefePanel.jsx`: `MonedaChips` suscribe `pda_cop_enabled_changed` + `storage`.
- `src/components/Settings/tabs/SettingsTabNegocio.jsx`, `src/components/SettingsModal.jsx`: emiten `pda_cop_enabled_changed`.
- `src/services/systemConsciousnessService.js`: línea de tasa COP condicional a `cop_enabled`.
- `src/views/SettingsView.jsx`: `cleanBusinessData` al guardar.
- `src/components/Settings/PaymentMethodsManager.jsx`: `ConfirmModal` para eliminar; bloqueo de desactivar el último activo.
- `tests/fase6.test.js`: 19 tests nuevos; `tests/withLock.test.js`: +2 tests B-8.

**Verificación:** suite completa 896 passed / 11 skipped / 0 failed; `npm run build` exitoso.

---

---

## 2026-10-01 — Seguimiento de la auditoría general post-plan (fixes hallazgos 1–6)

La auditoría general de debugging (subagente, solo lectura) verificó los 58 hallazgos implementados en Fases 0–6, tags remotos `fix-fase-1`..`fix-fase-6`, suite 896/11/0 con `TZ='America/Caracas'`, y encontró 6 puntos nuevos implementables. Se aplicaron aquí:

1. **B-17 incompleto (medio-bajo):** `PaymentMethodsManager.handleToggleState` contaba métodos virtuales (p. ej. saldo a favor) como "método activo", pero el checkout (`CheckoutModalPOS`) solo ofrece reales. Podía dejar el checkout sin método de cobro. Predicado puro extraído: `canDeactivatePaymentMethod(methods, id)` — los virtuales no cuentan como respaldo. Tests en `tests/auditoriaPostPlan.test.js`.
2. **B-13a incompleto (bajo):** `SYNC_PUSH_ERROR_EVENT` se emitía pero ninguna UI lo consumía. `src/components/SyncStatus.jsx` ahora mantiene `pushError` en estado, se suscribe al evento vía `useCloudSync`, y renderiza aviso rojo "Error de sincronización" (desaparece al tocarlo; el registro en `useCloudSync` conserva el último error). Sin testing-library no hay test de montaje; el contrato del evento sigue cubierto en `tests/fase6.test.js`.
3. **B-18 incompleto (bajo):** `CasheaRemittanceModal`, `TransactionModal` y `GastosInternosModal` podían cerrarse durante un submit async. Fix: `CasheaRemittanceModal.safeClose()` (ignora cierre si `busy`; backdrop/Escape/X lo usan), `TransactionModal.handleClose()` (ignora cierre si `isSubmitting`; X y backdrop/Escape lo usan), `GastosInternosModal` con `disableClose={isSubmitting}`. Además: `CasheaRemittanceModal.handleConfirm` ahora usa `try/finally` para no quedar en `busy` permanente si `onConfirm` lanza. (Los otros 3 modales de Monitor ya lo tenían de Fase 6.)
4. **Monitoreo legacy Lite en Pro (bajo):** `useLicenseMonitoring.js` enviaba heartbeats cada 3 min y consultaba RPCs/tabla `licenses` con `product_id='bodega'` — mina de scoping Lite/Pro + requests 404 por sesión hasta que el guard `deviceBackend` caía. Queda como no-op documentado (API intacta; CloudGate es el gate real). `_fetchRemoteLicense` en `useSecurity.jsx` retorna `{ data: null, error: null }` (el cuerpo legacy con `product_id='bodega'` se eliminó). `DevicesManager.jsx` estaba muerto (sin imports) y se eliminó. NOTA: las funciones de activación manual legadas de `useSecurity` (`auto_register_device`, `heartbeat_device`, `verify_activation_code`) quedan pendientes de limpieza en el refactor de licencias; solo se invocan desde acciones explícitas, no por sesión.
5. **Lease de `withLock` sin heartbeat (bajo):** documentado explícitamente en `withLock.js` — el lease de 8s sin renovación puede perderse en operaciones > 8s; las secciones críticas son escrituras de ms, muy por debajo. Si alguna crítica supera ~5s, añadir heartbeat.
6. **INFO:** eliminado el re-export sin consumidores de `divR` en `fase6Money.js`. `totalPagadoBS` conserva fórmula inline equivalente a `paymentMethodToBs` (sin bug detectado).

**Verificación:** focales `auditoriaPostPlan` + `fase6` + `withLock` = 36 passed / 0 failed; suite completa con `TZ='America/Caracas'`: **903 passed / 11 skipped / 0 failed**; `npm run build` exitoso.

**Pendientes que siguen en pie (no se fingieron resueltos):** ALTO-6, M-8 y B-10 (importador Excel del tercero, diffs exactos en `~/workspace/your_files/fase-4-diffs-coordinacion-tercero-2026-10-01.md`); B-2 (sesión local manipulable — decisión HMAC/PIN); B-3 (RPC público sin rate-limit, requiere server-side).

**Deploy a producción (2026-10-01, ~14:20):** luigi autorizó ("despliega"). El push a `main` no disparó deploy automático en Vercel (Git no conectado: `vercel git connect` pendiente). Deploy manual con `vercel --prod`: `✓ Ready in 3m`, target production, commit `de88a68c` (tag `fix-auditoria-postplan`). `https://preciosaldia-multilocal.vercel.app` → 200 OK.

## 2026-10-01 ~21:40 — Sync unificado + fix fotos (commit 222e5db2, DESPLEGADO)
**Problema:** El botón "Sincronizar con la Nube" solo sincronizaba la tabla `cloud_backups`, NUNCA los documentos (`sync_documents`) donde viven los productos. Por eso al pulsar "no pasaba nada" y las fotos no aparecían.
**Fix:**
- Nueva función `syncNow()` en `useCloudSync.js`: hace pull (baja documentos nuevos) + push (sube cambios) y devuelve `{ok, message}` claro.
- `handleSyncCloud` en `useCloudBackup.js` ahora llama `syncNow()` primero y muestra el resultado: "Sincronizado correctamente (X actualizados, Y subidos)" o el error específico.
- **Causa raíz de las fotos:** mi vinculación SQL no actualizó el `updatedAt` interno del envelope; la app lo rechazaba por "no ser más nuevo" (LWW). Corregido vía SQL.
**Deploy:** `vercel --prod` → `preciosaldia-multilocal-kgsr4exrn-luiggi2.vercel.app` ● Ready.

## 2026-10-01 ~22:05 — Flujo código-primero (commit 74353520)
**Pedido de Luigi:** el código debe mandar — el equipo que se active con el código queda asociado de inmediato; panel de equipos en Ajustes (reemplaza Licencia) para ver/desvincular; al registrar equipo pedir el nombre.
**Cambios:**
- `CloudGate.jsx`: nuevo campo "Nombre de este equipo" en el login; se pasa a `signInOwner` → `registerCurrentDevice(alias)`.
- `cloudAccount.js`: `signInOwner(email, password, deviceAlias)` acepta alias.
- Nuevo `SettingsTabEquipos.jsx`: lista equipos vinculados (nombre, ID corto), botón desvincular, contador X/6, muestra el código de licencia.
- `SettingsView.jsx`: pestaña "Equipos" (reemplaza visualmente a "Licencia" en la navegación; la pestaña Licencia se mantiene por compatibilidad).
**Tests:** 923 passed.
**Deploy:** pusheado a main; `vercel --prod` en curso (bundle por verificar).

### Botón "Cambiar código" (2026-10-01)
- En Ajustes → Equipos, junto al código de licencia, botón "Cambiar código".
- Limpia el Supabase guardado localmente y recarga → vuelve CloudGate para meter otro código.
- Desplegado a producción.

### Dispositivos Pro dinámicos (2026-10-01)
- La app lee `max_devices` del directorio (ya no hardcodea 6).
- RPC `register_account_device` acepta `p_max_devices`.
- La app reporta sus dispositivos a la Estación vía `report_pro_devices`.
- Si la Estación revoca un equipo, la app lo detecta en el sync y vuelve a CloudGate.
- Desplegado a producción.

### Fix licencia Pro en sesiones existentes (2026-10-02)
**Problema:** el fix `ebbd789` solo marcaba `pda_license_cache` en `handleLogin`. Si la app entraba directo a `ready` (sesión/proyecto ya cacheados), la licencia seguía en "Sin Licencia" y bloqueaba Inventario/Vender/Sincronizar.
**Cambios:**
- `useSecurity.jsx`: `checkLicense` ahora primero revisa `getCustomerProject()`; si hay código Pro activo, `isPremium(true)` sin más validación.
- `SettingsTabLicencia.jsx`: si hay proyecto Pro activo, muestra licencia activa aunque no esté en el caché viejo.
**Commit:** `9bc8d3f`. **Deploy:** producción Ready.

### Fix botón "Actualizar Tasas" (2026-10-02)
**Problema:** en el Monitor, el botón "Actualizar Tasas" no hacía nada (pulsado 3 veces en prueba live, sin cambios ni mensajes).
**Causa:** `onRefresh` llamaba a `refreshData()` de `useDashboardData`, que solo recarga ventas/clientes locales, nunca las tasas.
**Cambios:**
- `App.jsx`: expone `updateData` de `useRates()` como `refreshRates`.
- `DashboardView.jsx`: recibe `refreshRates` y lo pasa a `MonitorView` como `onRefresh` (fallback a `refreshData` si no existe).
**Commit:** `efc5ede`. **Deploy:** producción Ready.

### Fix monitor: subtítulo duplicado y solapamiento (2026-10-02)
**Problema (reportado por Luigi con captura):** "Actualizado donde vayas" aparecía duplicado; cifras y palabras podían chocar en pantallas angostas.
**Cambios (`MonitorView.jsx`):**
- Eliminado el `<p>` duplicado (el logo ya trae el texto).
- Precio gigante: `text-[16vw]` → `text-[14vw]`, contenedor con `max-w-full overflow-hidden`, `shrink-0` en `$`/decimales/`Bs`, `whitespace-nowrap`.
**Commit:** `5fe5c69`. **Deploy:** producción Ready.

### Fix loading en botón Actualizar Tasas (2026-10-02)
**Problema:** en la prueba live, el botón no mostraba "Actualizando..." al pulsarlo (volvía a estado normal en <1s).
**Causa:** `DashboardView` pasaba `loading={false}` hardcodeado a `MonitorView`, ignorando el estado real de `useRates`.
**Cambios:**
- `App.jsx`: expone `loading` de `useRates()` como `ratesLoading`.
- `DashboardView.jsx`: recibe `ratesLoading` y lo pasa a `MonitorView` como `loading`.
**Nota:** la prueba live corría una versión cacheada del PWA (aviso "Nueva versión disponible" visible). Los fixes requieren actualizar la app.

### Fix botón Sincronizar (2026-10-02)
**Problema:** en la prueba live, pulsar "Sincronizar con la Nube" no mostraba ningún mensaje ni hacía nada.
**Causa:** el `onClick` del botón solo mostraba toast si NO había licencia; si había licencia, no llamaba a nada. Recibía `handleSyncCloud` por props pero nunca lo invocaba.
**Cambio:** `SettingsTabSistema.jsx` ahora llama a `handleSyncCloud()` cuando hay licencia.
**Deploy:** producción Ready.

## 2026-10-02 ~06:45 — Botón "Vincular fotos" (VINCULAR-FOTOS-001)
**Pedido de Luigi:** ver las fotos de los productos en Bodega como evidencia.
**Cambios:**
- Nuevo `src/utils/vincularFotos.js`: vincula fotos por barcode usando el mapeo `public/barcode_to_photo.json` (1.498 códigos → filenames, generado desde `mapeo_fotos_bodega.json`). Las URLs apuntan al bucket `product-images` en Supabase Storage.
- Nuevo `public/barcode_to_photo.json`: mapeo compacto barcode → filename.
- `ProductsToolbar.jsx`: nuevo botón "Vincular fotos" en el menú de herramientas (icono Image, color emerald).
- `ProductsView.jsx`: handler `handleVincularFotos` que aplica el mapeo, guarda en storage y muestra toast con el conteo.
**Uso:** Importar Excel de Bodega → Herramientas → Vincular fotos → las tarjetas muestran las imágenes.

## 2026-10-02 ~09:40 — Fix QA: vuelto en recibo + feedback Actualizar Tasas
**Reportado por:** pruebas deterministas Fase 3 y 5.
**Fix 1 — Vuelto en recibo (ReceiptModal.jsx):**
- El recibo en pantalla mostraba "Vuelto entregado: Bs 0,00" cuando el vuelto fue en dólares.
- Causa: el código usaba `receiptCurrencyMode` (default 'bs') para decidir qué mostrar, ignorando los montos reales.
- Fix: ahora muestra los montos reales — si hay vuelto en $ muestra `$X.XX`, si hay en Bs muestra `Bs X`, si hay ambos muestra ambos.
**Fix 2 — Feedback Actualizar Tasas (useRates.js + DashboardView.jsx):**
- El botón no mostraba confirmación visible al actualizar.
- `updateData()` ahora retorna `{ok, bcv}` o `{ok:false, error}`.
- `DashboardView` muestra toast: "Tasas actualizadas (BCV X)" en éxito, "Error al actualizar tasas" en fallo.
- El estado "Actualizando..." con spinner ya existía (loading).

## 2026-10-02 ~10:15 — Failovers: respaldo pre-conflicto + diálogo informativo + importar negocio
**Plan:** PLAN-MAESTRO-FAILOVER.md
**Fix 1 — Respaldo automático pre-conflicto (FAILOVER-001, P1 CRÍTICO):**
- `useCloudBackup.js`: nueva función `guardarSnapshotPreConflicto()` que guarda el backup local en localStorage antes de aplicar cualquier resolución de conflicto.
- Mantiene solo los últimos 3 snapshots. No bloquea la resolución si falla.
- Toast actualizado: "Datos de la nube restaurados. Respaldo local guardado. Reiniciando..."
**Fix 2 — Diálogo informativo (FAILOVER-002, P2 ALTO):**
- `SettingsTabSistema.jsx`: el diálogo de conflicto ahora muestra conteo de registros y fecha de ambos lados (Este equipo vs Nube).
- Agregada nota: "Se guardará un respaldo automático de tus datos locales antes de aplicar tu elección."
**Fix 3 — Importar negocio con ID específico (FAILOVER-003, P3 MEDIO):**
- `useNegociosStore.js`: nueva función `importarNegocioConId(id, datos)` para recuperar negocios desde la nube con su ID original.
- Valida formato `neg-*` y evita duplicados. Marca `importadoDeNube: true`.

## 2026-10-02 ~17:55 — Fix: "Última conexión: nunca" en la Estación
**Reportado por:** Luigi (screenshot de la Estación mostrando "nunca").
**Causa:** el campo `account_devices.last_seen` nunca se actualizaba después del registro inicial del dispositivo. `reportDevicesToDirectory()` leía el valor viejo (null) y lo enviaba a la Estación, que mostraba "nunca".
**Fix (`src/services/cloudAccount.js`):**
- `reportDevicesToDirectory()` ahora actualiza `last_seen` del equipo actual a NOW en `account_devices` antes de reportar (best-effort, no bloquea).
- El payload enviado a la Estación usa el timestamp fresco para el equipo actual.
- La Estación mostrará la última conexión real en vez de "nunca".

## 2026-10-02 ~18:00 — Cambio de sede desde el login (SEDE-LOCKSCREEN)
**Pedido de Luigi:** el cambio de sede debe hacerse desde la pantalla de login ("¿Quién está operando?"), no desde dentro de la app. Debe requerir el PIN del dueño.
**Cambios (`src/components/security/LockScreen.jsx`):**
- Nuevo selector de sede (píldoras con icono Store) encima de la grilla de usuarios, visible solo si hay más de 1 negocio.
- La sede activa se muestra destacada en teal con check.
- Al tocar otra sede: se abre el modal de PIN del dueño ("Dueño (cambio de sede)").
- PIN correcto → `activarNegocio(id)` (recarga la app en la nueva sede).
- Texto aclaratorio: "Cambiar de sede requiere el PIN del dueño".

## 2026-10-02 ~18:05 — Fix: banner "Actualizar ahora" tapado por "Instalar App"
**Reportado por:** Luigi + pruebas de navegador (2 intentos de clic fallidos).
**Causa:** el `LockScreen` tiene `z-[250]` y el `UpdateBanner` tenía `z-[100]`. Toda la pantalla de login (incluido el botón "Instalar App" en `top-4 right-4`) quedaba POR ENCIMA del banner, tapando el botón "Actualizar ahora".
**Fix (`src/components/UpdateBanner.jsx`):** z-index del banner cambiado de `z-[100]` a `z-[300]`, por encima del LockScreen.

## 2026-10-02 ~18:12 — Fix: botón "Actualizar ahora" se quedaba colgado
**Reportado por:** Luigi (screenshot mostrando "Actualizando..." sin avanzar).
**Causa:** `applyUpdate()` llamaba a `window.__pdaUpdateSW(true)` sin timeout. Si la función del PWA se colgaba, el botón quedaba en "Actualizando..." indefinidamente.
**Fix:** timeout de seguridad de 5 segundos — si la actualización no completa, fuerza `window.location.reload()`.

## 2026-10-02 ~18:20 — v2.0.1: fix selector de sede en login
**Reportado por:** Luigi (el selector no aparecía después de cambiar de sede).
**Causa:** el `useNegociosStore` (zustand persist) podía no estar hidratado cuando el `LockScreen` renderizaba, dejando `negocios` vacío y ocultando el selector (condición `length > 1`).
**Fix (`src/components/security/LockScreen.jsx`):**
- Fallback a `localStorage` directo (`pda-negocios-registry`) si el store aún no hidrató.
- Tanto `negocios` como `negocioActivoId` tienen fallback.
**Versión:** 2.0.1 (package.json, LockScreen, SettingsView).

## 2026-10-02 ~18:35 — Roles: supervisión solo dueño + cambio PIN dueño
**Pedido de:** Luigi.
**Cambios:**
1. **Supervisión solo para el dueño** (`src/utils/roles.js`): creado `TABS_DUENO` (con supervisión) y `TABS_ADMIN` (sin supervisión). El admin ya no ve el tab Supervisión.
2. **Cambiar PIN del dueño** (`src/components/Settings/UsersManager.jsx`): nueva sección "PIN del Dueño" visible solo con sesión de dueño. Reutiliza `MasterPinSetupModal` para definir el nuevo PIN maestro. Antes NO había forma de cambiarlo (solo se creaba al inicio).
3. **Dueño omnipotente:** verificado — `hasAdminAccess`, `canManageBusinesses`, `canCreateRole`, `canManageUser` ya le dan todos los permisos.

## 2026-10-02 ~18:40 — Ojo para ver el PIN maestro
**Pedido de:** Luigi.
**Cambio (`src/components/security/MasterPinSetupModal.jsx`):** botón de ojo (Eye/EyeOff de lucide) junto al label "Tu PIN maestro" que alterna entre mostrar/ocultar los dígitos de ambos campos (PIN y confirmación).

## 2026-10-02 ~18:45 — Clave de emergencia: ojo + explicación primera vez
**Pedido de:** Luigi.
**Cambios (`src/components/Settings/UsersManager.jsx`):**
1. Ojo (mostrar/ocultar) en el campo "PIN maestro del dueño" del paso 1 de verificación.
2. Primera vez (sin clave configurada): caja explicativa ámbar que dice para qué sirve (7 toques al logo en login para restablecer el PIN maestro) y advierte que debe guardarse en lugar seguro porque sin ella no hay recuperación.
3. La confirmación de la clave ya existía en el paso 2.

## 2026-10-02 ~18:50 — Clave emergencia ahora restablece PIN del dueño
**Decisión de:** Luigi.
**Cambio (`src/components/security/EmergencyPinResetModal.jsx`):**
- El dueño ahora aparece en la lista de usuarios elegibles para restablecimiento.
- Al elegir al dueño: checkbox de confirmación explícita (caja roja) + registro en auditoría (`pin_dueno_restablecido_emergencia`).
- Ojos para ver/ocultar en: clave de emergencia (paso 1) y nuevo PIN + confirmación (paso 2).

## 2026-10-02 ~18:55 — v2.0.2: avatar admin en azul
**Pedido de:** Luigi.
**Cambio (`src/components/security/LoginAvatar.jsx`):** el admin ahora usa degradado azul (`from-blue-500 to-indigo-600`) para distinguirse del cajero (verde). Colores finales: dueño dorado, admin azul, cajero verde.
**Versión:** 2.0.2.

## 2026-10-02 ~19:00 — v2.0.3: clave emergencia con "anótala ahora" + hash + 8 chars
**Pedido de:** Luigi.
**Cambios:**
1. **Pantalla "anótala ahora"** (paso 3): después de crear la clave se muestra en grande una sola vez, con checkbox "Ya la anoté en un lugar seguro" obligatorio para cerrar.
2. **Hash SHA-256**: la clave ya no se guarda en texto plano (`pda_emergency_pin_hash`). Las claves legacy en texto plano se migran automáticamente al usarlas.
3. **Mínimo 8 caracteres** (antes 6).
4. **Sin sugerencias de autocompletado** en todos los campos de PIN (`autoComplete="off"`).
**Versión:** 2.0.3.
