/**
 * tests/changeSplitSteppers.test.js — Fase 2: steppers ± de la fila de vuelto.
 *
 * Contrato de la UI (CheckoutModal → MobileChangeAllocation):
 *  - Los steppers SOLO se muestran en estado 'pending' (asignación sin editar).
 *  - StepDown resta un billete a la parte USD y recalcula los Bs al instante.
 *  - StepUp suma un billete sin pasarse del vuelto total (cubre todo).
 *  - Los valores pre-llenados por los steppers son strings numéricas válidas
 *    para changeUsdGiven/changeBsGiven (contrato changeBreakdown).
 */

import { describe, it, expect } from 'vitest';
import { computeRealisticSplit, stepSplitDown, stepSplitUp } from '../src/utils/changeSplit.js';

const RATE = 40; // determinista, igual al fixture E2E

describe('VUELTO-REALISTA Fase 2 · visibilidad de steppers (canStep*)', () => {
    it('canStepDown: hay algo de USD que bajar', () => {
        const s = computeRealisticSplit({ changeUsd: 5, rate: RATE });
        // Replicando la lógica del modal: canStepDown = pending && usdPart > 0
        const canStepDown = s.usdPart > 0;
        expect(canStepDown).toBe(true);

        const allBs = computeRealisticSplit({ changeUsd: 0.5, rate: RATE });
        expect((allBs.usdPart > 0)).toBe(false); // sin USD no hay "−"
    });

    it('canStepUp: solo si el paso +1 crece sin dejar remainder', () => {
        // $3.20 → base $3 + Bs 8; subir a $3.20 (todo USD) sigue cubriendo todo.
        const s = computeRealisticSplit({ changeUsd: 3.20, rate: RATE });
        expect(s.usdPart).toBe(3);
        expect(s.bsPart).toBe(8);
        const up = stepSplitUp({ changeUsd: 3.20, split: s, rate: RATE });
        const canStepUp = up.usdPart > s.usdPart && up.remainderUsd <= 0.005;
        expect(canStepUp).toBe(true);
        expect(up.usdPart).toBe(3.20); // el billete exacto del vuelto

        // En el techo (vuelto todo-USD) no hay "+": el paso no crece.
        const ceiling = computeRealisticSplit({ changeUsd: 5, rate: RATE });
        const upCeiling = stepSplitUp({ changeUsd: 5, split: ceiling, rate: RATE });
        expect((upCeiling.usdPart > ceiling.usdPart && upCeiling.remainderUsd <= 0.005)).toBe(false);

        // Con vuelto menor a un billete, subir cubre con el billete exacto.
        const tiny = computeRealisticSplit({ changeUsd: 0.5, rate: RATE });
        const tinyUp = stepSplitUp({ changeUsd: 0.5, split: tiny, rate: RATE });
        expect(tinyUp.usdPart).toBe(0.5);
        expect(tinyUp.remainderUsd).toBe(0);
    });

    it('canStepUp es falso cuando el vuelto ya está todo en USD', () => {
        const s = computeRealisticSplit({ changeUsd: 5, rate: RATE });
        const atCeiling = stepSplitUp({ changeUsd: 5, split: s, rate: RATE });
        // Replicando: up.usdPart > s.usdPart — en el techo no crece.
        const canStepUp = atCeiling.usdPart > s.usdPart;
        expect(canStepUp).toBe(false);
    });
});

describe('VUELTO-REALISTA Fase 2 · el escenario del cajero sin billetes', () => {
    it('$5 de vuelto, no hay billetes de $1 → stepDown entrega $4 + Bs 40', () => {
        const base = computeRealisticSplit({ changeUsd: 5, rate: RATE });
        expect(base.usdPart).toBe(5);
        expect(base.bsPart).toBe(0);

        const down = stepSplitDown({ changeUsd: 5, split: base, rate: RATE });
        expect(down.usdPart).toBe(4);
        expect(down.bsPart).toBe(40); // $1 × 40

        // Un toque más: $3 + Bs 80
        const down2 = stepSplitDown({ changeUsd: 5, split: down, rate: RATE });
        expect(down2.usdPart).toBe(3);
        expect(down2.bsPart).toBe(80);
    });

    it('stepDown desde $1 llega a todo-en-Bs (usdPart 0 → campo USD se vacía)', () => {
        const base = computeRealisticSplit({ changeUsd: 1.5, rate: RATE });
        expect(base.usdPart).toBe(1);

        const down = stepSplitDown({ changeUsd: 1.5, split: base, rate: RATE });
        expect(down.usdPart).toBe(0);
        expect(down.bsPart).toBe(60); // $1.50 × 40

        // Contrato de pre-llenado: usdPart 0 → '' (campo vacío), Bs → string.
        const usdField = down.usdPart > 0 ? down.usdPart.toFixed(2) : '';
        const bsField = down.bsPart > 0 ? down.bsPart.toFixed(2) : '';
        expect(usdField).toBe('');
        expect(bsField).toBe('60.00');
    });

    it('stepUp recupera el desglose ideal tras bajar de más', () => {
        const base = computeRealisticSplit({ changeUsd: 5, rate: RATE });
        const down = stepSplitDown({ changeUsd: 5, split: base, rate: RATE });
        const recovered = stepSplitUp({ changeUsd: 5, split: down, rate: RATE });
        expect(recovered.usdPart).toBe(5);
        expect(recovered.bsPart).toBe(0);
    });

    it('cada paso cubre SIEMPRE el vuelto completo (remainder 0 en ceil)', () => {
        let split = computeRealisticSplit({ changeUsd: 6.4, rate: RATE });
        const total = 6.4;
        for (let i = 0; i < 7; i++) {
            expect(split.remainderUsd).toBe(0);
            const covered = split.usdPart + split.bsPart / RATE;
            expect(covered).toBeGreaterThanOrEqual(total - 1e-9);
            const next = stepSplitDown({ changeUsd: total, split, rate: RATE });
            if (next.usdPart === split.usdPart && next.bsPart === split.bsPart) break;
            split = next;
        }
        expect(split.usdPart).toBe(0); // llegó a todo-Bs sin romper cobertura
    });
});

describe('VUELTO-REALISTA Fase 2 · operación sobre la propuesta, no sobre edits', () => {
    it('los steppers usan el vuelto total real (no reconstruyen desde el split)', () => {
        // Si alguien reconstruye el total desde bsPart/rate tras un ceil, pierde
        // centavos: el contrato exige pasar changeUsd explícito.
        const base = computeRealisticSplit({ changeUsd: 2.2, rate: 79.75, bsRoundStep: 1 });
        const down = stepSplitDown({ changeUsd: 2.2, split: base, rate: 79.75, bsRoundStep: 1 });
        const expectedBs = Math.ceil(((2.2 - (base.usdPart - 1)) * 79.75) / 1) * 1;
        expect(down.bsPart).toBe(expectedBs);
    });
});
