# Bitácora — PreciosAlDía Multi

Registro de cambios del proyecto. Cada commit lleva su entrada: qué cambió y por qué.

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
