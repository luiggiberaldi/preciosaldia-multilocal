# Plan: Fiados, Cobranzas y Créditos en Reportes (FIA-REPORT-001)

## Estado de implementación (actualizado tras implementar)

| Bloque | Estado | Dónde |
|---|---|---|
| Fase 0 — arnés determinista | ✅ 15 escenarios + invariantes I2/I5–I10 + cross-check a mano + dataset determinista v4.0 con 16 asserts de regresión | `tests/fixtures/receivablesScenarios.js`, `tests/harness/`, `tests/receivablesDeterministic.test.js` |
| T0 — el crédito no es efectivo (H9) | ✅ + **bug extra encontrado**: ANULADA sí aportaba a los buckets | `FinancialEngine.calculatePaymentBreakdown` |
| T1 — otorgado / cobranzas / neto + cartera | ✅ (3 filas + «Cartera al cierre» cuando hay clientes) | `receivablesReport.js`, `ReportsMetricsTab`, `reportsProcessor` |
| T2 — modelo de vista de medios de pago | ✅ núcleo compartido por Reportes y Dashboard | `paymentBreakdownView.js` |
| T3 — trazabilidad de cobranzas | ⚠️ parcial: detalle de cobranzas en la tarjeta del reporte; el PDF y el historial del reporte siguen sin bloque propio | `ReportsMetricsTab` |
| T4 — conciliación ledger ↔ cartera | ✅ núcleo + alerta visible + reparación con flag y rol | `pocketReconciliation.js`, `ReconciliationNotice.jsx` |
| T5 — ganancia devengada vs cobrada | ⚠️ pendiente (etiqueta y cifra cobrada tras flag) | — |
| T6 — H7 (origins) y H8 (bsAtSaleRate) | ✅ aditivos, con test de contrato | `FinancialEngine` |
| T7 — historial sin mezclar | ✅ filtro Ventas/Cobranzas/Todo (badge por fila pendiente) | `SalesHistory` + `filterHistoryByKind` |
| G3 — flags de escape | ✅ `reportes_fiado_split` y `reportes_reparacion_ledger` en Configuración → Ventas | `SettingsTabVentas` |
| Inyector determinista extendido | ✅ dataset puro v4.0 (abonos, excedente, Cashea con remesa parcial, 2 anulaciones, ledger) + **agregados congelados** y cross-check a mano | `src/testing/deterministicDataset.js`, `deterministicInjector.js`, `tests/receivablesDeterministic.test.js` |
| E2E propio del reporte | ✅ 2 casos a 320px: sección con neto negativo + alerta de conciliación | `tests/e2e/reportes-fiado.e2e.spec.js`, `tests/e2e/helpers/seedReportesFiado.js` |
| FIA-CIERRE-001 — resumen del día en el PDF del cierre | ✅ ventas netas / cobrado / créditos del día / cobranzas / ganancia / cartera, en dos columnas (carta) y etiquetas cortas (ticket) | `closeDaySummary.js`, `dailyCloseGenerator.js` |

> **Origen**: auditoría de cómo se reflejan los fiados/abonos/créditos en reportes y Dashboard.
> Hallazgos H1–H8 documentados abajo con archivo:línea. Nada de esto está implementado aún.
> **Regla del plan**: primero el arnés (tests que hoy **fallan**), después el fix. Ningún
> trabajo se cierra sin que su escenario del arnés pase de rojo a verde.
>
> ⚠️ **Hallazgo P0 añadido durante la redacción del plan (H9)**: una venta a crédito sin
> pagos se contabiliza como **efectivo recibido**. Verificado contra el motor real y
> alcanzable desde el checkout actual. Va primero (T0).

## Objetivo

Que las cuentas por cobrar, las cobranzas y los créditos internos sean **visibles,
separados y auditables** en reportes y Dashboard, con pruebas deterministas que
congelen los números y detecten cualquier regresión futura del motor financiero.

## No-objetivos

- No se cambia la semántica de los buckets del motor (`fiado`, `cashea`,
  `saldo_favor`, `_saldo_favor_generado`): los consumen Supervisor, cierre de caja y
  tests. Todo cambio en `FinancialEngine` es **aditivo**.
- No se toca el cálculo de vuelto ni el split de billetes (`changeSplit.js`).
- No se rediseña la vista de Cartera/Clientes; solo se añade la conciliación.

---

## Hallazgos que este plan cierra

| ID | Hallazgo | Evidencia |
|----|----------|-----------|
| **H9** | **P0 — Una venta 100 % fiada (`payments: []`) entra al bucket de efectivo** por su importe completo en Bs: infla «Efectivo Bs» en reportes, Dashboard, cierre de caja y el fondo de caja. Además, si `paymentMethod === 'fiado'`, contamina el bucket `fiado` (USD) con Bs | `FinancialEngine.js:270-293` (rama legacy); `useCheckoutCalculations.js:299-300` (filtra `> 0` ⇒ `payments: []` en venta 100 % fiada); `customerTransactionProcessor.js:76-85` (fiado manual **sin** `payments`); `dailyCloseGenerator.js:894` (lo imprime como «INGRESOS POR MÉTODO») |
| H1 | «Por Cobrar» se oculta si el neto del período es ≤ 0 (cobrar más de lo fiado borra la sección) | `ReportsMetricsTab.jsx:365,370,477`; `DashboardPaymentBreakdown.jsx:13`; fijado por `tests/cashea.test.js:64` |
| H2 | «Por Cobrar» es **flujo neto del rango**, no cartera acumulada → etiqueta engañosa | `FinancialEngine.js:248-266` |
| H3 | Cobranzas sin trazabilidad: el reporte las excluye del historial y el Dashboard las mezcla con ventas | `reportsProcessor.js:22-24` vs `DashboardView.jsx:515` → `SalesHistory` sin filtro de tipo |
| H4 | El fiado diluye el denominador de los `%` de medios de pago (y no muestra `%` propio) | `ReportsMetricsTab.jsx:396-398,420`; `DashboardPaymentBreakdown.jsx:45-47` |
| H5 | Tres fuentes de verdad sin conciliación: registros de venta, `customer.deuda` denormalizado y ledger | `useDashboardMetrics.js:132-138`; `customerLedger.js:145-182`; ledger con **0 lectores** en reportes/cierre |
| H6 | La ganancia reconoce el margen del fiado al vender (devengada) sin avisarlo | `reportsProcessor.js:34`; `useDashboardMetrics.js:84-86` |
| H7 | `_saldo_favor_generado` mezcla dos orígenes (vuelto acreditado + excedente de abono) | `FinancialEngine.js:228-241` (`getGeneratedWalletCredit`) |
| H8 | El fiado se convierte a Bs con la tasa de **hoy**, no con la tasa de la venta | `ReportsMetricsTab.jsx:391`; `DashboardPaymentBreakdown.jsx:46` |

### Auditoría del cierre de caja (hallazgos posteriores al plan)

| Hallazgo | Estado | Dónde |
|---|---|---|
| El PDF del cierre imprimía las cuentas por cobrar como si fueran Bs (un fiado de $21 salía «Bs 21,00») y la tarjeta se llamaba «Ingresos por Método» | ✅ FIA-DETALLE-002 | `dailyCloseGenerator.formatBreakdownValue` |
| El cierre y su PDF no decían cuánto se fió, cuánto se cobró ni cuánta cartera queda: «Ingresos» contra «Efectivo esperado» sin puente | ✅ FIA-CIERRE-001 | `closeDaySummary.js` + bloque final en ambos PDF |
| El arqueo del Supervisor compara el esperado contra ingresos devengados si el cierre no trae `reconData` | ⚠️ abierto | `OwnerMonitorView` |
| La tarjeta de cierre del reporte no muestra el arqueo y su total incluye ventas anuladas | ⚠️ abierto | `groupSalesByCierreId`, `CierreHistoryCard` |
| Se puede anular una venta de un cierre ya impreso y reescribir su historial | ⚠️ abierto | `voidSaleProcessor` |
| Los arqueos guardados antes del fix H9 conservan el efectivo inflado (**D5**) | ⚠️ decisión pendiente | — |

---

# Fase 0 — Arnés determinista (va PRIMERO, nace en rojo)

## 0.1 Fixtures de escenario congelado

**Nuevo**: `tests/fixtures/receivablesScenarios.js`

Cada escenario declara **entradas** y **números esperados escritos a mano** (no derivados
del código bajo prueba):

```js
export const SCENARIOS = {
  E1_fiado_mayor_que_cobranzas: {
    rate: 849.56, from: '2026-09-01', to: '2026-09-30',
    sales: [...], customers: [...], ledger: [...],
    expected: {
      fiadoOtorgadoUsd: 120.00,
      cobranzasUsd: 45.00,
      netoUsd: 75.00,
      pctEfectivoUsd: 60,        // sobre medios de pago reales
      gananciaDevengadaBs: 0.00, // congelado
    },
  },
  E2_cobranzas_mayor_que_fiado: { /* ver ejemplo trabajado abajo */ },
  ...
};
```

Escenarios obligatorios:

| # | Escenario | Qué prueba |
|---|-----------|------------|
| E1 | Fiado otorgado > cobranzas | Camino feliz, neto positivo |
| E2 | **Cobranzas (25) > fiado (10) → neto −15** | H1 (sección que desaparece) + H4 (% de 250%) |
| E3 | Período sin fiado, solo cobranzas | H1 en el extremo |
| E4 | Abono con excedente (> deuda) | `saldoFavorGeneradoUsd` y separación de H7 |
| E5 | Venta fiada con pago parcial al momento | `FIN-004`: `fiadoUsd` ≠ `totalUsd` |
| E6 | Abono anulado y venta fiada anulada | Reverso: no reaparecen en ningún agregado |
| E7 | Cashea: venta + remesa | Bucket `cashea` hermano de `fiado` |
| E8 | Saldo a favor usado como pago de una venta | `INTERNAL_CREDIT` fuera de ingresos |
| E9 | Período sin fiados ni cobranzas | Cero secciones fantasma (sin ruido) |
| E10 | Fiado a tasa 36,50 y a tasa 849,56 en el mismo rango | H8 (peso en Bs por tasa de venta) |
| E11 | `customer.deuda` desviado del ledger | H5 (conciliación detecta el drift) |
| E12 | Registros legacy: sin `fiadoUsd`, sin `payments[]` | No romper compatibilidad v1 |
| E13 | **Venta 100 % fiada (`payments: []`), sin abonos** | **H9**: no debe existir bucket de efectivo |
| E14 | Fiado manual del cliente (objeto sin `payments`), como lo escribe `customerTransactionProcessor` | **H9** por la otra puerta de entrada |
| E15 | Fiado legacy con `paymentMethod: 'fiado'` | No debe mezclar Bs dentro del bucket `fiado` (USD) |

### Ejemplos trabajados (números verificados contra el motor real)

Ambos con tasa fija **849,56** y todos los pagos en efectivo USD.

**E1 — el fiado positivo diluye los % (H4) y genera efectivo fantasma (H9)**

Entradas: venta fiada $150,00 + venta de contado $100,00 (efectivo USD) + abono $50,00.

```
fiadoOtorgadoUsd = 150.00   cobranzasUsd = 50.00   netoUsd = +100.00
efectivoUsd (real) = 150.00

HOY (medido): buckets = { fiado: 100, efectivo_bs: 127.434, efectivo_usd: 150 }
              ⇒ pct(efectivo USD) = 37,5%   ← el fiado y el fantasma están en el denominador
              ⇒ "Efectivo Bs 127.434,00" = 150 USD de fiado contados como caja  ← H9
ESPERADO:     buckets = { fiado (informativo), efectivo_usd: 150 }  sin efectivo_bs
              pct(efectivo USD) = 100%
```

**E2 — las cobranzas mayores al fiado borran la sección (H1)**

Entradas: ventas fiadas $4,00 + $6,00, abonos $4,00 + $6,00 + $15,00 (deuda anterior).

```
fiadoOtorgadoUsd = 10.00    cobranzasUsd = 25.00    netoUsd = -15.00
efectivoUsd (real) = 25.00

HOY (medido): buckets = { fiado: -15, efectivo_bs: 8.495,60, efectivo_usd: 25 }
              ⇒ la fila fiado se descarta (total > 0) → la sección NO se renderiza  ← H1
              ⇒ pct(efectivo USD) = 71,43% (denominador inflado por el fantasma)  ← H9
              ⇒ "Efectivo Bs 8.495,60" = 10 USD de fiado contados como caja       ← H9
ESPERADO:     sección visible con "Fiado otorgado 10,00", "Cobranzas 25,00", "Neto -15,00"
              pct(efectivo USD) = 100% y sin bucket efectivo_bs
```

Estos dos bloques son los tests «faro»: si alguien reintroduce cualquiera de los tres
fallos, el arnés lo dice por nombre de escenario.

## 0.2 Arnés de ejecución

**Nuevo**: `tests/harness/receivablesHarness.js`

```js
scenarioInput(name)                  // → { sales, customers, ledger, rate, from, to }
runScenario(name)                    // → objeto plano de los NÚCLEOS REALES:
                                     //   calculateReportsData, calculatePaymentBreakdown,
                                     //   computePaymentBreakdownRows, computeReceivablesMovements,
                                     //   reconcileCustomersWithLedger
expectExact(actual, expected, path)  // diff legible: "paymentBreakdown.fiado.total: esperado -15, recibido 0"
forEachScenario(fn)                  // aplica invariantes a los 12 escenarios
sumRawByHand(sales)                  // segunda implementación independiente (suma plana)
```

`sumRawByHand` es deliberadamente **ingenua** (recorre los registros con `+` y `-` sin
usar el motor). Los agregados del motor deben coincidir con ella al centavo: dos
implementaciones independientes que coinciden es la mejor prueba de determinismo que
podemos tener sin depender de que el motor "se valide a sí mismo".

## 0.3 Invariantes (se corren sobre TODOS los escenarios)

| ID | Invariante | Assert |
|----|-----------|--------|
| I1 | Caja cuadra: medios reales netos de vuelto + cobranzas en efectivo | `expectExact(flujoCaja, efectivoNeto + cobranzasEfectivo)` |
| I2 | Neto de fiado | `fiadoOtorgado − cobranzas === neto` |
| I3 | Cuentas por cobrar nunca son ingreso | ningún bucket `isReceivable` aparece en `ventas`/`ganancia` |
| I4 | Cuadre por ticket | `Σ items = totalUsd` en cada venta fiada |
| I5 | **Nada con movimiento se oculta** | por cada tipo con importe ≠ 0 ⇒ su fila existe en el modelo de vista |
| I6 | `%` de medios de pago suman 100 (±0,5) y **excluyen fiado** | regresión de H4 |
| I7 | Idempotencia del reverso | escenario con anuladas ≡ escenario sin ellas (mismo resultado exacto) |
| I8 | Sin `NaN`/`Infinity` en ningún agregado | barrido recursivo sobre el resultado |
| I9 | **Ninguna venta a crédito con `payments` vacío contribuye a un bucket de efectivo** | por cada escenario con fiado total: los buckets `efectivo_*` solo contienen cobranzas y ventas de contado |
| I10 | Un bucket nunca mezcla unidades | `currency === 'FIADO'` ⇒ su total proviene solo de USD (`fiadoUsd` − cobranzas); ningún bucket de divisa recibe Bs |

## 0.4 Inyector determinista extendido

`src/testing/deterministicInjector.js` ya tiene la base correcta: PRNG Mulberry32 con
`SEED = 12345`, `FIXED_RATE = 36.50`, 102 ventas, 3 clientes y ventas fiadas.

Extender (sin cambiar los seeds ni los números existentes):

1. Generar también **abonos** (`COBRO_DEUDA`), un abono con excedente, una **remesa
   Cashea** y una **anulación**.
2. Exportar `DETERMINISTIC_EXPECTED` con los agregados del período (fiado otorgado,
   cobranzas, neto, cartera final por cliente).
3. Los valores se **capturan en la primera corrida y se revisan a mano** contra
   `sumRawByHand` antes de congelarlos (el harness imprime ambos).
4. **Orden crítico por H9**: el inyector ya genera ventas fiadas, así que hoy su
   breakdown trae caja fantasma. Congelar los agregados **después de T0** y guardar
   además `PHANTOM_BEFORE_FIX` (el `efectivo_bs` medido antes) como evidencia de que la
   corrección del motor elimina exactamente ese importe y ningún otro. Es la prueba
   determinista de que el fix no tiene efectos colaterales.

**Nuevo test**: `tests/receivablesDeterministic.test.js` → corre el inyector con el mock
de `storageService` (mismo patrón de `tests/financialEngine.test.js`) y compara el reporte
completo contra `DETERMINISTIC_EXPECTED`. Es un test de regresión de extremo a extremo del
motor financiero, sin navegador y reproducible al bit.

## 0.5 E2E determinista

`tests/e2e/helpers/seedBrowserState.js` ya siembra IndexedDB + localStorage (tasa manual,
`checkout_mode`, cliente, etc.). Añadir:

```js
seedReceivablesScenario(page, scenarioName)   // siembra ventas/clientes/ledger del fixture
```

**Nuevo spec**: `tests/e2e/reportes-fiado.e2e.spec.js` — escenario E2: abrir Reportes,
assert de las dos filas + neto `-15,00` con signo + `efectivo USD 100%` + que la sección
existe con 320 px sin overflow (regla de responsividad del repo).

---

# Trabajos de fixeo

## T0 — El crédito no es efectivo (H9) [P0, va primero]

**Cambio en el motor** (`FinancialEngine.calculatePaymentBreakdown`): la rama legacy
(`if (!sale.payments || sale.payments.length === 0)`, línea ~270) debe distinguir
**flujo de caja** de **cuenta por cobrar**:

```js
// Una venta a crédito sin pagos NO tiene flujo de caja: la cuenta por cobrar ya se
// registró arriba (bucket `fiado` / `cashea`). Antes caía en la rama legacy y sumaba
// sale.totalBs al método por defecto (`efectivo_bs`) — caja fantasma (H9).
const isReceivableSale = sale.tipo === 'VENTA_FIADA' || sale.tipo === 'VENTA_CASHEA';
if (isReceivableSale && (!sale.payments || sale.payments.length === 0)) return;
```

Reglas finas del guardarraíl:

1. **No** se toca el caso `COBRO_DEUDA`: un abono legacy sin `payments` **sí** es efectivo real.
2. Fiado **parcial** (con `payments`) sigue por la vía normal: bucket `fiado` = `fiadoUsd`
   y los pagos reales a sus métodos (comportamiento FIN-004 ya cubierto por test).
3. Si aparece `paymentMethod === 'fiado'` en un registro legacy, mapearlo al bucket `fiado`
   con semántica **USD** (`fiadoUsd ?? totalUsd`), nunca sumarle Bs.
4. `VENTA_CASHEA` sin pagos sigue el mismo camino que `fiado` (es cuenta por cobrar
   de Cashea, ya registrada por el bloque de la línea ~268).

**Impacto de corregirlo**: «Efectivo Bs» del reporte/cierre deja de incluir el fiado del
período; el cuadre físico de caja por fin compara peras con peras; el fondo de caja del
POS (`SalesView.currentFloat`, que bebe de este breakdown) deja de habilitar vuelto irreal.

**Riesgo**: los cierres **históricos** ya guardados conservan los números inflados. El plan
no reescribe historia: se documenta y, si se quiere, se ofrece un recálculo opcional de
cierres pasados (fuera de alcance, ver D5).

**Guardarraíles**: G1 (solo se añade un `return` temprano + un mapeo), G2, G7,
**I9/I10**, y el test FIN-004 existente debe seguir verde (fiado parcial).

## T1 — Separar «otorgado» / «cobrado» / «neto» y nunca ocultar (H1, H2)

**Núcleo puro nuevo**: `src/utils/receivablesReport.js`

```js
computeReceivablesMovements(sales, { from, to, bcvRate })
// → {
//     fiadoOtorgadoUsd, cobranzasUsd, netoUsd, saldoFavorGeneradoUsd,
//     cobranzas: [{ saleId, saleNumber, timestamp, cliente, clienteId,
//                   montoUsd, montoBs, methodId, saldoFavorGeneradoUsd }],
//     fiados:    [{ saleId, saleNumber, timestamp, cliente, montoUsd }],
//   }
```

- Sin React, sin storage, con `sumR/round2` de `dinero.js` (el lint prohíbe `Math.round`,
  `toFixed`, `parseFloat` en `src/utils/**`).
- Excluye `status === 'ANULADA'` y respeta `afectaCaja === false`.
- `fiadoUsd` con fallback a `totalUsd` (compatibilidad FIN-004) y `payments` opcional (v1).

**Cambios aditivos**:
- `reportsProcessor.calculateReportsData` devuelve `receivables` y `receivablePayments`
  (arrays nuevos). **No se modifica ninguna clave existente.**
- `ReportsMetricsTab`: la sección «Cuentas por Cobrar» se deriva de `receivables` (no del
  bucket `fiado`) y **no aplica** el filtro `d.total > 0` a sus filas. Tres líneas:
  `Fiado otorgado`, `Cobranzas del período`, `Neto` (con signo y color por signo).
- `DashboardPaymentBreakdown`: mismo criterio (una sola fuente de verdad con el reporte).
- Tercera línea de contexto: **`Cartera al cierre`** desde `customers` (`deuda +
  casheaDeuda`), etiquetada como saldo acumulado y **no** como flujo del período → cierra H2.
  Requiere un parámetro nuevo opcional `customers` en `calculateReportsData` (retrocompatible).

**Guardarraíles**: G1 (compatibilidad), G2 (dinero), G3 (flag), G7 (anuladas).

## T2 — Extraer el modelo de vista de medios de pago (H4) y quitar la dilución

Hoy `ReportsMetricsTab.jsx:365-400` y `DashboardPaymentBreakdown.jsx:13-47` son la **misma
lógica duplicada**. Extraer a un núcleo puro compartido:

**Nuevo**: `src/utils/paymentBreakdownView.js`

```js
buildPaymentBreakdownRows(paymentBreakdown, { bcvRate, tasaCop, copEnabled })
// → { rows: [...], denominadorBs, totales: { bsNeto, usdNeto, copNeto } }
//   denominadorBs = solo medios de pago reales (BS+USD+COP netos de vuelto)
//   excluye: FIADO, propina (isTip), vuelto (isChange), crédito interno
```

- Cada fila: `{ key, label, currency, amount, amountBs, pct, isReceivable }`.
- `%` se calcula sobre el denominador real; la fila de fiado muestra su importe en Bs y su
  propio peso **contra las ventas del período**, no contra los medios de pago.
- Las dos pantallas consumidoras usan el mismo núcleo (elimina la deriva entre ellas).

**Guardarraíles**: G1 (los buckets del engine intactos), G2, G3.

## T3 — Trazabilidad de cobranzas (H3)

- `receivablePayments` (T1) alimenta un bloque nuevo **«Cobranzas del período»** en
  `ReportsMetricsTab` (y en el PDF): cliente, ticket, monto USD/Bs, método y
  `saldoFavorGeneradoUsd` cuando exista.
- Filtro de tipo en el historial del reporte: `Ventas | Cobranzas | Todo`, con
  **contadores separados** (`totalSalesCount` sigue siendo solo ventas).
- Contrato: `historySales` conserva su contenido actual; las cobranzas viven en
  `receivablePayments` para no inflar conteos ni promedios.

**Guardarraíles**: G1, G2, G5 (exportación), G8 (responsivo).

## T4 — Conciliación ledger ↔ `customer.deuda` (H5)

**Núcleo puro nuevo**: `src/utils/pocketReconciliation.js`

```js
reconcileCustomersWithLedger(customers, ledger, { tolerance = 0.01 })
// → { ok, drift: [{ customerId, name, customerDeudaUsd, ledgerBalanceUsd, deltaUsd }],
//     ledgerOrphans: [...], checkedCount }
```

- Reutiliza `calculateLedgerBalance` (ya existe, respeta `status !== 'VOIDED'`).
- `tolerance = 0.01` para no gritar por redondeo de centavo.
- **UI**: banner ámbar en Reportes/Cartera **solo si `drift.length > 0`**, con la tabla del
  descuadre; acción «Reconstruir desde ledger» (dry-run primero, confirmación después) que
  reutiliza `rebuildCustomersFromLedger` — ya existe y solo se usa en el merge de nube
  (`useCloudSync.js:278`).
- La reparación **escribe auditoría** (`auditService.logEvent`) y **nunca borra**
  movimientos del ledger.
- Test determinista con drift sembrado (E11): detecta delta exacto, tolera 0,01, no grito
  cuando todo cuadra.

**Guardarraíles**: G4 (no destructivo), G5 (rol ADMIN/SUPERVISOR), G3 (flag de la acción).

## T5 — Ganancia devengada vs cobrada (H6)

- **Mínimo (siempre)**: etiquetar la ganancia del reporte como *devengada* e incluir en el
  tooltip «incluye margen de fiados no cobrados».
- **Opcional (flag OFF por defecto)**: `computeCollectedProfit` — asigna cobranzas a ventas
  fiadas pendientes por cliente en **FIFO** y calcula margen efectivamente cobrado. Se
  muestra como segunda cifra, nunca reemplaza a la devengada.

**Guardarraíles**: G3 (flag), G2, I3.

## T6 — Micro-fixes deterministas (H7, H8)

- **H7**: el bucket `_saldo_favor_generado` conserva su nombre y forma (contratos intactos)
  y gana metadata aditiva:
  `origins: { vueltoMonederoUsd, excedenteAbonoUsd }`. No se crean buckets nuevos →
  no aparecen entradas fantasma en las secciones de crédito interno.
- **H8**: cada bucket de fiado acumula además `bsAtSaleRate` (Σ `fiadoUsd × sale.rate`).
  El modelo de vista usa `bsAtSaleRate` si existe y cae a `total × bcvRate` si no
  (registros legacy) → el peso en Bs deja de moverse con la tasa de hoy.

**Guardarraíles**: G1 (aditivo), G2, test de contrato (`Object.keys` congeladas).

## T7 — Historial del Dashboard sin mezclar (H3)

- `SalesHistory`: badge explícito **«Cobranza»** para `COBRO_DEUDA`/`COBRO_CASHEA`,
  filtro de tipo (`Ventas | Cobranzas | Todo`, default `Ventas`) y exclusión de las
  cobranzas de `totalSalesCount`.
- Test de modelo: dado un array mixto, el filtro default solo devuelve ventas.

**Guardarraíles**: G8 (no romper el layout ni la búsqueda inteligente existente).

---

## Guardarraíles transversales

| ID | Guardarraíl | Cómo se verifica |
|----|-------------|------------------|
| G1 | **Contratos**: `calculateReportsData` y el breakdown solo crecen (campos nuevos); ninguna clave existente cambia de tipo o significado | `tests/reportsContract.test.js` congela la forma (`Object.keys` + tipos) |
| G2 | **Dinero**: `sumR/round2/mulR/divR` de `dinero.js`; prohibido `Math.round/toFixed/parseFloat` en `src/utils`, `src/core`, `useReports*` (lint ya lo pone como `error`) | lint + aserciones exactas (nunca `toBeCloseTo` en núcleos) |
| G3 | **Flags de escape** (localStorage, default ON, toggle en Configuración → Ventas junto a `cart_live_resync`): `reportes_fiado_split`, `reportes_reparacion_ledger` (default **OFF**) | test de que con el flag OFF se renderiza el comportamiento previo |
| G4 | **No destructivo**: la reparación escribe snapshot + auditoría; jamás borra movimientos del ledger | test con ledger sembrado que verifica que los entries siguen ahí |
| G5 | **Roles**: reparación y exportación con permiso ADMIN/SUPERVISOR (patrón `useAuthStore`) | test de permiso denegado |
| G6 | **Sin loops**: núcleos puros + `useMemo`; el reporte no recalcula en cada render | núcleos puros (sin `setState`) + invariante I8 |
| G7 | **Anulaciones**: todo agregado excluye `ANULADA` y respeta `afectaCaja === false` | escenario E6 + invariante I7 |
| G8 | **Responsivo**: nada de overflow en 320 px (regla del repo) | E2E con viewport 320/360/430 |
| G9 | **Gates**: `lint` + `typecheck` + `test` (523+) + `build` + `test:e2e:checkout` verdes | pre-commit hook del repo + corrida manual |

---

## Orden de ejecución (cada paso deja el árbol verde)

1. **Fase 0** — fixtures + harness + invariantes + tests (E1, E2, E11, E13 nacen **ROJOS**).
2. **T0** — guardarraíl del motor: el crédito no es efectivo ⇒ caen H9 y I9/I10
   (E1 y E2 pierden el bucket `efectivo_bs` fantasma). **Va antes que cualquier UI**:
   es integridad de datos, no presentación.
3. **T2** — núcleo de vista de medios de pago ⇒ cae I6 (`37,5% → 100%` y `71,4% → 100%`).
4. **T1** — `receivables` + sección de tres filas + cartera ⇒ cae H1/H2 (E1, E2, E3, E9).
5. **T3** — bloque de cobranzas + filtro de tipo en el reporte (E4, E5, E7, E8).
6. **T4** — conciliación + reparación con rol ⇒ cae H5 (E11).
7. **T6** — origins + `bsAtSaleRate` ⇒ cae H7/H8 (E10, E12, E15).
8. **T7** — historial del Dashboard (D3) ⇒ E2E.
9. **T5** — etiqueta + ganancia cobrada tras flag (H6).
10. **Cierre** — inyector extendido congelado + PDF/CSV + gates completos.

Tamaño estimado: Fase 0 **M**, T1/T2/T3 **M**, T4 **M**, T6/T7 **S**, T5 **S**.

---

## Matriz de pruebas deterministas (resumen)

| Test | Archivo | Escenarios | Tipo |
|------|---------|-----------|------|
| Golden de cuentas por cobrar | `tests/receivablesReport.test.js` | E1–E5, E7–E9, E12 | exacto (`toBe`) |
| Invariantes | `tests/receivablesInvariants.test.js` | I1–I8 sobre los 12 | barrido |
| **Crédito ≠ efectivo (H9)** | `tests/receivablesCashGuard.test.js` | E13, E14, E15 + I9/I10 + FIN-004 verde | exacto |
| Medios de pago (`%`) | `tests/paymentBreakdownView.test.js` | E1–E3, I6 | exacto |
| Conciliación | `tests/pocketReconciliation.test.js` | E11 + tolerancia + sin drift | exacto |
| Contrato de reportes | `tests/reportsContract.test.js` | claves/tipos congelados | snapshot |
| Inyector determinista | `tests/receivablesDeterministic.test.js` | 102 ventas + abonos + anulación | congelado |
| Reverso | `tests/receivablesVoid.test.js` | E6, I7 | exacto |
| Historial Dashboard | `tests/salesHistoryFilter.test.js` | D3 | modelo |
| E2E reportes | `tests/e2e/reportes-fiado.e2e.spec.js` | E2 @ 320/360/430 px | navegador |

**Script nuevo** en `package.json`:

```json
"test:fiado": "vitest run tests/receivables*.test.js tests/pocketReconciliation.test.js tests/paymentBreakdownView.test.js tests/reportsContract.test.js tests/salesHistoryFilter.test.js",
"verify:fiado": "bun run lint && bun run typecheck && bun run test:fiado && bun run test && bun run build"
```

---

## Criterios de aceptación

1. Un período donde las cobranzas superan al fiado **muestra** la sección, con neto
   negativo y signo visible (hoy desaparece).
2. «Fiado otorgado», «Cobranzas del período» y «Cartera al cierre» son cifras distintas y
   etiquetadas; ninguna se llama simplemente «Por Cobrar».
3. Los `%` de medios de pago suman 100 y **no** incluyen fiado (E1: 37,5% → 100%; E2: 71,4% → 100%).
4. Toda cobranza es trazable por cliente/ticket/método, y se ve en el reporte y en el PDF.
5. Si `customer.deuda` se desvía del ledger > $0,01, Reportes lo avisa con el detalle, y
   la reparación exige rol y deja auditoría.
6. Con `reportes_fiado_split=false` la UI vuelve al comportamiento actual sin redeploy.
7. Las 15 golden values son exactas (sin tolerancia) y el inyector determinista reproduce
   `DETERMINISTIC_EXPECTED` al bit en corridas consecutivas.
8. **Una venta 100 % fiada no aporta un solo bolívar a ningún bucket de efectivo**, ni en
   reportes, ni en Dashboard, ni en el cierre de caja, ni en el fondo de caja del POS.
9. Suite completa, `tsc --noEmit`, `vite build` y E2E de checkout verdes; E2E nuevos verdes
   en 320/360/430 px.

## Riesgos y decisiones abiertas

- **D1 (requiere tu decisión)**: ¿«Por Cobrar» debe seguir siendo **neto del período** o
  pasar a **cartera acumulada**? Recomendado: mostrar ambos (T1) — es lo que el plan asume.
- **D5 (requiere tu decisión)**: los cierres de caja ya guardados tienen el efectivo
  inflado por fiados (H9). ¿Se recalculan, se marcan como históricos con nota, o se dejan
  tal cual? Recomendado: dejarlos y añadir la nota «anterior al fix H9» en el histórico.
- **D2 (requiere tu decisión)**: ¿la ganancia por defecto es devengada o cobrada?
  Recomendado: devengada etiquetada (mínimo riesgo contable), cobrada detrás de flag.
- **R1**: `customer.deuda` puede llevar años de historia; el primer aviso de conciliación
  podría mostrar drift legítimo previo al ledger. Mitigación: dry-run + la acción de
  reconstrucción es explícita y logueada, nunca automática.
- **R2**: los fixtures usan tasas fijas; la producción tiene drift. Mitigación: E10 con dos
  tasas y `bsAtSaleRate` (T6) para que el peso histórico no dependa de la tasa de hoy.

## Rollback

- Todo detrás de flags en localStorage (G3): `reportes_fiado_split=false` restaura el
  render actual en caliente.
- Los cambios de motor son **aditivos** (nuevas propiedades), por lo que revertir el
  frontend es suficiente: ningún dato guardado queda en formato nuevo.
- La reparación de ledger está OFF por defecto y exige confirmación explícita.

## Definición de hecho

- Fase 0 con E2/E11 rojos → verdes tras T1/T2/T4 (evidencia en el historial de commits).
- Cero `toBeCloseTo` en los núcleos puros; todo exacto tras `round2`.
- Cada hallazgo H1–H8 tiene al menos un test nombrado que lo referencia en su comentario.
- `verify:fiado` y `verify:supervisor` verdes antes de cerrar.
