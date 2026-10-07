// tests/dinero.test.js — Tests de integridad para utils/dinero.js
// Garantiza que round2/mulR/divR/sumR/subR cumplan la política financiera declarada.

import { describe, it, expect } from 'vitest';
import { round2, round4, mulR, divR, sumR, subR } from '../src/utils/dinero';

describe('round2 — round-half-away-from-zero con epsilon', () => {
  it('redondea .005 a .01 (no .00 por IEEE 754)', () => {
    expect(round2(2.005)).toBe(2.01);
    expect(round2(0.005)).toBe(0.01);
    expect(round2(1.025)).toBe(1.03); // caso clásico de drift
  });

  it('redondea negativos correctamente (away from zero)', () => {
    expect(round2(-2.005)).toBe(-2.01);
    expect(round2(-1.5)).toBe(-1.5);
    expect(round2(-2.445)).toBe(-2.45);
  });

  it('maneja no-finitos devolviendo 0', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
    expect(round2(-Infinity)).toBe(0);
    expect(round2(undefined)).toBe(0);
    expect(round2(null)).toBe(0);
  });

  it('preserva enteros y decimales exactos', () => {
    expect(round2(10)).toBe(10);
    expect(round2(10.5)).toBe(10.5);
    expect(round2(10.55)).toBe(10.55);
    expect(round2(0)).toBe(0);
  });
});

describe('round4 — para tasas y precios unitarios', () => {
  it('redondea a 4 decimales', () => {
    expect(round4(1.23456789)).toBe(1.2346);
    expect(round4(0.00005)).toBe(0.0001);
  });
});

describe('mulR — multiplicación redondeada', () => {
  it('precio * cantidad * tasa sin drift', () => {
    // 10.99 * 3 * 580.5 = 19137.285 → 19137.29 (redondeado a 2)
    const price = 10.99;
    const qty = 3;
    const rate = 580.5;
    const result = mulR(mulR(price, qty), rate);
    expect(result).toBe(round2(10.99 * 3 * 580.5));
    expect(Number.isInteger(result * 100)).toBe(true); // siempre 2 decimales
  });

  it('maneja operandos null/undefined como 0', () => {
    expect(mulR(null, 5)).toBe(0);
    expect(mulR(5, undefined)).toBe(0);
    expect(mulR(NaN, 5)).toBe(0);
  });
});

describe('divR — división segura', () => {
  it('divide y redondea', () => {
    expect(divR(100, 3)).toBe(33.33);
    expect(divR(10, 4)).toBe(2.5);
  });

  it('devuelve 0 para divisor 0 o no-finito (no NaN/Infinity)', () => {
    expect(divR(100, 0)).toBe(0);
    expect(divR(100, NaN)).toBe(0);
    expect(divR(100, Infinity)).toBe(0);
    expect(divR(100, null)).toBe(0);
  });
});

describe('sumR — suma sin drift acumulado', () => {
  it('suma array redondeando al final', () => {
    expect(sumR([0.1, 0.2, 0.3])).toBe(0.6); // 0.1+0.2+0.3 = 0.6000000000000001 en JS crudo
    expect(sumR([1.005, 2.005, 3.005])).toBe(6.02); // cada uno redondea a .01
  });

  it('suma argumentos variádicos', () => {
    expect(sumR(1, 2, 3)).toBe(6);
    expect(sumR(0.1, 0.2)).toBe(0.3);
  });

  it('ignora null/undefined en el array', () => {
    expect(sumR([1, null, 2, undefined, 3])).toBe(6);
  });
});

describe('subR — resta segura', () => {
  it('resta y redondea', () => {
    expect(subR(10, 3.33)).toBe(6.67);
    expect(subR(0.3, 0.1)).toBe(0.2);
  });

  it('no devuelve negativos fantasma por drift', () => {
    expect(subR(0.3, 0.3)).toBe(0);
    expect(subR(1.0, 0.9999999999999999)).toBe(0); // drift absorbido por round2
  });
});

describe('Caso integrador: ticket de venta completo', () => {
  it('subtotal, descuento y total cuadran sin drift', () => {
    // 2.50*3 = 7.50, 1.25*2 = 2.50, 0.99*1 = 0.99 → subtotal = 10.99
    const items = [
      { priceUsd: 2.50, qty: 3 },
      { priceUsd: 1.25, qty: 2 },
      { priceUsd: 0.99, qty: 1 },
    ];
    const rate = 580.5;
    const discountPct = 10;

    const subtotalUsd = sumR(items.map((i) => mulR(i.priceUsd, i.qty)));
    expect(subtotalUsd).toBe(10.99);

    // 10.99 * 10% = 1.099 → round2 = 1.10
    const discountUsd = mulR(subtotalUsd, divR(discountPct, 100));
    expect(discountUsd).toBe(1.10);

    // 10.99 - 1.10 = 9.89
    const totalUsd = subR(subtotalUsd, discountUsd);
    expect(totalUsd).toBe(9.89);

    // 9.89 * 580.5 = 5741.145 → round2 = 5741.15
    const totalBs = mulR(totalUsd, rate);
    expect(totalBs).toBe(round2(9.89 * 580.5));
    expect(Number.isInteger(totalBs * 100)).toBe(true);
  });
});
