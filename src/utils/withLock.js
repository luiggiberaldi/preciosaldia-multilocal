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
 *   2. Si no, mutex entre pestañas vía localStorage (lease con token) — B-8.
 *   3. Si localStorage tampoco sirve, mutex en memoria (mejor effort, no cross-tab).
 *   4. Siempre envolvemos en try/catch para que el callback nunca se pierda por un error
 *      del mecanismo de lock (la integridad del dato prevalece sobre la atomicidad perfecta).
 *
 * Uso:
 *   import { withLock } from '@/utils/withLock';
 *   const result = await withLock('pos_write_lock', async () => { ... });
 *
 * @module utils/withLock
 */

// ── Mutex en memoria (último recurso: solo excluye dentro del mismo tab) ────
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
 * B-8 (2026-10-01): mutex entre pestañas vía localStorage (lease con token).
 *
 * El mutex en memoria no excluye entre tabs; en LAN por HTTP (sin contexto
 * seguro) `navigator.locks` no existe y dos pestañas podían pisarse al
 * escribir. Este nivel intermedio usa una llave con lease en localStorage
 * (visible para todos los tabs del mismo origen):
 *   - Adquisición: si la llave no existe o el lease expiró, escribimos nuestro
 *     token y re-leemos tras ~10ms para confirmar que ganamos la carrera.
 *   - Liberación: borramos solo si el token sigue siendo el nuestro.
 *   - Si localStorage no está disponible → degrada al mutex en memoria.
 *   - Si no logramos adquirir en TIMEOUT_MS → ejecutamos con el mutex en
 *     memoria para no bloquear la venta indefinidamente (best effort).
 *
 * No es tan fuerte como navigator.locks (relojes y carreras de ~10ms), pero
 * elimina la gran mayoría de las colisiones entre pestañas en la LAN.
 *
 * Auditoría post-plan (2026-10-01): compromiso documentado — el lease (8s)
 * NO tiene heartbeat: una operación crítica que dure más de 8s puede ser
 * considerada expirada por otra pestaña (doble adquisición). En la práctica
 * las secciones críticas son escrituras cortas (ms), muy por debajo del
 * lease. Si alguna vez una operación crítica supera ~5s, hay que añadir
 * renovación periódica del lease.
 */
const _STORAGE_LEASE_MS = 8000;
const _STORAGE_TIMEOUT_MS = 10000;

function _storageAvailable() {
  try {
    return typeof localStorage !== 'undefined'
      && typeof localStorage.getItem === 'function';
  } catch {
    return false;
  }
}

async function _storageMutex(name, fn) {
  const key = `pda_lock_${name}`;
  const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return 'UNREADABLE';
    }
  };

  const start = Date.now();
  while (Date.now() - start < _STORAGE_TIMEOUT_MS) {
    const held = read();
    if (held === 'UNREADABLE') return _memoryMutex(name, fn);
    const expired = !held || (Date.now() - (held.ts || 0) > _STORAGE_LEASE_MS);
    if (expired) {
      try {
        localStorage.setItem(key, JSON.stringify({ token, ts: Date.now() }));
      } catch {
        return _memoryMutex(name, fn);
      }
      // Ventana de carrera: re-leer para confirmar que nuestro token ganó.
      await sleep(10);
      const cur = read();
      if (cur && cur !== 'UNREADABLE' && cur.token === token) {
        try {
          return await fn();
        } finally {
          try {
            const c2 = read();
            if (c2 && c2 !== 'UNREADABLE' && c2.token === token) {
              localStorage.removeItem(key);
            }
          } catch { /* limpieza best effort */ }
        }
      }
    }
    await sleep(25 + Math.random() * 25);
  }
  // Timeout: no bloquear la venta; degradar al mutex en memoria.
  if (import.meta.env?.DEV) {
    console.warn(`[withLock] timeout adquiriendo lock cross-tab "${name}", usando mutex en memoria.`);
  }
  return _memoryMutex(name, fn);
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

  // Nivel 2: mutex cross-tab vía localStorage (B-8). Cubre HTTP en LAN donde
  // navigator.locks no existe por falta de contexto seguro.
  if (_storageAvailable()) {
    if (opts.fallbackWarning !== false && import.meta.env?.DEV) {
      console.warn(
        `[withLock] navigator.locks NO soportado. Usando mutex cross-tab (localStorage) para "${name}".`
      );
    }
    return _storageMutex(name, fn);
  }

  // Nivel 3: mutex en memoria (último recurso).
  if (opts.fallbackWarning !== false && import.meta.env?.DEV) {
    console.warn(
      `[withLock] navigator.locks NO soportado y localStorage no disponible. Usando mutex en memoria para "${name}". ` +
      `La exclusión mutua NO aplica entre tabs/navegadores.`
    );
  }
  return _memoryMutex(name, fn);
}

export default withLock;
