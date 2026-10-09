# Checkpoint — Concurrencia de sync y stock por operaciones

**Fecha:** 2026-10-08. **Alcance:** código local y pruebas herméticas; no migración, importación, registro real, escritura productiva, despliegue, commit ni push.

## 1. Bloque operativo reparado

Antes de editar se reprodujeron **cuatro fallos** en el hook real con servicios de prueba y esperas controladas:

1. Push iniciado en A, autorización demorada, sede cambia a B: documento de A enviado a B.
2. Dos debounces de la misma clave en distintas sedes: el segundo cancelaba al primero.
3. Dos revisiones del mismo documento con respuesta demorada: ambas podían enviarse a la vez; un retry viejo podía sobrescribir la nueva.
4. Pull iniciado con la sede del documento activa, cambio durante lectura: escritura redirigida a la nueva sede.

Reparación en [useCloudSync.js](../src/hooks/useCloudSync.js), [negocioContext.js](../src/utils/negocioContext.js) y [storageService.js](../src/utils/storageService.js):

- Contexto capturado **antes de cualquier await**: doc ID físico, negocio, instalación; copia del payload con `structuredClone` antes de entrar en la cola.
- Debounce por instalación + doc ID físico, no por clave lógica; dos sedes mantienen slots distintos.
- Cola de push serial por cliente, incluidos stock/catálogo, nómina, delta de hoy/días anteriores y ventana diaria. Un retry de una revisión termina antes de que se envíe la siguiente. No hay serialización entre clientes/pestañas ni CAS en servidor.
- `toCloudDocId` conserva cualquier clave física existente; no la envuelve en otro namespace. `storageService` entrega a sync la clave física que efectivamente guardó, incluso cuando cambia la activa durante el I/O.
- Pull lee y escribe claves físicas de la sede del documento sin volver a consultar el router activo después de una espera.
- Catálogo de usuarios de una sede no activa **queda pendiente para reintento**, en lugar de fusionarse en el store de auth de la activa. No añade PINes ni cambia login. El store no representa simultáneamente usuarios de todas las sedes: esa capacidad sigue pendiente.
- Antes de enviar/reintentar y después de recibir respuesta se comprueba continuidad de instalación/motor; un cambio de ID no genera confirmación local del ACK viejo. No puede retirar una petición que el servidor ya recibió.
- Los deltas anteriores ya no son fire-and-forget: se esperan sus resultados. Ventana diaria tiene marca por sede. Se preserva el límite anterior de siete días inspeccionados por ciclo; **no se reparó la posible inanición de días posteriores a los primeros siete**.
- Lint descubrió un `rkey` fuera de alcance en el catch de lectura. Se movió la captura al inicio del método: el fallback conserva el destino aunque IndexedDB falle y la sede cambie.

Interfaces públicas conservadas: `pushCloudSync(key, value, forceUnconditional?)`, `queueCloudSync(key, value)`, `pushLocalSync(key, value)`, `pushPayrollDoc(key, value)`, `pushSalesWindow()` y `syncNow(options?)`. Las claves físicas pasan por la allowlist de su clave base; no se amplió la lista de documentos permitidos ni se cambiaron RLS/roles.

**Límites de esta reparación:** la cola es en memoria; la durabilidad depende de los stores operativos existentes y del reintento periódico. No es un outbox durable por revisión. Serializar todo el cliente evita rollback por retry propio, pero una petición lenta retrasa documentos no relacionados; no se promete aumento de rendimiento. Tampoco resuelve cambio de cuenta bajo la misma instalación, dos pestañas, clones, clocks divergentes, permisos de sede server-side, colisiones de tickets o concurrencia entre commit local y pull. El gate productivo continúa cerrado.

## 2. Hallazgo matemático: los snapshots no contienen procedencia de efectos

El helper actual [applyStockMapDelta](../src/utils/syncDelta.js) suma `stockNuevoFuente - stockAnteriorFuente`. Esto **no garantiza convergencia** si el snapshot remoto ya incorpora cambios recibidos de otra caja.

Contraejemplo reproducible con ambas fuentes conocidas en 10:

| Paso | A | B | Información |
|---|---:|---:|---|
| Baseline | 10 | 10 | Ambos conocen stock 10 de la otra fuente |
| Venta local | 8 | 7 | A vende 2; B vende 3 |
| B recibe snapshot 8 de A | 8 | 5 | `7 + (8 - 10) = 5` |
| A recibe snapshot 5 de B | **3** | 5 | `8 + (5 - 10) = 3`; vuelve a descontar su propia venta |

Existencia económica esperada: **10 − 2 − 3 = 5**. El problema no se arregla con un hash, timestamp mayor, ACK ordenado o cuarentena de schema. La prueba anterior de dos cajas solo comprobaba un delta independiente; no cubría el eco de efectos ya fusionados.

[La prueba del contraejemplo](../tests/stockOperationModel.test.js) describe el comportamiento defectuoso explícitamente. **No es una assertion debilitada para declarar stock arreglado.** El helper operativo no se cambió: no hay datos/procedencia suficientes para reconstruir automáticamente la aportación independiente de cada PC.

## 3. Modelo de referencia ejecutable — sin activar en producción

[stockOperationModel.js](../src/utils/stockOperationModel.js) expone:

```js
projectStockOperations(baseline, operations) => {
  version, businessId, epochId, stockUnits,
  appliedOperationIds, voidedSaleIds, replays,
  conflicts, pending, rejected, complete
}
```

Baseline requerido (aprobación es responsabilidad del futuro caller/servidor, no del modelo):

```json
{"version":1,"businessId":"sede-ejemplo","epochId":"epoca-aprobada","stockUnits":{"producto":"10000000"}}
```

Contrato mínimo de operación:

```json
{"version":1,"businessId":"sede-ejemplo","epochId":"epoca-aprobada","operationId":"op-unica","deviceId":"instalacion","actorId":"actor","productId":"producto","kind":"SALE","deltaUnits":"-2000000"}
```

- `version: 1`; campos de identidad ASCII de 1–128 caracteres (`A-Za-z0-9_.:-`). No contienen autoridad: device/actor deben validarse en backend.
- Cantidad en **micro-unidades**, 1.000.000 por unidad; string entero decimal canónico, hasta 40 dígitos y signo opcional. Sin floats, exponentes, ceros iniciales ni `-0`; operación cero rechazada. Cálculo con `BigInt`, salida JSON con strings.
- `SALE` negativa; `RESTOCK` positiva; `ADJUSTMENT` cualquiera no cero; `VOID` positiva + `saleOperationId` obligatorio.
- VOID debe referir una SALE aceptada en la misma sede/época/producto, con compensación exactamente opuesta. Llegada anticipada queda pendiente; varios IDs de VOID válidos de una venta compensan **una vez**, no una vez por comando.
- Mismo ID/payload canónico: replay sin efecto adicional. Mismo ID/contenido distinto: conflicto; ninguna variante se elige por fecha. Variante inválida tampoco permite aceptar silenciosamente el hermano válido. Un VOID de una venta en conflicto queda pendiente.
- Sede/época ajena rechazada; producto desconocido pendiente; snapshot no es operación. No inventa baseline ni stock cero para un producto ausente.
- No elimina evidencia: resultado solo proyecta cantidades y devuelve IDs/motivos. El caller futuro debe conservar todos los originales y variantes en un journal privado durable.
- Recalcular siempre desde baseline + **conjunto completo**; no usar el resultado de ayer como baseline con los mismos eventos. Si llega una colisión tarde, la proyección provisional anterior deja de ser válida y se requiere reconciliación; `complete` no demuestra autorización ni irrevocabilidad.

### Invariantes y prueba

Para producto p, con conjunto de operaciones aceptadas U y ventas anuladas V:

`stock(p) = baseline(p) + Σ delta(op,p), op ∈ U no VOID − Σ delta(venta,p), venta ∈ V`.

Suma de enteros exactos: asociativa y conmutativa. Dedupe por ID/contenido: idempotente. V es un conjunto de IDs de venta, por lo que varias entregas/comandos de VOID no multiplican la compensación. Sede/época forman el dominio de la proyección, no se adopta la sede activa.

**20 pruebas:** 120 permutaciones de cinco eventos y 600 prefijos con replays, VOID adelantado y duplicado por varias cajas, cantidades por encima del safe integer de Number, colisiones, claves en orden distinto, sedes/épocas ajenas, baseline inválido y el contraejemplo actual. Esto prueba el modelo puro, **no atomicidad de IndexedDB, stock físico, UI de anulación, backend o reglas de negocio completas**.

### Simulador de entrega entre réplicas — solo diagnóstico

[stockSyncSimulator.js](../src/utils/stockSyncSimulator.js) añade `simulateStockSync({ baseline, replicas })` sobre el modelo puro anterior. Cada réplica declara sus eventos efectivamente recibidos; el simulador proyecta cada diario desde el mismo baseline y calcula la unión de entregas desde ese baseline. Reporta proyecciones por réplica, convergencia, operaciones globales pendientes/conflictivas/rechazadas y productos con stock negativo.

No es un transporte ni implementa merge, no genera IDs/eventos, no crea baseline, no acepta snapshots como autoridad, no sincroniza datos ni escribe IndexedDB. Una «entrega» es únicamente un objeto operación que el escenario provee. Distingue convergencia (proyecciones iguales) de `complete` (sin eventos pendientes/incorrectos) y de sobreventa; una proyección sintácticamente completa puede quedar negativa cuando dos equipos vendieron offline el mismo último stock. No promete prevenir ni reparar eso automáticamente.

[Las siete pruebas](../tests/stockSyncSimulator.test.js) cubren diarios convergentes con retries/orden distinto, entrega parcial divergente, colisión de ID en ambas precedencias, VOID adelantado, oversell de última unidad, snapshots inválidos y límites de input. Son escenarios sintéticos y no certifican una nube o política de negocio.

### Decisión temporal de política offline — pendiente de aprobación operativa

**Decisión de diseño para avanzar rápido (2026-10-08): venta offline provisional, sin reserva distribuida.** Si la caja está desconectada, puede continuar usando la existencia local como indicativa y registrar la venta como evento pendiente/provisional. No se promete disponibilidad global: otra caja puede vender las mismas unidades. Al reconectar, la unión de eventos identifica sobreventa/conflicto; el stock puede quedar negativo y requiere conciliación. No se rebajan, borran ni sustituyen eventos para forzar que cuadre el snapshot.

Racional: no detener una venta legítima por depender de red ni introducir ahora coordinación, leases o cupos offline que exigen asignación/revocación segura por backend. Es la opción de menor alcance técnico y permite avanzar con escenarios/contratos; **acepta explícitamente riesgo de vender de más**. No es una recomendación contable/legal, ni se considera aprobación del dueño.

Reglas provisionales para el diseño y pruebas:

1. El registro local debe conservar IDs estables, ticket y cantidad por línea como evidencia; mismo ID/contenido es replay, mismo ID/contenido distinto se preserva como conflicto y no se resuelve por timestamp/última escritura.
2. Un snapshot es una vista, nunca se convierte en evento ni se suma como delta si su procedencia/inclusión no está probada. Hasta disponer de un journal operativo con ACK append-only, **no activar un nuevo aplicador de eventos ni afirmar que la sincronización productiva de stock quedó corregida**.
3. Tras reconexión, primero mostrar/registrar diferencia y conservar todas las ventas. Saldo negativo, ID duplicado divergente o baseline incierto queda en estado de conciliación; no descartar venta ni anulación automáticamente. El ajuste requiere actor autorizado y motivo auditable.
4. Esta decisión no bloquea checkout actual ni cambia su comportamiento: el sync productivo continúa sujeto a sus límites conocidos. El simulador valida hipótesis, pero no implementa ni impone esta política.

**Lo que se difiere:** reserva/cupo por caja, exclusividad temporal, venta offline deshabilitada, límites por categoría/producto y aprobación explícita de una venta que producirá saldo negativo. Revisar decisión antes de cualquier canary operativo; el dueño puede elegir cambiarla por cupos o solo-online. Ninguna de estas reglas habilita despliegue/integración con el código de hoy.

### Prerrequisito transversal: autorización de arranque offline (bloqueante)

Contrato técnico propuesto y estados de aceptación: [contrato de autorización offline](CONTRATO-AUTORIZACION-OFFLINE.md). Es diseño únicamente; aún no hay token, emisor ni verificador implementados.

La política de «venta offline provisional» anterior describe comportamiento de negocio deseado, **no está implementada en el checkout**. La captura del dueño muestra Inventario visible en una sesión abierta aunque falle CloudSync; por tanto, no se afirma un bloqueo offline general. Por separado, la ruta de CloudGate consulta membresía en cada arranque y una respuesta `unavailable` puede bloquear un arranque en frío; ese caso no aparece en la captura y falta reproducirlo en la PWA instalada. Evidencia y separación de pruebas en [ESTADO-OFFLINE-POS.md](ESTADO-OFFLINE-POS.md); contrato, todavía sin implementar, en [autorización offline](CONTRATO-AUTORIZACION-OFFLINE.md).

Antes de declarar usable el POS sin red, diseñar e implementar un permiso offline verificable, emitido por servidor, ligado a instalación/cuenta/dispositivo/sedes y con vigencia máxima de **24 horas**; validar firma, identidad, expiración y defensa frente a retroceso del reloj. Al reconectar hay que revalidar membresía/revocación. Un permiso vencido o dispositivo revocado deja las operaciones pendientes preservadas y bloqueadas para revisión individual del dueño según **D9**; nunca se aplican ni descartan automáticamente. No sustituir esto por `localStorage`, `pda_account_linked`, `pda_pro_activated` ni `navigator.onLine`.

**Separación de gates:** desbloquear el arranque con autorización segura solo permite llegar al POS. No resuelve el commit local atómico, la outbox durable, la idempotencia/ACK del backend, el doble descuento por eco de snapshots, la sobreventa multi-PC ni la reconciliación/baseline; esos gates de stock/sync siguen abiertos y requieren sus propias pruebas en PWA instalada/build candidata. El test del shell PWA cacheado tampoco acredita checkout offline autenticado.

### Manejo temporal simple de incidencias — borrador por auditar

Para avanzar sin construir ahora reservas, workflows ni un centro de conciliación, el manejo provisional es **detectar, conservar y escalar manualmente**. No se altera el POS ni se impone esta política por código.

1. Tras sincronizar el journal disponible, generar una lista de excepciones por sede/producto: saldo proyectado negativo, operación duplicada con contenido distinto, VOID pendiente/referente ausente, producto/época desconocidos y diferencia contra conteo físico.
2. Conservar ticket/operaciones originales y sus IDs. No editar ni borrar eventos, elegir variante por fecha, ni convertir el snapshot reciente en una corrección automática.
3. Marcar el caso como `requiere conciliación`; mientras no se defina autorización, no emitir ajuste automático ni declarar que el saldo proyectado equivale al físico. El responsable consulta evidencia y verifica inventario según el procedimiento vigente del negocio.
4. Registrar la decisión humana fuera de este simulador con responsable, fecha, evidencia, motivo y ajuste autorizado. El modelo actual no implementa ni persiste este registro; es una pauta para el futuro diseño, no una instrucción contable operativa.
5. Volver a proyectar desde el mismo baseline aprobado y el conjunto completo de eventos luego de una resolución autorizada. No fijar un baseline nuevo a partir del snapshot conflictivo sin auditar qué ventas ya contiene.

**Auditoría requerida antes de canary o adopción operativa:** confirmar con dueño/operaciones quién puede conciliar y en qué plazo; cómo se cuenta físicamente; tratamiento de pagos/caja/fiado y reversas; política sobre vender cuando ya hay saldo negativo; retención y protección de tickets/datos personales; baseline/corte aprobado y prueba de no doble contabilización; trazabilidad inmutable de decisiones; manejo de instalaciones robadas/revocadas y terminales que no reconectan; responsabilidades contables/fiscales; y plan de soporte/reversión. Revisar también conflictos tardíos: una variante nueva puede invalidar proyecciones previas. Hasta cerrar esos puntos no activar journal/aplicador en producción ni presentar saldos del simulador como inventario autoritativo.

El simulador existente solo expone divergencia, conflicto y oversell; **no genera esta cola de incidencias, no tiene interfaz de operador y no escribe registros de auditoría**. El [CLI de informe](../scripts/reconcile-stock-report.mjs) imprime el diagnóstico por terminal, con un ejemplo sintético por defecto o una entrada JSON explícita; no abre la base operativa, no persiste nada y marca la sobreventa/cualquier proyección incompleta con código de salida no-cero. El operador aún debe revisar las filas y acordar la conciliación; el CLI no genera cola ni modifica inventario.

```sh
node scripts/reconcile-stock-report.mjs
node scripts/reconcile-stock-report.mjs --input escenario-sintetico.json --format json
```

Formato de entrada: `{ "baseline": <baseline aprobado para prueba>, "replicas": [{ "replicaId": "caja-a", "deliveries": [<operaciones>] }] }`. Usar solo fixtures/datos autorizados; esta primera versión no carga SQLite, IndexedDB, backups ni cloud. Esta nota documenta un borrador de flujo, no certifica un proceso manual ya aprobado.

### Medición local (no comparación de velocidad)

Node **v24.13.0**, misma máquina, operación sintética de un producto/50.000 ventas/3 instalaciones. Cada medición comprobó stock exacto, 50.000 IDs únicos y `complete: true`.

| Entrada | Tiempo | Replays | Heap observado al terminar |
|---|---:|---:|---:|
| 50.000 operaciones | 719,95 ms | 0 | 66 MiB |
| 50.000 en orden inverso | 764,68 ms | 0 | 87 MiB |
| 100.000 filas, 50.000 únicas duplicadas | 1.063,95 ms | 50.000 | 152 MiB |

Una corrida por escenario, sin GC forzado; heap no es peak ni consumo incremental. No acredita rendimiento móvil ni del navegador con IDB/red. El modelo recorre el conjunto completo y conserva grupos en memoria; escalar requerirá checkpoints seguros sin descartar variantes pendientes.

### Auditoría de solo lectura del estado actual (2026-10-08)

Revisé los entry points locales y los DDL versionados presentes en el checkout. **No se conectó a Supabase, no se ejecutó SQL, no se leyeron/escribieron filas de negocio y no se modificó POS, sync ni esquema.** Alcance de lectura: [checkoutProcessor.js](../src/utils/checkoutProcessor.js), [voidSaleProcessor.js](../src/utils/voidSaleProcessor.js), [storageService.js](../src/utils/storageService.js), [useCloudSync.js](../src/hooks/useCloudSync.js), [useMonitorSync.js](../src/hooks/useMonitorSync.js), [syncDelta.js](../src/utils/syncDelta.js), [schema canónico](../supabase_cloud_schema.sql), [RLS de sync](../supabase/migrations/001_device_own_row_rls.sql).

Hallazgos verificables en ese código:

- **Checkout local es multi-escritura, no una transacción económica única.** Dentro de `pos_write_lock`, asigna `crypto.randomUUID()` al ticket; primero persiste la venta en `bodega_sales_v1`, luego descuenta existencia y persiste `bodega_products_v1`, luego actualiza cartera/ledger cuando corresponda. Los registros del lock documentan exclusión local, pero no atomicidad durable entre esos stores ni CAS entre dispositivos. Un crash entre escrituras puede dejar ticket/stock/cartera parcialmente aplicados.
- La política local actual lee `allow_negative_stock`. Si está desactivada, limita el stock persistido a cero (`Math.max(0,newStock)`), por lo que una venta mayor al disponible no produce una cantidad negativa visible que cuantifique el faltante. Si está activada, registra el negativo. Esto no es la decisión temporal provisional documentada arriba, ni el nuevo simulador puede cambiarlo: **la política discutida aún no está implementada en el checkout**.
- **Void operativo tampoco es una transacción de todos los stores.** Relee el ticket bajo el mismo lock, marca la venta `ANULADA`, repone líneas del stock y luego guarda ventas/clientes/productos en llamadas separadas; además revierte ledger/Cashea donde aplique. El ticket conserva su forma histórica, pero no se deriva un journal inmutable de reversa para sincronizar; no hay transacción atómica con la venta original y el resto de impactos.
- `storageService` guarda cada clave lógica separadamente en localforage/IndexedDB namespaceada por sede y encola sync posteriormente. La atomicidad de una escritura individual no abarca ventas + productos + clientes + ledger; fallback/cuota también necesita revisión para una futura transacción POS.
- **Cloud no es un ledger de inventario.** `sync_documents` usa documentos JSON (`device_id,collection,doc_id`) con `data/payload/updated_at` y unicidad por dispositivo/colección/clave. RLS del checkout versionado permite INSERT/UPDATE de documentos propios; lectura multi-dispositivo por cuenta se añade por separado. En el DDL inspeccionado no aparece una tabla SQL de operaciones de stock ni constraint global `(cuenta,sede,época,operationId)`.
- El envío de ventas es idempotente solo a nivel de documento/merge: `bodega_sales_delta_YYYY-MM-DD` contiene los tickets del día del dispositivo; receptor fusiona por `sale.id`. Ticket nuevo obtiene UUID, pero ese ID no evita que documento completo `bodega_stock_v1` se sobreescriba con snapshot: `applyStockMapDelta` calcula `remoto actual - último remoto visto de ese device` y suma al local. No registra procedencia por operación ni puede saber si snapshot remoto ya absorbió otra caja; contraejemplo de la sección 2 sigue vigente.
- Las ventas remotas duplicadas con mismo ID se resuelven mediante estado terminal ANULADA y, de otro modo, timestamp más reciente (`mergeSales`). No se compara contenido económico completo para preservar una colisión del mismo ID. El timestamp se usa para escoger una versión del ticket; no constituye idempotencia contable ni ACK durable por evento.
- El baseline histórico **no se puede inferir con seguridad desde el catálogo actual ni un backup**: stock pudo ser corregido/recibido/importado, snapshots se han mezclado y el historial sincronizado de ventas es una ventana podada. El código local inspeccionado no registra por operación qué tickets ya están reflejados en cada conteo físico. Por tanto no sumes el journal de modelo al `bodega_products_v1` actual sin un corte/epoch aprobado, o se pueden duplicar descuentos.

**Comparación con lo construido:** el modelo puro, simulador CLI y `PDA-AtomicSale-Sandbox-*` prueban matemática y atomicidad sintética en un único origen; **ninguno es llamado desde `processSaleTransaction`, `processVoidSale`, `storageService` ni `useCloudSync`**. No prueban esquema/RLS remoto real ni pueden reparar los snapshots actuales. La prueba del CLI parte de baseline/eventos explícitos; no es un reporte conectado al catálogo operativo. Ningún cambio de esta auditoría altera ese estado.

**Conclusión de salida:** aún no listo para producción. Bloqueador inmediato: baseline/corte por sede/producto que distinga conteo real de stock ya representado por tickets; sigue el diseño mínimo de almacenamiento transaccional/idempotente en el backend y la transición compatible desde snapshots. Luego hay que integrar ticket + stock + void + efectos financieros en persistencia local, probar recuperación multi-equipo con puntos de falla y ejecutar canary autorizado. Dado que checkout hoy aplana a cero un faltante cuando `allow_negative_stock=false`, el dueño también debe decidir si durante el periodo previo se conserva el comportamiento actual, se permite venta negativa visible o se pausa venta de ese SKU al agotar; no se cambia esa regla silenciosamente.

Para poder seguir sin complicar de más: acordar con dueño/operación un inventario físico de corte por sede, con fecha/actor, y congelar la lista de documentos/cajas incluidos. Usarlo solo para un **reporte en sombra**; reconciliar contra historial/backups de forma humana y confirmar resultados antes de tratar ese corte como baseline de una época nueva. El primer piloto debe observar/reconciliar, no escribir stock ni activar el journal. Revisar que DDL aplicado en Supabase coincida: esta auditoría inspecciona archivos locales, no el proyecto remoto.

## 4. Contrato necesario para integrar — siguiente trabajo difícil

**Ampliación local (2026-10-08):** el [commit atómico aislado](COMMIT-ATOMICO-VENTA-SANDBOX.md) ya guarda venta, operaciones SALE, stock y outbox en una transacción IndexedDB nativa; replay/rollback/dos pestañas y perfil persistente probados. **No está conectado al checkout ni convierte datos existentes.** Backend, todos los dominios económicos, anulación y baseline productivo siguen siendo gates, no se consideran resueltos por el sandbox.

1. **Época/baseline por sede y producto, aprobado tras F0/F3/F4.** No generar eventos desde snapshots históricos ni descontar otra vez ventas que ya están incluidas en baseline. Fecha/timestamp no demuestra inclusión; se necesita relación explícita con IDs de operaciones y corte aprobado.
2. **Commit atómico de ticket + operaciones de líneas + outbox + proyección.** Un fallo no puede dejar venta sin stock ni stock sin venta. `localforage.setItem` sobre claves separadas no da esa atomicidad; diseñar transacción IndexedDB real sin interferir con datos existentes. Una línea/producto necesita operation ID estable incluso con reintentos de checkout.
3. **Backend append-only y unicidad `(cuenta, sede, época, operationId)`.** Mismo ID/contenido: ACK idempotente; contenido distinto: preservar variante/cuarentena y no sobrescribir. Auth/membresía/sede/rol/revocación/ventana offline del actor evaluados en servidor. Hash no es autorización.
4. **Anulación atómica/idempotente por ticket completo.** Todas las líneas compensan una vez; caja/cartera/pagos mantienen eventos relacionados. Cierre no se reabre. Modelo de un producto no resuelve las transacciones multilateralmente.
5. **Sin stock negativo involuntario online:** si se exige límite de existencia, dos reservas deben validarse serialmente en servidor. Dos cajas offline no pueden garantizar que no vendan la última unidad sin reservas previas; aplicar decisión aprobada, no inventar sincronización que lo garantice.
6. **Migración compatible y canary.** No mezclar eventos nuevos con deltas de snapshots, ni correr dos motores aplicando el mismo efecto. Lectura sombra/reportes primero; rollback debe preservar eventos confirmados. Ninguna migración productiva hasta backups/restauración aislada y aprobación de baseline/destino.
7. **Ensayo adversarial de extremo a extremo:** caída en cada punto de commit/ACK, void antes de venta, mismo ID distinto contenido, dos pestañas, clocks divergentes, 3 PCs offline, revocación entre retries, replay tras restore y UI por sede. Backend simulado no certifica SQL/RLS/Realtime real.

## 5. Siguiente orden de trabajo

Checkpoint local: la regresión `cloudSyncConcurrency.test.jsx` cubre pausa por `unavailable` → ningún push offline → evento `online` → revalidación → push disponible. **72 tests focalizados pasan; no se contactó la nube real.** Validar ahora el ciclo en PWA; no relajar autorización. El permiso firmado CloudGate de 24 h es un trabajo aparte y sigue sin implementación.

1. En paralelo, obtener baseline/corte aprobado y cerrar respaldo/restauración F0 y evidencia F3/F4 antes de usar datos reales.
2. Integrar por separado al checkout operativo la transacción local de venta/void/efectos y outbox durable; el sandbox existente no se conecta solo. Verificar recuperación tras caída y reintentos sin efectos parciales.
3. Implementar backend append-only/idempotente, transición en sombra sin doble aplicación snapshots/eventos y pruebas adversariales multi-PC; canary solo tras autorización explícita.

Cada ítem tiene criterio de salida; pasar CloudGate solo habilita entrada autorizada, no prueba stock correcto. No iniciar SQL/migración/producción mientras sigan cerrados F0 y el baseline.

### Cuándo conviene hacer commit

El checkpoint documental puede versionarse separado ahora, tras revisión de las rutas concretas. Los cambios de código se deben dividir por resultado verificable (permiso/CloudGate, luego integración atómica del checkout, luego backend/transición), cada uno con pruebas focalizadas. En este checkout hay modificaciones y archivos nuevos ajenos; revisar `git status`, confirmar ownership y stagear solo las rutas propias, nunca todo el árbol. No se hizo commit como parte de esta actualización.

## 6. Verificación y límites de herramientas


- Regresión inicial: **219 tests en 12 archivos aprobados**. Después del repair final del fallback se reejecutaron hooks/router: **58 aprobados**, incluyendo tres pruebas nuevas. Modelo: **20 aprobados**. Conjunto final cubierto: **242 pruebas únicas en 13 archivos**; no implica suite global completa.
- E2E focalizados concurrency y journal/backup: **2 aprobados**, repetidos sobre el hook final: **2 aprobados en 2,8 min**. Tras conservar semántica Promise/rechazo en las interfaces públicas, se reejecutaron concurrency/delta/Fase3/Fase6: **69 aprobados**. Modelo final: 20 aprobados; typecheck/lint final repetidos sin errores. Multidispositivo ampliado: la primera corrida agotó 240 s después de dos escenarios aprobados, sin resultado global. Los cuatro restantes se ejecutaron aparte: **4 aprobados**, 2,1 min. No presentar la corrida truncada como suite aprobada.
- Typecheck final con Node aprobado; `bun run typecheck` agotó 60 s y el runner Vitest de pool predeterminado agotó 60 s sin ejecutar pruebas. Se usaron los mismos paquetes locales, Vitest threads/1 worker, sin cambiar assertions/omitir tests.
- Lint focalizado: **cero errores**, 32 advertencias combinadas (28 bloque sync/storage/concurrency, cuatro en hooks existentes). El modelo nuevo y sus pruebas no tienen warnings. No se añadieron suppressions.
- Build intermedio Vite/PWA aprobado con endpoint cloud sintético (45 precache entries, SW generado). **Build final no certificado:** tras el último cambio del hook, dos intentos agotaron 180/240 s; el log llega a bundles generados, pero no a PWA completada y falta `dist/sw.js`. No usar el resultado intermedio como verificación de la versión final, ni publicar el directorio parcial. Mantiene warnings de chunks/imports/JSX existentes. No publicado. **Ampliación posterior:** el build persistente completó exit 0 y SW/45 precache/offline verificados sin alterar configuración, según [checkpoint de recuperación](COMMIT-ATOMICO-VENTA-SANDBOX.md#build-pwa-pendiente--resultado-verificable). Los timeouts anteriores siguen registrados, no se presentan como pases.
- Agent-browser: open y doctor agotaron sus límites; se usó Playwright ya instalado para Chromium. Preview local existente en loopback 4174, cloud `.invalid`; no login real ni producción. Ninguna herramienta/preview es prueba del stock operativo corregido.

El [Plan maestro](PLAN-MAESTRO-RECUPERACION-SYNC-IDENTIDAD.md) conserva los gates de producción; este checkpoint no los sustituye.
