/**
 * tests/customerCreditLens.test.js — Núcleo del lente de crédito del mes
 * (PLAN-LENS-CREDITO-EXTENDIDO.md · opción C para el hallazgo H2).
 *
 * Todos los tests congelan `now` para determinismo: el mes de referencia es
 * 2026-09 (los movimientos del fixture viven ahí).
 */

import { describe, it, expect } from 'vitest';
import {
    buildCustomerCreditLens,
    hasFiadoThisMonth,
    fiadoCustomerIds,
} from '../src/utils/customerCreditLens';
import { CUSTOMER_MOVEMENT_TYPES } from '../src/utils/customerLedger';

const NOW = new Date('2026-09-20T12:00:00Z');
const T = CUSTOMER_MOVEMENT_TYPES;
const IN_MONTH = '2026-09-05T15:00:00Z';
const LAST_MONTH = '2026-08-05T15:00:00Z';

const JUAN = { id: 'c-juan', name: 'Juan', favor: 15.5, deuda: 0 };
const MARIA = { id: 'c-maria', name: 'María', favor: 0, deuda: 6 };

function mov(over = {}) {
    return {
        id: over.id || `m_${Math.random().toString(36).slice(2, 10)}`,
        customerId: 'c-juan',
        type: T.CREDIT_SALE,
        direction: 'DEBIT',
        amountUsd: 3,
        sourceType: 'SALE',
        sourceId: `sale_1:fiado`,
        sourceSaleId: 'sale_1',
        timestamp: IN_MONTH,
        reversalOf: null,
        status: 'COMPLETED',
        ...over,
    };
}

describe('buildCustomerCreditLens', () => {
    it('T1 · fiado a cliente con favor: visibles las dos patas (el caso invisible hoy)', () => {
        const ledger = [
            mov({ type: T.CREDIT_SALE, direction: 'DEBIT', amountUsd: 3, sourceSaleId: 'sale_1' }),
            mov({ type: T.CREDIT_USED, direction: 'DEBIT', amountUsd: 3, sourceSaleId: 'sale_1', sourceId: 'sale_1:saldo_favor' }),
        ];
        const lens = buildCustomerCreditLens(ledger, [JUAN], { now: NOW });
        const e = lens.byCustomer['c-juan'];
        expect(e.fiadoMes).toBe(3);
        expect(e.consumoFavorMes).toBe(3);
        expect(e.netoMes).toBe(0);
        expect(e.fiadoCount).toBe(1);
        expect(hasFiadoThisMonth(e)).toBe(true);
    });

    it('T2 · fiado sin favor: deuda real, neto positivo', () => {
        const ledger = [mov({ customerId: 'c-maria', amountUsd: 5, sourceSaleId: 'sale_2' })];
        const lens = buildCustomerCreditLens(ledger, [MARIA], { now: NOW });
        const e = lens.byCustomer['c-maria'];
        expect(e.fiadoMes).toBe(5);
        expect(e.consumoFavorMes).toBe(0);
        expect(e.netoMes).toBe(5);
    });

    it('T3 · fiado parcialmente cubierto por favor', () => {
        const ledger = [
            mov({ amountUsd: 5, sourceSaleId: 'sale_3' }),
            mov({ type: T.CREDIT_USED, direction: 'DEBIT', amountUsd: 2, sourceSaleId: 'sale_3', sourceId: 'sale_3:saldo_favor' }),
        ];
        const lens = buildCustomerCreditLens(ledger, [JUAN], { now: NOW });
        const e = lens.byCustomer['c-juan'];
        expect(e.fiadoMes).toBe(5);
        expect(e.consumoFavorMes).toBe(2);
        expect(e.netoMes).toBe(3);
    });

    it('T4 · venta anulada: su REVERSAL (canónico, reversalOf) la compensa', () => {
        const orig = mov({ id: 'm-orig', amountUsd: 3, sourceSaleId: 'sale_4' });
        const ledger = [
            orig,
            mov({
                type: T.REVERSAL,
                direction: 'CREDIT',
                amountUsd: 3,
                sourceType: 'REVERSAL',
                sourceId: `legacy-reversal:sale_4:fiado`,
                sourceSaleId: 'sale_4',
                reversalOf: 'm-orig',
                timestamp: IN_MONTH,
            }),
        ];
        const lens = buildCustomerCreditLens(ledger, [JUAN], { now: NOW });
        const e = lens.byCustomer['c-juan'];
        expect(e.fiadoMes).toBe(0);
        expect(e.fiadoCount).toBe(0);
        expect(e.netoMes).toBe(0);
        expect(fiadoCustomerIds(lens)).toEqual([]);
    });

    it('T4b · doble defensa: venta ANULADA sin REVERSAL, con salesById, no cuenta', () => {
        const ledger = [mov({ amountUsd: 3, sourceSaleId: 'sale_5' })];
        const salesById = new Map([['sale_5', { id: 'sale_5', status: 'ANULADA' }]]);
        const lens = buildCustomerCreditLens(ledger, [JUAN], { now: NOW, salesById });
        // El movimiento excluido ni siquiera crea entrada: no hay fiado visible.
        expect(lens.byCustomer['c-juan']).toBeUndefined();
        expect(fiadoCustomerIds(lens)).toEqual([]);
    });

    it('T6 · movimiento del mes anterior y del futuro no cuentan', () => {
        const ledger = [
            mov({ amountUsd: 9, timestamp: LAST_MONTH, sourceSaleId: 'sale_old' }),
            mov({ amountUsd: 9, timestamp: '2026-10-05T15:00:00Z', sourceSaleId: 'sale_future' }),
            mov({ amountUsd: 2, sourceSaleId: 'sale_now' }),
        ];
        const lens = buildCustomerCreditLens(ledger, [JUAN], { now: NOW });
        expect(lens.byCustomer['c-juan'].fiadoMes).toBe(2);
    });

    it('T7 · invariante global: Σ netoMes = totalFiadoMes − totalConsumoFavorMes', () => {
        const ledger = [
            mov({ amountUsd: 3, sourceSaleId: 's1' }),
            mov({ type: T.CREDIT_USED, direction: 'DEBIT', amountUsd: 3, sourceSaleId: 's1', sourceId: 's1:saldo_favor' }),
            mov({ customerId: 'c-maria', amountUsd: 5, sourceSaleId: 's2' }),
            mov({ amountUsd: 1.5, sourceSaleId: 's3' }),
        ];
        const lens = buildCustomerCreditLens(ledger, [JUAN, MARIA], { now: NOW });
        const sumNeto = Object.values(lens.byCustomer).reduce((s, e) => s + e.netoMes, 0);
        expect(round2Safe(sumNeto)).toBe(round2Safe(lens.totalFiadoMes - lens.totalConsumoFavorMes));
        expect(lens.totalFiadoMes).toBe(9.5);
        expect(lens.totalConsumoFavorMes).toBe(3);
    });

    it('T8 · ledger vacío o sin movimientos del cliente: ceros, nunca NaN', () => {
        expect(buildCustomerCreditLens([], [JUAN], { now: NOW }).byCustomer).toEqual({});
        const lens = buildCustomerCreditLens([mov({ customerId: 'otro' })], [JUAN], { now: NOW });
        expect(lens.byCustomer['c-juan']).toBeUndefined();
    });

    it('T9 · redondeo a 2 decimales', () => {
        const ledger = [
            mov({ amountUsd: 1.005, sourceSaleId: 's1' }),
            mov({ amountUsd: 2.004, sourceSaleId: 's2' }),
        ];
        const lens = buildCustomerCreditLens(ledger, [JUAN], { now: NOW });
        expect(lens.byCustomer['c-juan'].fiadoMes).toBe(3.01);
    });

    it('T10 · performance: ledger de 5k movimientos por debajo de 50ms (promedio de 5 corridas)', () => {
        const big = [];
        for (let i = 0; i < 5000; i++) {
            big.push(mov({
                id: `m${i}`,
                amountUsd: 1,
                sourceSaleId: `s${i}`,
                timestamp: IN_MONTH,
            }));
        }
        const t0 = performance.now();
        for (let i = 0; i < 5; i++) buildCustomerCreditLens(big, [JUAN], { now: NOW });
        const avg = (performance.now() - t0) / 5;
        expect(avg).toBeLessThan(50);
    });
});

function round2Safe(n) {
    return Math.round(n * 100) / 100;
}
