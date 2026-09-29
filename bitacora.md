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
