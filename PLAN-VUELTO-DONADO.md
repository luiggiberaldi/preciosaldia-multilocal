# PLAN LITERAL — Portar "Cliente deja el cambio" (propina donada a caja) a `preciosaldia-bodega`

**Auditoría de origen:** [`AUDITORIA-VUELTO-DONADO.md`](AUDITORIA-VUELTO-DONADO.md)
**Ejecutor previsto:** LLM flash. Cada fase es literal: se busca un texto exacto y se reemplaza por otro exacto.
**Fases:** 0 → 12. Se ejecutan **en orden**. No se salta ninguna.

---

## §0 — DECISIONES DE NEGOCIO YA TOMADAS

Estas decisiones **ya están cerradas**. El ejecutor **no pregunta**, implementa.

| ID | Decisión | Consecuencia |
|---|---|---|
| **D1** | La propina **NO** es un método de pago. No se suma como ingreso extra. | El efectivo ya está contado en `efectivo_usd`/`efectivo_bs`. Al no entregar vuelto, la propina ya está dentro del ingreso neto. El bucket `_propina_*` es **solo informativo** y se excluye de todos los cálculos de ingreso y porcentaje. |
| **D2** | La propina tiene **una sola moneda**. Nunca se guarda el mismo dinero en USD y en Bs a la vez. | `sale.tipDonated.amountUsd` es **siempre** el monto canónico en USD (para agregar). `amountBs` se rellena **solo** cuando `currency === 'BS'`. Corrige T-1. |
| **D3** | Propina donada ⟹ **vuelto entregado = 0**, siempre. Son mutuamente excluyentes. | Se fuerza en el procesador (defensa en profundidad), no solo en la UI. |
| **D4** | Propina **incompatible con `VENTA_FIADA`**. | Una venta fiada no genera sobrepago, así que no hay vuelto que donar. El procesador la anula. |
| **D5** | Propina **compatible con `VENTA_CASHEA`**. | El vuelto de la cuota inicial es efectivo real que salió de caja; el cliente puede dejarlo. |
| **D6** | Propinas **> $20** requieren **doble pulsación** del botón. | Corrige T-2. Un tap accidental sobre un vuelto anómalo ($496) no puede donar solo. Umbral en `FINANCIAL_EPSILON.TIP_MAX_AUTO_USD`. |
| **D7** | La moneda de la propina se deriva de **la composición real del efectivo**, no del orden de los métodos. | Corrige T-4. Se reutiliza la comparación `efectivoBs > efectivoUsd×tasa`. |
| **D8** | **No se implementa propina en COP.** Si el pago es puro COP, la propina se etiqueta `USD`. | Corrige T-5. No existe camino COP en la UI del vuelto; inventar uno abre riesgo sin beneficio. |
| **D9** | Al **anular** una venta con propina, el sistema **no revierte** dinero automáticamente. Registra el monto en el log de auditoría. | Corrige T-3 parcialmente. El dinero físico lo resuelve el operador; el sistema deja constancia auditable. Los reportes ya excluyen `ANULADA` automáticamente. |
| **D10** | **No** se implementa atribución por cajero. | T-10 queda fuera de alcance: `sale` ya lleva el usuario vía el log de auditoría. |

---

## §1 — GUARDARRAÍLES: LO QUE NO SE TOCA

> ⛔ Violar cualquiera de estos puntos invalida la ejecución completa. Si una fase parece exigirlo, **detener y reportar**, no improvisar.

| # | Prohibición |
|---|---|
| **G1** | **NO** modificar `src/utils/financialLogic.js`. Ni una línea. La propina no toca el saldo del cliente. |
| **G2** | **NO** crear un método de pago virtual `propina` en `payments[]`. Ver D1. Inflaría los ingresos brutos. |
| **G3** | **NO** modificar `src/components/Dashboard/CierreCajaWizard.jsx`. El arqueo lee `efectivo_usd` y `_vuelto_usd` por clave literal; la propina funciona sin tocarlo (porque el vuelto entregado es 0). |
| **G4** | **NO** modificar la lógica de `computeExpectedCash` ni la resta de `_vuelto_*` en ningún sitio. |
| **G5** | **NO** quitar ni alterar `withLock('pos_write_lock')` ni `deepFreeze(...)` en `checkoutProcessor.js`. |
| **G6** | **NO** alterar la normalización FIN-034/FIN-035 existente (`hasExplicitSplit`, `givenChangeUsd`, `givenChangeBs`). Solo se **añade** encima de ella. |
| **G7** | **NO** tocar la detección de anomalía FIN-005 en `FinancialEngine.js` ni en `checkoutProcessor.js`. |
| **G8** | **NO** modificar ni borrar tests existentes. Solo se **añade** `tests/tipDonated.test.js`. |
| **G9** | **NO** reformatear, reordenar imports, ni "limpiar" código adyacente. Solo los reemplazos literales indicados. |
| **G10** | **NO** renombrar `isChangeCredited` / `vueltoCredito` (abonar vuelto al monedero). Es una funcionalidad **distinta** que coexiste con la propina. |

### Guardarraíl principal — la propina toca 3 capas, no 1

El defecto T-1 del origen no se corrige en un solo archivo. Requiere **las tres**:

1. **FASE 4** (`checkoutProcessor.js`) — guardar una sola moneda canónica.
2. **FASE 3** (`FinancialEngine.js`) — un bucket por moneda, con `total` estándar.
3. **FASE 5** (consumidores) — excluir `isTip` de los métodos de pago y de los porcentajes.

> ⚠️ **Si se hace solo la FASE 3 y 4 pero no la 5, la propina se cuenta como ingreso extra y el Dashboard reporta más dinero del que hay.** No concluir que basta con guardar el dato.

---

## §2 — CONVENCIONES DE EJECUCIÓN

1. **Orden estricto.** Fase N solo empieza si `VERIFICAR FASE N-1` pasó.
2. **`VERIFICAR ANCLAJE` antes de cada edición.** Todo comando de anclaje debe imprimir exactamente `1`. Si imprime `0` o `>1`, **detener y reportar**, no buscar "algo parecido".
3. **Siempre `grep -cF` (cadena fija)** para anclajes que contengan `[`, `]`, `$`, `*`, `(`, `)`, `.`, `?` o `|`. Un `grep -c "const [x, y] = ..."` devuelve `0` porque BRE interpreta `[...]` como clase de caracteres. Esto ya causó un fallo en un plan anterior.
4. **Reemplazo literal.** Copiar el bloque `REEMPLAZAR POR` tal cual, respetando la indentación indicada (4 espacios por nivel en `.js`, la del JSX circundante en `.jsx`).
5. **Nunca `sed -i`.** Usar la herramienta de edición de archivos del agente.
6. **Cada fase termina con `VERIFICAR FASE`.** Si falla, aplicar el `ROLLBACK` de esa fase y reportar.
7. **Sin imports duplicados.** Antes de añadir un import, comprobar con `grep -cF` que no existe.
8. **Honestidad de alcance.** Los tests cubren capas puras (procesador, motor). **No** cubren React: `@testing-library` no es dependencia del proyecto, no existe `renderHook`. Las fases de UI se validan con el checklist manual de la FASE 12. No afirmar que la UI está "testeada".

---

## FASE 0 — Compuerta, rama y línea base

### 0a) COMPUERTA DURA: el plan de checkout debe estar ejecutado

Esta funcionalidad edita **exactamente las mismas líneas** que corrige `PLAN-FIXEO-CHECKOUT.md`. Si ese plan no se ejecutó, la propina hereda el doble conteo de vuelto.

```bash
grep -cF "hasExplicitSplit" src/hooks/useCheckoutCalculations.js
grep -cF "hasExplicitSplit" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "FIN-034" src/utils/checkoutProcessor.js
grep -cF "givenChangeUsd" src/utils/checkoutProcessor.js
```

**Resultado exigido:** `3`, `3`, `2`, `2`.

> ⛔ Si cualquiera imprime `0`: **ABORTAR TODO EL PLAN**. Reportar: *"PLAN-FIXEO-CHECKOUT.md no está ejecutado. Ejecutar ese plan primero."*

### 0b) Rama

```bash
git rev-parse --abbrev-ref HEAD
```
Si la salida es `main`, crear rama:
```bash
git checkout -b feat/vuelto-donado-propina
```
Si la salida ya es `fix/checkout-vuelto-e2e` o `feat/vuelto-donado-propina`, **continuar en ella** (el trabajo de checkout vive allí).

### 0c) Línea base de tests

```bash
npm test 2>&1 | tail -8
```

**Línea base esperada:**
```
 Test Files  10 passed (11)
      Tests  141 passed | 10 skipped (190)
     Errors  1 error
```

> ℹ️ **El `1 error` es PRE-EXISTENTE** (`Worker exited unexpectedly`, flake de entorno en Windows). **No es un fallo de tests y no se debe intentar arreglar.** Al final del plan debe seguir siendo `≤ 1 error`.

### 0d) Estado de git esperado

```bash
git status --short
```
Es normal ver `M` en `src/components/Sales/CheckoutModalPOS/index.jsx`, `src/hooks/useCheckoutCalculations.js`, `src/utils/checkoutProcessor.js`, `src/hooks/useRemoteCommands.js`, `src/views/OwnerMonitorView.jsx` y `??` en los `.md` de plan y `tests/checkout.test.js` / `tests/cashea.test.js`. **No revertir nada.**

### 0e) Verificación de los 12 anclajes

Todos deben imprimir exactamente `1`:

```bash
grep -cF "  CHANGE_ANOMALY_MIN_BS_FACTOR: 100," src/utils/securityConstants.js
grep -cF "            if (safeChangeBs > 0) {" src/core/FinancialEngine.js
grep -cF "    const tipoVenta = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA');" src/utils/checkoutProcessor.js
grep -cF "        casheaUsd: casheaUsd" src/utils/checkoutProcessor.js
grep -cF "    const vueltoUsd    = allEntries.filter(([, d]) => d.isChange && d.currency === 'USD');" src/components/Dashboard/DashboardPaymentBreakdown.jsx
grep -cF "    const [isChangeCredited, setIsChangeCredited] = useState(false);" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "            const hasExplicitSplit = distVueltoUSD !== '' || distVueltoBS !== '';" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "                    {isPaid && cambioUSD > 0.009 && (" src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
grep -cF "    const [changeBsGiven, setChangeBsGiven] = useState('');" src/hooks/useCheckoutCalculations.js
grep -cF "        const hasExplicitSplit = Boolean(changeUsdGiven) || Boolean(changeBsGiven);" src/hooks/useCheckoutCalculations.js
grep -cF "                    {isPaid && changeUsd > 0.009 && (" src/components/Sales/CheckoutModal.jsx
grep -cF "                                {receipt.changeUsd > 0 && (" src/components/Sales/ReceiptModal.jsx
```

**Si alguno imprime `0` o `>1` → DETENER Y REPORTAR.** El archivo divergió de lo que este plan asume.

### 0f) Confirmar que la funcionalidad no existe ya

```bash
grep -rl "tipDonated" src/ | wc -l
```
**Resultado exigido:** `0`. Si imprime otra cosa, la funcionalidad está parcialmente presente → **DETENER Y REPORTAR**.

---

## FASE 1 — Tests (deben FALLAR)

Crear el archivo **nuevo** `tests/tipDonated.test.js` con este contenido **exacto y completo**:

```js
// tests/tipDonated.test.js — Propina donada ("Cliente deja el cambio").
// Cubre TIP-001 a TIP-006. Ver PLAN-VUELTO-DONADO.md.
//
// ALCANCE: capas puras (checkoutProcessor + FinancialEngine).
// La UI (CheckoutModalPOS, PaymentLeftColumn, CheckoutModal) NO se testea aquí:
// @testing-library no es dependencia del proyecto. Se valida con el checklist manual.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (copiados de tests/checkout.test.js, deben ir arriba del todo) ──
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
import { FinancialEngine } from '../src/core/FinancialEngine';
import { storageService } from '../src/utils/storageService';
import { logEvent } from '../src/services/auditService';

const SALES_KEY = 'bodega_sales_v1';

function resetMockStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    logEvent.mockClear();
}

// Venta de $10 a tasa 40, pagada con $15 en efectivo USD → vuelto real $5.
function baseOpts(over = {}) {
    return {
        cart: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
        cartTotalUsd: 10,
        cartTotalBs: 400,
        cartSubtotalUsd: 10,
        payments: [{ amountUsd: 15, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
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

async function persistedSale() {
    const sales = _memoryStore.get(SALES_KEY) || [];
    return sales[0];
}

beforeEach(() => resetMockStore());

// ════════════════════════════════════════════════════════════════════════
// TIP-001 — La propina se guarda en UNA sola moneda (corrige T-1)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-001: una sola moneda canónica', () => {

    it('propina en USD: amountUsd = 5, amountBs = 0', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 5, amountBs: 200, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipDonated).toBeTruthy();
        expect(sale.tipDonated.currency).toBe('USD');
        expect(sale.tipDonated.amountUsd).toBe(5);
        // amountBs debe quedar en 0: la moneda canónica es USD.
        expect(sale.tipDonated.amountBs).toBe(0);
    });

    it('propina en BS: amountUsd = 5 (canónico) y amountBs = 200 (nativo)', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 5, amountBs: 999999, currency: 'BS' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipDonated.currency).toBe('BS');
        expect(sale.tipDonated.amountUsd).toBe(5);
        // amountBs se RECALCULA desde amountUsd × tasa: no se confía en el input.
        expect(sale.tipDonated.amountBs).toBe(200);
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-002 — Propina donada ⟹ vuelto entregado 0 (D3)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-002: propina y vuelto son mutuamente excluyentes', () => {

    it('fuerza changeUsd/changeBs a 0 aunque la UI mande vuelto', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: {
                changeUsdGiven: 5,   // la UI se equivocó y mandó vuelto
                changeBsGiven: 0,
                tipDonated: { amountUsd: 5, amountBs: 0, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.changeUsd).toBe(0);
        expect(sale.changeBs).toBe(0);
        expect(sale.tipDonated.amountUsd).toBe(5);
    });

    it('sin propina, el vuelto se entrega normal', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: { changeUsdGiven: 5, changeBsGiven: 0 },
        }));
        const sale = await persistedSale();
        expect(sale.changeUsd).toBe(5);
        expect(sale.tipDonated).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-003 — Techo y saneamiento (corrige T-2 en la capa de datos)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-003: la propina nunca supera el vuelto real', () => {

    it('recorta una propina inflada al vuelto real ($5)', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 500, amountBs: 0, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipDonated.amountUsd).toBe(5);
    });

    it('descarta una propina residual bajo el epsilon', async () => {
        await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 0.001, amountBs: 0, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipDonated).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-004 — VENTA_FIADA no admite propina (D4)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-004: incompatibilidad con venta fiada', () => {

    it('una VENTA_FIADA descarta la propina', async () => {
        await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 4, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Juan', balanceUsd: 0, saldoFavorUsd: 0 }],
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 3, amountBs: 0, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipo).toBe('VENTA_FIADA');
        expect(sale.tipDonated).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-005 — Bucket del motor: forma estándar (corrige T-9)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-005: bucket _propina_* en calculatePaymentBreakdown', () => {

    const ventaConPropinaUsd = {
        id: 's1',
        tipo: 'VENTA',
        totalUsd: 10,
        totalBs: 400,
        rate: 40,
        changeUsd: 0,
        changeBs: 0,
        tipDonated: { amountUsd: 5, amountBs: 0, currency: 'USD' },
        payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 15, amountBs: 600 }],
    };

    it('crea _propina_usd con la forma { total, currency, label, isTip }', () => {
        const { breakdown } = FinancialEngine.calculatePaymentBreakdown([ventaConPropinaUsd]);
        const tip = breakdown['_propina_usd'];
        expect(tip).toBeTruthy();
        expect(tip.total).toBe(5);
        expect(tip.currency).toBe('USD');
        expect(tip.isTip).toBe(true);
        expect(typeof tip.label).toBe('string');
        // No debe existir un bucket en Bs para la MISMA propina.
        expect(breakdown['_propina_bs']).toBeUndefined();
    });

    it('crea _propina_bs cuando la moneda es BS, y no crea el de USD', () => {
        const ventaBs = {
            ...ventaConPropinaUsd,
            id: 's2',
            tipDonated: { amountUsd: 5, amountBs: 200, currency: 'BS' },
        };
        const { breakdown } = FinancialEngine.calculatePaymentBreakdown([ventaBs]);
        expect(breakdown['_propina_bs'].total).toBe(200);
        expect(breakdown['_propina_bs'].currency).toBe('BS');
        expect(breakdown['_propina_usd']).toBeUndefined();
    });

    it('acumula varias propinas en el mismo bucket', () => {
        const { breakdown } = FinancialEngine.calculatePaymentBreakdown([
            ventaConPropinaUsd,
            { ...ventaConPropinaUsd, id: 's3', tipDonated: { amountUsd: 2.5, amountBs: 0, currency: 'USD' } },
        ]);
        expect(breakdown['_propina_usd'].total).toBe(7.5);
    });

    it('no crea bucket cuando no hay propina', () => {
        const { breakdown } = FinancialEngine.calculatePaymentBreakdown([
            { ...ventaConPropinaUsd, id: 's4', tipDonated: null },
        ]);
        expect(breakdown['_propina_usd']).toBeUndefined();
        expect(breakdown['_propina_bs']).toBeUndefined();
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-006 — La propina NO se resta ni se suma al efectivo (D1)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-006: la propina no altera el efectivo esperado', () => {

    it('el bucket efectivo_usd es idéntico con y sin propina donada', () => {
        const base = {
            id: 'a', tipo: 'VENTA', totalUsd: 10, totalBs: 400, rate: 40,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 15, amountBs: 600 }],
        };
        // Caso A: vuelto entregado $5 → efectivo neto = 15 - 5 = 10
        const conVuelto = FinancialEngine.calculatePaymentBreakdown([
            { ...base, changeUsd: 5, changeBs: 0, tipDonated: null },
        ]).breakdown;
        // Caso B: propina donada $5 → no hay vuelto, el efectivo se queda: 15
        const conPropina = FinancialEngine.calculatePaymentBreakdown([
            { ...base, changeUsd: 0, changeBs: 0, tipDonated: { amountUsd: 5, amountBs: 0, currency: 'USD' } },
        ]).breakdown;

        expect(conVuelto['efectivo_usd'].total).toBe(15);
        expect(conVuelto['_vuelto_usd'].total).toBe(5);
        expect(conPropina['efectivo_usd'].total).toBe(15);
        // Con propina NO hay bucket de vuelto: nada se resta del cajón.
        expect(conPropina['_vuelto_usd']).toBeUndefined();
        // Y la propina no añade un ingreso extra: solo informa.
        expect(conPropina['_propina_usd'].isTip).toBe(true);
    });
});
```

### VERIFICAR FASE 1

```bash
npx vitest run tests/tipDonated.test.js 2>&1 | tail -25
```

**Resultado esperado: los tests FALLAN.** Es correcto y obligatorio — la funcionalidad todavía no existe. Concretamente:

| Test | Estado esperado |
|---|---|
| TIP-001 (×2) | ❌ FALLA (`sale.tipDonated` es `undefined`) |
| TIP-002 "fuerza a 0" | ❌ FALLA |
| TIP-002 "sin propina" | ✅ pasa (`toBeNull` falla con `undefined`) → **puede fallar también; es aceptable** |
| TIP-003 (×2) | ❌ FALLA |
| TIP-004 | ❌ FALLA |
| TIP-005 (×4) | ❌ FALLA los 2 primeros y el 3º; el 4º ✅ pasa |
| TIP-006 | ❌ FALLA |

> ⛔ Si **todos** los tests pasan en la FASE 1, algo está mal: significa que la funcionalidad ya existía (contradice 0f) o el archivo no se creó. **DETENER Y REPORTAR.**

### ROLLBACK FASE 1
```bash
rm tests/tipDonated.test.js
```

---

## FASE 2 — Umbral de confirmación (`securityConstants.js`)

**Archivo:** `src/utils/securityConstants.js`
**Corrige:** T-2 (D6)

### VERIFICAR ANCLAJE
```bash
grep -cF "  CHANGE_ANOMALY_MIN_BS_FACTOR: 100," src/utils/securityConstants.js
```
→ debe imprimir `1`.

### BUSCAR (literal, 2 espacios de indentación)
```js
  CHANGE_ANOMALY_MIN_BS_FACTOR: 100,
});
```

### REEMPLAZAR POR
```js
  CHANGE_ANOMALY_MIN_BS_FACTOR: 100,
  /**
   * TIP-002: propina donada por encima de este monto (USD) exige doble
   * pulsación del botón. Un tap accidental sobre un vuelto anómalo no puede
   * donar cientos de dólares en silencio.
   */
  TIP_MAX_AUTO_USD: 20,
});
```

### VERIFICAR FASE 2
```bash
grep -cF "  TIP_MAX_AUTO_USD: 20," src/utils/securityConstants.js
grep -cF "  CHANGE_ANOMALY_MIN_BS_FACTOR: 100," src/utils/securityConstants.js
```
→ `1` y `1`.

```bash
npm run lint 2>&1 | tail -5
```
→ sin errores nuevos.

### ROLLBACK FASE 2
```bash
git checkout -- src/utils/securityConstants.js
```

---

## FASE 3 — Bucket `_propina_*` en el motor

**Archivo:** `src/core/FinancialEngine.js`
**Corrige:** T-1, T-9

### VERIFICAR ANCLAJE
```bash
grep -cF "            if (safeChangeBs > 0) {" src/core/FinancialEngine.js
grep -cF "                breakdown['_vuelto_bs'].total = round2(breakdown['_vuelto_bs'].total + safeChangeBs);" src/core/FinancialEngine.js
```
→ `1` y `1`.

### BUSCAR (literal, 12 espacios de indentación en la primera línea)
```js
            if (safeChangeBs > 0) {
                if (!breakdown['_vuelto_bs']) breakdown['_vuelto_bs'] = { total: 0, currency: 'BS', label: 'Vuelto En Bs Entregado', isChange: true };
                breakdown['_vuelto_bs'].total = round2(breakdown['_vuelto_bs'].total + safeChangeBs);
            }
```

### REEMPLAZAR POR
```js
            if (safeChangeBs > 0) {
                if (!breakdown['_vuelto_bs']) breakdown['_vuelto_bs'] = { total: 0, currency: 'BS', label: 'Vuelto En Bs Entregado', isChange: true };
                breakdown['_vuelto_bs'].total = round2(breakdown['_vuelto_bs'].total + safeChangeBs);
            }

            // ── TIP-001 / TIP-005: propina donada ("cliente deja el cambio") ──
            // El dinero YA está contado en el bucket de efectivo y no se restó
            // como vuelto, así que el ingreso neto ya lo incluye. Este bucket es
            // SOLO informativo: `isTip: true` obliga a los consumidores a
            // excluirlo de métodos de pago y porcentajes (ver D1).
            // Una propina tiene UNA sola moneda: se crea un único bucket.
            if (sale.tipDonated) {
                const tipIsBs = sale.tipDonated.currency === 'BS';
                const tipTotal = round2(tipIsBs
                    ? (Number(sale.tipDonated.amountBs) || 0)
                    : (Number(sale.tipDonated.amountUsd) || 0));
                if (tipTotal > FINANCIAL_EPSILON.PAYMENT_ZERO) {
                    const tipKey = tipIsBs ? '_propina_bs' : '_propina_usd';
                    if (!breakdown[tipKey]) {
                        breakdown[tipKey] = {
                            total: 0,
                            currency: tipIsBs ? 'BS' : 'USD',
                            label: tipIsBs ? 'Propina Dejada En Bs' : 'Propina Dejada En $',
                            isTip: true,
                        };
                    }
                    breakdown[tipKey].total = round2(breakdown[tipKey].total + tipTotal);
                }
            }
```

### VERIFICAR FASE 3
```bash
grep -cF "            if (sale.tipDonated) {" src/core/FinancialEngine.js
grep -cF "_propina_bs" src/core/FinancialEngine.js
grep -cF "_propina_usd" src/core/FinancialEngine.js
grep -cF "FINANCIAL_EPSILON" src/core/FinancialEngine.js
```
→ `1`, `2`, `2`, y **≥ 4** en la última (el import ya existía; si imprimiera `1`, faltaría el import → detener).

```bash
npx vitest run tests/tipDonated.test.js -t "TIP-005" 2>&1 | tail -15
```
→ los 4 tests de **TIP-005 pasan**. TIP-006 aún puede fallar (depende de nada más, debería pasar también).

```bash
npx vitest run tests/financialEngine.test.js 2>&1 | tail -8
```
→ **sin regresiones**: el mismo número de tests que en la línea base.

### ROLLBACK FASE 3
```bash
git checkout -- src/core/FinancialEngine.js
```

---

## FASE 4 — Normalizar y persistir en el procesador

**Archivo:** `src/utils/checkoutProcessor.js`
**Corrige:** T-1, T-2 (capa de datos), T-6; implementa D2, D3, D4, D5

Son **3 ediciones** en este archivo. Se hacen en el orden 4a → 4b → 4c.

### 4a) Bloque de normalización de la propina

#### VERIFICAR ANCLAJE
```bash
grep -cF "    const tipoVenta = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA');" src/utils/checkoutProcessor.js
```
→ `1`.

#### BUSCAR (literal, 4 espacios)
```js
    const tipoVenta = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA');
```

#### REEMPLAZAR POR
```js
    const tipoVenta = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA');

    // ── TIP-001 / TIP-003 / TIP-004: propina donada ("cliente deja el cambio") ──
    // `changeUsd` es el techo absoluto: no se puede donar más vuelto del que existe.
    // Se guarda UNA sola moneda canónica: `amountUsd` siempre, `amountBs` solo si
    // la moneda nativa es Bs (y recalculado aquí, sin confiar en el input de la UI).
    // Una VENTA_FIADA no genera sobrepago, así que no admite propina (D4).
    // Una VENTA_CASHEA sí: el vuelto de la cuota inicial es efectivo real (D5).
    const rawTip = changeBreakdown?.tipDonated || null;
    const tipUsd = round2(Math.min(
        Math.max(0, Number(rawTip?.amountUsd) || 0),
        changeUsd
    ));
    const tipIsBs = rawTip?.currency === 'BS';
    const tipDonated = (rawTip
        && tipUsd > FINANCIAL_EPSILON.PAYMENT_ZERO
        && tipoVenta !== 'VENTA_FIADA')
        ? {
            amountUsd: tipUsd,
            amountBs: tipIsBs ? round2(mulR(tipUsd, effectiveRate)) : 0,
            currency: tipIsBs ? 'BS' : 'USD',
        }
        : null;
```

### 4b) Forzar vuelto 0 cuando hay propina

#### VERIFICAR ANCLAJE
```bash
grep -cF "        changeUsd: tipoVenta === 'VENTA_FIADA' ? 0 : givenChangeUsd," src/utils/checkoutProcessor.js
```
→ `1`.

#### BUSCAR (literal, 8 espacios)
```js
        changeUsd: tipoVenta === 'VENTA_FIADA' ? 0 : givenChangeUsd,
        changeBs:  tipoVenta === 'VENTA_FIADA' ? 0 : givenChangeBs,
```

#### REEMPLAZAR POR
```js
        // TIP-002 (D3): propina donada ⟹ vuelto entregado 0, sin excepción.
        // Se fuerza aquí y no solo en la UI: si un modo de checkout manda ambos,
        // el dinero se contaría dos veces (una donado, una entregado).
        changeUsd: (tipoVenta === 'VENTA_FIADA' || tipDonated) ? 0 : givenChangeUsd,
        changeBs:  (tipoVenta === 'VENTA_FIADA' || tipDonated) ? 0 : givenChangeBs,
```

### 4c) Persistir el campo en la venta

#### VERIFICAR ANCLAJE
```bash
grep -cF "        casheaUsd: casheaUsd" src/utils/checkoutProcessor.js
```
→ `1`.

#### BUSCAR (literal, 8 espacios)
```js
        casheaUsd: casheaUsd
    };
```

#### REEMPLAZAR POR
```js
        casheaUsd: casheaUsd,
        // TIP-001: propina donada, ya normalizada a una sola moneda canónica.
        tipDonated: tipDonated
    };
```

### VERIFICAR FASE 4
```bash
grep -cF "    const rawTip = changeBreakdown?.tipDonated || null;" src/utils/checkoutProcessor.js
grep -cF "        tipDonated: tipDonated" src/utils/checkoutProcessor.js
grep -cF "        changeUsd: (tipoVenta === 'VENTA_FIADA' || tipDonated) ? 0 : givenChangeUsd," src/utils/checkoutProcessor.js
grep -cF "import { round2, sumR, subR, divR, mulR } from './dinero.js';" src/utils/checkoutProcessor.js
grep -cF "FINANCIAL_EPSILON" src/utils/checkoutProcessor.js
```
→ `1`, `1`, `1`, `1`, y **≥ 3** en la última.

> ⚠️ Si el 4º comando imprime `0`, el import de `mulR` no existe o tiene otra forma. **Comprobarlo con `grep -n "from './dinero" src/utils/checkoutProcessor.js` y añadir `mulR` a la lista existente.** El archivo importa desde `'./dinero.js'` **con extensión** — no crear un segundo import sin extensión.

```bash
npx vitest run tests/tipDonated.test.js 2>&1 | tail -12
```
→ **los 12 tests pasan.**

```bash
npx vitest run tests/checkout.test.js tests/financialEngine.test.js tests/cashea.test.js 2>&1 | tail -8
```
→ **sin regresiones.**

### ROLLBACK FASE 4
```bash
git checkout -- src/utils/checkoutProcessor.js
```

---

## FASE 5 — Consumidores del desglose: excluir `isTip` (FASE CRÍTICA)

**Archivos:** `src/components/Dashboard/DashboardPaymentBreakdown.jsx`, `src/components/Reports/ReportsMetricsTab.jsx`
**Corrige:** T-1 (lado consumidor), T-9; implementa D1

> 🔴 **Por qué esta fase es crítica.** Los buckets `_propina_usd` / `_propina_bs` llevan `currency: 'USD'` / `'BS'` y **no** llevan `isChange`. Sin esta fase, los filtros existentes los meten en `usdMethods` / `bsMethods` y **el Dashboard suma la propina como ingreso adicional sobre un efectivo que ya la contenía**. El resultado es un total inflado. Esta fase no es cosmética.

### 5a) `DashboardPaymentBreakdown.jsx` — filtros

#### VERIFICAR ANCLAJE
```bash
grep -cF "    const fiadoMethods = allEntries.filter(([method, d]) => (d.currency === 'FIADO' || method === 'cashea') && !d.isChange);" src/components/Dashboard/DashboardPaymentBreakdown.jsx
```
→ `1`.

#### BUSCAR (literal, 4 espacios)
```jsx
    const fiadoMethods = allEntries.filter(([method, d]) => (d.currency === 'FIADO' || method === 'cashea') && !d.isChange);
    const bsMethods    = allEntries.filter(([, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange);
    const usdMethods   = allEntries.filter(([method, d]) => d.currency === 'USD' && method !== 'cashea' && !d.isChange);
    const copMethods   = allEntries.filter(([, d]) => d.currency === 'COP' && !d.isChange);
    const vueltoBs     = allEntries.filter(([, d]) => d.isChange && d.currency === 'BS');
    const vueltoUsd    = allEntries.filter(([, d]) => d.isChange && d.currency === 'USD');
```

#### REEMPLAZAR POR
```jsx
    // TIP-005 (D1): `isTip` se excluye de TODOS los métodos de pago. La propina
    // ya está dentro del efectivo (no se restó como vuelto); sumarla otra vez
    // como método inflaría el ingreso. Se muestra aparte, solo informativa.
    const fiadoMethods = allEntries.filter(([method, d]) => (d.currency === 'FIADO' || method === 'cashea') && !d.isChange && !d.isTip);
    const bsMethods    = allEntries.filter(([, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange && !d.isTip);
    const usdMethods   = allEntries.filter(([method, d]) => d.currency === 'USD' && method !== 'cashea' && !d.isChange && !d.isTip);
    const copMethods   = allEntries.filter(([, d]) => d.currency === 'COP' && !d.isChange && !d.isTip);
    const vueltoBs     = allEntries.filter(([, d]) => d.isChange && d.currency === 'BS');
    const vueltoUsd    = allEntries.filter(([, d]) => d.isChange && d.currency === 'USD');
    const propinas     = allEntries.filter(([, d]) => d.isTip);
    const totalPropinaUsd = propinas.filter(([, d]) => d.currency === 'USD').reduce((s, [, d]) => s + d.total, 0);
    const totalPropinaBs  = propinas.filter(([, d]) => d.currency === 'BS').reduce((s, [, d]) => s + d.total, 0);
```

### 5b) `DashboardPaymentBreakdown.jsx` — porcentajes

#### VERIFICAR ANCLAJE
```bash
grep -cF "    const grandTotalBsEquiv = allEntries" src/components/Dashboard/DashboardPaymentBreakdown.jsx
```
→ `1`.

#### BUSCAR (literal, 4 espacios)
```jsx
    const grandTotalBsEquiv = allEntries
        .filter(([, d]) => !d.isChange)
        .reduce((s, [, d]) => s + toBsEquiv(d), 0);
```

#### REEMPLAZAR POR
```jsx
    const grandTotalBsEquiv = allEntries
        .filter(([, d]) => !d.isChange && !d.isTip)
        .reduce((s, [, d]) => s + toBsEquiv(d), 0);
```

### 5c) `DashboardPaymentBreakdown.jsx` — fila informativa

#### VERIFICAR ANCLAJE
```bash
grep -cF "                        <div className=\"pl-3 space-y-3\">{copMethods.map(e => renderMethod(e))}</div>" src/components/Dashboard/DashboardPaymentBreakdown.jsx
```
→ `1`.

#### BUSCAR (literal — son las 5 últimas líneas útiles del componente)
```jsx
                        <div className="pl-3 space-y-3">{copMethods.map(e => renderMethod(e))}</div>
                    </div>
                </div>
            )}
        </div>
    );
}
```

#### REEMPLAZAR POR
```jsx
                        <div className="pl-3 space-y-3">{copMethods.map(e => renderMethod(e))}</div>
                    </div>
                </div>
            )}

            {/* TIP-005: propinas dejadas en caja. Informativo: NO es un ingreso
                adicional, el efectivo ya está contado arriba (no se restó vuelto). */}
            {propinas.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-emerald-300 dark:border-emerald-800/50">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                            Cambios dejados en caja (propinas)
                        </span>
                        <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                            {[
                                totalPropinaUsd > 0 ? `USD ${totalPropinaUsd.toFixed(2)}` : null,
                                totalPropinaBs > 0 ? `${formatBs(totalPropinaBs)} Bs` : null,
                            ].filter(Boolean).join(' + ')}
                        </span>
                    </div>
                    <p className="text-[9px] text-slate-450 dark:text-slate-500 mt-0.5">
                        Ya incluido en el efectivo — no se suma aparte.
                    </p>
                </div>
            )}
        </div>
    );
}
```

### 5d) `ReportsMetricsTab.jsx` — filtros

#### VERIFICAR ANCLAJE
```bash
grep -cF "                        const copMethods   = allEntries.filter(([, d]) => d.currency === 'COP' && !d.isChange);" src/components/Reports/ReportsMetricsTab.jsx
```
→ `1`.

#### BUSCAR (literal, **24 espacios** de indentación)
```jsx
                        const fiadoMethods = allEntries.filter(([method, d]) => (d.currency === 'FIADO' || method === 'cashea') && !d.isChange);
                        const bsMethods    = allEntries.filter(([, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange);
                        const usdMethods   = allEntries.filter(([method, d]) => d.currency === 'USD' && method !== 'cashea' && !d.isChange);
                        const copMethods   = allEntries.filter(([, d]) => d.currency === 'COP' && !d.isChange);
```

#### REEMPLAZAR POR
```jsx
                        // TIP-005 (D1): la propina no es un método de pago. Ver
                        // DashboardPaymentBreakdown.jsx para el razonamiento completo.
                        const fiadoMethods = allEntries.filter(([method, d]) => (d.currency === 'FIADO' || method === 'cashea') && !d.isChange && !d.isTip);
                        const bsMethods    = allEntries.filter(([, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange && !d.isTip);
                        const usdMethods   = allEntries.filter(([method, d]) => d.currency === 'USD' && method !== 'cashea' && !d.isChange && !d.isTip);
                        const copMethods   = allEntries.filter(([, d]) => d.currency === 'COP' && !d.isChange && !d.isTip);
```

### 5e) `ReportsMetricsTab.jsx` — porcentajes

#### VERIFICAR ANCLAJE
```bash
grep -cF "                            .filter(([, d]) => !d.isChange)" src/components/Reports/ReportsMetricsTab.jsx
```
→ `1`.

#### BUSCAR (literal, **28 espacios**)
```jsx
                            .filter(([, d]) => !d.isChange)
```

#### REEMPLAZAR POR
```jsx
                            .filter(([, d]) => !d.isChange && !d.isTip)
```

### VERIFICAR FASE 5
```bash
grep -cF "&& !d.isTip" src/components/Dashboard/DashboardPaymentBreakdown.jsx
grep -cF "&& !d.isTip" src/components/Reports/ReportsMetricsTab.jsx
grep -cF "    const propinas     = allEntries.filter(([, d]) => d.isTip);" src/components/Dashboard/DashboardPaymentBreakdown.jsx
grep -cF "Cambios dejados en caja (propinas)" src/components/Dashboard/DashboardPaymentBreakdown.jsx
grep -cF "import { formatBs, formatCop } from '../../utils/calculatorUtils';" src/components/Dashboard/DashboardPaymentBreakdown.jsx
```
→ `5`, `5`, `1`, `1`, `1`.

> ⚠️ El último comando confirma que `formatBs` ya está importado en `DashboardPaymentBreakdown.jsx`. Si imprimiera `0`, **detener** — el bloque 5c lo usa.

```bash
npm run build 2>&1 | tail -6
npm run lint 2>&1 | tail -6
```
→ build limpio, sin errores de lint nuevos.

### ROLLBACK FASE 5
```bash
git checkout -- src/components/Dashboard/DashboardPaymentBreakdown.jsx src/components/Reports/ReportsMetricsTab.jsx
```

---

## ✅ CHECKPOINT — Commit intermedio (capa de datos completa)

En este punto la capa de datos y de reportes está completa y testeada. **La UI todavía no puede generar propinas** (nadie manda `tipDonated`), así que el sistema está en un estado consistente y seguro.

```bash
npm test 2>&1 | tail -8
```
→ **153 tests pasando** (141 de base + 12 nuevos), `≤ 1 error`.

```bash
git add -A
git commit -m "feat(propina): capa de datos del vuelto donado a caja

Porta la funcionalidad 'Cliente deja el cambio' desde donde-juancho,
corrigiendo los defectos T-1, T-2, T-4, T-6 y T-9 de la auditoria.

- FinancialEngine: bucket _propina_usd/_propina_bs con forma estandar
  { total, currency, label, isTip }. Una propina = UNA moneda (T-1, T-9).
- checkoutProcessor: normaliza tipDonated, techo en el vuelto real,
  fuerza vuelto entregado a 0 y descarta la propina en VENTA_FIADA.
- Dashboard y Reportes: isTip excluido de metodos de pago y porcentajes.
  Sin esto la propina se contaria como ingreso extra sobre un efectivo
  que ya la contenia.
- securityConstants: TIP_MAX_AUTO_USD para el umbral de doble pulsacion.
- tests/tipDonated.test.js: 12 tests sobre las capas puras.

Ref: AUDITORIA-VUELTO-DONADO.md, PLAN-VUELTO-DONADO.md fases 0-5"
```

> Si el commit falla por un hook de pre-commit, **reportar el error, no usar `--no-verify`.**

---

## FASE 6 — UI modo POS: estado, moneda y payload

**Archivo:** `src/components/Sales/CheckoutModalPOS/index.jsx`
**Corrige:** T-2, T-4, T-5; implementa D6, D7, D8

Son **5 ediciones**, en orden 6a → 6b → 6c → 6d → 6e.

### 6a) Estado

#### VERIFICAR ANCLAJE
```bash
grep -cF "    const [isChangeCredited, setIsChangeCredited] = useState(false);" src/components/Sales/CheckoutModalPOS/index.jsx
```
→ `1`.

#### BUSCAR (literal, 4 espacios)
```jsx
    const [isChangeCredited, setIsChangeCredited] = useState(false);
```

#### REEMPLAZAR POR
```jsx
    const [isChangeCredited, setIsChangeCredited] = useState(false);
    // TIP: propina donada ("cliente deja el cambio").
    const [isTipDonated, setIsTipDonated] = useState(false);
    // TIP-002 (D6): propinas grandes exigen una segunda pulsación.
    const [tipConfirmPending, setTipConfirmPending] = useState(false);
```

### 6b) Moneda de la propina + toggle

> Se inserta **después** del bloque `handleCreditChange`, porque necesita `tasaSegura` y `val`, ambos ya definidos en ese punto.

#### VERIFICAR ANCLAJE
```bash
grep -cF "        setIsChangeCredited(true);" src/components/Sales/CheckoutModalPOS/index.jsx
```
→ `1`.

#### BUSCAR (literal, 4 espacios en `const handleCreditChange`)
```jsx
    const handleCreditChange = () => {
        if (!clienteSeleccionado) {
            showToast('Selecciona un cliente para abonar el vuelto a cuenta', 'warning');
            return;
        }
        setIsChangeCredited(true);
    };
```

#### REEMPLAZAR POR
```jsx
    const handleCreditChange = () => {
        if (!clienteSeleccionado) {
            showToast('Selecciona un cliente para abonar el vuelto a cuenta', 'warning');
            return;
        }
        setIsChangeCredited(true);
    };

    // ── TIP-004 (D7): la moneda de la propina se deriva de la composición REAL
    // del efectivo en la gaveta, comparando magnitudes en una misma unidad (Bs).
    // No del orden de los métodos: $1 junto a Bs 5.000 no hace la propina "USD".
    // Solo cuenta EFECTIVO: un pago móvil no puede producir vuelto físico.
    // D8: no hay camino COP para la propina; el fallback es USD.
    const tipCurrency = useMemo(() => {
        const efectivoBs = metodosNormalizados
            .filter(m => m.tipo === 'BS' && String(m.id).startsWith('efectivo'))
            .reduce((s, m) => sumR(s, val(m.id)), 0);
        const efectivoUsdEnBs = mulR(
            metodosNormalizados
                .filter(m => m.tipo === 'DIVISA' && String(m.id).startsWith('efectivo'))
                .reduce((s, m) => sumR(s, val(m.id)), 0),
            tasaSegura
        );
        return efectivoBs > efectivoUsdEnBs ? 'BS' : 'USD';
    }, [metodosNormalizados, val, tasaSegura]);

    // ── TIP-002 (D6): propinas por encima del umbral exigen doble pulsación.
    const toggleTipDonated = () => {
        if (isTipDonated) {
            setIsTipDonated(false);
            setTipConfirmPending(false);
            return;
        }
        if (cambioUSD > FINANCIAL_EPSILON.TIP_MAX_AUTO_USD && !tipConfirmPending) {
            setTipConfirmPending(true);
            showToast(
                `Propina de $${cambioUSD.toFixed(2)}. Pulsa de nuevo para confirmar.`,
                'warning'
            );
            return;
        }
        // Donar el vuelto y repartirlo a la vez es contradictorio: se limpia.
        setDistVueltoUSD('');
        setDistVueltoBS('');
        setIsChangeCredited(false);
        setTipConfirmPending(false);
        setIsTipDonated(true);
        triggerHaptic && triggerHaptic();
    };
```

### 6c) Reset del toggle (T-5)

#### VERIFICAR ANCLAJE
```bash
grep -cF "        if (cambioUSD <= 0) {" src/components/Sales/CheckoutModalPOS/index.jsx
```
→ `1`.

#### BUSCAR (literal, 4 espacios)
```jsx
    // Limpiar vuelto cuando baja
    useEffect(() => {
        if (cambioUSD <= 0) {
            setDistVueltoUSD('');
            setDistVueltoBS('');
        }
    }, [cambioUSD]);
```

#### REEMPLAZAR POR
```jsx
    // Limpiar vuelto cuando baja
    useEffect(() => {
        if (cambioUSD <= 0) {
            setDistVueltoUSD('');
            setDistVueltoBS('');
        }
    }, [cambioUSD]);

    // TIP-005 (T-5): apagar la propina si el vuelto desaparece. Sin esto el flag
    // sobrevive a una corrección del pago y la propina se re-arma sola cuando el
    // vuelto vuelve a subir, sin que el operador la reconfirme.
    useEffect(() => {
        if (cambioUSD <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setIsTipDonated(false);
            setTipConfirmPending(false);
        }
    }, [cambioUSD]);

    // Si el monto del vuelto cambia, caduca cualquier confirmación pendiente:
    // el operador debe volver a ver la cifra antes de donarla.
    useEffect(() => {
        setTipConfirmPending(false);
    }, [cambioUSD]);
```

### 6d) Payload de `onConfirmSale`

#### VERIFICAR ANCLAJE
```bash
grep -cF "            const hasExplicitSplit = distVueltoUSD !== '' || distVueltoBS !== '';" src/components/Sales/CheckoutModalPOS/index.jsx
```
→ `1`.

#### BUSCAR (literal, 12 espacios)
```jsx
            const hasExplicitSplit = distVueltoUSD !== '' || distVueltoBS !== '';
            onConfirmSale(payments, {
                // FIN-034: si el operador tocó cualquiera de los dos campos de desglose,
                // se respetan tal cual (el vacío vale 0). El botón "Todo" del campo Bs deja
                // distVueltoUSD en '' — leerlo como "no especificado" duplicaba el vuelto.
                changeUsdGiven: hasExplicitSplit ? (parseFloat(distVueltoUSD) || 0) : cambioUSD,
                changeBsGiven: hasExplicitSplit ? (parseFloat(distVueltoBS) || 0) : 0,
                esCredito: modo === 'credito',
                clienteId: clienteSeleccionado || null,
                esCashea: casheaActive,
                vueltoCredito: isChangeCredited,
            }, imprimir);
```

#### REEMPLAZAR POR
```jsx
            const hasExplicitSplit = distVueltoUSD !== '' || distVueltoBS !== '';
            // TIP-002 (D3): propina donada ⟹ no se entrega vuelto. El procesador
            // lo vuelve a forzar, pero se manda coherente desde aquí.
            const tipEfectiva = isTipDonated && cambioUSD > FINANCIAL_EPSILON.PAYMENT_ZERO;
            onConfirmSale(payments, {
                // FIN-034: si el operador tocó cualquiera de los dos campos de desglose,
                // se respetan tal cual (el vacío vale 0). El botón "Todo" del campo Bs deja
                // distVueltoUSD en '' — leerlo como "no especificado" duplicaba el vuelto.
                changeUsdGiven: tipEfectiva ? 0 : (hasExplicitSplit ? (parseFloat(distVueltoUSD) || 0) : cambioUSD),
                changeBsGiven: tipEfectiva ? 0 : (hasExplicitSplit ? (parseFloat(distVueltoBS) || 0) : 0),
                esCredito: modo === 'credito',
                clienteId: clienteSeleccionado || null,
                esCashea: casheaActive,
                vueltoCredito: isChangeCredited,
                // TIP-001: una sola moneda canónica. amountUsd es el monto real;
                // amountBs lo recalcula el procesador si la moneda nativa es Bs.
                tipDonated: tipEfectiva
                    ? { amountUsd: round2(cambioUSD), amountBs: 0, currency: tipCurrency }
                    : null,
            }, imprimir);
```

### 6e) Validación del vuelto + props al hijo

#### VERIFICAR ANCLAJE
```bash
grep -cF "    const isVueltoValido = cambioUSD < 0.001 || (" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "                        setIsChangeCredited={setIsChangeCredited}" src/components/Sales/CheckoutModalPOS/index.jsx
```
→ `1` y `1`.

#### BUSCAR nº1 (literal, 4 espacios)
```jsx
    const isVueltoValido = cambioUSD < 0.001 || (
```

#### REEMPLAZAR POR nº1
```jsx
    // TIP: si el cliente dona el vuelto, no hay nada que repartir → siempre válido.
    const isVueltoValido = cambioUSD < 0.001 || isTipDonated || (
```

#### BUSCAR nº2 (literal, 24 espacios)
```jsx
                        setIsChangeCredited={setIsChangeCredited}
```

#### REEMPLAZAR POR nº2
```jsx
                        setIsChangeCredited={setIsChangeCredited}
                        isTipDonated={isTipDonated}
                        toggleTipDonated={toggleTipDonated}
                        tipConfirmPending={tipConfirmPending}
                        tipCurrency={tipCurrency}
```

### 6f) Import de `FINANCIAL_EPSILON`

`CheckoutModalPOS/index.jsx` **no** importa `FINANCIAL_EPSILON` (verificado: 0 coincidencias). Los pasos 6b, 6c y 6d lo usan, así que hay que añadirlo.

#### VERIFICAR ANCLAJE
```bash
grep -cF "import { FinancialEngine } from '../../../core/FinancialEngine';" src/components/Sales/CheckoutModalPOS/index.jsx
```
→ `1`.

#### BUSCAR (literal)
```jsx
import { FinancialEngine } from '../../../core/FinancialEngine';
```

#### REEMPLAZAR POR
```jsx
import { FinancialEngine } from '../../../core/FinancialEngine';
import { FINANCIAL_EPSILON } from '../../../utils/securityConstants';
```

> ⚠️ **No** añadir el import si ya existe. Un import duplicado rompe el build.

### VERIFICAR FASE 6
```bash
grep -cF "    const [isTipDonated, setIsTipDonated] = useState(false);" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "    const toggleTipDonated = () => {" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "    const tipCurrency = useMemo(() => {" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "                        tipCurrency={tipCurrency}" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "                tipDonated: tipEfectiva" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "import { FINANCIAL_EPSILON } from '../../../utils/securityConstants';" src/components/Sales/CheckoutModalPOS/index.jsx
grep -cF "import { round2, subR, mulR, divR, sumR } from '../../../utils/dinero';" src/components/Sales/CheckoutModalPOS/index.jsx
```
→ `1` en los siete.

```bash
npm run build 2>&1 | tail -6
npm run lint 2>&1 | tail -8
```
→ build limpio. **`toggleTipDonated` aparecerá como definido-y-no-usado hasta la FASE 7; eso es esperado.** Cualquier otro error nuevo → rollback.

### ROLLBACK FASE 6
```bash
git checkout -- src/components/Sales/CheckoutModalPOS/index.jsx
```

---

## FASE 7 — UI modo POS: el botón

**Archivo:** `src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx`

Son **4 ediciones**, en orden 7a → 7b → 7c → 7d.

### 7a) Iconos

#### VERIFICAR ANCLAJE
```bash
grep -cF "import { Banknote, CreditCard } from 'lucide-react';" src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
```
→ `1`.

#### BUSCAR
```jsx
import { Banknote, CreditCard } from 'lucide-react';
```

#### REEMPLAZAR POR
```jsx
import { Banknote, CreditCard, HandCoins, CheckCircle } from 'lucide-react';
```

### 7b) Props

#### VERIFICAR ANCLAJE
```bash
grep -cF "    setIsChangeCredited," src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
```
→ `1`.

#### BUSCAR (literal, 4 espacios)
```jsx
    setIsChangeCredited,
    deudaCliente,
```

#### REEMPLAZAR POR
```jsx
    setIsChangeCredited,
    isTipDonated,
    toggleTipDonated,
    tipConfirmPending,
    tipCurrency,
    deudaCliente,
```

### 7c) Tarjeta de vuelto: botón + ocultar el reparto

#### VERIFICAR ANCLAJE
```bash
grep -cF "                            <p className=\"text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-400\">Vuelto</p>" src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
```
→ `1`.

#### BUSCAR (literal, 24 espacios en la línea del `<div>`)
```jsx
                        <div className="flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm transition-all">
                            <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Vuelto</p>
                            <p className="text-4xl lg:text-5xl font-black text-emerald-700 dark:text-emerald-400 my-2">${cambioUSD.toFixed(2)}</p>
                            <div className="text-lg font-black text-emerald-600 dark:text-emerald-300">
                                Bs {round2(cambioUSD * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                            </div>
                            {/* Distribución de vuelto */}
                            <div className="w-full mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-800/30 flex gap-2">
```

#### REEMPLAZAR POR
```jsx
                        <div className={`flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm transition-all ${isTipDonated ? 'border-emerald-500 ring-2 ring-emerald-400/50' : 'border-emerald-200 dark:border-emerald-800/40'}`}>
                            <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{isTipDonated ? 'Vuelto Dejado En Caja (Propina)' : 'Vuelto'}</p>
                            <p className="text-4xl lg:text-5xl font-black text-emerald-700 dark:text-emerald-400 my-2">${cambioUSD.toFixed(2)}</p>
                            <div className="text-lg font-black text-emerald-600 dark:text-emerald-300">
                                Bs {round2(cambioUSD * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                            </div>

                            {/* TIP: el cliente deja el cambio. Donarlo y repartirlo a la vez
                                es contradictorio, así que el reparto se oculta al activarlo. */}
                            <button
                                type="button"
                                onClick={toggleTipDonated}
                                className={`w-full mt-3 py-2.5 px-3 rounded-lg font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.97] ${
                                    isTipDonated
                                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30'
                                        : tipConfirmPending
                                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-2 border-amber-400 animate-pulse'
                                            : 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-slate-700'
                                }`}
                            >
                                <HandCoins size={16} className="shrink-0" />
                                <span className="truncate">
                                    {isTipDonated
                                        ? `Deja el cambio (${tipCurrency === 'BS' ? `Bs ${Math.round(cambioUSD * tasaSegura).toLocaleString('es-VE')}` : `$${cambioUSD.toFixed(2)}`})`
                                        : tipConfirmPending
                                            ? `Confirmar: donar $${cambioUSD.toFixed(2)}`
                                            : 'Cliente deja el cambio (Donar a Caja)'}
                                </span>
                                {isTipDonated && <CheckCircle size={14} className="text-white shrink-0" />}
                            </button>

                            {!isTipDonated && (
                            {/* Distribución de vuelto */}
                            <div className="w-full mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-800/30 flex gap-2">
```

> ⚠️ **El bloque anterior deja el JSX temporalmente inválido** (`{!isTipDonated && (` sin cerrar, y un comentario JSX inmediatamente después de `(` es sintaxis inválida). Lo cierra y lo corrige la edición **7d**, que es obligatoria. **No ejecutar `npm run build` entre 7c y 7d.**

### 7d) Cerrar el condicional

#### VERIFICAR ANCLAJE
```bash
grep -cF "                                            onClick={() => handleVueltoDistChange('bs', Math.round(cambioUSD * tasaSegura).toString())}" src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
```
→ `1`.

#### BUSCAR (literal)
```jsx
                            {!isTipDonated && (
                            {/* Distribución de vuelto */}
                            <div className="w-full mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-800/30 flex gap-2">
```

#### REEMPLAZAR POR
```jsx
                            {/* Distribución de vuelto — oculta si el cliente dona el cambio */}
                            {!isTipDonated && (
                            <div className="w-full mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-800/30 flex gap-2">
```

#### Y ADEMÁS, segunda edición en el mismo archivo:

#### BUSCAR (literal — el cierre de la tarjeta de vuelto)
```jsx
                                        <button
                                            type="button"
                                            onClick={() => handleVueltoDistChange('bs', Math.round(cambioUSD * tasaSegura).toString())}
                                            className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-1 rounded hover:bg-emerald-200 active:scale-95 transition-all"
                                        >
                                            Todo
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
```

#### REEMPLAZAR POR
```jsx
                                        <button
                                            type="button"
                                            onClick={() => handleVueltoDistChange('bs', Math.round(cambioUSD * tasaSegura).toString())}
                                            className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-1 rounded hover:bg-emerald-200 active:scale-95 transition-all"
                                        >
                                            Todo
                                        </button>
                                    </div>
                                </div>
                            </div>
                            )}
                        </div>
                    )}
```

### VERIFICAR FASE 7
```bash
grep -cF "HandCoins" src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
grep -cF "    toggleTipDonated," src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
grep -cF "                            {!isTipDonated && (" src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
grep -cF "                            )}" src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
grep -cF "'Cliente deja el cambio (Donar a Caja)'" src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
```
→ `2`, `1`, `1`, `1`, `1`.

```bash
npm run build 2>&1 | tail -8
```
→ **build limpio.** Si aparece un error de JSX (`Unexpected token`, `Adjacent JSX elements`), es que 7c quedó a medias: aplicar el rollback y repetir 7c + 7d juntas.

```bash
npm run lint 2>&1 | tail -8
```
→ sin errores nuevos. `toggleTipDonated` ya está usado, así que la advertencia de la FASE 6 debe haber desaparecido.

### ROLLBACK FASE 7
```bash
git checkout -- src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
```

---

## FASE 8 — Modo básico: el hook

**Archivo:** `src/hooks/useCheckoutCalculations.js`
**Corrige:** T-4, T-5, T-6 en el modo básico (paridad con el POS)

Son **4 ediciones**, en orden 8a → 8b → 8c → 8d.

### 8a) Import de `useEffect`

#### VERIFICAR ANCLAJE
```bash
grep -cF "import { useState, useCallback, useMemo, useRef } from 'react';" src/hooks/useCheckoutCalculations.js
```
→ `1`.

#### BUSCAR
```js
import { useState, useCallback, useMemo, useRef } from 'react';
```

#### REEMPLAZAR POR
```js
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
```

### 8b) Estado

#### VERIFICAR ANCLAJE
```bash
grep -cF "    const [changeBsGiven, setChangeBsGiven] = useState('');" src/hooks/useCheckoutCalculations.js
```
→ `1`.

#### BUSCAR (literal, 4 espacios)
```js
    const [changeBsGiven, setChangeBsGiven] = useState('');
```

#### REEMPLAZAR POR
```js
    const [changeBsGiven, setChangeBsGiven] = useState('');
    // TIP: propina donada ("cliente deja el cambio"). Paridad con CheckoutModalPOS.
    const [isTipDonated, setIsTipDonated] = useState(false);
    const [tipConfirmPending, setTipConfirmPending] = useState(false);
```

### 8c) Moneda, toggle y reset

> Se inserta justo antes de `_processPayments`, donde `changeUsd`, `barValues` y `safeRate` ya existen.

#### VERIFICAR ANCLAJE
```bash
grep -cF "    // ── Procesamiento final de la venta (sin validaciones) ────────────────────" src/hooks/useCheckoutCalculations.js
```
→ `1`.

#### BUSCAR (literal, 4 espacios)
```js
    // ── Procesamiento final de la venta (sin validaciones) ────────────────────
```

#### REEMPLAZAR POR
```js
    // ── TIP-004 (D7): moneda de la propina según la composición real del efectivo.
    // Mismo criterio que CheckoutModalPOS: se comparan magnitudes en Bs, no el
    // orden de los métodos. Solo efectivo: un pago móvil no da vuelto físico.
    const tipCurrency = useMemo(() => {
        const efectivoBs = paymentMethods
            .filter(m => m.currency === 'BS' && String(m.id).startsWith('efectivo'))
            .reduce((s, m) => sumR(s, CurrencyService.safeParse(barValues[m.id])), 0);
        const efectivoUsdEnBs = mulR(
            paymentMethods
                .filter(m => m.currency === 'USD' && String(m.id).startsWith('efectivo'))
                .reduce((s, m) => sumR(s, CurrencyService.safeParse(barValues[m.id])), 0),
            safeRate
        );
        return efectivoBs > efectivoUsdEnBs ? 'BS' : 'USD';
    }, [paymentMethods, barValues, safeRate]);

    // ── TIP-002 (D6): propinas por encima del umbral exigen doble pulsación.
    const toggleTipDonated = useCallback(() => {
        if (isTipDonated) {
            setIsTipDonated(false);
            setTipConfirmPending(false);
            return;
        }
        if (changeUsd > FINANCIAL_EPSILON.TIP_MAX_AUTO_USD && !tipConfirmPending) {
            setTipConfirmPending(true);
            return;
        }
        setChangeUsdGiven('');
        setChangeBsGiven('');
        setTipConfirmPending(false);
        setIsTipDonated(true);
        triggerHaptic && triggerHaptic();
    }, [isTipDonated, tipConfirmPending, changeUsd, triggerHaptic]);

    // TIP (T-5): apagar la propina si el vuelto desaparece, y caducar cualquier
    // confirmación pendiente cuando el monto cambia. Sin esto el flag sobrevive
    // a una corrección del pago y la propina se re-arma sola.
    useEffect(() => {
        setTipConfirmPending(false);
        if (changeUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setIsTipDonated(false);
        }
    }, [changeUsd]);

    // ── Procesamiento final de la venta (sin validaciones) ────────────────────
```

### 8d) Payload

#### VERIFICAR ANCLAJE
```bash
grep -cF "        const hasExplicitSplit = Boolean(changeUsdGiven) || Boolean(changeBsGiven);" src/hooks/useCheckoutCalculations.js
```
→ `1`.

#### BUSCAR (literal, 8 espacios)
```js
        const hasExplicitSplit = Boolean(changeUsdGiven) || Boolean(changeBsGiven);
        const splitUsd = hasExplicitSplit ? round2(CurrencyService.safeParse(changeUsdGiven)) : changeUsd;
        const splitBs  = hasExplicitSplit ? round2(CurrencyService.safeParse(changeBsGiven))  : 0;
        onConfirmSale(payments, {
            changeUsdGiven: Math.min(splitUsd, changeUsd),
            changeBsGiven: Math.min(splitBs, changeBs),
        });
    }, [barValues, paymentMethods, onConfirmSale, changeUsdGiven, changeBsGiven, changeUsd, changeBs, safeRate, safeTasaCop, casheaActive, casheaAmountUsd, casheaPercent]);
```

#### REEMPLAZAR POR
```js
        const hasExplicitSplit = Boolean(changeUsdGiven) || Boolean(changeBsGiven);
        const splitUsd = hasExplicitSplit ? round2(CurrencyService.safeParse(changeUsdGiven)) : changeUsd;
        const splitBs  = hasExplicitSplit ? round2(CurrencyService.safeParse(changeBsGiven))  : 0;
        // TIP-002 (D3): propina donada ⟹ no se entrega vuelto. El umbral usa
        // FINANCIAL_EPSILON.PAYMENT_ZERO, no `> 0`: un residuo de redondeo no es
        // una propina (T-6).
        const tipEfectiva = isTipDonated && changeUsd > FINANCIAL_EPSILON.PAYMENT_ZERO;
        onConfirmSale(payments, {
            changeUsdGiven: tipEfectiva ? 0 : Math.min(splitUsd, changeUsd),
            changeBsGiven: tipEfectiva ? 0 : Math.min(splitBs, changeBs),
            // TIP-001: una sola moneda canónica; amountBs lo recalcula el procesador.
            tipDonated: tipEfectiva
                ? { amountUsd: round2(changeUsd), amountBs: 0, currency: tipCurrency }
                : null,
        });
    }, [barValues, paymentMethods, onConfirmSale, changeUsdGiven, changeBsGiven, changeUsd, changeBs, safeRate, safeTasaCop, casheaActive, casheaAmountUsd, casheaPercent, isTipDonated, tipCurrency]);
```

### 8e) Exportar

#### VERIFICAR ANCLAJE
```bash
grep -cF "        dismissWarning," src/hooks/useCheckoutCalculations.js
```
→ `1`.

#### BUSCAR (literal, 8 espacios)
```js
        dismissWarning,
        safeRate,
```

#### REEMPLAZAR POR
```js
        dismissWarning,
        // TIP: propina donada (modo básico).
        isTipDonated,
        toggleTipDonated,
        tipConfirmPending,
        tipCurrency,
        safeRate,
```

### VERIFICAR FASE 8
```bash
grep -cF "    const [isTipDonated, setIsTipDonated] = useState(false);" src/hooks/useCheckoutCalculations.js
grep -cF "    const toggleTipDonated = useCallback(() => {" src/hooks/useCheckoutCalculations.js
grep -cF "    const tipCurrency = useMemo(() => {" src/hooks/useCheckoutCalculations.js
grep -cF "        toggleTipDonated," src/hooks/useCheckoutCalculations.js
grep -cF "            tipDonated: tipEfectiva" src/hooks/useCheckoutCalculations.js
grep -cF "import { useState, useCallback, useMemo, useRef, useEffect } from 'react';" src/hooks/useCheckoutCalculations.js
```
→ `1` en los seis.

```bash
npm run build 2>&1 | tail -6
npm run lint 2>&1 | tail -8
npm test 2>&1 | tail -8
```
→ build limpio, sin errores de lint nuevos, **153 tests pasando**, `≤ 1 error`.

### ROLLBACK FASE 8
```bash
git checkout -- src/hooks/useCheckoutCalculations.js
```

---

## FASE 9 — Modo básico: el botón

**Archivo:** `src/components/Sales/CheckoutModal.jsx`

Son **4 ediciones**, en orden 9a → 9b → 9c → 9d.

### 9a) Icono

#### VERIFICAR ANCLAJE
```bash
grep -cF "import { X, Users, Receipt, ArrowLeftRight, AlertTriangle, Smartphone, Lock, LayoutGrid } from 'lucide-react';" src/components/Sales/CheckoutModal.jsx
```
→ `1`.

#### BUSCAR
```jsx
import { X, Users, Receipt, ArrowLeftRight, AlertTriangle, Smartphone, Lock, LayoutGrid } from 'lucide-react';
```

#### REEMPLAZAR POR
```jsx
import { X, Users, Receipt, ArrowLeftRight, AlertTriangle, Smartphone, Lock, LayoutGrid, HandCoins, CheckCircle } from 'lucide-react';
```

### 9b) Consumir el hook

#### VERIFICAR ANCLAJE
```bash
grep -cF "        dismissWarning," src/components/Sales/CheckoutModal.jsx
```
→ `1`.

#### BUSCAR (literal, 8 espacios)
```jsx
        dismissWarning,
        // Cashea outputs
```

#### REEMPLAZAR POR
```jsx
        dismissWarning,
        // TIP: propina donada.
        isTipDonated,
        toggleTipDonated,
        tipConfirmPending,
        tipCurrency,
        // Cashea outputs
```

### 9c) Botón + ocultar el reparto

#### VERIFICAR ANCLAJE
```bash
grep -cF "                    {isPaid && changeUsd > 0.009 && (" src/components/Sales/CheckoutModal.jsx
```
→ `1`.

#### BUSCAR (literal, 20 espacios en la primera línea)
```jsx
                    {isPaid && changeUsd > 0.009 && (
                        <div className="mt-1.5 pt-1.5 border-t border-emerald-200/50 dark:border-emerald-800/30 flex flex-col gap-1">
                            <div className="flex items-center gap-2">
```

#### REEMPLAZAR POR
```jsx
                    {isPaid && changeUsd > 0.009 && (
                        <div className="mt-1.5 pt-1.5 border-t border-emerald-200/50 dark:border-emerald-800/30 flex flex-col gap-1">
                            {/* TIP: el cliente deja el cambio. Paridad con el modo POS. */}
                            <button
                                type="button"
                                onClick={toggleTipDonated}
                                className={`w-full py-2 px-2.5 rounded-lg font-black text-[10px] flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] ${
                                    isTipDonated
                                        ? 'bg-emerald-600 text-white shadow shadow-emerald-500/30'
                                        : tipConfirmPending
                                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-2 border-amber-400 animate-pulse'
                                            : 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                }`}
                            >
                                <HandCoins size={13} className="shrink-0" />
                                <span className="truncate">
                                    {isTipDonated
                                        ? `Deja el cambio (${tipCurrency === 'BS' ? `Bs ${formatBs(changeBs)}` : `$${changeUsd.toFixed(2)}`})`
                                        : tipConfirmPending
                                            ? `Confirmar: donar $${changeUsd.toFixed(2)}`
                                            : 'Cliente deja el cambio (Donar a Caja)'}
                                </span>
                                {isTipDonated && <CheckCircle size={12} className="text-white shrink-0" />}
                            </button>

                            {!isTipDonated && (<>
                            <div className="flex items-center gap-2">
```

> ⚠️ **El JSX queda temporalmente inválido** (fragmento sin cerrar). Lo cierra la edición **9d**, que es obligatoria. **No ejecutar `npm run build` entre 9c y 9d.**

### 9d) Cerrar el fragmento

#### VERIFICAR ANCLAJE
```bash
grep -cF "                                            Excede fondo de caja." src/components/Sales/CheckoutModal.jsx
```
→ `1`.

#### BUSCAR (literal)
```jsx
                                        <p className="text-[9px] font-bold text-orange-600 dark:text-orange-400 leading-tight">
                                            Excede fondo de caja.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
```

#### REEMPLAZAR POR
```jsx
                                        <p className="text-[9px] font-bold text-orange-600 dark:text-orange-400 leading-tight">
                                            Excede fondo de caja.
                                        </p>
                                    </div>
                                </div>
                            )}
                            </>)}
                        </div>
                    )}
```

### VERIFICAR FASE 9
```bash
grep -cF "HandCoins" src/components/Sales/CheckoutModal.jsx
grep -cF "                            {!isTipDonated && (<>" src/components/Sales/CheckoutModal.jsx
grep -cF "                            </>)}" src/components/Sales/CheckoutModal.jsx
grep -cF "        toggleTipDonated," src/components/Sales/CheckoutModal.jsx
grep -cF "formatBs" src/components/Sales/CheckoutModal.jsx
```
→ `2`, `1`, `1`, `1`, y **≥ 2** en el último.

> ⚠️ Si el último comando imprime `0` o `1` sin línea de import, `formatBs` no está disponible. Comprobar con `grep -n "formatBs" src/components/Sales/CheckoutModal.jsx`; si no hay import, **cambiar `formatBs(changeBs)` por `changeBs.toFixed(2)` en 9c** en lugar de añadir un import nuevo.

```bash
npm run build 2>&1 | tail -8
npm run lint 2>&1 | tail -8
```
→ build limpio, sin errores nuevos.

### ROLLBACK FASE 9
```bash
git checkout -- src/components/Sales/CheckoutModal.jsx
```

---

## FASE 10 — Ticket y comprobante (T-7)

**Archivos:** `src/components/Sales/ReceiptModal.jsx`, `src/components/Sales/ReceiptShareHelper.js`
**Corrige:** T-7 — el origen nunca imprime la propina; el cliente que donó no recibe constancia y el ticket muestra "Vuelto: $0.00" sin explicación.

### 10a) `ReceiptModal.jsx`

#### VERIFICAR ANCLAJE
```bash
grep -cF "                                {receipt.fiadoUsd > 0 && (" src/components/Sales/ReceiptModal.jsx
```
→ `1`.

#### BUSCAR (literal, 32 espacios)
```jsx
                                {receipt.fiadoUsd > 0 && (
```

#### REEMPLAZAR POR
```jsx
                                {/* TIP-007: constancia de la propina donada. */}
                                {receipt.tipDonated && receipt.tipDonated.amountUsd > 0 && (
                                    <div className="flex justify-between text-emerald-700 font-bold mt-2 pt-2 border-t border-slate-200">
                                        <span>Cliente dejó el cambio:</span>
                                        <span>
                                            {receipt.tipDonated.currency === 'BS'
                                                ? `Bs ${formatBs(receipt.tipDonated.amountBs)}`
                                                : `$${receipt.tipDonated.amountUsd.toFixed(2)}`
                                            }
                                        </span>
                                    </div>
                                )}

                                {receipt.fiadoUsd > 0 && (
```

### 10b) `ReceiptShareHelper.js`

#### VERIFICAR ANCLAJE
```bash
grep -cF "    // Fiado" src/components/Sales/ReceiptShareHelper.js
grep -cF "        changeLines," src/components/Sales/ReceiptShareHelper.js
```
→ `1` y `1`.

#### BUSCAR nº1 (literal, 4 espacios)
```js
    // Fiado
```

#### REEMPLAZAR POR nº1
```js
    // TIP-007: propina donada
    const tipLine = (r.tipDonated && r.tipDonated.amountUsd > 0.005)
        ? (r.tipDonated.currency === 'BS'
            ? `\nCLIENTE DEJO EL CAMBIO: Bs ${formatBs(r.tipDonated.amountBs)}`
            : `\nCLIENTE DEJO EL CAMBIO: ${fmtUsd(r.tipDonated.amountUsd)}`)
        : '';

    // Fiado
```

#### BUSCAR nº2 (literal, 8 espacios)
```js
        changeLines,
```

#### REEMPLAZAR POR nº2
```js
        changeLines,
        tipLine,
```

> ℹ️ Verificado: `changeLines,` vive dentro de un array literal que termina en `.filter(Boolean).join('\n')` (línea ~145). Por eso `tipLine` se inserta ahí y una cadena vacía se descarta sola. Si al abrir el archivo el contexto **no** es ese array, **detener y reportar** — no improvisar la inserción.

### VERIFICAR FASE 10
```bash
grep -cF "                                {receipt.tipDonated && receipt.tipDonated.amountUsd > 0 && (" src/components/Sales/ReceiptModal.jsx
grep -cF "    const tipLine = (r.tipDonated && r.tipDonated.amountUsd > 0.005)" src/components/Sales/ReceiptShareHelper.js
grep -cF "        tipLine," src/components/Sales/ReceiptShareHelper.js
grep -cF "formatBs" src/components/Sales/ReceiptModal.jsx
grep -cF "formatBs" src/components/Sales/ReceiptShareHelper.js
```
→ `1`, `1`, `1`, y **≥ 2** en los dos últimos (`formatBs` ya se usa en ambos archivos).

```bash
npm run build 2>&1 | tail -6
npm run lint 2>&1 | tail -6
```
→ build limpio, sin errores nuevos.

### ROLLBACK FASE 10
```bash
git checkout -- src/components/Sales/ReceiptModal.jsx src/components/Sales/ReceiptShareHelper.js
```

---

## FASE 11 — Anulación: constancia auditable (T-3 / D9)

**Archivo:** `src/utils/voidSaleProcessor.js`

> **Política (D9):** al anular una venta con propina, el sistema **no mueve dinero automáticamente**. Los reportes ya excluyen las ventas `ANULADA` (los consumidores filtran por `status` antes de llamar al motor), así que la propina desaparece de los totales sola. Lo que faltaba era **constancia**: si el operador tiene que decidir qué hacer con el dinero físico, necesita el monto registrado.
>
> ⛔ **NO** se implementa una reversión automática. Restar la propina del cajón al anular crearía un descuadre distinto si el cliente ya se fue con su vuelto (o sin él). Es una decisión física, no de software.

### VERIFICAR ANCLAJE
```bash
grep -cF "            { saleId: sale.id, tipo: sale.tipo, totalUsd: sale.totalUsd }" src/utils/voidSaleProcessor.js
```
→ `1`.

### BUSCAR (literal, 8 espacios en `logEvent`)
```js
        logEvent('VENTA', 'VENTA_ANULADA',
            `Venta #${sale.saleNumber || '?'} anulada - $${round2(sale.totalUsd || 0)}`,
            user,
            { saleId: sale.id, tipo: sale.tipo, totalUsd: sale.totalUsd }
        );
```

### REEMPLAZAR POR
```js
        // TIP-003 (D9): si la venta tenía propina donada, el monto queda registrado
        // en la auditoría. NO se revierte dinero automáticamente: el efectivo físico
        // lo resuelve el operador. Los reportes ya excluyen las ventas ANULADA.
        const tipDonadaUsd = round2(sale.tipDonated?.amountUsd || 0);
        logEvent('VENTA', 'VENTA_ANULADA',
            `Venta #${sale.saleNumber || '?'} anulada - $${round2(sale.totalUsd || 0)}`
            + (tipDonadaUsd > 0
                ? ` - ATENCION: incluia propina donada de $${tipDonadaUsd}. Verifica el efectivo en caja.`
                : ''),
            user,
            { saleId: sale.id, tipo: sale.tipo, totalUsd: sale.totalUsd, tipDonatedUsd: tipDonadaUsd }
        );
```

### VERIFICAR FASE 11
```bash
grep -cF "        const tipDonadaUsd = round2(sale.tipDonated?.amountUsd || 0);" src/utils/voidSaleProcessor.js
grep -cF "tipDonatedUsd: tipDonadaUsd" src/utils/voidSaleProcessor.js
grep -cF "round2" src/utils/voidSaleProcessor.js
```
→ `1`, `1`, y **≥ 3** en el último (`round2` ya está importado).

```bash
npx vitest run tests/financialEngine.test.js 2>&1 | tail -8
```
→ **sin regresiones** (`processVoidSale` se testea en ese archivo).

### ROLLBACK FASE 11
```bash
git checkout -- src/utils/voidSaleProcessor.js
```

---

## FASE 12 — Verificación final, E2E manual y commit

### 12a) Suite completa

```bash
npm test 2>&1 | tail -10
```

**Exigido:**
- `Tests` ≥ **153 passed** (141 de línea base + 12 nuevos).
- `Errors` ≤ **1** (el flake pre-existente de worker en Windows).
- **0 tests fallando.**

### 12b) Build y lint

```bash
npm run build 2>&1 | tail -8
npm run lint 2>&1 | tail -10
```
→ build limpio; lint sin errores nuevos respecto a la línea base.

### 12c) Verificación de integridad de los guardarraíles

Todos deben imprimir el valor indicado:

```bash
# G1: financialLogic.js intacto
git diff --stat src/utils/financialLogic.js | wc -l          # → 0
# G3: CierreCajaWizard intacto
git diff --stat src/components/Dashboard/CierreCajaWizard.jsx | wc -l   # → 0
# G2: no se creó un método de pago "propina"
grep -rc "methodId: 'propina'" src/ 2>/dev/null | grep -v ':0' | wc -l  # → 0
# G5: el lock y el freeze siguen ahí
grep -cF "withLock('pos_write_lock'" src/utils/checkoutProcessor.js     # → 1
grep -cF "deepFreeze(sale);" src/utils/checkoutProcessor.js             # → 1
# G8: no se borró ni tocó ningún test previo
git diff --stat tests/financialEngine.test.js tests/checkout.test.js tests/cashea.test.js | wc -l  # → 0
# Coherencia: la propina se excluye en los 2 consumidores
grep -cF "&& !d.isTip" src/components/Dashboard/DashboardPaymentBreakdown.jsx   # → 5
grep -cF "&& !d.isTip" src/components/Reports/ReportsMetricsTab.jsx            # → 5
```

> ⛔ Cualquier desviación → **DETENER Y REPORTAR** antes de hacer commit.

### 12d) Checklist E2E manual (obligatorio — la UI no está cubierta por tests)

```bash
npm run dev
```

Ejecutar los 10 casos. **Anotar el resultado real de cada uno**, no marcar "OK" en bloque.

| # | Escenario | Resultado esperado |
|---|---|---|
| **E1** | POS · venta $3.01, pago $5 efectivo USD. Pulsar "Cliente deja el cambio". | El botón se pone verde con check, el título pasa a "Vuelto Dejado En Caja (Propina)", el borde gana un anillo verde y **los inputs "En $ USD" / "En Bs" desaparecen**. |
| **E2** | Cobrar E1. Ir a Dashboard → Medios de Pago. | Efectivo $ muestra **$5.00** (no $1.99). Aparece la fila "Cambios dejados en caja (propinas): USD 3.01" con la nota "Ya incluido en el efectivo". **Los porcentajes de los métodos no cambian por la propina.** |
| **E3** | Cerrar caja (arqueo) tras E1. | El efectivo esperado en $ incluye los **$5** completos. Sin faltante. |
| **E4** | POS · venta $3.01, pago **Bs 400** en efectivo Bs. Donar el cambio. | La etiqueta del botón muestra el monto **en Bs**, no en $. En el Dashboard aparece "Propina Dejada En Bs" y **no** una fila en USD. |
| **E5** | POS · venta $3.01, pago **$500** por error. Pulsar el botón **una vez**. | ⚠️ **No dona.** El botón se pone ámbar y pulsa: "Confirmar: donar $496.99". Un toast advierte. Segunda pulsación → sí dona. |
| **E6** | En E5, tras la primera pulsación, corregir el pago a $5. | El botón vuelve a su estado normal (no ámbar, no verde). La confirmación pendiente caducó. |
| **E7** | POS · donar el cambio, luego **bajar el pago** a exacto, luego **volver a subirlo**. | El toggle está **apagado**. La propina **no** se re-arma sola. |
| **E8** | POS · modo crédito (venta fiada) con abono parcial. | El botón de propina **no aparece** (no hay vuelto). Si por algún camino se guardara, `sale.tipDonated` sale `null`. |
| **E9** | Modo básico (`CheckoutModal`) · repetir E1. | Mismo comportamiento: botón, ocultado del reparto, propina en el Dashboard. **Paridad con el POS.** |
| **E10** | Anular una venta con propina. Revisar el log de auditoría. | El evento `VENTA_ANULADA` incluye "ATENCION: incluia propina donada de $X". El Dashboard y los Reportes **ya no cuentan esa propina**. |

Complementarios (rápidos):

| # | Escenario | Esperado |
|---|---|---|
| **E11** | Imprimir/compartir el recibo de E1. | Aparece "Cliente dejó el cambio: $3.01". |
| **E12** | POS · Cashea activo con vuelto en la cuota inicial. Donar. | Se permite (D5). `sale.tipDonated` no es `null` y `sale.changeUsd` es `0`. |
| **E13** | Venta sin vuelto (pago exacto). | El botón no se renderiza (la tarjeta de vuelto no existe). |

### 12e) Commit final

```bash
git add -A
git status --short
```

Revisar que la lista de archivos es exactamente:
```
src/utils/securityConstants.js
src/core/FinancialEngine.js
src/utils/checkoutProcessor.js
src/utils/voidSaleProcessor.js
src/components/Dashboard/DashboardPaymentBreakdown.jsx
src/components/Reports/ReportsMetricsTab.jsx
src/components/Sales/CheckoutModal.jsx
src/components/Sales/CheckoutModalPOS/index.jsx
src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
src/components/Sales/ReceiptModal.jsx
src/components/Sales/ReceiptShareHelper.js
src/hooks/useCheckoutCalculations.js
tests/tipDonated.test.js
AUDITORIA-VUELTO-DONADO.md
PLAN-VUELTO-DONADO.md
```
(más los archivos que ya estaban modificados antes de empezar — ver 0d).

> ⛔ Si aparece cualquier archivo **fuera** de esa lista, revisar antes de commitear. En particular `src/utils/financialLogic.js` y `src/components/Dashboard/CierreCajaWizard.jsx` **no deben estar**.

```bash
git commit -m "feat(propina): UI del vuelto donado en ambos modos de checkout

Completa el porte de 'Cliente deja el cambio' desde donde-juancho.

UI POS y basica:
- Boton en la tarjeta de vuelto que oculta el reparto al activarse.
- Doble pulsacion obligatoria por encima de TIP_MAX_AUTO_USD (T-2):
  un tap accidental sobre un vuelto anomalo no puede donar cientos
  de dolares en silencio.
- Moneda derivada de la composicion real del efectivo, no del orden
  de los metodos (T-4). Se reutiliza el criterio de magnitudes.
- El toggle se apaga si el vuelto desaparece y la confirmacion caduca
  al cambiar el monto (T-5).
- Epsilon PAYMENT_ZERO en ambos modos, no '> 0' (T-6).

Comprobante:
- El ticket y el texto compartible declaran la propina (T-7).

Anulacion:
- El log de auditoria registra el monto donado. No se revierte dinero
  automaticamente: es una decision fisica del operador (T-3 / D9).

Ref: AUDITORIA-VUELTO-DONADO.md, PLAN-VUELTO-DONADO.md fases 6-11"
```

### 12f) Reporte de cierre

Reportar, con este formato y **sin adornos**:

1. **Tabla fase por fase**: `FASE N | aplicada / omitida / fallida | comandos de verificación y su salida real`.
2. **Salida literal** de `npm test` (últimas 8 líneas), `npm run build` y `npm run lint`.
3. **Resultado real de los 13 casos E2E**, uno por uno. Si alguno no se pudo probar, decirlo — **no marcarlo OK**.
4. **Desviaciones**: cualquier anclaje que no imprimió el valor esperado y qué se hizo.
5. **Recordatorio explícito**: los tests cubren `checkoutProcessor` y `FinancialEngine`. **La UI no está testeada automáticamente** (`@testing-library` no es dependencia). Lo único que valida la UI es el checklist E2E.

---

## §3 — MATRIZ DE RIESGOS

| # | Riesgo | Prob. | Impacto | Mitigación en el plan |
|---|---|---|---|---|
| R1 | Se omite la FASE 5 y la propina se cuenta como ingreso extra | Media | 🔴 Crítico — el Dashboard reporta más dinero del que hay | La FASE 5 lleva marca de "FASE CRÍTICA" y el guardarraíl principal de §1 lo enuncia. `VERIFICAR FASE 12c` exige `&& !d.isTip` = 5 en ambos archivos. |
| R2 | Se guarda la propina en dos monedas (repetir T-1) | Media | 🔴 Crítico — propinas infladas ~2× | El procesador recalcula `amountBs` y lo pone en 0 si la moneda es USD. TIP-001 lo testea en ambos sentidos. |
| R3 | Propina **y** vuelto entregado a la vez | Baja | 🔴 Crítico — el dinero se cuenta dos veces | Se fuerza en el procesador (4b), no solo en la UI. TIP-002 lo testea con un payload contradictorio. |
| R4 | JSX roto entre 7c/7d o 9c/9d | Alta | 🟠 Build falla | Advertencia explícita de no ejecutar `npm run build` entre las dos mitades; `VERIFICAR FASE` de 7 y 9 hace el build al final. |
| R5 | `grep` con `[` interpretado como clase de caracteres → anclaje "no encontrado" | Alta | 🟡 El ejecutor improvisa un anclaje equivocado | Convención §2.3: **siempre `grep -cF`**. Ya causó un fallo en un plan anterior. |
| R6 | Import duplicado de `FINANCIAL_EPSILON` | Media | 🟠 Build falla | 6f declara el conteo verificado (0) y el anclaje es la línea del import de `FinancialEngine`. |
| R7 | `formatBs` no disponible en `CheckoutModal.jsx` | Baja | 🟡 Runtime error | Verificado: 10 usos, importado en la línea 4. `VERIFICAR FASE 9` lo comprueba y da la alternativa `changeBs.toFixed(2)`. |
| R8 | `changeLines` está en un objeto y no en una concatenación (FASE 10b) | Media | 🟡 La línea no sale en el ticket | Advertencia explícita: comprobar el contexto antes de aplicar 10b nº2, y detener si es un objeto literal. |
| R9 | Se ejecuta este plan sin haber ejecutado `PLAN-FIXEO-CHECKOUT.md` | Baja | 🔴 La propina hereda el doble conteo de vuelto | Compuerta dura 0a: aborta el plan completo. |
| R10 | El toggle queda armado y se dona sin que el operador lo reconfirme | Media | 🟠 Propina fantasma | Efecto de reset (6c / 8c) + `tipEfectiva` recalculado en el payload + `changeUsd > EPSILON` en el procesador. Tres capas. |
| R11 | Propina en `VENTA_FIADA` | Baja | 🟠 Datos incoherentes | El procesador la anula (4a). TIP-004 lo testea. |
| R12 | El ejecutor "arregla" el `1 error` pre-existente de vitest | Media | 🟡 Pierde tiempo y toca cosas que no debe | Declarado en 0c como PRE-EXISTENTE y prohibido tocarlo. |
| R13 | El ejecutor afirma que la UI está testeada | Alta | 🟡 Falsa confianza | §2.8 + 12f punto 5 lo prohíben explícitamente. |
| R14 | Se toca `financialLogic.js` o `CierreCajaWizard.jsx` | Baja | 🔴 Destruye saldos de clientes o el arqueo | G1 y G3; verificados en 12c con `git diff --stat ... \| wc -l` = 0. |

---

## §4 — FUERA DE ALCANCE

Lo siguiente **no** se implementa en este plan. No hacerlo "de paso".

1. **Atribución de la propina por cajero o turno** (T-10). El log de auditoría ya registra el usuario que cobró. Un reparto de propinas entre empleados es una funcionalidad de nómina, no de checkout.
2. **Propina en COP** (T-5, D8). No existe camino de vuelto en COP en la UI. Si el pago es puro COP, la propina se etiqueta USD.
3. **Reversión automática del dinero al anular** (T-3, D9). Es una decisión física del operador. El sistema deja constancia.
4. **Propina explícita distinta del vuelto** (que el cliente añada $2 de propina sobre el total). Esta funcionalidad solo dona *el vuelto que ya existe*. Una propina arbitraria requeriría tocar los totales del carrito.
5. **`computeExpectedCash`** — no existe en este proyecto (el arqueo hace la resta a mano en `CierreCajaWizard.jsx:89-90`). No se crea. La propina funciona sin ella porque el vuelto entregado es 0.
6. **Advertencia en la UI al anular una venta con propina.** Solo se registra en auditoría. Añadir un modal de confirmación toca el flujo de anulación completo, fuera de alcance.
7. **Métrica de propinas en `OwnerMonitorView`**. El origen la tiene (`tipUsd`/`tipBs` acumulados independientes — parte del defecto T-1). No se porta: `OwnerMonitorView.jsx` ya está modificado por otro trabajo en curso y tocarlo aquí generaría conflicto.
8. **Migración de ventas históricas.** Las ventas anteriores no tienen `tipDonated`; el motor lo lee como `undefined` y no crea bucket. No hace falta migrar nada.
