import { test, expect } from '@playwright/test';

const prefix = 'PDA-AtomicSale-Sandbox-void-';
const baseline = { version: 1, accountId: 'account', businessId: 'bodega', epochId: 'epoch',
    stockUnits: { p: '10000000', q: '20000000' } };
const sale = { version: 1, accountId: 'account', businessId: 'bodega', epochId: 'epoch', saleId: 'sale',
    deviceId: 'pc', actorId: 'actor', soldAt: '2026-10-08T12:00:00.000Z',
    lines: [{ lineId: 'p-line', operationId: 'sale-p', productId: 'p', quantityUnits: '2000000' },
        { lineId: 'q-line', operationId: 'sale-q', productId: 'q', quantityUnits: '3000000' }],
    receipt: { totalMinor: '500', currency: 'USD' } };
const voidEvent = (overrides = {}) => ({ version: 1, accountId: 'account', businessId: 'bodega', epochId: 'epoch',
    voidId: 'void-1', saleId: 'sale', deviceId: 'pc', actorId: 'actor', voidedAt: '2026-10-08T12:05:00.000Z',
    reasonCode: 'WRONG_ITEM', lines: [{ saleOperationId: 'sale-p', operationId: 'void-p' },
        { saleOperationId: 'sale-q', operationId: 'void-q' }], ...overrides });

async function setup(page, name) {
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) { await route.abort(); return; }
        if (url.pathname === '/atomic-void-test') {
            await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Atomic void sandbox</title>' }); return;
        }
        await route.continue();
    });
    await page.goto('/atomic-void-test');
    await page.evaluate(async ({ databaseName, baseline, sale }) => {
        const module = await import('/src/services/atomicSaleSandbox.js');
        window.__atomic = await module.openAtomicSaleSandbox({ databaseName });
        await window.__atomic.initializeBaseline(baseline);
        await window.__atomic.commitSale(sale);
    }, { databaseName: name, baseline, sale });
}
const read = page => page.evaluate(input => window.__atomic.readScope(input), baseline);
const commitSale = page => page.evaluate(input => window.__atomic.commitSale(input), sale);
const voidSale = (page, input = voidEvent()) => page.evaluate(value => window.__atomic.voidSale(value), input);
function expectVoidedState(state) {
    expect(state.sales).toHaveLength(1);
    expect(state.sales[0].sale).toEqual(sale);
    expect(state.operations).toHaveLength(4);
    expect(state.operations.filter(row => row.operation.kind === 'VOID')).toHaveLength(2);
    expect(state.outbox).toHaveLength(2);
    expect(Object.fromEntries(state.stock.map(row => [row.id, row.units]))).toEqual(baseline.stockUnits);
}

test.beforeEach(async ({ page }, info) => {
    await setup(page, prefix + info.testId.replace(/[^A-Za-z0-9_-]/g, '_'));
});

test('void compensates every original line once while preserving sale and independent outbox entries', async ({ page }) => {
    const result = await voidSale(page);
    expect(result).toMatchObject({ voided: true, replay: false, voidId: 'void-1', saleId: 'sale' });
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    const saved = await read(page); expectVoidedState(saved);
    expect(saved.operations.filter(row => row.operation.kind === 'VOID').map(row => row.operation)).toEqual([
        { version: 1, businessId: 'bodega', epochId: 'epoch', operationId: 'void-p', deviceId: 'pc', actorId: 'actor',
            productId: 'p', kind: 'VOID', deltaUnits: '2000000', saleOperationId: 'sale-p' },
        { version: 1, businessId: 'bodega', epochId: 'epoch', operationId: 'void-q', deviceId: 'pc', actorId: 'actor',
            productId: 'q', kind: 'VOID', deltaUnits: '3000000', saleOperationId: 'sale-q' },
    ]);
    expect(saved.outbox.map(entry => [entry.id, entry.kind, entry.status])).toEqual([
        ['sale', 'SALE', 'pending'], ['void-1', 'VOID', 'pending'],
    ]);
});

test('same void replay is idempotent; new void ID cannot compensate twice; original sale replay stays inert', async ({ page }) => {
    const result = await voidSale(page);
    expect(await voidSale(page)).toEqual({ ...result, replay: true });
    const saved = await read(page);
    const collision = await page.evaluate(async input => {
        try { await window.__atomic.voidSale(input); } catch (error) { return error.message; }
    }, voidEvent({ voidId: 'void-2', lines: voidEvent().lines.map(line => ({ ...line,
        operationId: line.operationId + '-second' })) }));
    expect(collision).toBe('SALE_ALREADY_VOIDED'); expect(await read(page)).toEqual(saved);
    expect((await commitSale(page)).replay).toBe(true); expect(await read(page)).toEqual(saved);
    const changedReplay = await page.evaluate(async input => {
        try { await window.__atomic.voidSale(input); } catch (error) { return error.message; }
    }, voidEvent({ reasonCode: 'OTHER', voidedAt: '2026-10-08T12:06:00.000Z' }));
    expect(changedReplay).toBe('VOID_ID_CONFLICT'); expect(await read(page)).toEqual(saved);
});

test('void attempts and ACKs are independently bound to void ID, kind, scope, and revision', async ({ page }) => {
    const result = await voidSale(page);
    const identity = { accountId: 'account', businessId: 'bodega', epochId: 'epoch', outboxId: result.voidId,
        kind: 'VOID', revision: result.revision };
    expect(await page.evaluate(input => window.__atomic.recordOutboxAttempt(input), identity)).toEqual({ confirmed: false, attempts: 1 });
    const wrongKind = await page.evaluate(async input => {
        try { await window.__atomic.confirmOutbox(input); } catch (error) { return error.message; }
    }, { ...identity, kind: 'SALE', receiptId: 'void-receipt' });
    expect(wrongKind).toBe('OUTBOX_KIND_MISMATCH');
    expect(await page.evaluate(input => window.__atomic.confirmOutbox(input), { ...identity, receiptId: 'void-receipt' }))
        .toEqual({ confirmed: true, replay: false });
    expect(await page.evaluate(input => window.__atomic.confirmOutbox(input), { ...identity, receiptId: 'void-receipt' }))
        .toEqual({ confirmed: true, replay: true });
    const state = await read(page);
    expect(state.outbox.find(entry => entry.id === 'sale').status).toBe('pending');
    expect(state.outbox.find(entry => entry.id === 'void-1')).toMatchObject({ status: 'confirmed', attempts: 1,
        receiptId: 'void-receipt' });
    expectVoidedState(state);
});

for (const stage of ['operations', 'stock', 'outbox']) {
    test(`abort after successful ${stage} void write rolls back all compensation and permits retry`, async ({ page }) => {
        const failure = await page.evaluate(async ({ input, stage }) => {
            const original = IDBObjectStore.prototype.add;
            const originalPut = IDBObjectStore.prototype.put;
            let injected = false;
            for (const [method, implementation] of [['add', original], ['put', originalPut]]) {
                IDBObjectStore.prototype[method] = function (...args) {
                    const request = implementation.apply(this, args);
                    if (!injected && this.name === stage) {
                        injected = true; request.addEventListener('success', () => this.transaction.abort());
                    }
                    return request;
                };
            }
            try { await window.__atomic.voidSale(input); return { ok: true, injected }; }
            catch { return { ok: false, injected }; }
            finally { IDBObjectStore.prototype.add = original; IDBObjectStore.prototype.put = originalPut; }
        }, { input: voidEvent(), stage });
        expect(failure).toEqual({ ok: false, injected: true });
        const afterAbort = await read(page);
        expect(afterAbort.sales).toHaveLength(1); expect(afterAbort.operations).toHaveLength(2);
        expect(afterAbort.outbox).toHaveLength(1);
        expect(Object.fromEntries(afterAbort.stock.map(row => [row.id, row.units]))).toEqual({ p: '8000000', q: '17000000' });
        expect((await voidSale(page)).replay).toBe(false); expectVoidedState(await read(page));
    });
}

test('two tabs racing distinct void IDs apply at most one full compensation', async ({ page, context }, info) => {
    const other = await context.newPage();
    await setup(other, prefix + info.testId.replace(/[^A-Za-z0-9_-]/g, '_'));
    const second = voidEvent({ voidId: 'void-second', lines: voidEvent().lines.map(line => ({ ...line,
        operationId: line.operationId + '-second' })), voidedAt: '2026-10-08T12:06:00.000Z' });
    const results = await Promise.allSettled([voidSale(page), voidSale(other, second)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')[0].reason.message).toContain('SALE_ALREADY_VOIDED');
    expectVoidedState(await read(page));
});

test('two tabs replaying the same void converge on one event and one stock effect', async ({ page, context }, info) => {
    const other = await context.newPage();
    await setup(other, prefix + info.testId.replace(/[^A-Za-z0-9_-]/g, '_'));
    const results = await Promise.all([voidSale(page), voidSale(other)]);
    expect(results.filter(result => result.replay).length).toBe(1);
    expect(results.filter(result => !result.replay).length).toBe(1);
    expectVoidedState(await read(page));
});

test('backup v2 restores void operations, outbox ACK state and stock without compensating again', async ({ page }) => {
    const result = await voidSale(page);
    await page.evaluate(async ({ input, revision }) => {
        await window.__atomic.confirmOutbox({ accountId: input.accountId, businessId: input.businessId,
            epochId: input.epochId, outboxId: input.voidId, kind: 'VOID', revision, receiptId: 'ack-void' });
    }, { input: voidEvent(), revision: result.revision });
    const backup = await page.evaluate(() => window.__atomic.exportBackup());
    expect(backup.version).toBe(2);
    expect(backup.data.operations.filter(operation => operation.operation.kind === 'VOID')).toHaveLength(2);
    const restored = await page.evaluate(async input => {
        const target = await (await import('/src/services/atomicSaleSandbox.js')).openAtomicSaleSandbox({
            databaseName: 'PDA-AtomicSale-Sandbox-restore-' + Math.random().toString(36).slice(2) });
        window.__restoredSandbox = target;
        return target.restoreBackup(input);
    }, backup);
    expect(restored.restored).toBe(true);
    const after = await page.evaluate(input => window.__restoredSandbox.readScope(input), baseline);
    expectVoidedState(after);
    expect(after.outbox.find(entry => entry.id === 'void-1')).toMatchObject({ kind: 'VOID', status: 'confirmed', receiptId: 'ack-void' });
    const replay = await page.evaluate(input => window.__restoredSandbox.voidSale(input), voidEvent());
    expect(replay.replay).toBe(true);
    expect(await page.evaluate(input => window.__restoredSandbox.readScope(input), baseline)).toEqual(after);
});

test('rejects changed line mapping and operation ID collisions without changing local state', async ({ page }) => {
    const before = await read(page);
    const malformed = voidEvent({ lines: [{ saleOperationId: 'sale-p', operationId: 'void-p' }] });
    const mismatch = await page.evaluate(async input => {
        try { await window.__atomic.voidSale(input); } catch (error) { return error.message; }
    }, malformed);
    expect(mismatch).toBe('VOID_LINES_MISMATCH'); expect(await read(page)).toEqual(before);
    const collision = await page.evaluate(async input => {
        try { await window.__atomic.voidSale(input); } catch (error) { return error.message; }
    }, voidEvent({ lines: [{ saleOperationId: 'sale-p', operationId: 'sale-q' },
        { saleOperationId: 'sale-q', operationId: 'void-q' }] }));
    expect(collision).toBe('OPERATION_ID_CONFLICT'); expect(await read(page)).toEqual(before);
});
