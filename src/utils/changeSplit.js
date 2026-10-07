/**
 * changeSplit.js — Desglose realista del vuelto (VUELTO-REALISTA, Fase 0).
 *
 * Problema que resuelve:
 *   En Venezuela el efectivo USD circulante es solo billetes (no circulan monedas
 *   de dólar). "Entregar $6.20 en dólares" es físicamente imposible: la fracción
 *   ($0.20) solo puede salir en bolívares. El botón "Entregar todo" actual
 *   registraba `changeUsdGiven = 6.20`, un monto que la caja nunca entregó.
 *
 * Solución:
 *   Función pura que calcula el desglose ejecutable: la mayor cantidad entregable
 *   en billetes enteros de USD (respetando el efectivo real en caja) + el resto
 *   convertido a Bs a la tasa vigente, con redondeo opcional en Bs según la
 *   política de la tienda:
 *     - 'ceil' (default, a favor del cliente): Bs 15,95 con paso 1 → Bs 16.
 *     - 'floor' (a favor de la tienda):        Bs 15,95 con paso 1 → Bs 15;
 *       la diferencia queda como `remainderUsd` benigno (no es falta de cobertura).
 *
 * Regla de oro: toda la aritmética pasa por dinero.js. Cero parseFloat/toFixed
 * propios. Sin dependencias de React.
 *
 * Nota de alcance: la cobertura de Bs reales en caja (bloqueo honesto de Fase 3)
 * se evalúa upstream — este módulo solo modela billetes USD + conversión a Bs.
 */

import { round2, floorR, ceilStepR } from './dinero.js';

/**
 * floorDiv — división entera hacia abajo por pasos de billete, sin Math.floor
 * directo sobre dinero (regla del linter: toda aritmética de montos pasa por
 * dinero.js). Equivalente a floor(n / step) con tolerancia anti-float.
 * @param {number} n    Numerador (monto USD).
 * @param {number} step Denominador (valor del billete, > 0).
 * @returns {number} Cuántos billetes completos caben.
 */
function floorDiv(n, step) {
    return floorR(n / step + 1e-9, 1);
}

/** Epsilon financiero: umbral bajo el cual un resto se considera cubierto. */
const EPS = 0.005;

/**
 * Orígenes posibles del desglose (para auditoría/UI):
 *  - 'exact-usd':        el vuelto es múltiplo entero del billete → todo en USD, Bs 0.
 *  - 'ideal':            billetes completos + resto en Bs, sin recortes por caja.
 *  - 'downgraded-float': se recortó la parte USD porque la caja no tiene tanto efectivo.
 *  - 'all-bs':           no se puede entregar ni un billete (vuelto < billete o caja
 *                        vacía) → todo el vuelto sale en Bs.
 *  - 'no-rate':          no hay tasa de cambio → la fracción USD no es convertible.
 * @typedef {'exact-usd'|'ideal'|'downgraded-float'|'all-bs'|'no-rate'} SplitSource
 */

/**
 * Núcleo compartido: dado el vuelto total y la parte USD ya elegida, completa
 * el resto en Bs y deriva cobertura/remanente/origen.
 * @private
 */
function buildSplit({ changeUsd, usdPart, rate, bsRoundStep, bsRoundMode }) {
    const total = round2(Math.max(0, Number(changeUsd) || 0));
    const safeRate = Number(rate) > 0 ? Number(rate) : 0;
    const up = usdPart > 0 ? round2(usdPart) : 0;

    const restUsd = round2(Math.max(0, total - up));
    const bsExact = safeRate > 0 ? round2(restUsd * safeRate) : 0;
    let bsPart = bsExact;
    if (safeRate > 0 && bsRoundStep > 0 && restUsd > EPS) {
        bsPart = bsRoundMode === 'floor'
            ? floorR(bsExact, bsRoundStep)
            : ceilStepR(bsExact, bsRoundStep);
    }

    const coveredUsd = up + (safeRate > 0 ? bsPart / safeRate : 0);
    const remainderUsd = round2(Math.max(0, total - coveredUsd));
    const remainderBs = safeRate > 0 ? round2(remainderUsd * safeRate) : 0;

    let source;
    if (safeRate <= 0 && restUsd > EPS) source = 'no-rate';
    else if (up === 0 && restUsd > EPS) source = 'all-bs';
    else if (restUsd <= EPS) source = 'exact-usd';
    else source = 'ideal';

    return { usdPart: up, bsExact, bsPart, remainderUsd, remainderBs, source };
}

/**
 * Calcula el desglose realista del vuelto.
 *
 * @param {object} p
 * @param {number} p.changeUsd           Vuelto total a entregar, en USD (ej. 6.20).
 * @param {number} p.rate                Tasa Bs/USD vigente (> 0; ya validada upstream).
 * @param {number} [p.smallestUsdBill=1] Valor del billete USD más pequeño manejable.
 * @param {number} [p.bsRoundStep=0]     Paso de redondeo en Bs (0 = monto exacto).
 * @param {'ceil'|'floor'} [p.bsRoundMode='ceil']  Dirección del redondeo de la tienda.
 * @param {number} [p.floatUsd=Infinity] Efectivo USD disponible en caja hoy (soft limit).
 * @returns {{
 *   usdPart: number, bsExact: number, bsPart: number,
 *   remainderUsd: number, remainderBs: number, source: SplitSource
 * }} usdPart: múltiplo entero de smallestUsdBill entregable en billetes.
 *   bsExact: conversión exacta del resto a Bs. bsPart: bsExact con la política
 *   de redondeo de la tienda. remainderUsd: lo que el desglose no cubre
 *   (con 'ceil' es 0; con 'floor' es el centavo que la tienda retiene).
 */
export function computeRealisticSplit({
    changeUsd,
    rate,
    smallestUsdBill = 1,
    bsRoundStep = 0,
    bsRoundMode = 'ceil',
    floatUsd = Infinity,
}) {
    const total = round2(Math.max(0, Number(changeUsd) || 0));
    const bill = Math.max(Number(smallestUsdBill) || 1, 0.01);
    const cash = Number.isFinite(floatUsd) ? Math.max(0, floatUsd) : Infinity;
    const step = Math.max(0, Number(bsRoundStep) || 0);

    if (total <= EPS) {
        return { usdPart: 0, bsExact: 0, bsPart: 0, remainderUsd: 0, remainderBs: 0, source: 'exact-usd' };
    }

    // Parte USD: el mayor múltiplo entero de `bill` que no exceda el vuelto ni
    // el efectivo real en caja.
    let steps = floorDiv(total, bill);
    if (steps * bill > cash) {
        steps = floorDiv(cash, bill);
    }
    const usdPart = steps > 0 ? round2(steps * bill) : 0;

    const split = buildSplit({ changeUsd: total, usdPart, rate, bsRoundStep: step, bsRoundMode });
    if (split.source === 'ideal' && cash < total - EPS) {
        split.source = 'downgraded-float';
    }
    return split;
}

/**
 * Stepper "−": baja la parte USD un billete y recalcula el resto en Bs al
 * instante. Recibe SIEMPRE el vuelto total real (nunca reconstruye el total
 * desde el split redondeado: eso perdía centavos).
 * @param {object} p { changeUsd, split, rate, smallestUsdBill, bsRoundStep, bsRoundMode }
 * @returns {object} Nuevo split (no muta el original).
 */
export function stepSplitDown({ changeUsd, split, rate, smallestUsdBill = 1, bsRoundStep = 0, bsRoundMode = 'ceil' }) {
    const bill = Math.max(Number(smallestUsdBill) || 1, 0.01);
    const down = Math.max(0, (Number(split?.usdPart) || 0) - bill);
    return buildSplit({ changeUsd, usdPart: down, rate, bsRoundStep, bsRoundMode });
}

/**
 * Stepper "+": sube la parte USD un billete, sin pasarse del vuelto total.
 * @param {object} p { changeUsd, split, rate, smallestUsdBill, bsRoundStep, bsRoundMode }
 * @returns {object} Nuevo split.
 */
export function stepSplitUp({ changeUsd, split, rate, smallestUsdBill = 1, bsRoundStep = 0, bsRoundMode = 'ceil' }) {
    const bill = Math.max(Number(smallestUsdBill) || 1, 0.01);
    const total = round2(Math.max(0, Number(changeUsd) || 0));
    const up = Math.min(total, (Number(split?.usdPart) || 0) + bill);
    return buildSplit({ changeUsd: total, usdPart: up, rate, bsRoundStep, bsRoundMode });
}
