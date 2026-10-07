# PLAN DE FIXEO — MÓDULO CASHEA

**Documento ejecutable.** Escrito para que un LLM de baja capacidad (o cualquier IDE agéntico) lo ejecute paso a paso sin ambigüedad.
**Reporte de origen:** [`AUDITORIA-CASHEA.md`](AUDITORIA-CASHEA.md)
**Fecha:** 2026-08-04

---

## §0. DECISIÓN DE NEGOCIO QUE GOBIERNA TODO ESTE PLAN

> **Cashea le remesa a la bodega. El cliente NO le debe ese dinero a la bodega.**

Consecuencias, y todo el plan se deriva de esto:

1. `customer.casheaDeuda` **NO es una deuda del cliente**. Es una **cuenta por cobrar A CASHEA**, guardada en el registro del cliente solo como trazabilidad de qué venta la originó.
2. El cliente ya pagó su parte (la cuota inicial) en el momento de la venta. **Está al día.**
3. Cobrar esa cuenta = registrar la **remesa que Cashea envía**, no un abono del cliente.
4. Cualquier texto de UI que le diga al cliente que "debe" ese monto es **factualmente falso** y debe eliminarse.

### ⚠️ RECLASIFICACIÓN OBLIGATORIA DEL HALLAZGO B

El reporte de auditoría, escrito **antes** de conocer esta decisión, listaba como bug crítico:

> "B — un abono normal no paga Cashea y genera saldo a favor fantasma"

**Con la decisión de negocio confirmada, B NO ES UN BUG.** `procesarImpactoCliente` se comporta correctamente: un cliente que no debe nada y entrega $60 **debe** quedar con `favor: 60`. El defecto real es que la UI le presenta al operador la `casheaDeuda` como si fuera deuda del cliente, induciéndolo a registrar un abono que no corresponde. **El fix es de presentación (Fase 8), no de lógica financiera.**

🔴 **GUARDARRAÍL CRÍTICO:** si estás ejecutando este plan y leíste el reporte de auditoría, **NO** modifiques `procesarImpactoCliente` para que `vueltoParaMonedero` amortice `casheaDeuda`. Ese cambio sería incorrecto y silenciosamente destruiría dinero del cliente. Ver §1.

---

## §1. LISTA DE "NO TOCAR" (guardarraíles duros)

Estos archivos/bloques están **verificados como correctos**. Modificarlos introduce regresiones. Si tu razonamiento te lleva a cambiarlos, tu razonamiento está mal — relee §0.

| # | Ubicación | Por qué NO se toca |
|---|---|---|
| G1 | `src/utils/financialLogic.js` — bloque `vueltoParaMonedero` (líneas ~27-48) | Correcto bajo el modelo de remesa. Ver §0. |
| G2 | `src/utils/financialLogic.js` — normalización `saldoNeto = favor - deuda` (~50-59) | `casheaDeuda` NO debe entrar aquí: no es saldo del cliente. |
| G3 | `src/utils/financialLogic.js` — rama `if (esCashea)` que suma a `casheaDeuda` (~20-22) | Genera la cuenta por cobrar correctamente. |
| G4 | `src/components/Dashboard/CierreCajaWizard.jsx:89-91` | Usa claves `efectivo_*` explícitas. **El arqueo NO está contaminado.** Verificado ejecutando el código. |
| G5 | `src/components/Dashboard/DashboardPaymentBreakdown.jsx:12` y `:14` | Ya excluye Cashea correctamente. Es el patrón de referencia a copiar, no a cambiar. |
| G6 | `src/utils/checkoutProcessor.js:90` (`tipoVenta`) y `:155` (`casheaUsd`) | Marcan y persisten la venta correctamente. |
| G7 | `src/hooks/useCheckoutCalculations.js:88-91` (`casheaAmountUsd`) | Usa `mulR`/`round2`. Aritmética correcta. |
| G8 | Cualquier archivo bajo `src/testing/` | Es el certificador del sistema. No se ajusta para que pase; se ajusta el código. |

---

## §2. CONVENCIONES DE EJECUCIÓN (leer antes de la Fase 0)

1. **Ejecuta las fases EN ORDEN.** Hay dependencias explícitas. No saltes fases.
2. **Antes de cada edición**, corre el comando `VERIFICAR ANCLAJE`. Debe imprimir **exactamente el conteo indicado**.
   - Si imprime **`0`** → el archivo cambió respecto a este plan. **ABORTA la fase y reporta al humano.** No improvises un anclaje alternativo.
   - Si imprime **más de lo indicado** → el anclaje es ambiguo. **ABORTA y reporta.** No uses "reemplazar todo".
3. **Las ediciones son reemplazo literal de texto.** Copia el bloque `BUSCAR` carácter por carácter, incluida la indentación (todos los archivos usan **4 espacios**, nunca tabs).
4. **Nunca uses `sed -i`** en este repo: hay rutas con espacios y los bloques contienen `|`, `/` y `$`. Usa la herramienta de edición de tu IDE.
5. **Después de cada fase**, corre el comando `VERIFICAR FASE`. Si falla, ejecuta el `ROLLBACK` de esa fase y reporta. No avances con una fase en rojo.
6. **No reformatees** archivos que tocas. Nada de `prettier --write` sobre archivos completos.
7. **No renombres** `casheaDeuda`. Un rename del campo persistido rompería los datos de todos los usuarios en producción. Se mantiene el nombre y se corrige la **semántica en la UI**.

---

## FASE 0 — PRE-VUELO

**Objetivo:** rama limpia y baseline registrado, para poder distinguir "lo rompí yo" de "ya estaba roto".

### Paso 0.1 — Rama

```bash
git checkout -b fix/cashea-remesa-e2e
git status --short
```

> ℹ️ Es normal ver `M src/hooks/useRemoteCommands.js` y `M src/views/OwnerMonitorView.jsx` — son cambios preexistentes ajenos a Cashea. **Déjalos como están, no los revertas ni los incluyas en los commits de este plan.**

### Paso 0.2 — Baseline de tests

```bash
npm test 2>&1 | tail -8
```

**Baseline esperado y ya medido (2026-08-04):**

```
 Test Files  8 passed (9)
      Tests  123 passed | 10 skipped (169)
     Errors  1 error
```

> ⚠️ **Ese `1 error` es PREEXISTENTE** (un rechazo no manejado fuera de los asserts, no un test en rojo). **No es tu culpa y no lo arregles en este plan.** El criterio de éxito al final es: `123 + los nuevos` pasando, y **no más de 1 error**.

### Paso 0.3 — Verificar los 8 anclajes de una vez

```bash
grep -c "if (sale.tipo === 'COBRO_DEUDA') {" src/core/FinancialEngine.js
grep -c "currency: p.currency || 'BS'," src/core/FinancialEngine.js
grep -c "const deudaParaCliente = casheaUsd > 0 ? casheaUsd : fiadoAmountUsd;" src/utils/checkoutProcessor.js
grep -c "const isCobroDeuda = sale.tipo === 'COBRO_DEUDA';" src/utils/voidSaleProcessor.js
grep -c "return { ...c, deuda: newDeuda, favor: newFavor };" src/utils/voidSaleProcessor.js
grep -c "const handleSaldarCashea = async (customer) => {" src/views/CustomersView.jsx
grep -c "msg += \`\*Financiamiento Cashea:\* Debe \*\\\$" src/views/CustomersView.jsx
grep -c "const totalUsd = sumR(deudores.map(c => sumR(c.deuda || 0, c.casheaDeuda || 0)));" src/hooks/useDashboardMetrics.js
```

**Los 8 deben imprimir `1`.** Si alguno imprime `0`, **ABORTA todo el plan** y reporta cuál falló.

### ROLLBACK Fase 0
```bash
git checkout main && git branch -D fix/cashea-remesa-e2e
```

---

## FASE 1 — ARNÉS DE TESTS (red antes de green)

**Objetivo:** escribir los tests que definen el comportamiento OBJETIVO. **Deben FALLAR ahora.** Esa falla es la prueba de que el arnés mide algo real.

### Paso 1.1 — Crear `tests/cashea.test.js`

**Crea un archivo nuevo** con exactamente este contenido:

```js
// Arnés de regresión del módulo Cashea.
// MODELO DE NEGOCIO: Cashea le remesa a la bodega. El monto financiado es una
// CUENTA POR COBRAR A CASHEA, no dinero cobrado ni deuda del cliente.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { procesarImpactoCliente } from '../src/utils/financialLogic';

const RATE = 40;

/** Venta Cashea $100: 40% inicial en efectivo USD, 60% financiado por Cashea. */
function ventaCashea() {
    return {
        id: 'v-cashea-1',
        tipo: 'VENTA_CASHEA',
        rate: RATE,
        totalUsd: 100,
        totalBs: 4000,
        casheaUsd: 60,
        changeUsd: 0,
        changeBs: 0,
        payments: [
            { id: 'p1', methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 40, amountBs: 1600 },
            { id: 'p2', methodId: 'cashea', methodLabel: 'Cashea', currency: 'USD', amountUsd: 60, amountBs: 2400, isCashea: true, casheaPercent: 60 },
        ],
    };
}

/** Remesa de Cashea por $60, recibida en efectivo USD. */
function remesaCashea(monto = 60) {
    return {
        id: 'r-cashea-1',
        tipo: 'COBRO_CASHEA',
        rate: RATE,
        totalUsd: monto,
        totalBs: monto * RATE,
        changeUsd: 0,
        changeBs: 0,
        vueltoParaMonedero: 0,
        payments: [
            { methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amount: monto, amountUsd: monto, amountBs: monto * RATE },
        ],
    };
}

describe('Cashea — el financiado es una cuenta por cobrar, no ingreso', () => {
    const bd = FinancialEngine.calculatePaymentBreakdown([ventaCashea()]);

    it('crea el bucket cashea con el monto financiado', () => {
        expect(bd.cashea).toBeDefined();
        expect(bd.cashea.total).toBe(60);
    });

    it('marca el bucket como por-cobrar, NO como USD cobrado', () => {
        expect(bd.cashea.currency).toBe('FIADO');
        expect(bd.cashea.isReceivable).toBe(true);
    });

    it('lo etiqueta como "Cashea (Por Cobrar)"', () => {
        expect(bd.cashea.label).toBe('Cashea (Por Cobrar)');
    });

    it('el filtro de Reportes ya NO lo suma al neto USD', () => {
        // Réplica del filtro de ReportsMetricsTab.jsx
        const entries = Object.entries(bd).filter(([, d]) => d.total > 0);
        const usdMethods = entries.filter(([m, d]) => d.currency === 'USD' && m !== 'cashea' && !d.isChange);
        const subtotalUsd = usdMethods.reduce((s, [, d]) => s + d.total, 0);
        expect(subtotalUsd).toBe(40);
    });

    it('el arqueo de caja sigue esperando solo la inicial (no-regresión)', () => {
        const expectedUsd = (bd['efectivo_usd']?.total || 0) - (bd['_vuelto_usd']?.total || 0);
        expect(expectedUsd).toBe(40);
    });
});

describe('Cashea — la remesa cancela la cuenta por cobrar', () => {
    const bd = FinancialEngine.calculatePaymentBreakdown([ventaCashea(), remesaCashea(60)]);

    it('venta + remesa completa => por cobrar neto 0 (bucket filtrado)', () => {
        expect(!bd.cashea || bd.cashea.total === 0).toBe(true);
    });

    it('el dinero de la remesa SÍ entra como efectivo cobrado', () => {
        expect(bd['efectivo_usd'].total).toBe(100); // 40 inicial + 60 remesa
    });

    it('remesa parcial deja el remanente por cobrar', () => {
        const parcial = FinancialEngine.calculatePaymentBreakdown([ventaCashea(), remesaCashea(25)]);
        expect(parcial.cashea.total).toBe(35);
        expect(parcial.cashea.currency).toBe('FIADO');
    });
});

describe('Cashea — la lógica de cliente NO cambia (guardarraíl anti-regresión)', () => {
    it('la venta Cashea genera casheaDeuda, no deuda', () => {
        const c = procesarImpactoCliente(
            { id: 'c1', deuda: 0, favor: 0, casheaDeuda: 0 },
            { esCredito: true, esCashea: true, deudaGenerada: 60 },
        );
        expect(c.casheaDeuda).toBe(60);
        expect(c.deuda).toBe(0);
    });

    it('G1: un abono del cliente NUNCA toca casheaDeuda (el cliente no la debe)', () => {
        const c = procesarImpactoCliente(
            { id: 'c1', deuda: 0, favor: 0, casheaDeuda: 60 },
            { esCredito: false, deudaGenerada: 0, vueltoParaMonedero: 60 },
        );
        expect(c.casheaDeuda).toBe(60); // intacta: es plata de Cashea, no del cliente
        expect(c.favor).toBe(60);       // correcto: el cliente entregó $60 sin deber nada
    });
});
```

### Paso 1.2 — VERIFICAR FASE 1 (deben FALLAR)

```bash
npx vitest run tests/cashea.test.js 2>&1 | tail -20
```

**Resultado esperado: 4 tests FALLAN**, específicamente:
- `marca el bucket como por-cobrar` → recibe `'USD'`, espera `'FIADO'`
- `lo etiqueta como "Cashea (Por Cobrar)"` → recibe `'Cashea'`
- `venta + remesa completa => por cobrar neto 0` → recibe `false`
- `remesa parcial deja el remanente` → recibe `60`, espera `35`

Los demás pasan. **Si TODOS pasan, el arnés no está midiendo nada → ABORTA y reporta.**

### ROLLBACK Fase 1
```bash
rm tests/cashea.test.js
```

---

## FASE 2 — `FinancialEngine`: marcar Cashea como por-cobrar

**Objetivo:** causa raíz. Emitir el bucket `cashea` con metadatos de cuenta por cobrar, y restar las remesas.
**Archivo:** `src/core/FinancialEngine.js`

### Edición 2.A — bucket con metadatos correctos

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "currency: p.currency || 'BS'," src/core/FinancialEngine.js
```

**BUSCAR:**
```js
                        breakdown[p.methodId] = {
                            total: 0,
                            currency: p.currency || 'BS',
                            label: resolvedLabel
                        };
```

**REEMPLAZAR POR:**
```js
                        // CASHEA: el financiador remesa a la bodega. El monto financiado
                        // es una CUENTA POR COBRAR, no dinero cobrado. Se marca con
                        // currency 'FIADO' + isReceivable para que ningún consumidor que
                        // filtre por `currency` lo sume como ingreso USD del período.
                        const isCasheaBucket = p.methodId === 'cashea';
                        breakdown[p.methodId] = {
                            total: 0,
                            currency: isCasheaBucket ? 'FIADO' : (p.currency || 'BS'),
                            label: isCasheaBucket ? 'Cashea (Por Cobrar)' : resolvedLabel,
                            ...(isCasheaBucket && { isReceivable: true })
                        };
```

> **Por qué aquí y no en una rama `if (sale.tipo === 'VENTA_CASHEA')`:** marcar el bucket en el punto de creación cubre también ventas legacy que traen un pago `cashea` sin el `tipo` correcto. El monto lo sigue sumando el bucle existente de abajo — **no se suma dos veces.**

### Edición 2.B — la remesa reduce la cuenta por cobrar

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "// Continue execution below to register the actual cash/transfer received" src/core/FinancialEngine.js
```

**BUSCAR:**
```js
                breakdown['fiado'].total = round2(breakdown['fiado'].total - round2(sale.totalUsd || 0));
                // Continue execution below to register the actual cash/transfer received
            }
```

**REEMPLAZAR POR:**
```js
                breakdown['fiado'].total = round2(breakdown['fiado'].total - round2(sale.totalUsd || 0));
                // Continue execution below to register the actual cash/transfer received
            }

            // La remesa recibida de Cashea reduce la cuenta por cobrar del período.
            // Espeja exactamente el tratamiento de COBRO_DEUDA sobre 'fiado'.
            if (sale.tipo === 'COBRO_CASHEA') {
                if (!breakdown['cashea']) {
                    breakdown['cashea'] = { total: 0, currency: 'FIADO', label: 'Cashea (Por Cobrar)', isReceivable: true };
                }
                breakdown['cashea'].total = round2(breakdown['cashea'].total - round2(sale.totalUsd || 0));
                // Continúa abajo para registrar el dinero realmente recibido.
            }
```

### VERIFICAR FASE 2

```bash
npx vitest run tests/cashea.test.js 2>&1 | tail -8
npx vitest run tests/financialEngine.test.js 2>&1 | tail -8
```

**Criterio:** `tests/cashea.test.js` → **todos pasan (0 fallos)**. `tests/financialEngine.test.js` → **sin regresiones** respecto al baseline.

### ROLLBACK Fase 2
```bash
git checkout -- src/core/FinancialEngine.js
```

---

## FASE 3 — Reportes: paridad con el Dashboard (defensa en profundidad)

**Objetivo:** que Reportes y Dashboard no puedan volver a divergir.
**Archivo:** `src/components/Reports/ReportsMetricsTab.jsx`

> ℹ️ Tras la Fase 2 el bucket ya no tiene `currency: 'USD'`, así que el bug de sobreconteo **ya está resuelto**. Esta fase hace el filtro **explícito** para que no dependa de un detalle del engine, exactamente igual que `DashboardPaymentBreakdown.jsx` (G5).

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "const usdMethods   = allEntries.filter((\[, d\]) => d.currency === 'USD' && !d.isChange);" src/components/Reports/ReportsMetricsTab.jsx
```

**BUSCAR:**
```js
                        const fiadoMethods = allEntries.filter(([, d]) => d.currency === 'FIADO' && !d.isChange);
                        const bsMethods    = allEntries.filter(([, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange);
                        const usdMethods   = allEntries.filter(([, d]) => d.currency === 'USD' && !d.isChange);
```

**REEMPLAZAR POR:**
```js
                        // Paridad literal con DashboardPaymentBreakdown.jsx: Cashea es una
                        // cuenta por cobrar (Cashea le remesa a la bodega), nunca ingreso USD.
                        const fiadoMethods = allEntries.filter(([method, d]) => (d.currency === 'FIADO' || method === 'cashea') && !d.isChange);
                        const bsMethods    = allEntries.filter(([, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange);
                        const usdMethods   = allEntries.filter(([method, d]) => d.currency === 'USD' && method !== 'cashea' && !d.isChange);
```

### VERIFICAR FASE 3
```bash
npm run lint 2>&1 | grep -i "ReportsMetricsTab" || echo "OK sin errores de lint"
```

### ROLLBACK Fase 3
```bash
git checkout -- src/components/Reports/ReportsMetricsTab.jsx
```

---

## FASE 4 — `checkoutProcessor`: venta mixta Cashea + Fiado

**Objetivo:** dejar de descartar la porción fiada. Cambio de una línea.
**Archivo:** `src/utils/checkoutProcessor.js`

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "const deudaParaCliente = casheaUsd > 0 ? casheaUsd : fiadoAmountUsd;" src/utils/checkoutProcessor.js
```

**BUSCAR:**
```js
            const deudaParaCliente = casheaUsd > 0 ? casheaUsd : fiadoAmountUsd;
```

**REEMPLAZAR POR:**
```js
            // Cashea y fiado son deudas de contrapartes distintas y coexisten:
            // el ternario anterior descartaba silenciosamente la porción fiada.
            const deudaParaCliente = sumR(casheaUsd, fiadoAmountUsd);
```

**VERIFICAR IMPORT** (debe imprimir `1`):
```bash
grep -c "^import { round2, sumR, subR, divR, mulR } from './dinero.js';" src/utils/checkoutProcessor.js
```

> ✅ `sumR` **ya está importado** en la línea 5 (nota: el import lleva extensión, `'./dinero.js'`). **NO agregues ningún import en esta fase.** Si el comando imprime `0`, ABORTA y reporta.

> ⚠️ **Limitación conocida, aceptada:** `procesarImpactoCliente` recibe un único `esCashea` booleano, así que en una venta mixta el total se cargaría a un solo bucket. **Hoy es inalcanzable**: `CheckoutModalPOS/index.jsx:370-375` fuerza `modo='contado'` cuando Cashea está activo. Este fix elimina la pérdida silenciosa de dinero; el soporte real de ventas mixtas queda fuera de alcance (§7).

### VERIFICAR FASE 4
```bash
grep -c "casheaUsd > 0 ? casheaUsd : fiadoAmountUsd" src/utils/checkoutProcessor.js
```
**Debe imprimir `0`.**

### ROLLBACK Fase 4
```bash
git checkout -- src/utils/checkoutProcessor.js
```

---

## FASE 5 — `voidSaleProcessor`: anular ventas y remesas Cashea

**Objetivo:** hoy, **anular una venta Cashea deja la cuenta por cobrar viva para siempre** — el proceso de anulación solo devuelve `deuda` y `favor`, nunca `casheaDeuda`.
**Archivo:** `src/utils/voidSaleProcessor.js`

### Edición 5.A — calcular los montos Cashea a revertir

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "const cobroAmount = isCobroDeuda ? round2(sale.totalUsd || 0) : 0;" src/utils/voidSaleProcessor.js
```

**BUSCAR:**
```js
        const isCobroDeuda = sale.tipo === 'COBRO_DEUDA';
        const cobroAmount = isCobroDeuda ? round2(sale.totalUsd || 0) : 0;

        const shouldTouchCustomer = sale.customerId
            && (fiadoAmountUsd > 0 || favorUsed > 0 || vueltoParaMonedero > 0 || cobroAmount > 0);
```

**REEMPLAZAR POR:**
```js
        const isCobroDeuda = sale.tipo === 'COBRO_DEUDA';
        const cobroAmount = isCobroDeuda ? round2(sale.totalUsd || 0) : 0;

        // CASHEA: anular la VENTA cancela la cuenta por cobrar a Cashea;
        // anular la REMESA la vuelve a abrir. Sin esto, la casheaDeuda quedaba viva
        // para siempre tras anular la venta que la originó.
        const casheaVentaUsd  = sale.tipo === 'VENTA_CASHEA'  ? round2(sale.casheaUsd || 0) : 0;
        const casheaRemesaUsd = sale.tipo === 'COBRO_CASHEA' ? round2(sale.totalUsd || 0) : 0;

        const shouldTouchCustomer = sale.customerId
            && (fiadoAmountUsd > 0 || favorUsed > 0 || vueltoParaMonedero > 0 || cobroAmount > 0
                || casheaVentaUsd > 0 || casheaRemesaUsd > 0);
```

### Edición 5.B — aplicar la reversión

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "return { ...c, deuda: newDeuda, favor: newFavor };" src/utils/voidSaleProcessor.js
```

**BUSCAR:**
```js
                // Normalización: no permitir negativos.
                if (newDeuda < 0) newDeuda = 0;
                if (newFavor < 0) newFavor = 0;

                return { ...c, deuda: newDeuda, favor: newFavor };
```

**REEMPLAZAR POR:**
```js
                // CASHEA: se revierte fuera del if/else de arriba porque es un
                // bucket independiente de deuda/favor (contraparte distinta).
                let newCasheaDeuda = round2(c.casheaDeuda || 0);
                if (casheaVentaUsd > 0)  newCasheaDeuda = subR(newCasheaDeuda, casheaVentaUsd);
                if (casheaRemesaUsd > 0) newCasheaDeuda = sumR(newCasheaDeuda, casheaRemesaUsd);

                // Normalización: no permitir negativos.
                if (newDeuda < 0) newDeuda = 0;
                if (newFavor < 0) newFavor = 0;
                if (newCasheaDeuda < 0) newCasheaDeuda = 0;

                return { ...c, deuda: newDeuda, favor: newFavor, casheaDeuda: newCasheaDeuda };
```

**VERIFICAR IMPORTS** (debe imprimir `1`):
```bash
grep -c "^import { divR, subR, sumR, round2 } from './dinero';" src/utils/voidSaleProcessor.js
```

> ✅ `round2`, `subR` y `sumR` **ya están importados** en la línea 4. **NO agregues ningún import en esta fase.** Si el comando imprime `0`, ABORTA y reporta.

### VERIFICAR FASE 5
```bash
npm run lint 2>&1 | grep -i "voidSaleProcessor" || echo "OK sin errores de lint"
npx vitest run 2>&1 | tail -6
```

### ROLLBACK Fase 5
```bash
git checkout -- src/utils/voidSaleProcessor.js
```

---

## FASE 6 — Procesador de la remesa Cashea (archivo NUEVO)

**Objetivo:** el corazón del fix. Registrar la remesa como dinero real que entra.
**Riesgo: bajo** — es un archivo nuevo, no modifica nada existente.

### Paso 6.1 — Crear `src/utils/casheaRemittanceProcessor.js`

**Crea un archivo nuevo** con exactamente este contenido:

```js
import { storageService } from './storageService';
import { divR, mulR, round2, subR } from './dinero';
import { withLock } from './withLock';
import { deepFreeze } from './deepFreeze';
import { CurrencyService } from '../services/CurrencyService';

/**
 * Registra una REMESA DE CASHEA hacia la bodega.
 *
 * MODELO: Cashea (el financiador) le paga a la bodega el monto que financió al
 * cliente. NO es un abono del cliente — el cliente ya pagó su cuota inicial en el
 * momento de la venta y no debe nada.
 *
 * Por eso este procesador:
 *   - reduce `casheaDeuda` DIRECTAMENTE, sin pasar por `procesarImpactoCliente`
 *     (esa función maneja el saldo del CLIENTE: deuda/favor, otra contraparte);
 *   - persiste `vueltoParaMonedero: 0` para que anular NO acredite saldo al cliente;
 *   - crea un registro `COBRO_CASHEA` para que el dinero entre al breakdown de pagos.
 *
 * Soporta montos parciales (una remesa puede cubrir solo parte de lo pendiente).
 */
export async function processCasheaRemittance({
    transactionAmount,
    currencyMode,
    customer,
    paymentMethod,
    bcvRate,
    tasaCop,
    copEnabled,
}) {
    const rawAmount = CurrencyService.safeParse(transactionAmount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        return { error: 'Monto inválido' };
    }

    let amountUsd = rawAmount;
    if (currencyMode === 'BS') {
        if (!bcvRate || bcvRate <= 0) return { error: 'Tasa BCV no configurada' };
        amountUsd = divR(rawAmount, bcvRate);
    }
    if (currencyMode === 'COP') {
        if (!tasaCop || tasaCop <= 0) return { error: 'Tasa COP no configurada' };
        amountUsd = divR(rawAmount, tasaCop);
    }

    if (!customer?.id) return { error: 'Cliente inválido' };

    const result = await withLock('pos_write_lock', async () => {
        const customers = await storageService.getItem('bodega_customers_v1', []);
        const actual = customers.find(c => c.id === customer.id);
        if (!actual) return { error: 'Cliente no encontrado' };

        const pendiente = round2(actual.casheaDeuda || 0);
        if (pendiente <= 0.005) {
            return { error: 'Este cliente no tiene remesa Cashea pendiente' };
        }
        if (amountUsd > pendiente + 0.01) {
            return { error: `El monto excede lo pendiente ($${pendiente.toFixed(2)})` };
        }

        // Nunca dejar casheaDeuda negativa aunque el monto exceda por redondeo.
        const aplicado = Math.min(round2(amountUsd), pendiente);

        const updatedCustomer = { ...actual, casheaDeuda: subR(pendiente, aplicado) };
        const newCustomers = customers.map(c => (c.id === customer.id ? updatedCustomer : c));
        await storageService.setItem('bodega_customers_v1', newCustomers);

        const sales = await storageService.getItem('bodega_sales_v1', []);
        const nextSaleNumber = sales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        const totalEnBs  = currencyMode === 'BS'  ? rawAmount : mulR(aplicado, bcvRate);
        const totalEnCop = currencyMode === 'COP' ? rawAmount : mulR(aplicado, tasaCop);

        const remesaRecord = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            tipo: 'COBRO_CASHEA',
            saleNumber: nextSaleNumber,
            rate: bcvRate,
            status: 'COMPLETADA',
            clienteId: customer.id,
            clienteName: customer.name,
            totalBs: totalEnBs,
            totalUsd: aplicado,
            ...(copEnabled && { totalCop: totalEnCop }),
            paymentMethod,
            payments: [{
                methodId: paymentMethod,
                amount: currencyMode === 'USD' ? aplicado : (currencyMode === 'COP' ? totalEnCop : totalEnBs),
                currency: currencyMode,
                amountUsd: aplicado,
                amountBs: totalEnBs,
                methodLabel: paymentMethod.replace('_', ' '),
            }],
            // Cero a propósito: la remesa NO genera saldo a favor del cliente.
            vueltoParaMonedero: 0,
            customerId: customer.id,
            customerName: customer.name,
            items: [{ name: `Remesa Cashea: ${customer.name}`, qty: 1, priceUsd: aplicado, costBs: 0 }],
        };
        sales.unshift(remesaRecord);
        await storageService.setItem('bodega_sales_v1', sales);

        deepFreeze(newCustomers);
        return { updatedCustomer, newCustomers, aplicado };
    });

    return result;
}
```

### Paso 6.2 — Añadir tests al arnés

**Añade al FINAL de `tests/cashea.test.js`:**

```js
// ── Procesador de remesa ────────────────────────────────────────────────────
const __mem = new Map();
vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (k, d) => (__mem.has(k) ? __mem.get(k) : d)),
        setItem: vi.fn(async (k, v) => { __mem.set(k, v); }),
    },
}));

const { processCasheaRemittance } = await import('../src/utils/casheaRemittanceProcessor');

describe('processCasheaRemittance', () => {
    beforeEach(() => {
        __mem.clear();
        __mem.set('bodega_customers_v1', [{ id: 'c1', name: 'Juan', deuda: 0, favor: 0, casheaDeuda: 60 }]);
        __mem.set('bodega_sales_v1', []);
    });

    it('remesa total deja casheaDeuda en 0 y crea el registro COBRO_CASHEA', async () => {
        const r = await processCasheaRemittance({
            transactionAmount: '60', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.error).toBeUndefined();
        expect(r.updatedCustomer.casheaDeuda).toBe(0);

        const sales = __mem.get('bodega_sales_v1');
        expect(sales).toHaveLength(1);
        expect(sales[0].tipo).toBe('COBRO_CASHEA');
        expect(sales[0].totalUsd).toBe(60);
        expect(sales[0].vueltoParaMonedero).toBe(0);
    });

    it('remesa parcial deja el remanente pendiente', async () => {
        const r = await processCasheaRemittance({
            transactionAmount: '25', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.updatedCustomer.casheaDeuda).toBe(35);
    });

    it('NO toca deuda ni favor del cliente', async () => {
        const r = await processCasheaRemittance({
            transactionAmount: '60', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.updatedCustomer.deuda).toBe(0);
        expect(r.updatedCustomer.favor).toBe(0);
    });

    it('rechaza montos que exceden lo pendiente', async () => {
        const r = await processCasheaRemittance({
            transactionAmount: '500', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.error).toBeTruthy();
        expect(__mem.get('bodega_sales_v1')).toHaveLength(0);
    });

    it('rechaza clientes sin remesa pendiente', async () => {
        __mem.set('bodega_customers_v1', [{ id: 'c1', name: 'Juan', deuda: 0, favor: 0, casheaDeuda: 0 }]);
        const r = await processCasheaRemittance({
            transactionAmount: '10', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.error).toBeTruthy();
    });
});
```

### VERIFICAR FASE 6
```bash
npx vitest run tests/cashea.test.js 2>&1 | tail -10
```
**Criterio: todos los tests pasan.**

> 🛟 **Mitigación si el mock de `storageService` falla** (p. ej. el hoisting de `vi.mock` choca con el `import` estático): mueve el bloque `vi.mock` al **tope del archivo**, justo después de los `import` de vitest. Si aun así falla, **saca este bloque de tests a `tests/casheaRemittance.test.js`** con su propio `vi.mock` al tope. No borres los asserts para "hacerlo pasar".

### ROLLBACK Fase 6
```bash
rm src/utils/casheaRemittanceProcessor.js
git checkout -- tests/cashea.test.js
```

---

## FASE 7 — Registrar `COBRO_CASHEA` en las listas de tipos

**Objetivo:** el nuevo tipo debe ser reconocido por los agregadores. **Omitir esta fase hace que las remesas no aparezcan en el cierre ni en reportes, y que "Remesa Cashea: Juan" salga como producto más vendido.**

Son 5 ediciones puntuales. En cada una, el patrón es **añadir `COBRO_CASHEA` al lado de `COBRO_DEUDA`**.

### 7.A — `src/hooks/useDashboardMetrics.js` línea ~40 (flujo de caja)

**BUSCAR:** `&& s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'PAGO_PROVEEDOR'`
**REEMPLAZAR POR:** `&& s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.tipo !== 'PAGO_PROVEEDOR'`

### 7.B — `src/hooks/useDashboardMetrics.js` línea ~143 (top productos)

**BUSCAR:** `sales.filter(s => s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'AJUSTE_ENTRADA'`
**REEMPLAZAR POR:** `sales.filter(s => s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.tipo !== 'AJUSTE_ENTRADA'`

> Sin esto, el ítem sintético `Remesa Cashea: <nombre>` contamina el ranking de productos.

### 7.C — `src/hooks/useInventoryVelocity.js` línea ~29

**BUSCAR:** `s.tipo !== 'COBRO_DEUDA' && s.status !== 'ANULADA'`
**REEMPLAZAR POR:** `s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.status !== 'ANULADA'`

### 7.D — `src/utils/reportsProcessor.js` líneas ~16 y ~123

Línea ~16 — **BUSCAR:** `&& s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'PAGO_PROVEEDOR'`
**REEMPLAZAR POR:** `&& s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.tipo !== 'PAGO_PROVEEDOR'`

Línea ~123 — **BUSCAR:** `|| s.tipo === 'COBRO_DEUDA' || s.tipo === 'PAGO_PROVEEDOR'`
**REEMPLAZAR POR:** `|| s.tipo === 'COBRO_DEUDA' || s.tipo === 'COBRO_CASHEA' || s.tipo === 'PAGO_PROVEEDOR'`

### 7.E — `src/views/DashboardView.jsx` línea ~316 (cierre de caja)

**BUSCAR:**
```js
        const validTiposParaCerrar = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA', 'COBRO_DEUDA', 'PAGO_PROVEEDOR', 'GASTO_INTERNO', 'APERTURA_CAJA', 'AVANCE_EFECTIVO'];
```
**REEMPLAZAR POR:**
```js
        const validTiposParaCerrar = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA', 'COBRO_DEUDA', 'COBRO_CASHEA', 'PAGO_PROVEEDOR', 'GASTO_INTERNO', 'APERTURA_CAJA', 'AVANCE_EFECTIVO'];
```

### 7.F — `src/views/OwnerMonitorView.jsx` línea ~321

**BUSCAR:** `|| s.tipo === 'COBRO_DEUDA' || s.tipo === 'PAGO_PROVEEDOR'`
**REEMPLAZAR POR:** `|| s.tipo === 'COBRO_DEUDA' || s.tipo === 'COBRO_CASHEA' || s.tipo === 'PAGO_PROVEEDOR'`

> ⚠️ `OwnerMonitorView.jsx` ya tiene cambios sin commitear ajenos a este plan. Edita **solo** esta línea.

### VERIFICAR FASE 7
```bash
grep -rc "COBRO_CASHEA" src/hooks/useDashboardMetrics.js src/hooks/useInventoryVelocity.js src/utils/reportsProcessor.js src/views/DashboardView.jsx src/views/OwnerMonitorView.jsx
```
**Esperado:** `useDashboardMetrics.js:2`, `useInventoryVelocity.js:1`, `reportsProcessor.js:2`, `DashboardView.jsx:1`, `OwnerMonitorView.jsx:1`.

```bash
npm run lint 2>&1 | tail -5
```

### ROLLBACK Fase 7
```bash
git checkout -- src/hooks/useDashboardMetrics.js src/hooks/useInventoryVelocity.js src/utils/reportsProcessor.js src/views/DashboardView.jsx
# OJO: NO uses git checkout en OwnerMonitorView.jsx (tiene cambios preexistentes).
# Revierte manualmente solo la línea ~321.
```

---

## FASE 8 — UI: registrar la remesa + corregir la semántica

**Objetivo:** que exista un botón, y que la UI deje de mentir diciendo que el cliente debe.
**Archivo principal:** `src/views/CustomersView.jsx`

### 8.A — Crear el modal `src/components/Customers/CasheaRemittanceModal.jsx`

**Archivo NUEVO.** Modal dedicado en vez de un tercer modo en `TransactionModal` — nuevo archivo = cero riesgo de regresión sobre Abono/Crédito.

```jsx
import React, { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Registro de la REMESA que Cashea envía a la bodega.
 * NO es un abono del cliente: el cliente ya pagó su cuota inicial.
 */
export default function CasheaRemittanceModal({
    isOpen, customer, onClose, onConfirm, activePaymentMethods = [],
}) {
    const [amount, setAmount] = useState('');
    const [currencyMode, setCurrencyMode] = useState('USD');
    const [paymentMethod, setPaymentMethod] = useState('efectivo_usd');
    const [busy, setBusy] = useState(false);

    if (!isOpen || !customer) return null;

    const pendiente = customer.casheaDeuda || 0;

    // Mismo criterio que TransactionModal: los métodos se filtran por la moneda
    // seleccionada, para no registrar un método en Bs con currencyMode USD.
    const metodosDisponibles = (activePaymentMethods || [])
        .filter(m => m.currency === currencyMode)
        .filter(m => m.id !== 'fiado' && m.id !== 'cashea' && m.id !== 'saldo_favor');

    // Si el método actual no pertenece a la moneda elegida, se usa el primero válido.
    const metodoEfectivo = metodosDisponibles.some(m => m.id === paymentMethod)
        ? paymentMethod
        : (metodosDisponibles[0]?.id || (currencyMode === 'USD' ? 'efectivo_usd' : 'efectivo_bs'));

    const handleConfirm = async () => {
        if (busy) return;
        setBusy(true);
        await onConfirm({ transactionAmount: amount, currencyMode, paymentMethod: metodoEfectivo });
        setBusy(false);
        setAmount('');
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-black text-slate-800 dark:text-white">Registrar remesa de Cashea</h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Cashea le remesa a la bodega el monto que financió a <strong>{customer.name}</strong>.
                    El cliente no debe este dinero.
                </p>

                <div className="bg-purple-50 dark:bg-purple-950/20 rounded-2xl p-3 mb-4 flex justify-between items-center">
                    <span className="text-xs font-bold uppercase text-purple-600 dark:text-purple-400">Pendiente por cobrar</span>
                    <span className="text-lg font-black text-purple-600 dark:text-purple-400">${pendiente.toFixed(2)}</span>
                </div>

                <div className="flex gap-2 mb-3">
                    {['USD', 'BS'].map(m => (
                        <button key={m} type="button" onClick={() => setCurrencyMode(m)}
                            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${currencyMode === m ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                            {m}
                        </button>
                    ))}
                </div>

                <input
                    type="number" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Monto en ${currencyMode}`}
                    className="w-full px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold mb-2 outline-none"
                />

                <button type="button" onClick={() => { setCurrencyMode('USD'); setAmount(String(pendiente.toFixed(2))); }}
                    className="w-full py-2 mb-3 text-xs font-bold text-purple-600 dark:text-purple-400 hover:underline">
                    Remesa completa (${pendiente.toFixed(2)})
                </button>

                <select value={metodoEfectivo} onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold mb-4 outline-none">
                    {(metodosDisponibles.length
                        ? metodosDisponibles
                        : [{ id: metodoEfectivo, label: currencyMode === 'USD' ? 'Efectivo $' : 'Efectivo Bs' }]
                    ).map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                </select>

                <button type="button" onClick={handleConfirm}
                    disabled={busy || !amount || parseFloat(amount) <= 0}
                    className="w-full py-3.5 rounded-xl bg-purple-600 text-white font-bold text-sm disabled:opacity-40 active:scale-95 transition-all">
                    {busy ? 'Registrando…' : 'Registrar remesa'}
                </button>
            </div>
        </div>
    );
}
```

### 8.B — Reemplazar `handleSaldarCashea` por el flujo real

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "const handleSaldarCashea = async (customer) => {" src/views/CustomersView.jsx
```

**BUSCAR:**
```js
    const handleSaldarCashea = async (customer) => {
        triggerHaptic();
        if (!customer || (customer.casheaDeuda || 0) <= 0) return;
        const updatedCustomer = { ...customer, casheaDeuda: 0 };
        const newCustomers = customers.map(c => c.id === customer.id ? updatedCustomer : c);
        await saveCustomers(newCustomers);
        showToast(`Deuda de Cashea saldada para ${customer.name}`, 'success');
        auditLog('CLIENTE', 'SALDAR_CASHEA', `Deuda Cashea saldada para ${customer.name}`);
    };
```

**REEMPLAZAR POR:**
```js
    // Registra la REMESA que Cashea envía a la bodega. Antes esto solo ponía
    // casheaDeuda en 0 sin registrar dinero, sin monto en auditoría y sin parciales
    // — y además nunca llegó a cablearse a ningún botón.
    const handleCasheaRemittance = async ({ transactionAmount, currencyMode, paymentMethod: metodo }) => {
        triggerHaptic();
        const target = casheaModalCustomer;
        if (!target) return;

        const res = await processCasheaRemittance({
            transactionAmount,
            currencyMode,
            customer: target,
            paymentMethod: metodo,
            bcvRate,
            tasaCop,
            copEnabled,
        });

        if (res?.error) {
            showToast(res.error, 'error');
            return;
        }

        await saveCustomers(res.newCustomers);
        showToast(`Remesa Cashea de $${res.aplicado.toFixed(2)} registrada para ${target.name}`, 'success');
        auditLog('CLIENTE', 'REMESA_CASHEA', `Remesa Cashea de $${res.aplicado.toFixed(2)} recibida por ${target.name}`);
        setCasheaModalCustomer(null);
    };
```

### 8.C — Estado del modal e import

**BUSCAR:**
```js
    const [transactionModal, setTransactionModal] = useState({ isOpen: false, type: null, customer: null }); // type: 'ABONO' | 'CREDITO'
```
**REEMPLAZAR POR:**
```js
    const [transactionModal, setTransactionModal] = useState({ isOpen: false, type: null, customer: null }); // type: 'ABONO' | 'CREDITO'
    const [casheaModalCustomer, setCasheaModalCustomer] = useState(null);
```

**Añade los dos imports** junto a los demás imports del archivo (al inicio):
```js
import { processCasheaRemittance } from '../utils/casheaRemittanceProcessor';
import CasheaRemittanceModal from '../components/Customers/CasheaRemittanceModal';
```

### 8.D — Cambiar la prop del sheet y montar el modal

**BUSCAR:**
```js
                onSaldarCashea={(c) => {
                    handleSaldarCashea(c);
                    setSelectedCustomer(null);
                }}
```
**REEMPLAZAR POR:**
```js
                onSaldarCashea={(c) => {
                    setCasheaModalCustomer(c);
                    setSelectedCustomer(null);
                }}
```

**Monta el modal.** Justo ANTES de `{/* Modal Unificado: Ajustar Cuenta */}`, inserta:
```jsx
            <CasheaRemittanceModal
                isOpen={!!casheaModalCustomer}
                customer={casheaModalCustomer}
                onClose={() => setCasheaModalCustomer(null)}
                onConfirm={handleCasheaRemittance}
                activePaymentMethods={activePaymentMethods}
            />

```

### 8.E — 🔴 CABLEAR EL BOTÓN (el paso que hoy falta y rompe todo)

`onSaldarCashea` se declara en `CustomerDetailSheet` pero **nunca se invoca**. Hay que renderizar el botón.

**BUSCAR** (dentro de `CustomerDetailSheet`, el panel morado informativo):
```jsx
                    {/* Deuda Cashea (Si Aplica) */}
                    {casheaDeuda > 0 && (
                        <div className="bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40 rounded-[2rem] p-4 text-center shadow-sm flex items-center justify-between px-6">
                            <div className="flex items-center gap-2">
                                <CasheaIcon size={18} />
                                <span className="text-xs font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">Deuda Cashea</span>
                            </div>
                            <span className="text-xl font-black text-purple-600 dark:text-purple-400">-${formatUsd(casheaDeuda)}</span>
                        </div>
                    )}
```

**REEMPLAZAR POR:**
```jsx
                    {/* Por Cobrar a Cashea (Si Aplica) — NO es deuda del cliente:
                        Cashea le remesa a la bodega. */}
                    {casheaDeuda > 0 && (
                        <div className="bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40 rounded-[2rem] p-4 shadow-sm space-y-3">
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-2">
                                    <CasheaIcon size={18} />
                                    <span className="text-xs font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">Por cobrar a Cashea</span>
                                </div>
                                <span className="text-xl font-black text-purple-600 dark:text-purple-400">${formatUsd(casheaDeuda)}</span>
                            </div>
                            <button
                                onClick={() => onSaldarCashea(customer)}
                                className="w-full bg-purple-600 hover:bg-purple-700 text-white rounded-[1.5rem] py-3 min-h-[48px] flex items-center justify-center gap-2 font-bold text-sm shadow-md active:scale-95 transition-all"
                            >
                                <CasheaIcon size={16} />
                                <span>Registrar remesa recibida</span>
                            </button>
                        </div>
                    )}
```

> Nota: se quitó el signo `-` del monto. No es un negativo del cliente; es dinero **a favor** de la bodega.

### 8.F — WhatsApp: dejar de decirle al cliente que debe

🔴 **El defecto más visible hacia afuera:** el estado de cuenta que se le envía al cliente por WhatsApp le dice que debe un dinero que **no debe**.

**BUSCAR:**
```js
    if (casheaDeuda > 0) {
        msg += `*Financiamiento Cashea:* Debe *$${formatUsd(casheaDeuda)}*\n`;
    }
```
**REEMPLAZAR POR:**
```js
    // Cashea le remesa a la bodega: el cliente NO debe este monto. Se informa
    // como referencia de su financiamiento, nunca como deuda con la bodega.
    if (casheaDeuda > 0) {
        msg += `*Financiamiento Cashea:* $${formatUsd(casheaDeuda)} (lo paga Cashea, no usted)\n`;
    }
```

### 8.G — "Poner en 0" no debe borrar la cuenta por cobrar

`confirmResetBalance` reinicia el **saldo del cliente**. La cuenta por cobrar a Cashea es de otra contraparte y no debe desaparecer en esa acción.

**BUSCAR:**
```js
        const updatedCustomer = { ...customer, deuda: 0, favor: 0, casheaDeuda: 0 };
```
**REEMPLAZAR POR:**
```js
        // casheaDeuda NO se toca: es una cuenta por cobrar A CASHEA, no saldo del
        // cliente. Se cancela registrando la remesa, no condonando al cliente.
        const updatedCustomer = { ...customer, deuda: 0, favor: 0 };
```

### 8.H — Mensaje de bloqueo de borrado

**BUSCAR:**
```js
                        showToast(`No se puede eliminar: ${selectedCustomer.name} tiene una deuda Cashea de $${casheaDeuda.toFixed(2)} pendiente.`, 'error');
```
**REEMPLAZAR POR:**
```js
                        showToast(`No se puede eliminar: hay $${casheaDeuda.toFixed(2)} por cobrar a Cashea vinculados a ${selectedCustomer.name}.`, 'error');
```

### VERIFICAR FASE 8

```bash
grep -c "handleSaldarCashea" src/views/CustomersView.jsx        # debe ser 0
grep -c "onSaldarCashea(customer)" src/views/CustomersView.jsx  # debe ser 1  ← el botón cableado
grep -c "processCasheaRemittance" src/views/CustomersView.jsx   # debe ser 2  (import + uso)
npm run lint 2>&1 | tail -5
npm run build 2>&1 | tail -5
```

**El build DEBE pasar.** Si falla, lee el error: casi siempre es un import faltante de 8.C.

### ROLLBACK Fase 8
```bash
git checkout -- src/views/CustomersView.jsx
rm src/components/Customers/CasheaRemittanceModal.jsx
```

---

## FASE 9 — Dashboard: separar las dos contrapartes

**Objetivo:** "Por Cobrar" mezcla deuda de clientes con cuentas por cobrar a Cashea. Son contrapartes y riesgos distintos.
**Archivo:** `src/hooks/useDashboardMetrics.js`

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "const totalUsd = sumR(deudores.map(c => sumR(c.deuda || 0, c.casheaDeuda || 0)));" src/hooks/useDashboardMetrics.js
```

**BUSCAR:**
```js
        const deudores = customers.filter(c => (c.deuda || 0) > 0.01 || (c.casheaDeuda || 0) > 0.01);
        const totalUsd = sumR(deudores.map(c => sumR(c.deuda || 0, c.casheaDeuda || 0)));
        return {
            count: deudores.length,
            totalUsd,
```

**REEMPLAZAR POR:**
```js
        const deudores = customers.filter(c => (c.deuda || 0) > 0.01 || (c.casheaDeuda || 0) > 0.01);
        // Dos contrapartes distintas: los clientes deben `deuda`; Cashea (el
        // financiador) debe `casheaDeuda`. `totalUsd` se conserva como el agregado
        // histórico para no romper consumidores existentes, pero se exponen ambos
        // desglosados para poder mostrarlos por separado.
        const totalClientesUsd = sumR(deudores.map(c => c.deuda || 0));
        const totalCasheaUsd   = sumR(deudores.map(c => c.casheaDeuda || 0));
        const totalUsd = sumR(totalClientesUsd, totalCasheaUsd);
        return {
            count: deudores.length,
            totalUsd,
            totalClientesUsd,
            totalCasheaUsd,
```

> Se mantiene `totalUsd` a propósito: cualquier consumidor actual sigue funcionando. La separación visual en `DashboardStats.jsx` es cosmética y queda como trabajo opcional — con `totalClientesUsd` / `totalCasheaUsd` ya disponibles, es un cambio de una línea en el JSX cuando se decida hacerlo.

### VERIFICAR FASE 9
```bash
npm run lint 2>&1 | grep -i "useDashboardMetrics" || echo "OK"
npm run build 2>&1 | tail -3
```

### ROLLBACK Fase 9
```bash
git checkout -- src/hooks/useDashboardMetrics.js
```

---

## FASE 10 — Drift de tasa en el modo POS (fix de 1 línea)

**Objetivo:** el modo POS calcula el `amountBs` del pago Cashea con multiplicación cruda; el modo básico usa `mulR`. Divergencia de centavos.
**Archivo:** `src/components/Sales/CheckoutModalPOS/index.jsx`

**VERIFICAR ANCLAJE** (debe imprimir `1`):
```bash
grep -c "amountBs: casheaAmountUsd \* tasaSegura," src/components/Sales/CheckoutModalPOS/index.jsx
```

**BUSCAR:**
```js
                    amountBs: casheaAmountUsd * tasaSegura,
```
**REEMPLAZAR POR:**
```js
                    amountBs: mulR(casheaAmountUsd, tasaSegura),
```

> `mulR` ya está importado en la línea 4 del archivo. **No toques el import.**

### VERIFICAR FASE 10
```bash
grep -n "import { round2, subR, mulR, divR } from '../../../utils/dinero';" src/components/Sales/CheckoutModalPOS/index.jsx
npm run build 2>&1 | tail -3
```

### ROLLBACK Fase 10
```bash
git checkout -- src/components/Sales/CheckoutModalPOS/index.jsx
```

---

## FASE 11 — VERIFICACIÓN FINAL Y COMMIT

### Paso 11.1 — Suite completa

```bash
npm test 2>&1 | tail -8
```

**Criterio de aceptación:**
- Tests pasados ≥ **123 + 15 nuevos = 138**
- **0 tests fallando**
- Errors: **≤ 1** (el preexistente del baseline — ver Fase 0.2)

### Paso 11.2 — Build y lint

```bash
npm run build 2>&1 | tail -5
npm run lint 2>&1 | tail -5
```
Ambos deben terminar sin errores.

### Paso 11.3 — Checklist E2E MANUAL

> ⚠️ El arnés automatizado cubre el engine y el procesador de remesa. **Las Fases 5, 7, 8 y 9 requieren verificación manual.** No marques el plan como completo sin esto.

```bash
npm run dev
```

Prerrequisito — activar Cashea en la consola del navegador:
```js
localStorage.setItem('cashea_enabled', 'true');
localStorage.setItem('cashea_min_amount', '0');
location.reload();
```

| # | Acción | Resultado esperado |
|---|---|---|
| 1 | Venta de $100 con Cashea 40%, cliente seleccionado | Se cobran $40; se registra `VENTA_CASHEA` |
| 2 | Ficha del cliente | Dice **"Por cobrar a Cashea $60"** (sin signo `-`) y aparece el botón **"Registrar remesa recibida"** |
| 3 | Dashboard → desglose de pagos | Cashea aparece bajo por-cobrar, **NO** en el neto USD. Neto USD del día = **$40** |
| 4 | Reportes → medios de pago | **Mismos números que el Dashboard.** Neto USD = $40 |
| 5 | Cierre de caja → arqueo | Espera **$40** en efectivo USD, no $100 |
| 6 | Botón "Registrar remesa recibida" → $25 en efectivo USD | Toast de éxito; la ficha pasa a **$35** por cobrar |
| 7 | Tras el paso 6, Dashboard | Efectivo USD subió $25; por cobrar a Cashea bajó a $35 |
| 8 | Registrar remesa por $999 | Toast de error "El monto excede lo pendiente". **Nada cambia** |
| 9 | Registrar el remanente de $35 | Por cobrar llega a $0; el panel morado desaparece |
| 10 | Estado de cuenta por WhatsApp | **NO** dice "Debe" sobre el monto Cashea |
| 11 | Historial: anular la `VENTA_CASHEA` original | La cuenta por cobrar a Cashea se revierte, no queda huérfana |
| 12 | Cliente con solo casheaDeuda → "Poner en 0" | `deuda`/`favor` a 0; **el por-cobrar a Cashea NO se borra** |
| 13 | Dashboard → top productos | **NO** aparece "Remesa Cashea: …" como producto |

### Paso 11.4 — Commit

```bash
git add -A
git commit -m "fix(cashea): tratar el financiado como cuenta por cobrar a Cashea y habilitar el registro de remesas

Modelo: Cashea le remesa a la bodega; el cliente no debe ese monto.

- FinancialEngine: bucket cashea marcado como por-cobrar (currency FIADO +
  isReceivable) y nuevo tipo COBRO_CASHEA que lo reduce
- Reportes: paridad literal con el Dashboard; dejan de contradecirse
- Nuevo casheaRemittanceProcessor: registra la remesa como ingreso real,
  soporta parciales y valida el excedente
- CustomersView: se cablea el botón de remesa (onSaldarCashea nunca se
  invocaba: la cuenta por cobrar era un estado irreversible)
- voidSaleProcessor: anular VENTA_CASHEA/COBRO_CASHEA revierte casheaDeuda
- checkoutProcessor: venta mixta suma cashea+fiado en vez de descartar el fiado
- WhatsApp: deja de decirle al cliente que debe un dinero que paga Cashea
- 'Poner en 0' ya no borra la cuenta por cobrar a Cashea
- COBRO_CASHEA registrado en las listas de tipos (cierre, reportes, velocity)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## §6. MATRIZ DE RIESGOS Y MITIGACIONES

| # | Riesgo | Prob. | Impacto | Mitigación (ya incorporada al plan) |
|---|---|---|---|---|
| R1 | El ejecutor "arregla" `procesarImpactoCliente` siguiendo el reporte de auditoría desactualizado | **Alta** | **Crítico** — destruye saldo del cliente | §0 reclasifica el hallazgo B; G1/G2 en la lista de no-tocar; test explícito "G1: un abono NUNCA toca casheaDeuda" en Fase 1 |
| R2 | Un anclaje no matchea y el ejecutor improvisa | Media | Alto | §2.2 obliga a ABORTAR con conteo `0`; Fase 0.3 valida los 8 anclajes antes de empezar |
| R3 | El monto Cashea se suma dos veces al bucket | Media | Alto | La Edición 2.A **solo crea el bucket**, no suma; el bucle existente aporta el monto. Test `bd.cashea.total === 60` lo detecta |
| R4 | Se olvida la Fase 7 → las remesas no entran al cierre y "Remesa Cashea" sale como top producto | Media | Alto | Fase 7 con conteos exactos por archivo; ítems 3, 7 y 13 del checklist manual |
| R5 | El botón se implementa pero no se cablea (el bug original se repite) | Media | Crítico | Fase 8.E es un paso propio; verificación `grep -c "onSaldarCashea(customer)"` debe dar `1`; ítem 2 del checklist |
| R6 | `casheaDeuda` queda negativa por redondeo | Baja | Medio | `Math.min(round2(amountUsd), pendiente)` + validación de excedente + clamp en voidSaleProcessor; test "rechaza montos que exceden" |
| R7 | Condición de carrera al registrar dos remesas simultáneas | Baja | Alto | Todo el read-modify-write va dentro de `withLock('pos_write_lock')`, y **se relee el cliente desde storage dentro del lock** (no se confía en el objeto del prop) |
| R8 | Anular una remesa acredita saldo a favor al cliente | Media | Alto | `vueltoParaMonedero: 0` explícito en el registro + Fase 5 maneja `COBRO_CASHEA` en su propio bucket |
| R9 | Se rompe el arqueo de caja | Baja | Crítico | G4: no se toca `CierreCajaWizard`. Test de no-regresión "el arqueo sigue esperando solo la inicial" + ítem 5 del checklist |
| R10 | El mock de `storageService` falla en Fase 6 | Media | Bajo | Mitigación explícita en Fase 6 (mover `vi.mock` al tope o separar a otro archivo). **Prohibido borrar asserts** |
| R11 | Se confunde el `1 error` preexistente con un daño propio | Media | Bajo | Baseline medido y documentado en Fase 0.2 |
| R12 | `git checkout --` borra los cambios preexistentes de `OwnerMonitorView.jsx` | Media | Medio | Advertencia explícita en el ROLLBACK de la Fase 7 |

---

## §7. LO QUE ESTE PLAN **NO** RESUELVE (fuera de alcance, explícito)

1. **Remesas en lote.** Cashea remesa por lotes que cubren muchos clientes; aquí se registra **cliente por cliente**. Es más tedioso pero coincide con el modelo de datos actual y es de riesgo mucho menor. Una pantalla "Remesa Cashea del período" con selección múltiple es trabajo posterior — `processCasheaRemittance` ya sirve como primitiva para construirla.
2. **Ventas mixtas Cashea + fiado reales.** La Fase 4 detiene la pérdida silenciosa de dinero, pero `procesarImpactoCliente` recibe un solo `esCashea`, así que no se pueden dividir dos deudas en una venta. Hoy es inalcanzable por la UI.
3. **Unificación de los dos modos de checkout** (`CheckoutModal` vs `CheckoutModalPOS`). Ambos siguen implementando Cashea por separado; solo se corrigió el drift de tasa (Fase 10). Refactor de riesgo alto, beneficio bajo — no se justifica dentro de este plan.
4. **Conciliación con el estado de cuenta real de Cashea.** No hay integración con la API de Cashea; el registro es manual y confía en lo que teclee el operador.
5. **Migración de datos históricos.** Clientes con `casheaDeuda` acumulada de antes de este fix la conservan. Se saldan registrando remesas normalmente (o con "Poner en 0" si el dato es basura). **No se escribió migración automática a propósito:** tocar saldos persistidos sin supervisión humana es más peligroso que el problema que resuelve.
6. **Separación visual en `DashboardStats.jsx`.** La Fase 9 expone `totalClientesUsd` y `totalCasheaUsd`; mostrarlos como dos tarjetas es cosmético y queda pendiente.
