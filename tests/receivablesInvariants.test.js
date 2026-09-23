// tests/receivablesInvariants.test.js — FIA-REPORT-001
// Invariantes que deben cumplirse en TODOS los escenarios. Si alguien
// reintroduce un bug de la familia "los Bs no cuadran", cae aquí por nombre.

import { describe, it, expect } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { round2 } from '../src/utils/dinero';
import { computeReceivablesMovements } from '../src/utils/receivablesReport';
import { forEachScenario, runScenario, scenarioNames } from './harness/receivablesHarness';
import { SCENARIOS } from './fixtures/receivablesScenarios';

const NUMERIC_FIELDS = ['totalUsd', 'totalBs', 'fiadoOtorgadoUsd', 'cobranzasUsd', 'netoUsd', 'saldoFavorGeneradoUsd'];

describe('I2 — el neto es exactamente otorgado − cobranzas', () => {
    it('se cumple en todos los escenarios', () => {
        forEachScenario((scenario, name) => {
            const { fiadoOtorgadoUsd, cobranzasUsd, netoUsd } = scenario.receivables;
            expect(round2(fiadoOtorgadoUsd - cobranzasUsd), name).toBe(netoUsd);
        });
    });
});

describe('I5 — nada con movimiento se oculta', () => {
    it('cada bucket con importe ≠ 0 tiene su fila en el modelo de vista', () => {
        scenarioNames().forEach(name => {
            const scenario = runScenario(name);
            const keys = new Set(scenario.rows.map(r => r.key));
            Object.entries(scenario.breakdown).forEach(([key, data]) => {
                if (round2(data.total) === 0) return;
                expect(keys.has(key), `${name}: falta la fila ${key}`).toBe(true);
            });
        });
    });

    it('cada movimiento de cartera del período tiene su fila (aunque el neto sea 0)', () => {
        scenarioNames().forEach(name => {
            const scenario = runScenario(name);
            const { fiadoOtorgadoUsd, cobranzasUsd } = scenario.receivables;
            if (round2(fiadoOtorgadoUsd) === 0 && round2(cobranzasUsd) === 0) return;
            expect(scenario.view.hasMovement, `${name}: sección oculta con movimiento`).toBe(true);
            const keys = scenario.view.rows.map(r => r.key);
            expect(keys).toContain('fiado_otorgado');
            expect(keys).toContain('cobranzas');
            expect(keys).toContain('neto');
        });
    });
});

describe('I6 — los porcentajes son de medios de pago reales', () => {
    it('suman 100 (±0,5) cuando hay denominador, y las cuentas por cobrar nunca tienen %', () => {
        forEachScenario((scenario, name) => {
            const withPct = scenario.rows.filter(r => r.pct !== null);
            if (scenario.denominatorBs !== 0) {
                const sum = round2(withPct.reduce((s, r) => s + r.pct, 0));
                expect(Math.abs(sum - 100), `${name}: los % suman ${sum}`).toBeLessThanOrEqual(0.5);
            }
            scenario.rows.filter(r => r.isReceivable).forEach(r => {
                expect(r.pct, `${name}: ${r.key} no puede tener %`).toBeNull();
            });
        });
    });

    it('el denominador nunca incluye fiado, crédito interno, propina ni vuelto', () => {
        forEachScenario((scenario, name) => {
            const excluded = scenario.rows.filter(r => r.isReceivable || r.isInternalCredit || r.isChange || r.isTip);
            const excludedBs = round2(excluded.reduce((s, r) => s + r.amountBs, 0));
            const allBs = round2(scenario.rows.reduce((s, r) => s + r.amountBs, 0));
            expect(scenario.denominatorBs, `${name}: denominador contaminado`)
                .toBe(round2(allBs - excludedBs));
        });
    });
});

describe('I7 — anular es equivalente a no haber tenido la transacción', () => {
    it('el escenario con todo anulado es idéntico a uno sin ventas', () => {
        const anulado = runScenario('E6_anuladas');
        const vacio = FinancialEngine.calculatePaymentBreakdown([]);
        expect(anulado.breakdown).toEqual(vacio);
        expect(anulado.receivables.netoUsd).toBe(0);
        expect(anulado.cashBuckets).toEqual([]);
    });

    it('anular un abono revierte su caja y su efecto en la cuenta por cobrar', () => {
        const base = SCENARIOS.E2_cobranzas_mayor_que_fiado.sales;
        const anulada = base.map(s => (
            s.tipo === 'COBRO_DEUDA' && s.id === 'e2-a3' ? { ...s, status: 'ANULADA' } : s
        ));

        const antes = computeReceivablesMovements(base);
        const despues = computeReceivablesMovements(anulada);
        expect(antes.cobranzasUsd).toBe(25);
        expect(despues.cobranzasUsd).toBe(10);
        expect(round2(antes.cobranzasUsd - despues.cobranzasUsd)).toBe(15);
        expect(despues.fiadoOtorgadoUsd).toBe(10);
        expect(despues.netoUsd).toBe(0);

        // Y la caja revierte exactamente el importe anulado.
        const cashOf = (sales) => FinancialEngine.calculatePaymentBreakdown(sales).efectivo_usd?.total || 0;
        expect(cashOf(base)).toBe(25);
        expect(cashOf(anulada)).toBe(10);
    });
});

describe('I8 — ningún agregado sale NaN o Infinity', () => {
    it('barrido recursivo sobre el resultado de cada escenario', () => {
        forEachScenario((scenario, name) => {
            const walk = (value, path) => {
                if (typeof value === 'number') {
                    expect(Number.isFinite(value), `${name}: ${path} no es finito (${value})`).toBe(true);
                    return;
                }
                if (Array.isArray(value)) {
                    value.forEach((item, index) => walk(item, `${path}[${index}]`));
                    return;
                }
                if (value && typeof value === 'object') {
                    Object.entries(value).forEach(([key, item]) => walk(item, `${path}.${key}`));
                }
            };
            walk(scenario.breakdown, 'breakdown');
            walk(scenario.receivables, 'receivables');
            walk(scenario.totals, 'totals');
            NUMERIC_FIELDS.forEach(field => {
                if (scenario.receivables[field] !== undefined) {
                    expect(Number.isFinite(scenario.receivables[field]), `${name}.${field}`).toBe(true);
                }
            });
        });
    });
});
