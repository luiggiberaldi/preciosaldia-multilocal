# Auditoría E2E — Modos de Cobro (POS y Básico)

**Fecha:** 2026-08-04
**Alcance:** los dos modales de checkout, sus hooks, el procesador compartido y el consumo contable aguas abajo (breakdown de pagos y cierre de caja).
**Método:** lectura completa de los 12 archivos del flujo + ejecución de los módulos financieros reales en Vitest para probar el impacto contable del hallazgo C-1. La sonda fue eliminada tras la verificación.

---

## Mapa del flujo

```
SalesView.jsx:939-959
   └─ sharedProps ──> activeMode === 'pos' ? CheckoutModalPOS : CheckoutModal
                                │                    │
        CheckoutModalPOS/index.jsx          CheckoutModal.jsx
        ├─ usePaymentState                  └─ useCheckoutCalculations.js
        ├─ usePaymentCalculations
        ├─ useClientWallet
        └─ components/ (5)
                                │                    │
                                └──── onConfirmSale ─┘
                                          │
                            useCheckoutFlow.js:21  handleCheckout(payments, changeBreakdown)
                                          │
                            checkoutProcessor.js  processSaleTransaction()
                                          │
                            FinancialEngine.calculatePaymentBreakdown()
                                          │
                            CierreCajaWizard.jsx:89-90  expected = efectivo − _vuelto
```

**Punto clave de arquitectura:** los dos modos tienen cálculos **completamente independientes y duplicados** (`useCheckoutCalculations.js` vs `usePaymentCalculations.js`). No comparten ni una línea de lógica de totales. Toda divergencia listada abajo nace de ahí.

---

## Resumen ejecutivo

| Sev. | # | Hallazgo | Modo |
|---|---|---|---|
| 🔴 | C-1 | Doble conteo de vuelto: se registra el mismo sobrepago en $ **y** en Bs | **ambos** |
| 🔴 | C-2 | Saldo a favor sin tope superior → convierte crédito de tienda en efectivo físico | POS |
| 🟠 | A-1 | "Rellenar/Todo" en método Bs ignora Cashea y saldo a favor → sobrepago masivo | **ambos** |
| 🟠 | A-2 | El botón "Usar Saldo a Favor" no hace absolutamente nada | básico |
| 🟠 | A-3 | El vuelto se anula al guardar una `VENTA_CASHEA` | compartido |
| 🟠 | A-4 | La UI muestra el total **sin** recalcular Doble Precio mientras el sistema cobra el recalculado | básico |
| 🟠 | A-5 | `cartTotalUsd` crudo en vez de `activeCartTotalUsd` en 4 puntos del procesador | compartido |
| 🟡 | M-1 | Cashea se auto-activa sin que el operador lo pida | básico |
| 🟡 | M-2 | POS no tiene ninguna de las tres guardas del modo básico | POS |
| 🟡 | M-3 | `products` se relee fresco del storage; `customers` no → se pisan saldos | compartido |
| 🟡 | M-4 | 5 campos del payload de POS se envían y el procesador los ignora | POS |
| 🟡 | M-5 | El mismo carrito da distinto total según el modo (Doble Precio) | ambos |
| 🟡 | M-6 | "Abonar vuelto a cuenta": ~60 líneas de feature que no se renderiza ni se procesa | POS |
| 🔵 | B-1..B-7 | Código muerto, convención FIN-015 rota, épsilons inconsistentes, redondeos | ambos |

---

# 🔴 CRÍTICOS

## C-1 — Doble conteo de vuelto

**El mismo sobrepago se registra dos veces: una en el bucket de vuelto en $ y otra en el de vuelto en Bs.**

El sistema guarda dos campos independientes en la venta:

[checkoutProcessor.js:144-145](src/utils/checkoutProcessor.js#L144-L145)
```js
changeUsd: tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeUsdGiven || 0),
changeBs:  tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeBsGiven  || 0),
```

Y el motor los carga en dos buckets separados, sin verificar que no se solapen:

[FinancialEngine.js:352-359](src/core/FinancialEngine.js#L352-L359)
```js
if (safeChangeUsd > 0) { ... breakdown['_vuelto_usd'].total += safeChangeUsd; }
if (safeChangeBs  > 0) { ... breakdown['_vuelto_bs'].total  += safeChangeBs;  }
```

Ambos modos llegan a enviar los dos campos cargados con **el mismo dinero**, por rutas distintas:

### Ruta del modo básico — es la ruta **por defecto**

[useCheckoutCalculations.js:186-190](src/hooks/useCheckoutCalculations.js#L186-L190)
```js
const defaultUsdChange = (!changeUsdGiven && !changeBsGiven) ? changeUsd : round2(...);
const defaultBsChange  = (!changeUsdGiven && !changeBsGiven) ? changeBs  : round2(...);
onConfirmSale(payments, {
    changeUsdGiven: Math.min(defaultUsdChange, changeUsd),
    changeBsGiven: Math.min(defaultBsChange, changeBs),
});
```

Si el operador **no escribe nada** en los dos campos de desglose — que es lo normal, son opcionales y solo aparecen si `isPaid && changeUsd > 0.009` ([CheckoutModal.jsx:371](src/components/Sales/CheckoutModal.jsx#L371)) — se envían `changeUsd` **y** `changeBs`. Y esos dos valores son el mismo sobrepago expresado en dos monedas, porque `totalPaidBs` convierte también los pagos en dólares a su equivalente en bolívares:

[useCheckoutCalculations.js:76-98](src/hooks/useCheckoutCalculations.js#L76-L98)
```js
const totalPaidBs = useMemo(() => sumR(paymentMethods.map(m => {
    if (m.currency === 'BS') return round2(val);
    ...
    return safeRate > 0 ? mulR(val, safeRate) : 0;   // ← el pago en USD también cuenta como Bs
})), [...]);

const changeUsd = Math.max(0, subR(totalPaidWithCasheaUsd, cartTotalUsd));
const changeBs  = Math.max(0, subR(totalPaidBs + mulR(casheaAmountUsd, safeRate), cartTotalBs));
```

### Ruta del modo POS — se dispara con el botón "Todo" en Bs

[CheckoutModalPOS/index.jsx:344-345](src/components/Sales/CheckoutModalPOS/index.jsx#L344-L345)
```js
changeUsdGiven: distVueltoUSD ? parseFloat(distVueltoUSD) : cambioUSD,
changeBsGiven: distVueltoBS ? parseFloat(distVueltoBS) : 0,
```

Cuando el operador pulsa **"Todo"** en el campo de vuelto en Bs ([PaymentLeftColumn.jsx:195](src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx#L195)), `handleVueltoDistChange` calcula el resto en dólares, le da 0, y **vacía el campo**:

[CheckoutModalPOS/index.jsx:186-188](src/components/Sales/CheckoutModalPOS/index.jsx#L186-L188)
```js
const restUsd = round2(Math.max(0, subR(cambioUSD, restBsInUsd)));
setDistVueltoUSD(restUsd > 0.001 ? restUsd.toFixed(2) : '');   // ← queda ''
```

`''` es falsy, así que el ternario de la línea 344 cae al fallback y manda `cambioUSD` **completo**. Resultado: el vuelto íntegro registrado en dólares *y* el vuelto íntegro registrado en bolívares.

### Verificación

Ejecuté `FinancialEngine.calculatePaymentBreakdown` contra una venta de $10 pagada con $20 en efectivo USD y el vuelto entregado en Bs:

| Escenario | `efectivo_usd` | `_vuelto_usd` | `_vuelto_bs` |
|---|---|---|---|
| Correcto (`changeUsd:0, changeBs:400`) | 20 | — | 400 |
| **Lo que envía el checkout** (`changeUsd:10, changeBs:400`) | 20 | **10** | **400** |

Ambas aserciones pasaron. Se descuentan Bs 400 (= $10 a tasa 40) que nunca salieron de la caja.

### Impacto

[CierreCajaWizard.jsx:89-90](src/components/Dashboard/CierreCajaWizard.jsx#L89-L90)
```js
const expectedUsd = round2((paymentBreakdown['efectivo_usd']?.total || 0) - (paymentBreakdown['_vuelto_usd']?.total || 0));
const expectedBs  = round2((paymentBreakdown['efectivo_bs']?.total  || 0) - (paymentBreakdown['_vuelto_bs']?.total  || 0));
```

El cierre de caja espera menos efectivo del que realmente hay. Cada venta con vuelto genera un **sobrante fantasma**. Con 30–50 ventas con vuelto al día, el arqueo acumula cientos de dólares de descuadre inventado, y en ese ruido **se pierde la capacidad de detectar un faltante real**. Es decir: el bug no solo descuadra, anula la función de control del cierre de caja.

---

## C-2 — El saldo a favor no tiene tope superior (POS)

[WalletSection.jsx:45-50](src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx#L45-L50)
```js
onChange={(e) => {
    const v = parseFloat(e.target.value);
    if (e.target.value === '' || (v >= 0 && v <= saldoDisponible)) {
        setPagoSaldoFavor(e.target.value);
    }
}}
```

El input valida contra `saldoDisponible` pero **no contra el monto de la venta**. El botón "⚡ Todo" sí lo hace (`Math.min(saldoDisponible, faltaSinSaldo)`, línea 23) — el tope solo existe en el botón, no en el teclado.

**Explotación trivial:** cliente con $50 de saldo a favor compra $10. El operador (o el cliente pidiéndolo) escribe `50` en el campo. `totalPagadoGlobalUSD = 50`, `cambioUSD = 40`, `faltaPorPagar = 0` → el botón PAGAR se habilita. Se entregan **$40 en efectivo físico** y se descuentan $50 del monedero.

La guarda antifraude del procesador no lo detiene: `changeUsd(40) > cartTotal(10) × 5 = 50` es falso ([checkoutProcessor.js:81-87](src/utils/checkoutProcessor.js#L81-L87)).

> **Nota de negocio:** convertir crédito de tienda en efectivo puede ser una política válida. Pero hoy ocurre **sin tope, sin confirmación y sin registro diferenciado**, y drena el efectivo físico de la caja. Necesito tu decisión antes de fijar el comportamiento: ¿se prohíbe (tope en `faltaSinSaldo`), o se permite con confirmación explícita?

---

# 🟠 ALTOS

## A-1 — "Rellenar / Todo" en método Bs ignora Cashea y saldo a favor (ambos modos)

En las dos implementaciones, la rama USD del autorrelleno descuenta correctamente lo ya cubierto por Cashea, y **la rama Bs no**.

**Básico** — [useCheckoutCalculations.js:129-141](src/hooks/useCheckoutCalculations.js#L129-L141)
```js
if (currency === 'USD') {
    const currentPaidUsd = totalPaidWithCasheaUsd;      // ✅ incluye Cashea
    ...
} else {
    const currentPaidBs = totalPaidBs;                  // ❌ NO incluye Cashea
    const remBs = Math.max(0, subR(targetBs, currentPaidBs));
```

**POS** — [CheckoutModalPOS/index.jsx:219-226](src/components/Sales/CheckoutModalPOS/index.jsx#L219-L226)
```js
if (moneda === 'USD') {
    const remUsd = Math.max(0, subR(usdTotals.totalUsd, totalPagadoGlobalUSD));   // ✅ global
} else if (moneda === 'BS') {
    const remBs = Math.max(0, subR(bsTotals.totalBs, totalPagadoBS));             // ❌ totalPagadoBS excluye Cashea Y saldo a favor
```

`totalPagadoBS` ([usePaymentCalculations.js:45-53](src/components/Sales/CheckoutModalPOS/hooks/usePaymentCalculations.js#L45-L53)) solo suma los métodos reales.

**Escenario:** carrito $100, Cashea al 40% (inicial $40, financiado $60). El operador toca "Rellenar" en Efectivo Bs. Se escribe **Bs 4.000** (el total completo) en vez de **Bs 1.600** (la cuota inicial). El carrito queda sobrepagado en $60. Combinado con C-1, la venta se registra con $60 **y** Bs 2.400 de vuelto fantasma.

La misma clase de defecto está en [WalletSection.jsx:20](src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx#L20): `faltaSinSaldo = totalConIGTF - totalPagadoUSD`, sin restar Cashea → "⚡ Todo" aplica saldo a favor sobre el total completo.

## A-2 — El botón "Usar Saldo a Favor" del modo básico no hace nada

[CheckoutModal.jsx:106-109](src/components/Sales/CheckoutModal.jsx#L106-L109)
```js
const handleSaldoFavor = useCallback(() => {
    triggerHaptic && triggerHaptic();
    if (onUseSaldoFavor) onUseSaldoFavor();
}, [onUseSaldoFavor, triggerHaptic]);
```

**`onUseSaldoFavor` nunca se pasa.** No está en `sharedProps` ([SalesView.jsx:940-954](src/views/SalesView.jsx#L940-L954)) y no existe en ningún otro archivo del repo salvo las dos declaraciones de props. La guarda `if (onUseSaldoFavor)` convierte el click en un no-op silencioso: vibra el teléfono y nada más.

Además la condición de visibilidad está contra el campo equivocado:

[CheckoutModal.jsx:308](src/components/Sales/CheckoutModal.jsx#L308)
```js
{selectedCustomer?.deuda < -0.01 && remainingUsd > 0.01 && (
```

El crédito del cliente vive en `customer.favor` (así lo escribe `procesarImpactoCliente` y así lo lee `WalletSection`), no en una `deuda` negativa. Doblemente muerto: campo incorrecto **y** sin handler.

**Consecuencia:** el modo básico no puede aplicar saldo a favor de ninguna forma. El procesador sí lo soporta ([checkoutProcessor.js:223-225](src/utils/checkoutProcessor.js#L223-L225)) y POS sí lo expone. Es una capacidad financiera disponible solo en uno de los dos modos.

## A-3 — El vuelto se anula al guardar una `VENTA_CASHEA`

[checkoutProcessor.js:144-145](src/utils/checkoutProcessor.js#L144-L145) — `tipoVenta !== 'VENTA' ? 0 : ...`

Para `VENTA_FIADA` es correcto: si hay deuda no hay vuelto, son mutuamente excluyentes. **Para `VENTA_CASHEA` no lo es.** El pago virtual de Cashea cubre la parte financiada, así que el cliente paga la cuota inicial en efectivo y **puede sobrepagarla**.

**Escenario:** carrito $100, Cashea 60/40 → inicial $40. El cliente entrega $50 en efectivo. `changeUsd` se calcula bien ($10) y se descarta al persistir. La caja queda registrada como si hubiera recibido $50 limpios, pero solo tiene $40 → **faltante real de $10 en el arqueo**, sin rastro de por qué.

## A-4 — El modo básico muestra el total sin Doble Precio y cobra el recalculado

El hook recalcula el total cuando se paga en bolívares y lo expone en su variable interna:

[useCheckoutCalculations.js:45-53](src/hooks/useCheckoutCalculations.js#L45-L53)
```js
const cartTotals = useMemo(() => { ... FinancialEngine.buildCartTotals(...) }, [...]);
const cartTotalUsd = cartTotals.totalUsd;      // ← recalculado
const cartTotalBs  = cartTotals.totalBs;
```

Pero **no lo exporta**, y `CheckoutModal.jsx` renderiza el prop crudo del mismo nombre en 6 lugares: el total de cabecera ([141](src/components/Sales/CheckoutModal.jsx#L141), [146](src/components/Sales/CheckoutModal.jsx#L146), [166](src/components/Sales/CheckoutModal.jsx#L166)), el mínimo de Cashea ([242](src/components/Sales/CheckoutModal.jsx#L242)), el desglose "Total Venta / Cuota Inicial" ([277](src/components/Sales/CheckoutModal.jsx#L277), [282](src/components/Sales/CheckoutModal.jsx#L282)) y el diálogo de confirmación ([551](src/components/Sales/CheckoutModal.jsx#L551)).

Con un carrito `dual_usd` pagado en bolívares, el modal le muestra al cliente un número y el sistema le cobra otro. En el panel de Cashea la discrepancia es peor: la "Cuota Inicial" que el cliente ve y acepta no es la que se registra.

POS no tiene este problema — pasa `dynamicCartTotals.totalUsd` a sus subcomponentes ([index.jsx:399-400](src/components/Sales/CheckoutModalPOS/index.jsx#L399-L400)) — salvo en `WalletSection`, que recibe el prop crudo ([index.jsx:439](src/components/Sales/CheckoutModalPOS/index.jsx#L439)).

## A-5 — `cartTotalUsd` crudo donde debería ir `activeCartTotalUsd`

Las líneas 39-46 del procesador existen precisamente para recalcular el total con Doble Precio. Cuatro puntos posteriores lo ignoran y usan el prop original:

| Línea | Uso | Efecto |
|---|---|---|
| [81](src/utils/checkoutProcessor.js#L81) | umbral de vuelto anómalo | la guarda antifraude se calibra contra el total equivocado |
| [85](src/utils/checkoutProcessor.js#L85) | mensaje de error | reporta un total que no es el cobrado |
| [136](src/utils/checkoutProcessor.js#L136) | fallback de `totalCop` | el total en pesos no coincide con la venta |
| [174](src/utils/checkoutProcessor.js#L174), [176](src/utils/checkoutProcessor.js#L176) | log de auditoría | la bitácora registra un monto distinto al de la venta persistida |

El más grave es el 174/176: el registro de auditoría de una venta con Doble Precio **no coincide con la venta**, que es justo lo contrario de lo que un log de auditoría debe garantizar.

---

# 🟡 MEDIOS

## M-1 — Cashea se auto-activa sin intención del operador (básico)

[CheckoutModal.jsx:91-104](src/components/Sales/CheckoutModal.jsx#L91-L104)
```js
useEffect(() => {
    if (casheaEnabled && selectedCustomer) {
        if (selectedCustomer.casheaLevel && CASHEA_LEVEL_MAP[...] !== undefined) {
            if (casheaMeetsMinimum) {
                setCasheaActive(true);                                   // ← sin pedir permiso
                setCasheaPercent(CASHEA_LEVEL_MAP[selectedCustomer.casheaLevel]);
            }
        } else { setCasheaActive(false); }
    } else { setCasheaActive(false); }
}, [selectedCustomerId, selectedCustomer, casheaEnabled, casheaMeetsMinimum, setCasheaActive, setCasheaPercent]);
```

Basta seleccionar un cliente con `casheaLevel` para que **toda** venta a ese cliente se convierta en `VENTA_CASHEA`, generando una `casheaDeuda` por cobrar a Cashea. Si el cliente quería pagar de contado, el operador tiene que acordarse de desactivar el switch. Y `casheaMeetsMinimum` está en las dependencias, así que el efecto puede reactivarlo.

POS no hace esto: `casheaActive` arranca en `false` y solo el operador lo enciende.

> Esto interactúa con [`PLAN-FIXEO-CASHEA.md`](PLAN-FIXEO-CASHEA.md): mientras la anulación no revierta `casheaDeuda` (Fase 5 de ese plan), cada auto-activación errónea deja una cuenta por cobrar irreversible.

## M-2 — POS no tiene ninguna de las tres guardas del modo básico

| Guarda | Básico | POS |
|---|---|---|
| Detección de confusión de moneda / montos altos (`_detectWarning` + `PaymentWarningModal`) | ✅ [useCheckoutCalculations.js:195-264](src/hooks/useCheckoutCalculations.js#L195-L264) | ❌ no existe |
| Aviso de "excede fondo de caja" en el vuelto | ✅ [CheckoutModal.jsx:423-432](src/components/Sales/CheckoutModal.jsx#L423-L432) | ❌ recibe `currentFloatUsd`/`currentFloatBs` ([index.jsx:41-42](src/components/Sales/CheckoutModalPOS/index.jsx#L41-L42)) y **no los usa nunca** |
| Bloqueo por tasa no configurada | ✅ `rateError` / `copRateError` deshabilitan el CTA ([CheckoutModal.jsx:451](src/components/Sales/CheckoutModal.jsx#L451)) | ❌ usa `tasaSegura = tasa > 0 ? tasa : 1` y deja capturar toda la venta a **tasa 1**; el rechazo llega recién al confirmar ([checkoutProcessor.js:59-61](src/utils/checkoutProcessor.js#L59-L61)) |

El modo presentado como "profesional" es el que menos protecciones tiene.

## M-3 — El procesador relee `products` fresco pero no `customers`

[checkoutProcessor.js:181](src/utils/checkoutProcessor.js#L181)
```js
// FIN-027-pattern: re-leer productos fresco aquí para evitar stale state.
const freshProducts = await storageService.getItem(PRODUCTS_KEY, products);
```

[checkoutProcessor.js:238-240](src/utils/checkoutProcessor.js#L238-L240)
```js
updatedCustomers = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);
await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
```

`customers` es el prop capturado en el render, y `selectedCustomer` se resolvió en la línea 33, **antes** de tomar el lock. Si entre la apertura del modal y la confirmación se registró un abono desde otra pestaña o dispositivo, esta escritura pisa el arreglo completo de clientes con datos viejos: el abono desaparece. La protección FIN-027 se aplicó a inventario y no a clientes, que es donde el dato es monetario.

## M-4 — Cinco campos del payload de POS se envían y se ignoran

[CheckoutModalPOS/index.jsx:343-350](src/components/Sales/CheckoutModalPOS/index.jsx#L343-L350)
```js
onConfirmSale(payments, {
    changeUsdGiven: ..., changeBsGiven: ...,
    esCredito: modo === 'credito',
    clienteId: clienteSeleccionado || null,
    esCashea: casheaActive,
    vueltoCredito: isChangeCredited,
}, imprimir);
```

[useCheckoutFlow.js:21](src/hooks/useCheckoutFlow.js#L21) — `handleCheckout(payments, changeBreakdown)` recibe **dos** parámetros. El tercero (`imprimir`) se descarta. Y `processSaleTransaction` solo lee `changeUsdGiven` / `changeBsGiven` del segundo:

- `esCredito` / `esCashea` → el procesador **rededuce** el tipo de venta ([checkoutProcessor.js:89-90](src/utils/checkoutProcessor.js#L89-L90)) desde `remainingUsd` y `casheaUsd`.
- `clienteId` → usa el prop `selectedCustomerId`. Funciona **por coincidencia**, porque `handleSetCliente` sincroniza ambos ([index.jsx:99-102](src/components/Sales/CheckoutModalPOS/index.jsx#L99-L102)).
- `vueltoCredito` → ver M-6.
- `imprimir` → hoy inerte porque `PaymentFooter` siempre llama `onProcesar(false)`.

No hay daño hoy, pero es un contrato falso: cualquiera que lea el POS concluirá que esos campos determinan el resultado, y basta romper la sincronización de cliente para que la venta se cargue a la persona equivocada.

## M-5 — El mismo carrito da distinto total según el modo

Los dos modos deciden "el cliente está pagando en bolívares" con criterios distintos:

**Básico** ([useCheckoutCalculations.js:40-41](src/hooks/useCheckoutCalculations.js#L40-L41)) — exige un monto tecleado:
```js
const bsMethods = paymentMethods.filter(m => m.currency === 'BS');
return bsMethods.some(m => CurrencyService.safeParse(barValues[m.id]) > 0);
```

**POS** ([index.jsx:120-122](src/components/Sales/CheckoutModalPOS/index.jsx#L120-L122)) — le basta el **foco**:
```js
const isBsInputActive = metodosBsNorm.some(m => m.id === activeInputId);
const hasBsPayment = metodosBsNorm.some(m => val(m.id) > 0);
return isBsInputActive || hasBsPayment;
```

Con Doble Precio, en POS el total cambia solo con tabular hasta el campo de bolívares, y vuelve a cambiar al salir. El mismo carrito y el mismo cliente producen dos precios según el modo configurado.

## M-6 — "Abonar vuelto a la cuenta": feature muerta de punta a punta

Tres capas construidas y ninguna conectada:

1. **Estado y lógica:** `isChangeCredited` ([index.jsx:113](src/components/Sales/CheckoutModalPOS/index.jsx#L113)), `handleCreditChange` ([191-197](src/components/Sales/CheckoutModalPOS/index.jsx#L191-L197)) y el hook completo [`useClientWallet.js`](src/components/Sales/CheckoutModalPOS/hooks/useClientWallet.js) (45 líneas que proyectan el nuevo saldo del cliente).
2. **UI:** los tres se pasan a `PaymentLeftColumn` ([416-418](src/components/Sales/CheckoutModalPOS/index.jsx#L416-L418)), que **los desestructura y no los renderiza** ([PaymentLeftColumn.jsx:22,30-32](src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx#L22)). No hay botón. `handleCreditChange` no se puede invocar, `proyeccion` es siempre `null`.
3. **Persistencia:** aunque el botón existiera, [checkoutProcessor.js:149](src/utils/checkoutProcessor.js#L149) fija `vueltoParaMonedero: 0` en duro.

Hoy es inocuo. El riesgo es futuro y concreto: si alguien "termina la UI" renderizando ese botón sin tocar el procesador, el operador creerá haber abonado el vuelto a la cuenta, el cliente no recibirá nada, y la venta quedará registrada como si el vuelto **sí** hubiera salido en efectivo (línea 344 manda `cambioUSD` completo). Dinero desaparecido con recibo conforme.

---

# 🔵 BAJOS

| # | Hallazgo | Ubicación |
|---|---|---|
| B-1 | El input de vuelto en $ acepta más que el vuelto real: calcula el valor acotado para el complemento pero guarda el crudo. El tope solo se aplica al confirmar. | [CheckoutModal.jsx:380-385](src/components/Sales/CheckoutModal.jsx#L380-L385) |
| B-2 | El vuelto en Bs se redondea a entero (`.toFixed(0)`) y el complemento en $ se deriva de ese valor ya redondeado → deriva de hasta ~1 Bs. | [CheckoutModal.jsx:384](src/components/Sales/CheckoutModal.jsx#L384) |
| B-3 | `localStorage.getItem` en cada render, sin `useMemo` ni reactividad: cambiar la config de Cashea en otra pestaña no refresca el modal abierto. | [useCheckoutCalculations.js:55-56](src/hooks/useCheckoutCalculations.js#L55-L56), [index.jsx:105-106](src/components/Sales/CheckoutModalPOS/index.jsx#L105-L106) |
| B-4 | **FIN-015 roto** — sumas crudas con `+`: `totalPaidWithCasheaUsd`, `remainingBs`, `changeBs`; `totalPagadoGlobalUSD`. | [useCheckoutCalculations.js:93,96,98](src/hooks/useCheckoutCalculations.js#L93), [usePaymentCalculations.js:63](src/components/Sales/CheckoutModalPOS/hooks/usePaymentCalculations.js#L63) |
| B-5 | **FIN-015 roto** — multiplicaciones crudas: `casheaAmountUsd * tasaSegura` (ya cubierto por la Fase 10 de `PLAN-FIXEO-CASHEA`), `cambioUSD * tasaSegura`, `deudaCliente * tasaSegura`, `cartSubtotalUsd * effectiveRate`. | [index.jsx:322](src/components/Sales/CheckoutModalPOS/index.jsx#L322), [index.jsx:361](src/components/Sales/CheckoutModalPOS/index.jsx#L361), [PaymentLeftColumn.jsx:148,195,220](src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx#L148), [SalesView.jsx:943](src/views/SalesView.jsx#L943) |
| B-6 | `useClientWallet` **redefine `round2` localmente** en vez de importarlo de `dinero.js`. | [useClientWallet.js:14](src/components/Sales/CheckoutModalPOS/hooks/useClientWallet.js#L14) |
| B-7 | Épsilons inconsistentes: `0.01` en duro donde el resto del sistema usa `FINANCIAL_EPSILON.PAYMENT_ZERO`. | [checkoutProcessor.js:76,89](src/utils/checkoutProcessor.js#L76), [index.jsx:264](src/components/Sales/CheckoutModalPOS/index.jsx#L264) |
| B-8 | La validación de pagos solo revisa `amountUsd`; un `amountBs` en `NaN` (tasa 0) llega al breakdown. | [checkoutProcessor.js:54](src/utils/checkoutProcessor.js#L54) |
| B-9 | Código muerto adicional: `casheaConfirmReady` (calculado y desestructurado, nunca usado — el gate real es `!isPaid && casheaActive`), `isVueltoValido`, el bloque IGTF completo del POS (`montoIGTF = 0` fijo, 3 valores exportados sin consumidores), `onUseSaldoFavor` en POS. | [CheckoutModal.jsx:69](src/components/Sales/CheckoutModal.jsx#L69), [index.jsx:360](src/components/Sales/CheckoutModalPOS/index.jsx#L360), [usePaymentCalculations.js:71-73](src/components/Sales/CheckoutModalPOS/hooks/usePaymentCalculations.js#L71-L73) |
| B-10 | `PaymentFooter` calcula `canPay` y no lo usa; la lógica real está duplicada en `disabled` justo debajo. | [PaymentFooter.jsx:15-21](src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx#L15-L21) |

---

## Matriz de divergencia POS vs Básico

| Capacidad | Básico | POS | Veredicto |
|---|---|---|---|
| Recálculo de Doble Precio en los cálculos | ✅ | ✅ | ambos, con criterios distintos (M-5) |
| Doble Precio reflejado en la UI | ❌ (A-4) | ✅ salvo `WalletSection` | POS mejor |
| Aplicar saldo a favor | ❌ inoperante (A-2) | ✅ pero sin tope (C-2) | ninguno correcto |
| Distribuir el vuelto $ / Bs | ✅ | ✅ | ambos con doble conteo (C-1) |
| Abonar el vuelto a la cuenta | ausente | ❌ muerta (M-6) | ninguno |
| Aviso de confusión de moneda | ✅ | ❌ | básico |
| Aviso de exceder fondo de caja | ✅ | ❌ (props ignorados) | básico |
| Bloqueo por tasa inválida | ✅ | ❌ | básico |
| Cashea: activación | ❌ automática (M-1) | ✅ manual | POS |
| Cashea: exige cliente | implícita (switch deshabilitado) | ✅ explícita + toast | POS |
| Venta a crédito | inferida por `remainingUsd` | selector de modo explícito | POS más claro |
| Validación de referencias de pago | ❌ | ✅ ([index.jsx:282-287](src/components/Sales/CheckoutModalPOS/index.jsx#L282-L287)) | POS |
| Autorrelleno correcto con Cashea | ❌ solo en Bs (A-1) | ❌ solo en Bs (A-1) | ninguno |

**Lectura:** ningún modo domina. El básico tiene las guardas de seguridad; el POS tiene la corrección de datos y la claridad de flujo. Un usuario que cambia de modo pierde protecciones sin ningún aviso.

---

## Lo que sí está correcto

Verificado y sin objeciones:

- **`withLock('pos_write_lock')`** envuelve toda la escritura de venta + stock + cliente. La numeración de ventas y la deducción de inventario son atómicas frente a doble click.
- **`deepFreeze`** sobre la venta persistida y sobre `updatedProducts` / `updatedCustomers`: previene mutación posterior de registros financieros.
- **Guarda de drift USD/Bs** ([checkoutProcessor.js:62-66](src/utils/checkoutProcessor.js#L62-L66)): rechaza la venta si `totalBs` no coincide con `totalUsd × tasa` dentro de la tolerancia. Cierra la puerta a totales manipulados.
- **Guarda de vuelto anómalo** ([81-87](src/utils/checkoutProcessor.js#L81-L87)): bloquea vueltos > 5× el total. Correcta en su intención — su calibración es la que falla con Doble Precio (A-5) y no cubre C-2.
- **Exigencia de cliente** para fiado y Cashea ([76-78](src/utils/checkoutProcessor.js#L76-L78)): validada en el procesador, no solo en la UI, así que ambos modos quedan cubiertos.
- **Rechazo de ventas de $0** y de `NaN` en totales ([48-53](src/utils/checkoutProcessor.js#L48-L53)).
- **Relectura fresca de productos** antes de deducir stock ([181](src/utils/checkoutProcessor.js#L181)) — el patrón correcto, que solo falta replicar en clientes (M-3).
- **`isProcessingRef`** ([useCheckoutFlow.js:19-23](src/hooks/useCheckoutFlow.js#L19-L23)): candado síncrono contra doble envío, además del `isProcessing` de estado.
- **Deducción de stock por peso / unidad / paquete** ([189-193](src/utils/checkoutProcessor.js#L189-L193)) y auditoría de stock negativo ([206-213](src/utils/checkoutProcessor.js#L206-L213)).

---

## Orden de corrección sugerido

1. **C-1** — es el que corrompe el cierre de caja de todos los días y anula su valor como control. Un solo arreglo cubre los dos modos si se normaliza en el procesador.
2. **A-3** y **A-1** — descuadres de caja reales, alcanzables con gestos normales del operador.
3. **C-2** — requiere tu decisión de negocio antes de tocar código.
4. **A-2** y **A-4** — capacidad rota y número engañoso frente al cliente.
5. **A-5**, **M-3** — integridad de auditoría y de saldos bajo concurrencia.
6. **M-1**, **M-2** — paridad de guardas entre modos.
7. **M-4**, **M-6** y los 🔵 — deuda técnica; barata de saldar junto con lo anterior.

## Fuera de alcance de esta auditoría

- El módulo Cashea end-to-end: ya cubierto en [`AUDITORIA-CASHEA.md`](AUDITORIA-CASHEA.md) y con plan ejecutable en [`PLAN-FIXEO-CASHEA.md`](PLAN-FIXEO-CASHEA.md). Los hallazgos de aquí que tocan Cashea (A-1, A-3, M-1) son **adicionales** a ese plan, no duplicados; A-3 y el `sumR` de la Fase 4 de aquel plan viven en las mismas líneas y conviene coordinarlos.
- Impresión de recibos y `ReceiptModal`.
- Sincronización multi-dispositivo (M-3 se describe como carrera local entre pestañas).
- Responsividad de los modales.
