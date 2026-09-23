# Plan: Vuelto Realista — desglose billetes USD + resto en Bs

> Problema: en Venezuela el efectivo USD circulante es solo billetes (no hay monedas de dólar).
> El botón "Entregar todo" actual registra `changeUsdGiven = $6.20`, un monto físicamente
> imposible de entregar. En la práctica el cajero SIEMPRE debe desglosar ($6 en billetes +
> $0.20 × tasa en Bs), pero eso cuesta abrir "Personalizar" y escribir a mano — y el atajo
> de un toque registra una mentira en la auditoría.

Objetivo: **un toque que registre la verdad** — la mayor cantidad entregable en billetes
enteros de USD, y el resto convertido a Bs a la tasa vigente.

---

## Principios

1. **Cero cambios en el esquema de registro de la venta.** El split se registra con los
   campos que ya existen: `changeUsdGiven` + `changeBsGiven` (los consume
   `checkoutProcessor.js` y los reportes de supervisor ya los suman). Solo cambia
   *quién llena los campos y con qué valores*.
2. **Función pura primero, UI después.** Todo el cálculo vive en un módulo nuevo testeable,
   sin React.
3. **El default es el desglose realista; "todo en dólares" pasa a ser opción explícita**
   dentro de Personalizar (útil solo cuando el cambio es redondo, ej. $6.00 exactos).
4. **La caja manda.** La propuesta respeta el fondo de caja real: nunca proponer entregar
   más USD del que hay en caja.

---

## Fase 0 — Núcleo puro: `src/utils/changeSplit.js` + tests

API propuesta (nombres en español neutro, misma convención que `granel.js`):

```js
computeRealisticSplit({
    changeUsd,          // vuelto total a entregar (ej. 6.20)
    rate,               // tasa Bs/USD vigente (safeRate ya validada)
    smallestUsdBill,    // default 1 — ajustable por tienda
    bsRoundStep,        // default 0 — sin redondeo; ej. 1 → redondeo a Bs entero
    floatUsd,           // efectivo USD disponible en caja hoy (soft limit)
}) // → {
//     usdPart,        // 6.00  — múltiplo entero de smallestUsdBill, ≤ floatUsd
//     bsExact,        // 15.95 — (changeUsd − usdPart) × rate, round2
//     bsPart,         // 15    — bsExact redondeado a bsRoundStep (a favor del cliente: floor)
//     remainderUsd,   // 0     — lo que queda sin cubrir si ni USD ni Bs alcanzan
//     source,         // 'ideal' | 'downgraded-float' | 'all-bs' | 'exact-usd'
// }

stepSplitDown(split, rate, smallestUsdBill) // para el stepper de un toque
stepSplitUp(split, rate, smallestUsdBill)
```

Reglas:

- `usdPart = floor(changeUsd / smallestUsdBill) × smallestUsdBill`; si `usdPart > floatUsd`,
  baja escalones hasta caber (`source: 'downgraded-float'`).
- Si `changeUsd < smallestUsdBill` o `floatUsd` no alcanza ni un billete → **todo en Bs**
  (`source: 'all-bs'`, `usdPart = 0`).
- Si `changeUsd` es entero exacto (ej. $6.00) → `source: 'exact-usd'`, `bsPart = 0`.
- El redondeo en Bs es **a favor del cliente** (floor): Bs 15,95 → Bs 15 con paso 1.
  Nunca por encima del exacto.
- `remainderUsd > 0` solo si ni USD ni Bs en caja cubren el vuelto → estado bloqueante
  para la Fase 3.

**Casos de test obligatorios** (los de esta conversación):

| Escenario | Entrada | Esperado |
|---|---|---|
| Caso imagen | $6.20, tasa 79.75, billete $1 | $6 + Bs 15.95 exacto (15 con paso 1) |
| Sin billetes de $1 | $6.20, floatUsd 5, billete $1 | $5 + Bs 95.70 (95 con paso 1) |
| Vuelto menor al billete | $0.80, billete $1 | $0 + Bs 63.80 (`all-bs`) |
| Cambio redondo | $6.00 | $6 + Bs 0 (`exact-usd`) |
| Caja USD vacía | $6.20, floatUsd 0 | $0 + Bs 494.45 (`all-bs`) |
| Ni USD ni Bs alcanzan | floatUsd 2, Bs insuficiente | `remainderUsd > 0` → bloqueo |

Tests en `tests/changeSplit.test.js`. **Sin tocar UI todavía.**

---

## Fase 1 — Fila inline con propuesta (CheckoutModal + MobileChangeAllocation)

En `MobileChangeAllocation.jsx` modo `inline`, estado `pending`:

- La fila muestra **el desglose propuesto** en vez de solo el monto:

  ```
  Vuelto $6.20 →  $6.00 en billetes + Bs 15,95     [Entregar así]
  Personalizar (caja parcial, Bs, billetera)
  ```

- Botón **"Entregar así"** → `deliverRealisticChange()`: llama a `computeRealisticSplit`
  y pre-llena `setChangeUsdGiven(usdPart)` + `setChangeBsGiven(bsPart)`.
  El pipeline de confirmación existente (`useCheckoutCalculations` → `checkoutProcessor`)
  no cambia absolutamente nada.
- Estados `partial`/`complete` quedan igual (ya funcionan con ambos campos llenos).
- "Entregar todo" (comportamiento actual) se muda al sheet de Personalizar como opción
  explícita **"Todo en dólares"**, mostrada solo cuando `changeUsd` es entero o con
  nota de que quedará fracción sin entregar en USD.
- `SalesView.jsx` ya calcula `currentFloat` (totales del día) → se pasa como `floatUsd`
  a `computeRealisticSplit`. Ya fluye hacia el modal (líneas 983-984); verificar que
  llegue también al `MobileChangeAllocation` inline.

**Coordonación necesaria:** estos archivos están siendo editados por otra sesión
(checkout móvil, staged sin commitear). Implementar esta fase sobre su versión
rebasada, no en paralelo.

---

## Fase 2 — Stepper de un toque + variante POS

- En la fila inline (o el sheet), stepper de la parte USD: `− $1` / `+ $1` (o el billete
  configurado). Cada paso recalcula Bs al instante con `stepSplitDown/Up`.
  Grabado con los mismos setters → mismo registro verdadero.
- **Paridad POS:** `CheckoutModalPOS/index.jsx` tiene su propio estado de split y su
  `ChangeConfirmationModal`. Repetir la propuesta ahí (la misma función pura, cero
  duplicación de cálculo). En POS el desglose ya es manual por diseño, así que el valor
  es pre-llenar la propuesta en `distVueltoUSD`/`distVueltoBS`.

---

## Fase 3 — Guardarraíles y ajustes de tienda

- **Bloqueo honesto:** si `remainderUsd > 0` (ni USD ni Bs alcanzan), la confirmación se
  detiene con opciones reales: acreditar a billetera del cliente, entrega parcial
  declarada, o cobro mixto distinto. (La advertencia de fondo de caja ya existe en el
  sheet; se vuelve exacta con el remainder.)
- **Ajustes (Configuración → Ventas):**
  - `checkout.smallestUsdBill` — default `1`.
  - `checkout.bsRoundStep` — default `0` (exacto); sugerir `1` para tiendas que redondean
    a bolívar entero.
- **Copy:** reemplazar el estado bloqueante "⚠️ ASIGNA EL VUELTO" por texto guía:
  "¿Ya le diste el cambio al cliente? Confírmalo" (solo aplica cuando hay split pendiente;
  con la propuesta de un toque, el estado pendiente será cada vez más raro).

---

## Fase 4 (opcional, posterior) — Denominaciones reales de caja

Hoy `currentFloat` solo lleva totales (suma de ventas del día, no inventario de billetes).
Extender el módulo de caja para rastrear **denominaciones** ("un $5, tres $10, cero $1")
haría la propuesta correcta sin intervención: con floatUsd 5 pero denominaciones
{5:1}, la propuesta sale $5 + Bs 95,70 directamente.

Depende de: modelo de datos de apertura/cierre de caja (persistir conteo por denominación),
UI de conteo en apertura/cierre, y conciliación. Es la única fase con costo de esquema —
por eso va al final y es opcional.

---

## Verificación final

- `tests/changeSplit.test.js` — matriz de la Fase 0 + stepper + redondeos.
- Tests de estado de la fila inline: pending muestra propuesta → "Entregar así" pre-llena
  ambos campos → `changeAllocationComplete` sin toques extra.
- E2E (Playwright, junto a la suite de checkout móvil): pagar $10 una venta de $3.80 →
  verificar que la venta registrada lleva `changeUsdGiven: 3, changeBsGiven: ≈15.95×0.20...`
  según tasa del fixture.
- Regresión: el flujo viejo "Personalizar → todo manual" sigue funcionando intacto.

## Fuera de alcance (explícito)

- No cambia el esquema de la venta ni los reportes de supervisor.
- No calcula billetes/monedas físicas a entregar (solo Fase 4 lo aproxima).
- No toca Cashea, COP ni billetera: solo el split físico USD/Bs del vuelto.
