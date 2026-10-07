// tests/receivablesReport.test.js — FIA-REPORT-001
// H1 (nada con movimiento se oculta), H2 (flujo ≠ cartera), H3 (cobranzas
// trazables) y la integración con calculateReportsData.

import { describe, it, expect } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import {
    buildReceivablesView,
    computeCarteraUsd,
    computeReceivablesMovements,
    filterHistoryByKind,
} from '../src/utils/receivablesReport';
import { calculateReportsData } from '../src/utils/reportsProcessor';
import { CARTERA_FIXTURE, FIXED_RATE, PERIOD_FROM, PERIOD_TO, SCENARIOS, fiadoSale } from './fixtures/receivablesScenarios';
import { runScenario } from './harness/receivablesHarness';

describe('computeReceivablesMovements — golden por escenario', () => {
    it('E1: fiado 150, cobranzas 50, neto +100', () => {
        const { receivables } = runScenario('E1_fiado_con_cobranzas');
        expect(receivables.fiadoOtorgadoUsd).toBe(150);
        expect(receivables.cobranzasUsd).toBe(50);
        expect(receivables.netoUsd).toBe(100);
        expect(receivables.fiados).toHaveLength(1);
        expect(receivables.cobranzas).toHaveLength(1);
    });

    it('E2: cobranzas > fiado ⇒ neto −15 y hay movimiento (antes desaparecía)', () => {
        const { receivables, view } = runScenario('E2_cobranzas_mayor_que_fiado');
        expect(receivables.fiadoOtorgadoUsd).toBe(10);
        expect(receivables.cobranzasUsd).toBe(25);
        expect(receivables.netoUsd).toBe(-15);
        expect(view.hasMovement).toBe(true);
    });

    it('E3: solo cobranzas ⇒ neto −40 y la sección sigue visible', () => {
        const { receivables, view } = runScenario('E3_solo_cobranzas');
        expect(receivables.fiadoOtorgadoUsd).toBe(0);
        expect(receivables.cobranzasUsd).toBe(40);
        expect(view.hasMovement).toBe(true);
    });

    it('E4: el excedente del abono queda trazado como saldo a favor generado', () => {
        const { receivables } = runScenario('E4_abono_con_excedente');
        expect(receivables.netoUsd).toBe(-15);
        expect(receivables.saldoFavorGeneradoUsd).toBe(15);
        expect(receivables.cobranzas[0].saldoFavorGeneradoUsd).toBe(15);
        // Y el motor separa los dos orígenes del bucket (H7).
        const { breakdown } = runScenario('E4_abono_con_excedente');
        expect(breakdown._saldo_favor_generado.total).toBe(15);
        expect(breakdown._saldo_favor_generado.origins).toEqual({ vueltoMonederoUsd: 0, excedenteAbonoUsd: 15 });
    });

    it('E7: Cashea con neto 0 sigue siendo visible aunque el motor descarte el bucket', () => {
        const scenario = runScenario('E7_cashea_ida_y_vuelta');
        expect(scenario.receivables.fiadoOtorgadoUsd).toBe(40);
        expect(scenario.receivables.cobranzasUsd).toBe(40);
        expect(scenario.receivables.netoUsd).toBe(0);
        expect(scenario.view.hasMovement).toBe(true);
        // El bucket desaparece por la regla de "cero buckets en 0" del motor:
        // por eso la vista NO puede depender de él.
        expect(scenario.breakdown.cashea).toBeUndefined();
    });

    it('E6: todo anulado no deja movimiento alguno', () => {
        const scenario = runScenario('E6_anuladas');
        expect(scenario.receivables.fiadoOtorgadoUsd).toBe(0);
        expect(scenario.receivables.cobranzasUsd).toBe(0);
        expect(scenario.view.hasMovement).toBe(false);
        expect(scenario.receivables.movimientoCount).toBe(0);
        expect(Object.keys(scenario.breakdown)).toHaveLength(0);
    });

    it('E13/E14: el fiado otorgado sale de `fiadoUsd`, no del total del ticket', () => {
        expect(runScenario('E13_venta_100_fiada').receivables.fiadoOtorgadoUsd).toBe(20);
        expect(runScenario('E14_fiado_manual_sin_payments').receivables.fiadoOtorgadoUsd).toBe(50);
        // FIN-004: con pago parcial, solo lo fiado
        expect(runScenario('E5_fiado_parcial').receivables.fiadoOtorgadoUsd).toBe(30);
    });

    it('excluye lo que cae fuera del rango consultado', () => {
        const sales = [
            fiadoSale('dentro', 10, { day: 10 }),
            { ...fiadoSale('fuera', 99), timestamp: '2026-10-05T14:00:00' },
        ];
        const inRange = computeReceivablesMovements(sales, { from: PERIOD_FROM, to: PERIOD_TO });
        expect(inRange.fiadoOtorgadoUsd).toBe(10);
        expect(inRange.fiados).toHaveLength(1);
        expect(inRange.fiados[0].saleId).toBe('dentro');
    });
});

describe('buildReceivablesView — tres cifras distintas, ninguna llamada "Por Cobrar" (H2)', () => {
    it('expone otorgado / cobranzas / neto y, si se pasa, la cartera acumulada', () => {
        const receivables = computeReceivablesMovements(SCENARIOS.E1_fiado_con_cobranzas.sales);
        const view = buildReceivablesView(receivables, { carteraUsd: 195.75 });
        expect(view.rows.map(r => r.key)).toEqual(['fiado_otorgado', 'cobranzas', 'neto', 'cartera']);
        expect(view.rows.map(r => r.amountUsd)).toEqual([150, 50, 100, 195.75]);
        expect(view.rows.find(r => r.key === 'cartera').isStock).toBe(true);
    });

    it('sin cartera no inventa la fila de stock', () => {
        const view = buildReceivablesView(computeReceivablesMovements([]), {});
        expect(view.rows.map(r => r.key)).toEqual(['fiado_otorgado', 'cobranzas', 'neto']);
        expect(view.hasMovement).toBe(false);
    });

    it('computeCarteraUsd suma deuda y deuda Cashea, ignorando el saldo a favor', () => {
        expect(computeCarteraUsd(CARTERA_FIXTURE.customers)).toBe(CARTERA_FIXTURE.expectedCarteraUsd);
        expect(computeCarteraUsd([])).toBe(0);
    });
});

describe('calculateReportsData — integración (H3, I3)', () => {
    const build = (sales, customers = []) => calculateReportsData(
        sales, PERIOD_FROM, PERIOD_TO, FIXED_RATE, [], customers
    );

    it('E2: las ventas del período son solo las fiadas ($10) y las cobranzas no son venta', () => {
        const data = build(SCENARIOS.E2_cobranzas_mayor_que_fiado.sales);
        expect(data.totalUsd).toBe(10);
        expect(data.receivables.fiadoOtorgadoUsd).toBe(10);
        expect(data.receivables.cobranzasUsd).toBe(25);
        expect(data.receivablePayments).toHaveLength(3);
        expect(data.receivablePayments[0].cliente).toBe('Maria Garcia');
        expect(data.receivablePayments[0].methodId).toBe('efectivo_usd');
    });

    it('I3: un abono no agrega ganancia ni venta (margen devengado intacto)', () => {
        const conAbonos = build(SCENARIOS.E2_cobranzas_mayor_que_fiado.sales);
        const sinAbonos = build(SCENARIOS.E2_cobranzas_mayor_que_fiado.sales.filter(s => s.tipo !== 'COBRO_DEUDA'));
        expect(conAbonos.profit).toBe(sinAbonos.profit);
        expect(conAbonos.totalUsd).toBe(sinAbonos.totalUsd);
        expect(conAbonos.totalItems).toBe(sinAbonos.totalItems);
    });

    it('la cartera solo aparece si se pasa la lista de clientes (aditivo y retrocompatible)', () => {
        expect(build(SCENARIOS.E1_fiado_con_cobranzas.sales).carteraUsd).toBeNull();
        const conClientes = build(SCENARIOS.E1_fiado_con_cobranzas.sales, CARTERA_FIXTURE.customers);
        expect(conClientes.carteraUsd).toBe(CARTERA_FIXTURE.expectedCarteraUsd);
        // El historial sigue siendo solo ventas: las cobranzas van aparte (H3).
        expect(conClientes.historySales.every(s => s.tipo !== 'COBRO_DEUDA')).toBe(true);
    });

    it('el breakdown del reporte ya no trae caja fantasma de las ventas fiadas', () => {
        const data = build(SCENARIOS.E2_cobranzas_mayor_que_fiado.sales);
        expect(data.paymentBreakdown.efectivo_bs).toBeUndefined();
        expect(data.paymentBreakdown.efectivo_usd.total).toBe(25);
        expect(data.paymentBreakdown.fiado.total).toBe(-15);
    });
});

describe('filterHistoryByKind — las cobranzas no se mezclan con las ventas (H3/T7)', () => {
    const venta = { id: 'v1', tipo: 'VENTA' };
    const fiada = { id: 'f1', tipo: 'VENTA_FIADA' };
    const cashea = { id: 'k1', tipo: 'VENTA_CASHEA' };
    const abono = { id: 'a1', tipo: 'COBRO_DEUDA' };
    const remesa = { id: 'r1', tipo: 'COBRO_CASHEA' };
    const mixto = [venta, abono, fiada, remesa, cashea];

    it('el default solo devuelve ventas (incluidas fiadas y Cashea)', () => {
        expect(filterHistoryByKind(mixto).map(s => s.id)).toEqual(['v1', 'f1', 'k1']);
    });

    it('el filtro de cobranzas devuelve solo cobros de cartera', () => {
        expect(filterHistoryByKind(mixto, 'cobranzas').map(s => s.id)).toEqual(['a1', 'r1']);
    });

    it('`todo` no filtra nada y un array inválido no rompe', () => {
        expect(filterHistoryByKind(mixto, 'todo')).toHaveLength(5);
        expect(filterHistoryByKind(null)).toEqual([]);
        expect(filterHistoryByKind([undefined, abono], 'ventas')).toEqual([undefined]);
    });
});

describe('contrato del motor: las cuentas por cobrar siguen siendo aditivas', () => {
    it('el bucket fiado conserva forma, etiqueta y moneda', () => {
        const breakdown = FinancialEngine.calculatePaymentBreakdown(SCENARIOS.E13_venta_100_fiada.sales);
        expect(breakdown.fiado.currency).toBe('FIADO');
        expect(breakdown.fiado.label).toBe('Fiado (Por Cobrar)');
        expect(Object.keys(breakdown.fiado).sort()).toEqual(['bsAtSaleRate', 'currency', 'label', 'total']);
    });

    it('el bucket de saldo a favor generado conserva sus flags y suma origins (H7)', () => {
        const breakdown = FinancialEngine.calculatePaymentBreakdown(SCENARIOS.E4_abono_con_excedente.sales);
        const bucket = breakdown._saldo_favor_generado;
        expect(bucket.isInternalCredit).toBe(true);
        expect(bucket.isWalletCredit).toBe(true);
        expect(bucket.isRevenue).toBe(false);
        expect(bucket.total).toBe(15);
        expect(bucket.origins.vueltoMonederoUsd + bucket.origins.excedenteAbonoUsd).toBe(bucket.total);
    });
});
