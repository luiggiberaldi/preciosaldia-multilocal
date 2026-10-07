# PLAN — Nómina en PreciosAlDía Pro (v1)

> Para auditar antes de implementar. Nada de esto está codeado.
> Basado en la auditoría de DondeJuancho (2026-10-03): allá el modelo es **consumos del empleado**
> (retira mercancía a precio de venta, se descuenta del sueldo), no "ventas a su nombre".

## 1. Concepto v1

- **Empleados** con sueldo en **USD o Bs** y **frecuencia de pago configurable: semanal, quincenal o mensual**.
- **Consumos**: el empleado retira productos → se valorizan a precio de venta → descuentan inventario
  → se restan de su sueldo del período.
- **Liquidación**: `neto = sueldo del período − Σ consumos aplicados no liquidados`, genera egreso de caja.
- **Zona de Nómina**: sección nueva de la app, **visible solo para el dueño**. Es el centro de control:
  empleados, consumos, resúmenes, liquidaciones y anulaciones viven ahí. Nadie más la ve.
- **Extra**: el ticket guarda `vendedorId` (quién vendió) — hoy Pro no lo registra; deja la base para
  comisiones después. No es parte del descuento (flujos separados).

## 2. Frecuencias de pago

Cada empleado tiene `frecuenciaPago: 'semanal' | 'quincenal' | 'mensual'`.

| Frecuencia | Período | Key ejemplo |
|---|---|---|
| Semanal | lunes 00:00 → lunes 00:00 (America/Caracas) | `2026-W40` |
| Quincenal | días 1–15 / 16–fin de mes | `2026-10-Q1`, `2026-10-Q2` |
| Mensual | día 1 → fin de mes | `2026-10` |

- Funciones puras y deterministas: `periodKeyFor(fecha, frecuencia)`, `periodBounds(periodKey)`,
  siempre en **America/Caracas**.
- **Cambio de frecuencia a mitad de período**: el período abierto se respeta con la frecuencia vieja
  (se liquida y cierra); la nueva frecuencia aplica desde el próximo período. Sin migraciones de datos.
- El `salarioMonto` es siempre **por período de su frecuencia** (si es mensual, el monto es el sueldo del mes).
- **Sin backdate en v1**: el consumo se registra con timestamp actual, en el período corriente.
  No se pueden cargar consumos a períodos ya cerrados.

## 3. Modelo de datos (todo vía `sync_documents`, sin migración SQL)

### `bodega_employees_v1` — catálogo por negocio (array, LWW)
`{id, nombre, cedula, cargo, userId?, salarioMonto, salarioMoneda: 'USD'|'Bs',`
`frecuenciaPago, limiteConsumoPorc (default 100), activo, fechaIngreso, deactivatedAt/By}`

### `bodega_payroll_consumo_<id>` — doc individual, append-only (NO array)
`{id, employeeId, employeeNombre, periodoKey, timestamp, status: APPLIED|VOIDED,`
`items: [{productId, nombre, qty, priceUsd, costUsd}], totalUsd, totalBs, tasaBsPorUsd, tasaFuente,`
`inventoryOperationId, settlementId?, voidedAt/By/Reason?, actor, deviceId, idempotencyKey}`

> Por qué individual y no array (como DondeJuancho): dos cajas escribiendo un array con LWW
> se pisan y **pierden consumos**. Docs individuales = cero pérdida por concurrencia.
>
> ⚠️ CRÍTICO (verificación 2026-10-03): los docs NO viajan automáticamente. Las keys deben
> registrarse en la allowlist `SYNC_VALIDATORS` (`src/services/supervisorContracts.js`); sin eso,
> `pushCloudSync` rechaza ('Clave no allowlisted') y los otros equipos ignoran los docs en silencio.
> Las keys dinámicas (`bodega_payroll_consumo_<id>`, `bodega_payroll_periodo_<...>`,
> `bodega_payroll_liquidacion_<id>`) necesitan patrón por prefijo como `isSalesDeltaKey`
> (`isSupervisorSyncKey`, supervisorContracts.js:76-80) + función de push dedicada con upsert
> directo como `pushSingleSalesDelta` (useCloudSync.js:258-278). Agregar validadores en
> `STORE_SCHEMAS` (useCloudSync.js:562, DATA-001). El namespacing `nb_<negocioId>:` vía
> `toCloudDocId()` sí es automático.

### `bodega_payroll_periodo_<employeeId>_<periodKey>` — doc individual idempotente
`{id, employeeId, periodKey, frecuencia, inicioISO, finISO,`
`salarioSnapshot: {monto, moneda}, status: ABIERTO|LIQUIDADO, liquidacionId?, createdAt, updatedAt}`

> **Snapshot salarial**: el sueldo se congela al primer movimiento del período. Si el sueldo cambia
> a mitad de período, lo ya calculado no se corrompe; el nuevo rige el próximo período.
> La UI muestra "sueldo del período: $X (congelado el <fecha>)".

### `bodega_payroll_liquidacion_<id>` — doc individual
`{id, employeeId, periodoKey, salarioOriginal: {monto, moneda}, salarioUsd, totalConsumosUsd,`
`netoUsd, netoBs, tasaBcvLiquidacion, consumptionIds[], payments[],`
`status: PENDING|PAID|VOIDED, cashMovementId?, actor, deviceId, createdAt,`
`idempotencyKey: 'settle_<employeeId>_<periodKey>'}`

### Ticket de venta
Agregar `vendedorId` + `vendedorNombre` (snapshot) donde nace el sale
(`processSaleTransaction`, `src/utils/checkoutProcessor.js:208`), usando el patrón existente
`useAuthStore.getState().usuarioActivo` (líneas 336, 380; sesión `{id, nombre, rol}`).
Tickets viejos = "sin asignar". No rompe el merge aditivo.

## 4. Flujos

### 4.1 Zona de Nómina (solo dueño)
Nueva sección en la navegación, visible **únicamente con rol dueño**: agregar `'nomina'` a
`TABS_DUENO` (`src/utils/roles.js`, mismo patrón que `'supervision'`/Control; usar `isOwner()`,
**no** `hasAdminAccess` que incluye al admin). El gating es automático (`visibleTabIds()` +
redirect en `App.jsx:387`). Nota: el dueño ya tiene 7 tabs en el bottom nav; con nómina son 8 —
revisar visualmente en pantalla angosta. El dueño con varias sedes ve un selector de sede
(reutilizar `NegocioSelector.jsx`); los datos son por negocio.
Desde aquí se lleva todo el control:
1. **Empleados**: crear, editar sueldo/frecuencia/límite, desactivar. (Solo dueño; ni el admin
   gestiona empleados.)
2. **Registrar consumo** para cualquier empleado (selector + productos).
3. **Historial de consumos** del período: ver y **anular** (ver 4.4).
4. **Resumen por empleado**: sueldo del período (con "congelado el <fecha>" si aplica; si el
   sueldo actual difiere del snapshot se muestran ambos: "actual $Y — rige próximo período"),
   consumido, barra de % con semáforo, neto a la fecha. Empleado sin movimientos: "sin movimientos
   este período" con el sueldo vigente de su frecuencia.
5. **Liquidar** período (ver 4.5).

### 4.2 Registrar consumo (fuera de la zona)
- **Dueño**: desde la Zona de Nómina, cualquier empleado de cualquier sede.
- **Admin**: desde el POS (botón en el header, como DondeJuancho), empleados de **su sede**.
- **Cajero**: no puede registrar consumos (decisión de Luigi 2026-10-03).
- Validaciones: empleado activo **y del negocio activo**, stock suficiente, items con precio
  de venta > 0, límite % del sueldo. Si el sueldo es en Bs, el límite se valida convirtiendo a USD
  con la tasa BCV vigente al registrar (queda guardada en el consumo). Excedente del límite →
  override solo dueño/admin, **auditado** (el dueño lo ve en la zona).
- Descuenta inventario **con el helper compartido nuevo** `adjustStockForItems(items, signo)`
  (`src/utils/stockAdjust.js`: `withLock('pos_write_lock')` + re-lectura fresca + redondeo de granel
  `adjustStockValue` + respeto a `allow_negative_stock`, mismas reglas del inline de
  `processSaleTransaction`/`voidSaleProcessor`). Decisión: ventas y anulaciones conservan su código
  inline verificado (cero riesgo de regresión); el helper lo usa nómina. Migrarlos queda opcional.
  El `costUsd` de cada item se guarda para futuros reportes de merma; el descuento al sueldo es
  siempre a **precio de venta**. Idempotency key contra doble tap.

### 4.3 Resumen
En la Zona de Nómina (dueño). Fuera del dueño, nadie ve resúmenes ni saldos.

### 4.4 Anular consumo — SOLO EL DUEÑO
- Solo desde la Zona de Nómina, solo si el consumo está APPLIED y sin `settlementId`
  (liquidado = intocable).
- Devuelve stock por operación DEVOLUCIÓN. VOIDED es terminal. Todo anulado queda en auditoría
  (quién, cuándo, motivo).

### 4.5 Liquidar — SOLO EL DUEÑO (vive en la zona)
Valida: neto ≥ 0 y tasa BCV > 0 (si hay conversión). Genera el egreso como `GASTO_INTERNO`
categoría `'personal'` dentro de `bodega_sales_v1`
(`{tipo:'GASTO_INTERNO', category:'personal', description:'Pago nómina: <nombre> <periodo>', totalUsd:-neto, afectaCaja:true}`,
patrón `useGastosInternos.js:52-78`; como `payrollService` es módulo plano —no hook— escribe vía
`storageService`, no llamando al hook). No se exige "caja abierta": ese concepto no existe en Pro
(verificación 2026-10-03; heredado de DondeJuancho, descartado).
Marca consumos con `settlementId`, estado PAID. Idempotente (`settle_<employeeId>_<periodKey>`). **Un solo pago por liquidación en v1**
(`payments[]` lleva un elemento; el array queda para futuros pagos parciales).
Al liquidar con éxito, el modal ofrece **imprimir/compartir el recibo de pago** (4.6).
Reimprimible desde el historial de liquidaciones de la zona.
**Las liquidaciones no se anulan en v1** (el dinero ya salió; si hubo error se corrige en el
próximo período con nota en auditoría). El estado VOIDED queda en el modelo para futuro.

### 4.6 Recibo de pago — ticket térmico 80mm / 56mm
- Nuevo `src/utils/payrollReceiptGenerator.js`, siguiendo el patrón **real** de
  `dailyCloseGenerator.js`: genera **PDF** (jsPDF) con layout por ancho; `action='print'` →
  iframe oculto + `contentWindow.print()`; `action='share'` → `navigator.share` con el archivo
  (fallback: descarga). (Corrección 2026-10-03: el plan decía SVG/PrinterSerial; el generador de
  cierre trabaja con PDF. El método ESC/POS directo en `PrinterSerial` queda como mejora opcional.)
- Anchos: 80mm cuando `printer_paper_width` es `'80'`; angosto en otro caso. **Agregar la opción
  `{val:'56', label:'56 mm (Angosta)'}` al setting** (`SettingsTabNegocio.jsx:231`; hoy solo
  ofrece 58/80).
- Contenido del recibo: negocio, título "RECIBO DE PAGO — NÓMINA", folio único, fecha/hora,
  empleado (nombre + cédula), período (frecuencia + rango de fechas), sueldo del período
  (monto + moneda, con nota "congelado el <fecha>" si hubo snapshot), cantidad de consumos
  aplicados + total USD, **neto pagado en USD y en Bs con la tasa usada**, método de pago,
  líneas de firma (Recibido / Entregado), equipo que lo generó.
- Folio v1: determinista y único, derivado de la liquidación (`NOM-<periodKey>-<id corto>`).

## 5. Roles (Modo Jefe) — re-auditado 2026-10-03

La Zona de Nómina es **solo dueño**. Fuera de ella, cada rol solo toca lo mínimo operativo.

| Acción | Dueño | Admin | Cajero |
|---|---|---|---|
| Ver la Zona de Nómina | ✓ (todas las sedes) | — | — |
| Crear/editar/desactivar empleados | ✓ | — | — |
| Registrar consumo | ✓ (cualquiera, desde la zona) | ✓ (su sede, desde el POS) | — |
| Anular consumo | ✓ (único que puede) | — | — |
| Liquidar período | ✓ | — | — |
| Ver sueldos/resúmenes | ✓ | — | — |

> Decisiones de Luigi (fijas):
> - Solo dueño y admin registran consumos. El cajero no registra.
> - Solo el dueño anula consumos y liquida; la zona es solo del dueño.
> - El override del límite de consumo quedó en dueño/admin (auditado); es una excepción en el
>   momento del registro, y el dueño la ve en la zona.

## 6. Casos borde (resueltos en el diseño)

- **Sueldo en Bs**: consumos se registran en USD (precio de venta) con su tasa snapshot; al liquidar,
  el neto USD→Bs se convierte con la **tasa BCV vigente**, que queda guardada en la liquidación.
  Riesgo cambiario intra-período documentado, no escondido.
- **Neto negativo al liquidar**: se bloquea la liquidación (el stock ya salió); v1 lo muestra como
  "pendiente por resolver". Vales/anticipos quedan para después.
- **Período ya liquidado**: no acepta consumos; los nuevos caen en el período corriente.
- **Empleado desactivado**: no acepta consumos nuevos; su período abierto sí se puede liquidar.
- **Anular una venta normal**: no toca nómina (flujos separados).
- **Race creando el período**: ID determinista por empleado+key → upsert idempotente; el snapshot
  sale del mismo catálogo en todos los equipos → contenido idéntico.
- **Equipo offline**: registra local, sincroniza al reconectar (docs individuales, sin choques).
- **La zona no se ve, no se toca**: el gating es por rol en la UI **y** re-validado en la capa de
  servicio (un cajero no puede invocar liquidar/anular aunque manipule el cliente).
- **Trazabilidad**: cada consumo guarda `actor` y `deviceId` → el dueño ve en la zona quién registró
  qué (el dueño o el admin, desde la zona o el POS).

## 7. Archivos

**Nuevos**: `src/utils/payroll.js` (períodos + cálculos puros), `src/services/payrollService.js`
(registro/liquidación/anulación, con re-validación de rol),
`src/utils/payrollReceiptGenerator.js` (ticket 80/56mm), `src/components/Payroll/*`:
`NominaZone.jsx` (sección solo dueño: empleados, historial, resúmenes, liquidación),
`EmployeeConsumptionModal.jsx` (POS, admin: elige empleado de su sede),
`PayrollReceiptModal.jsx` (recibo post-liquidación: imprimir / compartir / reimprimir).

**Modificar**: `src/utils/checkoutProcessor.js` (`vendedorId`, patrón `useAuthStore.getState().usuarioActivo`),
extraer `adjustStockForItems(items, signo)` (util nuevo con lock + re-lectura + granel),
header del POS (botón consumo), `src/utils/roles.js` (`'nomina'` en `TABS_DUENO`),
`App.jsx` (montar vista como `supervision`), `src/services/supervisorContracts.js`
(registrar keys en `SYNC_VALIDATORS` + patrón por prefijo), `src/hooks/useCloudSync.js`
(función de push dedicada estilo `pushSingleSalesDelta` + validadores `STORE_SCHEMAS`),
`SettingsTabNegocio.jsx` (opción 56mm), `auditLog` con categoría `'NOMINA'` en cada acción.

## 8. Testing (regla permanente)

- **Determinista**: `periodKeyFor`/`periodBounds` con fechas fijas (las 3 frecuencias, bordes de
  quincena, fin de mes, lunes), `neto = sueldo − consumos`, validación de límite %, snapshot
  congelado ante cambio de sueldo. Harness en node, valores exactos, pass/fail.
- **E2E** en navegador real contra producción con la cuenta real cuando se despliegue.
- **Recibo**: test determinista de que el generador construye el ticket en ambos anchos con todos
  los campos (sin valores vacíos); la prueba visual real en impresora física no se puede automatizar
  — se verifica con el teléfono de Luigi.

## 9. Alcance v1 vs después

**v1**: Zona de Nómina **solo dueño** (empleados, consumos, resúmenes, liquidación, anulaciones) +
empleados (USD/Bs, 3 frecuencias) + consumos (docs individuales) + snapshot por período +
**recibo de pago térmico 80/56mm** (imprimir/compartir/reimprimir) +
registro desde POS solo admin (su sede) + `vendedorId` en ticket +
auditoría completa. El cajero no participa en nómina en v1.

**Después**: vales/anticipos en efectivo, comisiones por vendedor, proyección de nómina.
