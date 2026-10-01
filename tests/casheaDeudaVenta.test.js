import { describe, it, expect, vi, beforeEach } from 'vitest';

// CRÍTICO-3 (2026-10-01): VENTA_CASHEA debe incrementar casheaDeuda del cliente.
// Antes del fix, el checkout nunca la incrementaba (la anulación sí la revertía,
// lo que podía dejar casheaDeuda en 0 o negativa tras anular).

const __mem = new Map();
vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (k, d) => (__mem.has(k) ? __mem.get(k) : d)),
        setItem: vi.fn(async (k, v) => { __mem.set(k, v); }),
    },
}));

const { applyCustomerMovementsWithinLock } = await import('../src/services/customerWalletService.js');
const { CUSTOMER_MOVEMENT_TYPES } = await import('../src/utils/customerLedger.js');

const USER = { id: 'u1', nombre: 'Test', rol: 'dueno' };

function casheaMovement(saleId, amountUsd) {
    return {
        type: CUSTOMER_MOVEMENT_TYPES.CASHEA_SALE,
        direction: 'DEBIT',
        amountUsd,
        sourceType: 'SALE',
        sourceId: `${saleId}:cashea`,
        sourceSaleId: saleId,
        paymentMethodId: 'cashea',
        reason: 'Venta con Cashea (deuda registrada)',
    };
}

describe('CRÍTICO-3: VENTA_CASHEA incrementa casheaDeuda', () => {
    beforeEach(() => {
        __mem.clear();
        __mem.set('bodega_customers_v1', [
            { id: 'c1', name: 'Juan', deuda: 0, favor: 0, casheaDeuda: 0 },
        ]);
        __mem.set('bodega_customer_ledger_v1', []);
    });

    it('incrementa casheaDeuda sin tocar deuda ni favor', async () => {
        const r = await applyCustomerMovementsWithinLock({
            customerId: 'c1',
            user: USER,
            movements: [casheaMovement('sale-1', 60)],
        });
        expect(r.updatedCustomer.casheaDeuda).toBe(60);
        expect(r.updatedCustomer.deuda).toBe(0);
        expect(r.updatedCustomer.favor).toBe(0);
        expect(r.createdMovements).toHaveLength(1);
        expect(r.createdMovements[0].type).toBe('VENTA_CASHEA');
    });

    it('acumula sobre casheaDeuda existente', async () => {
        __mem.set('bodega_customers_v1', [
            { id: 'c1', name: 'Juan', deuda: 0, favor: 0, casheaDeuda: 40 },
        ]);
        const r = await applyCustomerMovementsWithinLock({
            customerId: 'c1',
            user: USER,
            movements: [casheaMovement('sale-2', 60)],
        });
        expect(r.updatedCustomer.casheaDeuda).toBe(100);
    });

    it('es idempotente: el mismo sourceId no duplica la deuda', async () => {
        const args = {
            customerId: 'c1',
            user: USER,
            movements: [casheaMovement('sale-3', 60)],
        };
        const r1 = await applyCustomerMovementsWithinLock(args);
        expect(r1.updatedCustomer.casheaDeuda).toBe(60);
        // Reintento con el mismo saleId (p. ej. retry tras fallo parcial).
        const r2 = await applyCustomerMovementsWithinLock({
            customerId: 'c1',
            user: USER,
            customers: r1.updatedCustomers,
            movements: [casheaMovement('sale-3', 60)],
        });
        expect(r2.updatedCustomer.casheaDeuda).toBe(60);
        expect(r2.skippedMovements).toContain('sale-3:cashea');
    });

    it('el balance neto del ledger no cambia con la venta Cashea', async () => {
        const r = await applyCustomerMovementsWithinLock({
            customerId: 'c1',
            user: USER,
            movements: [casheaMovement('sale-4', 60)],
        });
        const m = r.createdMovements[0];
        expect(m.balanceBeforeUsd).toBe(0);
        expect(m.balanceAfterUsd).toBe(0);
    });
});
