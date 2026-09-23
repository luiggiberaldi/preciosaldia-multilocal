// tests/withLock.test.js — Tests para el wrapper navigator.locks con fallback.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { withLock, isLocksSupported } from '../src/utils/withLock';

describe('isLocksSupported', () => {
  it('devuelve un booleano', () => {
    expect(typeof isLocksSupported()).toBe('boolean');
  });
});

describe('withLock — camino nativo (navigator.locks disponible)', () => {
  it('ejecuta el callback y devuelve su resultado', async () => {
    const result = await withLock('test_lock_1', async () => 42);
    expect(result).toBe(42);
  });

  it('propaga errores del callback', async () => {
    await expect(
      withLock('test_lock_2', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });

  it('garantiza exclusión mutua entre llamadas concurrentes', async () => {
    const order = [];
    const slow = async (id) => {
      await withLock('mutex_test', async () => {
        order.push(`start_${id}`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`end_${id}`);
      });
    };
    await Promise.all([slow(1), slow(2), slow(3)]);
    // Deben estar start/end intercalados (no overlapping).
    expect(order).toEqual([
      'start_1', 'end_1',
      'start_2', 'end_2',
      'start_3', 'end_3',
    ]);
  });
});

describe('withLock — fallback (sin navigator.locks)', () => {
  let originalLocks;
  beforeEach(() => {
    originalLocks = navigator.locks;
    // Eliminar navigator.locks para forzar el fallback.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, 'locks', { value: originalLocks, configurable: true });
  });

  it('cae al mutex en memoria y sigue garantizando exclusión', async () => {
    expect(isLocksSupported()).toBe(false);
    const order = [];
    const slow = async (id) => {
      await withLock('fallback_same_name_test', async () => {
        order.push(`start_${id}`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`end_${id}`);
      });
    };
    await Promise.all([slow(1), slow(2)]);
    expect(order).toEqual(['start_1', 'end_1', 'start_2', 'end_2']);
  });
});

describe('withLock — validación de argumentos', () => {
  it('lanza TypeError si name no es string', async () => {
    await expect(withLock(null, async () => 1)).rejects.toThrow(TypeError);
    await expect(withLock('', async () => 1)).rejects.toThrow(TypeError);
  });

  it('lanza TypeError si fn no es función', async () => {
    await expect(withLock('x', null)).rejects.toThrow(TypeError);
    await expect(withLock('x', 'notafn')).rejects.toThrow(TypeError);
  });
});

describe('withLock — recuperación ante fallo del mecanismo nativo', () => {
  it('cae al mutex si navigator.locks.request lanza', async () => {
    const originalRequest = navigator.locks.request;
    let callCount = 0;
    navigator.locks.request = (name, opts, fn) => {
      callCount++;
      if (callCount === 1) throw new Error('transient');
      return fn();
    };
    const result = await withLock('recovery_test', async () => 'ok');
    expect(result).toBe('ok');
    navigator.locks.request = originalRequest;
  });
});
