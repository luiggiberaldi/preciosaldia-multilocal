/**
 * crypto.js — Hashing seguro de PINs con PBKDF2 + salt aleatorio (WebCrypto).
 *
 * Problema que resuelve:
 *   - SEC-005/007: PINs hasheados con SHA-256 **sin salt** y ASCII-only
 *     (`if (j >> 8) return ''` colisiona caracteres no-ASCII a cadena vacía).
 *     Rainbow tables contra hashes sin salt son triviales; los PINs por defecto
 *     `123456`/`0000` estaban embebidos en el bundle.
 *
 * Solución:
 *   - PBKDF2-HMAC-SHA-256 con 250.000 iteraciones y salt aleatorio de 128 bits.
 *   - Formato de almacenamiento: `pbkdf2$<iter>$<saltB64>$<hashB64>` (parseable).
 *   - Compatibilidad: `verifyPin` detecta hashes legacy (64 hex chars = SHA-256 sin salt)
 *     y los marca como `legacy: true` para forzar re-hash en el próximo login exitoso.
 *
 * @module utils/crypto
 */

import { PIN_POLICY } from './securityConstants';

const _enc = new TextEncoder();
const _dec = new TextDecoder();

/**
 * Comprueba si WebCrypto está disponible (requiere contexto seguro).
 * @returns {boolean}
 */
function hasSubtle() {
  return typeof crypto !== 'undefined'
    && typeof crypto.subtle === 'object'
    && typeof crypto.subtle.deriveBits === 'function';
}

/**
 * Genera un salt aleatorio criptográficamente seguro.
 * @param {number} [bytes=16]
 * @returns {Uint8Array}
 */
export function generateSalt(bytes = PIN_POLICY.SALT_BYTES) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return arr;
}

/**
 * Hashea un PIN con PBKDF2. Devuelve un string portable.
 *
 * @param {string} pin - PIN en claro.
 * @param {Uint8Array} [salt] - Salt opcional; si se omite, se genera uno aleatorio.
 * @param {number} [iterations] - Iteraciones PBKDF2.
 * @returns {Promise<string>} Formato: `pbkdf2$<iter>$<saltB64>$<hashB64>`
 */
export async function hashPin(pin, salt, iterations = PIN_POLICY.PBKDF2_ITERATIONS) {
  if (typeof pin !== 'string' || !pin) {
    throw new TypeError('[crypto.hashPin] pin debe ser un string no vacío');
  }
  if (!hasSubtle()) {
    throw new Error('[crypto.hashPin] WebCrypto no disponible (usa contexto HTTPS)');
  }

  const saltBytes = salt ?? generateSalt();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    _enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: PIN_POLICY.HASH_ALGO,
    },
    keyMaterial,
    PIN_POLICY.KEY_BITS
  );
  const saltB64 = toBase64(saltBytes);
  const hashB64 = toBase64(new Uint8Array(derived));
  return `pbkdf2$${iterations}$${saltB64}$${hashB64}`;
}

/**
 * Verifica un PIN contra un hash almacenado. Soporta:
 *   - Formato nuevo: `pbkdf2$<iter>$<saltB64>$<hashB64>`
 *   - Formato legacy: 64 hex chars (SHA-256 sin salt) — marcado como `legacy`.
 *
 * @param {string} pin - PIN en claro.
 * @param {string} stored - Hash almacenado.
 * @returns {Promise<{ valid: boolean, legacy: boolean, needsRehash: boolean }>}
 */
export async function verifyPin(pin, stored) {
  if (typeof pin !== 'string' || !pin || typeof stored !== 'string' || !stored) {
    return { valid: false, legacy: false, needsRehash: false };
  }

  // Formato nuevo.
  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$');
    if (parts.length !== 4) return { valid: false, legacy: false, needsRehash: false };
    const iter = parseInt(parts[1], 10);
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    if (!iter || !salt || !expected) {
      return { valid: false, legacy: false, needsRehash: false };
    }
    try {
      const candidate = await hashPin(pin, salt, iter);
      const candidateHash = candidate.split('$')[3];
      const valid = constantTimeEqual(candidateHash, parts[3]);
      const needsRehash = valid && iter < PIN_POLICY.PBKDF2_ITERATIONS;
      return { valid, legacy: false, needsRehash };
    } catch {
      return { valid: false, legacy: false, needsRehash: false };
    }
  }

  // Formato legacy: SHA-256 sin salt (64 hex chars). Aceptado solo para migración.
  if (/^[0-9a-f]{64}$/i.test(stored)) {
    if (!hasSubtle()) {
      // Sin WebCrypto, no podemos verificar ni migrar. Rechazar.
      return { valid: false, legacy: true, needsRehash: false };
    }
    try {
      const digest = await crypto.subtle.digest('SHA-256', _enc.encode(pin));
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const valid = constantTimeEqual(hex, stored.toLowerCase());
      return { valid, legacy: true, needsRehash: valid };
    } catch {
      return { valid: false, legacy: true, needsRehash: false };
    }
  }

  return { valid: false, legacy: false, needsRehash: false };
}

/**
 * Comparación de strings en tiempo constante para mitigar timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Helpers Base64 para Uint8Array (sin dependencias) ─────────────────────────

/** @param {Uint8Array} bytes @returns {string} */
export function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** @param {string} b64 @returns {Uint8Array} */
export function fromBase64(b64) {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export default { hashPin, verifyPin, generateSalt, constantTimeEqual, toBase64, fromBase64 };
