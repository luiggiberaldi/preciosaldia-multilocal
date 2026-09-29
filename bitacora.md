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
