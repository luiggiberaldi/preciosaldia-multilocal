/**
 * Service responsible for determining appropriate exchange rates and contexts.
 * Decouples rate logic from UI/Chat components.
 * NOTE: USDT support removed — PreciosAlDía only uses BCV rates.
 */
export const RateService = {
    /**
     * Normalizes loose currency input to standard codes.
     * @param {string} c - Currency input (e.g. "bolivares", "dolares")
     * @returns {string} - 'VES', 'EUR', or 'USD'
     */
    normalizeCurrencyCode: (c) => {
        if (!c) return 'USD';
        const upper = c.toUpperCase();
        if (['BS', 'BOLIVARES', 'BOLÍVARES', 'VES', 'BOLIVAR'].includes(upper)) return 'VES';
        if (['USDT', 'TETHER', 'BINANCE', 'TETER', 'USD', 'DOLAR', 'DOLARES', 'DÓLAR', 'DÓLARES'].includes(upper)) return 'USD';
        if (['EUR', 'EURO'].includes(upper)) return 'EUR';
        return 'USD';
    },

    /**
     * Determines the rate to use, the name of the rate, and the target currency
     * based on the input currency and desired target.
     *
     * HOOK-036: Ahora devuelve `stale: true` cuando la tasa BCV (o Euro, según
     * currency) es 0/null/inválida, para que el caller pueda mostrar un aviso
     * "tasa desactualizada" y/o usar fallback.
     *
     * @param {string} currency - Normalized Source Currency (VES, USD, EUR)
     * @param {string} target - Normalized Target Currency (or null/undefined)
     * @param {object} rates - The rates object containing { bcv, euro }
     * @returns {object} { rateUsed, rateName, target, stale }
     */
    getExchangeContext: (currency, target, rates) => {
        let rateUsed = 0;
        let rateName = '';

        // Auto-detect target if not specified
        let effectiveTarget = target;
        if (!effectiveTarget || effectiveTarget === currency) {
            effectiveTarget = currency === 'VES' ? 'USD' : 'VES';
        }

        // Map USDT to USD for backward compat
        if (currency === 'USDT') currency = 'USD';
        if (effectiveTarget === 'USDT') effectiveTarget = 'USD';

        const bcvPrice = rates?.bcv?.price || 0;
        const euroPrice = rates?.euro?.price || 0;

        // HOOK-036: stale detection. Si la tasa relevante es 0/null, marcamos stale.
        // La tasa relevante depende del flujo: USD→VES usa BCV; EUR→VES usa Euro.
        let stale = false;

        if (currency === 'USD') {
            if (effectiveTarget === 'EUR') {
                rateUsed = euroPrice ? bcvPrice / euroPrice : 0;
                rateName = 'Cross (USD → EUR)';
                // Si ambos precios son necesarios y falta uno, stale.
                stale = !(bcvPrice > 0 && euroPrice > 0);
            } else {
                rateUsed = bcvPrice;
                rateName = 'Tasa BCV';
                effectiveTarget = 'VES';
                stale = !(bcvPrice > 0);
            }
        } else if (currency === 'EUR') {
            if (effectiveTarget === 'USD') {
                rateUsed = bcvPrice ? euroPrice / bcvPrice : 0;
                rateName = 'EUR → USD (Implícito)';
                effectiveTarget = 'USD';
                stale = !(bcvPrice > 0 && euroPrice > 0);
            } else {
                rateUsed = euroPrice;
                rateName = 'Tasa Euro BCV';
                effectiveTarget = 'VES';
                stale = !(euroPrice > 0);
            }
        } else if (currency === 'VES') {
            if (effectiveTarget === 'EUR') {
                rateUsed = euroPrice ? 1 / euroPrice : 0;
                rateName = 'Compra EUR';
                stale = !(euroPrice > 0);
            } else {
                rateUsed = bcvPrice ? 1 / bcvPrice : 0;
                rateName = 'Compra USD (BCV)';
                effectiveTarget = 'USD';
                stale = !(bcvPrice > 0);
            }
        }

        return { rateUsed, rateName, target: effectiveTarget, stale };
    }
};
