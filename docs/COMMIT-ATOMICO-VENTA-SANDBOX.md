# Commit atómico de venta — sandbox IndexedDB

**2026-10-08. Implementación aislada, no rollout.** Sin conexión al checkout, importación, migración ni escritura de datos reales. No accede a `BodegaApp`, `BodegaCloudPull`, Supabase, stores Zustand ni sede activa. Importar el módulo no abre ninguna base.

## Entregables

- [Servicio](../src/services/atomicSaleSandbox.js): IndexedDB nativo, sin nueva dependencia.
- [Contrato unitario](../tests/atomicSaleSandbox.test.js).
- [Integración Chromium](../tests/e2e/atomic-sale-sandbox.e2e.spec.js): transacciones reales, dos pestañas, recarga y perfil persistente.
- Reutiliza el [modelo exacto de operaciones](../src/utils/stockOperationModel.js) para validar las operaciones contra el baseline; no cambia el helper operativo de snapshots.

## API y almacenamiento

```js
const sandbox = await openAtomicSaleSandbox({
  databaseName: 'PDA-AtomicSale-Sandbox-demo',
  // indexedDB: factory opcional para arnés; por defecto API nativa
});
await sandbox.initializeBaseline(baseline, { allowNegative: false });
const result = await sandbox.commitSale(sale);
const state = await sandbox.readScope({ accountId, businessId, epochId });
await sandbox.recordOutboxAttempt({ accountId, businessId, epochId, saleId, revision });
await sandbox.confirmOutbox({ accountId, businessId, epochId, saleId, revision, receiptId });
sandbox.close();
```

Nombre explícito obligatorio: prefijo **`PDA-AtomicSale-Sandbox-`**, sufijo ASCII `A-Za-z0-9_-` de 1–100 caracteres. Nombre operativo, vacío o ruta: rechaza **antes de llamar `indexedDB.open`**. `indexedDB` ausente: falla; no fallback localStorage/memoria. Una conexión cierra al recibir `versionchange`; un open bloqueado falla y cierra una conexión que pudiera abrirse después. No existe API de borrado, migración ni export automático. La ampliación de recuperación añade exportación/restauración explícitas, descritas abajo.

Base versión **1**, stores:

| Store | Clave | Contenido |
|---|---|---|
| `baselines` | `scope` | baseline inmutable + política de stock negativo + identidad canónica |
| `sales` | `[scope, id]` | ticket completo, contenido canónico, SHA-256, timestamp local de commit |
| `operations` | `[scope, id]` | operación SALE de una línea + saleId |
| `stock` | `[scope, id]` | existencia exacta acumulada por producto, string entero |
| `outbox` | `[scope, id]` | ticket + todas operaciones, revisión, estado pending/confirmed, intentos, recibo |

`scope = JSON.stringify([accountId,businessId,epochId])`. Las claves compuestas evitan colisiones entre delimitadores o iguales IDs de distintas cuentas/sedes/épocas. Stores salvo baseline tienen índice `scope`. Todas las transacciones toman los cinco stores: IndexedDB serializa transacciones readwrite entre **conexiones/pestañas del mismo origen/base**, sin cola JS ni dependencia de Web Locks.

## Baseline y venta

```json
{
  "version": 1,
  "accountId": "cuenta-test",
  "businessId": "bodega-test",
  "epochId": "epoca-test",
  "stockUnits": { "producto": "10000000" }
}
```

Baseline validado por el modelo exacto; inmutable por scope. Repetición exacta retorna `{ initialized:false,replay:true }`; cualquier variación/política diferente: `BASELINE_CONFLICT`. Política predeterminada prohíbe baseline negativo y commit que lo produzca. `allowNegative:true` es explícita y queda fijada al inicializar. **Inicializar no significa aprobación del dueño:** es un contrato para evidencia sintética; integración futura debe validar autorización/baseline server-side.

```json
{
  "version": 1,
  "accountId": "cuenta-test",
  "businessId": "bodega-test",
  "epochId": "epoca-test",
  "saleId": "venta-estable",
  "deviceId": "instalacion-test",
  "actorId": "actor-test",
  "soldAt": "2026-10-08T12:00:00.000Z",
  "lines": [
    { "lineId":"linea-1", "operationId":"operacion-estable", "productId":"producto", "quantityUnits":"2000000" }
  ],
  "receipt": { "totalMinor":"450", "currency":"USD" }
}
```

- IDs obligatorios `A-Za-z0-9_.:-`, 1–128 caracteres. No se generan al reintentar: caller debe conservar saleId/lineId/operationId.
- `soldAt`: ISO UTC exacto con milisegundos, fecha de calendario válida; no se usa para escoger variantes.
- Entre 1 y **500 líneas**. lineId y operationId únicos dentro de venta; líneas del mismo producto se suman exactamente.
- quantityUnits: string entero positivo canónico de hasta 40 dígitos, **micro-unidades** (1.000.000/unidad). Sin cero, negativos, floats, exponentes ni ceros iniciales. Operación derivada `SALE` con deltaUnits negativo exacto; BigInt para aritmética.
- receipt: objeto JSON opaco completo, no valida conciliación monetaria ni reglas fiscales. Entrada máximo **1 MiB UTF-8**, profundidad máxima 30. Rechaza NaN/Infinity/undefined/BigInt/Date/functions/símbolos/arrays con huecos o campos extra: no descarta silenciosamente información. No permite campos extra en envelope/línea; receipt sí permite JSON anidado.
- Captura canónica **antes de I/O**, sin conservar referencias mutables del caller. Orden de claves y líneas no cambia identidad; los arrays de receipt sí preservan orden.

`prepareSandboxSale(input)` expone el contrato puro para pruebas; retorna `{ scope,sale,operations,content }`. SHA-256 se calcula antes de abrir transacción, sobre contenido canónico del ticket y operaciones. Igualdad de replay usa **contenido exacto**, no solo hash. El hash identifica revisión para ACK; no prueba autoridad.

## Garantía local y fallos

`commitSale()` crea **una transacción readwrite con `durability:'strict'`** que:

1. Lee baseline, ticket/outbox/operaciones existentes y stocks de todos los productos afectados.
2. Valida scope/productos/política, ID conflict y replay.
3. Agrega ticket y cada operación inmutable; actualiza stock de todas las líneas; agrega un outbox `pending` con payload completo.
4. Resuelve **solo en `transaction.oncomplete`**, nunca en `request.onsuccess`.

No hay await/fetch/crypto/timer dentro de callbacks de la transacción. Peticiones y cálculos se hacen sincrónicamente desde eventos IDB activos. Abort/request error/cuota/excepción revierten **todas las escrituras** y rechazan el commit. El error nativo de request se conserva (`ConstraintError`, etc.). No convierte una persistencia fallida en venta confirmada ni escribe una copia parcial en localStorage.

Retorno exitoso: `{ committed:true,replay:false,saleId,revision }`. Reintento idéntico: `replay:true`, sin nueva operación ni descuento, conservando estado de outbox y recibo. Mismo saleId/content distinto: `SALE_ID_CONFLICT`; operationId de otra venta: `OPERATION_ID_CONFLICT`. No sustituye una variante por timestamp. La variante rechazada permanece responsabilidad del caller: este sandbox no implementa journal de cuarentena ni resolución del dueño. Un outbox/operaciones ausentes en replay produce `INCOMPLETE_COMMIT`, no reparación silenciosa.

**Stock incremental es seguro aquí** porque todos los cambios provienen únicamente de inserts únicos en esta misma transacción/base/época. No sumar un snapshot remoto sobre esta proyección ni reusar baseline que incluya estas operaciones.

## Outbox durable y ACK

Outbox se crea con `status:'pending'`, `attempts:0`, `lastAttemptAt:null`, commit timestamp, SHA-256 y ticket/operaciones completas. Leer scope devuelve tanto pendientes como confirmados; caller puede filtrar, no hay worker de envío ni red implícita.

`recordOutboxAttempt` incrementa intentos durables de la revisión exacta; no confirma aunque un envío pudiera haber llegado al servidor. Tras crash sin ACK local, entrada sigue pending y se reenvía **con los mismos IDs**. `confirmOutbox` exige scope + ID + revisión exactos y guarda `confirmedAt` con el recibo; para compatibilidad conserva `saleId` en las llamadas antiguas (ticket SALE) y acepta `{outboxId,kind:'VOID'}` para una compensación. ACK viejo: `ACK_REVISION_MISMATCH`; scope ajeno/entry inexistente: `OUTBOX_NOT_FOUND`; tipo distinto: `OUTBOX_KIND_MISMATCH`. ACK idéntico repetido: replay; otro receipt para entry ya confirmed: `ACK_RECEIPT_CONFLICT`. Repetir commit no reabre una entry confirmada.

## Ampliación — void atómico aislado

```js
await sandbox.voidSale({
  version: 1, accountId, businessId, epochId,
  voidId: 'void-estable', saleId: 'venta-original',
  deviceId, actorId, voidedAt: '2026-10-08T12:05:00.000Z',
  reasonCode: 'WRONG_ITEM', // CUSTOMER_REQUEST | WRONG_ITEM | DUPLICATE_SALE | OTHER
  lines: [
    { saleOperationId: 'op-venta-1', operationId: 'op-void-1' },
    { saleOperationId: 'op-venta-2', operationId: 'op-void-2' },
  ],
});
```

- Un VOID es un evento compensatorio en `operations` y un outbox independiente `{kind:'VOID', id:voidId}`; no borra, edita ni vuelve a crear el ticket original. No hay store nuevo ni cambio de versión de IndexedDB: los cinco stores ya transaccionan en conjunto. Las filas históricas de outbox sin `kind` se interpretan como `SALE`.
- El caller fija `voidId` y cada `operationId` una vez, reusándolos en reintentos. Cada línea refiere explícitamente una operación SALE original. Deben estar todas y solo las líneas originales; cada operación VOID tiene delta positivo exactamente opuesto, mismo producto/scope/epoch y `saleOperationId` exacto. Hash/revisión calculado fuera de IDB; persistencia resuelve en `oncomplete`.
- `voidedAt` es timestamp UTC canónico y `reasonCode` uno de los enum mostrados; no se guarda texto libre ni datos extra. `deviceId`/`actorId` son IDs sintéticos proporcionados por el caller, no se autentican ni conceden permiso.
- `voidId`/contenido idéntico reintenta sin stock extra y devuelve `replay:true`, incluso si el ACK ya fue confirmado. Mismo ID con contenido distinto: `VOID_ID_CONFLICT`. Un segundo ID distinto para venta ya anulada: `SALE_ALREADY_VOIDED`; una colisión de operationId: `OPERATION_ID_CONFLICT`. La venta repetida después del void sigue siendo replay de la venta inicial.
- Antes de compensar valida ticket, outbox, operaciones y stock almacenado contra baseline + journal completo. Un estado local inconsistente falla cerrado (`INCOMPLETE_COMMIT`) y no compensa. Una sola transacción `strict` agrega operaciones, repone cada producto y encola el void. Dos conexiones racing con IDs distintos solo permiten una anulación; con el mismo ID converge a un replay.
- Venta y void conservan outbox/ACK independientes. `recordOutboxAttempt` y `confirmOutbox` usan el ID del evento y su revisión; void requiere explícitamente `kind:'VOID'` para evitar ACK cruzado. La respuesta externa real y su autoridad siguen fuera del sandbox.
- **Backup v2** incluye `kind` en cada outbox y valida venta + voids, referencias, operaciones compensatorias, unicidad de una anulación por venta y stock reproyectado. `restoreBackup` conserva ACK/outbox/stock sin volver a ejecutar deltas. Se mantiene lectura/restauración de backups **v1 sale-only**: el validador acepta esquema anterior (sin `kind`) y normaliza los registros al importarlos como SALE. Exportaciones nuevas son v2. SHA-256 sigue sin ser firma, cifrado ni autorización.
- Esto no interpreta reversas de pago, caja, fiado, impuestos o efectos contables; no hay UI, backend, envío remoto ni integración checkout. Void en sandbox no autoriza anular un ticket operativo.


**No valida autenticidad del ACK ni accede al servidor.** Futuro dispatcher debe verificar respuesta autenticada de backend append-only/idempotente, membresía/actor/sede y revisión antes de llamar confirm. Dos dispatchers podrían enviar dos veces: este sandbox garantiza exactamente una aplicación local, **no exactly-once en red**.

## Verificación

- **29 pruebas unitarias de contrato + 20 del modelo existente**, 49 aprobadas; sin omisiones nuevas.
- **18 escenarios Chromium aprobados**: commit multilínea, abort tras success de cada store, request `ConstraintError` real, cuota sintética sin fallback, Promise no resuelta antes de commit, replay/ACK tras reload, perfil persistente cerrado/reabierto, respuesta local perdida tras commit, colisiones concurrentes, dos pestañas/últimas unidades, scopes cuenta/sede y cantidades grandes/fraccionarias.
- La primera corrida tuvo 11/12 aprobados: el error nativo de constraint quedaba disfrazado de Error genérico. Se corrigió el servicio y se mantuvo assertion `ConstraintError`; corrida posterior 18/18 aprobada. No se cambió una prueba para aceptar el error equivocado.
- Pruebas usan HTML mínimo interceptado por Playwright y módulos servidos por Vite existente; **no cargan App, no crean BodegaApp/BodegaCloudPull, toda red externa abortada**. Bases sintéticas por test y perfil temporal propio para prueba persistente. Los abortos se inyectan en prototipos IDB solo dentro de páginas de prueba, no hay switches de fallos en servicio entregado.
- Typecheck (`bun run typecheck`) aprobado. Lint de los tres archivos nuevos sin errores ni advertencias. Sin dependencias/lockfile/configuración cambiados.
- En el lote inicial no se repitió build PWA. **Actualización:** el build completo se verificó en la ampliación de recuperación detallada abajo, sin cambiar la configuración PWA. Esto no aprueba integración del sandbox ni despliegue.

## Ampliación — exportación y restauración verificadas

Nuevas interfaces en el mismo servicio:

```js
const backup = await sandbox.exportBackup();
await validateAtomicSaleBackup(backup); // export público, captura una copia privada
const restored = await anotherSandbox.restoreBackup(backup);
```

Formato separado de los backups operativos v2.0:

```json
{
  "format": "PDA-AtomicSale-Sandbox",
  "version": 1,
  "exportedAt": "2026-10-08T12:00:00.000Z",
  "data": { "baselines": [], "sales": [], "operations": [], "stock": [], "outbox": [] },
  "sha256": "64 caracteres hex"
}
```

- Exporta **todos los scopes** y los cinco stores, usando una sola transacción readonly coherente. SHA-256 sobre JSON canónico del cuerpo sin `sha256`, incluido exportedAt; arrays ordenados por scope/ID. Rechaza proyección local inconsistente en lugar de certificar una copia rota.
- Valida antes de escribir: formato/versiones/campos/scopes/claves únicas, baselines y política, contenido/revisión de cada venta, operaciones derivadas exactamente de sus líneas, outbox completo (pending/confirmed, intentos, recibo/timestamps), sin huérfanos ni filas ausentes. Recalcula stock exacto desde baseline + todas las operaciones y exige igualdad con stock respaldado. Un atacante que recalcula checksum no puede hacer pasar un stock contradictorio; **sí puede fabricar un conjunto coherente**: checksum no es firma/autorización.
- Límite **32 MiB UTF-8** y **100.000 filas totales**; validación/export mantienen el snapshot en memoria y recorren todas sus operaciones. No se midió latencia móvil ni escala máxima. Sin streams, compresión ni cifrado automático. No registra payloads ni toca fuentes externas.
- `restoreBackup` valida/captura antes de I/O de escritura. **Solo destino vacío o exactamente idéntico**: carga filas intactas en una transacción `strict` de los cinco stores, sin ejecutar commitSale ni reaplicar deltas. Retorna `{ restored:true,replay:false,rows }`; segunda importación idéntica `{ restored:false,replay:true,rows }`. Un destino con venta/ACK/metadata distintos aborta con `RESTORE_DESTINATION_NOT_EMPTY`, sin borrar/merge, ni reabrir confirmados con backup viejo. exportedAt distinto no cambia identidad del estado si los stores son idénticos.
- No cambia cuenta/sede/época/instalación/actor de los tickets; nombre de base destino debe ser otro sandbox explícito. No interpreta backup operativo ni restaura sesiones/credenciales/cursos de sync.
- `add` directo preserva status pending/confirmed, intentos y recibos; abort en cualquier store deja el destino vacío. Dos conexiones restaurando la misma copia producen una importación y un replay; stock nunca se descuenta dos veces.
- Ejemplo de archivo/mime en el arnés: `atomic-sale-sandbox-v1.json`, `application/json`. El servicio retorna objeto JSON; no añade botones a la aplicación operativa. [Prueba Chromium](../tests/e2e/atomic-sale-backup.e2e.spec.js) descarga un Blob real y restaura con input de archivo, no solo con un objeto sintético.

**Verificación final de ampliación:** 32 pruebas de contrato + 20 del modelo = **52 unitarias**; **37 Chromium** (19 backup + 18 commit), todas aprobadas. Incluye archivo descargado/recarga, estados ACK/pendientes, corrupción con hash recalculado, aborto por cada store, destino más nuevo, varios scopes, concurrent export/commit y doble restore. Typecheck aprobado; lint de archivos tocados sin errores/advertencias. Servicio no importado por código operativo; no cambia checkout/modelo/lockfile/SQL.

### Build PWA pendiente — resultado verificable

Se reejecutó `bun run build` como proceso **BACKGROUND** persistente, con cloud sintético `.invalid`, log y exit status guardados; terminó con **exit 0**, bundles + `dist/sw.js` + runtime Workbox y **45 entradas precache**. Los intentos previos cortados por timeout no eran evidencia de un deadlock permanente. No se modificaron configuración, minificación, skipWaiting, assertions ni dependencias para conseguir el pase; no se atribuye una causa más específica ni una mejora de velocidad sin medición.

Se verificó existencia de los 45 archivos, MIME HTML/JS/manifest y activación manual `SKIP_WAITING` condicionada, no inmediata. [Nueva prueba del build](../tests/e2e/pwa-built-offline.e2e.spec.js) usa servidor estático propio en puerto efímero, registra/activa SW y recarga sin red desde precache, con perfil limpio y toda red externa bloqueada; pantalla de licencia visible antes y después, sin pageerrors. Su primera corrida esperaba una pantalla de bienvenida inexistente para ese perfil: se corrigió el supuesto del escenario, no el control de licencia. **No acredita login real, checkout offline autenticado, RLS ni rollout.** Persisten warnings previos de JSX duplicado/chunks/imports. Build no publicado; sandbox sigue separado del bundle operativo.

## Verificación de void atómico

- **10 escenarios Chromium de void + 20 de backup (incluido restore v1 legacy) aprobados** en la última corrida, 30 en total. La suite previa de venta (**18**) se ejecutó junto con void después del último cambio, también aprobada; total transaccional sale+void: 28. Esto reemplaza los conteos anteriores de la corrida inicial de implementación.
- Comprobación unitaria + modelo: **52 aprobadas**. Typecheck y ESLint de los archivos afectados pasan sin errores/advertencias.
- Escenarios usan Chromium/IndexedDB real, origen local y cuentas/IDs sintéticos. Los fallos son solo del harness, no se exponen switches de inyección en runtime.

## Nota de auditoría operativa

La revisión estática posterior de [checkout](../src/utils/checkoutProcessor.js), [void operativo](../src/utils/voidSaleProcessor.js), [sync stock](../src/utils/syncDelta.js) y [schema cloud](../supabase_cloud_schema.sql) confirma que este servicio permanece desconectado: el checkout persiste venta y productos en escrituras separadas y el DDL local inspeccionado usa documentos JSON, no un ledger SQL de operaciones. La atomicidad de este sandbox no cierra ese gap. Ver detalle, baseline faltante y límites de la auditoría local en [checkpoint stock/concurrencia](CONCURRENCIA-SYNC-Y-STOCK.md#auditoría-de-solo-lectura-del-estado-actual-2026-10-08).

## Límites y siguiente gate

Persistencia probada tras recarga y cierre normal/reapertura del perfil, **no corte eléctrico, kill durante flush o corrupción/disco completo real**. `strict` solicita flush antes de complete cuando el navegador lo soporta; no garantiza contra eliminación/evicción de storage, pérdida de perfil/disco, cuota futura o fallo hardware. No pide persistent storage ni incluye el sandbox en backups operativos existentes. La exportación/restauración explícita del sandbox ya está implementada abajo; cifrado, retención y conexión con respaldos operativos siguen pendientes.

El sandbox ahora modela void local atómico, pero no es void operativo ni maneja pagos/fiado/cartera/caja/cierre, recálculo fiscal, roles, revocación ni grants/RLS. Scope explícito no es autorización. Dos pestañas comparten la base; **PCs offline separadas pueden vender simultáneamente la última unidad**: resolver con política/reservas/backend aprobados.

Integración productiva requiere F0/F3/F4, baseline inequívoco, outbox/ACK backend con colisiones preservadas, transacción de todos los dominios económicos y canary autorizado. No migrar desde snapshots ni activar el servicio en checkout hasta superar esos gates.
