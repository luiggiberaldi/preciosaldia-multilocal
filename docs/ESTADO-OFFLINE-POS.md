# Estado y corrección pendiente: POS sin conexión

**Fecha:** 2026-10-08
**Estado observado por el dueño:** la pantalla Inventario ya abierta sigue mostrando catálogo y controles al perder Internet; la consola indica fallo de sincronización (`Failed to fetch`) y retry local incompleto/sync no activo.
**Alcance de esta nota:** evidencia de interfaz abierta y diagnóstico de arranque/checkout; se añadió un reintento local del motor de sync al evento `online`, sin cambios de esquema, datos ni despliegue productivo.

## Resumen

La nueva captura del dueño demuestra un alcance offline más limitado y preciso: **una sesión ya abierta conserva y muestra la pantalla de Inventario/catálogo al perder red**. No respalda la afirmación de que toda la aplicación se bloquee offline. Sí muestra fallos de sincronización cloud en consola (`Failed to fetch`; retry local incompleto/sync no activo). El motor estaba pausado por fallo de validación online y su listener `online` previo solo intentaba push si el motor seguía activo; por eso no iniciaba de nuevo la validación al recuperar red. Se añadió en código local el reintento completo de inicialización al evento `online`, manteniendo validación server-side fail-closed antes de activar sync. Esto corrige el mecanismo de reanudación, no prueba una conexión real ni demuestra que la app pueda arrancar en frío, completar una venta, persistir todos sus efectos o reconciliarlos al reconectar.

El requisito pendiente es establecer por separado el comportamiento de arranque, checkout y convergencia. No se cambió la disponibilidad de Inventario ni se ocultaron errores. El retry al recuperar red está probado en mock hermético; falta validarlo en la PWA contra el servicio real y observar resultado/errores.

## Gate de código que puede intervenir en arranque en frío offline

Al inspeccionar la ruta de entrada en `src/main.jsx` y `src/components/security/CloudGate.jsx` se encontró una causa concreta y suficiente para bloquear el arranque sin Internet:

- `CloudGate` consulta la sesión guardada y después llama `getCurrentDeviceMembershipStatus()` para comprobar la membresía actual en Supabase.
- `getCurrentDeviceMembershipStatus()` realiza una consulta remota (`account_devices` para sesión de dueño o `my_account_device_ids` para equipo vinculado).
- Si no hay red, devuelve `status: "unavailable"`; `resolveCloudGateEntry()` convierte cualquier estado no verificable en `"blocked"`. CloudGate muestra el mensaje de conectarse para validar y no llama `onReady()`.
- La rama solo permite entrar tras obtener confirmación online de membresía. No existe en esa ruta un recibo offline firmado/fechado con un plazo de 24 horas.

Esto identifica una **causa suficiente para bloquear el arranque en frío cuando se ejecuta esa rama**, no el bloqueo de toda sesión offline. La captura del dueño corresponde a la app ya dentro de Inventario y no muestra CloudGate; por tanto, no prueba ni refuta el arranque/reapertura offline. Ese caso aún requiere reproducción en la PWA/build instalada.

La causa no debe “arreglarse” confiando únicamente en `pda_account_linked`, `pda_pro_activated`, `navigator.onLine` o una bandera editable de `localStorage`: esas marcas no prueban vigencia ni revocación y permitirían mantener acceso indefinido tras revocación. La regla D9 aprobada exige autorización offline de como máximo 24 horas y que el servidor bloquee operaciones de dispositivos revocados/vencidos al reconectar.

**Corrección necesaria:** emitir/renovar durante una verificación online un permiso offline verificable, ligado criptográficamente a la identidad de instalación, cuenta, dispositivo y sedes autorizadas, con `issuedAt`/`expiresAt` de hasta 24 horas. En arranque sin red, validar firma, identidad, integridad y expiración localmente; permitir entrada solo mientras siga vigente. No confiar en hora de emisión controlada por el cliente sin protección frente a retroceso del reloj (se requiere estrategia de reloj/monotonicidad y fail-closed documentada). Al reconectar, volver a validar estado de revocación/membresía en servidor; las operaciones pendientes de dispositivo revocado o permiso vencido deben quedar preservadas para revisión del dueño según D9.

El servicio/backend actual no proporciona todavía ese artefacto de autorización offline ni una ruta real de revisión de operaciones pendientes. **No cambié CloudGate ni la política de sync en respuesta a la captura:** la sesión abierta ya muestra Inventario; queda probar arranque en frío, checkout y reconciliación. Si se modifica el arranque, primero hace falta un permiso expirable verificable y probar estado vigente, expirado, revocado, reloj alterado, sesión anónima vinculada y fallo de red.

## Evidencia que no debe confundirse

La regresión local en [cloudSyncConcurrency.test.jsx](../tests/cloudSyncConcurrency.test.jsx) verifica membresía temporalmente `unavailable` → sync pausado y sin push → evento `online` vuelve a inicializar → nueva validación aprobada → push disponible. La misma suite conserva la prueba de que autorización fallida/revocada no habilita escritura. Cuatro suites focalizadas (concurrencia, cloud pull, estado UI y cuenta) pasaron con **72 tests**; `bun run typecheck` aprobó. ESLint reportó cero errores y 16 warnings en `useCloudSync.js`; no se añadieron suppressions. Todo es local/mock, no prueba red o membresía real.


La captura adjunta por el dueño (DevTools con filtro `CloudSync`) muestra Inventario abierto, catálogo cargado y controles visibles, junto a errores de red/retry de sync. Es evidencia de disponibilidad de esa pantalla en una sesión ya activa; no permite determinar si los cambios locales persisten tras recarga ni si el checkout está disponible.

La prueba [pwa-built-offline.e2e.spec.js](../tests/e2e/pwa-built-offline.e2e.spec.js) verificó que un shell PWA ya servido pudiera arrancar/recargarse desde archivos precacheados y mostrar la pantalla de licencia sin red. **No verificó autenticación real, arranque del POS tras cerrar/reabrir, crear una venta offline, sus efectos financieros ni sincronización al reconectar.**

Las pruebas [cloudAccount.test.js](../tests/cloudAccount.test.js) y [cloudGateFlows.test.js](../tests/cloudGateFlows.test.js) comprueban que membresía `unavailable` bloquea y cubren una sesión local aislada, respectivamente; la segunda no monta CloudGate completo ni verifica un permiso offline de 24 h. Tampoco están conectados al checkout operativo el sandbox de venta atómica, el modelo de operaciones ni el backend simulado. Sus pruebas locales no son evidencia de una venta real offline.

## Comportamiento requerido

Las decisiones funcionales están registradas en [DECISIONES-PENDIENTES-SYNC-MULTISEDE.md](DECISIONES-PENDIENTES-SYNC-MULTISEDE.md), especialmente D1, D9 y D10:

- **Dentro de las 24 horas de autorización offline vigente:** la caja autorizada debe poder operar con datos locales disponibles, crear venta y movimientos pendientes durables y seguir mostrando claramente el estado offline. No requiere que el servidor confirme cada venta en el momento.
- **Stock en varios equipos desconectados:** aceptar explícitamente que puede haber sobreventa. Al reconectar se conservan todas las ventas y se presenta una discrepancia para revisión; no se descarta ni se rechaza una venta automáticamente. Mientras haya discrepancia, el límite de nuevas ventas por producto es el stock confirmado no disputado; si no puede calcularse con certeza, se bloquea solo ese producto en esa sede hasta su conciliación.
- **Autorización:** el permiso offline expira como máximo a las 24 horas. Al vencer, hay que reconectar y revalidar antes de iniciar nuevas operaciones. Las operaciones pendientes de un equipo revocado o vencido se preservan y quedan para decisión explícita del dueño; no se aplican ni eliminan automáticamente.
- **Tasa:** se puede usar la última tasa común almacenada hasta 12 horas desde su actualización; debe mostrarse su antigüedad y bloquear ventas/cobros convertidos al vencer.
- **Datos y efectos:** ticket, stock, cartera/ledger y efectos de caja que correspondan deben recuperarse coherentemente tras reinicio; reintentos al reconectar deben ser idempotentes.

## Trabajo técnico pendiente

El contrato de diseño para firma, claims, reloj, revocación y pruebas está en el [contrato de autorización offline](CONTRATO-AUTORIZACION-OFFLINE.md); no está implementado.

1. **Validar en la PWA del dueño el ciclo de reconexión ahora cubierto localmente:** tras una pérdida temporal de red y un error `Failed to fetch`, restaurar Internet; confirmar que el motor vuelve a validar membresía, deja el estado pausado, y el pull/push se completa o muestra un error accionable sin duplicar. Hacerlo primero solo observando datos existentes; no editar stock/ventas reales para la prueba.
2. **Reproducir por separado los otros niveles:** (a) persistencia/lectura local en la sesión de Inventario abierta; (b) recarga y arranque en frío/reapertura offline, anotando CloudGate/mensaje; (c) checkout offline con fixture o cuenta de ensayo, verificando ticket/efectos antes y después de reconectar. No borrar storage ni usar ventas reales.
2. **Diseñar permiso offline verificable y de 24 h** con servidor, ligado a identidad/cuenta/sede; definir revocación, expiración, reloj atrasado y reinstalación/backup de perfil antes de cambiar el gate.
3. **Habilitar entrada offline segura en CloudGate** solo cuando el permiso sea válido; conservar rechazo de sesión no autorizada, vencida, revocada o identidad distinta. Revalidar con el servidor al reconectar.
4. **Asegurar arranque offline real del POS:** cobertura del service worker, datos esenciales de sede/catálogo y dependencias. Un shell cacheado no basta.
5. **Implementar persistencia local económica atómica y duradera.** El checkout actual escribe ticket, stock y cartera/ledger en pasos separados. Diseñar transacción local con ID estable, outbox y recuperación tras reinicio; el sandbox no está integrado.
6. **Separar guardar localmente de confirmar en servidor:** encolar y mostrar venta pendiente offline; sincronizar con los mismos IDs y ACK exacto al volver Internet.
7. **Implementar reconciliación segura** para snapshots/operaciones y discrepancias según D1, incluida venta pendiente y límite de stock no disputado.
8. **Ejecutar E2E sobre la PWA instalada/build candidata**: arranque inicialmente activado, menos de 24 h offline, expiración, revocación remota durante desconexión, reconexión, cartera/stock/ticket, conflicto entre dos PCs y revisión del dueño.
9. **Entorno de prueba y publicación:** probar backend/RLS reales en un proyecto de prueba autorizado; no modificar producción ni desplegar sin autorización específica.

## Criterios de aceptación para declarar offline operativo

- En una instalación previamente autenticada, con permiso offline firmado vigente y membresía activa al último check online, activar modo avión no bloquea CloudGate y permite llegar al POS durante la vigencia aprobada (máximo 24 h).
- Tras guardar, el ticket y sus efectos locales aparecen una sola vez; forzar recarga/cierre normal y reabrir conserva una venta pendiente, sin efectos parciales.
- Sin red no se muestra «confirmada en la nube»; se informa claramente «pendiente de sincronizar».
- Al reconectar, reintentar la misma venta conserva sus IDs, obtiene confirmación idempotente y no vuelve a descontar stock ni cartera. El fallo de red/ACK se puede reintentar sin perder la venta.
- El caso de dos cajas sin conexión que venden la última unidad conserva ambas ventas y produce discrepancia explícita al sincronizar; no finge que ambas estaban reservadas. Las ventas posteriores respetan el saldo confirmado no disputado conforme a D1.
- A las 24 horas o tras revocación, las operaciones pendientes quedan preservadas y bloqueadas para revisión/reauthorización según D9; no se descartan.
- La tasa almacenada dentro del límite de 12 horas se muestra con su antigüedad; pasada esa vigencia se bloquea solo la operación convertida que depende de ella, según D10.
- La prueba se realiza en la **PWA instalada/build candidata**, con red realmente bloqueada, incluye autenticación offline válida, checkout, cierre/reapertura, reconexión y comprobación de venta/stock/cartera. El test de shell/licencia solo cuenta como cobertura parcial.

## Estado de preparación

**Evidencia parcial favorable:** una sesión abierta de Inventario muestra catálogo y controles sin red. Se añadió un reintento local de inicialización de CloudSync al evento `online`; sus pruebas herméticas pasan, pero no se ha verificado aún contra Supabase/PWA instalada. **No afirmar bloqueo offline total ni declarar checkout offline operativo.** Siguen sin verificarse arranque en frío, venta offline durable, efectos ticket-stock-cartera y convergencia tras reconexión. CloudGate puede bloquear el arranque si la consulta remota no está disponible; el permiso offline no está implementado. Baseline/backups siguen siendo gates distintos para migrar stock.
