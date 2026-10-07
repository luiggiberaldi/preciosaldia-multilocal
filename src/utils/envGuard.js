/**
 * envGuard.js — Validación de variables de entorno en boot.
 *
 * Problema que resuelve:
 *   - HOOK-003 / INFRA-001: `src/core/supabaseClient.js` (propiedad del Agente B)
 *     tenía hardcoded como fallback la URL de un proyecto real de Supabase
 *     y un placeholder `'REEMPLAZAR_CON_TU_ANON_KEY_VERDADERA'`. Si las variables
 *     de entorno faltaban en build, el cliente se creaba con datos inválidos y
 *     todas las llamadas fallaban con 401 silenciosamente, sin diagnóstico.
 *
 * Solución:
 *   - Cualquier módulo que necesite una variable de entorno crítica debe llamar a
 *     `assertEnv('VITE_SUPABASE_URL')` al importarse. Si falta, lanzamos un error
 *     explícito (no creamos cliente placeholder). El Agente B puede envolver la
 *     creación del cliente en try/catch y registrar `null`, o dejar que la app
 *     aborte en modo "configuración requerida".
 *
 * @module utils/envGuard
 */

/**
 * Lista blanca de variables de entorno críticas y sus mensajes descriptivos.
 * Cualquier caller puede validar variables arbitrarias; este mapa es solo
 * para autodocumentación y para que `assertRequiredEnv` itere.
 */
export const REQUIRED_ENV_VARS = Object.freeze({
  VITE_SUPABASE_URL: 'URL del proyecto Supabase (ej: https://xxxx.supabase.co)',
  VITE_SUPABASE_ANON_KEY: 'Clave anónima de Supabase',
});

/**
 * Devuelve el valor de una variable de entorno Vite, o `undefined` si no está
 * definida. Wrapper sobre `import.meta.env` para aislar el acceso y permitir
 * tests con mock.
 *
 * @param {string} varName
 * @returns {string|undefined}
 */
export function getEnv(varName) {
  if (typeof varName !== 'string' || !varName) return undefined;
  // import.meta.env solo existe en Vite; en tests lo inyecta el setup.
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const v = env[varName];
  if (v === undefined || v === null || v === '') return undefined;
  // Vite no reemplaza variables no definidas por el string vacío en algunos
  // modos; rechazamos explícitamente placeholders obvios.
  if (typeof v === 'string' && /REEMPLAZAR|REPLACE_WITH|YOUR_|PLACEHOLDER/i.test(v)) {
    return undefined;
  }
  return v;
}

/**
 * Lanza un Error descriptivo si la variable de entorno no está definida.
 *
 * @param {string} varName - Nombre de la variable (ej: 'VITE_SUPABASE_URL').
 * @param {object} [opts]
 * @param {string} [opts.hint] - Mensaje adicional para el dev/operador.
 * @returns {string} El valor validado.
 * @throws {Error} Si la variable falta o contiene un placeholder obvio.
 *
 * @example
 *   const url = assertEnv('VITE_SUPABASE_URL');
 *   const key = assertEnv('VITE_SUPABASE_ANON_KEY', {
 *     hint: 'Encuéntrala en Supabase Dashboard → Project Settings → API.'
 *   });
 */
export function assertEnv(varName, opts = {}) {
  const value = getEnv(varName);
  if (value === undefined) {
    const hint = opts.hint ? ` ${opts.hint}` : '';
    throw new Error(
      `[envGuard] Falta la variable de entorno requerida "${varName}".` +
      hint +
      ' Define el archivo .env (ver .env.example) y reconstruye la app.'
    );
  }
  return value;
}

/**
 * Valida todas las variables en REQUIRED_ENV_VARS. Devuelve la lista de faltantes
 * sin lanzar (para diagnóstico en UI de configuración).
 *
 * @returns {string[]} Nombres de variables faltantes.
 */
export function getMissingEnvVars() {
  return Object.keys(REQUIRED_ENV_VARS).filter((k) => getEnv(k) === undefined);
}

export default { assertEnv, getEnv, getMissingEnvVars, REQUIRED_ENV_VARS };
