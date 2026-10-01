import { round2, mulR, divR } from './dinero';

/**
 * fase6Money.js — Helpers puros de los fixes monetarios de Fase 6 (B-5, B-6, B-7).
 *
 * Se extrajeron del código inline de los componentes para poder probarlos sin
 * React. Cada función documenta el hallazgo que corrige.
 *
 * @module utils/fase6Money
 */

/**
 * B-6: convierte el monto de un avance de efectivo a USD.
 * El monto ya viene en la moneda elegida por el operador; solo se divide
 * entre la tasa cuando es Bs. Antes dividía siempre → un avance en USD
 * quedaba subvaluado por el BCV.
 *
 * @param {number|string} totalCobrado
 * @param {'BS'|'USD'} currency
 * @param {number} effectiveRate
 * @returns {number}
 */
export function advancePriceUsdt(totalCobrado, currency, effectiveRate) {
    const total = Number(totalCobrado) || 0;
    if (currency === 'BS') {
        const rate = effectiveRate > 0 ? effectiveRate : 1;
        return total / rate;
    }
    return total;
}

/**
 * B-7: convierte un monto en COP a USD.
 * Sin tasa COP válida el método aporta 0 (antes caía silenciosamente al
 * divisor de bolívares, inflando o desinflando el total pagado).
 *
 * @param {number|string} amountCop
 * @param {number} tasaCop
 * @returns {number}
 */
export function copToUsd(amountCop, tasaCop) {
    const v = Number(amountCop) || 0;
    return tasaCop > 0 ? v / tasaCop : 0;
}

/**
 * B-5: "Entregar en Bs" entrega TODO el vuelto en bolívares.
 * Antes aplicaba el split mixto aunque no hubiera propuesta factible
 * (el rótulo era engañoso).
 *
 * @param {number} changeToDeliverUsd - Vuelto a entregar, en USD.
 * @param {number} safeRate - Tasa Bs/USD validada.
 * @returns {number} Vuelto en Bs, redondeado a 2 decimales.
 */
export function bsOnlyChange(changeToDeliverUsd, safeRate) {
    return round2(mulR(changeToDeliverUsd, safeRate));
}

/**
 * B-7 (totalPagadoBS): convierte un método de pago a su aporte en Bs.
 * El COP sin tasa válida aporta 0 en vez de caer al divisor de Bs.
 *
 * @param {{ tipo: string, monto: number|string }} method
 * @param {number} safeRate
 * @param {number} safeTasaCop
 * @returns {number}
 */
export function paymentMethodToBs(method, safeRate, safeTasaCop) {
    const v = Number(method?.monto) || 0;
    // COP → USD → Bs. Sin tasa válida aporta 0 (no cae al divisor de Bs).
    if (method?.tipo === 'COP') {
        return (safeTasaCop > 0 && safeRate > 0) ? mulR(divR(v, safeTasaCop), safeRate) : 0;
    }
    if (method?.tipo === 'BS') return v;
    return safeRate > 0 ? mulR(v, safeRate) : 0;
}

/**
 * B-12: indica si una venta debe excluirse de los reportes financieros
 * (anuladas no suman en el Modo Jefe).
 *
 * @param {object} sale
 * @returns {boolean}
 */
export function isVoidedSale(sale) {
    return sale?.status === 'ANULADA' || Boolean(sale?.voidedAt);
}

/**
 * B-16: limpia nombre y RIF del negocio (trim + límites).
 *
 * @param {string} name
 * @param {string} rif
 * @returns {{ name: string, rif: string }}
 */
export function cleanBusinessData(name, rif) {
    return {
        name: String(name || '').trim().slice(0, 60),
        rif: String(rif || '').trim().toUpperCase().slice(0, 20),
    };
}

/**
 * B-11: capitaliza la primera letra de cada palabra, con soporte Unicode
 * (ñ, acentos). La versión anterior usaba \w (ASCII) y dejaba "ñandú" sin
 * capitalizar.
 *
 * @param {string} name
 * @returns {string}
 */
export function titleCaseUnicode(name) {
    return String(name || '').trim().replace(/(^[\p{L}])|([\s]+[\p{L}])/gu, (letter) => letter.toUpperCase());
}

// Re-export para que los llamadores no necesiten importar dinero.js.
export { divR };
