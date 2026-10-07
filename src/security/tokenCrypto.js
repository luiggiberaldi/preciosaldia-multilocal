/**
 * tokenCrypto.js — Verificación de tokens de licencia RSA (RSASSA-PKCS1-v1_5 SHA-256).
 *
 * Fixes de seguridad:
 *   - SEC-001 / SEC-007: Se ELIMINÓ la rama XOR legacy de `verifyLicenseToken`.
 *     Cualquier token sin `.` (sin firma RSA) es rechazado. Antes, un atacante con
 *     DevTools podía hacer `localStorage.setItem('pda_premium_token', encodeToken(...))`
 *     y recargar para obtener premium gratis. Ahora la única forma de tener premium es
 *     que el backend firme un token con la clave privada RSA correspondiente a
 *     `PUBLIC_KEY_JWK`, o que la fila en `licenses` del servidor tenga `active === true`.
 *   - `encodeToken`/`decodeToken` quedan marcados `@deprecated` y solo se conservan para
 *     lectura/migración de tokens viejos (NUNCA para mintear nuevos). Emiten un warning
 *     en consola si se usan en runtime.
 *
 * Public key JWK for RSA signature verification.
 * In production, the developer should generate their own RSA key pair,
 * put the Private Key on the licensing server (Estación Maestra) and the Public Key JWK here.
 *
 * @module security/tokenCrypto
 */

const DEFAULT_PUBLIC_KEY_JWK = {
    "kty": "RSA",
    "n": "-Gh3FwCQ0uA4uHjdfnA6JQtVRZ6oG1bS6LDngpmB2AZY4Zbewed9cBVWI_Gh7NOoTcSRfwcqMUE_6IaEYLMgY2J-6vSbfCX3unuTn4ZHk9qKUPtUeBl6xJVHpMh-vGd3cqQiMHUvxEOMKQcOJDJyhf1sVR2ODKnVuVJvsX9-uYuUhLC4DrrrJe56PMW0gJwKnri5a9PEAJs0Ku-GeTbbE-3_gvGgsRaRDI8bgfwfxtussO_JYNM-gqMf8HiMPopNMW05NZQ-BrHIxRHBJRli6Q8ptsP5iH_qw46T7LXdsM0UqGSwxwRTfrxb5T4fgLwIE2rqIyFtJvaFiPRDWnNBjw",
    "e": "AQAB"
};

/** Clave pública JWK cargada dinámicamente desde el entorno o fallback seguro. */
export const PUBLIC_KEY_JWK = (() => {
    try {
        const envKey = import.meta.env?.VITE_LICENSE_PUBLIC_KEY;
        return envKey ? JSON.parse(envKey) : DEFAULT_PUBLIC_KEY_JWK;
    } catch {
        return DEFAULT_PUBLIC_KEY_JWK;
    }
})();

// SEC-007: XOR legacy desactivado.
export const XOR_KEY = '';

const _LEGACY_WARNING_FIRED = new Set();

function _warnDeprecated(name) {
    if (import.meta.env?.DEV && !_LEGACY_WARNING_FIRED.has(name)) {
        _LEGACY_WARNING_FIRED.add(name);
        console.warn(
            `[tokenCrypto] ${name}() está DEPRECADO (SEC-001/SEC-007). ` +
            `Solo se conserva para migrar tokens legacy; nunca mintear tokens nuevos con él. ` +
            `Use tokens firmados por el backend (formato base64(payload).base64(signature)).`
        );
    }
}

/**
 * @deprecated SEC-001/SEC-007 — Codificación XOR reversible, NO es criptografía.
 * Se conserva solo para tests/migración. NUNCA usar para crear tokens nuevos.
 */
export const encodeToken = (str) => {
    _warnDeprecated('encodeToken');
    try {
        const xored = str.split('').map((c, i) =>
            String.fromCharCode(
                c.charCodeAt(0) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length)
            )
        ).join('');
        return btoa(unescape(encodeURIComponent(xored)));
    } catch { return str; }
};

/**
 * @deprecated SEC-001/SEC-007 — Decodificación XOR reversible, NO es criptografía.
 * Se conserva solo para migrar tokens legacy guardados antes del fix.
 */
export const decodeToken = (encoded) => {
    _warnDeprecated('decodeToken');
    try {
        const xored = decodeURIComponent(escape(atob(encoded)));
        return xored.split('').map((c, i) =>
            String.fromCharCode(
                c.charCodeAt(0) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length)
            )
        ).join('');
    } catch { return encoded; }
};

/**
 * Verifica que el token tenga una firma RSA válida (SEC-001/SEC-007).
 *
 * Formato del token: `base64(payloadJSON).base64(signature)` donde la firma
 * se computa sobre el string `base64(payloadJSON)` (o sobre el payloadJSON crudo,
 * ver convención con el backend) usando RSASSA-PKCS1-v1_5 con SHA-256.
 *
 * Rechazo explícito de tokens legacy:
 *   - Si el token NO contiene `.` (sin firma) → `{ valid:false, payload:null, isLegacy:true }`.
 *   - No existe ya ninguna rama que acepte tokens XOR.
 *
 * @param {string} token
 * @returns {Promise<{ valid: boolean, payload: any|null, isLegacy?: boolean }>}
 */
export async function verifyLicenseToken(token) {
    // SEC-001: Rechazar tokens sin firma RSA.
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        return { valid: false, payload: null, isLegacy: true };
    }

    try {
        const parts = token.split('.');
        if (parts.length !== 2) return { valid: false, payload: null, isLegacy: false };

        const payloadStr = atob(parts[0]);
        const signatureBase64 = parts[1];

        // Convert base64 signature to Uint8Array
        const binarySign = atob(signatureBase64);
        const signatureArr = new Uint8Array(binarySign.length);
        for (let i = 0; i < binarySign.length; i++) {
            signatureArr[i] = binarySign.charCodeAt(i);
        }

        // Convert payload to Uint8Array
        const encoder = new TextEncoder();
        const payloadArr = encoder.encode(payloadStr);

        // Import the public key
        const key = await window.crypto.subtle.importKey(
            "jwk",
            PUBLIC_KEY_JWK,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"]
        );

        // Verify the signature
        const isValid = await window.crypto.subtle.verify(
            "RSASSA-PKCS1-v1_5",
            key,
            signatureArr,
            payloadArr
        );

        if (isValid) {
            return { valid: true, payload: JSON.parse(payloadStr) };
        }
    } catch (e) {
        // HOOK-022: Silenciar errores en prod, loguear en dev.
        if (import.meta.env?.DEV) {
            console.warn('[License Crypto] Verification failed:', e);
        }
    }

    return { valid: false, payload: null, isLegacy: false };
}
