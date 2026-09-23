# Plan: Doble Precio transparente + Re-sincronización viva de la cesta

> Incidente: el cajero carga un producto dual ($22 USD / Ref Bs $1,20), ingresa un pago
> en Bolívares y el total colapsa en silencio de $22,00 a $1,20. El cajero lo percibe
> como "cálculo roto" y reporta el sistema como averiado. El re-precio es CORRECTO por diseño
> (ProductoFormQuick: "El cliente pagará $X si entrega divisas, o $Y Ref si paga por
> Pago Móvil, Punto o Efectivo Bs") — el defecto es de **comunicación**, no de cálculo.

# Trabajo 1: Aviso de re-precio en Bs (Doble Precio)

## Problema

1. En el checkout, al detectar el primer pago con método en Bs (`isBsPaymentActive`),
   `FinancialEngine.buildCartTotals(..., isBsPayment=true)` re-precia los ítems
   `dual_usd` con su `priceBsUsdRef`. El total cambia sin ningún aviso.
2. En la cesta (CartPanel), el ítem dual muestra su precio Ref en Bs, pero no indica
   que ese precio pasará a ser el del ticket si el cliente paga en Bs.
3. No existe ningún rastro visual del cambio: ni banner, ni tooltip, ni badge.

## Objetivo

Que el cambio de total por re-precio sea **visible, explicado y verificable** en las
tres superficies donde ocurre (checkout móvil, checkout POS y cesta), sin bloquear el
flujo de cobro.

## Señal derivada (Fase 0 — núcleo)

En `useCheckoutCalculations` ya existen todas las piezas; solo falta exponerlas:

```js
const repricedActive = isBsPaymentActive
    && cartTotals.totalUsd !== round2(baseCartTotalUsd); // re-precio realmente aplicado
const repricedDeltaUsd = round2(baseCartTotalUsd - cartTotals.totalUsd); // puede ser negativo
// también: itemsDualRepriced = cart.filter(i => i.pricingMode === 'dual_usd' && i.priceBsUsdRef > 0)
```

Contrato: `repricedActive` solo es `true` si hay al menos un ítem dual Y el total
recalculado difiere del base. Si el Ref coincide con el precio USD, no hay aviso.

## Fases

### Fase 1 — Banner en el checkout (móvil y POS)

Componente nuevo `RepriceNotice.jsx` (estilo inline, sin modal):

- Ubicación: justo debajo del header de TOTAL en `CheckoutModal.jsx` y en la columna
  de pagos de `CheckoutModalPOS`.
- Copy: «Precio en Bs aplicado — este ticket usa el precio de referencia dual:
  $1,20 (antes $22,00)» con icono `RefreshCw`/`Tag` y color ámbar suave.
- `aria-live="polite"` para lectores de pantalla.
- Se muestra solo mientras `repricedActive`; desaparece si el pago vuelve a USD.

### Fase 2 — Aviso en la cesta (prevención antes de cobrar)

En `CartPanel.jsx`, para ítems dual, el subtítulo ya muestra el precio Ref en Bs.
Añadir badge condensado: «Ref Bs» con tooltip «Si el cliente paga en Bs, este ticket
se cobra a $1,20 Ref». Sin cambios de layout en 320px.

### Fase 3 — Confirmación en el tab Bolívares (opcional, si Fase 1 no basta en campo)

En `MobilePaymentMethodCard`, primera vez que se activa el tab Bolívares con ítems
duales, mostrar una línea estática bajo el header del método:
«Ticket re-precidado por Doble Precio: total $1,20». No intercepta el toque.

### Fase 4 — Configuración (solo si hay feedback contrario)

Setting `checkout_reprice_notice` (default ON) en Configuración → Ventas, junto al
bloque existente de Desglose del Cambio. No implementar hasta tener señal real.

## Criterios de aceptación

1. Producto dual $22/Ref $1,20 + pago Bs ⇒ banner visible en checkout con ambos montos.
2. Pago mixto ($10 USD + 5 Bs) ⇒ banner visible (el re-precio aplica igual).
3. Producto sin dual, o dual cuyo Ref = precio USD ⇒ cero banner (sin ruido).
4. El banner nunca bloquea: CTA, steppers y flujo de vuelto intactos.
5. Sin overflow en 320px (regla del repo VUELTO-REALISTA-responsivo-2).

## Tests

- Unit (`tests/repriceNotice.test.js`): matriz de `repricedActive` (dual sí/no,
  Ref=USD, pago Bs/USD/mixto).
- E2E (`tests/e2e/checkout-movil.e2e.spec.js`): escenario dual → tab Bolívares →
  `await expect(banner).toContainText('Precio en Bs aplicado')`; completar venta.

---

# Trabajo 2: Re-sincronización viva cesta ↔ inventario (SYNC-CESTA-001)

## Problema

`addToCart` (src/views/SalesView.jsx:417, snapshot en ~513–524) guarda una **copia
completa** del producto en la cesta (`{ ...product, priceUsd: priceToUse, ... }`).
El ítem solo conserva `_originalId` como referencia: editar el producto en inventario
(precio USD/COP, costo, `pricingMode`, `priceBsUsdRef`) NO propaga a los ítems ya
cargados. Repro real: quitarle el Doble Precio a un producto con la cesta armada →
la cesta siguió aplicando el re-precio con el Ref viejo; el cajero tuvo que eliminar y
re-agregar el ítem. Riesgo mayor: cobrar un precio corregido por supervisión.

Ya existe un precedente vivo a medias: el efecto de `tasaCop` (~537–548) re-precia
`priceUsd` de ítems con `priceCop` — pero solo ese campo, y es un segundo escritor
del carrito que conviene unificar.

## Objetivo

Que los ítems de la cesta reflejen siempre el catálogo vigente, preservando la
cantidad y el modo de venta ya elegidos, sin loops de render y sin borrar datos.

## Núcleo puro: `src/utils/cartSync.js` + tests

Función pura sin dependencias de React, en el espíritu de `changeSplit.js`:

```js
resyncCartItems(cart, productsById, { tasaCop, effectiveRate })
//  → { cart: CartItem[], priceChanges: {name, from, to}[] } | null
// null ⇒ nada cambió (el caller NO hace setState; inmune a StrictMode/loops)
```

Por ítem: buscar producto por `_originalId` y **recalcular los campos derivados con
la MISMA fórmula de addToCart** (única fuente de verdad — extraer a helper compartido
`deriveCartFields(product, mode, unitsPerPackage, { tasaCop, effectiveRate })`):

- `priceUsd` (`priceCop/tasaCop` o `priceUsdt`; en modo `'unit'`:
  `unitPriceCop/tasaCop` o `unitPriceUsd`), `priceCop`, `exactBs`,
  `costBs` (`costBs || costUsd × effectiveRate`), `costUsd`.
- Campos duales del spread: `pricingMode`, `priceBsUsdRef`, `sellByUnit`,
  `unitPriceUsd`, `unitsPerPackage`.

Comparar solo esos campos; si nada cambió, devolver el ítem tal cual.

## Guardarraíles

1. **Producto eliminado**: NO borrar la línea (venta en curso). Marcar
   `_productMissing: true`; CartPanel muestra badge "producto ya no existe". La venta
   se completa con los datos del snapshot (comportamiento actual).
2. **No-tocables**: líneas `isCashAdvance` y productos custom (sin `_originalId` en
   catálogo) se excluyen.
3. **No tocar**: `qty`, `id`, `_mode`, `_unitsPerPackage`, `isWeight` — el modo de
   venta ya elegido no se retro-cambia aunque el producto mutó (ej. dejó de ser
   granel); evita corromper cantidades.
4. **`name`**: solo si cambió el nombre base, respetando sufijo " (Ud.)" en modo unit.
5. **Toast agregado**: máx. 1 por batch — "N precios actualizados en la cesta"; con
   detalle por ítem si es 1 solo ("Precio de X: $22.00 → $23.00").
6. **Un solo escritor**: absorber/deprecar el efecto `tasaCop` existente (sus ítems
   con `priceCop` quedan cubiertos por el resync) para evitar writes duales al carrito.
7. **Hidratación**: la cesta persiste en `bodega_pending_cart_v1` (~365–370); el
   efecto corre al hidratar + al cargar `products` (deps `[cart, products, tasaCop,
   effectiveRate]`), así una cesta pendiente de ayer despierta ya sincronizada.
8. **Persistir el resultado**: el `setCart` del resync pasa por el mismo debounce de
   guardado existente — sin camino aparte.

## Fases

### Fase A — Núcleo puro + tests (sin UI)
`src/utils/cartSync.js` con `deriveCartFields` extraído y reutilizado por
`addToCart` (de-duplicar la fórmula). Matriz de tests.

### Fase B — Cableado en SalesView
Efecto con el núcleo + toast agregado + absorción del efecto `tasaCop`.
Feature flag de escape `cart_live_resync` (default ON, localStorage, junto a
`allow_negative_stock` en Configuración → Ventas); quitar tras un ciclo de releases.

### Fase C — UX del edge case
Badge "producto ya no existe" para `_productMissing` en CartPanel.

### Fase D — QA
Matriz manual phone/PC + correr E2E existente de checkout.

## Criterios de aceptación

1. Repro del incidente: producto dual en cesta → quitar Doble Precio en inventario →
   la línea pierde `pricingMode`/`priceBsUsdRef` y pagar en Bs ya NO re-precia
   (sin quitar/re-agregar).
2. Cambio de precio en inventario se refleja con toast; `qty` intacta.
3. Anticipos/customs intactos; producto eliminado → línea sobrevive con badge.
4. Cero loops: con `products` re-render pero sin cambios de pricing, no hay `setCart`.
5. `tests/e2e/checkout-movil.e2e.spec.js` pasa sin cambios.

## Tests (tests/cartResync.test.js)

- El caso del incidente (dual → tasa_dia en el catálogo).
- Precio USD cambia / precio COP cambia con `tasaCop` vigente.
- Modo `'unit'`: derivados de bulto recalculados.
- Producto eliminado → `_productMissing`, línea intacta.
- Custom/anticipo → ignorados.
- Sin cambios → `null` (contract: no re-render).
- Granel toggle → `qty`/`isWeight` preservados.
