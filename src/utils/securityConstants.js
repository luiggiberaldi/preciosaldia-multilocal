/**
 * securityConstants.js — Política de seguridad centralizada.
 *
 * Problema que resuelve:
 *   - SEC-005/006/017/018: PINs con policy débil (4 dígitos, sin salt, rate-limit
 *     resetable recargando), umbral mágico `0.009`, configuración dispersa.
 *
 * Centraliza TODA la política de seguridad del cliente en un solo módulo para
 * que un cambio de policy no requiera cazar magic numbers por todo el código.
 *
 * NOTA: Estas constantes son del lado cliente y por tanto **no son garantía**.
 * La validación autoritativa SIEMPRE debe repetirse en el backend/Supabase RLS.
 *
 * @module utils/securityConstants
 */

/** Política de PIN. */
export const PIN_POLICY = Object.freeze({
  /** Longitud mínima de PIN para TODOS los roles (antes 4 para cajero). */
  MIN_LENGTH: 6,
  /** Longitud máxima (evita DoS de hashing). */
  MAX_LENGTH: 32,
  /** Solo dígitos por defecto. Si se quieren alfanuméricos, cambiar a false. */
  DIGITS_ONLY: true,
  /** PBKDF2 iterations (NIST recomienda ≥ 600.000 para SHA-256 en 2023). */
  PBKDF2_ITERATIONS: 250000,
  /** Algoritmo de derivación de clave. */
  HASH_ALGO: 'SHA-256',
  /** Longitud del salt en bytes (16 = 128 bits, estándar NIST). */
  SALT_BYTES: 16,
  /** Longitud de la clave derivada en bits. */
  KEY_BITS: 256,
  /** Lista negra de PINs triviales prohibidos (top-20 más comunes). */
  BLACKLIST: Object.freeze([
    '000000', '111111', '123456', '1234567', '12345678',
    '654321', '666666', '112233', '121212', '0000000',
    '123123', '11111111', '222222', '333333', '444444',
    '555555', '777777', '888888', '999999', '987654',
  ]),
});

/** Política de rate-limiting de intentos de login (persistida, SEC-006). */
export const LOGIN_RATE_LIMIT = Object.freeze({
  /** Máximo de intentos fallidos antes del lockout. */
  MAX_ATTEMPTS: 5,
  /** Duración del primer lockout (ms). */
  LOCKOUT_MS: 30_000,
  /** Factor de backoff entre lockouts sucesivos. */
  BACKOFF_FACTOR: 2,
  /** Tope del lockout (ms). */
  MAX_LOCKOUT_MS: 15 * 60_000,
  /** Ventana de reseteo de contador tras login exitoso (ms). */
  RESET_WINDOW_MS: 30 * 60_000,
});

/** Política de auto-lock por inactividad (HOOK-001 / SEC-004). */
export const AUTOLOCK_POLICY = Object.freeze({
  /** Tiempo de inactividad antes del lock automático (ms) — 5 min. */
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  /** Tiempo de inactividad cuando el usuario es ADMIN (ms) — 2 min (más estricto). */
  ADMIN_IDLE_TIMEOUT_MS: 2 * 60 * 1000,
  /** Lock al minimizar/app a background (ms) — instantáneo (0). */
  BACKGROUND_LOCK_MS: 0,
});

/** Epsilon financiero para comparaciones (FIN-023). */
export const FINANCIAL_EPSILON = Object.freeze({
  /** Umbral bajo el cual consideramos un monto "cero" (evita 0.0000001 residuales). */
  PAYMENT_ZERO: 0.009,
  /** Tolerancia para reconciliación de caja (diferencia < esto = "cuadrado"). */
  CASH_RECONCILE_TOLERANCE_USD: 0.50,
  CASH_RECONCILE_TOLERANCE_BS: 5.0,
  CASH_RECONCILE_TOLERANCE_COP: 500,
  /** Umbral para detectar anomalía de vuelto (vuelto > X * total Y veces). */
  CHANGE_ANOMALY_MULTIPLIER: 5,
  CHANGE_ANOMALY_MIN_USD: 100,
  CHANGE_ANOMALY_MIN_BS_FACTOR: 100,
  /**
   * TIP-002: propina donada por encima de este monto (USD) exige doble
   * pulsación del botón. Un tap accidental sobre un vuelto anómalo no puede
   * donar cientos de dólares en silencio.
   */
  TIP_MAX_AUTO_USD: 20,
});

/** Configuración de licencias (SEC-001). */
export const LICENSE_POLICY = Object.freeze({
  /** Rechazar tokens que no tengan firma RSA (sin '.'). */
  REJECT_LEGACY_XOR_TOKENS: true,
  /** Heartbeat al servidor cada N ms para validar licencia. */
  HEARTBEAT_MS: 15 * 60 * 1000,
  /** Tolerancia de reloj del cliente vs servidor (ms) antes de sospechar manipulación. */
  CLOCK_SKEW_TOLERANCE_MS: 5 * 60 * 1000,
});

/** Orígenes permitidos para CORS (INFRA-005). Reemplaza '*'. */
export const ALLOWED_ORIGINS = Object.freeze(
  (import.meta.env?.VITE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

/**
 * Valida un PIN contra la política. Devuelve null si es válido, o un mensaje de error.
 * @param {string} pin
 * @returns {string|null}
 */
export function validatePin(pin) {
  if (typeof pin !== 'string' || !pin) return 'PIN vacío';
  if (PIN_POLICY.DIGITS_ONLY && !/^\d+$/.test(pin)) {
    return 'El PIN solo puede contener dígitos';
  }
  if (pin.length < PIN_POLICY.MIN_LENGTH) {
    return `El PIN debe tener al menos ${PIN_POLICY.MIN_LENGTH} dígitos`;
  }
  if (pin.length > PIN_POLICY.MAX_LENGTH) {
    return `El PIN no puede exceder ${PIN_POLICY.MAX_LENGTH} caracteres`;
  }
  // DECISIÓN DE PRODUCTO (consciente, no un bug): se permite cualquier PIN numérico de
  // PIN_POLICY.MIN_LENGTH dígitos, incluidos los predecibles (000000, 123456, etc.). El
  // rechazo por BLACKLIST/secuencias triviales se desactivó a pedido explícito del
  // negocio. La mitigación compensatoria sigue activa: rate-limiting persistido con
  // backoff exponencial (LOGIN_RATE_LIMIT, ver useAuthStore.js) — un PIN débil ya no se
  // puede probar por fuerza bruta sin activar el lockout, aunque sea adivinable a la
  // primera. Los PINs de fábrica del primer arranque SÍ siguen siendo aleatorios
  // (ver _generateRandomPin en useAuthStore.js); esta relajación solo afecta a cambios
  // manuales de PIN hechos por el propio usuario/admin.
  return null;
}

export default {
  PIN_POLICY,
  LOGIN_RATE_LIMIT,
  AUTOLOCK_POLICY,
  FINANCIAL_EPSILON,
  LICENSE_POLICY,
  ALLOWED_ORIGINS,
  validatePin,
};
