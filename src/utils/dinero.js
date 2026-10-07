/**
 * dinero.js — Aritmética financiera segura
 *
 * Centraliza TODA la lógica de redondeo del sistema POS.
 * Usa round-half-away-from-zero (estándar financiero internacional).
 *
 * REGLA DE ORO: Toda operación aritmética con dinero DEBE pasar por estas funciones.
 *               Nunca usar Math.round, toFixed, o parseFloat para redondear montos.
 */

/**
 * Redondea `n` a `decimals` decimales con round-half-away-from-zero, sin el bug
 * clásico de IEEE-754 en el caso .5 (ej: 2.005 → 2.01, no 2.00).
 *
 * Técnica: desplazar el punto decimal operando sobre la representación en STRING
 * del número (vía notación exponencial `NeD`), no multiplicando el float. Multiplicar
 * (`n * 10**decimals`) reintroduce el error de representación en punto flotante y ese
 * error CRECE con la magnitud de `n` — para montos en Bs (que en un POS venezolano
 * fácilmente superan varios miles por la inflación) el enfoque ingenuo con
 * `Number.EPSILON` deja de funcionar a partir de 2^13 = 8192 porque a esa magnitud
 * el ULP del double ya excede EPSILON. El shift por string evita ese problema porque
 * usa el parser decimal correctamente redondeado del motor JS, no una multiplicación.
 * Verificado sin fallos en un scan exhaustivo de 1..2,000,000 con offset .005.
 *
 * @param {number} n
 * @param {number} decimals
 * @returns {number}
 */
function _shiftRound(n, decimals) {
    if (!Number.isFinite(n)) return 0;
    const sign = n < 0 ? -1 : 1;
    const abs = Math.abs(n);
    // Si es extremadamente pequeño, redondea a 0 de forma segura
    if (abs < 1e-12) return 0;
    const shifted = Number(`${abs}e${decimals}`);
    return sign * Number(`${Math.round(shifted)}e-${decimals}`);
}

/**
 * Redondea a 2 decimales (centavos) con round-half-away-from-zero.
 * @param {number} n - Número a redondear
 * @returns {number} Número redondeado a 2 decimales
 */
export const round2 = (n) => _shiftRound(n, 2);

/**
 * Redondea a 4 decimales (para tasas de cambio y precios unitarios internos).
 * @param {number} n
 * @returns {number}
 */
export const round4 = (n) => _shiftRound(n, 4);

/**
 * Redondea a 3 decimales (para cantidades de peso: gramos/kg en ventas por peso).
 * @param {number} n
 * @returns {number}
 */
export const round3 = (n) => _shiftRound(n, 3);

/**
 * Redondea a entero (round-half-away-from-zero).
 * Útil para Bs (política del POS: precios en Bs siempre a entero) y scores.
 * @param {number} n
 * @returns {number}
 */
export const round0 = (n) => _shiftRound(n, 0);

/**
 * Redondea hacia +infinito (ceil) a entero.
 * Política del POS para precios en Bolívares (siempre redondear Bs hacia arriba).
 * Reemplaza `Math.ceil` en código financiero.
 * @param {number} n
 * @returns {number}
 */
export const ceilR = (n) => {
    if (!Number.isFinite(n)) return 0;
    return Math.ceil(n);
};

/**
 * Redondea hacia abajo (floor) al múltiplo de `step` más cercano.
 * Política del POS para el desglose del vuelto en Bs (VUELTO-REALISTA) en modo
 * 'floor' (a favor de la tienda): nunca se registra más Bs de los que físicamente
 * se entregan (Bs 15,95 con paso 1 → Bs 15).
 * @param {number} n   Monto a redondear.
 * @param {number} step Paso de redondeo (> 0; ej. 1 = bolívar entero).
 * @returns {number} El mayor múltiplo de `step` que es ≤ n.
 */
export const floorR = (n, step = 1) => {
    if (!Number.isFinite(n) || !Number.isFinite(step) || step <= 0) return 0;
    const s = step;
    return round2(Math.floor(n / s + 1e-9) * s);
};

/**
 * Redondea hacia arriba (ceil) al múltiplo de `step` más cercano.
 * Política del POS para el desglose del vuelto en Bs (VUELTO-REALISTA) en modo
 * 'ceil' (default, a favor del cliente): el cliente nunca recibe menos por el
 * redondeo (Bs 15,95 con paso 1 → Bs 16).
 * @param {number} n   Monto a redondear.
 * @param {number} step Paso de redondeo (> 0; ej. 1 = bolívar entero).
 * @returns {number} El menor múltiplo de `step` que es ≥ n.
 */
export const ceilStepR = (n, step = 1) => {
    if (!Number.isFinite(n) || !Number.isFinite(step) || step <= 0) return 0;
    const s = step;
    return round2(Math.ceil(n / s - 1e-9) * s);
};

/**
 * Multiplica dos números y redondea a 2 decimales.
 * Para cadenas como precio * cantidad * tasa, encadenar: mulR(mulR(price, qty), rate)
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const mulR = (a, b) => round2((a || 0) * (b || 0));

/**
 * Divide dos números y redondea a 2 decimales.
 * Para conversiones de moneda: divR(montoBs, tasa) = montoUsd
 * @param {number} a - Numerador
 * @param {number} b - Denominador (si es 0, retorna 0)
 * @returns {number}
 */
export const divR = (a, b) => {
    if (!b || !Number.isFinite(b) || b === 0) return 0;
    return round2((a || 0) / b);
};

/**
 * Suma números o un array de números y redondea el resultado a 2 decimales.
 * Previene acumulación de drift en reduce().
 * @example sumR([1, 2, 3]) // 6
 * @example sumR(1, 2) // 3
 * @param {...number|number[]} args
 * @returns {number}
 */
export const sumR = (...args) => {
    const arr = Array.isArray(args[0]) ? args[0] : args;
    return round2(arr.reduce((a, b) => a + (b || 0), 0));
};

/**
 * Resta segura: a - b, redondeada a 2 decimales.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const subR = (a, b) => round2((a || 0) - (b || 0));

/**
 * Calcula cuánto vuelto sigue sin distribuir después de declarar una parte en
 * dólares y/o bolívares. Los dos montos representan destinos del mismo vuelto,
 * por eso se convierten a USD antes de restarlos.
 *
 * @param {number} totalUsd Vuelto total disponible en USD
 * @param {number} usdGiven Vuelto físico declarado en USD
 * @param {number} bsGiven Vuelto físico declarado en Bs
 * @param {number} rate Tasa Bs por USD
 * @returns {{ remainingUsd: number, remainingBs: number, givenUsd: number }}
 */
export const calculateChangeRemainder = (totalUsd, usdGiven = 0, bsGiven = 0, rate = 0) => {
    const givenUsd = sumR(
        Math.max(0, Number(usdGiven) || 0),
        rate > 0 ? divR(Math.max(0, Number(bsGiven) || 0), rate) : 0,
    );
    const remainingUsd = Math.max(0, subR(Math.max(0, Number(totalUsd) || 0), givenUsd));

    return {
        remainingUsd: round2(remainingUsd),
        remainingBs: rate > 0 ? mulR(remainingUsd, rate) : 0,
        givenUsd: round2(givenUsd),
    };
};
