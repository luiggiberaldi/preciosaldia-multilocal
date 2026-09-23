/**
 * withLock.js — Wrapper seguro para `navigator.locks.request` con feature detection.
 *
 * Problema que resuelve:
 *   - FIN-007 / HOOK-004: `navigator.locks.request` se llamaba sin verificar soporte.
 *     En Safari < 16.4, iOS WebView antiguos y contextos HTTP, `navigator.locks` es
 *     `undefined` → `TypeError` no capturado → la venta se pierde sin persistir.
 *
 * Estrategia:
 *   1. Si `navigator.locks` está disponible y el contexto es seguro, lo usamos (atómico real).
 *   2. Si no, caemos a un mutex en memoria basado en promesas (mejor effort, no cross-tab).
 *   3. Siempre envolvemos en try/catch para que el callback nunca se pierda por un error
 *      del mecanismo de lock (la integridad del dato prevalece sobre la atomicidad perfecta).
 *
 * Uso:
 *   import { withLock } from '@/utils/withLock';
 *   const result = await withLock('pos_write_lock', async () => { ... });
 *
 * @module utils/withLock
 */

// ── Mutex en memoria (fallback cuando navigator.locks no existe) ──────────────
const _queues = new Map();

/**
 * Mutex single-flight por nombre. Garantiza exclusión mutua dentro de un mismo tab,
 * pero NO entre tabs (para eso se necesita navigator.locks o un SharedWorker).
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function _memoryMutex(name, fn) {
  const prev = _queues.get(name) ?? Promise.resolve();
  let resolveNext;
  const next = new Promise((r) => { resolveNext = r; });
  _queues.set(name, prev.then(() => next));

  try {
    await prev;
  } catch {
    // El callback anterior falló; aún así procedemos (no propagamos el error del previo).
  }

  try {
    return await fn();
  } finally {
    resolveNext();
    // Limpieza: si somos el último, liberar la entrada del Map.
    if (_queues.get(name) === next) {
      _queues.delete(name);
    }
  }
}

/**
 * Indica si navigator.locks está soportado y utilizable.
 * Requiere contexto seguro (HTTPS o localhost) en la mayoría de navegadores.
 * @returns {boolean}
 */
export function isLocksSupported() {
  return typeof navigator !== 'undefined'
    && typeof navigator.locks === 'object'
    && typeof navigator.locks.request === 'function'
    && (typeof window === 'undefined' || window.isSecureContext !== false);
}

/**
 * Ejecuta `fn` bajo un lock nombrado. Si navigator.locks no está disponible,
 * cae a un mutex en memoria (con advertencia en consola en dev).
 *
 * @param {string} name - Nombre del lock (ej: 'pos_write_lock').
 * @param {() => Promise<T>} fn - Trabajo crítico a ejecutar bajo exclusión mutua.
 * @param {{ mode?: 'exclusive' | 'shared', fallbackWarning?: boolean }} [opts]
 * @returns {Promise<T>} Lo que devuelva `fn`.
 * @template T
 *
 * @example
 *   const result = await withLock('pos_write_lock', async () => {
 *     const sales = await storageService.getItem(SALES_KEY, []);
 *     const next = [...sales, newSale];
 *     await storageService.setItem(SALES_KEY, next);
 *     return next;
 *   });
 */
export async function withLock(name, fn, opts = {}) {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('[withLock] name debe ser un string no vacío');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('[withLock] fn debe ser una función');
  }

  const mode = opts.mode === 'shared' ? 'shared' : 'exclusive';

  // Camino rápido: navigator.locks soportado.
  if (isLocksSupported()) {
    try {
      // navigator.locks.request devuelve lo que resuelve fn.
      return await navigator.locks.request(name, { mode }, async () => {
        return await fn();
      });
    } catch (err) {
      // Si el mecanismo nativo falla por alguna razón exótica, caemos al mutex.
      if (import.meta.env?.DEV) {
        console.warn(`[withLock] navigator.locks falló para "${name}", usando fallback:`, err);
      }
      return _memoryMutex(name, fn);
    }
  }

  // Fallback: mutex en memoria.
  if (opts.fallbackWarning !== false && import.meta.env?.DEV) {
    console.warn(
      `[withLock] navigator.locks NO soportado. Usando mutex en memoria para "${name}". ` +
      `La exclusión mutua NO aplica entre tabs/navegadores.`
    );
  }
  return _memoryMutex(name, fn);
}

export default withLock;
