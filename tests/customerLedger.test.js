import { describe, it, expect, beforeEach, vi } from 'vitest';

const memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => memoryStore.has(key) ? memoryStore.get(key) : defaultValue),
        setItem: vi.fn(async (key, value) => memoryStore.set(key, JSON.parse(JSON.stringify(value)))),
    },
}));

vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'test-user', nombre: 'Tester', rol: 'ADMIN' } }) },
}));

import {
    CUSTOMER_LEDGER_KEY,
    CUSTOMER_LEDGER_MIGRATION_KEY,
    CUSTOMER_MOVEMENT_TYPES,
    getCustomerBalance,
    normalizeCustomer,
    transitionCustomerBalance,
} from '../src/utils/customerLedger';
import { applyCustomerMovement } from '../src/services/customerWalletService';
import { migrateCustomerLedger } from '../src/utils/customerMigration';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { processCustomerTransaction } from '../src/utils/customerTransactionProcessor';
import { FinancialEngine } from '../src/core/FinancialEngine';

beforeEach(() => memoryStore.clear());

describe('customerLedger', () => {
    it('normaliza deuda y favor usando el saldo neto', () => {
        const customer = normalizeCustomer({ id: 'c1', deuda: 10, favor: 25, casheaDeuda: 7 });
        expect(customer.favor).toBe(15);
        expect(customer.deuda).toBe(0);
        expect(customer.casheaDeuda).toBe(7);
        expect(getCustomerBalance(customer)).toBe(15);
    });

    it('aplica crédito, consumo y deuda sin producir campos opuestos', () => {
        const initial = { id: 'c1', deuda: 10, favor: 0 };
        const afterPayment = transitionCustomerBalance(initial, {
            type: CUSTOMER_MOVEMENT_TYPES.DEBT_PAYMENT,
            direction: 'CREDIT',
            amountUsd: 15,
        });
        expect(afterPayment.deuda).toBe(0);
        expect(afterPayment.favor).toBe(5);

        const afterSale = transitionCustomerBalance(afterPayment, {
            type: CUSTOMER_MOVEMENT_TYPES.CREDIT_SALE,
            direction: 'DEBIT',
            amountUsd: 8,
        });
        expect(afterSale.deuda).toBe(3);
        expect(afterSale.favor).toBe(0);
    });
});

describe('customerWalletService', () => {
    it('crea saldo inicial, aplica movimiento e ignora reintento idempotente', async () => {
        memoryStore.set('bodega_customers_v1', [{ id: 'c1', name: 'Ana', deuda: 0, favor: 20 }]);

        const movement = {
            type: CUSTOMER_MOVEMENT_TYPES.CREDIT_USED,
            direction: 'DEBIT',
            amountUsd: 8,
            sourceType: 'SALE',
            sourceId: 'sale-1:saldo_favor',
            sourceSaleId: 'sale-1',
            reason: 'Saldo usado',
        };
        const first = await applyCustomerMovement({ customerId: 'c1', movement });
        const second = await applyCustomerMovement({ customerId: 'c1', movement });

        expect(first.updatedCustomer.favor).toBe(12);
        expect(second.createdMovements).toHaveLength(0);
        expect(second.updatedCustomer.favor).toBe(12);
        expect(memoryStore.get(CUSTOMER_LEDGER_KEY)).toHaveLength(2); // inicial + uso
    });

    it('rechaza usar más saldo a favor del disponible', async () => {
        memoryStore.set('bodega_customers_v1', [{ id: 'c1', deuda: 0, favor: 5 }]);
        await expect(applyCustomerMovement({
            customerId: 'c1',
            movement: {
                type: CUSTOMER_MOVEMENT_TYPES.CREDIT_USED,
                direction: 'DEBIT',
                amountUsd: 5.01,
                sourceType: 'SALE',
                sourceId: 'sale-bad:saldo_favor',
            },
        })).rejects.toThrow(/insuficiente/i);
    });
});

describe('customerMigration', () => {
    it('migra saldoFavor y deuda negativa una sola vez', async () => {
        memoryStore.set('bodega_customers_v1', [
            { id: 'c1', name: 'Luis', deuda: -5, favor: 0, saldoFavor: 2 },
            { id: 'c2', name: 'Marta', deuda: 12, favor: 0 },
        ]);

        const first = await migrateCustomerLedger();
        const second = await migrateCustomerLedger();
        const customers = memoryStore.get('bodega_customers_v1');

        expect(first.migrated).toBe(true);
        expect(second.alreadyMigrated).toBe(true);
        expect(customers[0].favor).toBe(7);
        expect(customers[0].deuda).toBe(0);
        expect(customers[1].deuda).toBe(12);
        expect(memoryStore.get(CUSTOMER_LEDGER_MIGRATION_KEY).version).toBe('v1');
        expect(memoryStore.get(CUSTOMER_LEDGER_KEY)).toHaveLength(2);
    });
});

describe('reportes de crédito interno', () => {
    it('separa saldo a favor del efectivo y del ingreso físico', () => {
        const breakdown = FinancialEngine.calculatePaymentBreakdown([{
            id: 'sale-internal', tipo: 'VENTA', totalUsd: 10, totalBs: 5800,
            payments: [{ methodId: 'saldo_favor', currency: 'INTERNAL_CREDIT', amountUsd: 10, amountBs: 0 }],
        }]);
        expect(breakdown.saldo_favor).toMatchObject({ currency: 'INTERNAL_CREDIT', isInternalCredit: true, total: 10 });
        expect(breakdown.efectivo_usd).toBeUndefined();
    });

    it('reporta el saldo generado aparte y no duplica un cobro de deuda legado', () => {
        const breakdown = FinancialEngine.calculatePaymentBreakdown([
            {
                id: 'sale-wallet', tipo: 'VENTA', totalUsd: 5, totalBs: 2900,
                vueltoParaMonedero: 5,
                payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10, amountBs: 0 }],
            },
            {
                id: 'debt-payment', tipo: 'COBRO_DEUDA', totalUsd: 5, totalBs: 2900,
                vueltoParaMonedero: 5,
                payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 5, amountBs: 0 }],
            },
        ]);
        expect(breakdown._saldo_favor_generado).toMatchObject({
            total: 5, currency: 'INTERNAL_CREDIT', isInternalCredit: true, isWalletCredit: true,
        });
        expect(breakdown.efectivo_usd.total).toBe(15);
    });
});

describe('checkout saldo a favor', () => {
    it('rechaza crédito interno sin convertirlo en deuda o efectivo', async () => {
        const customer = { id: 'c1', name: 'Ana', deuda: 0, favor: 2 };
        memoryStore.set('bodega_customers_v1', [customer]);
        const result = await processSaleTransaction({
            cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 10, costUsd: 4, isWeight: false }],
            cartTotalUsd: 10, cartTotalBs: 5800, cartSubtotalUsd: 10,
            payments: [{ methodId: 'saldo_favor', currency: 'INTERNAL_CREDIT', amountUsd: 3, amountBs: 0 }],
            changeBreakdown: {}, selectedCustomerId: 'c1', customers: [customer],
            products: [{ id: 'p1', name: 'Producto', stock: 4, costUsd: 4 }],
            effectiveRate: 580, tasaCop: 0, copEnabled: false, discountData: null, useAutoRate: false,
        });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/insuficiente/i);
        expect(memoryStore.get('bodega_sales_v1')).toBeUndefined();
    });

    it('persiste el vuelto acreditado y lo aplica contra la deuda antes de crear favor', async () => {
        const customer = { id: 'c1', name: 'Ana', deuda: 5, favor: 0 };
        memoryStore.set('bodega_customers_v1', [customer]);
        const result = await processSaleTransaction({
            cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 10, costUsd: 4, isWeight: false }],
            cartTotalUsd: 10, cartTotalBs: 5800, cartSubtotalUsd: 10,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 20, amountBs: 0 }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0, vueltoCredito: true },
            selectedCustomerId: 'c1', customers: [customer],
            products: [{ id: 'p1', name: 'Producto', stock: 4, costUsd: 4 }],
            effectiveRate: 580, tasaCop: 0, copEnabled: false, discountData: null, useAutoRate: false,
        });
        expect(result.success).toBe(true);
        expect(result.sale.vueltoParaMonedero).toBe(10);
        expect(memoryStore.get('bodega_customers_v1')[0]).toMatchObject({ deuda: 0, favor: 5 });
        expect(memoryStore.get(CUSTOMER_LEDGER_KEY).at(-1).type).toBe(CUSTOMER_MOVEMENT_TYPES.CHANGE_CREDITED);
    });

    it('anular una venta con vuelto acreditado revierte cliente, ledger y venta', async () => {
        const customer = { id: 'c1', name: 'Ana', deuda: 0, favor: 0 };
        const products = [{ id: 'p1', name: 'Producto', stock: 4, costUsd: 4 }];
        memoryStore.set('bodega_customers_v1', [customer]);
        const result = await processSaleTransaction({
            cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 5, costUsd: 4, isWeight: false }],
            cartTotalUsd: 5, cartTotalBs: 2900, cartSubtotalUsd: 5,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10, amountBs: 0 }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0, vueltoCredito: true },
            selectedCustomerId: 'c1', customers: [customer], products,
            effectiveRate: 580, tasaCop: 0, copEnabled: false, discountData: null, useAutoRate: false,
        });
        expect(result.success).toBe(true);
        expect(memoryStore.get('bodega_customers_v1')[0].favor).toBe(5);

        await processVoidSale(result.sale, [result.sale], products);
        expect(memoryStore.get('bodega_sales_v1')[0].status).toBe('ANULADA');
        expect(memoryStore.get('bodega_customers_v1')[0]).toMatchObject({ deuda: 0, favor: 0 });
        expect(memoryStore.get(CUSTOMER_LEDGER_KEY).filter(m => m.sourceSaleId === result.sale.id && m.type === CUSTOMER_MOVEMENT_TYPES.REVERSAL)).toHaveLength(1);
        expect(memoryStore.get('bodega_products_v1')[0].stock).toBe(4);
    });

    it('un abono de deuda no se registra como vuelto acreditado', async () => {
        const customer = { id: 'c1', name: 'Ana', deuda: 10, favor: 0 };
        memoryStore.set('bodega_customers_v1', [customer]);
        const result = await processCustomerTransaction({
            transactionAmount: 5,
            currencyMode: 'USD',
            type: 'ABONO',
            customer,
            paymentMethod: 'efectivo_usd',
            bcvRate: 580,
            tasaCop: 0,
            copEnabled: false,
        });
        expect(result.sale.vueltoParaMonedero).toBe(0);
        expect(result.updatedCustomer).toMatchObject({ deuda: 5, favor: 0 });
    });

    it('un abono mayor que la deuda liquida la deuda y acredita solo el sobrante', async () => {
        const customer = { id: 'c-overpay', name: 'Luis', deuda: 4.8, favor: 0 };
        memoryStore.set('bodega_customers_v1', [customer]);
        const result = await processCustomerTransaction({
            transactionAmount: 10,
            currencyMode: 'USD',
            type: 'ABONO',
            customer,
            paymentMethod: 'efectivo_usd',
            bcvRate: 850,
            tasaCop: 0,
            copEnabled: false,
        });

        expect(result.error).toBeUndefined();
        expect(result.updatedCustomer).toMatchObject({ deuda: 0, favor: 5.2 });
        expect(result.sale.vueltoParaMonedero).toBe(0);
        expect(memoryStore.get(CUSTOMER_LEDGER_KEY).at(-1)).toMatchObject({
            type: CUSTOMER_MOVEMENT_TYPES.DEBT_PAYMENT,
            amountUsd: 10,
            direction: 'CREDIT',
        });
    });

    it('registra saldo_favor como crédito interno y reduce el favor del cliente', async () => {
        const customer = { id: 'c1', name: 'Ana', deuda: 0, favor: 20 };
        memoryStore.set('bodega_customers_v1', [customer]);

        const result = await processSaleTransaction({
            cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 10, costUsd: 4, isWeight: false }],
            cartTotalUsd: 10,
            cartTotalBs: 5800,
            cartSubtotalUsd: 10,
            payments: [{
                id: 'pay-1', methodId: 'saldo_favor', methodLabel: 'Saldo a Favor',
                currency: 'INTERNAL_CREDIT', amountUsd: 10, amountBs: 0,
            }],
            changeBreakdown: {},
            selectedCustomerId: 'c1',
            customers: [customer],
            products: [{ id: 'p1', name: 'Producto', stock: 4, costUsd: 4 }],
            effectiveRate: 580,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        });

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA');
        expect(result.sale.payments[0].currency).toBe('INTERNAL_CREDIT');
        expect(memoryStore.get('bodega_customers_v1')[0].favor).toBe(10);
        expect(memoryStore.get(CUSTOMER_LEDGER_KEY).at(-1).type).toBe(CUSTOMER_MOVEMENT_TYPES.CREDIT_USED);
    });
});
