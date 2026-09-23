# AUDITORÍA — INVENTARIO, CREACIÓN Y EDICIÓN DE ARTÍCULOS

**Proyecto:** `preciosaldia-bodega`
**Rama:** `main` (árbol limpio al momento de auditar)
**Fecha:** 2026-08-04
**Alcance:** catálogo de productos, formularios de alta/edición, ajustes de stock (unitarios y masivos), ajuste masivo de precios, persistencia del catálogo y sus consumidores directos.

---

## 1. MAPA DEL SUBSISTEMA

| Archivo | Rol | Líneas |
|---|---|---|
| `src/views/ProductsView.jsx` | Orquestador: CRUD, banners, paginación, selección, borrado total | 1106 |
| `src/context/ProductContext.jsx` | Estado global del catálogo, auto-guardado con debounce, `adjustStock`, circuit breaker UI | 339 |
| `src/utils/productProcessor.js` | `buildProductPayload` — única función pura de normalización del artículo | 109 |
| `src/hooks/useProductForm.js` | `useReducer` del formulario (21 campos) + `populateForm` | 171 |
| `src/components/Products/ProductFormModal.jsx` | Contenedor del modal + Kardex Lite + búsqueda de imagen | 401 |
| `src/components/Products/ProductFormQuick.jsx` | Formulario principal (modo "Vista Rápida") | 770 |
| `src/components/Products/ProductFormWizard.jsx` | Formulario por pasos (mismos props) | 758 |
| `src/components/Products/ProductCard.jsx` | Tarjeta de producto + botones ±1 + etiquetas | 370 |
| `src/components/Products/StockBatchModal.jsx` | Ingreso/egreso masivo de stock | 670 |
| `src/components/Products/BulkPriceAdjustModal.jsx` | Ajuste masivo de precios por % | 351 |
| `src/components/Products/CategoryManagerModal.jsx` | Alta/baja de categorías | 66 |
| `src/components/Products/PricingModeSelector.jsx` | Selector `tasa_dia` / `dual_usd` | 54 |
| `src/hooks/useProductFiltering.js` | Filtro + orden | 39 |
| `src/hooks/useInventoryVelocity.js` | Días de inventario | 59 |
| `src/utils/storageService.js` | Circuit Breaker + Shadow Snapshots del catálogo | 278 |
| `src/utils/imageUpload.js` | Subida y migración de imágenes a Storage | — |

**Consumidores del catálogo relevantes para la auditoría:** `src/views/SalesView.jsx` (`addToCart`), `src/utils/checkoutProcessor.js` (descuento de stock), `src/hooks/useRemoteCommands.js` (edición remota desde Modo Supervisor), `src/utils/calculatorUtils.js` (`getUsd` / `getCop` / `resolveDualPrice`).

---

## 2. RESUMEN EJECUTIVO

| ID | Severidad | Hallazgo | Archivo |
|---|---|---|---|
| INV-01 | 🔴 CRÍTICO | El ajuste masivo de precios NO toca `priceCop` ni `priceBsUsdRef` → no cambia el precio realmente cobrado | `BulkPriceAdjustModal.jsx:74` |
| INV-02 | 🔴 CRÍTICO | `adjustStock` hace read-modify-write de `bodega_sales_v1` **sin `withLock`** → puede borrar una venta en curso | `ProductsView.jsx:59` |
| INV-03 | 🔴 CRÍTICO | La migración de imágenes escribe un snapshot obsoleto sobre todo el catálogo | `ProductsView.jsx:126` |
| INV-04 | 🔴 CRÍTICO | Guardar/borrar un producto reescribe el catálogo entero desde un snapshot de render, sin lock | `ProductsView.jsx:401,512` |
| INV-05 | 🟠 ALTO | `parseInt(stock, 10)` trunca el stock fraccionario en **cada** edición | `productProcessor.js:68` |
| INV-06 | 🟠 ALTO | Fallback silencioso de la tasa a `1` — contradice su propio comentario FIN-022 | `productProcessor.js:30` |
| INV-07 | 🟠 ALTO | El margen de la tarjeta/lista usa `costBs` congelado → se infla con la tasa y contradice al formulario | `ProductCard.jsx:30` |
| INV-08 | 🟠 ALTO | Sin validación de código de barras duplicado; el escáner toma el primer match | `ProductsView.jsx:377` |
| INV-09 | 🟠 ALTO | El signo negativo se **voltea** en precios/costos y se **persiste** en stock/alerta | `productProcessor.js:34,68,107` |
| INV-10 | 🟠 ALTO | `dual_usd` se degrada a `tasa_dia` en silencio mientras la UI dice "ACTIVADO" | `productProcessor.js:81` |
| INV-11 | 🟠 ALTO | `confirm_bulk_delete_catalog_flag` queda encendido para siempre tras un borrado total | `ProductsView.jsx:1044` |
| INV-12 | 🟠 ALTO | El motivo obligatorio del egreso masivo se descarta; sin `logEvent` de ajuste de stock | `StockBatchModal.jsx:288` |
| INV-13 | 🟡 MEDIO | `useInventoryVelocity` no filtra `AJUSTE_*` → los ajustes manuales inflan la velocidad de venta | `useInventoryVelocity.js:28` |
| INV-14 | 🟡 MEDIO | Se registra el ajuste aunque el stock haya sido recortado a 0 → el Kardex miente | `ProductContext.jsx:248` |
| INV-15 | 🟡 MEDIO | `handleFixCopPrices` no actualiza `priceUsd`/`priceCop`/`priceBsUsdRef` ni persiste de inmediato | `ProductsView.jsx:181` |
| INV-16 | 🟡 MEDIO | `stockInLotes` y `stock` se guardan con reglas distintas → quedan contradictorios | `productProcessor.js:69,105` |
| INV-17 | 🟡 MEDIO | El ajuste masivo hace N lecturas+escrituras completas del historial de ventas en bucle | `StockBatchModal.jsx:305` |
| INV-18 | 🟡 MEDIO | Doble listener redundante de `app_storage_update` + `setProducts` sin comparación | `ProductContext.jsx:100,205` |
| INV-19 | 🟡 MEDIO | El Kardex incluye ventas ANULADAS y hace match por nombre | `ProductsView.jsx:489` |
| INV-20 | 🟡 MEDIO | `handleImageUpload` sin `onerror`, sin límite de tamaño, sin reset del input | `ProductsView.jsx:299` |
| INV-21 | 🟡 MEDIO | Ajuste masivo de precios sin confirmación ni deshacer; piso artificial en `0.01` | `BulkPriceAdjustModal.jsx:67` |
| INV-22 | 🟡 MEDIO | El egreso masivo no valida contra el stock disponible | `StockBatchModal.jsx:288` |
| INV-23 | 🟡 MEDIO | El contador "bajo stock" y el filtro "bajo-stock" usan criterios distintos | `ProductsView.jsx:295` vs `useProductFiltering.js:11` |
| INV-24 | 🔵 BAJO | `costCop` nunca se persiste; se re-deriva con la tasa del día en cada edición | `productProcessor.js` |
| INV-25 | 🔵 BAJO | Umbral 500 duplicado (banner COP vs confirmación de precio alto) → falso positivo permanente | `ProductsView.jsx:178,393` |
| INV-26 | 🔵 BAJO | `p.name.toLowerCase()` sin guarda ante productos sin nombre | `useProductFiltering.js:8` |
| INV-27 | 🔵 BAJO | Ternario muerto `isEditing ? 'quick' : 'quick'` | `ProductFormModal.jsx:157` |
| INV-28 | 🔵 BAJO | **Cero cobertura de tests** en todo el subsistema de inventario | `tests/` |

**Conteo:** 4 críticos · 8 altos · 11 medios · 5 bajos.

---

## 3. HALLAZGOS CRÍTICOS

### INV-01 🔴 — El ajuste masivo de precios no cambia el precio que se cobra

`src/components/Products/BulkPriceAdjustModal.jsx:74-88`:

```js
const newPrice = Math.max(0.01, (p.priceUsdt || 0) * multiplier);
const updated = { ...p, priceUsdt: parseFloat(newPrice.toFixed(4)) };
if (p.unitPriceUsd && p.unitPriceUsd > 0) {
    updated.unitPriceUsd = parseFloat((p.unitPriceUsd * multiplier).toFixed(4));
}
return updated;
```

Solo se mutan `priceUsdt` y `unitPriceUsd`. Quedan intactos `priceCop`, `unitPriceCop`, `priceBsUsdRef` y el alias `priceUsd` (FIN-030).

El problema es que **`priceCop` tiene prioridad sobre `priceUsdt` en todos los lectores**. `src/utils/calculatorUtils.js:25-41`:

```js
export const getCop = (item, tasaCop) => {
    if (item.priceCop != null && item.priceCop > 0) return item.priceCop;   // ← gana priceCop
    return mulR(item.priceUsdt ?? item.priceUsd ?? 0, tasaCop || 0);
};

export const getUsd = (item, tasaCop) => {
    if (item.priceCop != null && item.priceCop > 0 && tasaCop > 0) {
        return divR(item.priceCop, tasaCop);                                // ← gana priceCop
    }
    return item.priceUsdt ?? item.priceUsd ?? 0;
};
```

Y el precio que efectivamente entra al carrito, `src/views/SalesView.jsx:437-439`:

```js
let priceToUse = (product.priceCop && tasaCop > 0)
    ? product.priceCop / tasaCop
    : (parseFloat(product.priceUsdt) || 0);
```

**Consecuencia:** en una bodega con COP habilitado, `buildProductPayload` graba `priceCop` siempre que el usuario llenó ese campo (que es el campo primario cuando `copPrimary`). Para todos esos productos, un "+10% a todo el inventario":

- no cambia el precio mostrado en la tarjeta (`getUsd`/`getCop`),
- no cambia el precio del buscador ni de la grilla de ventas (`SearchBar.jsx`, `CategoryBar.jsx`),
- no cambia el precio de las etiquetas impresas (`labelGenerator.js:170,613`),
- **no cambia el precio que se le cobra al cliente**,

pero sí muestra el toast *"Precios ajustados +10% en N productos"* y escribe `logEvent('INVENTARIO','AJUSTE_MASIVO_PRECIOS', …)`. El dueño cree que subió los precios y no subió nada.

Análogamente, para productos con `pricingMode === 'dual_usd'` el `priceBsUsdRef` queda con el valor viejo, así que el aumento no aplica a ningún pago en bolívares (`resolveDualPrice`, `calculatorUtils.js:49-60`).

**Corrección:** dentro del `map`, aplicar el multiplicador de forma coherente a `priceUsdt`, `priceUsd`, `priceCop`, `unitPriceCop` y `priceBsUsdRef`, usando `mulR`/`round2` de `dinero.js` en vez de `parseFloat(x.toFixed(4))`.

---

### INV-02 🔴 — Ajustar stock puede borrar una venta que se está confirmando

`src/views/ProductsView.jsx:59-79`:

```js
const adjustStock = async (productId, delta) => {
    baseAdjustStock(productId, delta);
    triggerHaptic && triggerHaptic();
    try {
        const product = products.find(p => p.id === productId);
        const record = { id: `adj_${Date.now()}_…`, timestamp: …, tipo: delta > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA', … };
        const sales = await storageService.getItem('bodega_sales_v1', []);
        sales.push(record);
        await storageService.setItem('bodega_sales_v1', sales);
    } catch (e) { /* silencioso */ }
}
```

Es un read-modify-write sobre el **historial de ventas** sin tomar `withLock('pos_write_lock')`.

`src/utils/checkoutProcessor.js:180` sí lo toma:

```js
const lockResult = await withLock('pos_write_lock', async () => {
    const existingSales = await storageService.getItem(SALES_KEY, []);
    …
    await storageService.setItem(SALES_KEY, [finalPersistedSale, ...existingSales]);
```

Un lock solo sirve si **todos** los escritores lo respetan. Si el usuario pulsa `+`/`−` en un producto mientras se confirma una venta, la secuencia `getItem → push → setItem` de `adjustStock` puede leer el arreglo antes de que la venta se persista y escribirlo después: **la venta desaparece del historial**. Se pierden ingresos, el arqueo no cuadra y el `catch` es silencioso, así que no queda rastro.

El mismo patrón se repite N veces seguidas al aplicar un ajuste masivo (`StockBatchModal.jsx:305-308`), ampliando la ventana.

Nótese que `src/hooks/useRemoteCommands.js:60` **sí** envuelve la escritura de productos en `withLock('pos_write_lock')`. Los escritores de `ProductsView` son la excepción, no la regla.

**Corrección:** envolver todo el bloque en `withLock('pos_write_lock', …)` y no tragarse el error.

---

### INV-03 🔴 — La migración de imágenes sobrescribe el catálogo con un snapshot viejo

`src/views/ProductsView.jsx:126-159`:

```js
const timer = setTimeout(async () => {
    const current = await storageService.getItem('bodega_products_v1', []);
    …
    const res = await migrateProductImagesToStorage(current, async (out) => {
        await storageService.setItem('bodega_products_v1', out);
        if (!cancelled) setProducts(out);
    });
    if (res.failed === 0) localStorage.setItem('pda_images_migrated_v1', 'true');
}, 4000);
```

`src/utils/imageUpload.js:99-130`:

```js
for (const p of products) {
    if (p && typeof p.image === 'string' && p.image.startsWith('data:')) {
        const url = await uploadProductImage(p.image, { id: p.id });   // ← red, secuencial
        …
    }
    out.push(…);
}
if (migrated > 0 && typeof saveFn === 'function') await saveFn(out);   // ← escribe el snapshot inicial
```

`out` se deriva del arreglo `current` capturado **antes** del bucle. El bucle sube las imágenes **una por una, secuencialmente, por red**. Con 50 imágenes base64 eso son decenas de segundos. Al terminar, `saveFn(out)` escribe ese arreglo completo sobre `bodega_products_v1`.

**Todo lo que haya pasado en esa ventana se revierte:** ventas descontadas de stock, productos creados, precios editados, ajustes ±1. Y además `setProducts(out)` repone el estado viejo en memoria.

Agravante: el flag `pda_images_migrated_v1` solo se fija si `res.failed === 0`. Si un upload falla (offline, cuota de Storage, imagen corrupta), **la migración se vuelve a lanzar 4 segundos después de cada montaje de la vista Inventario, sesión tras sesión, indefinidamente**.

**Corrección:** en el `saveFn`, releer el catálogo fresco y hacer merge por `id` únicamente del campo `image` de los productos efectivamente migrados; envolver en `withLock`; y fijar el flag cuando `total > 0 && migrated === total`, con un contador de reintentos para no repetir eternamente.

---

### INV-04 🔴 — Guardar o borrar un producto reescribe el catálogo desde un snapshot de render

`src/views/ProductsView.jsx:401-445`:

```js
const _commitSave = async (productData) => {
    …
    let finalImage = image;
    if (typeof image === 'string' && image.startsWith('data:')) {
        const url = await uploadProductImage(image, { id: productId });   // ← await de red
        if (url) finalImage = url;
    }
    let updatedProducts;
    if (editingId) {
        updatedProducts = products.map(p => p.id === editingId ? {...} : p);   // ← `products` del render
    } else {
        updatedProducts = [{ id: productId, ...productData, … }, ...products];
    }
    storageService.setItem('bodega_products_v1', updatedProducts);   // sin await, sin lock
    setProducts(updatedProducts);
```

`products` es el snapshot del render en que se abrió el modal. Entre ese momento y el `setItem` hay: el tiempo que el usuario pasó llenando el formulario, más un `await` de subida de imagen. Cualquier venta confirmada en esa ventana ya descontó stock en `bodega_products_v1` (`checkoutProcessor.js:224-250`, que además relee fresco con el patrón FIN-027) — y este `setItem` lo pisa con los valores viejos.

**Escenario concreto:** el dueño abre "Editar" sobre *Harina PAN*, tarda un minuto; en ese minuto el cajero vende 8 unidades. Al guardar, el stock vuelve al valor previo a la venta. Las 8 unidades reaparecen en el inventario y nunca se detecta.

`confirmDelete` (`:512-522`) tiene exactamente el mismo defecto, y además borra sin comprobar si el producto está en el carrito activo.

El comentario `FIX-SAVE-001` en `:437` acierta al persistir de inmediato en vez de confiar en el debounce, pero resuelve el problema equivocado: el riesgo real no es el `clearTimeout`, es el snapshot obsoleto.

**Corrección:** `await withLock('pos_write_lock', async () => { const fresh = await storageService.getItem(...); const merged = /* aplicar el cambio sobre `fresh` */; await storageService.setItem(...); setProducts(merged); })`. El patrón ya existe y está probado en `useRemoteCommands.js:60-80`.

---

## 4. HALLAZGOS ALTOS

### INV-05 🟠 — El stock fraccionario se trunca en cada edición

`src/utils/productProcessor.js:68`:

```js
let finalStock = stock ? parseInt(stock, 10) : 0;
```

El stock **sí** puede ser fraccionario en este sistema. `src/utils/checkoutProcessor.js:231-235`:

```js
if (item.isWeight)         return sumR(sum, item.qty);                              // granel: 1.35 kg
if (item._mode === 'unit') return sumR(sum, divR(item.qty, item._unitsPerPackage || 1)); // 3/24 de bulto
```

Vender 3 unidades sueltas de un bulto de 24 deja el stock en `12.875`. Vender 1.35 kg de queso deja `8.65`. En cuanto alguien abra ese producto y pulse "Actualizar" —aunque solo cambie el nombre— `parseInt` lo deja en `12` y `8`. La merma es silenciosa, no auditada y acumulativa.

Aplica igual a productos `granel` (kg / litro), donde el input además declara `inputMode="numeric"` (`ProductFormQuick.jsx:698`).

**Corrección:** `round3(CurrencyService.safeParse(stock))` para granel y lote-por-unidad; reservar el entero solo para `packagingType === 'suelto'` sin `sellByUnit`.

---

### INV-06 🟠 — Fallback silencioso de la tasa a 1

`src/utils/productProcessor.js:29-30`:

```js
// FIN-022-pattern: validar tasa antes de usarla (sin fallback silencioso a 1).
const safeRate = effectiveRate > 0 ? effectiveRate : 1;
```

El comentario dice exactamente lo contrario de lo que hace el código: es un fallback silencioso a 1.

Se usa en:

```js
const finalPriceUsd = priceUsd ? round2(…) : (priceBs ? divR(safeParse(priceBs), safeRate) : 0);
const finalCostUsd  = costUsd  ? round2(…) : (costBs  ? divR(safeParse(costBs),  safeRate) : 0);
const finalCostBs   = costBs   ? round2(…) : (costUsd ? mulR(safeParse(costUsd), safeRate) : 0);
```

Si la tasa no está disponible (primer arranque offline, `RateContext` aún resolviendo, tasa manual en 0) y el usuario carga un producto escribiendo solo el precio en bolívares —lo natural en una bodega—, **"500 Bs" se guarda como "$500"**. El producto queda con `priceUsdt: 500`, dispara el banner de corrección COP (`ProductsView.jsx:178`) y el diálogo de precio alto (`:393`), y si el usuario confirma queda envenenado en el catálogo.

En la práctica los handlers de la vista (`handlePriceBsChange`, `:333`) ya rellenan `priceUsd` antes de llegar aquí, así que la rama solo se alcanza si el usuario escribe en Bs con la tasa en 0 — pero es precisamente el caso en que el fallback hace daño.

**Corrección:** si `effectiveRate <= 0` y el usuario solo dio precio/costo en Bs, abortar el guardado con un toast explícito. Y corregir el comentario.

---

### INV-07 🟠 — El margen mostrado se infla con la tasa y contradice al formulario

Tres lugares calculan el margen y usan **dos fórmulas distintas**.

En el formulario (`ProductFormQuick.jsx:82`), en USD — correcto:

```js
const mainMarginPct = parsedCost > 0 ? ((parsedPrice - parsedCost) / parsedCost * 100) : null;
```

En la tarjeta (`ProductCard.jsx:27-30`), en Bs contra un costo congelado:

```js
const valBs = effectiveUsd * effectiveRate;
const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;
```

Idéntico en la vista de lista (`ProductsView.jsx:782`) y en el orden por margen (`useProductFiltering.js:26-28`).

`costBs` es un valor **congelado**: `buildProductPayload:40-42` lo calcula como `costUsd × safeRate` en el momento del guardado y no se vuelve a tocar hasta la próxima edición. El numerador `valBs` sí sigue la tasa actual.

**Ejemplo:** producto con `costUsd = 1.00`, `priceUsd = 1.50`, guardado con tasa 40 → `costBs = 40`.
- Ese día: `valBs = 60`, margen mostrado = 50 %. Correcto.
- Tres meses después con tasa 80: `valBs = 120`, `costBs` sigue en 40 → **margen mostrado = 200 %**. El formulario del mismo producto sigue diciendo 50 %.

El dueño toma decisiones de precio sobre un margen inventado, y la columna "Margen" del inventario ordena por un criterio sin sentido económico.

**Corrección:** calcular siempre en USD (`(effectiveUsd − costUsd) / costUsd`) en tarjeta, lista y orden. `costBs` debe quedar como dato histórico, no como base de cálculo.

---

### INV-08 🟠 — Sin validación de código de barras duplicado

`handleSave` (`ProductsView.jsx:377-399`) valida únicamente nombre y precio. No hay ninguna comprobación de unicidad de `barcode` en todo el repositorio.

La lectura por escáner es "el primero que aparezca" (`src/views/SalesView.jsx:259,289,604`):

```js
const product = products.find(p => p.barcode === barcode || p.id === barcode);
```

Como los productos nuevos se **anteponen** al arreglo (`ProductsView.jsx:428`, `[nuevo, ...products]`), crear un producto con un código ya existente hace que **todos los escaneos de ese código pasen a resolver al producto nuevo**, en silencio. El producto original se vuelve invendible por escáner y su stock deja de descontarse.

También ausente: validación de nombre duplicado (que además rompe el emparejamiento del Kardex, ver INV-19).

**Corrección:** al guardar, si `barcode` no es vacío, buscar `products.find(p => p.barcode === barcode.trim() && p.id !== editingId)` y bloquear con un toast que nombre el producto en conflicto.

---

### INV-09 🟠 — El signo negativo se voltea en los precios y se conserva en el stock

Ningún input numérico del formulario declara `min="0"` (0 ocurrencias en `ProductFormQuick.jsx` y en `ProductFormWizard.jsx`, sobre 16 y 15 inputs `type="number"` respectivamente), y la validación de guardado es:

```js
if (!name || (!priceUsd && !priceBs)) { … }   // ProductsView.jsx:379
```

`"-5"` es truthy, así que pasa. A partir de ahí el comportamiento **se bifurca**, porque `buildProductPayload` normaliza cada campo con una función distinta.

Los precios y costos pasan por `CurrencyService.safeParse`, que descarta todo carácter que no sea dígito, coma o punto (`src/services/CurrencyService.js:31`):

```js
s = s.replace(/[^\d.,]/g, '');   // "-5" → "5"
```

El stock, la alerta y los bultos pasan por `parseInt`, que **sí** respeta el signo (`productProcessor.js:68,105,107`).

Comportamiento medido ejecutando `buildProductPayload({ priceUsd: '-5', costUsd: '-2', stock: '-9', lowStockAlert: '-3' }, 40)`:

| Campo de entrada | Valor guardado | Resultado |
|---|---|---|
| `priceUsd: '-5'` | `priceUsdt: 5` | 🔴 **signo volteado en silencio** |
| `costUsd: '-2'` | `costUsd: 2` | 🔴 **signo volteado en silencio** |
| `stock: '-9'` | `stock: -9` | 🔴 **negativo persistido** |
| `lowStockAlert: '-3'` | `lowStockAlert: -3` | 🔴 **negativo persistido** |

Ninguno de los cuatro casos produce un error, un toast ni una advertencia.

- **El volteo de signo es el peor de los dos.** Un dedazo `-5` en el precio no se rechaza: el producto queda a **$5** y se vende a $5. No hay forma de que el usuario detecte que escribió algo distinto de lo que quedó guardado.
- **El stock negativo entra sin pasar por el flag `allow_negative_stock`**, que es la única compuerta que el resto del sistema respeta (`ProductContext.jsx:252`, `checkoutProcessor.js:226`). Un producto queda en −9 sin que nadie lo haya autorizado.
- **La alerta negativa** hace que `(p.stock ?? 0) <= (p.lowStockAlert ?? 5)` sea falso siempre: ese producto **nunca** aparecerá en "bajo stock", ni siquiera en 0.

Es el mismo tipo de defecto que ya se corrigió en otra parte de la app — commit `7945392`, *"validacion anti-negativos en configuracion de Cashea y Avances"*— pero nunca se aplicó al inventario.

**Corrección:** rechazo explícito en `handleSave` (con `shake` y toast que nombre el campo) **antes** de llamar a `buildProductPayload`, más una guarda defensiva en `buildProductPayload` que devuelva error en vez de normalizar. Añadir `min="0"` es cosmético: en `type="number"` no impide teclear el signo, solo afecta a los botones de incremento.

---

### INV-10 🟠 — El doble precio se desactiva solo, sin avisar

`src/utils/productProcessor.js:77-85`:

```js
const parsedBsUsdRef = (rawBsUsdRef && CurrencyService.safeParse(rawBsUsdRef) > 0)
    ? round2(CurrencyService.safeParse(rawBsUsdRef)) : null;

const pricingMode = (rawPricingMode === 'dual_usd' && parsedBsUsdRef !== null)
    ? 'dual_usd' : 'tasa_dia';                      // ← degradación silenciosa
```

La UI solo autocompleta el campo de referencia si ya había un precio escrito al momento de activar el modo (`ProductFormQuick.jsx:447`):

```js
setPricingMode('dual_usd');
if (!priceBsUsdRef && priceUsd) setPriceBsUsdRef(priceUsd);   // ← si priceUsd está vacío, no rellena
```

El orden natural de llenado (activar la opción de doble precio y después escribir el precio) deja `priceBsUsdRef` vacío. El botón sigue mostrando el badge **"ACTIVADO"** y el radio marcado. Al guardar, el producto queda en `tasa_dia`, y en el siguiente cobro en bolívares se aplica el precio normal. La bodega deja de cobrar el diferencial de Bs sin que nadie lo note.

**Corrección:** bloquear el guardado con un toast cuando `pricingMode === 'dual_usd'` y `priceBsUsdRef` esté vacío o en 0 — nunca degradar en silencio.

---

### INV-11 🟠 — El borrado total deja desarmado el Circuit Breaker

`src/views/ProductsView.jsx:1041-1049`:

```js
if (deleteAllConfirmText.trim().toUpperCase() === 'BORRAR') {
    localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');
    setProducts([]);
    storageService.removeItem('bodega_products_v1');   // ← removeItem, NO setItem
}
```

El flag solo se consume dentro de `setItem` (`storageService.js:102-105`):

```js
const confirmed = localStorage.getItem('confirm_bulk_delete_catalog_flag') === 'true';
if (confirmed) {
    localStorage.removeItem('confirm_bulk_delete_catalog_flag');   // ← única limpieza que existe
    await shadowBackupService.saveShadow(key, currentCatalog);
}
```

Como el borrado total va por `removeItem`, el flag **nunca se limpia**. El auto-guardado de `ProductContext.jsx:169-172` también usa `removeItem` cuando `products.length === 0`, así que tampoco lo consume.

Resultado: después del primer borrado total, `confirm_bulk_delete_catalog_flag` queda en `'true'` de forma permanente en `localStorage`. La primera escritura anómala posterior —una sincronización de nube parcial, una restauración incompleta, un bug que produzca un arreglo de 2 productos sobre un catálogo de 500— pasa el Circuit Breaker sin bloqueo ni modal de advertencia. Se guarda la copia de sombra, pero el usuario nunca se entera de que perdió el catálogo.

Es una degradación permanente del "Triple-Lock Vault" documentado en `storageService.js:87-91`.

**Corrección:** limpiar el flag en el mismo `onClick` inmediatamente después del `removeItem`, o mejor: darle un TTL corto (`{ value: true, exp: Date.now() + 10000 }`) para que caduque solo.

---

### INV-12 🟠 — El motivo obligatorio del egreso se descarta

`src/components/Products/StockBatchModal.jsx:288-330`:

```js
const needsNote = direction === 'egreso' && !note.trim();

const handleApply = async () => {
    if (needsNote) { showToast('Escribe un motivo para el egreso', 'error'); return; }
    …
    for (const { productId, deltaUnits } of activeAdjustments) {
        const delta = direction === 'ingreso' ? deltaUnits : -deltaUnits;
        await adjustStock(productId, delta);     // ← `note` no se pasa
    }
    …
    setNote('');                                  // ← y se descarta
```

Se le exige al usuario justificar cada egreso de inventario y esa justificación **no se guarda en ningún lado**: ni en el registro `AJUSTE_SALIDA`, ni en un `logEvent`. El modal tampoco emite ningún evento de auditoría — a diferencia de `BulkPriceAdjustModal.jsx:97`, que sí registra `logEvent('INVENTARIO','AJUSTE_MASIVO_PRECIOS', …)`.

Es exactamente el dato que se necesita cuando falta mercancía: por qué salió, quién la sacó, cuándo. El campo existe, la validación existe, y el valor se tira.

**Corrección:** propagar `note` hasta el registro `AJUSTE_SALIDA` (campo `motivo`) y añadir un `logEvent('INVENTARIO','AJUSTE_MASIVO_STOCK', …)` con dirección, cantidad de productos, total de unidades, motivo y usuario activo.

---

## 5. HALLAZGOS MEDIOS

### INV-13 🟡 — Los ajustes manuales de stock se cuentan como ventas

`src/hooks/useInventoryVelocity.js:28-40`:

```js
const recentSales = allSales.filter(s =>
    s.timestamp && new Date(s.timestamp) >= fourteenDaysAgo &&
    s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.status !== 'ANULADA'
);
recentSales.forEach(sale => {
    (sale.items || []).forEach(item => { velocityMap[item.id || item.name] += item.qty; });
});
```

No excluye `AJUSTE_ENTRADA` ni `AJUSTE_SALIDA`, y `adjustStock` los inyecta en `bodega_sales_v1` con la forma de una venta (`items: [{ id, name, qty }]`).

Recibir un bulto de 24 unidades pulsando `+` 24 veces —o con el ingreso masivo— añade 24 "unidades vendidas" de los últimos 14 días. La velocidad diaria sube, y `daysRemaining` en la tarjeta (`ProductsView.jsx:740-744`) se desploma: el producto que acaba de reponerse aparece marcado como próximo a agotarse.

Los demás consumidores sí filtran correctamente: `useDashboardMetrics.js:151` excluye ambos tipos y `reportsProcessor.js:7,15` los excluye por lista blanca. `useInventoryVelocity` es el único que se olvidó.

**Corrección:** añadir `&& s.tipo !== 'AJUSTE_ENTRADA' && s.tipo !== 'AJUSTE_SALIDA'` al filtro.

---

### INV-14 🟡 — Se registra el ajuste aunque el stock no haya cambiado

`src/context/ProductContext.jsx:248-261`:

```js
const adjustStock = useCallback((productId, delta) => {
    setProducts(prevProducts => {
        const updated = prevProducts.map(p => {
            if (p.id === productId) {
                const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                const newStock = (p.stock ?? 0) + delta;
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };   // ← recorte
            }
            return p;
        });
        storageService.setItem('bodega_products_v1', updated);   // ← efecto dentro del updater
        return updated;
    });
}, []);
```

El recorte a 0 es correcto, pero el envoltorio de `ProductsView` registra el movimiento **con el delta solicitado**, no con el aplicado. Con stock en 0, pulsar `−` diez veces escribe diez `AJUSTE_SALIDA` de 1 unidad cada uno en el historial, cuando no salió nada. Lo mismo en el egreso masivo (ver INV-22).

Dos problemas adicionales en el mismo bloque:

1. **Efecto secundario dentro del updater de `setState`.** React puede invocar el updater más de una vez (StrictMode en desarrollo, reintentos de render concurrente); cada invocación dispara un `setItem` extra.
2. **Escritura sin `await` ni lock** — misma familia que INV-02/INV-04.

**Corrección:** calcular el delta efectivo (`stockAfter − stockBefore`) y registrar ese; devolver el estado desde el updater y hacer la persistencia fuera, con lock.

---

### INV-15 🟡 — La corrección COP→USD deja el producto a medio corregir

`src/views/ProductsView.jsx:181-202`:

```js
const correctedUsd = parseFloat((p.priceUsdt / tasaCop).toFixed(4));
const updated = { ...p, priceUsdt: correctedUsd };
if (p.unitPriceUsd && p.unitPriceUsd > 0) updated.unitPriceUsd = parseFloat((p.unitPriceUsd / tasaCop).toFixed(4));
if (p.costUsd && p.costUsd >= 500) {
    updated.costUsd = parseFloat((p.costUsd / tasaCop).toFixed(4));
    updated.costBs  = parseFloat((updated.costUsd * effectiveRate).toFixed(2));
}
return updated;
```

Tres defectos:

1. **No actualiza el alias `priceUsd`** (FIN-030). El producto queda con `priceUsdt: 3.75` y `priceUsd: 15000`. Los consumidores que leen el alias — `getUsd`/`getCop` como fallback, `GastosInternosModal.jsx:244,495`— siguen viendo el valor inflado.
2. **No toca `priceCop` ni `priceBsUsdRef`.** Si el producto tiene `priceCop`, corregir `priceUsdt` no cambia nada visible ni cobrable (misma causa raíz que INV-01).
3. **No persiste de inmediato** — depende del debounce de 1 s de `ProductContext`, justo el patrón que `FIX-SAVE-001` (`:437`) declara inseguro.

Además usa aritmética cruda `parseFloat(x.toFixed(4))` en lugar de `divR`/`mulR`/`round2`, en contra de la convención FIN-015 que el resto del repositorio respeta.

---

### INV-16 🟡 — `stock` y `stockInLotes` quedan contradictorios

`src/utils/productProcessor.js:68-71` y `:105`:

```js
let finalStock = stock ? parseInt(stock, 10) : 0;
if (isLote && stockInLotes && parsedUnitsPerPkg > 0) {
    finalStock = Math.round(parseFloat(stockInLotes) * parsedUnitsPerPkg);   // ← parseFloat + round
}
…
stockInLotes: isLote && stockInLotes ? parseInt(stockInLotes) : null,        // ← parseInt
```

El mismo valor se lee con `parseFloat` para derivar unidades y con `parseInt` para almacenarse. Con "1.5 bultos de 24": `stock = 36` (correcto) pero `stockInLotes = 1`. Al reabrir el producto, `populateForm` lee `stockInLotes = 1` y muestra "1 bulto / 36 unidades" — dos campos que se contradicen en pantalla. Si el usuario toca cualquiera de los dos, el binding bidireccional de `ProductFormQuick.jsx:644-673` propaga el valor equivocado y el stock real se pierde.

**Corrección:** usar `parseFloat` en ambos, o eliminar `stockInLotes` como campo persistido y derivarlo siempre de `stock / unitsPerPackage`.

---

### INV-17 🟡 — El ajuste masivo reescribe el historial completo N veces

`src/components/Products/StockBatchModal.jsx:305-308`:

```js
for (const { productId, deltaUnits } of activeAdjustments) {
    const delta = direction === 'ingreso' ? deltaUnits : -deltaUnits;
    await adjustStock(productId, delta);
}
```

Cada iteración ejecuta el `adjustStock` de `ProductsView`, que hace un `getItem` + `push` + `setItem` del arreglo **completo** de `bodega_sales_v1`, más un `setItem` del catálogo completo.

Con 50 productos ajustados y 8 000 ventas históricas: 50 deserializaciones y 50 serializaciones de 8 000 registros, secuenciales, en el hilo principal. La UI se congela varios segundos y cada `setItem` dispara además `queueCloudSync` (`storageService.js:127`), multiplicando el tráfico de sincronización.

**Corrección:** un solo `withLock` que lea el historial una vez, agregue los N registros de ajuste de golpe y escriba una vez; igual para el catálogo.

---

### INV-18 🟡 — Listeners duplicados y re-render en cascada

`ProductContext.jsx` registra **dos** manejadores independientes para los mismos dos eventos:

```js
// useEffect #1 — línea 100
window.addEventListener('app_storage_update', handleStorageUpdate);
window.addEventListener('storage', handleStorageUpdate);

// useEffect #2 — línea 205
window.addEventListener('storage', handleStorageChange);
window.addEventListener('app_storage_update', handleAppStorageUpdate);
```

Ante un solo `app_storage_update` de `bodega_products_v1` se ejecutan dos `getItem` completos del catálogo. El segundo compara antes de setear (`JSON.stringify(updated) !== JSON.stringify(productsRef.current)`, `:212`), pero **el primero no**:

```js
const refreshedProducts = await storageService.getItem('bodega_products_v1', []);
setProducts(refreshedProducts);   // ← nueva identidad de arreglo, siempre
```

Nueva referencia → se dispara el efecto de auto-guardado (`:153`) → se pone `savingRef = true` y se agenda otro `setItem` a 1 s → que emite otro `app_storage_update`. El `savingRef` corta el ciclo, pero a costa de un re-render de todos los consumidores del contexto y una escritura redundante por cada evento.

El `JSON.stringify` sobre catálogos grandes es además caro por sí solo.

**Corrección:** eliminar el `useEffect` #1 (es un subconjunto del #2) y comparar antes de setear.

---

### INV-19 🟡 — El Kardex muestra ventas anuladas y mezcla productos homónimos

`src/views/ProductsView.jsx:489-505`:

```js
const movements = allSales
    .filter(s => (s.items || []).some(i => i.id === product.id || i.name === product.name))
    .map(s => {
        const item = (s.items || []).find(i => i.id === product.id || i.name === product.name);
        …
```

Dos problemas:

1. **No filtra `s.status === 'ANULADA'`.** Una venta anulada sigue apareciendo en "Movimientos Recientes" indistinguible de una válida (`ProductFormModal.jsx:315-352` no muestra el estado). El historial que el dueño consulta para cuadrar faltantes incluye movimientos que se revirtieron.
2. **Empareja por nombre además de por id.** Dos productos con el mismo nombre —posible, porque no hay validación de unicidad (INV-08)— comparten historial. Y los ítems del carrito con `_mode === 'unit'` llevan el nombre sufijado con `" (Ud.)"` (`SalesView.jsx:448`), así que esos movimientos **no** aparecen ni por nombre ni por id (el id es `product.id + '_unit'`): las ventas por unidad suelta son invisibles en el Kardex.

**Corrección:** filtrar anuladas (o marcarlas), y emparejar por `i._originalId || i.id` contra `product.id`.

---

### INV-20 🟡 — La carga de imagen falla en silencio

`src/views/ProductsView.jsx:299-319`:

```js
const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => { … setImage(canvas.toDataURL('image/webp', 0.7)); };
    };
};
```

- Sin `reader.onerror` ni `img.onerror`: si el archivo no es decodificable (HEIC en navegadores sin soporte, archivo corrupto, PDF renombrado), no pasa absolutamente nada — ni imagen, ni error, ni toast. El usuario reintenta creyendo que no hizo clic bien.
- Sin límite de tamaño previo: un archivo de 40 MB se lee entero a base64 antes de escalarlo, con el consiguiente pico de memoria.
- No se limpia `e.target.value`: seleccionar **el mismo archivo dos veces seguidas** no dispara el evento `change` la segunda vez.

`ProductFormModal.compressBase64Image` (`:81`) sí tiene `img.onerror`; este camino no.

---

### INV-21 🟡 — El ajuste masivo de precios no se puede confirmar ni deshacer

`BulkPriceAdjustModal.handleApply` (`:67`) aplica directamente al primer clic. El único freno es una previsualización de 3 productos elegidos al azar (`:55-62`), y el ámbito por defecto es `'todos'` — el catálogo completo. No hay paso de confirmación, no hay deshacer, y el cambio es irreversible salvo restaurando un respaldo.

Contrasta con las otras operaciones destructivas del mismo módulo, que sí exigen confirmación: el borrado de un producto usa un modal (`ProductsView.jsx:988`), el borrado total exige escribir "BORRAR" (`:1019`), y el egreso masivo de stock tiene doble toque (`StockBatchModal.jsx:297`).

Adicionalmente, el piso `Math.max(0.01, …)` (`:79`) sube a 0.01 cualquier producto con precio 0, incluidos los que están en 0 a propósito.

---

### INV-22 🟡 — El egreso masivo no valida contra el stock disponible

`StockBatchModal.setQty` (`:263`) solo acota por abajo:

```js
const num = Math.max(0, parseInt(val) || 0);
```

Nada impide registrar un egreso de 100 unidades de un producto con 3 en existencia. `adjustStock` recorta el stock a 0 (salvo `allow_negative_stock`), pero el registro `AJUSTE_SALIDA` queda con 100 (INV-14). El resumen previo al aplicar tampoco advierte del desajuste.

**Corrección:** en modo `egreso`, acotar por `p.stock` y marcar en rojo las filas que excedan.

---

### INV-23 🟡 — El contador de bajo stock no coincide con el filtro

`ProductsView.jsx:295`:

```js
const lowStockCount = products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0).length;
```

`useProductFiltering.js:11`:

```js
if (activeCategory === 'bajo-stock') return matchesSearch && (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
```

El contador excluye los productos con stock negativo; el filtro los incluye. Con `allow_negative_stock` activo, la insignia dice "3" y al pulsarla aparecen 5 productos. Los excluidos del contador son justamente los más urgentes.

---

## 6. HALLAZGOS BAJOS

**INV-24 — `costCop` no se persiste.** `ProductsView` mantiene el estado `costCop` (`:324`) y lo expone al formulario, pero `buildProductPayload` no lo recibe ni lo guarda. Al reabrir la edición se re-deriva como `costUsd × tasaCop` (`:481`), así que el valor que el usuario escribió se recalcula con la tasa del día. En bodegas COP-primarias, el costo de adquisición —el número con el que se calcula el margen— nunca es el que se tecleó.

**INV-25 — Umbral 500 duplicado.** El banner "parecen pesos colombianos" se dispara con `p.priceUsdt >= 500` (`:178`) y la confirmación de precio alto con `> 500` (`:393`). Un producto legítimamente caro (una bombona, un electrodoméstico) queda marcado permanentemente como error de moneda, y el único escape es "Ignorar", que no se persiste (`copCorrectionDismissed` es estado local: vuelve a aparecer en cada montaje de la vista).

**INV-26 — Filtro sin guarda de nombre.** `useProductFiltering.js:8` hace `p.name.toLowerCase()` sin comprobar. Un producto sin `name` —posible vía `useRemoteCommands` acción `create`, o vía importación— rompe la vista Inventario completa con un `TypeError`.

**INV-27 — Ternario muerto.** `ProductFormModal.jsx:157`: `setFormMode(isEditing ? 'quick' : 'quick')`. Ambas ramas son iguales; o falta lógica o sobra el ternario.

**INV-28 — Cero cobertura de tests.** No existe ningún test para `productProcessor.js`, `useProductForm.js`, `adjustStock`, el circuit breaker del catálogo ni ninguno de los modales de inventario:

```
tests/  cashea · checkout · compression · crypto · deepFreeze · dinero
        financialEngine · hooks · security · securityConstants · tipDonated · withLock
```

`buildProductPayload` es una función pura de 109 líneas con toda la lógica de normalización de precios, stock, empaque y doble precio: es el candidato más barato y de mayor retorno para tests, y ahí viven INV-05, INV-06, INV-10 e INV-16.

---

## 7. LO QUE ESTÁ BIEN Y NO DEBE TOCARSE

1. **El Triple-Lock Vault del catálogo** (`storageService.js:89-120`): circuit breaker al 10 %, shadow snapshot previo a cada sobrescritura válida, y re-lanzamiento obligatorio del error para que el `catch` genérico no escriba en `localStorage`. El diseño es correcto; el único problema es el flag que no se limpia (INV-11).

2. **`buildProductPayload` como única función pura de normalización.** Toda la creación y edición pasa por ella, así que los defectos INV-05/06/10/16 se corrigen en un solo lugar y quedan cubiertos por tests unitarios.

3. **`useProductForm` con `useReducer`** (HOOK-029): `populateForm` batchea 17 campos en un `PATCH` y la API pública replica los pares `[value, setter]`. Correcto y bien documentado.

4. **`FIX-IMAGE-001`** (`ProductsView.jsx:420-424`): distinguir `""` (borrado explícito) de `undefined` (campo no tocado) al fusionar la imagen. Sutil y bien resuelto.

5. **El descuento de stock del checkout** (`checkoutProcessor.js:224-250`): relee el catálogo fresco dentro del lock (patrón FIN-027), maneja `isWeight` y `_mode === 'unit'` con `divR`, y audita el uso de stock negativo con `NEGATIVE_STOCK_USED` (FIN-014). Es el modelo a copiar en los escritores de `ProductsView` (INV-02/04).

6. **`useRemoteCommands.js:60-80`**: la edición remota de productos sí toma `withLock('pos_write_lock')` y relee fresco. Ya existe el patrón correcto en el repositorio.

7. **La subida diferida de imágenes a Storage** (`_commitSave:411-415`): si el upload falla, se conserva el base64 en lugar de perder la imagen. La estrategia es buena; el problema está en la migración masiva (INV-03), no aquí.

8. **El panel de margen del formulario** (`ProductFormQuick.jsx:586-637`): calcula en USD, distingue margen de bulto y margen de unidad, y advierte de venta a pérdida y de punto de equilibrio. Es la fórmula correcta — la que deberían usar la tarjeta y la lista (INV-07).

---

## 8. ORDEN DE CORRECCIÓN SUGERIDO

| Fase | Hallazgos | Justificación |
|---|---|---|
| **1 — Integridad de datos** | INV-02, INV-04, INV-03, INV-14 | Son pérdidas silenciosas de ventas y de stock. Todas se resuelven con el mismo patrón (`withLock` + relectura fresca + merge por `id`) que ya existe en `useRemoteCommands.js`. |
| **2 — Dinero mal calculado** | INV-01, INV-06, INV-07, INV-10, INV-15 | Afectan directamente el precio que se cobra y el margen sobre el que se decide. INV-01 e INV-15 comparten causa raíz (`priceCop` manda sobre `priceUsdt`). |
| **3 — Validación de entrada** | INV-05, INV-08, INV-09, INV-16, INV-22 | Todo cabe en `buildProductPayload` + `handleSave`, y es lo que debe blindarse con tests primero (INV-28). |
| **4 — Auditoría y confianza** | INV-11, INV-12, INV-13, INV-19 | El historial debe poder usarse para cuadrar faltantes; hoy miente por omisión y por contaminación. |
| **5 — Rendimiento y pulido** | INV-17, INV-18, INV-20, INV-21, INV-23, INV-24 → INV-27 | Sin riesgo de dinero, pero INV-17 e INV-18 se notan en bodegas con historial grande. |

**Nota de alcance:** las fases 1 y 2 tocan `ProductsView.jsx`, `ProductContext.jsx`, `productProcessor.js`, `BulkPriceAdjustModal.jsx` y `ProductCard.jsx`. Ninguna requiere tocar `src/utils/financialLogic.js` ni `src/core/FinancialEngine.js`.

