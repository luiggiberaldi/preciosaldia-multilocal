import { describe, expect, it } from 'vitest';
import { simulateStockSync } from '../src/utils/stockSyncSimulator.js';

const baseline = { version: 1, businessId: 'bodega', epochId: 'approved',
    stockUnits: { p: '10000000', q: '5000000' } };
const operation = (operationId, kind, deltaUnits, extra = {}) => ({ version: 1, businessId: 'bodega',
    epochId: 'approved', operationId, deviceId: 'pc-a', actorId: 'actor', productId: 'p', kind, deltaUnits, ...extra });
const saleA = operation('sale-a', 'SALE', '-2000000');
const saleB = operation('sale-b', 'SALE', '-3000000', { deviceId: 'pc-b' });
const voidA = operation('void-a', 'VOID', '2000000', { saleOperationId: 'sale-a' });

function replica(replicaId, deliveries) { return { replicaId, deliveries }; }

describe('multi-replica stock sync simulator', () => {
    it('reaches the same exact global projection after arbitrary delivery orders and duplicate retries', () => {
        const result = simulateStockSync({ baseline, replicas: [
            replica('pc-a', [saleA, saleB, voidA]),
            replica('pc-b', [saleB, saleA, saleB, voidA]),
            replica('tablet', [voidA, saleA, saleB]),
        ] });
        expect(result).toMatchObject({ converged: true, complete: true, hasConflicts: false,
            deliveryCount: 10, unresolvedReplicas: [], oversoldProducts: [] });
        expect(result.globalProjection.stockUnits).toEqual({ p: '7000000', q: '5000000' });
        expect(result.globalProjection.voidedSaleIds).toEqual(['sale-a']);
        expect(result.replicas.map(item => item.projection.stockUnits.p)).toEqual(['7000000', '7000000', '7000000']);
        expect(result.replicas[1].projection.replays).toBe(1);
    });

    it('detects incomplete delivery as divergence without fabricating events or adopting snapshots', () => {
        const result = simulateStockSync({ baseline, replicas: [
            replica('pc-a', [saleA, saleB]), replica('pc-b', [saleA]),
        ] });
        expect(result.converged).toBe(false);
        expect(result.unresolvedReplicas).toEqual(['pc-b']);
        expect(result.globalProjection.stockUnits.p).toBe('5000000');
        expect(result.replicas[1].projection.stockUnits.p).toBe('8000000');
    });

    it('preserves ID collisions as conflicts and never chooses the most recently delivered version', () => {
        const altered = { ...saleA, deltaUnits: '-4000000', deviceId: 'pc-c' };
        for (const replicas of [
            [replica('pc-a', [saleA]), replica('pc-c', [altered])],
            [replica('pc-a', [altered]), replica('pc-c', [saleA])],
        ]) {
            const result = simulateStockSync({ baseline, replicas });
            expect(result.hasConflicts).toBe(true);
            expect(result.globalProjection.stockUnits.p).toBe('10000000');
            expect(result.globalProjection.conflicts).toEqual([{ operationId: 'sale-a', variantCount: 2 }]);
            expect(result.complete).toBe(false);
        }
    });

    it('reports a pending VOID if its sale has not reached the combined journal', () => {
        const result = simulateStockSync({ baseline, replicas: [
            replica('pc-a', [voidA]), replica('pc-b', [saleB]),
        ] });
        expect(result.complete).toBe(false);
        expect(result.globalProjection.pending).toEqual([{ operationId: 'void-a', reason: 'sale-not-confirmed' }]);
        expect(result.globalProjection.stockUnits.p).toBe('7000000');
    });

    it('explicitly detects offline last-stock oversell across disconnected replicas', () => {
        const low = { ...baseline, stockUnits: { p: '1000000' } };
        const oneUnitSaleA = { ...saleA, deltaUnits: '-1000000' };
        const oneUnitSaleB = { ...saleB, deltaUnits: '-1000000' };
        const result = simulateStockSync({ baseline: low, replicas: [
            replica('pc-a', [oneUnitSaleA]), replica('pc-b', [oneUnitSaleB]),
        ] });
        expect(result.converged).toBe(false);
        expect(result.globalProjection.stockUnits.p).toBe('-1000000');
        expect(result.oversoldProducts).toEqual([{ productId: 'p', units: '-1000000' }]);
        expect(result.complete).toBe(true); // syntactically complete, economically oversold
    });

    it('surfaces a stock snapshot as an invalid operation, not as baseline or delta', () => {
        const snapshot = { stock: { p: 3 } };
        const result = simulateStockSync({ baseline, replicas: [replica('pc-a', [snapshot])] });
        expect(result.globalProjection.stockUnits.p).toBe('10000000');
        expect(result.globalProjection.rejected).toHaveLength(1);
        expect(result.complete).toBe(false);
    });

    it('validates replica IDs, shape and total bounded input size', () => {
        expect(() => simulateStockSync({ baseline, replicas: [] })).toThrow('INVALID_REPLICAS');
        expect(() => simulateStockSync({ baseline, replicas: [replica('pc', []), replica('pc', [])] })).toThrow('DUPLICATE_REPLICA_ID');
        expect(() => simulateStockSync({ baseline, replicas: [replica('../bad', [])] })).toThrow('INVALID_REPLICA');
        expect(() => simulateStockSync({ baseline, replicas: [replica('pc', new Array(100001).fill(saleA))] })).toThrow('TOO_MANY_DELIVERIES');
    });
});
