/**
 * duenoAuth.js — PIN maestro global del dueño (Fase 1.5).
 *
 * El dueño NO está atado a ningún negocio: su PIN y su sesión viven en claves
 * GLOBALES de localStorage (registradas en GLOBAL_STORAGE_KEYS de
 * negocioContext.js), así ningún prefijo `nb_<id>:` las toca jamás.
 *
 * - El hash usa el mismo PBKDF2 que los PINs de usuarios (utils/crypto).
 * - El bloqueo por intentos fallidos replica la política LOGIN_RATE_LIMIT.
 * - La sesión del dueño tiene forma { id: 'dueno', nombre, rol: 'DUENO',
 *   global: true } y la valida useAuthStore antes de aceptarla.
 *
 * @module utils/duenoAuth
 */
import { hashPin, verifyPin } from './crypto';
import { LOGIN_RATE_LIMIT, validatePin } from './securityConstants';

export const DUENO_PIN_KEY = 'pda-dueno-pin';
export const DUENO_SESSION_KEY = 'pda-dueno-session';
export const DUENO_LOCK_KEY = 'pda-dueno-pin-lock';

/** Sesión canónica del dueño (global, no atada a ningún negocio). */
export const DUENO_SESSION = Object.freeze({
    id: 'dueno',
    nombre: 'Dueño',
    rol: 'DUENO',
    global: true,
});

function _now() {
    return Date.now();
}

function _readLock() {
    try {
        const raw = localStorage.getItem(DUENO_LOCK_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            failedAttempts: Number(parsed.failedAttempts) || 0,
            lockUntil: Number(parsed.lockUntil) || 0,
            consecutiveLockouts: Number(parsed.consecutiveLockouts) || 0,
            lastFailedAttemptTs: Number(parsed.lastFailedAttemptTs) || 0,
        };
    } catch {
        return null;
    }
}

function _writeLock(state) {
    try {
        localStorage.setItem(DUENO_LOCK_KEY, JSON.stringify(state));
    } catch { /* noop */ }
}

function _clearLock() {
    try {
        localStorage.removeItem(DUENO_LOCK_KEY);
    } catch { /* noop */ }
}

/**
 * ¿Ya existe un PIN maestro configurado?
 * @returns {boolean}
 */
export function isMasterPinSetup() {
    try {
        return Boolean(localStorage.getItem(DUENO_PIN_KEY));
    } catch {
        return false;
    }
}

/**
 * Crea (o reemplaza) el PIN maestro del dueño.
 * @param {string} pin - PIN en claro.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function setMasterPin(pin) {
    const err = validatePin(pin);
    if (err) return { ok: false, error: err };
    try {
        const hash = await hashPin(pin);
        localStorage.setItem(DUENO_PIN_KEY, hash);
        _clearLock();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e?.message || 'No se pudo guardar el PIN' };
    }
}

/**
 * Verifica el PIN maestro, aplicando bloqueo progresivo por intentos fallidos
 * (misma política que el login de usuarios).
 * @param {string} pin - PIN en claro.
 * @returns {Promise<{ ok: boolean, error?: string, locked?: boolean, retryAfterMs?: number }>}
 */
export async function verifyMasterPin(pin) {
    const lock = _readLock() ?? {
        failedAttempts: 0,
        lockUntil: 0,
        consecutiveLockouts: 0,
        lastFailedAttemptTs: 0,
    };
    const now = _now();
    if (lock.lockUntil > now) {
        return {
            ok: false,
            locked: true,
            retryAfterMs: lock.lockUntil - now,
            error: 'PIN bloqueado temporalmente por intentos fallidos',
        };
    }
    // Ventana de conteo: si pasó RESET_WINDOW_MS desde el último fallo,
    // los intentos se reinician (misma política que useAuthStore SEC-006).
    let { failedAttempts } = lock;
    if (failedAttempts > 0 && lock.lastFailedAttemptTs > 0 && now - lock.lastFailedAttemptTs > LOGIN_RATE_LIMIT.RESET_WINDOW_MS) {
        failedAttempts = 0;
    }

    let stored = null;
    try {
        stored = localStorage.getItem(DUENO_PIN_KEY);
    } catch { /* noop */ }
    let valid = false;
    if (stored) {
        try {
            const res = await verifyPin(pin, stored);
            valid = res.valid === true;
        } catch { valid = false; }
    }

    if (!valid) {
        const newAttempts = failedAttempts + 1;
        const newLock = {
            failedAttempts: newAttempts,
            lockUntil: lock.lockUntil,
            consecutiveLockouts: lock.consecutiveLockouts,
            lastFailedAttemptTs: now,
        };
        if (newAttempts >= LOGIN_RATE_LIMIT.MAX_ATTEMPTS) {
            // Backoff exponencial igual que en useAuthStore._computeLockout.
            const consecutive = lock.consecutiveLockouts + 1;
            const rawLockout = LOGIN_RATE_LIMIT.LOCKOUT_MS
                * Math.pow(LOGIN_RATE_LIMIT.BACKOFF_FACTOR, consecutive - 1);
            const lockoutMs = Math.min(rawLockout, LOGIN_RATE_LIMIT.MAX_LOCKOUT_MS);
            newLock.lockUntil = now + lockoutMs;
            newLock.consecutiveLockouts = consecutive;
        }
        _writeLock(newLock);
        return {
            ok: false,
            locked: newLock.lockUntil > now,
            retryAfterMs: Math.max(0, newLock.lockUntil - now),
            error: 'PIN incorrecto',
        };
    }

    _clearLock();
    return { ok: true };
}

/**
 * Lee la sesión global del dueño (si existe y es válida).
 * @returns {{ id: string, nombre: string, rol: string, global: boolean } | null}
 */
export function getDuenoSession() {
    try {
        const raw = localStorage.getItem(DUENO_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id === 'dueno' && parsed.rol === 'DUENO' && parsed.global === true) {
            return {
                id: 'dueno',
                nombre: String(parsed.nombre || 'Dueño'),
                rol: 'DUENO',
                global: true,
            };
        }
        return null;
    } catch {
        return null;
    }
}

/** Persiste la sesión global del dueño. */
export function setDuenoSession() {
    try {
        localStorage.setItem(DUENO_SESSION_KEY, JSON.stringify(DUENO_SESSION));
    } catch { /* noop */ }
}

/** Limpia la sesión global del dueño. */
export function clearDuenoSession() {
    try {
        localStorage.removeItem(DUENO_SESSION_KEY);
    } catch { /* noop */ }
}
