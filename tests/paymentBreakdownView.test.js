// tests/paymentBreakdownView.test.js — FIA-REPORT-001
// H4: el fiado diluía el denominador de los % de medios de pago.
// H8: el peso en Bs de una cuenta por cobrar usaba la tasa de hoy.

import { describe, it, expect } from 'vitest';
import { buildPaymentBreakdownRows, isReceivableBucket, toBsEquivalent } from '../src/utils/paymentBreakdownView';
import { FIXED_RATE } from './fixtures/receivablesScenarios';
import { runScenario } from './harness/receivablesHarness';

describe('buildPaymentBreakdownRows — denominador y porcentajes (H4)', () => {
    it('E1: con fiado positivo el efectivo vuelve a ser el 100% de los medios de pago', () => {
        const scenario = runScenario('E1_fiado_con_cobranzas');
        // Antes: (100 fiado + 150 efectivo) inflaban el denominador ⇒ efectivo = 37,5%
        expect(scenario.pctOf('efectivo_usd')).toBe(100);
        expect(scenario.denominatorBs).toBe(127434); // solo 150 USD de efectivo real
        expect(scenario.row('fiado').pct).toBeNull(); // una cuenta por cobrar no es un medio
        expect(scenario.row('fiado').amount).toBe(100);
    });

    it('E2: con neto negativo el efectivo sigue en 100% y el fiado no entra al denominador', () => {
        const scenario = runScenario('E2_cobranzas_mayor_que_fiado');
        expect(scenario.row('fiado').amount).toBe(-15);
        expect(scenario.row('fiado').pct).toBeNull();
        expect(scenario.pctOf('efectivo_usd')).toBe(100);
        expect(scenario.denominatorBs).toBe(21239); // 25 USD de cobranzas reales
    });

    it('E8: el crédito interno no entra al denominador ni genera porcentaje', () => {
        const scenario = runScenario('E8_saldo_a_favor_usado');
        expect(scenario.denominatorBs).toBe(0);
        expect(scenario.pctOf('saldo_favor')).toBeNull();
        expect(scenario.totals.internalCreditAppliedUsd).toBe(20);
    });

    it('propina, vuelto y comisión tampoco diluyen el denominador', () => {
        const breakdown = {
            efectivo_usd: { total: 100, currency: 'USD', label: 'Efectivo $' },
            pago_movil: { total: 84956, currency: 'BS', label: 'Pago Móvil' },
            _vuelto_usd: { total: 10, currency: 'USD', label: 'Vuelto', isChange: true },
            _propina_usd: { total: 5, currency: 'USD', label: 'Propina', isTip: true },
            _comision_avance: { total: 3, currency: 'USD', label: 'Comisión', isCommission: true },
            fiado: { total: 50, currency: 'FIADO', label: 'Fiado' },
        };
        const view = buildPaymentBreakdownRows(breakdown, { bcvRate: FIXED_RATE });
        // 100 USD (84.956 Bs) + 84.956 Bs exactos de Pago Móvil = 169.912 Bs
        expect(view.denominatorBs).toBe(169912);
        expect(view.rows.find(r => r.key === 'efectivo_usd').pct).toBe(50);
        expect(view.rows.find(r => r.key === 'pago_movil').pct).toBe(50);
        expect(view.rows.find(r => r.key === '_vuelto_usd').pct).toBeNull();
        expect(view.rows.find(r => r.key === '_propina_usd').pct).toBeNull();
        expect(view.rows.find(r => r.key === '_comision_avance').pct).toBeNull();
        expect(view.rows.find(r => r.key === 'fiado').pct).toBeNull();
        // I6: los % de los medios reales suman 100
        const sumPct = view.rows.filter(r => r.pct !== null).reduce((s, r) => s + r.pct, 0);
        expect(sumPct).toBe(100);
    });

    it('H1: un movimiento negativo NO se pierde (hasMovement se decide por el importe)', () => {
        const view = buildPaymentBreakdownRows({
            efectivo_bs: { total: -500, currency: 'BS', label: 'Efectivo Bs' },
            fiado: { total: -15, currency: 'FIADO', label: 'Fiado' },
        }, { bcvRate: FIXED_RATE });
        expect(view.rows.find(r => r.key === 'efectivo_bs').hasMovement).toBe(true);
        expect(view.rows.find(r => r.key === 'fiado').hasMovement).toBe(true);
        expect(view.rows.length).toBe(2);
    });
});

describe('H8 — el peso en Bs usa la tasa de la venta', () => {
    it('E10: dos fiados con tasas distintas conservan el Bs de su venta', () => {
        const scenario = runScenario('E10_tasa_cruzada');
        const fiado = scenario.row('fiado');
        // 10 USD @ 36,50 (=365 Bs) + 10 USD @ 849,56 (=8.495,60 Bs)
        expect(fiado.bsAtSaleRate).toBe(8860.6);
        expect(fiado.amountBs).toBe(8860.6);
        // Con la tasa de HOY el peso sería 16.991,20: el error que H8 evitaba.
        expect(toBsEquivalent({ total: 20, currency: 'FIADO' }, { bcvRate: FIXED_RATE })).toBe(16991.2);
        expect(fiado.amountBs).not.toBe(16991.2);
    });

    it('isReceivableBucket reconoce fiado y cashea, y no un método de pago', () => {
        expect(isReceivableBucket({ currency: 'FIADO' })).toBe(true);
        expect(isReceivableBucket({ currency: 'FIADO', isReceivable: true })).toBe(true);
        expect(isReceivableBucket({ currency: 'USD' })).toBe(false);
        expect(isReceivableBucket({ currency: 'BS' })).toBe(false);
        expect(isReceivableBucket({ currency: 'INTERNAL_CREDIT', isInternalCredit: true })).toBe(false);
    });
});
