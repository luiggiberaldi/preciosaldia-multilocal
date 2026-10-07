/**
 * reprice.js — Señal del re-precio en Bs (Doble Precio) para la UI.
 *
 * Cuando la cesta tiene ítems `dual_usd` y el cajero ingresa un pago en Bs,
 * `FinancialEngine.buildCartTotals(..., isBsPayment=true)` re-precia el ticket
 * con el precio de referencia (`priceBsUsdRef`). El total cambia en silencio y
 * el cajero lo percibe como un cálculo roto (AVISO-REPRECIO).
 *
 * Estas funciones son puras y centralizan el criterio para que el checkout
 * básico y el POS avisen exactamente en los mismos casos.
 */

import { round2 } from './dinero.js';

/**
 * ¿El ticket cambió de total por aplicar el precio de referencia en Bs?
 * Requiere que el pago en Bs esté activo Y que el total recalculado difiera
 * del base: si el Ref coincide con el precio USD, no hay nada que avisar.
 */
export function isTicketRepriced({ isBsPaymentActive = false, baseTotalUsd = 0, newTotalUsd = 0 } = {}) {
    if (!isBsPaymentActive) return false;
    return round2(Number(baseTotalUsd) || 0) !== round2(Number(newTotalUsd) || 0);
}

/** Diferencia (base − nuevo) en USD; positiva si el precio en Bs es menor. */
export function repriceDeltaUsd(baseTotalUsd = 0, newTotalUsd = 0) {
    return round2((Number(baseTotalUsd) || 0) - (Number(newTotalUsd) || 0));
}
