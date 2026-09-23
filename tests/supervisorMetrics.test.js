import { describe, expect, it } from 'vitest';
import {
    calculateInventoryMetrics,
    calculateSalesProfit,
} from '../src/services/supervisorMetrics';

describe('Supervisor metrics contract', () => {
    it('usa costUsd y priceUsd para valorar inventario', () => {
        const result = calculateInventoryMetrics([
            { id: 'p1', stock: 10, costUsd: 2, priceUsd: 5, lowStockAlert: 2 },
        ]);

        expect(result.totalCost).toBe(20);
        expect(result.totalRetail).toBe(50);
        expect(result.expectedProfit).toBe(30);
        expect(result.totalQty).toBe(10);
    });

    it('acepta costPrice/priceUsdt solamente como fallback legacy', () => {
        const result = calculateInventoryMetrics([
            { id: 'p1', stock: 2, costPrice: 3, priceUsdt: 7, minStock: 3 },
        ]);

        expect(result.totalCost).toBe(6);
        expect(result.totalRetail).toBe(14);
        expect(result.lowStockCount).toBe(1);
    });

    it('calcula ganancia por items usando el producto asociado', () => {
        const result = calculateSalesProfit([
            {
                totalUsd: 20,
                items: [{ productId: 'p1', qty: 2 }],
            },
        ], [
            { id: 'p1', costUsd: 4 },
        ]);

        expect(result.revenueUsd).toBe(20);
        expect(result.costUsd).toBe(8);
        expect(result.profitUsd).toBe(12);
    });

    it('tolera payloads incompletos sin producir NaN', () => {
        const inventory = calculateInventoryMetrics([null, { id: 'p2' }]);
        const sales = calculateSalesProfit([{ items: [{ productId: 'missing', qty: 'x' }] }], []);

        expect(inventory.totalCost).toBe(0);
        expect(inventory.totalRetail).toBe(0);
        expect(sales.revenueUsd).toBe(0);
        expect(sales.costUsd).toBe(0);
        expect(Number.isNaN(sales.profitUsd)).toBe(false);
    });
});
