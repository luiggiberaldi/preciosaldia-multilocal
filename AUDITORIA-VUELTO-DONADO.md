# AUDITORÍA — "Cliente deja el cambio" (vuelto donado a caja)

**Origen auditado:** `C:\Users\luigg\Desktop\sistemas personalizados\donde juancho\sistema pos\projects\donde juancho`
**Destino:** `preciosaldia-bodega` (la funcionalidad **no existe** aquí todavía)
**Fecha:** 2026-08-04
**Veredicto:** el **diseño de fondo es correcto y vale la pena portarlo**. La implementación tiene **1 defecto crítico, 2 altos, 4 medios y 3 bajos** que hay que corregir al traerla.

---

## 1. Qué hace la funcionalidad

Cuando una venta genera vuelto, el operador puede pulsar **"Cliente deja el cambio (Donar a Caja)"**. El vuelto no se entrega: se queda físicamente en la gaveta como propina/donación a la bodega.

**Mecanismo (y esta es la parte bien pensada):** al activar el toggle, el checkout envía `changeUsdGiven: 0` y `changeBsGiven: 0`. Como el arqueo calcula `efectivo esperado = apertura + ingresos − vuelto entregado`, **el dinero donado queda automáticamente dentro de lo esperado sin ninguna lógica especial en el cierre de caja.** Además se persiste `sale.tipDonated` como metadato informativo para poder reportarlo.

> ✅ **Esto es lo correcto y hay que conservarlo tal cual.** No requiere tocar `computeExpectedCash`, ni el arqueo, ni el balance del cliente. El error de diseño obvio —crear un método de pago virtual "propina"— habría inflado los ingresos brutos. No lo cometieron.

### Mapa de archivos en el origen

| Archivo | Rol |
|---|---|
| `CheckoutModalPOS/index.jsx:132-144, 380-399` | Estado `isTipDonated`, `tipCurrency`, construcción de `tipDonatedObj` |
| `CheckoutModalPOS/components/PaymentLeftColumn.jsx:140-175` | UI: tarjeta de vuelto + botón toggle + ocultado de los inputs de distribución |
| `hooks/useCheckoutCalculations.js:179-194, 290-324` | Misma lógica para el modo básico |
| `utils/checkoutProcessor.js:169` | `tipDonated: changeBreakdown?.tipDonated \|\| null` |
| `core/FinancialEngine.js:431-441` | Bucket `_propina_donada` en el desglose de pagos |
| `Dashboard/DashboardPaymentBreakdown.jsx:175-186` | Fila "Cambios Dejados en Caja (Propinas)" |
| `Dashboard/SalesHistory.jsx:294`, `Reports/ReportsMetricsTab.jsx:193` | Línea por venta |
| `views/OwnerMonitorView.jsx:394, 1436-1468, 2215` | Exclusión del % de métodos + acumulados `tipUsd` / `tipBs` |

---

## 2. Resumen ejecutivo

| # | Sev | Hallazgo | Impacto |
|---|---|---|---|
| **T-1** | 🔴 **Crítico** | La propina se guarda en **dos monedas a la vez** para el mismo dinero, y los consumidores las muestran/suman como si fueran dos donaciones | Reportes de propinas inflados ~2× |
| **T-2** | 🟠 Alto | **Sin tope ni guarda de anomalía**: cualquier vuelto, por grande que sea, se dona con un tap | Un tap accidental sobre un vuelto grande crea un faltante invisible en el arqueo |
| **T-3** | 🟠 Alto | **Anular no revierte nada** ni deja constancia de qué pasó con el dinero donado | Descuadre físico al anular una venta con propina |
| **T-4** | 🟡 Medio | `tipCurrency` se deriva del **orden** de los métodos, no de qué moneda hay realmente en la gaveta | Una propina de una venta pagada 95% en Bs se etiqueta "USD" |
| **T-5** | 🟡 Medio | El toggle **no se resetea** cuando el vuelto baja a 0; se re-arma solo | Propina fantasma si el operador corrige el pago |
| **T-6** | 🟡 Medio | Guarda con `> 0` en vez de épsilon, en el modo básico | Residuos de $0.001 generan registros de propina basura |
| **T-7** | 🟡 Medio | La propina **no sale en el ticket** del cliente | Sin comprobante de lo que el cliente donó |
| **T-8** | 🔵 Bajo | **Cero cobertura de tests** (`grep tipDonated tests/` → 0) | Sin red de seguridad |
| **T-9** | 🔵 Bajo | El bucket `_propina_donada` no tiene campo `total`; rompe el contrato del resto de buckets | Consumidor nuevo lee `undefined` |
| **T-10** | 🔵 Bajo | Sin atribución por turno/cajero | No se sabe quién recibió la propina |

---

## 3. Hallazgos en detalle

### 🔴 T-1 — La misma propina existe dos veces (mismo error de clase que C-1)

En **ambos** modos se rellenan las dos monedas para el mismo dinero:

```js
// CheckoutModalPOS/index.jsx:383-387
const tipDonatedObj = (isTipDonated && cambioUSD > 0.009) ? {
    amountUsd: cambioUSD,
    amountBs: round2(mulR(cambioUSD, tasaSegura)),   // ← el MISMO dinero
    currency: tipCurrency,
} : null;
```
```js
// hooks/useCheckoutCalculations.js:179-183
const tipDonatedObj = (isTipDonated && (changeUsd > 0 || changeBs > 0)) ? {
    amountUsd: changeUsd,
    amountBs: changeBs,          // ← changeBs ES changeUsd × tasa
    currency: tipCurrency,
} : null;
```

Y el motor acumula **las dos** en campos separados:

```js
// core/FinancialEngine.js:435-440
if (sale.tipDonated.amountUsd > 0) breakdown['_propina_donada'].totalUsd = ... + sale.tipDonated.amountUsd;
if (sale.tipDonated.amountBs  > 0) breakdown['_propina_donada'].totalBs  = ... + sale.tipDonated.amountBs;
```

**Consecuencia visible.** Con la pantalla de tu captura ($3.01 / Bs 2.273,03), el Dashboard renderiza:

> Cambios Dejados en Caja (Propinas): **$3.01 USD / Bs 2.273,03**

El operador lee dos donaciones. Fueron **$3.01, una sola vez**. Y `OwnerMonitorView.jsx:1466-1468` acumula ambas por separado:

```js
if (s.tipDonated) { tipUsd += (s.tipDonated.amountUsd || 0); tipBs += (s.tipDonated.amountBs || 0); }
```

Cualquier consumidor que convierta `tipBs` a USD y lo sume a `tipUsd` reporta el doble. El campo `currency` existe justamente para decidir cuál es la buena — **pero nadie lo usa para filtrar los montos, solo para elegir el texto**.

> Es exactamente el defecto C-1 de [`AUDITORIA-CHECKOUT.md`](AUDITORIA-CHECKOUT.md): una cantidad de dinero representada dos veces y consumida como si fueran dos.

---

### 🟠 T-2 — No hay tope ni guarda de anomalía

El vuelto normal sí tiene protección (`FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER`, `CHANGE_ANOMALY_MIN_USD`). La propina **no tiene ninguna**.

**Escenario real:** venta de $3.01. El operador teclea `500` en vez de `5.00` en efectivo USD. El vuelto salta a $496.99. Si pulsa el botón —que está justo ahí, grande y en el flujo— la venta se registra con **cero vuelto entregado** y $496.99 "donados".

Como el arqueo espera el efectivo sin descontar vuelto, el sistema **espera $496.99 que en realidad se le devolvieron al cliente**. El cierre reporta un faltante enorme y nadie sabe de dónde salió. El bucket `_propina_donada` lo explica, pero el operador ya cerró el turno.

Un tap de más sobre un vuelto normal ($3) es trivial de detectar. Sobre un vuelto anómalo, no.

---

### 🟠 T-3 — Anular no toca la propina

`voidSaleProcessor.js` no menciona `tipDonated` en ninguna línea.

Los **reportes** sí quedan bien por accidente: las ventas `ANULADA` se filtran antes de llegar al desglose (`useDashboardMetrics.js:28,39,64,76,108` y `reportsProcessor.js:8,15`), así que la propina desaparece del bucket sola.

Lo que **no** existe es una política sobre el dinero físico. Al anular una venta de $10 pagada con $20 donde el cliente donó $10:
- ¿Se devuelven $20 (los $10 donados salen de la gaveta)?
- ¿Se devuelven $10 (la donación se respeta)?

El sistema no lo dice ni lo registra. Y no hay ninguna advertencia al anular una venta con propina.

---

### 🟡 T-4 — `tipCurrency` mira el orden, no el dinero

```js
// index.jsx:134-144 — idéntico en el hook
const activeInputMethods = metodosNormalizados.filter(m => val(m.id) > 0);
const firstUsd = activeInputMethods.find(m => m.currency === 'USD');
if (firstUsd) return 'USD';        // ← gana USD por existir, no por ser mayoría
```

Basta **$1 en efectivo USD junto a 5.000 Bs** para que la propina se etiquete `USD`.

Lo irónico: **el mismo archivo, 240 líneas más abajo, ya tiene la heurística correcta** para decidir en qué moneda dar el vuelto:

```js
// index.jsx:375-378
const cashPaidBs = payments.reduce(...);
const cashPaidUsdInBs = payments.reduce(...);
const vueltoEnBs = cashPaidBs > cashPaidUsdInBs;      // ← esta sí compara magnitudes
```

`tipCurrency` no la reutiliza. Dos criterios distintos para la misma pregunta, en la misma función.

---

### 🟡 T-5 — El toggle no se resetea

`isTipDonated` es un `useState` que nadie apaga. La tarjeta de vuelto solo se renderiza con `cambioUSD > 0.009`, así que si el operador baja el pago **el botón desaparece pero el flag sigue en `true`**. Si vuelve a subir el pago, la propina se re-arma sola, sin que el botón se haya vuelto a pulsar.

El `tipDonatedObj` guarda con `cambioUSD > 0.009`, así que no se registran propinas de $0 — pero sí se registra una propina que el operador nunca reconfirmó.

---

### 🟡 T-6 — Épsilon inconsistente entre modos

| Modo | Guarda |
|---|---|
| POS | `isTipDonated && cambioUSD > 0.009` ✅ |
| Básico | `isTipDonated && (changeUsd > 0 \|\| changeBs > 0)` ❌ |

El modo básico usa `> 0` puro. Un residuo de `0.001` por redondeo crea un registro `tipDonated` de un fracción de centavo. El proyecto ya tiene `FINANCIAL_EPSILON.PAYMENT_ZERO = 0.009` para exactamente esto.

---

### 🟡 T-7 — La propina no aparece en el ticket

`grep -rl tipDonated src/components/Sales src/utils` en el origen devuelve solo `CheckoutModalPOS/index.jsx` y `checkoutProcessor.js`. Ninguna plantilla de impresión.

El cliente que donó su vuelto no recibe constancia, y el ticket muestra "Vuelto: $0.00" sin explicar por qué.

---

### 🔵 T-8 — Cero tests

```
grep -rl "tipDonated" tests/   →  (vacío)
```

33 archivos de test en el origen, ninguno cubre esta funcionalidad. Ni la construcción del objeto, ni el bucket del motor, ni la interacción con el arqueo.

---

### 🔵 T-9 — El bucket rompe el contrato de los demás

Todos los buckets del desglose usan `{ total, currency, label }`. `_propina_donada` usa `{ totalUsd, totalBs, label, isTip }` — **sin `total`**.

En `preciosaldia` esto importa: las dos superficies que consumen el desglose filtran con `d.total > 0`:

```js
// DashboardPaymentBreakdown.jsx:11 y ReportsMetricsTab.jsx:352
const allEntries = Object.entries(paymentBreakdown).filter(([, d]) => d.total > 0);
```

`undefined > 0` es `false`, así que el bucket **desaparece en silencio**. Funciona por accidente, no por diseño: cualquiera que agregue un consumidor sin ese filtro leerá `undefined`.

---

### 🔵 T-10 — Sin atribución

La propina se acumula a nivel tienda. No se registra qué usuario/turno la recibió. Para una bodega de un solo operador da igual; con varios cajeros y propinas repartibles, no.

---

## 4. Lo que está bien y hay que copiar sin tocar

| ✅ | Por qué es correcto |
|---|---|
| Poner `changeUsdGiven = 0` / `changeBsGiven = 0` en vez de inventar un método de pago | El dinero queda en la gaveta y el arqueo lo espera solo. Sin lógica especial en el cierre. |
| `computeExpectedCash` **ignora** `_propina_donada` | Correcto: el efectivo ya está contado en el bruto; restar o sumar la propina lo duplicaría. |
| No tocar el saldo del cliente | Una donación no es saldo a favor. El origen no las mezcla. |
| Prefijo `_` en el bucket + `isTip: true` | Lo excluye de la lista de métodos y del cálculo de porcentajes (`OwnerMonitorView.jsx:1442, 2215`). |
| Ocultar los inputs de distribución de vuelto con el toggle activo | Elimina la contradicción "dono el vuelto Y lo reparto". |
| La tarjeta cambia de color y el label pasa a "Vuelto Dejado en Caja (Propina)" | Feedback visual inequívoco antes de cobrar. |

---

## 5. Estado del destino (`preciosaldia-bodega`)

| Elemento | Estado |
|---|---|
| `tipDonated` / `isTipDonated` / `_propina_donada` | **No existe** (0 coincidencias en `src/`) |
| `isChangeCredited` (abonar vuelto al monedero) | ✅ Ya existe — es una funcionalidad **distinta y complementaria** |
| `PaymentLeftColumn.jsx:143` tarjeta de vuelto | ✅ Existe, estructura casi idéntica al origen |
| Arqueo (`CierreCajaWizard.jsx:89-90`) | Usa `_vuelto_usd` / `_vuelto_bs` directo, sin `computeExpectedCash` |
| Filtros `!d.isChange` en Dashboard y Reportes | ✅ Ya existen — el nuevo bucket encaja sin romper nada |
| Filtrado de `ANULADA` antes del desglose | ✅ Ya existe |

> ⚠️ **`computeExpectedCash` no existe en `preciosaldia`.** El arqueo hace la resta a mano en `CierreCajaWizard.jsx:89-90`. Como la propina se implementa poniendo el vuelto en 0, **el arqueo funciona igual sin tocarlo** — pero conviene saberlo.

> 🔴 **Dependencia dura:** esta funcionalidad edita exactamente las mismas líneas que corrige [`PLAN-FIXEO-CHECKOUT.md`](PLAN-FIXEO-CHECKOUT.md) (el bloque `defaultUsdChange` del hook y el bloque `changeUsdGiven` del POS). **Ese plan tiene que ejecutarse primero.** Si se hace al revés, la propina hereda el doble conteo de vuelto y el arreglo posterior pisa el injerto.

---

## 6. Cómo se porta mejorada

| Hallazgo | Corrección al portar |
|---|---|
| T-1 | **Un solo monto canónico**: `{ amountUsd, currency }` + `amountBs` **solo** cuando `currency === 'BS'`. El bucket expone `total` + `currency`, como todos los demás. |
| T-2 | Umbral de confirmación: si la propina supera `FINANCIAL_EPSILON.TIP_CONFIRM_USD`, se exige una segunda pulsación explícita. |
| T-3 | Advertencia al anular una venta con propina + registro en auditoría de la decisión. |
| T-4 | Reutilizar la heurística `cashPaidBs > cashPaidUsdInBs` que el propio archivo ya tiene. |
| T-5 | `useEffect` que apaga el toggle cuando el vuelto cae bajo el épsilon. |
| T-6 | `FINANCIAL_EPSILON.PAYMENT_ZERO` en ambos modos. |
| T-7 | Línea "Cliente dejó el cambio" en el ticket. |
| T-8 | `tests/tipDonated.test.js`. |
| T-9 | Bucket con la forma estándar `{ total, currency, label, isTip }`. |
| T-10 | Fuera de alcance (se registra `userId` en el sale, que ya alcanza para rastrear). |

**Plan ejecutable:** [`PLAN-VUELTO-DONADO.md`](PLAN-VUELTO-DONADO.md)
