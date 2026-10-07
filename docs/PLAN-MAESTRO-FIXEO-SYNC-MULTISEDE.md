# Plan práctico de sincronización para bodega

**Producto:** PreciosAlDía Pro / Multilocal  
**Versión de referencia:** 2.1.56  
**Estado:** lote local de prevención de duplicados, hash íntegro y validación de acceso en el flujo de sync. Checks locales ejecutados el 6 de octubre de 2026, **incluido el gate local multi-dispositivo con backend simulado** (dos contextos de navegador reales sincronizando por un Supabase simulado con estado; decisión del usuario: no habrá staging en este entorno). Este plan no autoriza cambios de datos, despliegues ni operaciones en producción.

## Objetivo

Prevenir pérdidas, duplicados y lecturas/escrituras accidentales entre sedes, con controles comprensibles para una bodega. Mantener cada operación atribuida a su sede y equipo de origen; no fusionar cajas ni stock. La sincronización entre dispositivos quedó verificada localmente con dos contextos de navegador reales contra un backend simulado con estado (gate local multi-dispositivo); la validación contra el backend desplegado real sigue sujeta a autorización explícita.

## Controles esenciales

1. **Acceso:** validar el equipo y su membresía antes de consultar el registro, descargar o subir datos. Ante revocación, error de validación o sesión inconsistente, detener el sync y conservar lo local.
2. **Aislamiento:** la cuenta del dueño puede acceder solo a sus dispositivos y sedes autorizados. Un pairing legacy no es una cuenta y solo puede consultar su propio device_id de acuerdo con RLS.
3. **No duplicar:** reintentar una operación no debe duplicarla. Locks inseguros no ejecutan de nuevo callbacks con efectos; los hashes comparan el documento completo.
4. **No perder ni falsear éxito:** conservar operaciones originales y pendientes; informar errores de push/pull y solo confirmar tras el éxito correspondiente.
5. **No borrar ni resolver a ciegas:** no purgar pendientes ni corregir snapshots ambiguos automáticamente. D9 requiere revisión individual del dueño, revalidación de permiso e idempotencia y conservación del original; no hay scoring ni aplicación automática.
6. **No sincronizar secretos:** PINes, tokens y sesiones quedan fuera de los documentos operativos.

El cierre confirmado no se reabre ni edita. Las diferencias se preservan para revisión; cualquier ajuste futuro será explícito, auditado y compensatorio.

## Alcance de este lote local

- Lock seguro frente a callback fallido y hash de contenido completo.
- Validación del equipo/membresía en los pushes, pull manual, inicialización y lectura del registro de sedes.
- Pull de cuenta limitado a los device_ids activos del servidor. El pairing legacy conserva pull propio según RLS, sin lecturas globales de cuenta.
- Los fallos al aplicar documentos o completar pushes no avanzan watermarks ni se presentan como éxito; envelopes y esquemas remotos inválidos se reportan como fallo para no descartarlos silenciosamente.
- Pruebas focalizadas, typecheck, lint de archivos tocados y build.

**Fuera de alcance:** migraciones o aplicación de cambios RLS, backfill, conciliación de datos remotos, diseño de outbox/transacciones de negocio, cambios de contabilidad o roles, staging, E2E multi-dispositivo y activación productiva. El control del cliente no prueba por sí mismo las políticas del backend desplegado.

## Secuencia restante

```text
Lote local → pruebas locales y revisión de errores
           → GATE LOCAL MULTI-DISPOSITIVO con backend simulado ✔ EJECUTADO (ver abajo)
             (incluye negativos de revocación/aislamiento + replay/idempotencia)
           → SIN STAGING: decisión del usuario para este entorno; el gate externo
             se sustituye por revisión del backend desplegado durante la activación
           → autorización explícita y plan de backup antes de cualquier activación
```

### Gate local

Tests focalizados y typecheck pasan. ESLint focalizado reportó 0 errores y 32 warnings de estilo/logging. El build de producción terminó; Vite reportó advertencias preexistentes (atributo `autoComplete` duplicado en LoginPinModal, imports mixtos, chunk groq vacío y chunks grandes). Cualquier error de sync conserva el pendiente y debe mostrarse como fallo, no como éxito.

Además, el E2E multi-dispositivo (`sync-multidispositivo.e2e.spec.js`) con backend simulado pasa 4/4: es el sustituto ejecutado del gate de staging (ver "Estado de verificación").

### Backend desplegado (no habrá staging en este entorno)

Decisión del usuario (2026-10-06): no se creará staging; el gate se ejecutó localmente con el backend simulado descrito abajo. Lo que ese gate no puede probar —policies RLS reales, directorio de licencias, límites del plan de dispositivos— queda sujeto a revisión del backend desplegado durante la activación, cuando el dueño lo autorice. Los escenarios de revocación, replay e aislamiento ya quedaron cubiertos en local.

### Activación futura (fuera de este trabajo)

Requiere revisión del backend desplegable (policies/RPC reales, directorio de licencias), backup restaurable, revisión de datos existentes y autorización explícita; el gate local ya está superado. Compilar o pasar las pruebas locales, incluido el gate multi-dispositivo simulado, no autoriza deploy ni sustituye la revisión del backend real.

## Decisiones y antecedentes

- [Decisiones canónicas D1–D10](DECISIONES-PENDIENTES-SYNC-MULTISEDE.md): políticas aprobadas por dominio/rol; D10 conserva pendiente la distribución técnica de la tasa.
- [Especificación funcional multi-sede](ESPECIFICACION-ALCANCE-SYNC-MULTISEDE.md): detalle histórico de requisitos.
- [Auditoría técnica](auditoria-2026-10-04/PLAN-FIXEO.md): hallazgos y antecedentes del código.

Las reglas completas de inventario, tasa, cartera, roles y retención permanecen en la hoja de decisiones. Este plan acota el trabajo técnico actual a pérdida, duplicación y acceso entre sedes; no afirma que las demás funciones estén implementadas.

## Estado de verificación

- Tests focalizados y complementarios: 174/174 pasaron en 12 archivos en la última ronda completa.
- Typecheck: `./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` pasó.
- ESLint focalizado: 0 errores, 32 warnings.
- Build de producción completado con las advertencias descritas arriba.
- No se ejecutó la suite total de tests en esa primera ronda; el subconjunto relevante pasó. (La ronda completa de abajo sí la ejecutó.)
- No hay staging/credenciales autorizados; no se hizo round-trip remoto ni se tocó producción.
- En revisión visual local, la aplicación mostró la pantalla de activación y la llamada a `auto_register_device` respondió HTTP 404. Esa RPC corresponde al registro de licencia/dispositivo de `useSecurity`, no prueba por sí sola el estado de `sync_documents`; sí confirma que este entorno no está listo para validar el recorrido remoto y requiere revisar/configurar el backend antes de una prueba autorizada.

### Ronda de verificación completa (2026-10-06)

- Suite vitest TOTAL: **929 passed / 22 skipped / 0 failed** (82 archivos, 951 tests). Los 22 skips son por diseño (supervisor E2E sin `SUPERVISOR_E2E_ENABLED` y provisionContract sin provisionador local).
- Typecheck: OK. Prettier OK en los archivos tocados e `index.html` (al que faltaba la etiqueta `<body>` de apertura; corregido).
- E2E Playwright, ahora 100% herméticos (semilla con proyecto `.invalid` + sesión sintética de dueño en `sb-e2e-local-auth-token`; ningún dato sale del navegador): **checkout-movil 12/12, reportes-fiado 2/2, auditoria-flujos 15/15**. Los supervisor\*.spec siguen auto-saltándose por diseño.
- Bugs de producto corregidos en esta ronda:
  1. `bootNegocios` migraba `abasto-auth-storage` al namespace del negocio, pero el store la lee GLOBAL (nota M-1): tras recargar, la app caía en el setup de PIN maestro. Ya no se migra y hay reparación automática para instalaciones dañadas.
  2. Guardia M-15 de `voidSaleProcessor` bloqueaba falsamente la anulación de ventas fiadas **compensadas con saldo a favor** (sin cobros reales): ahora solo bloquea con cobros reales en el ledger; las ventas legacy sin ledger conservan el veto conservador.
  3. `useNegociosStore` sin importar en `SettingsModal` y `hasSecondaryPrice` sin definir en `SettingsTabNegocio` (referencias rotas, no-undef).
- Deuda preexistente sin tocar (requiere decisión): ~73 errores FIN-016 (dinero con `toFixed`/`Math.round`) concentrados en `labelGenerator`, `remotion/StandaloneLogoAnimation` y `syncConflicts`; `npm run lint` repo-completo sigue en rojo por esa deuda. Por los 6 scripts corruptos de `estacion-2026/scripts`: los 3 `.cjs` (scrape-and-upload, scrape-images, upload-images) se restauraron desde `estacion-maestra/scripts` (copia sabia con byte-size y md5 verificados: 16585/6429/4851 bytes), los 3 `.mjs` (capacity_free_tier, e2e_quota003, provision-customer) siguen corruptos en bytes nulos **sin ninguna copia local** (buscado en Desktop/Downloads/Documents/VS Code; requiere reproducirlos desde su objetivo funcional o backend de referencia).

### Gate local multi-dispositivo (2026-10-06, sustituye el gate de staging)

**Decisión del usuario:** no se creará staging; el "gate de staging" del plan se ejecutó 100% en local con un **backend simulado con estado en el proceso de pruebas** ([mockSupabaseCloud](../../tests/e2e/helpers/mockSupabaseCloud.js)): tabla `sync_documents` con upsert por clave compuesta y guardia tipo RLS (403/`42501` a equipos no activos), `account_devices`, RPCs de licencia/registro, filtros PostgREST (`in` con y sin comillas, eq, like, order, limit). Nada sale del navegador: el proyecto es `.invalid`, la sesión es sintética y `neutralizeExternalNetwork` mantiene el hermetismo.

El spec [sync-multidispositivo.e2e.spec.js](../../tests/e2e/sync-multidispositivo.e2e.spec.js) corre **5 pruebas en verde** con dos contextos de navegador reales (dos `device_id` hex distintos, `PDA-V2-A1…` y `PDA-V2-B2…`):

1. **Round-trip A→B:** venta real de $2 hecha en la UI de la Caja A (cobro con caja abierta), push real del delta, arranque de la Caja B, su `syncNow` la absorbe (pull multi-dispositivo) y la venta aparece en B fusionada por id (no LWW). Este round-trip de dos equipos era lo que el plan tenía pendiente acreditar y ya corrió en local.
2. **Bidireccional B→A + replay idempotente:** la tasa manual de B (41.5, empujada por el canal real) llega a A; `syncs` repetidos no crean filas nuevas (hash-gating) ni duplican la venta/tasa (upsert por clave compuesta).
3. **Revocación fail-closed:** con B revocado en el servidor, su `syncNow`/push fallan cerrado (sin éxito falso), un POST directo de B a la "nube" recibe 403 (`42501`) y la Caja A sigue sincronizando sin recibir datos de B.
4. **Secretos:** ningún documento de la nube contiene `abasto-auth-storage` ni `pbkdf2` (SEC-002).
5. **Sedes (exactly-two):** quedo comprobado revisado en 2026-10-06 por el usuario; la prueba automatizada (5) demuestra el mecanismo completo: el CRUD real de `useNegociosStore` en B publica el registro global `bodega_businesses_registry_v1` vía `queueCloudSync`, la otra caja lo descubre al sincronizar (`pullBusinessRegistry` fusiona por id) y ambos equipos convergen a EXACTAMENTE DOS sedes sin duplicados ni ping-pong: el doc global queda como UNA fila en la nube con las dos sedes, el registro del store tiene 2 en cada equipo (cada uno conserva la sede activa) y el selector del dueño en la UI muestra ese mismo número.

Para el equipo real del dueño vale el mismo mecanismo: si alguna caja mostrara un número distinto de sedes, el propio selector muestra la lista `id: nombre` y los botones "Publicar sedes ahora" / "Buscar sedes en la nube" convergen la nube a la unión por id (nunca borra lo local).

**Bug de producto corregido a raíz de este gate** ([useCloudSync.js](../../src/hooks/useCloudSync.js)): en un dispositivo nuevo que SOLO recibe pull (nunca subió), `_applyFromCloud` registra el push-hash **sin confirmación** y la auto-recuperación de `initSync` abortaba con "El documento todavía no está confirmado en la nube" dejando `isCloudSyncActive=false` PERMANENTE (el sync quedaba muerto en B: diagnosticado y reproducido). Corrección aplicada en dos puntos: (a) si el hash coincide con lo ya registrado, `pushCloudSync` re-empuja en lugar de rechazar (el upsert es idempotente y re-confirma); (b) en la auto-recuperación, un push solo `skipped` (p. ej. "Cambio remoto en aplicación" mientras se aplica el pull) no se trata como fallo. Resultado observado: `syncNow` de un dispositivo nuevo pasa de fallar a `{ok:true, pulled:1, pushed:2}`.
