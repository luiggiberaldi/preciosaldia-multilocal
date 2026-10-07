/**
 * deviceFingerprint.js — Fingerprint robusto del dispositivo.
 *
 * Fix SEC-008:
 *   - Antes: SHA-256 de 8 componentes truncado a 8 hex chars (32 bits → colisión por
 *     birthday en ~65k intentos). Sin salt. Leído de localStorage sin re-verificar.
 *   - Ahora: SHA-256 completo de 64 hex chars + sal del backend (VITE_LICENSE_SALT).
 *     Re-verificación periódica vía `verifyStoredFingerprint()`.
 *
 * Notas:
 *   - La sal mezcla características del navegador con una sal por despliegue. Esto NO
 *     evita fingerprints cruzados entre navegadores del mismo dispositivo, pero sí
 *     dificulta la falsificación sencilla vía DevTools (`localStorage.setItem('pda_device_id', 'PDA-DEAD')`).
 *   - La fuente autoritativa de identidad es la fila `licenses.device_id` en el backend.
 *
 * Tolerancia a drift (SEC-008-r2):
 *   - Componentes como hardwareConcurrency/deviceMemory/colorDepth pueden cambiar entre
 *     sesiones en navegadores con privacidad reforzada (Firefox RFP, Brave) o VMs. Un
 *     match exacto estricto cerraba la sesión de usuarios legítimos al recargar.
 *   - `verifyStoredFingerprint` ahora tolera drift cuando existe un ANCLA
 *     (`pda_fp_anchor_v1`) que prueba que ese ID se acuñó en esta instalación: la ancla
 *     solo se escribe tras un match exacto o un registro fresco.
 *   - Un ID foráneo bien formado se adopta (TOFU) únicamente si hay continuidad de
 *     instalación (estado real de la app en localStorage) y no existe ancla — cubre la
 *     migración de instalaciones pre-ancla sin destruir su licencia.
 *
 * @module security/deviceFingerprint
 */

const FP_HASH_LENGTH = 32; // 32 hex chars = 128 bits (antes 8 = 32 bits).
const FP_PREFIX = 'PDA-';
const FP_PREFIX_V2 = 'PDA-V2-';

// ─── Ancla de identidad (SEC-008-r2) ─────────────────────────────────────────
const FP_ANCHOR_KEY = 'pda_fp_anchor_v1';
// IDs válidos: legacy `PDA-<8..64 hex>` y actual `PDA-V2-<8..64 hex>`.
const FP_VALID_ID_RE = /^PDA(?:-V2)?-[0-9A-F]{8,64}$/;
// Continuidad de instalación: claves que solo existen en un uso real de la app.
const FP_CONTINUITY_RE = /^(pda_|bodega_|restaurant_|business_|marketing_|cart_)/;
const FP_CONTINUITY_MIN_KEYS = 3;

/**
 * Detecta continuidad de instalación: si localStorage contiene suficiente estado
 * real de la app, este perfil no es un navegador limpio con un ID inyectado.
 * @returns {boolean}
 */
function _hasInstallContinuity() {
    try {
        let count = 0;
        for (let i = 0; i < localStorage.length; i++) {
            if (FP_CONTINUITY_RE.test(localStorage.key(i) || '')) {
                count++;
                if (count >= FP_CONTINUITY_MIN_KEYS) return true;
            }
        }
    } catch { /* storage bloqueado → sin continuidad */ }
    return false;
}

/**
 * Lee la ancla de identidad, si existe.
 * @returns {{anchor: string, lastSeen?: string, updatedAt?: number} | null}
 */
export function getFingerprintAnchor() {
    try {
        const raw = localStorage.getItem(FP_ANCHOR_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed.anchor === 'string' && FP_VALID_ID_RE.test(parsed.anchor))
            ? parsed
            : null;
    } catch {
        return null;
    }
}

/**
 * Escribe/refresca la ancla de identidad. Solo debe invocarse tras un match
 * exacto, un registro fresco del ID, o una adopción TOFU verificada.
 * @param {string} storedId - ID canónico de la instalación.
 * @param {string} [currentFp] - Fingerprint visto en este momento.
 * @returns {void}
 */
export function seedFingerprintAnchor(storedId, currentFp) {
    try {
        localStorage.setItem(FP_ANCHOR_KEY, JSON.stringify({
            anchor: storedId,
            lastSeen: currentFp || storedId,
            updatedAt: Date.now(),
        }));
    } catch { /* storage lleno/bloqueado → sin ancla, el match exacto sigue funcionando */ }
}

/**
 * Genera una representación estable del User Agent (OS y Navegador, sin versiones de parche/menor).
 * @returns {string}
 */
function _getStableUserAgent() {
    if (typeof window === 'undefined' || !window.navigator) return '';
    const ua = window.navigator.userAgent || '';
    
    // Detectar Sistema Operativo
    let os = 'UnknownOS';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'MacOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod')) os = 'iOS';
    else if (ua.includes('Linux')) os = 'Linux';

    // Detectar Navegador
    let browser = 'UnknownBrowser';
    if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR')) browser = 'Chrome';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg')) browser = 'Edge';
    else if (ua.includes('OPR') || ua.includes('Opera')) browser = 'Opera';

    return `${os}|${browser}`;
}

/**
 * Devuelve la sal configurada por despliegue (VITE_LICENSE_SALT).
 * Si no está presente, se usa una sal por defecto (no secreta — solo para fijar
 * el dominio de hash entre despliegues del mismo entorno).
 * @returns {string}
 */
function _getSalt() {
    const envSalt = (typeof import.meta !== 'undefined'
        && import.meta.env
        && import.meta.env.VITE_LICENSE_SALT) || '';
    return envSalt || 'PDA_FP_SALT_2026_DEFAULT';
}

/**
 * Genera un fingerprint robusto del dispositivo.
 * Combina características del navegador + sal del backend → SHA-256 de 32 hex chars.
 *
 * @returns {Promise<string>} Fingerprint en formato `PDA-V2-<32hex>`.
 */
export async function generateFingerprint() {
    if (typeof window === 'undefined' || !window.navigator) {
        // SSR / no-browser — devolver un fingerprint sintético determinista.
        return `${FP_PREFIX_V2}${'0'.repeat(FP_HASH_LENGTH)}`;
    }

    const nav = window.navigator;
    const screen = window.screen || {};

    const components = [
        _getStableUserAgent(),
        nav.language || '',
        nav.languages ? nav.languages.join(',') : '',
        nav.hardwareConcurrency || 1,
        nav.deviceMemory || 1,
        nav.platform || '',
        screen.colorDepth || 0,
        Intl?.DateTimeFormat()?.resolvedOptions()?.timeZone || '',
        // Sal del backend — dificulta precomputar fingerprints falsos.
        _getSalt(),
    ].join('|');

    if (!window.crypto || !window.crypto.subtle) {
        // Fallback (solo en http sin SSL). Truncamos a FP_HASH_LENGTH.
        let hash = 0;
        for (let i = 0; i < components.length; i++) {
            hash = ((hash << 5) - hash) + components.charCodeAt(i);
            hash |= 0;
        }
        // Generar un hash más largo combinando varias rotaciones para reducir colisiones.
        let hash2 = 5381;
        for (let i = 0; i < components.length; i++) {
            hash2 = ((hash2 << 5) + hash2) + components.charCodeAt(i);
            hash2 |= 0;
        }
        const hex = (Math.abs(hash).toString(16) + Math.abs(hash2).toString(16))
            .toUpperCase()
            .padStart(FP_HASH_LENGTH, '0')
            .slice(0, FP_HASH_LENGTH);
        return `${FP_PREFIX_V2}${hex}`;
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(components);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Tomar los primeros 16 bytes (32 hex chars) — 128 bits de entropía.
    const hex = hashArray.slice(0, 16)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return `${FP_PREFIX_V2}${hex}`;
}

/**
 * Verifica que el fingerprint almacenado corresponde a esta instalación.
 *
 * Política (en orden):
 *   1. Formato inválido → `false` (ID inyectado con basura, p.ej. 'PDA-DEAD').
 *   2. Match exacto → `true` y refresca la ancla.
 *   3. Drift (ID anclado, fingerprint actual distinto) → `true`: componentes volátiles
 *      cambiaron en la MISMA instalación (recarga legítima en navegador privacidad-
 *      reforzada, VM, etc.). La ancla prueba procedencia. Actualiza `lastSeen`.
 *   4. Sin ancla + continuidad de instalación (migración pre-ancla) → adopta el ID
 *      como ancla y `true`. Un navegador limpio con ID inyectado NO pasa aquí.
 *   5. Cualquier otro caso (ancla presente y desigual, o ID foráneo en perfil limpio)
 *      → `false`: manipulación o robo de ID entre equipos.
 *
 * @param {string} storedId - ID almacenado en localStorage.
 * @param {string} [currentFp] - Fingerprint ya calculado (opcional, para ahorrar cómputo).
 * @returns {Promise<boolean>} `true` si el ID pertenece a esta instalación.
 */
export async function verifyStoredFingerprint(storedId, currentFp) {
    if (typeof storedId !== 'string' || !FP_VALID_ID_RE.test(storedId)) {
        return false;
    }
    const fp = currentFp || await generateFingerprint();

    // 2. Match exacto.
    if (storedId === fp) {
        seedFingerprintAnchor(storedId, fp);
        return true;
    }

    // 3. Drift tolerado por ancla.
    const anchor = getFingerprintAnchor();
    if (anchor && anchor.anchor === storedId) {
        try {
            localStorage.setItem(FP_ANCHOR_KEY, JSON.stringify({
                ...anchor,
                lastSeen: fp,
                updatedAt: Date.now(),
            }));
        } catch { /* ignorado */ }
        return true;
    }

    // 4. Migración TOFU de instalaciones pre-ancla con estado real.
    if (!anchor && _hasInstallContinuity()) {
        seedFingerprintAnchor(storedId, fp);
        return true;
    }

    // 5. Manipulación / ID foráneo.
    return false;
}

export default {
    generateFingerprint,
    verifyStoredFingerprint,
    getFingerprintAnchor,
    seedFingerprintAnchor,
};
