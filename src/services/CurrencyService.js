/**
 * Service responsible for monetary calculations and formatting rules.
 * Follows SRP: Only handles number crunching and string formatting related to currency.
 */
export const CurrencyService = {
    /**
     * Safely parses a string or number input into a float.
     * Handles comma/dot replacements and empty strings.
     *
     * HOOK-037: Detecta formato europeo (1.234,56) vs anglosajón (1,234.56)
     * y normaliza correctamente. Antes, `replace(/,/g, '.')` convertía
     * "1,234.56" → "1.234.56" → parseFloat tomaba "1.234" (perdiendo los 56).
     *
     * Reglas:
     *  - Si solo hay ',' o solo '.', se trata como separador decimal.
     *  - Si hay ambos, el ÚLTIMO separador es el decimal; el otro es de miles
     *    y se elimina.
     *  - Strings sin separadores → parseFloat directo.
     *
     * @param {string|number} val
     * @returns {number}
     */
    safeParse: (val) => {
        if (!val || val === '.') return 0;
        if (typeof val === 'number') return val;

        let s = val.toString().trim();
        if (!s) return 0;

        // Quitar todo lo que no sea dígito, coma o punto.
        s = s.replace(/[^\d.,]/g, '');
        if (!s) return 0;

        const lastDot = s.lastIndexOf('.');
        const lastComma = s.lastIndexOf(',');

        if (lastDot === -1 && lastComma === -1) {
            // "1234" → 1234
            return parseFloat(s) || 0;
        }

        if (lastDot !== -1 && lastComma !== -1) {
            // Ambos presentes: el último es decimal, el otro es miles.
            if (lastDot > lastComma) {
                // Formato anglosajón: "1,234.56" → quitar comas, dejar punto.
                s = s.replace(/,/g, '');
            } else {
                // Formato europeo: "1.234,56" → quitar puntos, cambiar coma por punto.
                s = s.replace(/\./g, '').replace(',', '.');
            }
        } else if (lastComma !== -1) {
            // Solo coma. Asumir decimal europeo.
            // Pero si hay múltiples comas, son separadores de miles (formato europeo raro).
            const commaCount = (s.match(/,/g) || []).length;
            if (commaCount > 1) {
                // "1,234,567" → formato europeo de miles → eliminar todas.
                s = s.replace(/,/g, '');
            } else {
                // Una sola coma → separador decimal.
                s = s.replace(',', '.');
            }
        } else {
            // Solo punto. Si hay múltiples, son miles.
            const dotCount = (s.match(/\./g) || []).length;
            if (dotCount > 1) {
                // "1.234.567" → eliminar todos (miles).
                s = s.replace(/\./g, '');
            }
            // Si hay un solo punto, lo dejamos como decimal.
        }

        return parseFloat(s) || 0;
    },

    /**
     * Applies business rules for rounding based on currency type.
     * VES: Always CEIL to integer.
     * Others: Fixed to 2 decimals.
     * @param {number} value 
     * @param {string} currencyId 
     * @returns {string}
     */
    applyRoundingRule: (value, currencyId) => {
        if (currencyId === 'VES') return Math.ceil(value).toString();
        // Ensure we handle cases where toFixed might be needed even for small numbers
        return value.toFixed(2);
    },

    /**
     * Calculates the exchange result.
     * @param {number} amount 
     * @param {number} rateFrom 
     * @param {number} rateTo 
     * @returns {number}
     */
    calculateExchange: (amount, rateFrom, rateTo) => {
        if (!rateTo || rateTo === 0 || !rateFrom) return 0;
        return (amount * rateFrom) / rateTo;
    }
};
