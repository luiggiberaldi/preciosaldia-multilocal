// tests/deepFreeze.test.js — Tests para utils/deepFreeze.

import { describe, it, expect } from 'vitest';
import { deepFreeze, isDeepFrozen } from '../src/utils/deepFreeze';

describe('deepFreeze', () => {
  it('congela plain objects anidados', () => {
    const obj = { a: 1, nested: { b: 2, deep: { c: 3 } } };
    deepFreeze(obj);
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.nested)).toBe(true);
    expect(Object.isFrozen(obj.nested.deep)).toBe(true);
  });

  it('congela arrays y sus elementos objeto', () => {
    const sale = {
      items: [{ price: 10 }, { price: 20 }],
      payments: [{ method: 'cash' }],
    };
    deepFreeze(sale);
    expect(Object.isFrozen(sale)).toBe(true);
    expect(Object.isFrozen(sale.items)).toBe(true);
    expect(Object.isFrozen(sale.items[0])).toBe(true);
    expect(Object.isFrozen(sale.payments)).toBe(true);
    expect(Object.isFrozen(sale.payments[0])).toBe(true);
  });

  it('lanza TypeError en strict mode al intentar mutar', () => {
    const sale = deepFreeze({ items: [{ price: 10 }] });
    expect(() => { sale.items[0].price = 999; }).toThrow(TypeError);
    expect(() => { sale.items.push({}); }).toThrow(TypeError);
    expect(() => { sale.newProp = 1; }).toThrow(TypeError);
  });

  it('no congela Date, Map, Set (los deja intactos)', () => {
    const obj = {
      date: new Date(),
      map: new Map(),
      set: new Set(),
    };
    deepFreeze(obj);
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.date)).toBe(false); // Date no se freeza
    expect(Object.isFrozen(obj.map)).toBe(false);
    expect(obj.map.set('k', 'v')).toBeInstanceOf(Map); // sigue funcional
  });

  it('es idempotente (llamar 2x es no-op)', () => {
    const obj = { a: { b: 1 } };
    deepFreeze(obj);
    expect(() => deepFreeze(obj)).not.toThrow();
    expect(isDeepFrozen(obj)).toBe(true);
  });

  it('maneja referencias circulares sin stack overflow', () => {
    const a = { name: 'a' };
    const b = { name: 'b', parent: a };
    a.child = b;
    expect(() => deepFreeze(a)).not.toThrow();
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
  });

  it('devuelve el mismo objeto (para encadenamiento)', () => {
    const obj = { a: 1 };
    const result = deepFreeze(obj);
    expect(result).toBe(obj);
  });

  it('pasa primitivos sin tocarlos', () => {
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze('hello')).toBe('hello');
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze(undefined)).toBe(undefined);
  });
});

describe('isDeepFrozen', () => {
  it('detecta congelación parcial', () => {
    const obj = { a: 1, nested: { b: 2 } };
    Object.freeze(obj); // shallow
    expect(isDeepFrozen(obj)).toBe(false); // nested no está congelado
  });

  it('confirma congelación profunda', () => {
    const obj = deepFreeze({ a: 1, nested: { b: 2, arr: [1, 2, { c: 3 }] } });
    expect(isDeepFrozen(obj)).toBe(true);
  });
});
