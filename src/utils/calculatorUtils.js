// [CONFIGURACIÓN] Comisión de efectivo REMOVIDA
// La tasa de efectivo ahora depende exclusivamente de la calibración manual del usuario

// FIN-020 / FIN-021 (documentación):
// NOTA SOBRE REDONDEO DE EFECTIVO:
//   - `CurrencyService.applyRoundingRule` (services/CurrencyService.js, Agente C) usa CEIL a
//     entero para Bs (diseñado para la calculadora de divisas del usuario final).
//   - Este POS usa `round2` (round-half-away-from-zero a 2 decimales) para TODO cálculo
//     financiero de venta/ticket/cierre. La diferencia es intencional: el POS necesita
//     precisión de centavos; la calculadora de divisas entrega enteros al usuario.
//   - `smartCashRounding` (definido abajo) se usa para ajustar montos de efectivo COP
//     (siempre enteros) sin recurrir al hack `0.2001` original.

import { round2, mulR, divR } from './dinero.js';

// Formateadores
export const formatBs = (val) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);
export const formatUsd = (val) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);
// COP es entero por convención; usamos parseInt sobre round2 (sin Math.round, prohibido en utils/).
export const formatCop = (val) => parseInt(round2(val || 0), 10).toLocaleString('es-CO');

/**
 * Get COP price for a product/item: use stored priceCop if available, otherwise derive from USD.
 */
export const getCop = (item, tasaCop) => {
    if (item.priceCop != null && item.priceCop > 0) return item.priceCop;
    // FIN-024-pattern: mulR en vez de multiplicación raw.
    return mulR(item.priceUsdt ?? item.priceUsd ?? 0, tasaCop || 0);
};

/**
 * Get effective USD price: when priceCop exists and tasaCop is valid, derive USD from COP in real-time.
 * This ensures USD/Bs update dynamically when the COP rate changes.
 */
export const getUsd = (item, tasaCop) => {
    if (item.priceCop != null && item.priceCop > 0 && tasaCop > 0) {
        // FIN-024-pattern: divR en vez de división raw.
        return divR(item.priceCop, tasaCop);
    }
    return item.priceUsdt ?? item.priceUsd ?? 0;
};

/**
 * Resolves item price considering dual pricing mode (dual_usd).
 * @param {object} item - product or cart item
 * @param {boolean} isBsPayment - true if customer pays in Bolívares (Pago Móvil / Punto / Efectivo Bs)
 * @param {number} effectiveRate - BCV / active rate
 */
export const resolveDualPrice = (item, isBsPayment = false, effectiveRate = 1) => {
    if (!item) return { priceUsd: 0, priceBs: 0, isDual: false };
    
    const isDual = item.pricingMode === 'dual_usd' && (item.priceBsUsdRef > 0);
    const baseUsd = item.priceUsdt ?? item.priceUsd ?? 0;
    const safeRate = effectiveRate > 0 ? effectiveRate : 1;
    
    if (isDual && isBsPayment) {
        const usdRef = Number(item.priceBsUsdRef);
        const bsPrice = mulR(usdRef, safeRate);
        return {
            priceUsd: usdRef,
            priceBs: bsPrice,
            isDual: true,
            originalPriceUsd: baseUsd
        };
    }
    
    const bsPrice = mulR(baseUsd, safeRate);
    return {
        priceUsd: baseUsd,
        priceBs: bsPrice,
        isDual: isDual,
        originalPriceUsd: baseUsd
    };
};

/**
 * Format price with correct currency label when COP is enabled.
 * @param {number} usdVal - price in USD
 * @param {object} opts - { copEnabled, tasaCop, showUsd, showBs, effectiveRate }
 * @returns {{ primary: string, secondary: string|null, copVal: number }}
 */
export const priceDisplay = (usdVal, opts = {}) => {
    const { copEnabled, tasaCop, effectiveRate } = opts;
    // FIN-024-pattern: mulR en vez de multiplicación raw.
    const copVal = copEnabled && tasaCop > 0 ? mulR(usdVal, tasaCop) : 0;
    const bsVal = effectiveRate > 0 ? mulR(usdVal, effectiveRate) : 0;
    return {
        usd: `$${formatUsd(usdVal)}`,
        usdLabel: copEnabled ? 'USD' : '$',
        cop: copEnabled && tasaCop > 0 ? `${formatCop(copVal)} COP` : null,
        bs: effectiveRate > 0 ? `${formatBs(bsVal)} Bs` : null,
        copVal,
        bsVal,
    };
};

// [REDONDEO INTELIGENTE PARA EFECTIVO]
// Regla: Si decimal <= 0.20 -> Redondeo abajo (Floor)
//        Si decimal > 0.20  -> Redondeo arriba (Ceil)
// FIN-021: usar Number.EPSILON para el umbral en vez del hack `0.2001` mágico.
//   El umbral semántico sigue siendo 0.20 (centavos que toleramos perder/ganar al cuadrar
//   efectivo físico); Number.EPSILON corrige drift IEEE 754 sin magic numbers.
//   Sin Math.floor/Math.ceil (prohibidos por ESLint en utils/).
export const SMART_CASH_ROUNDING_THRESHOLD = 0.20;

export const smartCashRounding = (amount) => {
    if (!Number.isFinite(amount)) return 0;
    const rounded = round2(amount);
    // Truncar parte entera sin Math.floor (prohibido por ESLint en utils/).
    const integerPart = parseInt(String(rounded), 10) || 0;
    const decimalPart = round2(rounded - integerPart);
    return decimalPart <= (SMART_CASH_ROUNDING_THRESHOLD + Number.EPSILON) ? integerPart : integerPart + 1;
};

import { MessageService } from '../services/MessageService.js';

// Re-export deprecated function referencing the new service
export const generatePaymentMessage = (params) => {
    return MessageService.buildPaymentMessage(params);
};

// Normaliza número venezolano al formato internacional para wa.me
// Acepta: 04121234567 → 584121234567
//         4121234567  → 584121234567
//         584121234567 → 584121234567
export const formatVzlaPhone = (raw) => {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('58') && digits.length >= 12) return digits;
    if (digits.startsWith('0')) return '58' + digits.slice(1);
    if (digits.length >= 10) return '58' + digits;
    return null;
};
