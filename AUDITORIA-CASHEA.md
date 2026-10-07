# Auditoría E2E — Módulo Cashea

**Fecha:** 2026-08-04
**Alcance:** flujo completo Cashea — configuración → checkout (ambos modos) → persistencia de venta → impacto en cliente → breakdown de pagos → arqueo de caja → dashboard → reportes → cobranza de la deuda.
**Método:** análisis de código + ejecución de los módulos financieros reales (`FinancialEngine`, `financialLogic`) contra ventas Cashea sintéticas vía Vitest.
**Estado:** este documento es el REPORTE. No contiene cambios de código; es el insumo para el plan de fixeo.

---

> ## 🔴 ADENDA (posterior) — LEER ANTES DE ACTUAR SOBRE ESTE REPORTE
>
> Este reporte se escribió **antes** de confirmar el modelo de negocio. Ya se confirmó:
> **Cashea le remesa a la bodega; el cliente NO le debe ese dinero.**
>
> Con eso, **el hallazgo B deja de ser un bug.** `procesarImpactoCliente` es correcto: un
> cliente que no debe nada y entrega $60 debe quedar con `favor: 60`. El defecto real es
> que la UI presenta la `casheaDeuda` como deuda del cliente e induce al operador a
> registrar un abono improcedente — es un fix de presentación, no de lógica financiera.
>
> **NO modifiques `financialLogic.js` para que `vueltoParaMonedero` amortice `casheaDeuda`.**
>
> También se detectó después un defecto adicional no listado abajo: **anular una
> `VENTA_CASHEA` no revierte la `casheaDeuda`** (`voidSaleProcessor.js` solo devuelve
> `deuda` y `favor`), dejando la cuenta por cobrar viva para siempre.
>
> **El plan ejecutable, ya corregido con todo esto, es [`PLAN-FIXEO-CASHEA.md`](PLAN-FIXEO-CASHEA.md).**
> Usa este reporte como diagnóstico; usa el plan como fuente de verdad para ejecutar.

---

## 0. Nota de método y limitación

Los hallazgos A, C y E fueron **verificados ejecutando el código real**, no solo leyéndolo: se montó una sonda Vitest (`tests/_audit_cashea.test.js`, ya eliminada) que importa `procesarImpactoCliente` y `FinancialEngine.calculatePaymentBreakdown` y los corre contra una venta Cashea de $100 (40% inicial en efectivo USD, 60% financiado). **Los 10 asserts pasaron**, es decir: el comportamiento defectuoso descrito abajo es el comportamiento real, reproducible.

**Limitación:** la verificación E2E en navegador (hacer la venta clickeando la UI) **no se completó**. Tras habilitar `cashea_enabled` en localStorage y recargar, la app cayó a la pantalla de login "Conectar Punto de Venta" y no dispongo de credenciales. Los hallazgos B, D, F y G son por análisis estático de código, no por observación en runtime.

Reproducir la sonda:

```js
// tests/_audit_cashea.test.js
import { procesarImpactoCliente } from '../src/utils/financialLogic';
import { FinancialEngine } from '../src/core/FinancialEngine';

it('un ABONO de $60 NO baja casheaDeuda y crea $60 de favor fantasma', () => {
    const tras = procesarImpactoCliente(
        { id: 'c1', deuda: 0, favor: 0, casheaDeuda: 60 },
        { esCredito: false, deudaGenerada: 0, vueltoParaMonedero: 60 },
    );
    expect(tras.casheaDeuda).toBe(60); // sigue debiendo
    expect(tras.favor).toBe(60);       // y el sistema ahora le debe $60
});
```

---

## 1. Lo que SÍ funciona correctamente

Antes de los defectos, lo verificado como sano — para que el plan de fixeo no toque lo que ya está bien:

| # | Área | Evidencia |
|---|---|---|
| 1 | **Cálculo del monto financiado** | `useCheckoutCalculations.js:88-91` — `casheaAmountUsd = round2(mulR(cartTotalUsd, (100 - casheaPercent) / 100))`. Usa los helpers de dinero, sin drift IEEE754. |
| 2 | **Gate de confirmación** | `useCheckoutCalculations.js:103` exige que el pagado cubra la cuota inicial antes de permitir confirmar. |
| 3 | **Tipo de venta** | `checkoutProcessor.js:90` marca `VENTA_CASHEA` correctamente y `:155` persiste `casheaUsd` en la venta. |
| 4 | **Arqueo / cierre de caja NO se contamina** | `CierreCajaWizard.jsx:89-91` lee claves explícitas `efectivo_usd` / `efectivo_bs` / `efectivo_cop`. Verificado con la sonda: en la venta de $100 el esperado en caja es **$40** (solo la inicial), no $100. **No hay faltante fantasma en el arqueo.** |
| 5 | **Dashboard — desglose de pagos** | `DashboardPaymentBreakdown.jsx:12` sí excluye Cashea: `(d.currency === 'FIADO' \|\| method === 'cashea')`. |
| 6 | **Recibo e historial** | `ReceiptModal.jsx:249-259` y `SalesHistory.jsx:277-283` muestran inicial vs. financiado correctamente. |
| 7 | **Guarda de borrado de cliente** | `CustomersView.jsx:521-522` impide eliminar un cliente con `casheaDeuda > 0.005`. |

---

## 2. Hallazgos, por severidad

### 🔴 A — CRÍTICO: la deuda Cashea es un estado irreversible; no existe cobranza

**Archivos:** `src/views/CustomersView.jsx:172-180`, `:501-502`, `:755`

Hay una función `handleSaldarCashea` que salda la deuda, y se pasa al detalle del cliente como prop `onSaldarCashea`. **Pero esa prop nunca se invoca dentro de `CustomerDetailSheet`.** Verificado: `grep -n "onSaldarCashea" src/views/CustomersView.jsx` devuelve exactamente dos líneas — la declaración del parámetro (755) y el paso de la prop (501). Cero llamadas.

Consecuencia: **una vez hecha una venta Cashea, la `casheaDeuda` del cliente no se puede eliminar por ningún camino normal de la UI.** El panel morado "Deuda Cashea" (`:862-869`) es puramente informativo, sin botón.

Las únicas salidas son:
- **"Poner en 0"** (`:164`, solo admin) — que borra `deuda`, `favor` **y** `casheaDeuda` de un plumazo, sin registrar dinero ni monto en la auditoría. Instrumento romo: para limpiar una deuda Cashea de $60 hay que destruir también el saldo a favor y la deuda fiada del cliente.
- Nada más. Y borrar al cliente está bloqueado mientras deba (hallazgo #7 de la tabla anterior).

Y aunque la función se llegara a cablear, **está mal**: `handleSaldarCashea` solo hace `{ ...customer, casheaDeuda: 0 }`. No crea registro `COBRO_DEUDA`, no mete el dinero al breakdown de pagos, no acepta pagos parciales, y el `auditLog` no guarda el monto. El dinero que Cashea le remesa al comerciante **nunca entra al sistema**.

Contraste con el camino correcto que ya existe: `customerTransactionProcessor.js:15-75` para `ABONO` sí arma `{ costoTotal: 0, pagoReal: amountUsd, vueltoParaMonedero: amountUsd }` y crea una venta `COBRO_DEUDA` real. **Ese procesador no puede apuntar a `casheaDeuda`.**

---

### 🔴 B — CRÍTICO: un abono normal no paga Cashea y genera saldo a favor fantasma

**Archivo:** `src/utils/financialLogic.js:27-48`

`procesarImpactoCliente` enruta `vueltoParaMonedero` a `cliente.deuda` primero y el sobrante a `cliente.favor`. **Nunca toca `casheaDeuda`.** Y la normalización final (`:50-59`) calcula `saldoNeto = favor - deuda`, dejando `casheaDeuda` fuera de la ecuación por completo.

Verificado con la sonda: un cliente que solo debe $60 de Cashea y abona $60 termina con **`casheaDeuda: 60` Y `favor: 60`**. La bodega queda debiéndole $60 al cliente que acaba de pagar, y la deuda sigue en pie. Doble error contable en una sola operación.

Este es el workaround que un usuario intentaría naturalmente al descubrir el hallazgo A ("uso Ajustar Cuenta → Abono"), y es peor que no hacer nada.

---

### 🟠 C — ALTO: Reportes cuenta Cashea como dólares cobrados; Dashboard no. Se contradicen

**Archivos:** `src/components/Reports/ReportsMetricsTab.jsx:353-368` vs. `src/components/Dashboard/DashboardPaymentBreakdown.jsx:12`

```js
// ReportsMetricsTab.jsx:353-355  ← le falta el caso cashea
const fiadoMethods = allEntries.filter(([, d]) => d.currency === 'FIADO' && !d.isChange);
const usdMethods   = allEntries.filter(([, d]) => d.currency === 'USD'   && !d.isChange);
```

El bucket `cashea` tiene `currency: 'USD'` (ver hallazgo D), así que cae en `usdMethods`. Verificado con la sonda: en la venta de $100 el **subtotal USD reportado es $100 cuando lo realmente cobrado en dólares fue $40**.

`DashboardPaymentBreakdown.jsx:12` sí lo excluye con `|| method === 'cashea'`. Resultado: **Dashboard y Reportes muestran cifras distintas sobre los mismos datos**, lo que destruye la confianza del usuario en ambos.

---

### 🟠 D — ALTO (causa raíz de C): `FinancialEngine` no tiene rama `VENTA_CASHEA`

**Archivo:** `src/core/FinancialEngine.js:153-311`

`calculatePaymentBreakdown` tiene ramas explícitas para `APERTURA_CAJA`, `AVANCE_EFECTIVO`, `VENTA_FIADA` y `COBRO_DEUDA`. `VENTA_FIADA` marca su bucket con `currency: 'FIADO'` — el marcador de "por cobrar" que el resto del sistema usa para no confundirlo con dinero real (`:228-235`).

**No hay rama `VENTA_CASHEA`.** La venta cae al bucle genérico de pagos (`:266-311`), donde el pago virtual Cashea (`currency: 'USD'`) produce `breakdown['cashea'] = { currency: 'USD' }`. Un por-cobrar disfrazado de dólar cobrado.

Arreglar esto en el origen (emitir `currency: 'FIADO'` o un marcador `isReceivable`) resuelve C automáticamente y blinda cualquier consumidor futuro que filtre por `currency`, en lugar de parchear cada pantalla una por una.

Efecto secundario menor: el label queda en `'Cashea'` y no en `'Cashea (Por Cobrar)'` — `:277-280` prioriza `p.methodLabel` (que vale `'Cashea'`) sobre `_resolveMethodLabel`, así que la etiqueta correcta de `paymentMethods.js:199` nunca se usa. Cosmético, pero elimina la única señal visual de que no es dinero cobrado.

---

### 🟡 MEDIO — E: venta mixta Cashea + Fiado descarta el fiado

**Archivo:** `src/utils/checkoutProcessor.js:227`

```js
const deudaParaCliente = casheaUsd > 0 ? casheaUsd : fiadoAmountUsd;
```

Es un `if/else`, no una suma. Si una venta tuviera $60 de Cashea y $25 de fiado, **los $25 de fiado se evaporan**: no se le cargan al cliente. Verificado con la sonda.

Latente hoy: ambas UIs de checkout bloquean llegar a ese estado (POS fuerza `modo='contado'` cuando Cashea está activo, `CheckoutModalPOS/index.jsx:370-375`). Pero es una bomba de tiempo — cualquier relajación futura de ese guard convierte esto en pérdida silenciosa de dinero. El fix es de una línea.

---

### 🟡 MEDIO — F: "Por Cobrar" del dashboard mezcla dos deudas de naturaleza distinta

**Archivos:** `src/hooks/useDashboardMetrics.js:126-133`, `src/components/Dashboard/DashboardStats.jsx:299-301`

```js
const totalUsd = sumR(deudores.map(c => sumR(c.deuda || 0, c.casheaDeuda || 0)));
```

Se suma la deuda fiada (que **el cliente** le debe a la bodega) con la deuda Cashea (que **Cashea** le debe a la bodega). Son contrapartes distintas, con riesgo de cobro y plazos distintos.

Agravante: combinado con A, este total **solo crece**. Nunca baja, porque no existe mecanismo de cobranza. El indicador "Por Cobrar" se degrada monotónicamente hasta volverse inútil.

---

### 🟢 BAJO — G: asimetría de guardas entre los dos modos de checkout

**Archivos:** `src/views/SalesView.jsx:957-959`, `CheckoutModalPOS/index.jsx:276-278`, `useCheckoutCalculations.js`

`SalesView` elige en runtime entre `CheckoutModalPOS` y `CheckoutModal` según `effectiveCheckoutMode`. **Ambos implementan Cashea por separado**, y no igual:

| | Modo POS | Modo básico |
|---|---|---|
| Toast "Selecciona un cliente" | Sí (`:276-278`) | No — depende del error de `checkoutProcessor:76` |
| Fuerza `modo='contado'` | Sí (`:370-375`) | No aplica |
| Cálculo de `amountBs` | `casheaAmountUsd * tasaSegura` (multiplicación cruda) | `mulR(casheaAmountUsd, safeRate)` |

La divergencia en `amountBs` puede introducir centavos de drift en el modo POS. La lógica duplicada garantiza que todo fix de Cashea deba aplicarse dos veces, o quedará a medias.

---

## 3. Resumen del estado del flujo E2E

```
Configuración (cashea_enabled)          ✅ OK
   ↓
Checkout — cálculo del financiado       ✅ OK
   ↓
Checkout — guardas / cliente requerido  🟢 asimétrico entre modos  (G)
   ↓
Venta persistida (VENTA_CASHEA)         ✅ OK
   ↓
Impacto cliente (casheaDeuda += X)      ✅ OK
   ↓
Breakdown de pagos                      🟠 emitido como USD cobrado  (D)
   ↓
Arqueo / cierre de caja                 ✅ OK — no se contamina
   ↓
Dashboard                               ⚠️ excluye Cashea del desglose, pero lo suma en "Por Cobrar"  (F)
   ↓
Reportes                                🟠 lo cuenta como USD cobrado — contradice al Dashboard  (C)
   ↓
COBRANZA DE LA DEUDA                    🔴 NO EXISTE  (A)
   ↓ (intento con Abono)
Abono normal                            🔴 no baja la deuda + crea favor fantasma  (B)
```

**El módulo funciona correctamente hasta el momento de la venta. Todo lo que viene después del cobro de la cuota inicial está roto o ausente.**

---

## 4. Orden sugerido para el plan de fixeo

Las dependencias entre hallazgos dictan el orden — arreglar en otro orden implica retrabajo:

1. **D primero** (causa raíz). Añadir rama `VENTA_CASHEA` en `FinancialEngine.calculatePaymentBreakdown` que emita el bucket con marcador de por-cobrar. Esto **resuelve C solo** y protege a consumidores futuros.
2. **C** — verificar que `ReportsMetricsTab` ya quede correcto tras (1); si el marcador elegido no es `currency:'FIADO'`, ajustar el filtro.
3. **B** — extender `procesarImpactoCliente` para que `vueltoParaMonedero` pueda amortizar `casheaDeuda`, y meter `casheaDeuda` en la normalización final. Es prerrequisito de (4).
4. **A** — construir la cobranza real: extender `customerTransactionProcessor` con un tipo que apunte a `casheaDeuda`, generando `COBRO_DEUDA` con monto (parciales incluidos), y **cablear el botón** en `CustomerDetailSheet`. Retirar o rehacer `handleSaldarCashea`.
5. **E** — cambiar el ternario de `checkoutProcessor.js:227` por una suma. Una línea.
6. **F** — separar "Por Cobrar Clientes" de "Por Cobrar Cashea" en el dashboard. Cosmético hasta que (4) exista; después, necesario para que el indicador baje.
7. **G** — unificar las guardas Cashea de ambos modos de checkout, idealmente extrayendo la lógica compartida.

**Regla transversal:** todo fix debe aplicarse en los **dos** modos de checkout (POS y básico) — ver hallazgo G.

**Pendiente de decisión de negocio antes de (4):** ¿la deuda Cashea la cobra la bodega al cliente, o Cashea le remesa a la bodega? El modelo de datos actual la guarda en el cliente, lo que sugiere lo primero, pero el producto Cashea real funciona de la segunda forma. La respuesta cambia el diseño de la cobranza y la ubicación del indicador en el dashboard.
