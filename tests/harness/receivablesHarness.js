// ============================================================
// FIA-REPORT-001 — Arnés de escenarios deterministas
// ------------------------------------------------------------
// Ejecuta los NÚCLEOS REALES (motor financiero + modelos de vista) sobre los
// escenarios congelados y devuelve un objeto plano y comparable.
//
// `sumRawByHand` es una segunda implementación deliberadamente ingenua: si el
// motor y la suma a mano no coinciden al centavo, hay un bug en uno de los dos.
// ============================================================

import { expect } from 'vitest';
import { FinancialEngine } from '../../src/core/FinancialEngine';
import { round2 } from '../../src/utils/dinero';
import { buildPaymentBreakdownRows } from '../../src/utils/paymentBreakdownView';
import {
    buildReceivablesView,
    computeCarteraUsd,
    computeReceivablesMovements,
} from '../../src/utils/receivablesReport';
import { reconcileCustomersWithLedger } from '../../src/utils/pocketReconciliation';
import { FIXED_RATE, SCENARIOS } from '../fixtures/receivablesScenarios';

/** Buckets que representan dinero físico/real recibido. */
export const CASH_BUCKET_PATTERN = /^efectivo_/;

export function scenarioNames() {
    return Object.keys(SCENARIOS);
}

export function scenarioInput(name) {
    const scenario = SCENARIOS[name];
    if (!scenario) throw new Error(`Escenario desconocido: ${name}`);
    return {
        name,
        from: scenario.from,
        to: scenario.to,
        rate: FIXED_RATE,
        sales: scenario.sales,
        expected: scenario.expected,
    };
}

/**
 * Corre un escenario completo: motor + modelos de vista.
 */
export function runScenario(name) {
    const { sales, from, to, rate, expected } = scenarioInput(name);
    const breakdown = FinancialEngine.calculatePaymentBreakdown(sales);
    const { rows, denominatorBs, totals } = buildPaymentBreakdownRows(breakdown, {
        bcvRate: rate,
        tasaCop: 0,
    });
    const receivables = computeReceivablesMovements(sales, { from, to });
    const view = buildReceivablesView(receivables);
    const cashBuckets = Object.keys(breakdown)
        .filter(key => CASH_BUCKET_PATTERN.test(key) && round2(breakdown[key].total) !== 0)
        .sort();

    return {
        name,
        expected,
        sales,
        raw: sumRawByHand(sales),
        breakdown,
        rows,
        totals,
        denominatorBs,
        receivables,
        view,
        cashBuckets,
        row: (key) => rows.find(r => r.key === key) || null,
        pctOf: (key) => {
            const found = rows.find(r => r.key === key);
            return found ? found.pct : null;
        },
    };
}

export function forEachScenario(callback) {
    scenarioNames().forEach(name => callback(runScenario(name), name));
}

/**
 * Suma independiente y naíva de los registros crudos. No usa el motor.
 */
export function sumRawByHand(sales = []) {
    let fiadoUsd = 0;
    let cobranzasUsd = 0;
    let cashUsd = 0;
    let cashBs = 0;
    (Array.isArray(sales) ? sales : []).forEach(sale => {
        if (!sale || sale.status === 'ANULADA') return;
        if (sale.tipo === 'VENTA_FIADA') {
            fiadoUsd += sale.fiadoUsd != null ? sale.fiadoUsd : (sale.totalUsd || 0);
        } else if (sale.tipo === 'COBRO_DEUDA') {
            cobranzasUsd += sale.totalUsd || 0;
        }
        (sale.payments || []).forEach(p => {
            if (p.isInternalCredit || p.methodId === 'saldo_favor') return;
            if (p.methodId === 'cashea') return;
            if (p.currency === 'USD') cashUsd += p.amountUsd || 0;
            if (p.currency === 'BS') cashBs += p.amountBs || 0;
        });
    });
    return {
        fiadoUsd: round2(fiadoUsd),
        cobranzasUsd: round2(cobranzasUsd),
        cashUsd: round2(cashUsd),
        cashBs: round2(cashBs),
    };
}

/** Aserción con diferencia legible: dice QUÉ campo falló, no solo el importe. */
export function expectExact(actual, expected, path) {
    expect(actual, `${path}: esperado ${expected}, recibido ${actual}`).toBe(expected);
}

/** Ejecuta la conciliación del fixture de H5. */
export function runReconciliation(fixture) {
    return reconcileCustomersWithLedger(fixture.customers, fixture.ledger);
}

export { computeCarteraUsd, buildReceivablesView };
