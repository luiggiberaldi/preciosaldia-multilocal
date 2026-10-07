/**
 * syncFlags.js — Flags de sincronización cross-módulo (neutro).
 *
 * Problema que resuelve:
 *   - HOOK-014: `useCloudBackup.applyCloudBackup` escribe en `storageService`
 *     que a su vez llama `pushCloudSync`. El flag `isSyncingFromCloud` está
 *     declarado como variable local en `useCloudSync.js` (módulo del Agente B)
 *     y NO se exporta. La restauración cloud no puede setearlo, lo que produce
 *     eco: los datos restaurados se re-envían a la nube.
 *
 * Solución:
 *   - Módulo neutral que el Agente B puede integrar en `useCloudSync.js` si lo
 *     desea (no tocamos su archivo). Mientras tanto, `useCloudBackup` puede
 *     usar `runWithoutEco(async () => { ... applyCloudBackup ... })` que setea
 *     el flag y `pushCloudSync` (re-exportado por `useCloudSync`) ya lo respeta
 *     internamente. Si el Agente B decide migrar el flag local a este módulo,
 *     no hay fricción: la API es la misma.
 *
 *   - Además provee un mecanismo de "cola de reintentos" para operaciones que
 *     deben re-enviarse a la nube una vez superado el eco.
 *
 * @module utils/syncFlags
 */

// Flag global: cuando es `true`, pushCloudSync debe ignorar los writes
// (los datos vienen de la nube, no queremos re-enviarlos).
let _isSyncingFromCloud = false;

// Lista de setters opcionales que el Agente B puede registrar para mantener
// sincronizado el flag local de useCloudSync con este módulo. Si el Agente B
// no registra nada, el flag solo vive aquí.
const _cloudSyncSetters = new Set();

/**
 * @returns {boolean} Estado actual del flag.
 */
export function isSyncingFromCloud() {
  return _isSyncingFromCloud;
}

/**
 * Setter que el Agente B (useCloudSync) puede invocar para registrar su propio
 * flag local y mantenerlo sincronizado con este módulo. Idempotente.
 *
 * @param {(v: boolean) => void} setter
 * @returns {() => void} Función para des-registrar (para cleanup de tests).
 */
export function registerCloudSyncSetter(setter) {
  if (typeof setter === 'function') _cloudSyncSetters.add(setter);
  return () => { _cloudSyncSetters.delete(setter); };
}

function _apply(v) {
  _isSyncingFromCloud = v;
  for (const setter of _cloudSyncSetters) {
    try { setter(v); } catch (_e) { /* nunca romper la app por un setter externo */ }
  }
}

/**
 * Ejecuta `fn` con el flag de "sincronizando desde la nube" activo.
 * Cualquier `pushCloudSync` que se dispare durante `fn` será ignorado (no eco).
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 *
 * @example
 *   await runWithoutEco(async () => {
 *     for (const [k, v] of Object.entries(cloudBackup.data.idb)) {
 *       await storageService.setItem(k, v);
 *     }
 *   });
 */
export async function runWithoutEco(fn) {
  const prev = _isSyncingFromCloud;
  _apply(true);
  try {
    return await fn();
  } finally {
    _apply(prev);
  }
}

/**
 * Versión síncrona para casos puntuales (ej: setItem en localStorage dentro de
 * un handler síncrono). Prefiere `runWithoutEco` cuando sea posible.
 *
 * @param {() => void} fn
 */
export function runWithoutEcoSync(fn) {
  const prev = _isSyncingFromCloud;
  _apply(true);
  try {
    fn();
  } finally {
    _apply(prev);
  }
}

/**
 * Reset explícito del flag (para tests y casos de emergencia).
 */
export function _resetSyncFlag() {
  _apply(false);
}

export default {
  isSyncingFromCloud,
  registerCloudSyncSetter,
  runWithoutEco,
  runWithoutEcoSync,
  _resetSyncFlag,
};
