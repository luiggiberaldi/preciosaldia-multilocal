# PLAN LITERAL DE EJECUCIÓN — FIXEO DE INVENTARIO

**Proyecto:** `preciosaldia-bodega`
**Documento de origen:** `AUDITORIA-INVENTARIO.md`
**Destinatario:** LLM ejecutor (modelo rápido / flash)
**Rama base:** `main`
**Rama de trabajo:** `fix/inventario-integridad`

**Cubre:** INV-01 … INV-16, INV-19, INV-22, INV-23, INV-26, INV-27, INV-28 (23 de los 28 hallazgos).
**No cubre:** INV-17, INV-18, INV-20, INV-21(parcial), INV-24(parcial), INV-25 — ver §4.

---

## ⚠️ LEE ESTO ANTES DE TOCAR UN SOLO ARCHIVO

Este plan está escrito para ejecutarse **de forma estrictamente secuencial**. Cada fase asume que la anterior terminó y verificó. No adelantes fases, no agrupes ediciones de fases distintas, no "optimices" el orden.

**Tres reglas que anulan cualquier impulso de mejorar el código:**

1. **Si un anclaje (`grep -cF`) no devuelve exactamente el número esperado, DETENTE** y reporta. No busques un anclaje parecido. No edites "el bloque que se ve igual". Un anclaje que falla significa que el archivo no está en el estado que este plan asume, y cualquier edición a ciegas corrompe el resultado.

2. **No refactorices nada que este plan no te mande cambiar.** No renombres variables, no reordenes imports, no conviertas funciones a flechas, no añadas tipos, no arregles indentación ajena, no borres comentarios `FIN-*` / `HOOK-*` / `VUL-*` / `FIX-*`. Esos comentarios son el registro de decisiones anteriores del proyecto.

3. **El orden FASE 2 → FASE 3 → FASE 4 no es negociable.** FASE 2 arregla la normalización, FASE 3 añade el validador que la protege y FASE 4 arregla la persistencia. Hacer 4 antes de 2 deja el catálogo escribiéndose con lock pero con datos mal normalizados, y los tests de FASE 1 te van a mentir diciendo que todo está bien.

---

## §0 — DECISIONES DE DISEÑO (ya tomadas, no las re-discutas)

| # | Decisión | Motivo |
|---|---|---|
| **D1** | La validación de entrada vive en una **función pura nueva y exportada**, `validateProductForm(formData, opts)`, dentro de `src/utils/productProcessor.js`. | Es lo único totalmente testeable sin `@testing-library` (que **no** es dependencia de este proyecto). Poner la validación dentro del componente la vuelve inauditable. |
| **D2** | `buildProductPayload` **no cambia su firma ni su tipo de retorno**. Sigue devolviendo el objeto de producto, nunca lanza y nunca devuelve `{ error }`. | Tiene dos consumidores (`ProductsView.jsx:385` y `RemoteProductFormModal.jsx:197`). Cambiar el contrato rompe el segundo, que está fuera de alcance. |
| **D3** | El signo negativo se **rechaza en el validador leyendo la cadena cruda**, no normalizando el número. | `CurrencyService.safeParse` descarta el `-` (`s.replace(/[^\d.,]/g,'')`), así que cuando el número llega a `round2` ya perdió el signo: es imposible detectarlo después. Hay que verlo antes de parsear. |
| **D4** | El stock pasa a `round3` (3 decimales), no a entero. | El sistema ya produce stock fraccionario: `checkoutProcessor.js:231-235` descuenta `divR(qty, unitsPerPackage)` y `item.qty` de ventas por peso. 3 decimales es lo que usa el resto del código para cantidades (`dinero.js:58`). |
| **D5** | `pricingMode === 'dual_usd'` sin `priceBsUsdRef` se **rechaza en el validador**, y la degradación defensiva a `tasa_dia` dentro de `buildProductPayload` **se conserva**. | El validador protege la puerta de la UI; la degradación protege a `RemoteProductFormModal`, que no pasa por el validador. Cinturón y tirantes. |
| **D6** | La tasa en 0 se rechaza **solo cuando el valor autoritativo tendría que derivarse desde bolívares** (`priceUsd` vacío con `priceBs` lleno, o `costUsd` vacío con `costBs` lleno). El fallback `safeRate = 1` **se conserva** en el código pero deja de ser alcanzable en esa dirección. | Mismo razonamiento que D5: borrar el fallback haría que `RemoteProductFormModal` divida por 0. |
| **D6b** | Con la tasa en 0 y el precio dado **en USD**, el guardado **se permite** aunque el `costBs`/`priceBs` derivado quede mal. | Rechazarlo también bloquearía al bodeguero para corregir stock mientras la tasa no ha cargado (arranque offline) — una regresión peor que el dato que se protege. El daño queda contenido porque D10 quita a `costBs` su rol de base de cálculo, y el valor se auto-corrige en el siguiente guardado con tasa válida. |
| **D7** | Toda escritura de `bodega_products_v1` y `bodega_sales_v1` desde `ProductsView` y `ProductContext` pasa por `withLock('pos_write_lock')` **y relee el estado fresco desde `storageService` dentro del lock**. | Es el patrón ya probado en `checkoutProcessor.js:180` y `useRemoteCommands.js:60`. No se inventa nada nuevo. |
| **D8** | El delta de stock que se **registra** en el historial es el delta **efectivo** (`stockAfter − stockBefore`), no el solicitado. | Si el stock se recortó a 0, registrar el delta pedido convierte el Kardex en ficción. |
| **D9** | El ajuste masivo de precios aplica el multiplicador a **`priceUsdt`, `priceUsd`, `priceCop`, `unitPriceUsd`, `unitPriceCop` y `priceBsUsdRef`**, usando `mulR`. | `priceCop` manda sobre `priceUsdt` en todos los lectores (`calculatorUtils.js:25-41`, `SalesView.jsx:437`). Tocar solo `priceUsdt` es un no-op para el precio cobrado. |
| **D10** | El margen se calcula **siempre en USD**: `(precioUsdEfectivo − costUsd) / costUsd`. `costBs` queda como dato histórico y **no se borra**. | `costBs` está congelado al momento del guardado; usarlo como base contra un precio en Bs actual infla el margen con la tasa. |
| **D11** | El motivo del egreso se guarda en el campo **`motivo`** del registro de ajuste, y además se emite un `logEvent('INVENTARIO', 'AJUSTE_MASIVO_STOCK', …)`. | El campo ya es obligatorio en la UI; solo falta no tirarlo. |
| **D12** | **No se toca `src/utils/financialLogic.js` ni `src/core/FinancialEngine.js`.** | Prohibición vigente del proyecto. Nada de este plan lo necesita. |

---

## §1 — GUARDARRAÍLES (violarlos invalida la ejecución)

| # | Prohibición |
|---|---|
| **G1** | **No modificar `src/utils/financialLogic.js`.** Prohibición explícita y permanente del proyecto. |
| **G2** | **No modificar `src/core/FinancialEngine.js`.** Ninguna fase lo requiere. |
| **G3** | **No modificar `src/utils/checkoutProcessor.js`.** Su descuento de stock (`:224-250`) ya es correcto y es el modelo a imitar, no a editar. |
| **G4** | **No modificar `src/utils/storageService.js`.** El Circuit Breaker y los Shadow Snapshots están bien; INV-11 se arregla del lado del llamador, no bajando el umbral ni tocando el flag dentro del servicio. |
| **G5** | **No modificar `src/services/CurrencyService.js`.** Que `safeParse` descarte el signo es comportamiento del que dependen otros módulos (montos de pago, avances, Cashea). Se compensa en el validador (D3). |
| **G6** | **No modificar ningún test existente** en `tests/`. Los 12 archivos actuales deben seguir pasando sin editarlos. Solo se **crea** `tests/inventory.test.js`. |
| **G7** | **No cambiar la firma ni el retorno de `buildProductPayload`** (D2). |
| **G8** | **No renombrar `priceUsdt`.** Es un typo histórico deliberadamente conservado (FIN-030). Se mantiene junto al alias `priceUsd`. |
| **G9** | **No borrar `costBs`** del payload ni de los productos. Se deja de usar como base de cálculo del margen, pero sigue guardándose. |
| **G10** | **No modificar `src/components/Monitor/RemoteProductFormModal.jsx`.** Está fuera de alcance; hereda los arreglos de `buildProductPayload` sin cambios propios. |
| **G11** | **No cambiar el umbral `CIRCUIT_BREAKER_MIN_RATIO`** ni la lógica de `shadowBackupService`. |
| **G12** | **No reformatear archivos.** El diff final debe contener únicamente líneas que este plan manda cambiar. Si tu editor reindenta al guardar, deshazlo. |

---

## §2 — CONVENCIONES DE EJECUCIÓN

1. **Shell:** Git Bash (POSIX). Rutas con `/`. Todos los comandos se ejecutan desde la raíz del repositorio.

2. **Verificar anclajes SIEMPRE con `grep -cF`** (`-F` = cadena literal, `-c` = contar). Nunca con `grep -c` a secas. Motivo: `grep` en modo BRE interpreta `[`, `]`, `$`, `*`, `(`, `)`, `.`, `?`, `|` como metacaracteres. `grep -c "const [x, y] = ..."` devuelve `0` porque lee `[x, y]` como clase de caracteres. Este proyecto está lleno de destructuring y de JSX con `className="text-[10px]"`.

3. **Nunca encadenar verificaciones con `&&`.** Un `grep -cF` que devuelve `0` sale con código 1 y corta la cadena, dejando las verificaciones siguientes sin ejecutar — y tú creyendo que pasaron. Usa `;` y prefija cada una con su etiqueta:
   ```bash
   echo -n "A1: "; grep -cF "..." archivo.js
   echo -n "A2: "; grep -cF "..." archivo.js
   ```

4. **Una edición = un anclaje único.** Antes de cada `Edit`, el `grep -cF` de su anclaje debe dar exactamente `1`. Si da `0`, el archivo cambió: **DETENTE**. Si da `2` o más, el anclaje es ambiguo: usa el anclaje multilínea que el plan indica en su lugar, nunca adivines cuál de los dos.

5. **Después de cada fase que toque `.jsx`, ejecuta `npx vite build --mode development 2>&1 | tail -5`** salvo cuando el plan diga explícitamente que no lo hagas (hay fases que dejan el JSX temporalmente inválido entre dos ediciones).

6. **La suite de tests se corre con `npm test`.** `npx vitest run --reporter=basic` **NO funciona** en la versión de vitest de este proyecto: falla con `ERR_LOAD_URL` / `loadCustomReporterModule` porque el reporter `basic` no existe. Para un archivo suelto: `npx vitest run tests/inventory.test.js`.

7. **La línea base de la suite es:**
   ```
   Test Files  10 passed (11)
   Tests       141 passed | 10 skipped (190)
   Errors      1 error
   ```
   Ese **1 error** es un `Worker exited unexpectedly` preexistente de Windows. **No es tu problema y no debes arreglarlo.** Si sigue apareciendo al final, es correcto. Si desaparece, tampoco pasa nada.

8. **No ejecutes `git commit` hasta que la fase te lo indique.** Hay dos checkpoints intermedios con commit y un commit final.

9. **Reporta con números, no con adjetivos.** "FASE 4 completa: 3 ediciones, anclajes 1/1/1, build OK, 158 tests pasan" — no "listo, todo bien".

---

# FASE 0 — COMPUERTA, RAMA Y VERIFICACIÓN DE ANCLAJES

## 0.a — Compuerta: el árbol debe estar limpio y en `main`

```bash
git status --short; git branch --show-current
```

**Esperado:** salida vacía (o solo archivos `.md` sin seguimiento) y `main`.

**Si hay archivos `.js` / `.jsx` modificados o sin seguimiento: DETENTE.** No trabajes sobre cambios ajenos sin commitear; este plan no sabe qué son y sus anclajes pueden no coincidir.

## 0.b — Compuerta: confirmar que los defectos existen todavía

```bash
echo -n "G0.1 parseInt(stock) sigue ahí: "; grep -cF "let finalStock = stock ? parseInt(stock, 10) : 0;" src/utils/productProcessor.js
echo -n "G0.2 validateProductForm NO existe: "; grep -cF "validateProductForm" src/utils/productProcessor.js
echo -n "G0.3 withLock NO está en ProductsView: "; grep -cF "withLock" src/views/ProductsView.jsx
echo -n "G0.4 bulk solo toca priceUsdt: "; grep -cF "const updated = { ...p, priceUsdt: parseFloat(newPrice.toFixed(4)) };" src/components/Products/BulkPriceAdjustModal.jsx
echo -n "G0.5 margen con costBs en la tarjeta: "; grep -cF "const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;" src/components/Products/ProductCard.jsx
echo -n "G0.6 tests/inventory.test.js NO existe: "; test -f tests/inventory.test.js && echo 1 || echo 0
```

**Esperado, en este orden exacto:** `1`, `0`, `0`, `1`, `1`, `0`.

**Si `G0.2` o `G0.6` devuelven `1`, este plan ya se ejecutó (total o parcialmente): DETENTE y reporta.** No lo ejecutes dos veces.

## 0.c — Línea base de la suite

```bash
npm test 2>&1 | tail -15
```

Anota los números. **Debe coincidir con §2.7** (141 pasan, 10 saltados, 1 error de worker). Si no coincide, anota lo que salga y úsalo como tu línea base real, pero **reporta la discrepancia** antes de continuar.

## 0.d — Crear la rama

```bash
git checkout -b fix/inventario-integridad
git branch --show-current
```

**Esperado:** `fix/inventario-integridad`.

## 0.e — Verificar los 24 anclajes del plan completo

Ejecuta este bloque **entero**, de una sola vez, y compara cada línea con el valor esperado. Nota que se usa `;` y no `&&` (§2.3).

```bash
echo "── productProcessor.js ──"
echo -n "A1: "; grep -cF "import { round2, divR, mulR } from './dinero.js';" src/utils/productProcessor.js
echo -n "A2: "; grep -cF "export function buildProductPayload(formData, effectiveRate) {" src/utils/productProcessor.js
echo -n "A3: "; grep -cF "let finalStock = stock ? parseInt(stock, 10) : 0;" src/utils/productProcessor.js
echo -n "A4: "; grep -cF "stockInLotes: isLote && stockInLotes ? parseInt(stockInLotes) : null," src/utils/productProcessor.js
echo -n "A5: "; grep -cF "const safeRate = effectiveRate > 0 ? effectiveRate : 1;" src/utils/productProcessor.js
echo -n "A6: "; grep -cF "        lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : 5," src/utils/productProcessor.js
echo "── ProductsView.jsx ──"
echo -n "A7: "; grep -cF "import { buildProductPayload } from '../utils/productProcessor';" src/views/ProductsView.jsx
echo -n "A8: "; grep -cF "    const adjustStock = async (productId, delta) => {" src/views/ProductsView.jsx
echo -n "A9: "; grep -cF "        if (!name || (!priceUsd && !priceBs)) {" src/views/ProductsView.jsx
echo -n "A10: "; grep -cF "    const _commitSave = async (productData) => {" src/views/ProductsView.jsx
echo -n "A11: "; grep -cF "    const confirmDelete = () => {" src/views/ProductsView.jsx
echo -n "A12: "; grep -cF "                const res = await migrateProductImagesToStorage(current, async (out) => {" src/views/ProductsView.jsx
echo -n "A13: "; grep -cF "    const handleFixCopPrices = () => {" src/views/ProductsView.jsx
echo -n "A14: "; grep -cF "                                localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');" src/views/ProductsView.jsx
echo -n "A15: "; grep -cF "                .filter(s => (s.items || []).some(i => i.id === product.id || i.name === product.name))" src/views/ProductsView.jsx
echo -n "A16: "; grep -cF "    const lowStockCount = products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0).length;" src/views/ProductsView.jsx
echo -n "A17: "; grep -cF "                                    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;" src/views/ProductsView.jsx
echo "── resto ──"
echo -n "A18: "; grep -cF "    const adjustStock = useCallback((productId, delta) => {" src/context/ProductContext.jsx
echo -n "A19: "; grep -cF "                    const newPrice = Math.max(0.01, (p.priceUsdt || 0) * multiplier);" src/components/Products/BulkPriceAdjustModal.jsx
echo -n "A20: "; grep -cF "    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;" src/components/Products/ProductCard.jsx
echo -n "A21: "; grep -cF "                        valA = a.costBs > 0 ? ((a.priceUsdt * effectiveRate - a.costBs) / a.costBs * 100) : -999;" src/hooks/useProductFiltering.js
echo -n "A22: "; grep -cF "                    s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.status !== 'ANULADA'" src/hooks/useInventoryVelocity.js
echo -n "A23: "; grep -cF "    const needsNote = direction === 'egreso' && !note.trim();" src/components/Products/StockBatchModal.jsx
echo -n "A24: "; grep -cF "            setFormMode(isEditing ? 'quick' : 'quick');" src/components/Products/ProductFormModal.jsx
```

**Los 24 deben devolver exactamente `1`.**

> **Nota sobre A5:** aparece 1 vez, pero la cadena `storageService.setItem('bodega_products_v1', updatedProducts);` **aparece 2 veces** en `ProductsView.jsx` (una en `_commitSave` con 8 espacios de sangría, otra en `confirmDelete` con 12). Por eso las fases 4 y 4.b usan **anclajes multilínea**, no esa línea suelta. No intentes editarla con un anclaje de una sola línea.

**Si alguno devuelve `0` o `>1`: DETENTE y reporta cuál.**

---

# FASE 1 — CREAR LOS TESTS (deben FALLAR)

**Objetivo:** fijar por escrito el comportamiento correcto **antes** de cambiar el código. Al terminar esta fase la suite debe **fallar**. Si pasa, algo está mal.

## 1.a — Crear `tests/inventory.test.js`

Crea el archivo con **exactamente** este contenido:

```js
// tests/inventory.test.js — Integridad del subsistema de Inventario.
// Cubre AUDITORIA-INVENTARIO.md: INV-05, INV-06, INV-09, INV-10, INV-16, INV-24.
// Capa pura únicamente: este proyecto NO tiene @testing-library, no se renderizan componentes.

import { describe, it, expect } from 'vitest';
import { buildProductPayload, validateProductForm } from '../src/utils/productProcessor';

// Formulario mínimo válido. Cada test lo extiende con lo que necesita probar.
const baseForm = () => ({
    name: 'Harina Pan 1kg',
    barcode: '',
    priceUsd: '1.50',
    priceBs: '',
    priceCop: '',
    costUsd: '1.00',
    costBs: '',
    costCop: '',
    stock: '10',
    stockInLotes: '',
    packagingType: 'suelto',
    unitsPerPackage: '',
    granelUnit: 'kg',
    sellByUnit: false,
    unitPriceUsd: '',
    unitPriceCop: '',
    category: 'otros',
    lowStockAlert: '5',
    pricingMode: 'tasa_dia',
    priceBsUsdRef: '',
});

const baseOpts = (over = {}) => ({
    effectiveRate: 40,
    products: [],
    editingId: null,
    allowNegativeStock: false,
    ...over,
});

// ─────────────────────────────────────────────────────────────
// INV-VAL — validateProductForm
// ─────────────────────────────────────────────────────────────

describe('INV-VAL — validateProductForm: nombre y precio', () => {
    it('INV-VAL-001 rechaza nombre vacío', () => {
        const r = validateProductForm({ ...baseForm(), name: '   ' }, baseOpts());
        expect(r.ok).toBe(false);
        expect(r.field).toBe('name');
    });

    it('INV-VAL-002 rechaza producto sin ningún precio', () => {
        const r = validateProductForm({ ...baseForm(), priceUsd: '', priceBs: '', priceCop: '' }, baseOpts());
        expect(r.ok).toBe(false);
        expect(r.field).toBe('price');
    });

    it('INV-VAL-003 acepta precio dado solo en COP', () => {
        const r = validateProductForm({ ...baseForm(), priceUsd: '', priceBs: '', priceCop: '15000' }, baseOpts());
        expect(r.ok).toBe(true);
    });

    it('INV-VAL-004 acepta el caso feliz completo', () => {
        expect(validateProductForm(baseForm(), baseOpts()).ok).toBe(true);
    });
});

describe('INV-VAL — validateProductForm: signos negativos (INV-09)', () => {
    it('INV-VAL-005 rechaza precio negativo en vez de voltearle el signo', () => {
        const r = validateProductForm({ ...baseForm(), priceUsd: '-5' }, baseOpts());
        expect(r.ok).toBe(false);
        expect(r.field).toBe('priceUsd');
    });

    it('INV-VAL-006 rechaza costo negativo', () => {
        const r = validateProductForm({ ...baseForm(), costUsd: '-2' }, baseOpts());
        expect(r.ok).toBe(false);
        expect(r.field).toBe('costUsd');
    });

    it('INV-VAL-007 rechaza stock negativo', () => {
        const r = validateProductForm({ ...baseForm(), stock: '-9' }, baseOpts());
        expect(r.ok).toBe(false);
        expect(r.field).toBe('stock');
    });

    it('INV-VAL-008 rechaza alerta mínima negativa', () => {
        const r = validateProductForm({ ...baseForm(), lowStockAlert: '-3' }, baseOpts());
        expect(r.ok).toBe(false);
        expect(r.field).toBe('lowStockAlert');
    });

    it('INV-VAL-009 rechaza negativo con separador decimal de coma', () => {
        const r = validateProductForm({ ...baseForm(), priceBs: '-1,50' }, baseOpts());
        expect(r.ok).toBe(false);
        expect(r.field).toBe('priceBs');
    });

    it('INV-VAL-010 acepta el cero y la cadena vacía (no son negativos)', () => {
        expect(validateProductForm({ ...baseForm(), stock: '0', costUsd: '' }, baseOpts()).ok).toBe(true);
    });

    it('INV-VAL-021 acepta stock negativo cuando allow_negative_stock está activo', () => {
        // Un producto puede quedar legítimamente en negativo (checkoutProcessor lo
        // permite con el flag). Si el validador lo rechazara, ese producto se
        // volvería imposible de editar.
        const r = validateProductForm({ ...baseForm(), stock: '-3' }, baseOpts({ allowNegativeStock: true }));
        expect(r.ok).toBe(true);
    });

    it('INV-VAL-022 rechaza la alerta negativa incluso con allow_negative_stock', () => {
        const r = validateProductForm({ ...baseForm(), lowStockAlert: '-3' }, baseOpts({ allowNegativeStock: true }));
        expect(r.ok).toBe(false);
        expect(r.field).toBe('lowStockAlert');
    });
});

describe('INV-VAL — validateProductForm: tasa de cambio (INV-06)', () => {
    it('INV-VAL-011 rechaza precio solo en Bs cuando la tasa es 0', () => {
        const r = validateProductForm(
            { ...baseForm(), priceUsd: '', priceBs: '500' },
            baseOpts({ effectiveRate: 0 })
        );
        expect(r.ok).toBe(false);
        expect(r.field).toBe('rate');
    });

    it('INV-VAL-012 acepta precio en USD aunque la tasa sea 0 (no la necesita)', () => {
        const r = validateProductForm({ ...baseForm(), priceBs: '' }, baseOpts({ effectiveRate: 0 }));
        expect(r.ok).toBe(true);
    });

    it('INV-VAL-013 rechaza costo solo en Bs cuando la tasa es 0', () => {
        const r = validateProductForm(
            { ...baseForm(), costUsd: '', costBs: '40' },
            baseOpts({ effectiveRate: 0 })
        );
        expect(r.ok).toBe(false);
        expect(r.field).toBe('rate');
    });
});

describe('INV-VAL — validateProductForm: doble precio (INV-10)', () => {
    it('INV-VAL-014 rechaza dual_usd sin precio de referencia', () => {
        const r = validateProductForm(
            { ...baseForm(), pricingMode: 'dual_usd', priceBsUsdRef: '' },
            baseOpts()
        );
        expect(r.ok).toBe(false);
        expect(r.field).toBe('priceBsUsdRef');
    });

    it('INV-VAL-015 rechaza dual_usd con referencia en 0', () => {
        const r = validateProductForm(
            { ...baseForm(), pricingMode: 'dual_usd', priceBsUsdRef: '0' },
            baseOpts()
        );
        expect(r.ok).toBe(false);
        expect(r.field).toBe('priceBsUsdRef');
    });

    it('INV-VAL-016 acepta dual_usd con referencia válida', () => {
        const r = validateProductForm(
            { ...baseForm(), pricingMode: 'dual_usd', priceBsUsdRef: '2.00' },
            baseOpts()
        );
        expect(r.ok).toBe(true);
    });
});

describe('INV-VAL — validateProductForm: código de barras único (INV-08)', () => {
    const otros = [
        { id: 'p1', name: 'Arroz', barcode: '7591111222233' },
        { id: 'p2', name: 'Aceite', barcode: null },
    ];

    it('INV-VAL-017 rechaza un código ya usado por otro producto', () => {
        const r = validateProductForm(
            { ...baseForm(), barcode: '7591111222233' },
            baseOpts({ products: otros })
        );
        expect(r.ok).toBe(false);
        expect(r.field).toBe('barcode');
        expect(r.message).toContain('Arroz');
    });

    it('INV-VAL-018 permite conservar su propio código al editar', () => {
        const r = validateProductForm(
            { ...baseForm(), barcode: '7591111222233' },
            baseOpts({ products: otros, editingId: 'p1' })
        );
        expect(r.ok).toBe(true);
    });

    it('INV-VAL-019 ignora espacios alrededor al comparar', () => {
        const r = validateProductForm(
            { ...baseForm(), barcode: '  7591111222233  ' },
            baseOpts({ products: otros })
        );
        expect(r.ok).toBe(false);
        expect(r.field).toBe('barcode');
    });

    it('INV-VAL-020 no valida unicidad si el código está vacío', () => {
        const r = validateProductForm({ ...baseForm(), barcode: '' }, baseOpts({ products: otros }));
        expect(r.ok).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────
// INV-PAY — buildProductPayload
// ─────────────────────────────────────────────────────────────

describe('INV-PAY — buildProductPayload: stock fraccionario (INV-05)', () => {
    it('INV-PAY-001 conserva 12.875 unidades (venta por unidad suelta de bulto)', () => {
        const p = buildProductPayload({ ...baseForm(), stock: '12.875' }, 40);
        expect(p.stock).toBe(12.875);
    });

    it('INV-PAY-002 conserva 8.65 kg (venta por peso)', () => {
        const p = buildProductPayload({ ...baseForm(), packagingType: 'granel', stock: '8.65' }, 40);
        expect(p.stock).toBe(8.65);
    });

    it('INV-PAY-003 deja los enteros como enteros', () => {
        expect(buildProductPayload({ ...baseForm(), stock: '20' }, 40).stock).toBe(20);
    });

    it('INV-PAY-004 stock vacío es 0, no NaN', () => {
        expect(buildProductPayload({ ...baseForm(), stock: '' }, 40).stock).toBe(0);
    });

    it('INV-PAY-005 redondea a 3 decimales, no más', () => {
        expect(buildProductPayload({ ...baseForm(), stock: '1.23456' }, 40).stock).toBe(1.235);
    });
});

describe('INV-PAY — buildProductPayload: bultos coherentes (INV-16)', () => {
    it('INV-PAY-006 1.5 bultos de 24 → 36 unidades y 1.5 bultos', () => {
        const p = buildProductPayload({
            ...baseForm(), packagingType: 'lote', unitsPerPackage: '24', stockInLotes: '1.5', stock: '',
        }, 40);
        expect(p.stock).toBe(36);
        expect(p.stockInLotes).toBe(1.5);
    });

    it('INV-PAY-007 2 bultos de 24 → 48 unidades y 2 bultos', () => {
        const p = buildProductPayload({
            ...baseForm(), packagingType: 'lote', unitsPerPackage: '24', stockInLotes: '2', stock: '',
        }, 40);
        expect(p.stock).toBe(48);
        expect(p.stockInLotes).toBe(2);
    });

    it('INV-PAY-008 unidades y bultos guardados nunca se contradicen', () => {
        const p = buildProductPayload({
            ...baseForm(), packagingType: 'lote', unitsPerPackage: '24', stockInLotes: '1.5', stock: '',
        }, 40);
        expect(p.stock).toBe(p.stockInLotes * p.unitsPerPackage);
    });
});

describe('INV-PAY — buildProductPayload: doble precio defensivo (INV-10 / D5)', () => {
    it('INV-PAY-009 conserva dual_usd cuando hay referencia', () => {
        const p = buildProductPayload({
            ...baseForm(), pricingMode: 'dual_usd', priceBsUsdRef: '2.00',
        }, 40);
        expect(p.pricingMode).toBe('dual_usd');
        expect(p.priceBsUsdRef).toBe(2);
    });

    it('INV-PAY-010 degrada a tasa_dia sin referencia (red de seguridad para el form remoto)', () => {
        const p = buildProductPayload({
            ...baseForm(), pricingMode: 'dual_usd', priceBsUsdRef: '',
        }, 40);
        expect(p.pricingMode).toBe('tasa_dia');
        expect(p.priceBsUsdRef).toBe(null);
    });
});

describe('INV-PAY — buildProductPayload: costo en COP persistido (INV-24)', () => {
    it('INV-PAY-011 guarda costCop cuando el usuario lo escribió', () => {
        const p = buildProductPayload({ ...baseForm(), costCop: '4100' }, 40);
        expect(p.costCop).toBe(4100);
    });

    it('INV-PAY-012 costCop es null cuando no se proporcionó', () => {
        expect(buildProductPayload(baseForm(), 40).costCop).toBe(null);
    });
});

describe('INV-PAY — buildProductPayload: invariantes que no deben romperse', () => {
    it('INV-PAY-013 mantiene el alias priceUsd igual a priceUsdt (FIN-030)', () => {
        const p = buildProductPayload(baseForm(), 40);
        expect(p.priceUsd).toBe(p.priceUsdt);
        expect(p.priceUsdt).toBe(1.5);
    });

    it('INV-PAY-014 sigue capitalizando el nombre', () => {
        expect(buildProductPayload({ ...baseForm(), name: 'harina pan' }, 40).name).toBe('Harina Pan');
    });

    it('INV-PAY-015 sigue derivando costBs desde costUsd y la tasa', () => {
        expect(buildProductPayload(baseForm(), 40).costBs).toBe(40);
    });

    it('INV-PAY-016 sigue mapeando packagingType a la unidad legacy', () => {
        expect(buildProductPayload({ ...baseForm(), packagingType: 'lote', unitsPerPackage: '6' }, 40).unit).toBe('paquete');
        expect(buildProductPayload({ ...baseForm(), packagingType: 'granel', granelUnit: 'litro' }, 40).unit).toBe('litro');
        expect(buildProductPayload(baseForm(), 40).unit).toBe('unidad');
    });

    it('INV-PAY-017 sigue poniendo la alerta por defecto en 5', () => {
        expect(buildProductPayload({ ...baseForm(), lowStockAlert: '' }, 40).lowStockAlert).toBe(5);
    });
});
```

## 1.b — Verificar que los tests FALLAN

```bash
npx vitest run tests/inventory.test.js 2>&1 | tail -20
```

**Esperado: el archivo falla.** `validateProductForm` no existe todavía, así que todos los `INV-VAL-*` revientan; y `INV-PAY-001/002/005/006/008/011` fallan porque el código actual trunca con `parseInt`.

**Si el archivo pasa entero: DETENTE.** Significa que copiaste mal el archivo o que el código ya estaba arreglado.

## 1.c — Registrar el conteo

El archivo declara **39 tests**. Anota cuántos fallan: deben ser **al menos 22**. Lo usarás para verificar el progreso en el CHECKPOINT 1.

**NO hagas commit todavía.**

---

# FASE 2 — `src/utils/productProcessor.js` (INV-05, INV-06, INV-09, INV-10, INV-16, INV-24)

Seis ediciones en un solo archivo puro. Es la fase de mayor impacto y la más segura: no hay JSX, no hay React, no hay efectos.

## 2.a — Ampliar el import de `dinero.js`

```bash
echo -n "2a: "; grep -cF "import { round2, divR, mulR } from './dinero.js';" src/utils/productProcessor.js
```
**Esperado: `1`.**

Reemplaza:
```js
import { round2, divR, mulR } from './dinero.js';
```
por:
```js
import { round2, round3, divR, mulR } from './dinero.js';
```

## 2.b — Añadir `validateProductForm` antes de `buildProductPayload`

```bash
echo -n "2b: "; grep -cF "export function buildProductPayload(formData, effectiveRate) {" src/utils/productProcessor.js
```
**Esperado: `1`.**

Reemplaza esa única línea:
```js
export function buildProductPayload(formData, effectiveRate) {
```
por **todo** este bloque (la función nueva, sus dos constantes y, al final, la misma línea original intacta):

```js
// ─────────────────────────────────────────────────────────────────────────────
// INV-09 / INV-06 / INV-10 / INV-08 — Validación de entrada.
//
// Vive aquí y no en el componente porque es la única forma de testearla: este
// proyecto no tiene @testing-library, así que no se renderizan componentes.
//
// Devuelve { ok: true } o { ok: false, field, message }. NUNCA lanza.
// ─────────────────────────────────────────────────────────────────────────────

// Orden fijo de revisión: el primer campo negativo que aparezca es el que se
// reporta. El orden importa para que el mensaje sea predecible y testeable.
const NUMERIC_FIELDS = [
    ['priceUsd', 'Precio en $'],
    ['priceBs', 'Precio en Bs'],
    ['priceCop', 'Precio en COP'],
    ['costUsd', 'Costo en $'],
    ['costBs', 'Costo en Bs'],
    ['costCop', 'Costo en COP'],
    ['priceBsUsdRef', 'Precio Ref. en $ para pagos en Bs'],
    ['unitPriceUsd', 'Precio por unidad en $'],
    ['unitPriceCop', 'Precio por unidad en COP'],
    ['unitsPerPackage', 'Unidades por bulto'],
    ['stock', 'Stock'],
    ['stockInLotes', 'Bultos'],
    ['lowStockAlert', 'Alerta mínima'],
];

// INV-09: hay que mirar la CADENA CRUDA, no el número parseado.
// `CurrencyService.safeParse` descarta el signo con `s.replace(/[^\d.,]/g,'')`,
// así que "-5" llega a round2 convertido en 5 y el negativo se vuelve invisible.
// Cuando el valor ya es número (viene de populateForm), se compara directo.
const _isNegative = (v) => {
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'number') return v < 0;
    return v.toString().trim().startsWith('-');
};

const _isFilled = (v) => v !== null && v !== undefined && v.toString().trim() !== '';

/**
 * Valida el formulario de producto antes de construir el payload.
 *
 * @param {object} formData - mismo objeto que se pasa a buildProductPayload.
 * @param {object} opts
 * @param {number} opts.effectiveRate - tasa activa (Bs por USD).
 * @param {Array}  opts.products - catálogo actual, para unicidad de código de barras.
 * @param {string|null} opts.editingId - id del producto que se está editando, o null si es alta.
 * @param {boolean} opts.allowNegativeStock - flag `allow_negative_stock` del sistema.
 * @returns {{ok: true} | {ok: false, field: string, message: string}}
 */
export function validateProductForm(formData, opts = {}) {
    const {
        effectiveRate = 0,
        products = [],
        editingId = null,
        allowNegativeStock = false,
    } = opts;

    const f = formData || {};

    // 1 — Nombre.
    if (!_isFilled(f.name)) {
        return { ok: false, field: 'name', message: 'El nombre del producto es obligatorio' };
    }

    // 2 — Signos negativos (INV-09).
    for (const [key, label] of NUMERIC_FIELDS) {
        if (!_isNegative(f[key])) continue;
        // Excepción: un producto puede quedar legítimamente en stock negativo
        // cuando el flag lo permite; rechazarlo lo volvería inmodificable.
        if (key === 'stock' && allowNegativeStock) continue;
        return { ok: false, field: key, message: `${label} no puede ser negativo` };
    }

    // 3 — Debe haber al menos un precio de venta.
    if (!_isFilled(f.priceUsd) && !_isFilled(f.priceBs) && !_isFilled(f.priceCop)) {
        return { ok: false, field: 'price', message: 'Debes indicar un precio de venta' };
    }

    // 4 — Tasa (INV-06 / D6). Solo se exige cuando el valor autoritativo en USD
    // tendría que derivarse desde bolívares. Con la tasa en 0, dividir por el
    // fallback 1 guardaría "500 Bs" como "$500".
    if (effectiveRate <= 0) {
        if (!_isFilled(f.priceUsd) && _isFilled(f.priceBs)) {
            return { ok: false, field: 'rate', message: 'No hay tasa válida: escribe el precio en $ o actualiza la tasa' };
        }
        if (!_isFilled(f.costUsd) && _isFilled(f.costBs)) {
            return { ok: false, field: 'rate', message: 'No hay tasa válida: escribe el costo en $ o actualiza la tasa' };
        }
    }

    // 5 — Doble precio (INV-10). Nunca degradar en silencio: la UI muestra
    // "ACTIVADO" y el usuario debe enterarse de que falta el precio de referencia.
    if (f.pricingMode === 'dual_usd') {
        const ref = CurrencyService.safeParse(f.priceBsUsdRef);
        if (!_isFilled(f.priceBsUsdRef) || ref <= 0) {
            return {
                ok: false,
                field: 'priceBsUsdRef',
                message: 'Activaste el doble precio: indica el Precio Ref. en $ para pagos en Bolívares',
            };
        }
    }

    // 6 — Código de barras único (INV-08). El escáner resuelve con el primer
    // match del arreglo, así que un duplicado secuestra en silencio los escaneos
    // del producto original.
    const bc = _isFilled(f.barcode) ? f.barcode.toString().trim() : '';
    if (bc) {
        const clash = (products || []).find(
            (p) => p && p.id !== editingId && p.barcode && p.barcode.toString().trim() === bc
        );
        if (clash) {
            return {
                ok: false,
                field: 'barcode',
                message: `El código ${bc} ya lo usa "${clash.name || 'otro producto'}"`,
            };
        }
    }

    return { ok: true };
}

export function buildProductPayload(formData, effectiveRate) {
```

**Verificación:**
```bash
echo -n "2b post: "; grep -cF "export function validateProductForm(formData, opts = {}) {" src/utils/productProcessor.js
echo -n "2b intacta: "; grep -cF "export function buildProductPayload(formData, effectiveRate) {" src/utils/productProcessor.js
```
**Esperado: `1` y `1`.**

## 2.c — Corregir el comentario mentiroso del fallback de tasa

```bash
echo -n "2c: "; grep -cF "    // FIN-022-pattern: validar tasa antes de usarla (sin fallback silencioso a 1)." src/utils/productProcessor.js
```
**Esperado: `1`.**

Reemplaza:
```js
    // FIN-022-pattern: validar tasa antes de usarla (sin fallback silencioso a 1).
    const safeRate = effectiveRate > 0 ? effectiveRate : 1;
```
por:
```js
    // INV-06: el fallback a 1 SÍ es silencioso — el comentario anterior afirmaba
    // lo contrario. Se conserva a propósito como red de seguridad para
    // `RemoteProductFormModal`, que no pasa por `validateProductForm`; borrarlo
    // haría que divida por 0. Desde la UI de inventario ya es inalcanzable en la
    // dirección peligrosa (Bs → USD) porque el validador rechaza ese caso (D6).
    const safeRate = effectiveRate > 0 ? effectiveRate : 1;
```

## 2.d — Stock fraccionario y bultos coherentes (INV-05 + INV-16)

```bash
echo -n "2d: "; grep -cF "    let finalStock = stock ? parseInt(stock, 10) : 0;" src/utils/productProcessor.js
```
**Esperado: `1`.**

Reemplaza este bloque completo:
```js
    // Stock: for lote, convert lotes → units
    let finalStock = stock ? parseInt(stock, 10) : 0;
    if (isLote && stockInLotes && parsedUnitsPerPkg > 0) {
        finalStock = Math.round(parseFloat(stockInLotes) * parsedUnitsPerPkg);
    }
```
por:
```js
    // Stock: for lote, convert lotes → units
    // INV-05: el stock SÍ puede ser fraccionario. `checkoutProcessor` descuenta
    // `divR(qty, unitsPerPackage)` al vender unidades sueltas de un bulto, y
    // `item.qty` fraccionario al vender por peso. `parseInt` truncaba 12.875 → 12
    // en CADA edición del producto, perdiendo mercancía en silencio.
    let finalStock = stock ? round3(CurrencyService.safeParse(stock)) : 0;
    // INV-16: los bultos se redondean UNA vez y ese mismo valor se usa tanto para
    // derivar las unidades como para guardarse, de modo que siempre valga
    // `stock === stockInLotes * unitsPerPackage`. Antes se leía con parseFloat
    // para derivar y con parseInt para guardar, y los dos campos se contradecían.
    const parsedStockInLotes = stockInLotes ? round3(CurrencyService.safeParse(stockInLotes)) : null;
    if (isLote && parsedStockInLotes !== null && parsedUnitsPerPkg > 0) {
        finalStock = round3(parsedStockInLotes * parsedUnitsPerPkg);
    }
```

## 2.e — Persistir `costCop` (INV-24)

Dos ediciones pequeñas.

**2.e.1 — añadir `costCop` al destructuring.**

```bash
echo -n "2e1: "; grep -cF "        costUsd,
        costBs,
        stock," src/utils/productProcessor.js
```
**Esperado: `1`.**

Reemplaza:
```js
        costUsd,
        costBs,
        stock,
```
por:
```js
        costUsd,
        costBs,
        costCop,
        stock,
```

**2.e.2 — calcular y devolver `costCop`.**

```bash
echo -n "2e2: "; grep -cF "    const finalPriceCop = priceCop && CurrencyService.safeParse(priceCop) > 0 ? round2(CurrencyService.safeParse(priceCop)) : null;" src/utils/productProcessor.js
```
**Esperado: `1`.**

Reemplaza esa línea por:
```js
    const finalPriceCop = priceCop && CurrencyService.safeParse(priceCop) > 0 ? round2(CurrencyService.safeParse(priceCop)) : null;
    // INV-24: guardar el costo en COP que escribió el usuario. Antes no se
    // persistía y se re-derivaba como `costUsd × tasaCop` en cada edición, así que
    // el costo de adquisición nunca era el que se tecleó.
    const finalCostCop = costCop && CurrencyService.safeParse(costCop) > 0 ? round2(CurrencyService.safeParse(costCop)) : null;
```

Y en el objeto de retorno:

```bash
echo -n "2e3: "; grep -cF "        costBs: finalCostBs," src/utils/productProcessor.js
```
**Esperado: `1`.**

Reemplaza:
```js
        costBs: finalCostBs,
```
por:
```js
        costBs: finalCostBs,
        costCop: finalCostCop,
```

## 2.f — Blindar `stockInLotes` y `lowStockAlert` en el retorno

```bash
echo -n "2f1: "; grep -cF "        stockInLotes: isLote && stockInLotes ? parseInt(stockInLotes) : null," src/utils/productProcessor.js
echo -n "2f2: "; grep -cF "        lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : 5," src/utils/productProcessor.js
```
**Esperado: `1` y `1`.**

Reemplaza:
```js
        stockInLotes: isLote && stockInLotes ? parseInt(stockInLotes) : null,
```
por:
```js
        // INV-16: mismo valor redondeado que se usó para derivar `stock`.
        stockInLotes: isLote && parsedStockInLotes !== null ? parsedStockInLotes : null,
```

Y reemplaza:
```js
        lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : 5,
```
por:
```js
        // INV-09: red defensiva para el formulario remoto, que no valida. Una
        // alerta negativa hace que `stock <= lowStockAlert` sea falso SIEMPRE, y
        // el producto nunca aparece en "bajo stock" ni estando en 0.
        lowStockAlert: lowStockAlert ? Math.max(0, parseInt(lowStockAlert) || 0) : 5,
```

## 2.g — Verificar FASE 2

```bash
npx vitest run tests/inventory.test.js 2>&1 | tail -20
```

**Esperado: los 39 tests pasan.** Esta fase, sola, debe poner en verde todo `tests/inventory.test.js`.

**Si queda algún fallo, lee el diff del test que falla y arregla `productProcessor.js`, NO el test** (G6 solo protege los tests preexistentes, pero `tests/inventory.test.js` es la especificación de esta fase: si falla, el código está mal, no la expectativa).

```bash
npm test 2>&1 | tail -12
```

**Esperado: `180 passed | 10 skipped` (141 previos + 39 nuevos), 11 archivos de tests pasan de 12.** El `1 error` del worker puede seguir apareciendo (§2.7).

**Si algún test PREEXISTENTE se rompió: DETENTE.** Significa que `buildProductPayload` cambió de comportamiento en algo que otro módulo daba por sentado.

---

# ✅ CHECKPOINT 1 — commit intermedio

```bash
git add src/utils/productProcessor.js tests/inventory.test.js
git status --short
```

**Esperado: exactamente esos 2 archivos en staging, nada más.**

```bash
git commit -m "fix(inventario): normalizacion de producto - stock fraccionario, bultos coherentes, costo COP persistido y validador puro de entrada

- INV-05: el stock deja de truncarse con parseInt; pasa a round3. Vender por
  peso o por unidad suelta de un bulto deja stock fraccionario y cada edicion
  del producto lo redondeaba hacia abajo, perdiendo mercancia en silencio.
- INV-16: stockInLotes se redondea una sola vez y ese mismo valor deriva las
  unidades, para que stock === stockInLotes * unitsPerPackage siempre.
- INV-24: se persiste costCop en vez de re-derivarlo con la tasa del dia.
- INV-09/06/10/08: nuevo validateProductForm (funcion pura exportada) que
  rechaza signos negativos leyendo la cadena cruda, precio en Bs sin tasa
  valida, dual_usd sin precio de referencia y codigo de barras duplicado.
- INV-06: corregido el comentario que afirmaba no hacer fallback silencioso
  de la tasa a 1, cuando era exactamente lo que hacia.
- INV-28: primer archivo de tests del subsistema (39 casos).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

El validador ya existe y está probado, pero **todavía nadie lo llama**. Eso se conecta en FASE 3.

---

# FASE 3 — Conectar el validador en `ProductsView.jsx` (INV-08, INV-09, INV-06, INV-10, INV-24)

Dos ediciones. Sin esta fase, la FASE 2 no protege nada desde la UI.

## 3.a — Ampliar el import

```bash
echo -n "3a: "; grep -cF "import { buildProductPayload } from '../utils/productProcessor';" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
import { buildProductPayload } from '../utils/productProcessor';
```
por:
```js
import { buildProductPayload, validateProductForm } from '../utils/productProcessor';
```

## 3.b — Reescribir `handleSave`

```bash
echo -n "3b: "; grep -cF "        if (!name || (!priceUsd && !priceBs)) {" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza este bloque completo:
```js
    const handleSave = () => {
        triggerHaptic && triggerHaptic();
        if (!name || (!priceUsd && !priceBs)) {
            setIsFormShaking(true);
            setTimeout(() => setIsFormShaking(false), 500);
            return showToast('Nombre y precio requeridos', 'warning');
        }

        const productData = buildProductPayload({
            name, barcode, priceUsd, priceBs, pricingMode, priceBsUsdRef, priceCop, costUsd, costBs, stock, stockInLotes,
            packagingType, unitsPerPackage, granelUnit, sellByUnit, unitPriceUsd, unitPriceCop,
            category, lowStockAlert
        }, effectiveRate);
```
por:
```js
    const handleSave = () => {
        triggerHaptic && triggerHaptic();

        // Un único objeto de formulario: se usa tanto para validar como para
        // construir el payload, así no pueden divergir.
        // INV-24: `costCop` ahora también viaja (antes se quedaba en el estado
        // local de la vista y nunca se persistía).
        const formData = {
            name, barcode, priceUsd, priceBs, pricingMode, priceBsUsdRef, priceCop,
            costUsd, costBs, costCop, stock, stockInLotes,
            packagingType, unitsPerPackage, granelUnit, sellByUnit, unitPriceUsd, unitPriceCop,
            category, lowStockAlert
        };

        // INV-08 / INV-09 / INV-06 / INV-10: la puerta de validación está aquí
        // porque `buildProductPayload` no puede rechazar nada (D2: mantiene su
        // firma por el formulario remoto). El mensaje viene del validador, que ya
        // sabe qué campo falló.
        const check = validateProductForm(formData, {
            effectiveRate,
            products,
            editingId,
            allowNegativeStock: localStorage.getItem('allow_negative_stock') === 'true',
        });
        if (!check.ok) {
            setIsFormShaking(true);
            setTimeout(() => setIsFormShaking(false), 500);
            return showToast(check.message, 'warning');
        }

        const productData = buildProductPayload(formData, effectiveRate);
```

> No toques el resto de `handleSave` (el bloque de `highPriceConfirm` y el `_commitSave(productData)` final quedan tal cual).

## 3.c — Verificar FASE 3

```bash
echo -n "3c1 validador conectado: "; grep -cF "        const check = validateProductForm(formData, {" src/views/ProductsView.jsx
echo -n "3c2 vieja validacion eliminada: "; grep -cF "        if (!name || (!priceUsd && !priceBs)) {" src/views/ProductsView.jsx
echo -n "3c3 costCop viaja: "; grep -cF "            costUsd, costBs, costCop, stock, stockInLotes," src/views/ProductsView.jsx
npx vite build --mode development 2>&1 | tail -5
```

**Esperado: `1`, `0`, `1`, y el build termina sin errores.**

---

# FASE 4 — Escrituras del catálogo bajo lock (INV-02, INV-04)

**Esta es la fase que evita pérdida de dinero.** Tres bloques de `ProductsView.jsx` que hoy escriben el catálogo desde un snapshot obsoleto, sin lock.

El patrón es siempre el mismo, y es el que ya usan `checkoutProcessor.js:180` y `useRemoteCommands.js:60`:

```
withLock('pos_write_lock', async () => {
    releer fresco desde storageService
    aplicar el cambio sobre lo fresco
    escribir
    devolver el resultado
})
```

## 4.a — Añadir los dos imports que faltan

```bash
echo -n "4a: "; grep -cF "import { useReveal } from '../hooks/useReveal';" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
import { useReveal } from '../hooks/useReveal';
```
por:
```js
import { useReveal } from '../hooks/useReveal';
// INV-02 / INV-04: exclusión mutua y relectura fresca en toda escritura del catálogo.
import { withLock } from '../utils/withLock';
import { round3 } from '../utils/dinero';
```

## 4.b — Reescribir el envoltorio `adjustStock` (INV-02 + INV-14/D8)

```bash
echo -n "4b: "; grep -cF "    const adjustStock = async (productId, delta) => {" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza este bloque completo:
```js
    // Envolver adjustStock para incluir registro de movimiento + haptic
    const adjustStock = async (productId, delta) => {
        baseAdjustStock(productId, delta);
        triggerHaptic && triggerHaptic();

        // Registro silencioso del ajuste de inventario
        try {
            const product = products.find(p => p.id === productId);
            const record = {
                id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                timestamp: new Date().toISOString(),
                tipo: delta > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
                items: [{ id: productId, name: product?.name || 'Producto', qty: Math.abs(delta) }],
                totalUsd: 0,
                totalBs: 0,
                status: 'COMPLETADA',
            };
            const sales = await storageService.getItem('bodega_sales_v1', []);
            sales.push(record);
            await storageService.setItem('bodega_sales_v1', sales);
        } catch (e) { /* silencioso */ }
    }
```
por:
```js
    // Ajuste unitario de stock + registro del movimiento.
    //
    // INV-02: antes el registro hacía getItem → push → setItem sobre
    // `bodega_sales_v1` SIN tomar `pos_write_lock`. Como `checkoutProcessor` SÍ lo
    // toma, ajustar stock mientras se confirmaba una venta podía leer el historial
    // antes de que la venta se persistiera y reescribirlo después: la venta
    // desaparecía, y el `catch` silencioso no dejaba rastro.
    //
    // INV-14 / D8: el movimiento se registra con el delta EFECTIVO
    // (stockAfter − stockBefore), no con el solicitado. Pulsar "−" con el stock en
    // 0 escribía salidas de mercancía que nunca ocurrieron.
    const adjustStock = async (productId, delta) => {
        triggerHaptic && triggerHaptic();

        try {
            await withLock('pos_write_lock', async () => {
                const fresh = await storageService.getItem('bodega_products_v1', products);
                const base = Array.isArray(fresh) ? fresh : products;
                const target = base.find(p => p.id === productId);
                if (!target) return;

                const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                const stockBefore = round3(target.stock ?? 0);
                const raw = round3(stockBefore + delta);
                const stockAfter = allowNeg ? raw : Math.max(0, raw);
                const effectiveDelta = round3(stockAfter - stockBefore);

                // Nada cambió (recorte en 0): no se escribe ni se registra nada.
                if (effectiveDelta === 0) return;

                const nextProducts = base.map(p => (p.id === productId ? { ...p, stock: stockAfter } : p));
                await storageService.setItem('bodega_products_v1', nextProducts);
                setProducts(nextProducts);

                const record = {
                    id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    timestamp: new Date().toISOString(),
                    tipo: effectiveDelta > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
                    items: [{ id: productId, name: target.name || 'Producto', qty: Math.abs(effectiveDelta) }],
                    totalUsd: 0,
                    totalBs: 0,
                    status: 'COMPLETADA',
                };
                const sales = await storageService.getItem('bodega_sales_v1', []);
                await storageService.setItem('bodega_sales_v1', [...(Array.isArray(sales) ? sales : []), record]);
            });
        } catch (e) {
            console.error('[Inventario] Ajuste de stock fallido:', e);
            showToast('No se pudo ajustar el stock. Intenta de nuevo.', 'error');
        }
    }
```

## 4.c — Quitar el `baseAdjustStock` que quedó sin usar

El envoltorio nuevo ya no delega en el `adjustStock` del contexto.

```bash
echo -n "4c: "; grep -cF "        adjustStock: baseAdjustStock" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
        tasaCop,
        adjustStock: baseAdjustStock
    } = useProductContext();
```
por:
```js
        tasaCop
    } = useProductContext();
```

> ⚠️ Fíjate en la coma: `tasaCop,` pasa a ser `tasaCop` (sin coma final), porque ahora es la última propiedad del destructuring. Si dejas la coma, el build falla.

## 4.d — Reescribir el cuerpo de `_commitSave` (INV-04)

```bash
echo -n "4d: "; grep -cF "        // FIX-SAVE-001: Persistir INMEDIATAMENTE antes de cerrar el modal." src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza este bloque completo (desde `let updatedProducts;` hasta `handleClose();`):
```js
        let updatedProducts;
        if (editingId) {
            updatedProducts = products.map(p =>
                // FIX-IMAGE-001: `image || p.image` ignoraba el borrado explícito porque
                // "" (string vacío) es falsy en JS y caía al fallback con la foto vieja.
                // Ahora solo usamos la imagen previa si image es estrictamente `undefined`
                // (es decir, el campo nunca fue tocado en el formulario).
                p.id === editingId ? { ...p, ...productData, image: finalImage !== undefined ? finalImage : p.image } : p
            );
            auditLog('INVENTARIO', 'PRODUCTO_EDITADO', `Producto "${name}" editado`);
        } else {
            updatedProducts = [{
                id: productId,
                ...productData,
                image: finalImage,
                createdAt: new Date().toISOString()
            }, ...products];
            auditLog('INVENTARIO', 'PRODUCTO_CREADO', `Producto "${name}" creado - $${priceUsd || '0'}`);
        }

        // FIX-SAVE-001: Persistir INMEDIATAMENTE antes de cerrar el modal.
        // El debounce del useEffect en ProductContext puede ser cancelado por el
        // clearTimeout cuando handleClose() dispara un re-render antes de que el
        // timer de 1s se ejecute, haciendo que el guardado se pierda silenciosamente.
        storageService.setItem('bodega_products_v1', updatedProducts);

        setProducts(updatedProducts);
        handleClose();
    };
```
por:
```js
        // FIX-SAVE-001: persistir INMEDIATAMENTE, sin esperar el debounce de 1s de
        // ProductContext, que puede ser cancelado por el clearTimeout.
        //
        // INV-04: además hay que releer FRESCO dentro del lock. La lista `products`
        // de este closure es el snapshot del render en que se abrió el modal, y
        // entre ese momento y este punto pasó todo el tiempo que el usuario tardó
        // en llenar el formulario MÁS el await de subida de imagen. Escribir ese
        // snapshot revierte cualquier venta que haya descontado stock en la ventana:
        // el dueño edita un producto un minuto, el cajero vende 8 unidades, y al
        // guardar las 8 unidades reaparecen en el inventario.
        let committed = null;
        try {
            committed = await withLock('pos_write_lock', async () => {
                const fresh = await storageService.getItem('bodega_products_v1', products);
                const base = Array.isArray(fresh) ? fresh : products;

                const next = editingId
                    ? base.map(p =>
                        // FIX-IMAGE-001: `image || p.image` ignoraba el borrado explícito porque
                        // "" (string vacío) es falsy en JS y caía al fallback con la foto vieja.
                        // Ahora solo usamos la imagen previa si image es estrictamente `undefined`
                        // (es decir, el campo nunca fue tocado en el formulario).
                        p.id === editingId ? { ...p, ...productData, image: finalImage !== undefined ? finalImage : p.image } : p
                    )
                    : [{
                        id: productId,
                        ...productData,
                        image: finalImage,
                        createdAt: new Date().toISOString()
                    }, ...base];

                await storageService.setItem('bodega_products_v1', next);
                return next;
            });
        } catch (e) {
            // Incluye el caso del Circuit Breaker de storageService, que LANZA a propósito.
            console.error('[Inventario] Guardado bloqueado o fallido:', e);
        }

        if (committed) {
            setProducts(committed);
            // El log de auditoría se emite DESPUÉS de persistir: antes se escribía
            // aunque la escritura fallara, dejando un rastro de algo que no pasó.
            auditLog(
                'INVENTARIO',
                editingId ? 'PRODUCTO_EDITADO' : 'PRODUCTO_CREADO',
                editingId ? `Producto "${name}" editado` : `Producto "${name}" creado - $${priceUsd || '0'}`
            );
        } else {
            showToast('No se pudo guardar el producto. Intenta de nuevo.', 'error');
        }
        handleClose();
    };
```

## 4.e — Reescribir `confirmDelete` (INV-04)

```bash
echo -n "4e: "; grep -cF "    const confirmDelete = () => {" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza este bloque completo:
```js
    const confirmDelete = () => {
        if (deleteId) {
            const p = products.find(x => x.id === deleteId);
            auditLog('INVENTARIO', 'PRODUCTO_ELIMINADO', `Producto "${p?.name || '?'}" eliminado`);
            const updatedProducts = products.filter(prod => prod.id !== deleteId);
            storageService.setItem('bodega_products_v1', updatedProducts);
            setProducts(updatedProducts);
            setDeleteId(null);
            triggerHaptic && triggerHaptic();
        }
    };
```
por:
```js
    // INV-04: borrar desde el snapshot del render revertía las ventas confirmadas
    // mientras el modal de confirmación estaba abierto. Relectura fresca bajo lock.
    const confirmDelete = async () => {
        if (!deleteId) return;
        const p = products.find(x => x.id === deleteId);

        let committed = null;
        try {
            committed = await withLock('pos_write_lock', async () => {
                const fresh = await storageService.getItem('bodega_products_v1', products);
                const base = Array.isArray(fresh) ? fresh : products;
                const next = base.filter(prod => prod.id !== deleteId);
                await storageService.setItem('bodega_products_v1', next);
                return next;
            });
        } catch (e) {
            console.error('[Inventario] Borrado bloqueado o fallido:', e);
        }

        if (committed) {
            setProducts(committed);
            auditLog('INVENTARIO', 'PRODUCTO_ELIMINADO', `Producto "${p?.name || '?'}" eliminado`);
        } else {
            showToast('No se pudo eliminar el producto. Intenta de nuevo.', 'error');
        }
        setDeleteId(null);
        triggerHaptic && triggerHaptic();
    };
```

## 4.f — Verificar FASE 4

```bash
echo -n "4f1 withLock presente: "; grep -cF "withLock('pos_write_lock'" src/views/ProductsView.jsx
echo -n "4f2 baseAdjustStock eliminado: "; grep -cF "baseAdjustStock" src/views/ProductsView.jsx
echo -n "4f3 sin escrituras sueltas del catalogo: "; grep -cF "        storageService.setItem('bodega_products_v1', updatedProducts);" src/views/ProductsView.jsx
echo -n "4f4 delta efectivo: "; grep -cF "                const effectiveDelta = round3(stockAfter - stockBefore);" src/views/ProductsView.jsx
npx vite build --mode development 2>&1 | tail -5
```

**Esperado: `3`, `0`, `0`, `1`, y el build sin errores.**

> `4f1 = 3` corresponde a los tres bloques: `adjustStock`, `_commitSave` y `confirmDelete`.
> Si `4f3` no es `0`, quedó una escritura del catálogo fuera del lock: busca cuál y reporta antes de seguir.

```bash
npm test 2>&1 | tail -12
```

**Esperado: sigue en `180 passed | 10 skipped`.** Ningún test cubre `ProductsView` (no hay `@testing-library`), así que la suite no debe moverse. Si se movió, algo más se rompió.

---

# FASE 5 — `ProductContext.adjustStock` (INV-02, INV-14)

Desde FASE 4, `ProductsView` ya no usa esta función. **Se blinda igual** porque sigue exportada en el contexto y cualquier consumidor futuro la daría por segura.

## 5.a — Imports

```bash
echo -n "5a: "; grep -cF "import { storageService } from '../utils/storageService';" src/context/ProductContext.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
import { storageService } from '../utils/storageService';
```
por:
```js
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { round3 } from '../utils/dinero';
```

## 5.b — Reescribir `adjustStock`

```bash
echo -n "5b: "; grep -cF "    const adjustStock = useCallback((productId, delta) => {" src/context/ProductContext.jsx
```
**Esperado: `1`.**

Reemplaza este bloque completo:
```js
    const adjustStock = useCallback((productId, delta) => {
        setProducts(prevProducts => {
            const updated = prevProducts.map(p => {
                if (p.id === productId) {
                    const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                    const newStock = (p.stock ?? 0) + delta;
                    return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
                }
                return p;
            });
            storageService.setItem('bodega_products_v1', updated);
            return updated;
        });
    }, []);
```
por:
```js
    // INV-14: el `storageService.setItem` vivía DENTRO del updater de `setState`.
    // React puede invocar un updater más de una vez (StrictMode en desarrollo,
    // reintentos de render concurrente) y cada invocación disparaba otra escritura
    // del catálogo completo.
    //
    // INV-02: además escribía sin `pos_write_lock`, así que podía pisar el descuento
    // de stock de una venta que se estuviera confirmando en `checkoutProcessor`.
    //
    // Desde FASE 4, `ProductsView` usa su propio envoltorio (con registro de
    // movimiento). Esta función se conserva porque sigue exportada en el contexto.
    const adjustStock = useCallback(async (productId, delta) => {
        try {
            await withLock('pos_write_lock', async () => {
                const fresh = await storageService.getItem('bodega_products_v1', productsRef.current);
                const base = Array.isArray(fresh) ? fresh : productsRef.current;
                const target = base.find(p => p.id === productId);
                if (!target) return;

                const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                const stockBefore = round3(target.stock ?? 0);
                const raw = round3(stockBefore + delta);
                const stockAfter = allowNeg ? raw : Math.max(0, raw);
                if (stockAfter === stockBefore) return;

                const next = base.map(p => (p.id === productId ? { ...p, stock: stockAfter } : p));
                await storageService.setItem('bodega_products_v1', next);
                setProducts(next);
            });
        } catch (e) {
            console.error('[ProductContext] adjustStock falló:', e);
        }
    }, []);
```

> `productsRef` ya existe en este archivo (se declara en `:57` y se mantiene sincronizado por el efecto de `:58-60`). Se usa en vez de `products` para que el `useCallback` con dependencias `[]` no lea un valor congelado.

## 5.c — Verificar FASE 5

```bash
echo -n "5c1: "; grep -cF "withLock('pos_write_lock'" src/context/ProductContext.jsx
echo -n "5c2 sin setItem en el updater: "; grep -cF "            storageService.setItem('bodega_products_v1', updated);" src/context/ProductContext.jsx
npx vite build --mode development 2>&1 | tail -5
```
**Esperado: `1`, `0`, build sin errores.**

---

# FASE 6 — Migración de imágenes sin revertir el catálogo (INV-03)

Una sola edición, pero es la que evita que se pierdan ventas enteras en la ventana de subida.

```bash
echo -n "6a: "; grep -cF "                const res = await migrateProductImagesToStorage(current, async (out) => {" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza este bloque:
```js
                const res = await migrateProductImagesToStorage(current, async (out) => {
                    await storageService.setItem('bodega_products_v1', out);
                    if (!cancelled) setProducts(out);
                });

                if (res.failed === 0) {
                    localStorage.setItem('pda_images_migrated_v1', 'true');
                }
```
por:
```js
                const res = await migrateProductImagesToStorage(current, async (out) => {
                    // INV-03: `out` deriva del snapshot `current`, capturado ANTES del
                    // bucle de subidas — que es secuencial y por red (decenas de
                    // segundos con muchas imágenes). Escribirlo entero revertía toda
                    // venta, alta, edición o ajuste ocurrido en esa ventana.
                    //
                    // Se fusiona ÚNICAMENTE el campo `image` de los productos que
                    // realmente se migraron (tenían base64 antes y cambiaron), sobre
                    // el catálogo fresco y bajo lock.
                    const previas = new Map((current || []).map(p => [p?.id, p?.image]));
                    const nuevasImagenes = new Map();
                    (out || []).forEach(p => {
                        if (!p) return;
                        const antes = previas.get(p.id);
                        if (typeof antes === 'string' && antes.startsWith('data:') && p.image !== antes) {
                            nuevasImagenes.set(p.id, p.image);
                        }
                    });
                    if (nuevasImagenes.size === 0) return;

                    const merged = await withLock('pos_write_lock', async () => {
                        const frescos = await storageService.getItem('bodega_products_v1', []);
                        const base = Array.isArray(frescos) && frescos.length ? frescos : out;
                        const next = base.map(p =>
                            nuevasImagenes.has(p.id) ? { ...p, image: nuevasImagenes.get(p.id) } : p
                        );
                        await storageService.setItem('bodega_products_v1', next);
                        return next;
                    });
                    if (!cancelled && merged) setProducts(merged);
                });

                if (res.failed === 0) {
                    localStorage.setItem('pda_images_migrated_v1', 'true');
                    localStorage.removeItem('pda_images_migrate_tries');
                } else {
                    // INV-03: sin este tope, un upload que falla siempre (imagen
                    // corrupta, cuota de Storage agotada, offline intermitente)
                    // relanza la migración COMPLETA 4 s después de cada montaje de
                    // esta vista, en cada sesión, indefinidamente.
                    const intentos = (parseInt(localStorage.getItem('pda_images_migrate_tries') || '0', 10) || 0) + 1;
                    localStorage.setItem('pda_images_migrate_tries', String(intentos));
                    if (intentos >= 5) {
                        localStorage.setItem('pda_images_migrated_v1', 'true');
                        console.warn('[Inventario] Migración de imágenes abandonada tras 5 intentos; los base64 restantes se conservan.');
                    }
                }
```

**Verificación:**
```bash
echo -n "6b merge por id: "; grep -cF "                        const next = base.map(p =>" src/views/ProductsView.jsx
echo -n "6c tope de reintentos: "; grep -cF "pda_images_migrate_tries" src/views/ProductsView.jsx
echo -n "6d sin escritura del snapshot: "; grep -cF "                    await storageService.setItem('bodega_products_v1', out);" src/views/ProductsView.jsx
npx vite build --mode development 2>&1 | tail -5
```
**Esperado: `1`, `3`, `0`, build sin errores.**

---

# ✅ CHECKPOINT 2 — commit intermedio

```bash
npm test 2>&1 | tail -12
git add src/views/ProductsView.jsx src/context/ProductContext.jsx
git status --short
```

**Esperado:** `180 passed | 10 skipped`, y exactamente esos 2 archivos en staging.

```bash
git commit -m "fix(inventario): integridad de escritura del catalogo bajo pos_write_lock

- INV-02: adjustStock hacia getItem/push/setItem sobre bodega_sales_v1 SIN
  tomar pos_write_lock. Como checkoutProcessor si lo toma, ajustar stock
  mientras se confirmaba una venta podia borrar esa venta del historial, y el
  catch silencioso no dejaba rastro. Ahora todo ocurre dentro del lock.
- INV-04: _commitSave y confirmDelete reescribian el catalogo entero desde el
  snapshot del render en que se abrio el modal, revirtiendo las ventas que
  descontaron stock mientras el formulario estaba abierto. Ahora releen fresco
  dentro del lock y aplican el cambio sobre lo fresco.
- INV-03: la migracion de imagenes escribia el snapshot previo al bucle de
  subidas (decenas de segundos por red). Ahora fusiona solo el campo image de
  los productos migrados sobre el catalogo fresco, y deja de reintentar
  indefinidamente cuando un upload falla siempre.
- INV-14: el delta que se registra en el historial es el efectivo, no el
  solicitado; pulsar - con stock en 0 escribia salidas ficticias. Ademas se
  saco el setItem de dentro del updater de setState.
- INV-08/09/06/10/24: handleSave ahora llama a validateProductForm y hace
  viajar costCop hasta el payload.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# FASE 7 — Ajuste masivo de precios que sí cambia el precio (INV-01, INV-21)

## 7.a — Añadir el import de `dinero.js`

```bash
echo -n "7a: "; grep -cF "import { logEvent } from '../../services/auditService';" src/components/Products/BulkPriceAdjustModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
import { logEvent } from '../../services/auditService';
```
por:
```js
import { logEvent } from '../../services/auditService';
import { round4 } from '../../utils/dinero';
```

## 7.b — Escalar TODOS los campos de precio

```bash
echo -n "7b: "; grep -cF "                    const newPrice = Math.max(0.01, (p.priceUsdt || 0) * multiplier);" src/components/Products/BulkPriceAdjustModal.jsx
```
**Esperado: `1`.**

Reemplaza este bloque:
```js
                    const newPrice = Math.max(0.01, (p.priceUsdt || 0) * multiplier);
                    const updated = { ...p, priceUsdt: parseFloat(newPrice.toFixed(4)) };

                    // Also adjust unitPriceUsd if it exists
                    if (p.unitPriceUsd && p.unitPriceUsd > 0) {
                        updated.unitPriceUsd = parseFloat((p.unitPriceUsd * multiplier).toFixed(4));
                    }

                    return updated;
```
por:
```js
                    // INV-01: `priceCop` MANDA sobre `priceUsdt` en todos los lectores
                    // (calculatorUtils.getUsd / getCop, y SalesView.addToCart), y
                    // `priceBsUsdRef` manda para los pagos en Bs (resolveDualPrice).
                    // Escalar solo `priceUsdt` dejaba intacto el precio realmente
                    // cobrado: el aumento no existía más que en el toast de éxito.
                    const escalar = (v, minimo) => {
                        const n = Number(v);
                        if (!Number.isFinite(n) || n <= 0) return null;
                        return Math.max(minimo, round4(n * multiplier));
                    };

                    const updated = { ...p };

                    const nuevoUsd = Math.max(0.01, round4((p.priceUsdt || 0) * multiplier));
                    updated.priceUsdt = nuevoUsd;
                    // FIN-030: mantener el alias sincronizado con el valor canónico.
                    updated.priceUsd = nuevoUsd;

                    const nuevoUnit = escalar(p.unitPriceUsd, 0.01);
                    if (nuevoUnit !== null) updated.unitPriceUsd = nuevoUnit;

                    // COP es entero por convención del sistema.
                    const nuevoCop = escalar(p.priceCop, 1);
                    if (nuevoCop !== null) updated.priceCop = Math.round(nuevoCop);

                    const nuevoUnitCop = escalar(p.unitPriceCop, 1);
                    if (nuevoUnitCop !== null) updated.unitPriceCop = Math.round(nuevoUnitCop);

                    const nuevoRef = escalar(p.priceBsUsdRef, 0.01);
                    if (nuevoRef !== null) updated.priceBsUsdRef = nuevoRef;

                    return updated;
```

## 7.c — Doble toque antes de aplicar (INV-21)

```bash
echo -n "7c1: "; grep -cF "    const [showSuccess, setShowSuccess] = useState(false);" src/components/Products/BulkPriceAdjustModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
    const [showSuccess, setShowSuccess] = useState(false);
```
por:
```js
    const [showSuccess, setShowSuccess] = useState(false);
    // INV-21: mutación irreversible de TODOS los precios, y el ámbito por defecto
    // es el catálogo completo. Mismo patrón de doble toque que StockBatchModal.
    const [showConfirm, setShowConfirm] = useState(false);
```

```bash
echo -n "7c2: "; grep -cF "        if (affectedProducts.length === 0) return;
        triggerHaptic && triggerHaptic();
        setIsApplying(true);" src/components/Products/BulkPriceAdjustModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
        if (affectedProducts.length === 0) return;
        triggerHaptic && triggerHaptic();
        setIsApplying(true);
```
por:
```js
        if (affectedProducts.length === 0) return;
        triggerHaptic && triggerHaptic();
        // INV-21: primer toque arma, segundo ejecuta. No hay deshacer.
        if (!showConfirm) {
            setShowConfirm(true);
            return;
        }
        setIsApplying(true);
```

Ahora el botón debe decir qué va a pasar. Verifica y reemplaza su etiqueta:

```bash
echo -n "7c3: "; grep -cF "                                Aplicar {isUp ? '+' : '-'}{percent}% ({affectedProducts.length})" src/components/Products/BulkPriceAdjustModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
                                Aplicar {isUp ? '+' : '-'}{percent}% ({affectedProducts.length})
```
por:
```js
                                {showConfirm
                                    ? `Confirmar: sí, cambiar ${affectedProducts.length} precios`
                                    : `Aplicar ${isUp ? '+' : '-'}${percent}% (${affectedProducts.length})`}
```

Y hay que resetear el estado al cerrar:

```bash
echo -n "7c4: "; grep -cF "        setIsApplying(false);
        setShowSuccess(false);
        onClose();" src/components/Products/BulkPriceAdjustModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
        setIsApplying(false);
        setShowSuccess(false);
        onClose();
```
por:
```js
        setIsApplying(false);
        setShowSuccess(false);
        setShowConfirm(false);
        onClose();
```

## 7.d — Verificar FASE 7

```bash
echo -n "7d1 priceCop escalado: "; grep -cF "                    const nuevoCop = escalar(p.priceCop, 1);" src/components/Products/BulkPriceAdjustModal.jsx
echo -n "7d2 priceBsUsdRef escalado: "; grep -cF "                    const nuevoRef = escalar(p.priceBsUsdRef, 0.01);" src/components/Products/BulkPriceAdjustModal.jsx
echo -n "7d3 alias sincronizado: "; grep -cF "                    updated.priceUsd = nuevoUsd;" src/components/Products/BulkPriceAdjustModal.jsx
echo -n "7d4 doble toque: "; grep -cF "        if (!showConfirm) {" src/components/Products/BulkPriceAdjustModal.jsx
npx vite build --mode development 2>&1 | tail -5
```
**Esperado: `1`, `1`, `1`, `1`, build sin errores.**

---

# FASE 8 — Corrección COP→USD completa y persistente (INV-15, INV-25)

## 8.a — No marcar como error lo que ya está bien

```bash
echo -n "8a: "; grep -cF "        return products.filter(p => p.priceUsdt >= 500);" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
        // Products with priceUsdt >= 500 are likely COP values stored as USD
        return products.filter(p => p.priceUsdt >= 500);
```
por:
```js
        // Products with priceUsdt >= 500 are likely COP values stored as USD.
        // INV-15/INV-25: un producto con `priceCop` válido ya deriva su USD
        // correctamente vía `getUsd`, así que su `priceUsdt` alto NO es un error de
        // moneda. Excluirlo evita "corregir" lo que ya está bien — y evita que la
        // corrección sea un no-op invisible, porque en esos productos el precio
        // cobrado sale de `priceCop`, no de `priceUsdt`.
        return products.filter(p => p.priceUsdt >= 500 && !(p.priceCop > 0));
```

## 8.b — Recordar el "Ignorar" entre sesiones

```bash
echo -n "8b: "; grep -cF "    const [copCorrectionDismissed, setCopCorrectionDismissed] = useState(false);" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
    const [copCorrectionDismissed, setCopCorrectionDismissed] = useState(false);
```
por:
```js
    // INV-25: antes era estado local, así que "Ignorar" duraba hasta el siguiente
    // montaje de la vista y el banner reaparecía indefinidamente.
    const [copCorrectionDismissed, setCopCorrectionDismissed] = useState(
        () => localStorage.getItem('cop_correction_dismissed_v1') === 'true'
    );
    const dismissCopCorrection = () => {
        localStorage.setItem('cop_correction_dismissed_v1', 'true');
        setCopCorrectionDismissed(true);
    };
```

Y el botón "Ignorar":

```bash
echo -n "8b2: "; grep -cF "                                    onClick={() => setCopCorrectionDismissed(true)}" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
                                    onClick={() => setCopCorrectionDismissed(true)}
```
por:
```js
                                    onClick={dismissCopCorrection}
```

## 8.c — Reescribir `handleFixCopPrices`

```bash
echo -n "8c: "; grep -cF "    const handleFixCopPrices = () => {" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza este bloque completo:
```js
    const handleFixCopPrices = () => {
        if (suspectCopProducts.length === 0 || !tasaCop || tasaCop <= 0) return;
        const idsToFix = new Set(suspectCopProducts.map(p => p.id));
        setProducts(prev =>
            prev.map(p => {
                if (!idsToFix.has(p.id)) return p;
                const correctedUsd = parseFloat((p.priceUsdt / tasaCop).toFixed(4));
                const updated = { ...p, priceUsdt: correctedUsd };
                if (p.unitPriceUsd && p.unitPriceUsd > 0) {
                    updated.unitPriceUsd = parseFloat((p.unitPriceUsd / tasaCop).toFixed(4));
                }
                if (p.costUsd && p.costUsd >= 500) {
                    updated.costUsd = parseFloat((p.costUsd / tasaCop).toFixed(4));
                    updated.costBs = parseFloat((updated.costUsd * effectiveRate).toFixed(2));
                }
                return updated;
            })
        );
        showToast(`${suspectCopProducts.length} productos corregidos: pesos → USD`, 'success');
        auditLog('INVENTARIO', 'CORRECCION_COP_A_USD', `Corregidos ${suspectCopProducts.length} productos de COP a USD con tasa ${tasaCop}`);
        setCopCorrectionDismissed(true);
    };
```
por:
```js
    // INV-15: la versión anterior corregía `priceUsdt` pero dejaba el alias
    // `priceUsd` (FIN-030) y `priceBsUsdRef` con el valor inflado, no persistía de
    // inmediato (dependía del debounce de 1 s de ProductContext) y usaba aritmética
    // cruda `parseFloat(x.toFixed(4))` en lugar de los helpers de dinero.js.
    const handleFixCopPrices = async () => {
        if (suspectCopProducts.length === 0 || !tasaCop || tasaCop <= 0) return;
        const idsToFix = new Set(suspectCopProducts.map(p => p.id));
        const total = suspectCopProducts.length;

        let committed = null;
        try {
            committed = await withLock('pos_write_lock', async () => {
                const fresh = await storageService.getItem('bodega_products_v1', products);
                const base = Array.isArray(fresh) ? fresh : products;

                const next = base.map(p => {
                    if (!idsToFix.has(p.id)) return p;

                    const correctedUsd = round4(divR(p.priceUsdt || 0, tasaCop));
                    const updated = { ...p, priceUsdt: correctedUsd, priceUsd: correctedUsd };

                    if (p.unitPriceUsd > 0) {
                        updated.unitPriceUsd = round4(divR(p.unitPriceUsd, tasaCop));
                    }
                    // El precio de referencia para pagos en Bs viene de la misma
                    // importación envenenada y hay que corregirlo con el mismo factor.
                    if (p.priceBsUsdRef > 0) {
                        updated.priceBsUsdRef = round4(divR(p.priceBsUsdRef, tasaCop));
                    }
                    if (p.costUsd >= 500) {
                        updated.costUsd = round4(divR(p.costUsd, tasaCop));
                        updated.costBs = mulR(updated.costUsd, effectiveRate);
                    }
                    return updated;
                });

                await storageService.setItem('bodega_products_v1', next);
                return next;
            });
        } catch (e) {
            console.error('[Inventario] Corrección COP→USD fallida:', e);
        }

        if (!committed) {
            showToast('No se pudo aplicar la corrección. Intenta de nuevo.', 'error');
            return;
        }

        setProducts(committed);
        showToast(`${total} productos corregidos: pesos → USD`, 'success');
        auditLog('INVENTARIO', 'CORRECCION_COP_A_USD', `Corregidos ${total} productos de COP a USD con tasa ${tasaCop}`);
        dismissCopCorrection();
    };
```

## 8.d — Ampliar el import de `dinero.js` en `ProductsView`

En FASE 4.a importaste `round3`. Ahora hacen falta tres más.

```bash
echo -n "8d: "; grep -cF "import { round3 } from '../utils/dinero';" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
import { round3 } from '../utils/dinero';
```
por:
```js
import { round3, round4, divR, mulR } from '../utils/dinero';
```

## 8.e — Verificar FASE 8

```bash
echo -n "8e1 alias corregido: "; grep -cF "                    const updated = { ...p, priceUsdt: correctedUsd, priceUsd: correctedUsd };" src/views/ProductsView.jsx
echo -n "8e2 ref corregido: "; grep -cF "                        updated.priceBsUsdRef = round4(divR(p.priceBsUsdRef, tasaCop));" src/views/ProductsView.jsx
echo -n "8e3 sin parseFloat/toFixed: "; grep -cF "parseFloat((p.priceUsdt / tasaCop).toFixed(4))" src/views/ProductsView.jsx
npx vite build --mode development 2>&1 | tail -5
```
**Esperado: `1`, `1`, `0`, build sin errores.**

---

# FASE 9 — Margen calculado en USD (INV-07)

Tres sitios calculan margen con la fórmula rota. Los tres pasan a USD.

## 9.a — `ProductCard.jsx`

```bash
echo -n "9a: "; grep -cF "    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;" src/components/Products/ProductCard.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;
```
por:
```js
    // INV-07: el margen se calcula en USD contra `costUsd`, no en Bs contra
    // `costBs`. `costBs` está CONGELADO al momento del guardado (costUsd × tasa de
    // ese día) mientras `valBs` sigue la tasa actual, así que el margen se inflaba
    // solo con que subiera la tasa: un producto de costo $1 y precio $1.50 guardado
    // con tasa 40 pasaba de mostrar 50% a mostrar 200% con tasa 80, mientras el
    // formulario del mismo producto seguía diciendo 50%.
    const margin = p.costUsd > 0 ? ((effectiveUsd - p.costUsd) / p.costUsd * 100) : null;
```

## 9.b — Vista de lista en `ProductsView.jsx`

```bash
echo -n "9b: "; grep -cF "                                    const valBs = p.priceUsdt * effectiveRate;" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
                                    const valBs = p.priceUsdt * effectiveRate;
                                    const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
                                    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;
```
por:
```js
                                    // INV-07: mismo criterio que ProductCard — el precio efectivo
                                    // sale de getUsd (respeta priceCop) y el margen se mide en USD.
                                    const usdEfectivo = getUsd(p, tasaCop);
                                    const valBs = usdEfectivo * effectiveRate;
                                    const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
                                    const margin = p.costUsd > 0 ? ((usdEfectivo - p.costUsd) / p.costUsd * 100) : null;
```

## 9.c — Orden por margen en `useProductFiltering.js`

```bash
echo -n "9c: "; grep -cF "                        valA = a.costBs > 0 ? ((a.priceUsdt * effectiveRate - a.costBs) / a.costBs * 100) : -999;" src/hooks/useProductFiltering.js
```
**Esperado: `1`.**

Reemplaza:
```js
                        valA = a.costBs > 0 ? ((a.priceUsdt * effectiveRate - a.costBs) / a.costBs * 100) : -999;
                        valB = b.costBs > 0 ? ((b.priceUsdt * effectiveRate - b.costBs) / b.costBs * 100) : -999;
```
por:
```js
                        // INV-07: ordenar por el margen real (USD), no por uno inflado
                        // por la tasa contra un costBs congelado.
                        valA = a.costUsd > 0 ? (((a.priceUsdt ?? a.priceUsd ?? 0) - a.costUsd) / a.costUsd * 100) : -999;
                        valB = b.costUsd > 0 ? (((b.priceUsdt ?? b.priceUsd ?? 0) - b.costUsd) / b.costUsd * 100) : -999;
```

## 9.d — Verificar FASE 9

```bash
echo -n "9d1 sin margen sobre costBs: "; grep -cF "/ p.costBs * 100" src/components/Products/ProductCard.jsx src/views/ProductsView.jsx
echo -n "9d2 sin margen sobre costBs en el orden: "; grep -cF "a.costBs > 0" src/hooks/useProductFiltering.js
npx vite build --mode development 2>&1 | tail -5
```
**Esperado: `0` (dos veces, una por archivo) y `0`, build sin errores.**

---

# FASE 10 — Consumir el flag de borrado total (INV-11)

```bash
echo -n "10a: "; grep -cF "                                localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
                                localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');
                                setProducts([]);
                                storageService.removeItem('bodega_products_v1');
```
por:
```js
                                // INV-11: el flag SOLO lo consume `storageService.setItem`
                                // (storageService.js:104). Este borrado va por `removeItem`,
                                // que no pasa por el Circuit Breaker, así que el flag quedaba
                                // encendido PARA SIEMPRE: la siguiente sobrescritura anómala
                                // del catálogo (sync parcial, restauración incompleta, bug que
                                // produzca un arreglo de 2 sobre 500) pasaba sin bloqueo ni
                                // modal de advertencia. Hay que limpiarlo a mano.
                                localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');
                                setProducts([]);
                                storageService.removeItem('bodega_products_v1');
                                localStorage.removeItem('confirm_bulk_delete_catalog_flag');
```

**Verificación:**
```bash
echo -n "10b: "; grep -cF "                                localStorage.removeItem('confirm_bulk_delete_catalog_flag');" src/views/ProductsView.jsx
```
**Esperado: `1`.**

---

# FASE 11 — Ajuste masivo de stock: motivo, auditoría y tope (INV-12, INV-22)

## 11.a — Aceptar el motivo en el envoltorio `adjustStock`

```bash
echo -n "11a: "; grep -cF "    const adjustStock = async (productId, delta) => {" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
    const adjustStock = async (productId, delta) => {
```
por:
```js
    const adjustStock = async (productId, delta, motivo = null) => {
```

Y en el registro del movimiento:

```bash
echo -n "11a2: "; grep -cF "                    status: 'COMPLETADA'," src/views/ProductsView.jsx
```
**Esperado: `1`.**

> ⚠️ Fíjate en la sangría: son **20 espacios**. Esta línea tenía 16 en el archivo original y pasó a 20 al reescribirse el bloque en FASE 4.b. Si este `grep` devuelve `0`, es señal de que **no ejecutaste FASE 4** — vuelve atrás, no edites a mano.

Reemplaza:
```js
                    status: 'COMPLETADA',
                };
```
por:
```js
                    status: 'COMPLETADA',
                    // INV-12/D11: el motivo del egreso es obligatorio en la UI y se
                    // descartaba. Es justo el dato que hace falta al cuadrar faltantes.
                    motivo: motivo || null,
                };
```

## 11.b — Imports en `StockBatchModal.jsx`

```bash
echo -n "11b: "; grep -cF "import { storageService } from '../../utils/storageService';" src/components/Products/StockBatchModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
import { storageService } from '../../utils/storageService';
```
por:
```js
import { storageService } from '../../utils/storageService';
import { logEvent } from '../../services/auditService';
import { useAuthStore } from '../../hooks/store/useAuthStore';
```

## 11.c — Bloquear el egreso que supera la existencia

```bash
echo -n "11c: "; grep -cF "        if (needsNote) {" src/components/Products/StockBatchModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
        if (needsNote) {
            showToast('Escribe un motivo para el egreso', 'error');
            triggerHaptic && triggerHaptic();
            return;
        }
```
por:
```js
        if (needsNote) {
            showToast('Escribe un motivo para el egreso', 'error');
            triggerHaptic && triggerHaptic();
            return;
        }
        // INV-22: un egreso mayor que la existencia se recortaba a 0 en silencio
        // y quedaba registrado con la cantidad PEDIDA, no con la aplicada.
        if (direction === 'egreso' && localStorage.getItem('allow_negative_stock') !== 'true') {
            const excedidos = activeAdjustments.filter(({ p, deltaUnits }) => deltaUnits > (p?.stock ?? 0));
            if (excedidos.length > 0) {
                const nombres = excedidos.slice(0, 3).map(({ p }) => p?.name || '?').join(', ');
                showToast(
                    `Egreso mayor al stock disponible: ${nombres}${excedidos.length > 3 ? ` y ${excedidos.length - 3} más` : ''}`,
                    'error'
                );
                triggerHaptic && triggerHaptic();
                return;
            }
        }
```

## 11.d — Propagar el motivo y auditar

```bash
echo -n "11d: "; grep -cF "                await adjustStock(productId, delta);" src/components/Products/StockBatchModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
            for (const { productId, deltaUnits } of activeAdjustments) {
                const delta = direction === 'ingreso' ? deltaUnits : -deltaUnits;
                await adjustStock(productId, delta);
            }
```
por:
```js
            const motivo = note.trim() || null;
            for (const { productId, deltaUnits } of activeAdjustments) {
                const delta = direction === 'ingreso' ? deltaUnits : -deltaUnits;
                await adjustStock(productId, delta, motivo);
            }

            // INV-12: este modal no emitía NINGÚN evento de auditoría, a diferencia
            // de BulkPriceAdjustModal. Un movimiento masivo de mercancía sin rastro
            // de quién, cuándo y por qué es exactamente lo que hace falta al cuadrar.
            const user = useAuthStore.getState().usuarioActivo;
            logEvent(
                'INVENTARIO',
                direction === 'ingreso' ? 'AJUSTE_MASIVO_ENTRADA' : 'AJUSTE_MASIVO_SALIDA',
                `${direction === 'ingreso' ? 'Ingreso' : 'Egreso'} masivo: ${activeAdjustments.length} productos, ${totalItems} unidades${motivo ? ` — ${motivo}` : ''}`,
                user,
                { productos: activeAdjustments.length, unidades: totalItems, direction, motivo }
            );
```

## 11.e — Verificar FASE 11

```bash
echo -n "11e1 motivo persistido: "; grep -cF "                    motivo: motivo || null," src/views/ProductsView.jsx
echo -n "11e2 auditoria del lote: "; grep -cF "'AJUSTE_MASIVO_ENTRADA' : 'AJUSTE_MASIVO_SALIDA'," src/components/Products/StockBatchModal.jsx
echo -n "11e3 tope de egreso: "; grep -cF "        if (direction === 'egreso' && localStorage.getItem('allow_negative_stock') !== 'true') {" src/components/Products/StockBatchModal.jsx
npx vite build --mode development 2>&1 | tail -5
```
**Esperado: `1`, `1`, `1`, build sin errores.**

---

# FASE 12 — Hallazgos menores (INV-13, INV-19, INV-23, INV-26, INV-27)

Cinco ediciones de una línea cada una. Ninguna depende de las otras.

## 12.a — INV-13: los ajustes manuales no son ventas

```bash
echo -n "12a: "; grep -cF "                    s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.status !== 'ANULADA'" src/hooks/useInventoryVelocity.js
```
**Esperado: `1`.**

Reemplaza:
```js
                    s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.status !== 'ANULADA'
```
por:
```js
                    // INV-13: `adjustStock` inyecta los ajustes en bodega_sales_v1 con
                    // forma de venta. Sin excluirlos, reponer un bulto de 24 sumaba 24
                    // "unidades vendidas" de los últimos 14 días y el producto recién
                    // repuesto aparecía como próximo a agotarse. useDashboardMetrics:151
                    // y reportsProcessor:7 ya los excluían; este hook se había olvidado.
                    s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' &&
                    s.tipo !== 'AJUSTE_ENTRADA' && s.tipo !== 'AJUSTE_SALIDA' &&
                    s.status !== 'ANULADA'
```

## 12.b — INV-19: el Kardex no debe mostrar ventas anuladas ni mezclar homónimos

```bash
echo -n "12b: "; grep -cF "                .filter(s => (s.items || []).some(i => i.id === product.id || i.name === product.name))" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
                .filter(s => (s.items || []).some(i => i.id === product.id || i.name === product.name))
                .map(s => {
                    const item = (s.items || []).find(i => i.id === product.id || i.name === product.name);
```
por:
```js
                // INV-19: se emparejaba también por NOMBRE, así que dos productos
                // homónimos compartían historial; y las ventas por unidad suelta
                // (id `${id}_unit`, nombre con sufijo " (Ud.)") no aparecían por
                // ninguna de las dos vías. `_originalId` es el campo que el carrito
                // guarda con el id real del producto (SalesView.jsx:507).
                // Además se incluían las ventas ANULADAS, indistinguibles de las válidas.
                .filter(s => s.status !== 'ANULADA'
                    && (s.items || []).some(i => (i._originalId || i.id) === product.id))
                .map(s => {
                    const item = (s.items || []).find(i => (i._originalId || i.id) === product.id);
```

## 12.c — INV-23: el contador y el filtro deben coincidir

```bash
echo -n "12c: "; grep -cF "    const lowStockCount = products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0).length;" src/views/ProductsView.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
    const lowStockCount = products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0).length;
```
por:
```js
    // INV-23: el contador excluía el stock negativo y el filtro "bajo-stock"
    // (useProductFiltering.js:11) lo incluía, así que la insignia decía 3 y la lista
    // mostraba 5. Se alinea con el filtro — y los negativos son los más urgentes.
    const lowStockCount = products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5)).length;
```

## 12.d — INV-26: un producto sin nombre no debe tumbar la vista

```bash
echo -n "12d: "; grep -cF "            const matchesSearch = p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.toLowerCase().includes(term));" src/hooks/useProductFiltering.js
```
**Esperado: `1`.**

Reemplaza:
```js
            const matchesSearch = p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.toLowerCase().includes(term));
```
por:
```js
            // INV-26: un producto sin `name` (posible vía useRemoteCommands acción
            // 'create', o por importación) reventaba TODA la vista Inventario con un
            // TypeError.
            const nombre = (p.name || '').toLowerCase();
            const matchesSearch = nombre.includes(term) || (p.barcode && p.barcode.toLowerCase().includes(term));
```

## 12.e — INV-27: ternario muerto

```bash
echo -n "12e: "; grep -cF "            setFormMode(isEditing ? 'quick' : 'quick');" src/components/Products/ProductFormModal.jsx
```
**Esperado: `1`.**

Reemplaza:
```js
            setFormMode(isEditing ? 'quick' : 'quick');
```
por:
```js
            // INV-27: era `isEditing ? 'quick' : 'quick'` — ambas ramas iguales.
            // El asistente por pasos solo se ofrece al crear (el conmutador está
            // detrás de `!isEditing`), así que 'quick' es el modo inicial en ambos casos.
            setFormMode('quick');
```

## 12.f — Verificar FASE 12

```bash
echo -n "12f1: "; grep -cF "                    s.tipo !== 'AJUSTE_ENTRADA' && s.tipo !== 'AJUSTE_SALIDA' &&" src/hooks/useInventoryVelocity.js
echo -n "12f2: "; grep -cF "                .filter(s => s.status !== 'ANULADA'" src/views/ProductsView.jsx
echo -n "12f3: "; grep -cF "            setFormMode('quick');" src/components/Products/ProductFormModal.jsx
npx vite build --mode development 2>&1 | tail -5
```
**Esperado: `1`, `1`, `1`, build sin errores.**

---

# FASE 13 — VERIFICACIÓN FINAL Y CIERRE

## 13.a — Integridad de los guardarraíles

Los archivos prohibidos por §1 **no deben aparecer** en el diff:

```bash
git diff --name-only main...HEAD; git diff --name-only
```

La unión de ambas listas debe ser **exactamente estos 10 archivos**, ni uno más:

```
src/utils/productProcessor.js
src/views/ProductsView.jsx
src/context/ProductContext.jsx
src/components/Products/BulkPriceAdjustModal.jsx
src/components/Products/ProductCard.jsx
src/components/Products/StockBatchModal.jsx
src/components/Products/ProductFormModal.jsx
src/hooks/useProductFiltering.js
src/hooks/useInventoryVelocity.js
tests/inventory.test.js
```

Comprobación explícita de los prohibidos:

```bash
echo -n "G1 financialLogic intacto: "; git diff --name-only main...HEAD -- src/utils/financialLogic.js | wc -l
echo -n "G2 FinancialEngine intacto: "; git diff --name-only main...HEAD -- src/core/FinancialEngine.js | wc -l
echo -n "G3 checkoutProcessor intacto: "; git diff --name-only main...HEAD -- src/utils/checkoutProcessor.js | wc -l
echo -n "G4 storageService intacto: "; git diff --name-only main...HEAD -- src/utils/storageService.js | wc -l
echo -n "G5 CurrencyService intacto: "; git diff --name-only main...HEAD -- src/services/CurrencyService.js | wc -l
echo -n "G6 tests preexistentes intactos: "; git diff --name-only main...HEAD -- tests/ | grep -v "tests/inventory.test.js" | wc -l
echo -n "G10 RemoteProductFormModal intacto: "; git diff --name-only main...HEAD -- src/components/Monitor/RemoteProductFormModal.jsx | wc -l
```

**Los siete deben devolver `0`. Cualquiera distinto de `0` invalida la ejecución: revierte ese archivo y reporta.**

## 13.b — Verificación funcional consolidada

```bash
echo "── INV-01 ──"
echo -n "priceCop escalado: "; grep -cF "const nuevoCop = escalar(p.priceCop, 1);" src/components/Products/BulkPriceAdjustModal.jsx
echo -n "priceBsUsdRef escalado: "; grep -cF "const nuevoRef = escalar(p.priceBsUsdRef, 0.01);" src/components/Products/BulkPriceAdjustModal.jsx
echo "── INV-02/04 ──"
echo -n "locks en ProductsView: "; grep -cF "withLock('pos_write_lock'" src/views/ProductsView.jsx
echo -n "lock en ProductContext: "; grep -cF "withLock('pos_write_lock'" src/context/ProductContext.jsx
echo -n "escrituras sueltas del catalogo: "; grep -cF "storageService.setItem('bodega_products_v1', updatedProducts)" src/views/ProductsView.jsx
echo "── INV-03 ──"
echo -n "merge por id: "; grep -cF "nuevasImagenes.has(p.id)" src/views/ProductsView.jsx
echo "── INV-05/16 ──"
echo -n "sin parseInt de stock: "; grep -cF "parseInt(stock, 10)" src/utils/productProcessor.js
echo -n "round3 de stock: "; grep -cF "round3(CurrencyService.safeParse(stock))" src/utils/productProcessor.js
echo "── INV-07 ──"
echo -n "margen sobre costBs (card+view): "; grep -cF "/ p.costBs * 100" src/components/Products/ProductCard.jsx src/views/ProductsView.jsx
echo -n "margen sobre costBs (orden): "; grep -cF "a.costBs > 0" src/hooks/useProductFiltering.js
echo "── INV-08/09/10 ──"
echo -n "validador definido: "; grep -cF "export function validateProductForm" src/utils/productProcessor.js
echo -n "validador conectado: "; grep -cF "const check = validateProductForm(formData, {" src/views/ProductsView.jsx
echo "── INV-11/12/13 ──"
echo -n "flag consumido: "; grep -cF "localStorage.removeItem('confirm_bulk_delete_catalog_flag');" src/views/ProductsView.jsx
echo -n "motivo persistido: "; grep -cF "motivo: motivo || null," src/views/ProductsView.jsx
echo -n "auditoria del lote: "; grep -cF "AJUSTE_MASIVO_ENTRADA" src/components/Products/StockBatchModal.jsx
echo -n "velocidad filtra ajustes: "; grep -cF "s.tipo !== 'AJUSTE_ENTRADA'" src/hooks/useInventoryVelocity.js
```

**Valores esperados, en orden:**
`1`, `1`, `4`, `1`, `0`, `1`, `0`, `1`, `0`, `0`, `1`, `1`, `1`, `1`, `1`, `1`

> `withLock('pos_write_lock'` en `ProductsView` debe dar **`4`**: `adjustStock`, `_commitSave`, `confirmDelete` y `handleFixCopPrices`.

## 13.c — Suite y build

```bash
npm test 2>&1 | tail -15
npx vite build 2>&1 | tail -8
```

**Esperado:** `180 passed | 10 skipped`, 11 de 12 archivos de tests pasan, build de producción sin errores. El `1 error` de worker puede persistir (§2.7).

## 13.d — Checklist E2E manual

Este plan no puede probar la UI (no hay `@testing-library`). Estas 14 comprobaciones **las hace una persona** con la app corriendo (`npm run dev`). Repórtalas como pendientes; no marques ninguna como hecha por ti.

| # | Prueba | Resultado esperado |
|---|---|---|
| **E1** | Crear producto con precio `-5` | Toast *"Precio en $ no puede ser negativo"*, el modal tiembla, **no se guarda** |
| **E2** | Crear producto con stock `-9` (flag de stock negativo apagado) | Toast *"Stock no puede ser negativo"*, no se guarda |
| **E3** | Crear producto con un código de barras que ya existe | Toast nombrando el producto en conflicto, no se guarda |
| **E4** | Activar "doble precio" y guardar sin llenar el Precio Ref. | Toast pidiendo el precio de referencia, no se guarda |
| **E5** | Llenar el precio **solo en Bs** con la tasa en 0 | Toast pidiendo el precio en $ o actualizar la tasa |
| **E6** | Producto tipo Bulto: 1.5 bultos de 24 uds → guardar → reabrir | Muestra **1.5 bultos y 36 unidades** (antes: 1 bulto y 36 unidades) |
| **E7** | Vender 3 unidades sueltas de un bulto de 24, luego editar el producto y cambiarle solo el nombre | El stock **conserva los decimales** (p.ej. 12.875), no se redondea a 12 |
| **E8** | Con la tasa a 40 poner costo $1 / precio $1.50; subir la tasa a 80 | La tarjeta sigue mostrando **50 %**, igual que el formulario (antes mostraba 200 %) |
| **E9** | Con COP habilitado y un producto con precio en COP, aplicar "+10 %" masivo | El precio **en COP** sube 10 % en la tarjeta, en el buscador de ventas y en el cobro |
| **E10** | Aplicar ajuste masivo de precios | Primer clic pide confirmación; solo el segundo aplica |
| **E11** | Abrir "Editar" en un producto, vender ese producto desde otra pestaña, volver y guardar | El stock refleja **la venta**, no el valor previo |
| **E12** | Con el stock en 0, pulsar `−` diez veces | El stock sigue en 0 y **no** aparecen diez salidas en Movimientos Recientes |
| **E13** | Egreso masivo de 100 uds de un producto con 3 en existencia | Toast bloqueando el egreso, nombrando el producto |
| **E14** | Egreso masivo con motivo *"merma"* → revisar la Auditoría | Aparece `AJUSTE_MASIVO_SALIDA` con el motivo, y el registro del movimiento lleva `motivo: "merma"` |

## 13.e — Commit final

```bash
git add -A
git status --short
```

**Verifica que solo estén los 10 archivos de 13.a.**

```bash
git commit -m "fix(inventario): precios masivos reales, margen en USD, auditoria de ajustes y correcciones menores

- INV-01: el ajuste masivo de precios solo escalaba priceUsdt, pero priceCop
  manda sobre priceUsdt en getUsd/getCop y en addToCart, y priceBsUsdRef manda
  en los pagos en Bs. Un +10% no cambiaba el precio cobrado de ningun producto
  con precio en COP. Ahora escala priceUsdt, priceUsd, priceCop, unitPriceUsd,
  unitPriceCop y priceBsUsdRef con mulR/round4.
- INV-07: el margen de tarjeta, lista y orden se calculaba en Bs contra un
  costBs congelado al guardado, asi que se inflaba solo con que subiera la
  tasa (50% pasaba a 200% sin cambiar nada) y contradecia al formulario.
  Ahora se calcula en USD contra costUsd en los tres sitios.
- INV-15: la correccion COP->USD dejaba el alias priceUsd y priceBsUsdRef con
  el valor inflado y no persistia de inmediato. Ademas ya no marca como error
  los productos que tienen priceCop valido, donde no habia nada que corregir.
- INV-11: el borrado total dejaba confirm_bulk_delete_catalog_flag encendido
  para siempre, desarmando el Circuit Breaker del catalogo.
- INV-12/22: el motivo obligatorio del egreso masivo se descartaba y el modal
  no emitia ningun evento de auditoria; ademas se bloquea el egreso mayor a la
  existencia en vez de recortarlo en silencio y registrar la cantidad pedida.
- INV-13: useInventoryVelocity contaba los ajustes manuales como ventas.
- INV-19: el Kardex mostraba ventas anuladas, mezclaba productos homonimos y
  no veia las ventas por unidad suelta.
- INV-21/23/25/26/27: doble toque en el ajuste masivo, contador de bajo stock
  alineado con su filtro, Ignorar del banner COP persistido, guarda de nombre
  nulo en el filtro y ternario muerto.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

## 13.f — Qué reportar

```
FASE 0  — anclajes 24/24 en 1, linea base <N> tests
FASE 1  — tests/inventory.test.js creado, 39 tests, <N> fallando
FASE 2  — 6 ediciones, 39/39 tests verdes
CHECKPOINT 1 — commit <sha>
FASE 3  — 2 ediciones, build OK
FASE 4  — 5 ediciones, withLock=3, build OK
FASE 5  — 2 ediciones, build OK
FASE 6  — 1 edicion, build OK
CHECKPOINT 2 — commit <sha>
FASE 7  — 5 ediciones, build OK
FASE 8  — 5 ediciones, build OK
FASE 9  — 3 ediciones, build OK
FASE 10 — 1 edicion
FASE 11 — 5 ediciones, build OK
FASE 12 — 5 ediciones, build OK
FASE 13 — guardarrailes 7/7 en 0, verificacion 16/16 OK, <N> tests, build produccion OK
          E2E manual: PENDIENTE (14 casos, requiere persona)
Commit final: <sha>
```

Si algo se desvió, dilo con el número de fase, el comando exacto y lo que devolvió. **No lo arregles por tu cuenta si no está en el plan.**

---

## §3 — MATRIZ DE RIESGOS

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| **R1** | El LLM ejecuta FASE 4 antes que FASE 2/3 y el catálogo queda con lock pero mal normalizado | Media | Alto | Regla 3 del preámbulo + los checkpoints con commit obligan al orden |
| **R2** | El anclaje `storageService.setItem('bodega_products_v1', updatedProducts);` aparece 2 veces y se edita el bloque equivocado | **Alta** | Alto | FASES 4.d y 4.e usan anclajes multilínea; la nota de FASE 0.e lo advierte de forma explícita |
| **R3** | Se olvida quitar la coma de `tasaCop,` en FASE 4.c y el build falla | Media | Bajo | Advertencia con ⚠️ en 4.c + `vite build` al final de FASE 4 |
| **R4** | La sangría de `status: 'COMPLETADA',` cambia entre FASE 4 y FASE 11 y el `grep` de 11.a2 confunde al ejecutor | Media | Bajo | Nota ⚠️ en 11.a2 explicando que `0` significa "no ejecutaste FASE 4" |
| **R5** | `round3` sobre stock rompe algún consumidor que esperaba entero | Baja | Medio | `checkoutProcessor` ya produce y consume stock fraccionario; los tests INV-PAY-001..005 lo fijan |
| **R6** | El validador bloquea la edición de un producto que ya está en stock negativo legítimo | Media | **Alto** (usabilidad) | `allowNegativeStock` en `opts`; test INV-VAL-021 lo cubre explícitamente |
| **R7** | `withLock` no está soportado (Safari viejo, contexto HTTP) y el fallback en memoria no protege entre pestañas | Baja | Medio | Es el comportamiento preexistente de `checkoutProcessor`; no se introduce regresión. `withLock` siempre ejecuta el callback (`withLock.js:119`) |
| **R8** | El Circuit Breaker lanza dentro del lock y el producto no se guarda | Baja | Medio | Los tres bloques capturan y muestran toast de error en vez de mentir; antes el fallo era silencioso |
| **R9** | El escalado de `priceCop` con `Math.round` introduce deriva acumulada tras varios ajustes masivos | Media | Bajo | COP es entero por convención del sistema; la deriva máxima es 1 peso por ajuste |
| **R10** | Excluir del banner los productos con `priceCop` deja sin corregir a alguno realmente envenenado | Baja | Bajo | En esos productos el precio cobrado ya sale de `priceCop`, así que corregir `priceUsdt` no cambiaba nada (INV-01) |
| **R11** | El merge de imágenes de FASE 6 pierde una imagen si el producto fue borrado durante la migración | Baja | Bajo | `base.map` simplemente no encuentra el id; el producto borrado sigue borrado, que es lo correcto |
| **R12** | Editar un producto que otro dispositivo borró durante la edición hace que el cambio se pierda en silencio | Baja | Bajo | Preexistente y no empeorado; el `base.map` no encuentra el id. Documentado aquí para que no sorprenda |
| **R13** | `costCop` en el payload rompe algún consumidor que iteraba las claves del producto | Muy baja | Bajo | Es un campo nuevo y opcional (`null` por defecto); `npm test` completo lo verifica |
| **R14** | El diff final incluye reformateo automático del editor | Media | Medio | G12 + revisión de `git diff --name-only` en 13.a |

---

## §4 — FUERA DE ALCANCE (deliberadamente)

| ID | Hallazgo | Por qué no está aquí |
|---|---|---|
| **INV-17** | El ajuste masivo hace N lecturas+escrituras completas del historial de ventas | Es rendimiento, no corrección. Arreglarlo bien requiere una API de ajuste por lote (`adjustStockBatch`) que cambie la firma que consume `StockBatchModal`, y eso merece su propio plan. Con FASE 11 el bucle sigue siendo O(n) pero ahora es **correcto**. |
| **INV-18** | Doble listener de `app_storage_update` en `ProductContext` | Tocar los listeners de sincronización sin poder probarlos (no hay tests de React) es el cambio con peor relación riesgo/beneficio de toda la auditoría. El síntoma es churn de renders, no pérdida de datos. |
| **INV-20** | `handleImageUpload` sin `onerror` ni límite de tamaño | Es UX de un camino secundario (ya existe la carga por URL y la búsqueda automática, ambas con manejo de error). No corrompe datos. |
| **INV-24** (parcial) | `costCop` ya se **persiste** (FASE 2.e), pero `ProductsView.handleEdit:481` lo sigue re-derivando al abrir la edición | Requiere tocar `handleEdit` y coordinar con `populateForm`, que es del hook. El dato ya deja de perderse; la lectura al editar se afina después. |
| **RemoteProductFormModal** | Hereda los arreglos de `buildProductPayload` pero **no** llama a `validateProductForm` | G10. El formulario remoto tiene su propio flujo de confirmación y probarlo exige dos dispositivos emparejados. Queda protegido por las redes defensivas de D5/D6 y por el `Math.max(0, …)` de `lowStockAlert`. |
| **ProductFormWizard** | No expone el doble precio en absoluto (0 ocurrencias de `priceBsUsdRef`) | Hallazgo nuevo detectado al verificar anclajes: crear un producto por el asistente por pasos **nunca** puede activar `dual_usd`. No es una regresión de este plan; se documenta para el siguiente. |

---

**FIN DEL PLAN.**
