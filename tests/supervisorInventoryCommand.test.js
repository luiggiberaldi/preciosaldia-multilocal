import { describe, expect, it } from 'vitest';
import {
    calculateSupervisorInventoryBatchAdjustment,
    applySupervisorInventoryBatchTransaction,
} from '../src/services/supervisorInventoryCommand';

describe('Supervisor inventory batch command', () => {
    const product = { id: 'product-1', name: 'Arroz', stock: 10, costPrice: 1 };
    const payload = {
        direction: 'ingreso',
        productId: 'product-1',
        quantityInput: 2,
        inputUnit: 'cajas',
        unitsPerPackage: 24,
        expectedStock: 10,
        reason: 'Mercancía recibida',
        lotReference: 'LOTE-001',
    };

    it('calcula delta, stock final y movimiento auditable', () => {
        const result = calculateSupervisorInventoryBatchAdjustment(product, payload, {
            commandId: 'command-batch-001',
            timestamp: '2026-08-09T12:00:00.000Z',
        });

        expect(result).toMatchObject({ unitsDelta: 48, stockBefore: 10, stockAfter: 58 });
        expect(result.product).toMatchObject({ id: 'product-1', stock: 58 });
        expect(result.movement).toMatchObject({
            movementId: 'supervisor-command-batch-001',
            direction: 'ingreso',
            inputUnit: 'cajas',
            unitsPerPackageSnapshot: 24,
            reason: 'Mercancía recibida',
            lotReference: 'LOTE-001',
            stockBefore: 10,
            stockAfter: 58,
        });
    });

    it('rechaza el conflicto de stock antes de generar una mutación', () => {
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, {
            ...payload,
            expectedStock: 9,
        })).toThrow(/stock cambió/i);
    });

    it('aplica un egreso con categoría y rechaza superar el stock', () => {
        const result = calculateSupervisorInventoryBatchAdjustment(product, {
            ...payload,
            direction: 'egreso',
            quantityInput: 1,
            unitsPerPackage: 1,
            reasonCategory: 'merma',
            reason: 'Producto dañado',
        }, { commandId: 'command-egress-1' });

        expect(result).toMatchObject({ unitsDelta: 1, stockBefore: 10, stockAfter: 9 });
    });

    it('rechaza egresos inválidos o superiores al stock', () => {
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, {
            ...payload,
            direction: 'egreso',
            quantityInput: 1,
            unitsPerPackage: 24,
            reasonCategory: 'merma',
        })).toThrow(/stock insuficiente/i);
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, {
            ...payload,
            direction: 'egreso',
            reasonCategory: 'categoria-desconocida',
        })).toThrow(/categoría/i);
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, { ...payload, quantityInput: 0 })).toThrow();
        expect(() => calculateSupervisorInventoryBatchAdjustment(product, { ...payload, inputUnit: 'paquetes' })).toThrow();
    });

    it('genera el mismo movimiento para el mismo commandId y permite deduplicación externa', () => {
        const first = calculateSupervisorInventoryBatchAdjustment(product, payload, { commandId: 'command-replay-1' });
        const replay = calculateSupervisorInventoryBatchAdjustment(product, payload, { commandId: 'command-replay-1' });

        expect(replay.movement.movementId).toBe(first.movement.movementId);
        expect(replay.product.stock).toBe(first.product.stock);
    });

    it('revierte productos e historial si falla la sincronización posterior', async () => {
        const state = {
            bodega_products_v1: [product],
            bodega_sales_v1: [{ id: 'sale-1', tipo: 'VENTA' }],
        };
        const storage = {
            getItem: async (key, fallback) => state[key] ?? fallback,
            setItem: async (key, value) => { state[key] = value; },
        };
        const pushSync = async () => ({ ok: false, error: 'staging sync failure' });

        await expect(applySupervisorInventoryBatchTransaction({
            storage,
            pushSync,
            payload,
            commandId: 'command-rollback-1',
        })).rejects.toThrow('staging sync failure');

        expect(state.bodega_products_v1).toEqual([product]);
        expect(state.bodega_sales_v1).toEqual([{ id: 'sale-1', tipo: 'VENTA' }]);
    });
});
