/**
 * tests/changeSplitSettings.test.js — VUELTO-REALISTA Fase 3: ajustes por tienda.
 *
 * La Configuración (→ Ventas → Desglose del Cambio) persiste tres claves en
 * localStorage: checkout_smallest_usd_bill, checkout_bs_round_step y
 * checkout_bs_round_mode. Este test fija los contratos:
 *  - Parseo tolerante de las preferencias (defaults ante basura/ausencia).
 *  - La preferencia de la tienda FEDE el cálculo: la propuesta cambia según el
 *    billete mínimo, el paso de redondeo y su dirección.
 *  - Consistencia con el flujo de pre-llenado del modal (strings serializables).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeRealisticSplit, stepSplitDown, stepSplitUp } from '../src/utils/changeSplit.js';

/** Réplica exacta del parseo de CheckoutModal (extraer a util si crece). */
function readStorePrefs() {
    const _billRaw = parseFloat(localStorage.getItem('checkout_smallest_usd_bill'));
    const bill = Number.isFinite(_billRaw) && _billRaw > 0 ? _billRaw : 1;
    const _stepRaw = parseFloat(localStorage.getItem('checkout_bs_round_step'));
    const step = Number.isFinite(_stepRaw) && _stepRaw >= 0 ? _stepRaw : 0;
    const mode = localStorage.getItem('checkout_bs_round_mode') === 'floor' ? 'floor' : 'ceil';
    return { bill, step, mode };
}

describe('VUELTO-REALISTA Fase 3 · parseo de preferencias por tienda', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('defaults sin configuración: billete 1, sin redondeo, a favor del cliente', () => {
        expect(readStorePrefs()).toEqual({ bill: 1, step: 0, mode: 'ceil' });
    });

    it('valores guardados por la UI se leen tal cual', () => {
        localStorage.setItem('checkout_smallest_usd_bill', '5');
        localStorage.setItem('checkout_bs_round_step', '1');
        localStorage.setItem('checkout_bs_round_mode', 'floor');
        expect(readStorePrefs()).toEqual({ bill: 5, step: 1, mode: 'floor' });
    });

    it('basura o inválidos caen a los defaults (sin NaN en el cálculo)', () => {
        localStorage.setItem('checkout_smallest_usd_bill', 'abc');
        localStorage.setItem('checkout_bs_round_step', '-3');
        localStorage.setItem('checkout_bs_round_mode', 'no-existe');
        expect(readStorePrefs()).toEqual({ bill: 1, step: 0, mode: 'ceil' });
    });
});

describe('VUELTO-REALISTA Fase 3 · la preferencia fedea la propuesta', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('billete mínimo 5: el vuelto en $ baja y crece la parte en Bs', () => {
        const base = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75 });
        expect(base.usdPart).toBe(6);

        localStorage.setItem('checkout_smallest_usd_bill', '5');
        const { bill, step, mode } = readStorePrefs();
        const tuned = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, smallestUsdBill: bill, bsRoundStep: step, bsRoundMode: mode });
        expect(tuned.usdPart).toBe(5);
        expect(tuned.bsExact).toBe(95.7);
    });

    it('redondeo Bs 1 a favor del cliente: Bs 15,95 → 16 (ceil)', () => {
        localStorage.setItem('checkout_bs_round_step', '1');
        const { bill, step, mode } = readStorePrefs();
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, smallestUsdBill: bill, bsRoundStep: step, bsRoundMode: mode });
        expect(s.bsPart).toBe(16);
        expect(s.remainderUsd).toBe(0);
    });

    it('redondeo Bs 1 a favor de la tienda: Bs 15,95 → 15 con centavo declarado', () => {
        localStorage.setItem('checkout_bs_round_step', '1');
        localStorage.setItem('checkout_bs_round_mode', 'floor');
        const { bill, step, mode } = readStorePrefs();
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, smallestUsdBill: bill, bsRoundStep: step, bsRoundMode: mode });
        expect(s.bsPart).toBe(15);
        expect(s.remainderUsd).toBeCloseTo(0.01, 2);
    });

    it('los steppers respetan la config de la tienda (billete 5: pasos de $5)', () => {
        localStorage.setItem('checkout_smallest_usd_bill', '5');
        const { bill, step, mode } = readStorePrefs();
        const base = computeRealisticSplit({ changeUsd: 12.5, rate: 40, smallestUsdBill: bill, bsRoundStep: step, bsRoundMode: mode });
        expect(base.usdPart).toBe(10);

        const down = stepSplitDown({ changeUsd: 12.5, split: base, rate: 40, smallestUsdBill: bill, bsRoundStep: step, bsRoundMode: mode });
        expect(down.usdPart).toBe(5); // un paso = un billete de $5
        expect(down.bsPart).toBe(300); // $2.5 × 40

        const up = stepSplitUp({ changeUsd: 12.5, split: down, rate: 40, smallestUsdBill: bill, bsRoundStep: step, bsRoundMode: mode });
        expect(up.usdPart).toBe(10);
    });

    it('el ejemplo del texto de la UI cuadra: $6.20 · $1 · ceil paso 1 → $6 + Bs 16', () => {
        const s = computeRealisticSplit({ changeUsd: 6.20, rate: 79.75, smallestUsdBill: 1, bsRoundStep: 1, bsRoundMode: 'ceil' });
        expect(s.usdPart).toBe(6);
        expect(s.bsPart).toBe(16);
        // Contrato de pre-llenado del modal: strings numéricas válidas.
        expect(s.usdPart.toFixed(2)).toBe('6.00');
        expect(s.bsPart.toFixed(2)).toBe('16.00');
    });
});
