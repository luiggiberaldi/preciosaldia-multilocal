# PLAN DE FIXEO — MODOS DE COBRO (POS Y BÁSICO)

**Documento ejecutable.** Escrito para que un LLM de baja capacidad (o cualquier IDE agéntico) lo ejecute paso a paso sin ambigüedad.
**Reporte de origen:** [`AUDITORIA-CHECKOUT.md`](AUDITORIA-CHECKOUT.md)
**Fecha:** 2026-08-04
**Fases:** 13 · **Archivos tocados:** 7 · **Tests nuevos:** 6

---

## §0. DECISIONES DE NEGOCIO QUE GOBIERNAN ESTE PLAN

Dos hallazgos requerían una decisión de producto, no técnica. Este plan las toma con el **valor conservador** y las marca para que el humano pueda invertirlas sin rehacer nada.

### D1 — El saldo a favor NO se convierte en efectivo *(hallazgo C-2)*

> **Decisión tomada: el saldo a favor solo puede cubrir hasta lo que falta por pagar.**

Hoy un cliente con $50 de crédito que compra $10 puede recibir **$40 en efectivo físico** de la caja. La Fase 10 pone el tope.

🔄 **Si el negocio SÍ quiere permitir la conversión:** no ejecutes la Fase 10. En su lugar hay que añadir una confirmación explícita y un registro diferenciado — eso es trabajo de producto, fuera de este plan. **No dejes el estado actual** (sin tope y sin confirmación): esa es la única opción incorrecta.

### D2 — El botón muerto de saldo a favor del modo básico se ELIMINA *(hallazgo A-2)*

> **Decisión tomada: se quita el botón, no se implementa la funcionalidad.**

El botón "Usar Saldo a Favor" del modo básico no hace nada: `onUseSaldoFavor` nunca se pasa desde `SalesView`. Un botón que falla en silencio es peor que ningún botón — el operador cree que aplicó el crédito y no lo aplicó.

Implementarlo de verdad exige diseñar un input con tope, validación y un pago virtual `saldo_favor` (~40 líneas y decisiones de UI). **Eso es una tarea de producto, no un fixeo**, y meterla aquí multiplicaría el riesgo de este plan.

🔄 **Si el humano prefiere implementarlo:** salta la Fase 11 y abre una tarea aparte. El modo POS ya tiene la funcionalidad (`WalletSection`) y sirve de referencia.

---

## §1. LISTA DE "NO TOCAR" (guardarraíles duros)

Verificados como **correctos** durante la auditoría. Si tu razonamiento te lleva a cambiarlos, tu razonamiento está mal.

| # | Ubicación | Por qué NO se toca |
|---|---|---|
| G1 | `src/utils/withLock.js` y las llamadas `withLock('pos_write_lock', ...)` | La atomicidad de venta+stock+cliente ya es correcta. |
| G2 | `src/utils/deepFreeze.js` y sus llamadas en `checkoutProcessor.js` | Protege registros financieros de mutación posterior. |
| G3 | `src/utils/financialLogic.js` completo | Clona en la línea 6 (`{ ...clienteInicial }`), no muta. Correcto. **Ver también §0 de [`PLAN-FIXEO-CASHEA.md`](PLAN-FIXEO-CASHEA.md).** |
| G4 | `checkoutProcessor.js:62-66` — guarda de drift USD/Bs | Rechaza totales inconsistentes. Correcta. |
| G5 | `checkoutProcessor.js:76-78` — exigencia de cliente para fiado/Cashea | Validada en el procesador, cubre ambos modos. |
| G6 | `checkoutProcessor.js:186-213` — deducción de stock y auditoría de stock negativo | Correcta para peso/unidad/paquete. |
| G7 | `useCheckoutFlow.js:19-23` — `isProcessingRef` | Candado síncrono contra doble envío. Correcto. |
| G8 | `FinancialEngine.calculatePaymentBreakdown` — bloques `_vuelto_usd` / `_vuelto_bs` (líneas ~352-359) | El motor es correcto: suma lo que le declaran. **El bug está en quién le declara, no aquí.** No lo "arregles" con lógica de deduplicación. |
| G9 | Todo `src/testing/` y los tests existentes en `tests/` | Son el certificador. No se ajustan para que pasen; se ajusta el código. |

🔴 **GUARDARRAÍL PRINCIPAL:** el hallazgo C-1 (doble conteo de vuelto) se corrige en **tres** puntos: la normalización defensiva en el procesador (Fase 2) y el origen en cada modo (Fases 3 y 4). **Las tres son necesarias.** No concluyas que con la Fase 2 basta y saltes las otras: la normalización es una red de seguridad, no el arreglo.

---

## §2. CONVENCIONES DE EJECUCIÓN (leer antes de la Fase 0)

1. **Ejecuta las fases EN ORDEN.** Hay dependencias explícitas. No saltes fases (salvo las que §0 marca como opcionales).
2. **Antes de cada edición**, corre el comando `VERIFICAR ANCLAJE`. Debe imprimir **exactamente el conteo indicado**.
   - Si imprime **`0`** → el archivo cambió respecto a este plan. **ABORTA la fase y reporta al humano.** No improvises un anclaje alternativo.
   - Si imprime **más de lo indicado** → el anclaje es ambiguo. **ABORTA y reporta.** No uses "reemplazar todo".
3. **Las ediciones son reemplazo literal de texto.** Copia el bloque `BUSCAR` carácter por carácter, incluida la indentación (todos los archivos usan **4 espacios**, nunca tabs) y los espacios de alineación (por ejemplo `changeBs:  ` lleva **dos** espacios).
4. **Nunca uses `sed -i`** en este repo: hay rutas con espacios y los bloques contienen `|`, `/`, `$` y backticks. Usa la herramienta de edición de tu IDE.
5. **Después de cada fase**, corre `VERIFICAR FASE`. Si falla, ejecuta el `ROLLBACK` de esa fase y reporta. **No avances con una fase en rojo.**
6. **No reformatees** archivos que tocas. Nada de `prettier --write` sobre archivos completos.
7. **No agregues imports que ya existen.** Cada fase que necesita un import nuevo lo dice explícitamente y trae su propia verificación. Si una fase no menciona imports, **no toques la cabecera del archivo**.
8. **Alcance de los tests:** el proyecto **no tiene `@testing-library`**, así que no se pueden renderizar hooks ni componentes. Los tests de la Fase 1 cubren `processSaleTransaction` (función async pura, mockeable). Las correcciones dentro de los modales y hooks de React se verifican con **grep + checklist manual E2E** en la Fase 13. **No instales dependencias nuevas para testear.**

---

## FASE 0 — PRE-VUELO

**Objetivo:** rama limpia y baseline registrado, para poder distinguir "lo rompí yo" de "ya estaba roto".

### Paso 0.1 — Rama

```bash
git checkout -b fix/checkout-vuelto-e2e
git status --short
```

> ℹ️ Es normal ver `M src/hooks/useRemoteCommands.js` y `M src/views/OwnerMonitorView.jsx` — son cambios preexistentes ajenos al checkout. **Déjalos como están, no los revertas ni los incluyas en los commits de este plan.**

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

> ⚠️ **Ese `1 error` es PREEXISTENTE** (un rechazo no manejado fuera de los asserts, no un test en rojo). **No es tu culpa y no lo arregles en este plan.** El criterio de éxito final es: `123 + 6 nuevos = 129` pasando, y **no más de 1 error**.

> ℹ️ Si el conteo base **no** es 123, anota el número real y úsalo como referencia. No abortes por esto.

### Paso 0.3 — Verificar los 17 anclajes de una vez

```bash
cd "$(git rev-parse --show-toplevel)"
P=src/utils/checkoutProcessor.js
H=src/hooks/useCheckoutCalculations.js
M=src/components/Sales/CheckoutModal.jsx
X=src/components/Sales/CheckoutModalPOS/index.jsx
W=src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx
F=src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx

echo "01 $(grep -c 'const totalPaidUsd = sumR(payments.map(p => p.amountUsd));' $P)"
echo "02 $(grep -c "changeUsd: tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeUsdGiven || 0)," $P)"
echo "03 $(grep -c 'const changeAnomalyThresholdUsd = mulR(cartTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);' $P)"
echo "04 $(grep -c ': mulR(cartTotalUsd, tasaCop))' $P)"
echo "05 $(grep -c 'updatedCustomers = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);' $P)"
echo "06 $(grep -c "import { round2, sumR, subR, divR, mulR } from './dinero.js';" $P)"
echo "07 $(grep -c 'const defaultUsdChange = (!changeUsdGiven && !changeBsGiven) ? changeUsd : round2(CurrencyService.safeParse(changeUsdGiven));' $H)"
echo "08 $(grep -c 'const currentPaidBs = totalPaidBs;' $H)"
echo "09 $(grep -c '^        safeRate,$' $H)"
echo "10 $(grep -c '^    cartTotalUsd,$' $M)"
echo "11 $(grep -c '^        cartTotalUsd,$' $M)"
echo "12 $(grep -c '^        safeRate,$' $M)"
echo "13 $(grep -c 'setCasheaActive(true);' $M)"
echo "14 $(grep -c 'changeUsdGiven: distVueltoUSD ? parseFloat(distVueltoUSD) : cambioUSD,' $X)"
echo "15 $(grep -c 'const remBs = Math.max(0, subR(bsTotals.totalBs, totalPagadoBS));' $X)"
echo "16 $(grep -c 'v <= saldoDisponible' $W)"
echo "17 $(grep -c 'const disabled = isProcessing || (modo ===' $F)"
```

**Los 17 deben imprimir `1`.** Si alguno imprime `0` o `2`, **ABORTA todo el plan** y reporta cuál falló y con qué número.

### ROLLBACK Fase 0
```bash
git checkout main && git branch -D fix/checkout-vuelto-e2e
```

---

## FASE 1 — RED DE SEGURIDAD (tests que DEBEN fallar ahora)

**Objetivo:** escribir los tests **antes** de tocar código de producción. Cuatro de los seis fallarán. **Eso es el resultado correcto de esta fase** — es la prueba de que los bugs existen.

🔴 **REGLA ABSOLUTA DE ESTA FASE: si un test falla, NO lo ajustes para que pase.** El test describe el comportamiento correcto; el código lo violará hasta las Fases 2, 6 y 7.

### Paso 1.1 — Crear `tests/checkout.test.js`

Crea el archivo **nuevo** `tests/checkout.test.js` con este contenido **completo y literal**:

```javascript
// tests/checkout.test.js — Tests para src/utils/checkoutProcessor.js
// Cubre los fixes FIN-034 (doble conteo de vuelto), FIN-035 (vuelto en Cashea),
// FIN-036 (auditoría con total dinámico) y FIN-037 (cliente fresco).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (copiados de tests/financialEngine.test.js, deben ir arriba del todo) ──
const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'test-user', nombre: 'Tester', rol: 'ADMIN' } }) },
}));

import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { storageService } from '../src/utils/storageService';
import { logEvent } from '../src/services/auditService';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

function resetMockStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    logEvent.mockClear();
}

// Opts base: venta de $10 a tasa 40. Sobreescribe lo que necesites por test.
function baseOpts(over = {}) {
    return {
        cart: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
        cartTotalUsd: 10,
        cartTotalBs: 400,
        cartSubtotalUsd: 10,
        payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
        changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
        selectedCustomerId: null,
        customers: [],
        products: [{ id: 'p1', name: 'Harina', stock: 50, costUsd: 4 }],
        effectiveRate: 40,
        tasaCop: 0,
        copEnabled: false,
        discountData: null,
        useAutoRate: false,
        ...over,
    };
}

beforeEach(() => resetMockStore());

// ════════════════════════════════════════════════════════════════════════
// FIN-034 — El vuelto declarado nunca puede superar el vuelto real
// ════════════════════════════════════════════════════════════════════════
describe('FIN-034: normalización del vuelto', () => {

    it('NO duplica el vuelto cuando la UI declara el mismo monto en USD y en Bs', async () => {
        // Venta $10, paga con $20 → vuelto real = $10 (o 400 Bs). NUNCA ambos.
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 20, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 400 },
        }));

        expect(result.success).toBe(true);
        // El valor total del vuelto entregado, expresado en USD, no puede pasar de $10.
        const vueltoTotalUsd = result.sale.changeUsd + (result.sale.changeBs / 40);
        expect(vueltoTotalUsd).toBeLessThanOrEqual(10.01);
        // Política: se prioriza el tramo en Bs (es el que el operador escribe explícito).
        expect(result.sale.changeBs).toBe(400);
        expect(result.sale.changeUsd).toBe(0);
    });

    it('REGRESIÓN: un desglose de vuelto válido se persiste intacto', async () => {
        // Venta $10, paga $20, entrega $4 en efectivo USD + 240 Bs ($6). Total $10. Válido.
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 20, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 4, changeBsGiven: 240 },
        }));

        expect(result.success).toBe(true);
        expect(result.sale.changeUsd).toBe(4);
        expect(result.sale.changeBs).toBe(240);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-035 — Una venta Cashea con sobrepago sí registra su vuelto
// ════════════════════════════════════════════════════════════════════════
describe('FIN-035: vuelto en ventas Cashea', () => {

    it('conserva el vuelto de la cuota inicial en una VENTA_CASHEA', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }]);

        // Venta $100. Cashea remesa $60, el cliente paga $50 en efectivo → vuelto $10.
        const result = await processSaleTransaction(baseOpts({
            cart: [{ id: 'p1', name: 'Harina', qty: 10, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
            cartTotalUsd: 100,
            cartTotalBs: 4000,
            cartSubtotalUsd: 100,
            payments: [
                { amountUsd: 50, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' },
                { amountUsd: 60, amountBs: 2400, currency: 'USD', methodId: 'cashea', methodLabel: 'Cashea' },
            ],
            changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_CASHEA');
        // El vuelto de la cuota inicial es dinero real que salió de la caja.
        expect(result.sale.changeUsd).toBe(10);
    });

    it('REGRESIÓN: una VENTA_FIADA no registra vuelto', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }]);

        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 4, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_FIADA');
        expect(result.sale.changeUsd).toBe(0);
        expect(result.sale.changeBs).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-036 — La auditoría reporta el mismo total que la venta persistida
// ════════════════════════════════════════════════════════════════════════
describe('FIN-036: coherencia entre auditoría y venta', () => {

    it('el log de auditoría usa el total dinámico, no el prop crudo', async () => {
        _memoryStore.set(CUSTOMERS_KEY, []);

        // Item con doble precio: $10 en USD, pero $11 de referencia si se paga en Bs.
        const result = await processSaleTransaction(baseOpts({
            cart: [{
                id: 'p1', name: 'Harina', qty: 1,
                priceUsd: 10, priceBsUsdRef: 11, pricingMode: 'dual_usd',
                costUsd: 4, costBs: 0, isWeight: false,
            }],
            cartTotalUsd: 10,
            cartTotalBs: 400,
            cartSubtotalUsd: 10,
            // Pago en Bs → el motor recalcula el total a $11 / 440 Bs.
            payments: [{ amountUsd: 11, amountBs: 440, currency: 'BS', methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs' }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.totalUsd).toBe(11);

        // El 5º argumento de logEvent es el objeto de metadata { saleId, total, items }.
        const meta = logEvent.mock.calls[0][4];
        expect(meta.total).toBe(result.sale.totalUsd);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-037 — El saldo del cliente se lee fresco del storage
// ════════════════════════════════════════════════════════════════════════
describe('FIN-037: cliente leído fresco dentro del lock', () => {

    it('parte de la deuda persistida, no de la del prop obsoleto', async () => {
        // Verdad en storage: Ana ya debe $5.
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 5, favor: 0 }]);

        // El prop que llega desde React está desactualizado (deuda 0).
        const result = await processSaleTransaction(baseOpts({
            payments: [],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_FIADA');

        const persisted = _memoryStore.get(CUSTOMERS_KEY).find(c => c.id === 'c1');
        // 5 previos + 10 de esta venta = 15. Si sale 10, se perdió deuda.
        expect(persisted.deuda).toBe(15);
    });
});
```

### Paso 1.2 — Ejecutar y confirmar el rojo esperado

```bash
npx vitest run tests/checkout.test.js 2>&1 | tail -30
```

**Resultado esperado: 4 fallan, 2 pasan.**

| Test | Estado esperado AHORA | Se arregla en |
|---|---|---|
| FIN-034 no duplica el vuelto | ❌ **FALLA** (`changeUsd` es 10, no 0) | Fase 2 |
| FIN-034 desglose válido intacto | ✅ pasa (guarda de regresión) | — |
| FIN-035 vuelto en Cashea | ❌ **FALLA** (`changeUsd` es 0, no 10) | Fase 2 |
| FIN-035 fiada sin vuelto | ✅ pasa (guarda de regresión) | — |
| FIN-036 auditoría coherente | ❌ **FALLA** (`meta.total` es 10, no 11) | Fase 6 |
| FIN-037 cliente fresco | ❌ **FALLA** (`deuda` es 10, no 15) | Fase 7 |

⚠️ **Si algún test que debe fallar PASA**, significa que ese bug ya fue corregido por otra persona. **Reporta al humano y salta la fase correspondiente**, no la ejecutes a ciegas.

⚠️ **Si un test que debe pasar FALLA**, hay un problema con el harness de mocks (no con el código). Revisa que los tres `vi.mock` estén **antes** de los `import` y con las rutas exactas. No modifiques `checkoutProcessor.js` en esta fase.

### VERIFICAR FASE 1
```bash
test -f tests/checkout.test.js && echo "OK archivo creado"
npx vitest run tests/checkout.test.js 2>&1 | grep -E "Tests|Test Files"
```
Debe reportar **6 tests** en total (4 failed, 2 passed).

### ROLLBACK Fase 1
```bash
rm tests/checkout.test.js
```

---

## FASE 2 — 🔴 CRÍTICO C-1 + 🟠 A-3: normalizar el vuelto en el procesador

**Archivo:** [`src/utils/checkoutProcessor.js`](src/utils/checkoutProcessor.js) · **2 ediciones**

**Qué está roto:** el procesador confía ciegamente en el desglose de vuelto que le manda la UI. Cuando la UI declara `{changeUsdGiven: 10, changeBsGiven: 400}` para un vuelto real de $10 a tasa 40, el `FinancialEngine` suma **ambos** — registra $20 de vuelto para una venta de $10. Eso arruina el cierre de caja (`CierreCajaWizard` calcula `esperado = efectivo − vuelto`, así que cada venta con vuelto genera un sobrante fantasma).

**Bonus:** la misma edición (b) arregla A-3 — hoy `tipoVenta !== 'VENTA'` pone el vuelto en 0, lo que borra el vuelto legítimo de la cuota inicial de una venta Cashea.

> 💡 **Por qué esta capa además de las Fases 3 y 4:** el procesador es el único punto por el que pasan **los dos** modos. Aunque arreglemos el origen, esta normalización garantiza que ninguna UI futura pueda volver a duplicar el vuelto. Es defensa en profundidad, y es lo que hace que los tests de la Fase 1 pasen.

### Edición 2a — insertar la normalización

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'const changeUsd    = round2(Math.max(0, subR(totalPaidUsd, activeCartTotalUsd)));' src/utils/checkoutProcessor.js
```

**BUSCAR** (1 línea):
```javascript
    const changeUsd    = round2(Math.max(0, subR(totalPaidUsd, activeCartTotalUsd)));
```

**REEMPLAZAR POR:**
```javascript
    const changeUsd    = round2(Math.max(0, subR(totalPaidUsd, activeCartTotalUsd)));

    // FIN-034: Normalizar el vuelto declarado por la UI.
    // La UI podía enviar el MISMO vuelto duplicado en USD y en Bs (ej: {10, 400} a tasa 40
    // para un vuelto real de $10), y el FinancialEngine sumaba ambos → $20 de vuelto.
    // `changeUsd` (el vuelto real calculado aquí) es el techo absoluto: nunca se entrega más.
    // Se prioriza el tramo en Bs porque es el que el operador escribe explícitamente.
    // NOTA: effectiveRate ya fue validado > 0 arriba (FIN-022), así que divR es seguro.
    const rawChangeUsdGiven = round2(Math.max(0, Number(changeBreakdown?.changeUsdGiven) || 0));
    const rawChangeBsGiven  = round2(Math.max(0, Number(changeBreakdown?.changeBsGiven)  || 0));
    const bsGivenAsUsd      = round2(divR(rawChangeBsGiven, effectiveRate));
    const givenChangeBsUsd  = Math.min(bsGivenAsUsd, changeUsd);
    const givenChangeBs     = givenChangeBsUsd === bsGivenAsUsd
        ? rawChangeBsGiven
        : round2(mulR(givenChangeBsUsd, effectiveRate));
    const givenChangeUsd    = round2(Math.min(rawChangeUsdGiven, Math.max(0, subR(changeUsd, givenChangeBsUsd))));
```

> ℹ️ No hace falta tocar imports: `round2`, `divR`, `mulR` y `subR` ya están importados en la línea 5.

### Edición 2b — usar los valores normalizados en la venta

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c "changeUsd: tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeUsdGiven || 0)," src/utils/checkoutProcessor.js
```

**BUSCAR** (2 líneas — ⚠️ `changeBs:` lleva **dos** espacios antes del `tipoVenta`):
```javascript
        changeUsd: tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeUsdGiven || 0),
        changeBs:  tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeBsGiven  || 0),
```

**REEMPLAZAR POR:**
```javascript
        // FIN-034 + FIN-035: vuelto normalizado (nunca supera el vuelto real).
        // Solo la VENTA_FIADA no puede tener vuelto (no hay sobrepago, hay saldo pendiente).
        // Una VENTA_CASHEA sí puede: el vuelto de la cuota inicial es efectivo real que salió de caja.
        changeUsd: tipoVenta === 'VENTA_FIADA' ? 0 : givenChangeUsd,
        changeBs:  tipoVenta === 'VENTA_FIADA' ? 0 : givenChangeBs,
```

### VERIFICAR FASE 2
```bash
npx vitest run tests/checkout.test.js 2>&1 | tail -20
```
**Esperado: 4 pasan, 2 fallan** (solo quedan en rojo FIN-036 y FIN-037).

```bash
npm test 2>&1 | tail -6
```
**No debe haber ningún test que antes pasaba y ahora falle.** Si alguno de `tests/financialEngine.test.js` se rompe, tu edición 2a quedó mal colocada.

### ROLLBACK Fase 2
```bash
git checkout -- src/utils/checkoutProcessor.js
```

---

## FASE 3 — 🔴 CRÍTICO C-1 (origen, modo BÁSICO)

**Archivo:** [`src/hooks/useCheckoutCalculations.js`](src/hooks/useCheckoutCalculations.js) · **1 edición**

**Qué está roto:** cuando el operador **no toca** los campos de desglose de vuelto (el caso normal), `changeUsdGiven` y `changeBsGiven` están vacíos, y el código toma la rama `(!changeUsdGiven && !changeBsGiven)` que asigna **`changeUsd` Y `changeBs` a la vez** — es decir, el vuelto completo dos veces, una en cada moneda. El `Math.min` no lo detecta porque cada valor por separado sí cabe en su tope.

**Cómo se arregla:** si el operador no especificó desglose, todo el vuelto va a USD y el tramo en Bs es 0.

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'const defaultUsdChange = (!changeUsdGiven && !changeBsGiven) ? changeUsd : round2(CurrencyService.safeParse(changeUsdGiven));' src/hooks/useCheckoutCalculations.js
```

**BUSCAR** (6 líneas):
```javascript
        const defaultUsdChange = (!changeUsdGiven && !changeBsGiven) ? changeUsd : round2(CurrencyService.safeParse(changeUsdGiven));
        const defaultBsChange  = (!changeUsdGiven && !changeBsGiven) ? changeBs  : round2(CurrencyService.safeParse(changeBsGiven));
        onConfirmSale(payments, {
            changeUsdGiven: Math.min(defaultUsdChange, changeUsd),
            changeBsGiven: Math.min(defaultBsChange, changeBs),
        });
```

**REEMPLAZAR POR:**
```javascript
        // FIN-034: `changeUsd` y `changeBs` son el MISMO vuelto expresado en dos monedas.
        // Declarar ambos duplicaba el vuelto en el FinancialEngine.
        // Sin desglose explícito del operador → todo el vuelto se declara en USD y el tramo Bs es 0.
        const hasExplicitSplit = Boolean(changeUsdGiven) || Boolean(changeBsGiven);
        const splitUsd = hasExplicitSplit ? round2(CurrencyService.safeParse(changeUsdGiven)) : changeUsd;
        const splitBs  = hasExplicitSplit ? round2(CurrencyService.safeParse(changeBsGiven))  : 0;
        onConfirmSale(payments, {
            changeUsdGiven: Math.min(splitUsd, changeUsd),
            changeBsGiven: Math.min(splitBs, changeBs),
        });
```

### VERIFICAR FASE 3
```bash
grep -c 'const hasExplicitSplit = Boolean(changeUsdGiven) || Boolean(changeBsGiven);' src/hooks/useCheckoutCalculations.js   # → 1
grep -c 'defaultUsdChange' src/hooks/useCheckoutCalculations.js   # → 0
npm test 2>&1 | tail -6
```
El conteo de tests no debe bajar. Este hook no tiene tests unitarios (no hay `@testing-library`); se valida en la Fase 13 con el checklist manual.

### ROLLBACK Fase 3
```bash
git checkout -- src/hooks/useCheckoutCalculations.js
```

---

## FASE 4 — 🔴 CRÍTICO C-1 (origen, modo POS)

**Archivo:** [`src/components/Sales/CheckoutModalPOS/index.jsx`](src/components/Sales/CheckoutModalPOS/index.jsx) · **1 edición**

**Qué está roto:** el POS usa `distVueltoUSD ? ... : cambioUSD` como fallback. El botón "⚡ Todo" del campo de vuelto en Bs pone `distVueltoUSD = ''` (cadena vacía, falsy) mientras deja `distVueltoBS` con el monto completo. El ternario lee ese `''` como "no especificado" y cae al fallback `cambioUSD` → **declara el vuelto completo en USD además del completo en Bs**.

**Cómo se arregla:** la decisión de usar el fallback depende de si **cualquiera** de los dos campos fue tocado, no de si ese campo puntual tiene valor.

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'changeUsdGiven: distVueltoUSD ? parseFloat(distVueltoUSD) : cambioUSD,' src/components/Sales/CheckoutModalPOS/index.jsx
```

**BUSCAR** (4 líneas):
```javascript
            changeUsdGiven: distVueltoUSD ? parseFloat(distVueltoUSD) : cambioUSD,
            changeBsGiven: distVueltoBS ? parseFloat(distVueltoBS) : 0,
            esCredito: modo === 'credito',
            clienteId: clienteSeleccionado?.id || null,
```

**REEMPLAZAR POR:**
```javascript
            // FIN-034: si el operador tocó cualquiera de los dos campos de desglose,
            // se respetan tal cual (el vacío vale 0). El botón "Todo" del campo Bs deja
            // distVueltoUSD en '' — leerlo como "no especificado" duplicaba el vuelto.
            changeUsdGiven: hasExplicitSplit ? (parseFloat(distVueltoUSD) || 0) : cambioUSD,
            changeBsGiven: hasExplicitSplit ? (parseFloat(distVueltoBS) || 0) : 0,
            esCredito: modo === 'credito',
            clienteId: clienteSeleccionado?.id || null,
```

Ahora **declara `hasExplicitSplit`** justo antes del objeto. Busca la línea que abre la llamada (`onConfirmSale(payments, {`) en ese mismo `procesarPago` e inserta arriba:

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'onConfirmSale(payments, {' src/components/Sales/CheckoutModalPOS/index.jsx
```

**BUSCAR** (1 línea):
```javascript
        onConfirmSale(payments, {
```

**REEMPLAZAR POR:**
```javascript
        const hasExplicitSplit = distVueltoUSD !== '' || distVueltoBS !== '';
        onConfirmSale(payments, {
```

### VERIFICAR FASE 4
```bash
grep -c "const hasExplicitSplit = distVueltoUSD !== '' || distVueltoBS !== '';" src/components/Sales/CheckoutModalPOS/index.jsx   # → 1
grep -c 'distVueltoUSD ? parseFloat' src/components/Sales/CheckoutModalPOS/index.jsx   # → 0
npm run build 2>&1 | tail -5
```
El build debe terminar sin errores (esto detecta un `hasExplicitSplit` mal ubicado o fuera de scope).

### ROLLBACK Fase 4
```bash
git checkout -- src/components/Sales/CheckoutModalPOS/index.jsx
```

---

## FASE 5 — 🟠 A-1: el botón "Todo" en Bs ignora Cashea y el saldo a favor

**Archivos:** `useCheckoutCalculations.js` (2 ediciones) + `CheckoutModalPOS/index.jsx` (2 ediciones)

**Qué está roto:** las ramas en USD de los botones de auto-relleno restan lo ya cubierto por Cashea; **las ramas en Bs no**. Resultado: en una venta de $100 con $60 de Cashea, pulsar "Todo" en el campo de efectivo Bs escribe **4000 Bs** en vez de 1600 Bs → el operador cobra de más.

### Edición 5a — modo básico: incluir Cashea en la rama Bs

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'const currentPaidBs = totalPaidBs;' src/hooks/useCheckoutCalculations.js
```

**BUSCAR:**
```javascript
            const currentPaidBs = totalPaidBs;
```

**REEMPLAZAR POR:**
```javascript
            // FIN-038: la rama Bs debe descontar Cashea igual que la rama USD,
            // o el botón "Todo" pedirá de más cuando haya remesa Cashea activa.
            const currentPaidBs = sumR([totalPaidBs, mulR(casheaAmountUsd, safeRate)]);
```

### Edición 5b — modo básico: agregar la dependencia faltante

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'totalPaidWithCasheaUsd, totalPaidBs, triggerHaptic\]);' src/hooks/useCheckoutCalculations.js
```

**BUSCAR:**
```javascript
    }, [baseCartTotalUsd, baseCartTotalBs, cart, discountData, safeRate, safeTasaCop, totalPaidWithCasheaUsd, totalPaidBs, triggerHaptic]);
```

**REEMPLAZAR POR:**
```javascript
    }, [baseCartTotalUsd, baseCartTotalBs, cart, discountData, safeRate, safeTasaCop, totalPaidWithCasheaUsd, totalPaidBs, casheaAmountUsd, triggerHaptic]);
```

> ⚠️ **Sin esta edición el `useCallback` queda con una closure obsoleta** de `casheaAmountUsd` y el fix 5a no se aplica al primer clic. No la saltes.

> ℹ️ `sumR`, `mulR` y `casheaAmountUsd` ya existen en este archivo (import de la línea 2 y parámetro del hook). **No agregues imports aquí.**

### Edición 5c — modo POS: agregar `sumR` al import

🔴 **Este archivo NO importa `sumR` todavía.** Sin esta edición, la 5d lanza `sumR is not defined` en runtime.

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c "import { round2, subR, mulR, divR } from '../../../utils/dinero';" src/components/Sales/CheckoutModalPOS/index.jsx
```

**BUSCAR:**
```javascript
import { round2, subR, mulR, divR } from '../../../utils/dinero';
```

**REEMPLAZAR POR:**
```javascript
import { round2, subR, mulR, divR, sumR } from '../../../utils/dinero';
```

### Edición 5d — modo POS: incluir Cashea y saldo a favor en `llenarSaldo`

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'const remBs = Math.max(0, subR(bsTotals.totalBs, totalPagadoBS));' src/components/Sales/CheckoutModalPOS/index.jsx
```

**BUSCAR:**
```javascript
            const remBs = Math.max(0, subR(bsTotals.totalBs, totalPagadoBS));
```

**REEMPLAZAR POR:**
```javascript
            // FIN-038: descontar también Cashea y el saldo a favor aplicado,
            // que ya cubren parte del total pero no están en totalPagadoBS.
            const cubiertoBs = sumR([
                totalPagadoBS,
                mulR(casheaAmountUsd, tasaSegura),
                mulR(parseFloat(pagoSaldoFavor) || 0, tasaSegura),
            ]);
            const remBs = Math.max(0, subR(bsTotals.totalBs, cubiertoBs));
```

### VERIFICAR FASE 5
```bash
grep -c 'casheaAmountUsd, triggerHaptic' src/hooks/useCheckoutCalculations.js   # → 1
grep -c 'const cubiertoBs = sumR(\[' src/components/Sales/CheckoutModalPOS/index.jsx   # → 1
grep -c 'sumR' src/components/Sales/CheckoutModalPOS/index.jsx   # → 2 o más
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -6
```

> ⚠️ Si el build falla con `casheaAmountUsd is not defined` o `pagoSaldoFavor is not defined` en el POS, **ABORTA la fase**: significa que esas variables tienen otro nombre en este archivo. Reporta al humano.

### ROLLBACK Fase 5
```bash
git checkout -- src/hooks/useCheckoutCalculations.js src/components/Sales/CheckoutModalPOS/index.jsx
```

---

## FASE 6 — 🟠 A-5: la auditoría miente con doble precio

**Archivo:** [`src/utils/checkoutProcessor.js`](src/utils/checkoutProcessor.js) · **4 ediciones**

**Qué está roto:** el procesador recalcula el total (`activeCartTotalUsd`) cuando hay ítems con doble precio y se paga en Bs, pero **cuatro lugares siguen usando el prop crudo `cartTotalUsd`**. Consecuencia: el log de auditoría reporta un total distinto al de la venta persistida (imposible de conciliar), el umbral de vuelto anómalo se calcula sobre la base equivocada, y el total en COP queda desalineado.

Las cuatro ediciones son mecánicas: `cartTotalUsd` → `activeCartTotalUsd`.

### Edición 6a — umbral de vuelto anómalo

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'const changeAnomalyThresholdUsd = mulR(cartTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);' src/utils/checkoutProcessor.js
```

**BUSCAR:**
```javascript
    const changeAnomalyThresholdUsd = mulR(cartTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);
```
**REEMPLAZAR POR:**
```javascript
    const changeAnomalyThresholdUsd = mulR(activeCartTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);
```

### Edición 6b — mensaje de error del vuelto anómalo

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'Vuelto anómalo detectado' src/utils/checkoutProcessor.js
```

**BUSCAR:**
```javascript
            error: `Vuelto anómalo detectado: $${round2(changeUsd)} para una venta de $${round2(cartTotalUsd)}. Verifica los montos ingresados.`
```
**REEMPLAZAR POR:**
```javascript
            error: `Vuelto anómalo detectado: $${round2(changeUsd)} para una venta de $${round2(activeCartTotalUsd)}. Verifica los montos ingresados.`
```

### Edición 6c — fallback del total en COP

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c ': mulR(cartTotalUsd, tasaCop))' src/utils/checkoutProcessor.js
```

**BUSCAR:**
```javascript
                : mulR(cartTotalUsd, tasaCop))
```
**REEMPLAZAR POR:**
```javascript
                : mulR(activeCartTotalUsd, tasaCop))
```

### Edición 6d — log de auditoría (las dos apariciones juntas)

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'saleId: finalPersistedSale.id, total: cartTotalUsd, items: cart.length' src/utils/checkoutProcessor.js
```

**BUSCAR** (3 líneas):
```javascript
            `Venta #${saleNumber} - $${round2(cartTotalUsd)} - ${cart.length} items - ${selectedCustomer?.name || 'Consumidor Final'}`,
            user,
            { saleId: finalPersistedSale.id, total: cartTotalUsd, items: cart.length }
```
**REEMPLAZAR POR:**
```javascript
            // FIN-036: usar el total dinámico, el mismo que se persiste en la venta.
            `Venta #${saleNumber} - $${round2(activeCartTotalUsd)} - ${cart.length} items - ${selectedCustomer?.name || 'Consumidor Final'}`,
            user,
            { saleId: finalPersistedSale.id, total: activeCartTotalUsd, items: cart.length }
```

### VERIFICAR FASE 6
```bash
grep -c 'cartTotalUsd' src/utils/checkoutProcessor.js
```
Deben quedar **exactamente 3** apariciones del `cartTotalUsd` crudo: la del parámetro desestructurado, la de `activeCartTotalUsd = cartTotalUsd` y ninguna más. (Las que contienen `activeCartTotalUsd` también matchean el patrón, así que no uses este número como criterio único — confirma con el comando siguiente.)

```bash
grep -n 'cartTotalUsd' src/utils/checkoutProcessor.js | grep -v 'activeCartTotalUsd'
```
Este comando debe listar **solo 2 líneas**: `    cartTotalUsd,` (el parámetro) y `let activeCartTotalUsd = cartTotalUsd;`. Cualquier otra línea es una edición que se te quedó pendiente.

```bash
npx vitest run tests/checkout.test.js 2>&1 | tail -20
```
**Esperado: 5 pasan, 1 falla** (solo queda FIN-037).

### ROLLBACK Fase 6
```bash
git checkout -- src/utils/checkoutProcessor.js
```
⚠️ Ojo: este rollback **también deshace la Fase 2**. Si tienes que revertir, re-ejecuta la Fase 2 después.

---

## FASE 7 — 🟡 M-3: leer el cliente fresco dentro del lock

**Archivo:** [`src/utils/checkoutProcessor.js`](src/utils/checkoutProcessor.js) · **1 edición**

**Qué está roto:** el impacto sobre el cliente (deuda/favor) se calcula a partir de `selectedCustomer`, tomado del array `customers` que llegó como prop desde React — potencialmente obsoleto. Los productos ya se releen frescos (`freshProducts`); los clientes no. Si otra pestaña o un abono registró deuda entre el render y el cobro, ese cambio se sobrescribe silenciosamente.

> ℹ️ Es seguro: `procesarImpactoCliente` **clona** el cliente en su línea 6 (`{ ...clienteInicial }`), nunca lo muta. Leer el objeto desde storage no rompe nada.

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'updatedCustomers = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);' src/utils/checkoutProcessor.js
```

Localiza el bloque completo (está dentro del `withLock`, alrededor de la línea 237):

**BUSCAR** (2 líneas):
```javascript
            updatedCustomer  = procesarImpactoCliente(selectedCustomer, transaccionOpts);
            updatedCustomers = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);
```

**REEMPLAZAR POR:**
```javascript
            // FIN-037: releer clientes frescos DENTRO del lock (mismo patrón que freshProducts).
            // El prop `customers` viene del render de React y puede estar obsoleto:
            // aplicar el impacto sobre él sobrescribe abonos o deudas registrados en el medio.
            const freshCustomers = await storageService.getItem(CUSTOMERS_KEY, customers);
            const freshSelected  = freshCustomers.find(c => c.id === selectedCustomer.id) || selectedCustomer;

            updatedCustomer  = procesarImpactoCliente(freshSelected, transaccionOpts);
            updatedCustomers = freshCustomers.map(c => c.id === freshSelected.id ? updatedCustomer : c);
```

> ℹ️ `CUSTOMERS_KEY` ya está declarada en la línea 13 del archivo. **No la redeclares.**

### VERIFICAR FASE 7
```bash
grep -c 'const freshCustomers = await storageService.getItem(CUSTOMERS_KEY, customers);' src/utils/checkoutProcessor.js   # → 1
npx vitest run tests/checkout.test.js 2>&1 | tail -20
```
🎯 **Esperado: los 6 tests pasan.**

```bash
npm test 2>&1 | tail -6
```
**Esperado: 129 pasando, no más de 1 error.**

### ROLLBACK Fase 7
```bash
git checkout -- src/utils/checkoutProcessor.js
```
⚠️ Deshace también las Fases 2 y 6. Re-ejecútalas si reviertes.

### ✅ CHECKPOINT — commit intermedio

Las fases 1-7 cierran los dos bugs de dinero real. **Commitea ahora** antes de seguir con las mejoras de UI:

```bash
git add tests/checkout.test.js src/utils/checkoutProcessor.js src/hooks/useCheckoutCalculations.js src/components/Sales/CheckoutModalPOS/index.jsx
git commit -m "fix(checkout): eliminar doble conteo de vuelto y desalineación de totales

- FIN-034: normalizar el vuelto declarado en checkoutProcessor; el vuelto real
  es el techo absoluto. Corregido también en el origen de ambos modos (POS y basico).
- FIN-035: VENTA_CASHEA conserva el vuelto de la cuota inicial.
- FIN-036: la auditoria y el total COP usan activeCartTotalUsd (doble precio).
- FIN-037: clientes releidos frescos dentro del lock, igual que los productos.
- FIN-038: los botones de auto-relleno en Bs descuentan Cashea y saldo a favor.
- tests/checkout.test.js: 6 tests nuevos."
```

> ⚠️ **No uses `git add -A`**: arrastraría `useRemoteCommands.js` y `OwnerMonitorView.jsx`, que son cambios preexistentes ajenos a este plan.

---

## FASE 8 — 🟠 A-4: el modo básico muestra el total viejo con doble precio

**Archivos:** `useCheckoutCalculations.js` (1 edición) + `CheckoutModal.jsx` (3 ediciones)

**Qué está roto:** el hook recalcula el total cuando hay doble precio y el pago es en Bs (`cartTotals` en sus líneas 44-53), **pero no lo exporta**. El modal sigue mostrando el prop crudo en **9 lugares** de la UI (líneas 137, 141, 146, 166, 170, 242, 277, 282, 551). El operador ve "$10" y el sistema cobra "$11".

**Cómo se arregla sin tocar los 9 lugares:** renombrar el prop a `baseCartTotalUsd` y exportar los valores recalculados del hook con el nombre `cartTotalUsd`. Todas las referencias del JSX quedan apuntando automáticamente al valor correcto. **Es el mismo idioma que el hook ya usa internamente** (sus líneas 15-16 renombran igual).

> ✅ **Verificado seguro:** las 9 referencias del JSX están todas en la línea 137 o más abajo, muy por debajo de la desestructuración del hook (líneas 76-88). No hay riesgo de usar la constante antes de declararla.

### Edición 8a — exportar los totales dinámicos desde el hook

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c '^        safeRate,$' src/hooks/useCheckoutCalculations.js
```

**BUSCAR** (1 línea, 8 espacios de indentación — está dentro del `return {` final del hook):
```javascript
        safeRate,
```

**REEMPLAZAR POR:**
```javascript
        safeRate,
        // A-4: totales recalculados (doble precio + pago en Bs). La UI debe mostrar
        // ESTOS, no los props crudos, o el operador ve un total distinto al que se cobra.
        cartTotalUsd,
        cartTotalBs,
```

### Edición 8b — renombrar los props entrantes del modal

**VERIFICAR ANCLAJE (ambos deben imprimir `1`):**
```bash
grep -c '^    cartTotalUsd,$' src/components/Sales/CheckoutModal.jsx
grep -c '^    cartTotalBs,$' src/components/Sales/CheckoutModal.jsx
```

**BUSCAR** (2 líneas, 4 espacios — están en la lista de props del componente):
```javascript
    cartTotalUsd,
    cartTotalBs,
```

**REEMPLAZAR POR:**
```javascript
    cartTotalUsd: baseCartTotalUsd,
    cartTotalBs: baseCartTotalBs,
```

### Edición 8c — pasar los props renombrados al hook

**VERIFICAR ANCLAJE (ambos deben imprimir `1`):**
```bash
grep -c '^        cartTotalUsd,$' src/components/Sales/CheckoutModal.jsx
grep -c '^        cartTotalBs,$' src/components/Sales/CheckoutModal.jsx
```

**BUSCAR** (2 líneas, 8 espacios — están en el objeto de argumentos de `useCheckoutCalculations`):
```javascript
        cartTotalUsd,
        cartTotalBs,
```

**REEMPLAZAR POR:**
```javascript
        cartTotalUsd: baseCartTotalUsd,
        cartTotalBs: baseCartTotalBs,
```

### Edición 8d — recibir los totales dinámicos del hook

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c '^        safeRate,$' src/components/Sales/CheckoutModal.jsx
```

**BUSCAR** (1 línea — es la última del bloque de desestructuración del hook, justo antes de `    } = useCheckoutCalculations({`):
```javascript
        safeRate,
```

**REEMPLAZAR POR:**
```javascript
        safeRate,
        cartTotalUsd,
        cartTotalBs,
```

> ⚠️ **Ojo con el orden:** haz 8b y 8c ANTES de 8d. Si haces 8d primero, el archivo tendrá dos `cartTotalUsd` en scope y el build fallará con `Identifier 'cartTotalUsd' has already been declared` — lo cual, de hecho, es una buena señal de que estás editando el archivo correcto.

> ℹ️ **`cartTotalCop` y `cartSubtotalUsd` se quedan crudos a propósito.** El doble precio en COP no está implementado en `buildCartTotals`; alinearlos requeriría trabajo de motor. Está declarado en §4 (fuera de alcance).

### VERIFICAR FASE 8
```bash
grep -c 'cartTotalUsd: baseCartTotalUsd' src/components/Sales/CheckoutModal.jsx   # → 2
grep -c '^        cartTotalUsd,$' src/components/Sales/CheckoutModal.jsx          # → 1 (el del hook)
npm run build 2>&1 | tail -5
```
🔴 **Si el build reporta `has already been declared`**, te faltó 8b u 8c. Complétalas.

```bash
npm test 2>&1 | tail -6
```
Sin cambios respecto a la Fase 7 (129 pasando).

### ROLLBACK Fase 8
```bash
git checkout -- src/components/Sales/CheckoutModal.jsx
git checkout -- src/hooks/useCheckoutCalculations.js   # ⚠️ deshace también las Fases 3 y 5
```

---

## FASE 9 — 🟡 M-1: Cashea se autoactiva sin que nadie lo pida

**Archivo:** [`src/components/Sales/CheckoutModal.jsx`](src/components/Sales/CheckoutModal.jsx) · **1 edición**

**Qué está roto:** al seleccionar un cliente con nivel Cashea, un `useEffect` **activa el financiamiento solo** (`setCasheaActive(true)`). El operador que solo quería asociar el cliente a una venta de contado se encuentra con una venta financiada ya armada, y si no lo nota, la venta se registra como `VENTA_CASHEA`. El modo POS **no** hace esto — es una divergencia entre modos, y el POS tiene razón.

**Cómo se arregla:** el nivel del cliente **pre-carga el porcentaje**, pero activar Cashea sigue siendo un acto explícito del operador.

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c '                    setCasheaActive(true);' src/components/Sales/CheckoutModal.jsx
```

**BUSCAR** (4 líneas, dentro del `useEffect` de Cashea):
```javascript
                if (casheaMeetsMinimum) {
                    setCasheaActive(true);
                    setCasheaPercent(CASHEA_LEVEL_MAP[selectedCustomer.casheaLevel]);
                }
```

**REEMPLAZAR POR:**
```javascript
                if (casheaMeetsMinimum) {
                    // M-1: NO autoactivar Cashea. Seleccionar un cliente con nivel Cashea
                    // no significa que la venta sea financiada — el operador decide.
                    // Solo se pre-carga el porcentaje que le corresponde a su nivel.
                    // (El modo POS ya se comporta así; esto alinea ambos modos.)
                    setCasheaPercent(CASHEA_LEVEL_MAP[selectedCustomer.casheaLevel]);
                }
```

### VERIFICAR FASE 9
```bash
grep -c 'setCasheaActive(true)' src/components/Sales/CheckoutModal.jsx   # → 0
grep -c 'setCasheaActive(false)' src/components/Sales/CheckoutModal.jsx  # → 2 (siguen intactos)
npm run build 2>&1 | tail -5
```

> ⚠️ Los dos `setCasheaActive(false)` **deben quedarse**: son los que apagan Cashea cuando se deselecciona el cliente. Si los borras, Cashea queda pegado entre ventas.

### ROLLBACK Fase 9
```bash
git checkout -- src/components/Sales/CheckoutModal.jsx   # ⚠️ deshace también la Fase 8
```

---

## FASE 10 — 🔴 CRÍTICO C-2: el saldo a favor no puede salir como efectivo

**Archivos:** `CheckoutModalPOS/index.jsx` (1 edición) + `WalletSection.jsx` (2 ediciones)
**Gobernada por la decisión D1 del §0.** Si el negocio decidió permitir la conversión, **salta esta fase completa**.

**Qué está roto:** el input de saldo a favor solo valida contra `saldoDisponible`. Un cliente con $50 de crédito que compra $10 puede escribir `50` y el sistema genera **$40 de vuelto en efectivo físico**. El botón "⚡ Todo" sí topea correctamente (`Math.min(saldoDisponible, faltaSinSaldo)`) — el input escrito a mano, no. Y la guarda de vuelto anómalo no lo atrapa: exige `vuelto > $100`, así que cualquier fuga bajo ese monto pasa.

**Además:** `faltaSinSaldo` se calcula contra `totalConIGTF`, que recibe el prop crudo `cartTotalUsd` **y no descuenta Cashea**. Las tres ediciones van juntas.

### Edición 10a — pasar el total dinámico y el monto Cashea al `WalletSection`

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'totalConIGTF={cartTotalUsd}' src/components/Sales/CheckoutModalPOS/index.jsx
```

**BUSCAR:**
```javascript
                                totalConIGTF={cartTotalUsd}
```

**REEMPLAZAR POR:**
```javascript
                                totalConIGTF={dynamicCartTotals.totalUsd}
                                casheaAmountUsd={casheaAmountUsd}
```

### Edición 10b — descontar Cashea del faltante

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'const faltaSinSaldo = Math.max(0, totalConIGTF - pagadoOtros);' src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx
```

**BUSCAR** (2 líneas):
```javascript
    const pagadoOtros = totalPagadoUSD;
    const faltaSinSaldo = Math.max(0, totalConIGTF - pagadoOtros);
```

**REEMPLAZAR POR:**
```javascript
    // C-2: Cashea también cubre parte del total. Sin descontarlo, faltaSinSaldo
    // queda inflado y el tope del saldo a favor permite fugas de efectivo.
    const pagadoOtros = totalPagadoUSD + (parseFloat(casheaAmountUsd) || 0);
    const faltaSinSaldo = Math.max(0, totalConIGTF - pagadoOtros);
    // C-2 (D1): el saldo a favor solo cubre lo que se debe. NO se convierte en efectivo.
    const maxAplicable = Math.min(saldoDisponible, faltaSinSaldo);
```

Y añade el prop a la firma del componente:

**BUSCAR:**
```javascript
    totalConIGTF,
    pagoSaldoFavor,
```
**REEMPLAZAR POR:**
```javascript
    totalConIGTF,
    casheaAmountUsd = 0,
    pagoSaldoFavor,
```

### Edición 10c — topear el input

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'v <= saldoDisponible' src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx
```

**BUSCAR:**
```javascript
                            if (e.target.value === '' || (v >= 0 && v <= saldoDisponible)) {
```

**REEMPLAZAR POR:**
```javascript
                            // C-2 (D1): el tope es maxAplicable, no saldoDisponible.
                            if (e.target.value === '' || (v >= 0 && v <= maxAplicable)) {
```

Y actualiza el botón "⚡ Todo" para reusar la constante:

**BUSCAR:**
```javascript
        const aUsar = Math.min(saldoDisponible, faltaSinSaldo);
```
**REEMPLAZAR POR:**
```javascript
        const aUsar = maxAplicable;
```

### VERIFICAR FASE 10
```bash
grep -c 'const maxAplicable = Math.min(saldoDisponible, faltaSinSaldo);' src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx   # → 1
grep -c 'v <= maxAplicable' src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx   # → 1
grep -c 'casheaAmountUsd={casheaAmountUsd}' src/components/Sales/CheckoutModalPOS/index.jsx      # → 1
npm run build 2>&1 | tail -5
```

> ⚠️ `maxAplicable` se declara **después** de `faltaSinSaldo` y **antes** de `handleUsarTodo`. Si el build dice `Cannot access 'maxAplicable' before initialization`, movió mal el orden: `handleUsarTodo` debe quedar debajo.

### ROLLBACK Fase 10
```bash
git checkout -- src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx
git checkout -- src/components/Sales/CheckoutModalPOS/index.jsx   # ⚠️ deshace también las Fases 4 y 5
```

---

## FASE 11 — 🟠 A-2: eliminar el botón muerto de saldo a favor

**Archivo:** [`src/components/Sales/CheckoutModal.jsx`](src/components/Sales/CheckoutModal.jsx) · **4 ediciones**
**Gobernada por la decisión D2 del §0.** Si el humano prefiere implementar la funcionalidad, **salta esta fase** y abre una tarea aparte.

**Qué está roto:** el botón "Usar Saldo a Favor" llama a `onUseSaldoFavor`, un prop que **`SalesView` nunca pasa** (no está en el objeto `sharedProps` de sus líneas 939-959). El `if (onUseSaldoFavor)` lo hace fallar en silencio. Además su condición de visibilidad lee el campo equivocado: usa `selectedCustomer?.deuda < -0.01` cuando el saldo a favor vive en `selectedCustomer.favor` — así que hasta se muestra en el caso incorrecto.

### Edición 11a — quitar el bloque del botón

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'selectedCustomer?.deuda < -0.01 && remainingUsd > 0.01' src/components/Sales/CheckoutModal.jsx
```

**BUSCAR** — el bloque JSX completo, desde el comentario `{/* Saldo a Favor */}` hasta el `)}` de cierre (11 líneas, alrededor de la línea 307):
```javascript
                {/* Saldo a Favor */}
                {selectedCustomer?.deuda < -0.01 && remainingUsd > 0.01 && (
```
…hasta e incluyendo el `)}` que cierra ese bloque, justo antes de `            </div>`.

**REEMPLAZAR POR:**
```javascript
                {/* A-2: el botón "Usar Saldo a Favor" fue eliminado. Llamaba a onUseSaldoFavor,
                    un prop que SalesView nunca pasó (no está en sharedProps), así que fallaba
                    en silencio; y su condición leía `deuda` en vez de `favor`.
                    El modo POS sí tiene la funcionalidad (WalletSection) si hay que reimplementarla. */}
```

### Edición 11b — quitar el handler huérfano

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'if (onUseSaldoFavor) onUseSaldoFavor();' src/components/Sales/CheckoutModal.jsx
```

**BUSCAR** (4 líneas):
```javascript
    const handleSaldoFavor = useCallback(() => {
        triggerHaptic && triggerHaptic();
        if (onUseSaldoFavor) onUseSaldoFavor();
    }, [onUseSaldoFavor, triggerHaptic]);
```
**REEMPLAZAR POR:** (nada — borra las 4 líneas y la línea en blanco que las sigue)

### Edición 11c — quitar el prop de la firma

**BUSCAR:**
```javascript
    onUseSaldoFavor,
```
**REEMPLAZAR POR:** (nada — borra la línea)

### Edición 11d — quitar `Wallet` del import

🔴 **Obligatoria.** `Wallet` solo se usaba en el botón eliminado; dejarlo genera un error de lint por import sin usar.

**VERIFICAR ANCLAJE (debe imprimir `0` DESPUÉS de 11a):**
```bash
grep -c '<Wallet' src/components/Sales/CheckoutModal.jsx
```
Si imprime más de `0`, **NO hagas esta edición**: `Wallet` se usa en otro lugar y el import debe quedarse.

**BUSCAR:**
```javascript
import { X, Users, Receipt, Wallet, ArrowLeftRight, AlertTriangle, Smartphone, Lock, LayoutGrid } from 'lucide-react';
```
**REEMPLAZAR POR:**
```javascript
import { X, Users, Receipt, ArrowLeftRight, AlertTriangle, Smartphone, Lock, LayoutGrid } from 'lucide-react';
```

### VERIFICAR FASE 11
```bash
grep -c 'onUseSaldoFavor' src/components/Sales/CheckoutModal.jsx   # → 0
grep -c 'handleSaldoFavor' src/components/Sales/CheckoutModal.jsx  # → 0
grep -c 'Wallet' src/components/Sales/CheckoutModal.jsx            # → 0
npm run build 2>&1 | tail -5
```

> ℹ️ `SalesView.jsx` **no se toca**: nunca pasaba el prop, así que no queda nada huérfano ahí.

### ROLLBACK Fase 11
```bash
git checkout -- src/components/Sales/CheckoutModal.jsx   # ⚠️ deshace también las Fases 8 y 9
```

---

## FASE 12 — 🟡 M-2: el POS deja cobrar con tasa inválida

**Archivos:** `CheckoutModalPOS/index.jsx` (2 ediciones) + `PaymentFooter.jsx` (2 ediciones)

**Qué está roto:** el modo básico ya tiene guarda de tasa (el hook expone `rateError` y el modal lo usa). El POS **no**: si la tasa BCV es 0 o inválida, permite pulsar PAGAR. La venta se rechaza recién en `checkoutProcessor` (línea 59), después de que el operador armó el cobro completo. Es una divergencia entre modos y una mala experiencia en el peor momento.

> ℹ️ **Alcance deliberadamente mínimo:** solo la guarda de tasa. El modal de advertencias inteligentes (`PaymentWarningModal`) y el aviso de fondo de caja del POS **quedan fuera** (§4).

### Edición 12a — calcular el flag

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'const casheaMeetsMinimum = casheaMinAmount <= 0 || dynamicCartTotals.totalUsd >= casheaMinAmount;' src/components/Sales/CheckoutModalPOS/index.jsx
```

**BUSCAR:**
```javascript
    const casheaMeetsMinimum = casheaMinAmount <= 0 || dynamicCartTotals.totalUsd >= casheaMinAmount;
```
**REEMPLAZAR POR:**
```javascript
    const casheaMeetsMinimum = casheaMinAmount <= 0 || dynamicCartTotals.totalUsd >= casheaMinAmount;

    // M-2: paridad con el modo básico — bloquear el cobro si la tasa BCV es inválida.
    // Sin esto el POS deja armar todo el pago y el rechazo llega recién en el procesador.
    const rateError = !effectiveRate || effectiveRate <= 0;
```

### Edición 12b — guardar `procesarPago`

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c "if (modo === 'contado' && faltaPorPagar > 0.01) {" src/components/Sales/CheckoutModalPOS/index.jsx
```

**BUSCAR** (2 líneas):
```javascript
            // Validaciones
            if (modo === 'contado' && faltaPorPagar > 0.01) {
```
**REEMPLAZAR POR:**
```javascript
            // Validaciones
            // M-2: la tasa se valida PRIMERO — sin tasa válida nada de lo demás tiene sentido.
            if (rateError) {
                showToast('Tasa BCV inválida. Configúrala antes de cobrar.', 'error');
                return;
            }
            if (modo === 'contado' && faltaPorPagar > 0.01) {
```

### Edición 12c — pasar el flag al footer

**BUSCAR:**
```javascript
                            onProcesar={procesarPago}
                            isProcessing={isProcessing}
```
**REEMPLAZAR POR:**
```javascript
                            onProcesar={procesarPago}
                            isProcessing={isProcessing}
                            rateError={rateError}
```

### Edición 12d — deshabilitar el botón

**Archivo:** [`src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx`](src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx)

**VERIFICAR ANCLAJE (debe imprimir `1`):**
```bash
grep -c 'const disabled = isProcessing || (modo ===' src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx
```

**BUSCAR** (2 líneas de la firma):
```javascript
    onProcesar,
    isProcessing = false,
```
**REEMPLAZAR POR:**
```javascript
    onProcesar,
    isProcessing = false,
    rateError = false,
```

**BUSCAR** (3 líneas):
```javascript
    const disabled = isProcessing || (modo === 'contado'
        ? faltaPorPagar > 0.01
        : !clienteSeleccionado);
```
**REEMPLAZAR POR:**
```javascript
    // M-2: sin tasa BCV válida no se cobra (paridad con el modo básico).
    const disabled = isProcessing || rateError || (modo === 'contado'
        ? faltaPorPagar > 0.01
        : !clienteSeleccionado);
```

### VERIFICAR FASE 12
```bash
grep -c 'const rateError = !effectiveRate || effectiveRate <= 0;' src/components/Sales/CheckoutModalPOS/index.jsx   # → 1
grep -c 'isProcessing || rateError' src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx              # → 1
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -6
```

> ⚠️ Si el build falla con `effectiveRate is not defined` en el POS, **ABORTA**: el prop se llama distinto en ese archivo. Reporta al humano.

### ROLLBACK Fase 12
```bash
git checkout -- src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx
git checkout -- src/components/Sales/CheckoutModalPOS/index.jsx   # ⚠️ deshace las Fases 4, 5 y 10
```

---

## FASE 13 — CIERRE Y CERTIFICACIÓN

### Paso 13.1 — Verificación automática completa

```bash
npm run build 2>&1 | tail -8
npm test 2>&1 | tail -8
```

**Criterios de aceptación (los tres son obligatorios):**

| Criterio | Valor esperado |
|---|---|
| Build | Termina sin errores |
| Tests pasando | **≥ 129** (123 base + 6 nuevos) |
| Errores | **no más de 1** (el preexistente de la Fase 0) |
| Tests fallando | **0** |

🔴 **Si hay tests en rojo, NO commitees.** Identifica la fase culpable, ejecuta su rollback, y reporta al humano.

### Paso 13.2 — Barrido final de anclajes

```bash
echo "--- deben ser 0 (código viejo eliminado) ---"
grep -c 'defaultUsdChange' src/hooks/useCheckoutCalculations.js
grep -c 'distVueltoUSD ? parseFloat' src/components/Sales/CheckoutModalPOS/index.jsx
grep -c 'onUseSaldoFavor' src/components/Sales/CheckoutModal.jsx
grep -c 'setCasheaActive(true)' src/components/Sales/CheckoutModal.jsx
grep -c 'v <= saldoDisponible)' src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx

echo "--- deben ser 1 (código nuevo presente) ---"
grep -c 'FIN-034' src/utils/checkoutProcessor.js
grep -c 'const freshCustomers = await storageService.getItem' src/utils/checkoutProcessor.js
grep -c 'const hasExplicitSplit' src/hooks/useCheckoutCalculations.js
grep -c 'const hasExplicitSplit' src/components/Sales/CheckoutModalPOS/index.jsx
grep -c 'const maxAplicable' src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx
grep -c 'const rateError' src/components/Sales/CheckoutModalPOS/index.jsx
```

> ℹ️ El primer `grep -c 'FIN-034'` puede dar `2` (la normalización y el comentario del bloque `sale`). Eso está bien; lo que no puede dar es `0`.

### Paso 13.3 — 🖐️ CHECKLIST MANUAL E2E (obligatorio)

Las Fases 3, 4, 5, 8, 9, 10, 11 y 12 tocan React y **no tienen cobertura automática** (el proyecto no tiene `@testing-library`). Estos 9 casos son la única verificación posible. **Ejecútalos en `npm run dev` antes de dar el trabajo por terminado.**

| # | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| E1 | **Vuelto simple, modo básico** | Venta $10, tasa 40. Paga $20 en efectivo USD. **No toques el desglose de vuelto.** Cobra. | El ticket muestra vuelto **$10** (o 400 Bs), **nunca los dos**. Ve a Cierre de Caja: el efectivo esperado debe ser $10, sin sobrante fantasma. |
| E2 | **Vuelto simple, modo POS** | Igual que E1 pero en modo POS. | Idéntico a E1. |
| E3 | **Botón "Todo" del vuelto en Bs (POS)** | Venta $10, paga $20 USD. En el campo de vuelto en **Bs** pulsa "Todo". Cobra. | Vuelto registrado: **400 Bs y $0**. Antes registraba 400 Bs **más** $10. |
| E4 | **Desglose mixto** | Venta $10, paga $20. Escribe $4 en el campo USD y 240 en el de Bs. Cobra. | Se registran exactamente $4 y 240 Bs. |
| E5 | **Cashea + "Todo" en Bs** | Activa Cashea al 60% en una venta de $100. Pulsa "Todo" en el campo de efectivo Bs. | Debe escribir **1600 Bs** (los $40 que faltan), no 4000 Bs. |
| E6 | **Cashea con vuelto** | Venta $100, Cashea cubre $60. Cliente paga $50 en efectivo. Cobra. | El vuelto de **$10** queda registrado en la venta. Antes se perdía. |
| E7 | **Doble precio, modo básico** | Ítem con `pricingMode: 'dual_usd'` (precio USD $10, ref Bs $11). Escribe un monto en un campo de efectivo **Bs**. | El total en pantalla cambia a **$11 / 440 Bs**. Antes seguía mostrando $10. |
| E8 | **Cliente Cashea no autoactiva** | Selecciona un cliente con nivel Cashea en el modo **básico**. | Cashea **NO** se activa solo. El porcentaje queda pre-cargado según su nivel. |
| E9 | **Saldo a favor topeado (POS)** | Cliente con **$50** de saldo a favor. Venta de **$10**. Intenta escribir `50` en el campo de saldo. | El input **no acepta más de 10**. No se genera vuelto en efectivo. |
| E10 | **Tasa inválida (POS)** | Pon la tasa BCV en 0 y abre el checkout POS. | El botón PAGAR está **deshabilitado**; si lo intentas, aparece el toast "Tasa BCV inválida". |

### Paso 13.4 — Commit final

```bash
git add tests/checkout.test.js \
        src/utils/checkoutProcessor.js \
        src/hooks/useCheckoutCalculations.js \
        src/components/Sales/CheckoutModal.jsx \
        src/components/Sales/CheckoutModalPOS/index.jsx \
        src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx \
        src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx

git commit -m "fix(checkout): auditoria completa de ambos modos de cobro

Criticos:
- C-1 (FIN-034): eliminado el doble conteo de vuelto. El vuelto real es el techo
  absoluto en checkoutProcessor, y se corrigio el origen en ambos modos.
- C-2: el saldo a favor ya no se puede convertir en efectivo (tope = lo que falta).

Altos:
- A-1 (FIN-038): los botones de auto-relleno en Bs descuentan Cashea y saldo a favor.
- A-2: eliminado el boton muerto 'Usar Saldo a Favor' del modo basico.
- A-3 (FIN-035): VENTA_CASHEA conserva el vuelto de la cuota inicial.
- A-4: el modo basico muestra los totales dinamicos de doble precio.
- A-5 (FIN-036): auditoria y total COP alineados con activeCartTotalUsd.

Medios:
- M-1: seleccionar un cliente con nivel Cashea ya no autoactiva el financiamiento.
- M-2: el modo POS bloquea el cobro con tasa BCV invalida (paridad con el basico).
- M-3 (FIN-037): clientes releidos frescos dentro del lock, igual que los productos.

Tests: tests/checkout.test.js (6 casos). Validacion manual E2E: 10 casos.
Ref: AUDITORIA-CHECKOUT.md"
```

> ⚠️ **Nunca `git add -A`.** `useRemoteCommands.js` y `OwnerMonitorView.jsx` son cambios preexistentes que no pertenecen a este trabajo.

### Paso 13.5 — Reporte al humano

Entrega exactamente esto:
1. Conteo final de tests (pasando / fallando / errores) y el hash del commit.
2. Qué fases se ejecutaron y **cuáles se saltaron, con el motivo** (decisión D1/D2, o bug ya corregido).
3. Resultado de cada uno de los 10 casos del checklist E2E (✅/❌/no probado).
4. Cualquier fase abortada, con el comando de verificación que falló y su salida literal.

---

## §3. MATRIZ DE RIESGO

| Fase | Riesgo | Probabilidad | Mitigación incluida |
|---|---|---|---|
| 2 | La normalización rompe un desglose de vuelto legítimo | Baja | Test de regresión explícito (`desglose válido se persiste intacto`) |
| 2 | `divR` con tasa 0 → división por cero | **Nula** | `effectiveRate` ya fue validado `> 0` en la línea 59, antes de este bloque. Documentado en el propio comentario. |
| 3, 4 | Se pierde el vuelto cuando el operador sí quiso desglosar | Baja | `hasExplicitSplit` respeta cualquier campo tocado; casos E3 y E4 del checklist |
| 5 | `casheaAmountUsd` no existe en el scope del POS | Baja | Verificación de build explícita con instrucción de abortar |
| 5b | El `useCallback` conserva una closure obsoleta | **Media** | Edición dedicada para la dependencia, marcada como no salteable |
| 7 | `procesarImpactoCliente` muta un objeto congelado | **Nula** | Verificado: clona en su línea 6. Anotado en G3. |
| 8 | Colisión de identificadores `cartTotalUsd` | **Alta si se altera el orden** | Orden explícito 8b → 8c → 8d, con el mensaje de error exacto documentado |
| 8 | Alguna referencia del JSX resuelve antes de la declaración (TDZ) | **Nula** | Verificado: las 9 referencias están en la línea 137+, el hook se desestructura en la 76-88 |
| 9 | Cashea queda pegado entre ventas | Baja | Advertencia de no borrar los `setCasheaActive(false)` |
| 10 | El tope bloquea un uso legítimo del saldo | Baja | Es la decisión D1, documentada y reversible saltando la fase |
| 11 | Error de lint por el import `Wallet` sin usar | Media | Edición 11d obligatoria, con verificación previa de que no se usa en otro lado |
| 12 | El prop de tasa tiene otro nombre en el POS | Baja | Verificación de build con instrucción de abortar |
| Todas | Un LLM ajusta un test en vez del código | **Media** | Regla absoluta en la Fase 1 + guardarraíl G9 |

---

## §4. FUERA DE ALCANCE (no lo hagas en este plan)

Detectado en la auditoría pero **deliberadamente excluido**. Registrado para una tarea futura.

| Tema | Por qué se excluye |
|---|---|
| **Unificar los dos checkouts en un solo componente** | Es la causa raíz de la mayoría de estos bugs, pero es una refactorización mayor con riesgo altísimo. Merece su propio plan. |
| **Implementar de verdad el saldo a favor en el modo básico** | Decisión D2. Requiere diseño de UI y un pago virtual `saldo_favor`. Tarea de producto. |
| **Doble precio en COP** (`cartTotalCop`, `cartSubtotalUsd` crudos) | `buildCartTotals` no soporta referencia de precio en COP. Requiere trabajo de motor. |
| **`PaymentWarningModal` en el modo POS** | El POS no tiene detección de errores de tipeo. Es una feature, no un fix. |
| **Aviso de fondo de caja insuficiente** | `currentFloatUsd` / `currentFloatBs` se desestructuran en el POS y nunca se usan (línea 41-42). Es una feature nueva. |
| **`vueltoParaMonedero` siempre en 0** | El checkout no enruta vuelto al monedero del cliente. Es intencional según el comentario FIN-012. |
| **Los 10 hallazgos bajos (B-1 a B-10)** | Cosméticos o de mantenibilidad. No afectan dinero. Ver `AUDITORIA-CHECKOUT.md`. |
| **Instalar `@testing-library`** | Ampliaría muchísimo la cobertura de estos fixes, pero añadir dependencias no pertenece a un plan de corrección de bugs. Propónlo como tarea aparte. |

---

**FIN DEL PLAN.** 13 fases · 2 críticos · 5 altos · 3 medios · 6 tests nuevos · 10 casos E2E.
