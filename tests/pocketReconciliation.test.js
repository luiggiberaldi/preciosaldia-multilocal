// tests/pocketReconciliation.test.js — FIA-REPORT-001
// H5: la cartera guardada en cada cliente puede desviarse del ledger de
// movimientos y nada lo detectaba.

import { describe, it, expect } from 'vitest';
import { reconcileCustomersWithLedger } from '../src/utils/pocketReconciliation';
import { RECONCILIATION_FIXTURE } from './fixtures/receivablesScenarios';
import { runReconciliation } from './harness/receivablesHarness';

describe('reconcileCustomersWithLedger', () => {
    it('detecta el descuadre exacto del fixture y aísla el movimiento huérfano (E11)', () => {
        const result = runReconciliation(RECONCILIATION_FIXTURE);
        expect(result.ok).toBe(false);
        expect(result.checkedCount).toBe(3);
        expect(result.ledgerMovements).toBe(5);
        expect(result.drift).toHaveLength(1);
        expect(result.drift[0].customerId).toBe('c-b');
        expect(result.drift[0].customerDeudaUsd).toBe(6);
        expect(result.drift[0].ledgerDeudaUsd).toBe(4);
        expect(result.drift[0].deltaDeudaUsd).toBe(2);
        expect(result.drift[0].deltaUsd).toBe(2);
        expect(result.ledgerOrphans).toHaveLength(1);
        expect(result.ledgerOrphans[0].customerId).toBe('c-fantasma');
        expect(result.totals.driftUsd).toBe(2);
    });

    it('no grita cuando todo cuadra', () => {
        const result = reconcileCustomersWithLedger(RECONCILIATION_FIXTURE.customers, [
            RECONCILIATION_FIXTURE.ledger[1], // c-b: −6
        ]);
        expect(result.ok).toBe(true);
        expect(result.drift).toHaveLength(0);
        expect(result.totals.driftUsd).toBe(0);
    });

    it('tolera el ruido de centavos pero no un descuadre real', () => {
        const customers = [{ id: 'c-a', name: 'Maria', deuda: 4.004, favor: 0 }];
        const ledger = [RECONCILIATION_FIXTURE.ledger[0]]; // −4
        expect(reconcileCustomersWithLedger(customers, ledger).ok).toBe(true);
        expect(reconcileCustomersWithLedger([{ id: 'c-a', name: 'Maria', deuda: 4.02, favor: 0 }], ledger).ok).toBe(false);
    });

    it('compara también la pata del saldo a favor', () => {
        const customers = [{ id: 'c-c', name: 'Ana', deuda: 0, favor: 1 }];
        const result = reconcileCustomersWithLedger(customers, [RECONCILIATION_FIXTURE.ledger[3]]); // +3
        expect(result.drift).toHaveLength(1);
        expect(result.drift[0].ledgerFavorUsd).toBe(3);
        expect(result.drift[0].customerFavorUsd).toBe(1);
        expect(result.drift[0].deltaFavorUsd).toBe(-2);
    });

    it('ignora movimientos VOIDED y no concilia clientes sin ledger', () => {
        const customers = [
            { id: 'c-a', name: 'Maria', deuda: 4, favor: 0 },
            { id: 'c-z', name: 'Sin ledger', deuda: 999, favor: 0 },
        ];
        const ledger = [
            RECONCILIATION_FIXTURE.ledger[0], // −4
            { id: 'x', customerId: 'c-a', type: 'ANULACION', amountUsd: 50, balanceAfterUsd: -54, status: 'VOIDED' },
        ];
        const result = reconcileCustomersWithLedger(customers, ledger);
        expect(result.ok).toBe(true);
        expect(result.checkedCount).toBe(1); // c-z no tiene movimientos ⇒ no se compara
    });

    it('el orden del informe es determinista (mismo input, mismo output)', () => {
        const customers = [
            { id: 'c-1', name: 'Uno', deuda: 5, favor: 0 },
            { id: 'c-2', name: 'Dos', deuda: 5, favor: 0 },
        ];
        const ledger = [
            { id: 'm1', customerId: 'c-1', amountUsd: 5, balanceAfterUsd: -2, status: 'COMPLETED' },
            { id: 'm2', customerId: 'c-2', amountUsd: 5, balanceAfterUsd: -2, status: 'COMPLETED' },
        ];
        const first = reconcileCustomersWithLedger(customers, ledger).drift.map(d => d.customerId);
        const second = reconcileCustomersWithLedger(customers, ledger).drift.map(d => d.customerId);
        expect(first).toEqual(second);
        expect(first).toEqual(['c-1', 'c-2']);
    });
});
