/**
 * barcodeNormalizer.js — Normalizador inteligente de códigos de barras.
 *
 * Resuelve el problema común de lectores de códigos de barra emulando teclado
 * cuando Bloq Mayús (Caps Lock) o Shift está activo en distribuciones de
 * teclado en español/latinoamericano (ej.: /%)))%)====" # -> 7599959000023).
 */

const SHIFT_TO_DIGIT_MAP = Object.freeze({
    // Español (España) y Latinoamericano
    '=': '0',
    '!': '1',
    '"': '2',
    '·': '3',
    '#': '3',
    '$': '4',
    '%': '5',
    '&': '6',
    '/': '7',
    '(': '8',
    ')': '9',
    // Fallback Teclado US Shift exclusivo
    '@': '2',
    '^': '6',
    '*': '8',
});

/**
 * Traduce caracteres con Shift producidos por el teclado a sus números correspondientes.
 * Elimina espacios en blanco internos introducidos por emuladores de escáner.
 * @param {string} raw - Cadena de texto cruda.
 * @returns {string} - Cadena traducida y limpia.
 */
export function unShiftBarcode(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const clean = raw.replace(/\s+/g, '');
    if (!clean) return '';
    let result = '';

    for (let i = 0; i < clean.length; i++) {
        const char = clean[i];
        if (SHIFT_TO_DIGIT_MAP[char] !== undefined) {
            result += SHIFT_TO_DIGIT_MAP[char];
        } else {
            result += char;
        }
    }

    return result;
}

/**
 * Determina si una cadena tiene estructura de código de barras (numérico o símbolos de código).
 * @param {string} raw - Cadena a evaluar.
 * @returns {boolean}
 */
export function isLikelyBarcode(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const clean = raw.replace(/\s+/g, '');
    if (clean.length < 3) return false;

    // Si ya es numérico puro de 3 a 24 dígitos
    if (/^\d{3,24}$/.test(clean)) return true;

    // Si al des-shiftear se convierte en numérico puro de 3 a 24 dígitos
    const unshifted = unShiftBarcode(clean);
    if (/^\d{3,24}$/.test(unshifted)) return true;

    return false;
}

/**
 * Normaliza un código de barras crudo considerando productos existentes y auto-traducción.
 * @param {string} raw - Código o texto ingresado por el usuario o escáner.
 * @param {Array} products - Lista de productos cargados en memoria.
 * @returns {string} - Código normalizado listo para búsqueda o inserción.
 */
export function normalizeBarcode(raw, products = []) {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';

    // 1. Si coincide directamente con algún código o ID registrado
    if (products.some(p => p.barcode === trimmed || String(p.id) === trimmed)) {
        return trimmed;
    }

    // 2. Intentar des-shiftear caracteres especiales
    const unshifted = unShiftBarcode(trimmed);

    // 3. Si la versión des-shifteada coincide con un producto
    if (products.some(p => p.barcode === unshifted || String(p.id) === unshifted)) {
        return unshifted;
    }

    // 4. Si la versión des-shifteada es puramente numérica de al menos 3 dígitos
    if (/^\d{3,24}$/.test(unshifted)) {
        return unshifted;
    }

    // 5. Si no se puede traducir a un formato numérico claro, devolver trimmed original
    return trimmed;
}
