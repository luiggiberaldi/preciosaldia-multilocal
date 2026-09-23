/**
 * tests/changeSplit.test.js — Desglose realista del vuelto (VUELTO-REALISTA, Fase 0).
 *
 * Matriz del plan PLAN-VUELTO-REALISTA.md + steppers + redondeo en Bs.
 * Contrato de redondeo (decidido con el dueño): el default es 'ceil' — a favor
 * del cliente (Bs 15,95 con paso 1 → Bs 16). 'floor' existe para tiendas que
 * retienen la diferencia.
 */

import { describe, it, expect } from 'vitest';
import {
    computeRealisticSplit,
    stepSplitDown,
    stepSplitUp,
} from '../src/utils/changeSplit.js';
import { floorR, ceilStepR } from '../src/utils/dinero.js';

describe('VUELTO-REALISTA · primitivas de redondeo en dinero.js', () => {
    it('floorR: hacia abajo al paso', () => {
        expect(floorR(15.95, 1)).toBe(15);
        expect(floorR(95.7, 1)).toBe(95);
        expect(floorR(0.999, 1)).toBe(0);
        expect(floorR(249.99, 50)).toBe(200);
    });

    it('ceilStepR: hacia arriba al paso', () => {
        expect(ceilStepR(15.95, 1)).toBe(16);
        expect(ceilStepR(95.7, 1)).toBe(96);
        expect(ceilStepR(200, 50)).toBe(200);      // múltiplo exacto no sube
        expect(ceilStepR(200.01, 50)).toBe(250);
    });

    it('pasos inválidos devuelven 0 (guardarraíl)', () => {
        expect(floorR(15.95, 0)).toBe(0);
        expect(floorR(NaN, 1)).toBe(0);
        expect(ceilStepR(15.95, -1)).toBe(0);
        expect(ceilStepR(NaN, 1)).toBe(0);
    });
});

describe('VUELTO-REALISTA · computeRealisticSplit — matriz del plan', () => {
    it('caso imagen: $6.20 a tasa 79.75 → $6 en billetes + Bs 15.95', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75 });
        expect(s.usdPart).toBe(6);
        expect(s.bsExact).toBe(15.95); // 0.20 × 79.75
        expect(s.bsPart).toBe(15.95);  // sin paso → exacto
        expect(s.remainderUsd).toBe(0);
        expect(s.source).toBe('ideal');
    });

    it('sin billetes de $1 (float $5): $6.20 → $5 + Bs 95.70', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, floatUsd: 5 });
        expect(s.usdPart).toBe(5);
        expect(s.bsExact).toBe(95.7); // 1.20 × 79.75
        expect(s.bsPart).toBe(95.7);
        expect(s.remainderUsd).toBe(0);
        expect(s.source).toBe('downgraded-float');
    });

    it('vuelto menor al billete: $0.80 → todo en Bs', () => {
        const s = computeRealisticSplit({ changeUsd: 0.80, rate: 79.75 });
        expect(s.usdPart).toBe(0);
        expect(s.bsExact).toBe(63.8);
        expect(s.remainderUsd).toBe(0);
        expect(s.source).toBe('all-bs');
    });

    it('cambio redondo: $6.00 exacto → $6 + Bs 0', () => {
        const s = computeRealisticSplit({ changeUsd: 6, rate: 79.75 });
        expect(s.usdPart).toBe(6);
        expect(s.bsExact).toBe(0);
        expect(s.bsPart).toBe(0);
        expect(s.source).toBe('exact-usd');
    });

    it('caja USD vacía: $6.20 → todo en Bs', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, floatUsd: 0 });
        expect(s.usdPart).toBe(0);
        expect(s.bsExact).toBe(494.45); // 6.20 × 79.75
        expect(s.remainderUsd).toBe(0);
        expect(s.source).toBe('all-bs');
    });

    it('redondeo a favor del cliente (ceil, default): Bs 15.95 → 16', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, bsRoundStep: 1 });
        expect(s.bsExact).toBe(15.95);
        expect(s.bsPart).toBe(16); // nunca 15: el cliente no pierde por el redondeo
        expect(s.remainderUsd).toBe(0);
    });

    it('modo tienda (floor): Bs 15.95 → 15 y el centavo queda declarado', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, bsRoundStep: 1, bsRoundMode: 'floor' });
        expect(s.bsPart).toBe(15);
        expect(s.remainderUsd).toBeCloseTo(0.01, 2); // (15.95−15)/79.75 = 0.0119 → round2 = 0.01
        expect(s.source).toBe('ideal');
    });
});

describe('VUELTO-REALISTA · guardarraíles de entrada', () => {
    it('vuelto cero o inválido → desglose vacío sin lanzar', () => {
        for (const changeUsd of [0, -5, NaN, undefined]) {
            const s = computeRealisticSplit({ changeUsd, rate: 79.75 });
            expect(s.usdPart).toBe(0);
            expect(s.bsPart).toBe(0);
        }
    });

    it('tasa inválida → no-rate: la fracción USD queda sin conversión', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 0 });
        expect(s.usdPart).toBe(6);
        expect(s.bsPart).toBe(0);
        expect(s.remainderUsd).toBeCloseTo(0.2, 2);
        expect(s.source).toBe('no-rate');
    });

    it('billete mínimo configurable: $5 → $6.20 deja $1.20 a Bs', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, smallestUsdBill: 5 });
        expect(s.usdPart).toBe(5);
        expect(s.bsExact).toBe(95.7);
    });

    it('el redondeo con paso no fabrica remainder fantasma en cambios exactos (6.00/1)', () => {
        const s = computeRealisticSplit({ changeUsd: 6, rate: 40, bsRoundStep: 1, floatUsd: 100 });
        expect(s.source).toBe('exact-usd');
        expect(s.remainderUsd).toBe(0);
        expect(s.bsPart).toBe(0);
    });
});

describe('VUELTO-REALISTA · steppers de un toque', () => {
    it('stepSplitDown: $6+Bs16 → $5+Bs96 con paso 1 (ceil)', () => {
        const base = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, bsRoundStep: 1 });
        expect(base.bsPart).toBe(16);
        const down = stepSplitDown({ changeUsd: 6.20, split: base, rate: 79.75, bsRoundStep: 1 });
        expect(down.usdPart).toBe(5);
        expect(down.bsPart).toBe(96); // 1.20 × 79.75 = 95.70 → ceil a bolívar = 96
        expect(down.source).toBe('ideal');
    });

    it('stepSplitDown no baja de $0', () => {
        const base = computeRealisticSplit({ changeUsd: 0.80, rate: 79.75 });
        const down = stepSplitDown({ changeUsd: 0.80, split: base, rate: 79.75 });
        expect(down.usdPart).toBe(0);
        expect(down.bsExact).toBe(63.8);
    });

    it('stepSplitUp: recupera el billete sin pasarse del vuelto', () => {
        const base = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, floatUsd: 5 });
        expect(base.usdPart).toBe(5);
        const up = stepSplitUp({ changeUsd: 6.20, split: base, rate: 79.75 });
        expect(up.usdPart).toBe(6);
        expect(up.bsExact).toBe(15.95);
        expect(up.remainderUsd).toBe(0);
    });

    it('stepSplitUp respeta el límite del vuelto total', () => {
        const base = computeRealisticSplit({ changeUsd: 6, rate: 79.75 });
        const up = stepSplitUp({ changeUsd: 6, split: base, rate: 79.75 });
        expect(up.usdPart).toBe(6); // $6 es el vuelto completo — no hay $7
        expect(up.bsPart).toBe(0);
    });
});

describe('VUELTO-REALISTA · integridad del registro', () => {
    it('con ceil el split cubre TODO el vuelto (remainder 0)', () => {
        const cases = [
            { changeUsd: 6.20, rate: 79.75, floatUsd: 5, bsRoundStep: 1 },
            { changeUsd: 3.33, rate: 36.5, floatUsd: 2, bsRoundStep: 5 },
            { changeUsd: 12.99, rate: 80.1, floatUsd: 100, bsRoundStep: 10 },
            { changeUsd: 0.05, rate: 79.75, bsRoundStep: 1 },
        ];
        for (const c of cases) {
            const s = computeRealisticSplit(c);
            expect(s.remainderUsd).toBe(0);
        }
    });

    it('con floor el registro nunca supera el vuelto (a favor de la tienda)', () => {
        const cases = [
            { changeUsd: 6.20, rate: 79.75, floatUsd: 5, bsRoundStep: 1, bsRoundMode: 'floor' },
            { changeUsd: 3.33, rate: 36.5, floatUsd: 2, bsRoundStep: 5, bsRoundMode: 'floor' },
        ];
        for (const c of cases) {
            const s = computeRealisticSplit(c);
            const covered = s.usdPart + s.bsPart / c.rate;
            expect(covered).toBeLessThanOrEqual(c.changeUsd + 1e-9);
        }
    });

    it('round-trip: los valores del split son serializables al contrato changeBreakdown', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, bsRoundStep: 1 });
        expect(Number(s.usdPart.toFixed(2))).toBe(s.usdPart);
        expect(Number(s.bsPart.toFixed(2))).toBe(s.bsPart);
        expect(s.bsPart).toBeGreaterThanOrEqual(0);
    });
});
