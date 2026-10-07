/**
 * deepFreeze.js — Congelación profunda e inmutable de objetos/arrays.
 *
 * Problema que resuelve:
 *   - FIN-008: `Object.freeze(sale)` es shallow. `sale.items[0].priceUsd = 999`
 *     sigue siendo posible, al igual que `sale.payments.push(...)`. Además
 *     `updatedProducts`/`updatedCustomers` se retornaban sin freeze.
 *
 * Implementación:
 *   - Recursiva, detecta plain objects y arrays.
 *   - Evita loops circulares con un WeakSet de objetos ya visitados.
 *   - Devuelve el mismo objeto (freeze es in-place) para permitir encadenamiento.
 *   - Es idempotente: llamar sobre un objeto ya congelado es un no-op seguro.
 *
 * @module utils/deepFreeze
 */

const _frozen = new WeakSet();

/**
 * Congela profundamente un valor. Solo afecta plain objects y arrays;
 * funciones, fechas, regex, etc. se devuelven intactas.
 *
 * @template T
 * @param {T} value - Valor a congelar.
 * @returns {T} El mismo valor, ahora congelado profundamente.
 *
 * @example
 *   const sale = deepFreeze({
 *     id: '123',
 *     items: [{ priceUsd: 10, qty: 2 }],
 *     payments: [{ methodId: 'efectivo_bs', amount: 20 }]
 *   });
 *   sale.items[0].priceUsd = 999; // → TypeError en strict mode (silencioso en sloppy)
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  // Ya visitado/congelado: evita recursión infinita y trabajo redundante.
  if (_frozen.has(value)) return value;
  // Solo congelar plain objects y arrays. No tocar Date, Map, Set, ArrayBuffer, etc.
  const proto = Object.getPrototypeOf(value);
  const isPlain = proto === Object.prototype || proto === Array.prototype || proto === null;
  if (!isPlain) return value;

  // Congelar primero las propiedades propias (para que Object.isFrozen sea true cuanto antes).
  Object.freeze(value);
  _frozen.add(value);

  // Recursión sobre propiedades enumerables.
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

/**
 * Verifica si un valor está profundamente congelado (recursivo, para tests).
 * No es de uso normal en runtime; existe para aserciones en tests.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  const proto = Object.getPrototypeOf(value);
  const isPlain = proto === Object.prototype || proto === Array.prototype || proto === null;
  if (!isPlain) return true;
  return Object.keys(value).every((k) => isDeepFrozen(value[k]));
}

export default deepFreeze;
