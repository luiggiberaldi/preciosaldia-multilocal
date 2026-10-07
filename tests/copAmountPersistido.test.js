import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { desglosePorMoneda } from '../src/utils/modoJefe.js';

// CRÍTICO-4 (2026-10-01): el chip COP de supervisión siempre mostraba $0 porque
// los payments del checkout no persistían `amountCop` (solo amountUsd/amountBs).

describe('CRÍTICO-4: amountCop persistido en los pagos', () => {
    it('guardrail: el builder de payments del checkout básico escribe amountCop', () => {
        const hook = readFileSync('src/hooks/useCheckoutCalculations.js', 'utf8');
        expect(hook).toContain('amountCop:');
    });

    it('guardrail: el builder de payments del checkout POS escribe amountCop', () => {
        const pos = readFileSync('src/components/Sales/CheckoutModalPOS/index.jsx', 'utf8');
        expect(pos).toContain('amountCop:');
    });

    it('guardrail: la remesa Cashea escribe amountCop en su pago', () => {
        const rem = readFileSync('src/utils/casheaRemittanceProcessor.js', 'utf8');
        expect(rem).toContain('amountCop:');
    });

    it('modoJefe: un pago COP con amountCop suma al desglose COP', () => {
        const sale = {
            payments: [
                // Así los construye ahora el checkout para un pago en COP.
                { currency: 'COP', amountInput: 8200, amountUsd: 2, amountBs: 500, amountCop: 8200 },
            ],
        };
        const d = desglosePorMoneda(sale);
        expect(d.COP).toBe(8200);
    });

    it('modoJefe: sin amountCop (ventas viejas) el desglose COP es 0, no NaN', () => {
        const sale = {
            payments: [{ currency: 'COP', amountInput: 8200, amountUsd: 2, amountBs: 500 }],
        };
        const d = desglosePorMoneda(sale);
        expect(d.COP).toBe(0);
    });
});
