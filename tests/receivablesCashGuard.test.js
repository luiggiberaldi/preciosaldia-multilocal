// tests/receivablesCashGuard.test.js — FIA-REPORT-001
// H9 (P0): una venta a crédito SIN pagos se contaba como efectivo recibido.
// Cubre también I9 (ningún bucket de efectivo recibe crédito) e I10 (nada de
// mezclar unidades dentro de un bucket).

import { describe, it, expect } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { round2 } from '../src/utils/dinero';
import { runScenario, scenarioNames } from './harness/receivablesHarness';

const CASH_KEYS = /^efectivo_/;

const cashBucketsOf = (breakdown) => Object.keys(breakdown)
    .filter(key => CASH_KEYS.test(key))
    .sort();

/** Suma de los buckets de caja, por moneda. */
const cashTotals = (breakdown) => Object.keys(breakdown)
    .filter(key => CASH_KEYS.test(key))
    .reduce((acc, key) => {
        const bucket = breakdown[key];
        if (bucket.currency === 'USD') acc.usd = round2(acc.usd + bucket.total);
        else if (bucket.currency === 'BS') acc.bs = round2(acc.bs + bucket.total);
        else if (bucket.currency === 'COP') acc.cop = round2(acc.cop + bucket.total);
        return acc;
    }, { usd: 0, bs: 0, cop: 0 });

describe('H9 — el crédito no es efectivo', () => {
    it('E13: una venta 100 % fiada no crea ningún bucket de efectivo', () => {
        const { breakdown, expected } = runScenario('E13_venta_100_fiada');
        expect(cashBucketsOf(breakdown)).toEqual(expected.cashBuckets);
        expect(Object.keys(breakdown)).toEqual(['fiado']);
        expect(breakdown.fiado.total).toBe(20);
        expect(breakdown.fiado.currency).toBe('FIADO');
    });

    it('E14: el fiado manual (objeto sin `payments`) tampoco acredita caja', () => {
        const { breakdown } = runScenario('E14_fiado_manual_sin_payments');
        expect(cashBucketsOf(breakdown)).toEqual([]);
        expect(breakdown.fiado.total).toBe(50);
        expect(breakdown.efectivo_bs).toBeUndefined();
    });

    it('E15: un `paymentMethod: "fiado"` legacy no vuelca Bs en el bucket fiado (I10)', () => {
        const { breakdown } = runScenario('E15_legacy_payment_method_fiado');
        expect(breakdown.fiado.currency).toBe('FIADO');
        expect(breakdown.fiado.total).toBe(20); // USD, nunca 20 + 20×tasa
        expect(breakdown.fiado.total).not.toBe(round2(20 + 20 * 849.56));
        expect(cashBucketsOf(breakdown)).toEqual([]);
    });

    it('E1/E2: el escenario mixto ya no genera efectivo Bs fantasma', () => {
        ['E1_fiado_con_cobranzas', 'E2_cobranzas_mayor_que_fiado'].forEach(name => {
            const { breakdown } = runScenario(name);
            expect(breakdown.efectivo_bs, `${name} no debe tener efectivo_bs`).toBeUndefined();
        });
    });

    it('mantiene FIN-004: el fiado parcial con pagos reales sí registra su caja', () => {
        const { breakdown } = runScenario('E5_fiado_parcial');
        expect(breakdown.fiado.total).toBe(30);        // solo lo fiado
        expect(breakdown.efectivo_usd.total).toBe(70);  // el pago real
        expect(cashBucketsOf(breakdown)).toEqual(['efectivo_usd']);
    });

    it('una venta a crédito legacy con método de cobro explícito registra SOLO lo cobrado', () => {
        const venta = {
            id: 'legacy-1',
            tipo: 'VENTA_FIADA',
            status: 'COMPLETADA',
            rate: 849.56,
            totalUsd: 20,
            totalBs: 16991.2,
            fiadoUsd: 12,
            paymentMethod: 'efectivo_bs',
            items: [],
        };
        const breakdown = FinancialEngine.calculatePaymentBreakdown([venta]);
        // 20 − 12 = 8 cobrados ⇒ 8 × 849,56 = 6.796,48 Bs (antes sumaba los 20 completos)
        expect(breakdown.efectivo_bs.total).toBe(6796.48);
        expect(breakdown.fiado.total).toBe(12);
    });

    it('un abono legacy SIN pagos sigue siendo efectivo real (no se toca)', () => {
        const abonoLegacy = {
            id: 'legacy-abono',
            tipo: 'COBRO_DEUDA',
            status: 'COMPLETADA',
            rate: 849.56,
            totalUsd: 30,
            totalBs: 25486.8,
            paymentMethod: 'efectivo_bs',
            items: [],
        };
        const breakdown = FinancialEngine.calculatePaymentBreakdown([abonoLegacy]);
        expect(breakdown.efectivo_bs.total).toBe(25486.8);
        expect(breakdown.fiado.total).toBe(-30);
    });
});

describe('I9 — la caja del motor es exactamente lo que se cobró', () => {
    it('en todos los escenarios, caja == pagos reales (suma a mano independiente)', () => {
        scenarioNames().forEach(name => {
            const { breakdown, raw } = runScenario(name);
            const cash = cashTotals(breakdown);
            expect(cash.usd, `${name}: caja USD`).toBe(raw.cashUsd);
            expect(cash.bs, `${name}: caja Bs`).toBe(raw.cashBs);
        });
    });

    it('I10: ningún bucket de divisa recibe importes en Bs', () => {
        scenarioNames().forEach(name => {
            const { breakdown } = runScenario(name);
            Object.entries(breakdown).forEach(([key, data]) => {
                if (data.currency !== 'USD' && data.currency !== 'FIADO') return;
                // Un bucket USD/FIADO con importe del orden de miles de Bs delata una mezcla.
                expect(
                    Math.abs(data.total),
                    `${name}.${key} parece traer Bs dentro de un bucket de divisa`
                ).toBeLessThan(1000);
            });
        });
    });
});
