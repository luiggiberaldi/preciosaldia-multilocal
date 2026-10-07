# Plan · Lente de Crédito Extendido (H2 · opción C, punto medio)

**Fecha**: 2026-09-20 · **Origen**: hallazgo H2 de la auditoría E2E
(`AUDITORIA-E2E-FLUJOS.md`) y decisión pendiente de producto.

## El problema, en una frase

Cuando un fiado consume saldo a favor, la cartera neta no sube (`deuda` queda en 0),
así que **las listas de Clientes no muestran ese crédito**: un cobrador que recorre
«Clientes con deuda» no ve a Juan, aunque este mes le fiaste $3 de mercancía.

## Decisión de producto que implementa este plan

**Opción C (punto medio)**: la matemática de cartera **no se toca** (sigue neta, como
hoy); lo que cambia es la **visibilidad**: las listas de Clientes leen del ledger y
muestran el crédito extendido del mes, con y sin consumición de saldo a favor.

## No-objetivos (guardarraíles de alcance)

1. **No se cambia `transitionCustomerBalance`, `snapshotCustomerBalance` ni ningún
   cálculo de `deuda`/`favor`.** El lente es de **solo lectura**.
2. No se reconstruye «deuda bruta histórica»: el ledger no rastrea qué fiado consumió
   qué favor, y pretender reconstruirlo sería inventar datos. La ventana es **el mes en
   curso** (la que usa un cobrador).
3. No se migran clientes ni se toca `accountVersion`.
4. No se duplican superficies: el reporte de fiados y el PDF del cierre **ya cuentan**
   el fiado desde las ventas (`fiadoUsd`); este plan solo cubre la vista de Clientes.

## Diseño

### Fuente de verdad

`bodega_customer_ledger_v1` (append-only). Tipos relevantes ya existentes en
`customerLedger.js`:

| Movimiento | Significado | ¿Cuenta para el lente? |
|---|---|---|
| `CREDIT_SALE` («Venta fiada») | crédito extendido al cliente | **sí, suma** `fiadoMes` |
| `CREDIT_USED` («Saldo favor usado») | favor consumido en una venta | **sí, suma** `consumoFavorMes` |
| `REVERSAL` («Anulación») | reversión de un movimiento | **resta** del contador cuyo `sourceId` base coincida |
| `DEBT_PAYMENT`, `CHANGE_CREDITED`, `REFUND_CREDIT`, ajustes | cobranzas/creditos varios | no (no es crédito extendido) |

**Invariantes del lente** (verificadas en tests):
- `netoMes = fiadoMes − consumoFavorMes` (por construcción).
- Una venta anulada **no cuenta**: su `REVERSAL` la compensa (doble defensa: además se
  excluyen `sourceSaleId` de ventas con `status === 'ANULADA'` si se pasa la lista).
- Movimientos de meses anteriores no cuentan (mes actual calculado con `now` **inyectado**
  para determinismo en tests).
- El lente **nunca escribe**: función pura, sin efectos, sin mutar `customers`.

### Trabajo 1 · Núcleo puro `src/utils/customerCreditLens.js`

```js
buildCustomerCreditLens(ledger, customers, { now }) → {
    byCustomer: { [customerId]: { fiadoMes, consumoFavorMes, netoMes, fiadoCount } },
    totalFiadoMes, totalConsumoFavorMes,
}
```

- Una sola pasada sobre el ledger, filtrando mes en curso con `now` (default `new Date()`,
  inyectable en tests).
- Mes de un movimiento: el campo de fecha que ya usan los movimientos (verificar el nombre
  exacto — `timestamp` o `createdAt` — en el Trabajo 1; el test del inyector lo congela).
- Reversión: `REVERSAL` con el mismo `sourceId` base (`<saleId>:fiado`) resta.
- Solo lectura de `customers` (para nombres; no para saldos).

**Tests** (`tests/customerCreditLens.test.js`, nacidos con el código):
1. Fiado a cliente con favor: `fiadoMes=3`, `consumoFavorMes=3`, `netoMes=0` — **el caso
   invisible hoy, visibles sus dos patas**.
2. Fiado sin favor (deuda real): `fiadoMes=5`, `consumoFavorMes=0`, `netoMes=5`.
3. Fiado parcialmente cubierto: favor 2, fiado 5 → `fiadoMes=5`, `consumoFavorMes=2`.
4. Anulada: fiado + reversión → `fiadoMes=0` (y `fiadoCount` conserva el intento, ver 4b).
5. Venta anulada pasando `sales`: excluida aunque falte el `REVERSAL` (doble defensa).
6. Mes anterior excluido (dos movimientos idénticos, `now` fijo).
7. Invariante global: `totalFiadoMes − totalConsumoFavorMes = Σ netoMes`.
8. Ledger vacío / cliente sin movimientos → ceros, nunca `NaN`.
9. Montos redondeados a 2 decimales (`round2`).

### Trabajo 2 · Superficie en Clientes (`src/views/CustomersView.jsx`)

1. **Chip de filtro nuevo** junto a «Todos / Con Deuda / A Favor»:
   **«Fiados del mes»** (`filterType === 'fiadoMes'`): lista clientes con
   `byCustomer[id].fiadoMes > 0`. Un cliente con fiado consumido por favor **aparece
   aquí aunque su deuda sea 0** — ese es el punto del plan.
2. **Línea en la tarjeta de cliente** (solo cuando `fiadoMes > 0`):
   `Fiado este mes: $X` + variante `· $Y de su saldo a favor` cuando `consumoFavorMes > 0`.
   Destaca especialmente en el caso deuda=0 (hoy invisible).
3. **Resumen superior** (opcional pero recomendado, una línea):
   `Crédito extendido este mes: $A · consumido de saldo a favor: $B`.
4. `useMemo` con el lente: una pasada, cero escrituras. Si el ledger crece, el coste es
   lineal y solo al renderizar la vista.

### Trabajo 3 · E2E en el arnés (F13) + guardarraíles

Nuevo flujo **F13 «lente de fiados del mes»** en `tests/e2e/auditoria-flujos.e2e.spec.js`:
1. Sembrar cliente con favor (reusa la siembra de F3b) + fiarle (el mismo camino de F3b).
2. Ir a Clientes → verificar: chip «Fiados del mes» visible y **contiene a Juan**;
   tarjeta muestra «Fiado este mes: $3»; filtro «Con Deuda» **no** lo muestra (consistente
   con la cartera neta).
3. Anular la venta desde Reportes → volver a Clientes → Juan ya **no** aparece en
   «Fiados del mes» (la reversión lo compensa).
4. Guardarraíles del arnés habituales: 0 errores de consola, 0 desbordes a 320px,
   estado persistido en IndexedDB intacto (el lente no mutó nada: `deuda`/`favor`
   idénticos antes y después).

### Criterios de aceptación

- [ ] El cobrador puede responder «¿a quién le fié este mes?» desde Clientes, incluso
      cuando el fiado se consumió el saldo a favor.
- [ ] F13 verde con los 4 guardarraíles.
- [ ] Los 9 tests del núcleo verdes; suite completa sin regresiones.
- [ ] Ningún cambio en `deuda`/`favor`/ledger: diff revisado, solo lectura.
- [ ] ESLint 0 errores (nada de `parseFloat`/`toFixed` financieros: `round2`).

### Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Nombre del campo de fecha difiere entre movimientos legacy | Trabajo 1 lo inspecciona primero; el test congela el contrato |
| `REVERSAL` no siempre trae `sourceId` espejado | Doble defensa con `sales[].status === 'ANULADA'`; test 4/5 |
| Ledger grande → render lento | Una pasada + `useMemo`; medir con un ledger de 5k movimientos en el test del núcleo (budget: <50ms) |
| Doble conteo con reportes | Fuera de Reportes: solo Clientes (no-objetivo 4) |

### Fuera de alcance para siempre en este plan

Cartera bruta (opción B): cambiar la matemática, migrar clientes existentes, rehacer
abonos/anulaciones/Cashea. Si algún día se quiere, será un plan propio con su propio
análisis de riesgo — este plan deliberadamente no abre esa puerta.
