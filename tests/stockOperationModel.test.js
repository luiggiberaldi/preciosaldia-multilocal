import { describe, expect, it } from 'vitest';
import { projectStockOperations } from '../src/utils/stockOperationModel';
import { applyStockMapDelta } from '../src/utils/syncDelta';

const baseline = { version: 1, businessId: 'bodega', epochId: 'approved-epoch', stockUnits: { p: '10000000' } };
const op = (operationId, kind, deltaUnits, extra = {}) => ({ version: 1, businessId: 'bodega',
    epochId: 'approved-epoch', operationId, deviceId: 'pc-a', actorId: 'actor-a', productId: 'p', kind, deltaUnits, ...extra });
function* permutations(values) {
    if (!values.length) { yield []; return; }
    for (let i = 0; i < values.length; i++) {
        for (const tail of permutations(values.filter((_, j) => j !== i))) yield [values[i], ...tail];
    }
}

describe('stock operation reference model (not wired to production)', () => {
    const a = op('sale-a', 'SALE', '-2000000');
    const b = op('sale-b', 'SALE', '-3000000', { deviceId: 'pc-b' });
    const voidA = op('void-a', 'VOID', '2000000', { saleOperationId: 'sale-a' });
    const restock = op('restock', 'RESTOCK', '1000000');
    const adjustment = op('adjust', 'ADJUSTMENT', '-250000');
    it('all 120 arrival orders and 600 prefixes converge without duplicate effects', () => {
        const expected = projectStockOperations(baseline, [a, b, voidA, restock, adjustment]);
        expect(expected.stockUnits.p).toBe('7750000');
        let orders = 0, prefixes = 0;
        for (const order of permutations([a, b, voidA, restock, adjustment])) {
            orders++;
            const received = [];
            for (const next of order) {
                received.push(next, structuredClone(next)); prefixes++;
                const projection = projectStockOperations(baseline, received);
                const ids = new Set(received.map(item => item.operationId));
                let total = 10000000n;
                if (ids.has('sale-a') && !ids.has('void-a')) total -= 2000000n;
                if (ids.has('sale-b')) total -= 3000000n;
                if (ids.has('restock')) total += 1000000n;
                if (ids.has('adjust')) total -= 250000n;
                expect(projection.stockUnits.p).toBe(total.toString());
                expect(projection.appliedOperationIds.length).toBeLessThanOrEqual(ids.size);
            }
            const final = projectStockOperations(baseline, received);
            expect({ ...final, replays: 0 }).toEqual(expected);
        }
        expect(orders).toBe(120); expect(prefixes).toBe(600);
    });
    it('void received first waits, then compensates exactly once even with different void IDs', () => {
        expect(projectStockOperations(baseline, [voidA])).toMatchObject({ stockUnits: { p: '10000000' },
            pending: [{ operationId: 'void-a', reason: 'sale-not-confirmed' }], complete: false });
        const secondVoid = { ...voidA, operationId: 'void-another-pc', deviceId: 'pc-b' };
        const result = projectStockOperations(baseline, [voidA, a, secondVoid, a, voidA]);
        expect(result).toMatchObject({ stockUnits: { p: '10000000' }, voidedSaleIds: ['sale-a'], complete: true });
        expect(result.replays).toBe(2);
    });
    it('same ID with different quantity quarantines every variant independent of order', () => {
        const conflict = { ...a, deltaUnits: '-4000000' };
        for (const order of permutations([a, conflict, voidA])) {
            const result = projectStockOperations(baseline, order);
            expect(result.stockUnits.p).toBe('10000000');
            expect(result.conflicts).toEqual([{ operationId: 'sale-a', variantCount: 2 }]);
            expect(result.pending[0].reason).toBe('sale-not-confirmed');
            expect(result.complete).toBe(false);
        }
    });
    it('different key order is a replay, not a content conflict', () => {
        const reordered = Object.fromEntries(Object.entries(a).reverse());
        expect(projectStockOperations(baseline, [a, reordered])).toMatchObject({ stockUnits: { p: '8000000' }, replays: 1, complete: true });
    });
    it('no snapshot, foreign business, foreign epoch or unknown product silently becomes an operation', () => {
        const result = projectStockOperations(baseline, [
            { stock: { p: 2 } }, { ...a, businessId: 'cosmeticos' },
            { ...b, epochId: 'unapproved' }, { ...restock, productId: 'unknown' },
        ]);
        expect(result.stockUnits.p).toBe('10000000');
        expect(result.rejected).toHaveLength(3); expect(result.pending).toHaveLength(1);
        expect(result.complete).toBe(false);
    });
    it('invalid variant cannot make the valid sibling win by timestamp or order', () => {
        const invalid = { ...a, deltaUnits: 'garbage' };
        for (const operations of [[a, invalid], [invalid, a]]) {
            const result = projectStockOperations(baseline, operations);
            expect(result.stockUnits.p).toBe('10000000');
            expect(result.conflicts).toHaveLength(1); expect(result.rejected).toHaveLength(1);
        }
    });
    it('rejects mismatched compensation and wrong product reference', () => {
        const result = projectStockOperations({ ...baseline, stockUnits: { p: '10000000', q: '0' } }, [a,
            { ...voidA, deltaUnits: '4000000' }, { ...voidA, operationId: 'void-wrong-product', productId: 'q' }]);
        expect(result.stockUnits).toEqual({ p: '8000000', q: '0' });
        expect(result.rejected).toHaveLength(2); expect(result.voidedSaleIds).toEqual([]);
    });
    it.each(['-0', '00', '+1', '1.1', '1e6', '', '9'.repeat(41), 1, NaN, null])('rejects noncanonical quantity %s', value => {
        expect(projectStockOperations(baseline, [{ ...a, deltaUnits: value }]).complete).toBe(false);
    });
    it('handles micro-unit arithmetic beyond Number safe integer exactly and does not mutate input', () => {
        const base = { ...baseline, stockUnits: { p: '9007199254740993123456' } };
        const before = JSON.stringify([base, a, restock]);
        expect(projectStockOperations(base, [a, restock]).stockUnits.p).toBe('9007199254740992123456');
        expect(JSON.stringify([base, a, restock])).toBe(before);
    });
    it('throws on unapproved/invalid baseline instead of inventing initial stock', () => {
        expect(() => projectStockOperations(null, [])).toThrow();
        expect(() => projectStockOperations({ ...baseline, businessId: 123 }, [])).toThrow();
        expect(() => projectStockOperations({ ...baseline, stockUnits: { p: 10 } }, [])).toThrow();
        expect(() => projectStockOperations(baseline, null)).toThrow();
    });
    it('documents the current snapshot echo counterexample, NOT as a fixed stock test', () => {
        // Both knew 10. A sells 2 => 8. B sells 3 => 7.
        // B absorbs A's -2 => 5, publishes 5. A already has 8, and last B=10.
        const bAfterA = applyStockMapDelta([{ id: 'p', stock: 7 }], { p: 8 }, { p: 10 });
        expect(bAfterA.products[0].stock).toBe(5);
        const aAfterB = applyStockMapDelta([{ id: 'p', stock: 8 }], { p: bAfterA.products[0].stock }, { p: 10 });
        expect(aAfterB.products[0].stock).toBe(3); // actual bug: expected economic stock is 5
        expect(projectStockOperations(baseline, [a, b]).stockUnits.p).toBe('5000000');
    });
});
