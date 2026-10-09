import { describe, expect, it } from 'vitest';
import { createMockStockOperationsBackend } from '../src/services/mockStockOperationsBackend.js';

const base = { accountId: 'account-1', businessId: 'bodega', epochId: 'epoch-1' };
const saleOperation = (operationId, productId = 'p', deltaUnits = '-2000000') => ({ version: 1,
    businessId: base.businessId, epochId: base.epochId, operationId, deviceId: 'pc-a', actorId: 'actor-a',
    productId, kind: 'SALE', deltaUnits });
const voidOperation = (operationId, saleOperationId, productId = 'p', deltaUnits = '2000000') => ({ version: 1,
    businessId: base.businessId, epochId: base.epochId, operationId, deviceId: 'pc-a', actorId: 'actor-a',
    productId, kind: 'VOID', deltaUnits, saleOperationId });
const event = (overrides = {}) => ({ version: 1, ...base, kind: 'SALE', eventId: 'sale-1', saleId: 'sale-1',
    revision: 'a'.repeat(64), operations: [saleOperation('op-sale-1')], ...overrides });

describe('mock stock operations backend contract (not production)', () => {
    it('applies an event once and returns a stable receipt for exact retries', async () => {
        const backend = createMockStockOperationsBackend();
        const first = await backend.submit(event());
        const replay = await backend.submit(event());
        expect(first).toMatchObject({ accepted: true, replay: false });
        expect(replay).toEqual({ ...first, replay: true });
        expect(backend.inspect()).toEqual({ eventCount: 1, operationCount: 1, voidedSaleCount: 0, conflictSubjectCount: 0, conflictVariantCount: 0 });
    });

    it('rejects event-ID and operation-ID content collisions without replacing prior payload', async () => {
        const backend = createMockStockOperationsBackend();
        const original = event();
        await backend.submit(original);
        await expect(backend.submit({ ...original, revision: 'b'.repeat(64) })).rejects.toThrow('EVENT_ID_CONFLICT');
        await expect(backend.submit(event({ eventId: 'sale-2', saleId: 'sale-2', operations: [saleOperation('op-sale-1', 'p', '-3000000')] })))
            .rejects.toThrow('OPERATION_ID_CONFLICT');
        expect(await backend.submit(original)).toMatchObject({ replay: true });
        expect(backend.readConflicts()).toHaveLength(2);
        expect(backend.readConflicts().map(conflict => conflict.subject)).toEqual(['event', 'operation']);
        expect(backend.inspect()).toEqual({ eventCount: 1, operationCount: 1, voidedSaleCount: 0, conflictSubjectCount: 2, conflictVariantCount: 4 });
    });

    it('checks business/epoch in the payload rather than trusting the envelope', async () => {
        const backend = createMockStockOperationsBackend();
        await expect(backend.submit(event({ businessId: 'cosmetics' }))).rejects.toThrow('OPERATION_SCOPE_MISMATCH');
        await expect(backend.submit(event({ operations: [saleOperation('foreign', 'p', '-1'),], epochId: 'foreign-epoch' })))
            .rejects.toThrow('OPERATION_SCOPE_MISMATCH');
        expect(backend.inspect()).toEqual({ eventCount: 0, operationCount: 0, voidedSaleCount: 0, conflictSubjectCount: 0, conflictVariantCount: 0 });
    });

    it('validates the whole void, applies it once and rejects a second void for the sale', async () => {
        const backend = createMockStockOperationsBackend();
        await backend.submit(event({ operations: [saleOperation('op-sale-1'), saleOperation('op-sale-2', 'q', '-1000000')] }));
        const voidEvent = event({ kind: 'VOID', eventId: 'void-1', saleId: 'sale-1', revision: 'c'.repeat(64),
            operations: [voidOperation('op-void-1', 'op-sale-1'), voidOperation('op-void-2', 'op-sale-2', 'q', '1000000')] });
        const first = await backend.submit(voidEvent);
        expect(await backend.submit(voidEvent)).toEqual({ ...first, replay: true });
        await expect(backend.submit({ ...voidEvent, eventId: 'void-2', revision: 'd'.repeat(64),
            operations: [voidOperation('op-void-3', 'op-sale-1'), voidOperation('op-void-4', 'op-sale-2', 'q', '1000000')] }))
            .rejects.toThrow('SALE_ALREADY_VOIDED');
        expect(backend.readConflicts()).toMatchObject([{ subject: 'void-sale', variants: [{}, {}] }]);
        expect(backend.inspect()).toEqual({ eventCount: 2, operationCount: 4, voidedSaleCount: 1, conflictSubjectCount: 1, conflictVariantCount: 2 });
    });

    it('rejects a partial or inexact void and keeps sale state intact', async () => {
        const backend = createMockStockOperationsBackend();
        await backend.submit(event({ operations: [saleOperation('op-sale-1'), saleOperation('op-sale-2', 'q', '-1000000')] }));
        await expect(backend.submit(event({ kind: 'VOID', eventId: 'void-partial', saleId: 'sale-1',
            operations: [voidOperation('op-void-1', 'op-sale-1')] }))).rejects.toThrow('VOID_LINES_MISMATCH');
        await expect(backend.submit(event({ kind: 'VOID', eventId: 'void-wrong-delta', saleId: 'sale-1',
            operations: [voidOperation('op-void-1', 'op-sale-1', 'p', '1'), voidOperation('op-void-2', 'op-sale-2', 'q', '1000000')] })))
            .rejects.toThrow('VOID_LINES_MISMATCH');
        expect(backend.inspect()).toEqual({ eventCount: 1, operationCount: 2, voidedSaleCount: 0, conflictSubjectCount: 0, conflictVariantCount: 0 });
    });

    it('keeps identical sale IDs, operation IDs and void history independent by business', async () => {
        const backend = createMockStockOperationsBackend();
        await backend.submit(event());
        const cosmetics = { ...event({ businessId: 'cosmetics', operations: [
            { ...saleOperation('op-sale-1'), businessId: 'cosmetics' },
        ] }) };
        const cosmeticsReceipt = await backend.submit(cosmetics);
        expect(cosmeticsReceipt).toMatchObject({ accepted: true, replay: false });
        const voidForBodega = event({ kind: 'VOID', eventId: 'void-bodega', saleId: 'sale-1',
            operations: [voidOperation('op-void-bodega', 'op-sale-1')] });
        await backend.submit(voidForBodega);
        expect(backend.inspect()).toEqual({ eventCount: 3, operationCount: 3, voidedSaleCount: 1, conflictSubjectCount: 0, conflictVariantCount: 0 });
    });

    it('serializes concurrent identical submissions into one commit and one replay', async () => {
        const backend = createMockStockOperationsBackend();
        const [a, b] = await Promise.all([backend.submit(event()), backend.submit(event())]);
        expect([a.replay, b.replay].sort()).toEqual([false, true]);
        expect(a.receiptId).toBe(b.receiptId);
        expect(backend.inspect()).toEqual({ eventCount: 1, operationCount: 1, voidedSaleCount: 0, conflictSubjectCount: 0, conflictVariantCount: 0 });
    });

    it('serializes concurrent conflicting payloads so exactly one variant is retained', async () => {
        const backend = createMockStockOperationsBackend();
        const [a, b] = await Promise.allSettled([
            backend.submit(event()),
            backend.submit(event({ revision: 'b'.repeat(64), operations: [saleOperation('op-sale-1', 'p', '-3000000')] })),
        ]);
        expect([a, b].filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect([a, b].find(result => result.status === 'rejected').reason.message).toBe('EVENT_ID_CONFLICT');
        expect(backend.inspect()).toEqual({ eventCount: 1, operationCount: 1, voidedSaleCount: 0, conflictSubjectCount: 1, conflictVariantCount: 2 });
    });
});
