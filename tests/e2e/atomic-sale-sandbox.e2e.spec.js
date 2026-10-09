import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIX = 'PDA-AtomicSale-Sandbox-';
const pagePath = '/atomic-sale-sandbox-test';
const fixture = {
    version: 1, accountId: 'account-test', businessId: 'bodega-test', epochId: 'epoch-test',
    saleId: 'sale-test', deviceId: 'pc-test', actorId: 'actor-test', soldAt: '2026-10-08T12:00:00.000Z',
    lines: [{ lineId: 'l1', operationId: 'op1', productId: 'p', quantityUnits: '2000000' },
        { lineId: 'l2', operationId: 'op2', productId: 'q', quantityUnits: '3000000' }],
    receipt: { totalMinor: '500', currency: 'USD' },
};
const baseline = { version: 1, accountId: fixture.accountId, businessId: fixture.businessId,
    epochId: fixture.epochId, stockUnits: { p: '10000000', q: '20000000' } };

async function setup(page, databaseName) {
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) { await route.abort(); return; }
        if (url.pathname === pagePath) {
            await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Atomic sale isolation test</title><h1>IndexedDB sandbox</h1>' }); return;
        }
        await route.continue();
    });
    await page.goto(pagePath);
    await page.evaluate(async ({ name, initial }) => {
        const module = await import('/src/services/atomicSaleSandbox.js');
        window.__atomic = await module.openAtomicSaleSandbox({ databaseName: name });
        await window.__atomic.initializeBaseline(initial);
    }, { name: databaseName, initial: baseline });
}
const read = (page, scope = baseline) => page.evaluate(input => window.__atomic.readScope(input), scope);
const commit = (page, sale = fixture) => page.evaluate(input => window.__atomic.commitSale(input), sale);
const identity = ({ accountId, businessId, epochId }) => ({ accountId, businessId, epochId });
function stockFingerprint(stockUnits) {
    const entries = Object.entries(stockUnits).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
async function persistedStockFingerprint(page, scope) {
    return page.evaluate(async input => {
        const { stock } = await window.__atomic.readScope(input);
        const entries = stock.map(({ id, units }) => [id, units])
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries)));
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }, scope);
}
function expectEmpty(result) {
    expect(result.sales).toEqual([]); expect(result.operations).toEqual([]); expect(result.outbox).toEqual([]);
    expect(Object.fromEntries(result.stock.map(row => [row.id, row.units]))).toEqual(baseline.stockUnits);
}

test.beforeEach(async ({ page }, info) => { await setup(page, PREFIX + 'e2e-' + info.testId.replace(/[^A-Za-z0-9_-]/g, '_')); });

test('one transaction confirms sale, each stock operation and durable pending payload', async ({ page }) => {
    const result = await commit(page);
    expect(result).toMatchObject({ committed: true, replay: false, saleId: fixture.saleId });
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    const saved = await read(page);
    expect(saved.sales).toHaveLength(1); expect(saved.operations).toHaveLength(2); expect(saved.outbox).toHaveLength(1);
    expect(saved.outbox[0]).toMatchObject({ status: 'pending', attempts: 0, revision: result.revision });
    expect(saved.outbox[0].payload.sale).toEqual(fixture);
    expect(saved.operations.map(row => row.operation.deltaUnits).sort()).toEqual(['-2000000', '-3000000']);
    expect(Object.fromEntries(saved.stock.map(row => [row.id, row.units]))).toEqual({ p: '8000000', q: '17000000' });
});

for (const stage of ['sales', 'operations', 'stock', 'outbox']) {
    test(`abort after successful ${stage} write rolls back every store and permits retry`, async ({ page }) => {
        const failed = await page.evaluate(async ({ input, stage }) => {
            const methods = ['add', 'put']; const originals = methods.map(method => IDBObjectStore.prototype[method]);
            let injected = false;
            methods.forEach((method, i) => { IDBObjectStore.prototype[method] = function (...args) {
                const request = originals[i].apply(this, args);
                if (!injected && this.name === stage) {
                    injected = true; request.addEventListener('success', () => this.transaction.abort());
                }
                return request;
            }; });
            try { await window.__atomic.commitSale(input); return { ok: true, injected }; }
            catch (error) { return { ok: false, injected, error: error.message }; }
            finally { methods.forEach((method, i) => { IDBObjectStore.prototype[method] = originals[i]; }); }
        }, { input: fixture, stage });
        expect(failed).toMatchObject({ ok: false, injected: true });
        expectEmpty(await read(page));
        expect((await commit(page)).replay).toBe(false);
        expect((await read(page)).operations).toHaveLength(2);
    });
}

test('actual IDB constraint error is not swallowed and aborts earlier successful writes', async ({ page }) => {
    const failed = await page.evaluate(async input => {
        const original = IDBObjectStore.prototype.add; let injected = false;
        IDBObjectStore.prototype.add = function (...args) {
            const request = original.apply(this, args);
            if (this.name === 'outbox') { injected = true; original.apply(this, args); }
            return request;
        };
        try { await window.__atomic.commitSale(input); return { ok: true, injected }; }
        catch (error) { return { ok: false, injected, error: error.name }; }
        finally { IDBObjectStore.prototype.add = original; }
    }, fixture);
    expect(failed).toEqual({ ok: false, injected: true, error: 'ConstraintError' });
    expectEmpty(await read(page));
});

test('replay after reload preserves stock and pending outbox; ACK must match exact scope and revision', async ({ page }) => {
    const result = await commit(page);
    const dbName = await page.evaluate(async () => (await indexedDB.databases()).find(db => db.name.startsWith('PDA-AtomicSale-Sandbox-')).name);
    // Loading only blank fixture leaves no module connection; reopen the persisted DB.
    await page.reload();
    await page.evaluate(async name => { window.__atomic = await (await import('/src/services/atomicSaleSandbox.js')).openAtomicSaleSandbox({ databaseName: name }); }, dbName);
    const replay = await commit(page);
    expect(replay).toMatchObject({ committed: true, replay: true, revision: result.revision });
    const identity = { accountId: fixture.accountId, businessId: fixture.businessId, epochId: fixture.epochId,
        saleId: fixture.saleId, revision: result.revision };
    const attempted = await page.evaluate(input => window.__atomic.recordOutboxAttempt(input), identity);
    expect(attempted).toEqual({ confirmed: false, attempts: 1 });
    const ack = { ...identity, receiptId: 'server-receipt' };
    for (const wrong of [{ ...ack, revision: '0'.repeat(64) }, { ...ack, businessId: 'other-business' }, { ...ack, accountId: 'other-account' }]) {
        const message = await page.evaluate(async input => { try { await window.__atomic.confirmOutbox(input); } catch (error) { return error.message; } }, wrong);
        expect(message).toMatch(/ACK_REVISION_MISMATCH|OUTBOX_NOT_FOUND/);
    }
    expect((await read(page)).outbox[0].status).toBe('pending');
    expect(await page.evaluate(input => window.__atomic.confirmOutbox(input), ack)).toEqual({ confirmed: true, replay: false });
    expect(await page.evaluate(input => window.__atomic.confirmOutbox(input), ack)).toEqual({ confirmed: true, replay: true });
    const receiptConflict = await page.evaluate(async input => {
        try { await window.__atomic.confirmOutbox(input); } catch (error) { return error.message; }
    }, { ...ack, receiptId: 'different-receipt' });
    expect(receiptConflict).toBe('ACK_RECEIPT_CONFLICT');
    expect((await commit(page)).replay).toBe(true);
    expect((await read(page)).outbox[0]).toMatchObject({ status: 'confirmed', attempts: 1 });
    await page.reload();
    await page.evaluate(async name => { window.__atomic = await (await import('/src/services/atomicSaleSandbox.js')).openAtomicSaleSandbox({ databaseName: name }); }, dbName);
    expect((await read(page)).outbox[0]).toMatchObject({ status: 'confirmed', receiptId: ack.receiptId, attempts: 1 });
    expect(Object.fromEntries((await read(page)).stock.map(row => [row.id, row.units]))).toEqual({ p: '8000000', q: '17000000' });
});

test('same sale ID with different receipt or operation ID aborts without overwriting', async ({ page }) => {
    await commit(page); const before = await read(page);
    for (const input of [{ ...fixture, receipt: { ...fixture.receipt, totalMinor: '999' } },
        { ...fixture, lines: fixture.lines.map((line, i) => i ? line : { ...line, operationId: 'different' }) }]) {
        const message = await page.evaluate(async value => { try { await window.__atomic.commitSale(value); } catch (error) { return error.message; } }, input);
        expect(message).toBe('SALE_ID_CONFLICT');
        expect(await read(page)).toEqual(before);
    }
    const collision = await page.evaluate(async input => { try { await window.__atomic.commitSale(input); } catch (error) { return error.message; } }, { ...fixture, saleId: 'another-sale' });
    expect(collision).toBe('OPERATION_ID_CONFLICT'); expect(await read(page)).toEqual(before);
});

test('baseline is required and immutable, unknown products and insufficient stock abort whole sale', async ({ page }) => {
    for (const [input, expected] of [
        [{ ...fixture, epochId: 'missing' }, 'BASELINE_REQUIRED'],
        [{ ...fixture, lines: [{ ...fixture.lines[0], productId: 'unknown' }] }, 'INVALID_STOCK_OPERATIONS'],
        [{ ...fixture, lines: [{ ...fixture.lines[0], quantityUnits: '11000000' }] }, 'INSUFFICIENT_STOCK'],
    ]) {
        const message = await page.evaluate(async value => { try { await window.__atomic.commitSale(value); } catch (error) { return error.message; } }, input);
        expect(message).toBe(expected); expectEmpty(await read(page));
    }
    const message = await page.evaluate(async input => { try { await window.__atomic.initializeBaseline(input); } catch (error) { return error.message; } }, { ...baseline, stockUnits: { p: '999', q: '20' } });
    expect(message).toBe('BASELINE_CONFLICT'); expectEmpty(await read(page));
    const negative = await page.evaluate(async input => {
        try { await window.__atomic.initializeBaseline(input); } catch (error) { return error.message; }
    }, { ...baseline, epochId: 'negative-epoch', stockUnits: { p: '-1' } });
    expect(negative).toBe('NEGATIVE_BASELINE');
});

test('two tabs committing concurrently serialize stock without lost updates or duplicate replay', async ({ page, context }, info) => {
    const databaseName = PREFIX + 'e2e-' + info.testId.replace(/[^A-Za-z0-9_-]/g, '_');
    const other = await context.newPage(); await setup(other, databaseName);
    const second = { ...fixture, saleId: 'second-sale', deviceId: 'pc-b',
        lines: fixture.lines.map(line => ({ ...line, operationId: line.operationId + '-b' })) };
    const results = await Promise.all([commit(page), commit(other, second)]);
    expect(results.every(result => result.committed && !result.replay)).toBe(true);
    const saved = await read(page);
    expect(saved.sales).toHaveLength(2); expect(saved.operations).toHaveLength(4); expect(saved.outbox).toHaveLength(2);
    expect(Object.fromEntries(saved.stock.map(row => [row.id, row.units]))).toEqual({ p: '6000000', q: '14000000' });
    const replays = await Promise.all([commit(page), commit(other)]);
    expect(replays.every(result => result.replay)).toBe(true);
    expect(await read(page)).toEqual(saved);
});

test('two tabs selling last stock cannot both pass the same local availability check', async ({ page, context }, info) => {
    const databaseName = PREFIX + 'e2e-' + info.testId.replace(/[^A-Za-z0-9_-]/g, '_');
    const other = await context.newPage(); await setup(other, databaseName);
    const sale = { ...fixture, lines: [{ ...fixture.lines[0], quantityUnits: '6000000' }] };
    const second = { ...sale, saleId: 'sale-b', lines: [{ ...sale.lines[0], operationId: 'op-b' }] };
    const results = await Promise.allSettled([commit(page, sale), commit(other, second)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')[0].reason.message).toContain('INSUFFICIENT_STOCK');
    const saved = await read(page);
    expect(saved.sales).toHaveLength(1); expect(saved.operations).toHaveLength(1); expect(saved.outbox).toHaveLength(1);
    expect(saved.stock.find(row => row.id === 'p').units).toBe('4000000');
});

test('Bodega sale, replay and void leave the separate Cosméticos baseline untouched', async ({ page }) => {
    const cosmeticsBaseline = { version: 1, accountId: fixture.accountId, businessId: 'cosmetics-test',
        epochId: 'cosmetics-epoch', stockUnits: { p: '12000000', q: '9000000' } };
    await page.evaluate(input => window.__atomic.initializeBaseline(input), cosmeticsBaseline);

    const committed = await commit(page);
    expect(committed).toMatchObject({ committed: true, replay: false });
    expect((await commit(page)).replay).toBe(true);

    const voidEvent = { version: 1, accountId: fixture.accountId, businessId: fixture.businessId,
        epochId: fixture.epochId, voidId: 'void-bodega', saleId: fixture.saleId,
        deviceId: fixture.deviceId, actorId: fixture.actorId, voidedAt: '2026-10-08T12:05:00.000Z',
        reasonCode: 'WRONG_ITEM', lines: fixture.lines.map((line, index) => ({
            saleOperationId: line.operationId, operationId: `void-op-${index + 1}`,
        })) };
    const voided = await page.evaluate(input => window.__atomic.voidSale(input), voidEvent);
    expect(voided).toMatchObject({ voided: true, replay: false });
    expect(await page.evaluate(input => window.__atomic.voidSale(input), voidEvent)).toMatchObject({ voided: true, replay: true });

    const bodega = await read(page);
    const cosmetics = await page.evaluate(input => window.__atomic.readScope(input), cosmeticsBaseline);
    expect(bodega.sales).toHaveLength(1);
    expect(bodega.operations.filter(row => row.operation.kind === 'VOID')).toHaveLength(2);
    expect(Object.fromEntries(bodega.stock.map(row => [row.id, row.units]))).toEqual(baseline.stockUnits);
    expect(Object.fromEntries(cosmetics.stock.map(row => [row.id, row.units]))).toEqual(cosmeticsBaseline.stockUnits);
    expect(cosmetics.sales).toEqual([]);
    expect(cosmetics.operations).toEqual([]);
    expect(cosmetics.outbox).toEqual([]);
});

test('simulated outbox transport is idempotent, rejects conflicts and isolates businesses', async ({ page }) => {
    const backend = { entries: new Map(), operationOwners: new Map(), voidedSales: new Map(), nextReceipt: 1 };
    const stable = value => JSON.stringify(value, (_, item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
    });
    const scopeKey = envelope => JSON.stringify([envelope.accountId, envelope.businessId, envelope.epochId]);
    await page.route('**/mock-backend/outbox', async route => {
        const envelope = route.request().postDataJSON();
        const respond = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        const event = envelope?.kind === 'SALE' ? envelope.payload?.sale : envelope.payload?.void;
        const outboxId = envelope?.outboxId;
        if (!['SALE', 'VOID'].includes(envelope?.kind) || typeof outboxId !== 'string'
            || !event || event.accountId !== envelope.accountId || event.businessId !== envelope.businessId
            || event.epochId !== envelope.epochId || (envelope.kind === 'SALE' ? event.saleId : event.voidId) !== outboxId
            || !Array.isArray(envelope.payload?.operations)) {
            await respond(409, { error: 'SCOPE_OR_ENVELOPE_MISMATCH' }); return;
        }
        const scope = scopeKey(envelope);
        const key = JSON.stringify([scope, envelope.kind, outboxId]);
        const content = stable({ revision: envelope.revision, payload: envelope.payload });
        const existing = backend.entries.get(key);
        if (existing) {
            if (existing.content !== content) { await respond(409, { error: 'OUTBOX_ID_CONFLICT' }); return; }
            await respond(200, { receiptId: existing.receiptId, replay: true }); return;
        }
        if (envelope.kind === 'VOID') {
            const saleKey = JSON.stringify([scope, event.saleId]);
            if (backend.voidedSales.has(saleKey)) { await respond(409, { error: 'SALE_ALREADY_VOIDED' }); return; }
        }
        for (const operation of envelope.payload.operations) {
            if (operation.businessId !== envelope.businessId || operation.epochId !== envelope.epochId) {
                await respond(409, { error: 'OPERATION_SCOPE_MISMATCH' }); return;
            }
            const operationKey = JSON.stringify([scope, operation.operationId]);
            if (backend.operationOwners.has(operationKey)) {
                await respond(409, { error: 'OPERATION_ID_CONFLICT' }); return;
            }
        }
        const receiptId = `simulated-receipt-${backend.nextReceipt++}`;
        backend.entries.set(key, { content, receiptId });
        for (const operation of envelope.payload.operations) {
            backend.operationOwners.set(JSON.stringify([scope, operation.operationId]), key);
        }
        if (envelope.kind === 'VOID') backend.voidedSales.set(JSON.stringify([scope, event.saleId]), outboxId);
        await respond(200, { receiptId, replay: false });
    });

    const cosmeticsBaseline = { version: 1, accountId: fixture.accountId, businessId: 'cosmetics-test',
        epochId: 'cosmetics-epoch', stockUnits: { p: '12000000', q: '9000000' } };
    await page.evaluate(input => window.__atomic.initializeBaseline(input), cosmeticsBaseline);
    const bodegaScope = identity(baseline);
    const cosmeticsScope = identity(cosmeticsBaseline);
    const bodegaCommitted = await commit(page);
    const bodegaSaleRow = (await read(page, bodegaScope)).outbox[0];

    const deliver = async (row, scope) => {
        const kind = row.kind || 'SALE';
        const identityForAck = { ...scope, kind, ...(kind === 'SALE' ? { saleId: row.id } : { outboxId: row.id }), revision: row.revision };
        const attempt = await page.evaluate(input => window.__atomic.recordOutboxAttempt(input), identityForAck);
        const response = await page.evaluate(async envelope => {
            const result = await fetch('/mock-backend/outbox', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
            return { status: result.status, body: await result.json() };
        }, { ...scope, kind, outboxId: row.id, revision: row.revision, payload: row.payload });
        if (response.status !== 200) return { attempt, ...response };
        const confirmation = await page.evaluate(input => window.__atomic.confirmOutbox(input),
            { ...identityForAck, receiptId: response.body.receiptId });
        return { attempt, ...response, confirmation };
    };

    const firstDelivery = await deliver(bodegaSaleRow, bodegaScope);
    expect(firstDelivery).toMatchObject({ attempt: { confirmed: false, attempts: 1 }, status: 200,
        body: { replay: false }, confirmation: { confirmed: true, replay: false } });
    const repeatedDelivery = await deliver(bodegaSaleRow, bodegaScope);
    expect(repeatedDelivery).toMatchObject({ attempt: { confirmed: true, attempts: 1 }, status: 200,
        body: { replay: true }, confirmation: { confirmed: true, replay: true } });

    const contentConflict = await page.evaluate(async envelope => {
        const response = await fetch('/mock-backend/outbox', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
        return { status: response.status, body: await response.json() };
    }, { ...bodegaScope, kind: 'SALE', outboxId: bodegaSaleRow.id, revision: bodegaSaleRow.revision,
        payload: { ...bodegaSaleRow.payload, sale: { ...bodegaSaleRow.payload.sale,
            receipt: { ...bodegaSaleRow.payload.sale.receipt, totalMinor: '999' } } } });
    expect(contentConflict).toEqual({ status: 409, body: { error: 'OUTBOX_ID_CONFLICT' } });

    const operationCollisionPayload = structuredClone(bodegaSaleRow.payload);
    operationCollisionPayload.sale.saleId = 'second-sale-same-operation';
    operationCollisionPayload.sale.lines[0].quantityUnits = '4000000';
    operationCollisionPayload.operations[0].deltaUnits = '-4000000';
    const operationCollision = await page.evaluate(async envelope => {
        const response = await fetch('/mock-backend/outbox', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
        return { status: response.status, body: await response.json() };
    }, { ...bodegaScope, kind: 'SALE', outboxId: 'second-sale-same-operation', revision: 'a'.repeat(64), payload: operationCollisionPayload });
    expect(operationCollision).toEqual({ status: 409, body: { error: 'OPERATION_ID_CONFLICT' } });

    const crossBusinessPayload = await page.evaluate(async envelope => {
        const response = await fetch('/mock-backend/outbox', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
        return { status: response.status, body: await response.json() };
    }, { ...cosmeticsScope, kind: 'SALE', outboxId: bodegaSaleRow.id, revision: bodegaSaleRow.revision,
        payload: bodegaSaleRow.payload });
    expect(crossBusinessPayload).toEqual({ status: 409, body: { error: 'SCOPE_OR_ENVELOPE_MISMATCH' } });

    const voidEvent = { version: 1, accountId: fixture.accountId, businessId: fixture.businessId,
        epochId: fixture.epochId, voidId: 'void-bodega', saleId: fixture.saleId,
        deviceId: fixture.deviceId, actorId: fixture.actorId, voidedAt: '2026-10-08T12:05:00.000Z',
        reasonCode: 'WRONG_ITEM', lines: fixture.lines.map((line, index) => ({
            saleOperationId: line.operationId, operationId: `void-op-${index + 1}`,
        })) };
    await page.evaluate(input => window.__atomic.voidSale(input), voidEvent);
    const bodegaVoidRow = (await read(page, bodegaScope)).outbox.find(row => row.kind === 'VOID');
    const firstVoidDelivery = await deliver(bodegaVoidRow, bodegaScope);
    expect(firstVoidDelivery).toMatchObject({ attempt: { confirmed: false, attempts: 1 }, status: 200,
        body: { replay: false }, confirmation: { confirmed: true, replay: false } });
    const repeatedVoidDelivery = await deliver(bodegaVoidRow, bodegaScope);
    expect(repeatedVoidDelivery).toMatchObject({ attempt: { confirmed: true, attempts: 1 }, status: 200,
        body: { replay: true }, confirmation: { confirmed: true, replay: true } });

    const duplicateVoid = structuredClone(bodegaVoidRow.payload);
    duplicateVoid.void.voidId = 'second-void-for-same-sale';
    duplicateVoid.void.lines.forEach((line, index) => { line.operationId = `other-void-op-${index}`; });
    duplicateVoid.operations.forEach((operation, index) => { operation.operationId = `other-void-op-${index}`; });
    const duplicateVoidResponse = await page.evaluate(async envelope => {
        const response = await fetch('/mock-backend/outbox', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
        return { status: response.status, body: await response.json() };
    }, { ...bodegaScope, kind: 'VOID', outboxId: duplicateVoid.void.voidId,
        revision: 'b'.repeat(64), payload: duplicateVoid });
    expect(duplicateVoidResponse).toEqual({ status: 409, body: { error: 'SALE_ALREADY_VOIDED' } });

    const cosmeticsSale = { ...fixture, businessId: cosmeticsBaseline.businessId,
        epochId: cosmeticsBaseline.epochId };
    const cosmeticsCommitted = await commit(page, cosmeticsSale);
    expect(cosmeticsCommitted).toMatchObject({ committed: true, replay: false });
    const cosmeticsSaleRow = (await read(page, cosmeticsScope)).outbox[0];
    const cosmeticsDelivery = await deliver(cosmeticsSaleRow, cosmeticsScope);
    expect(cosmeticsDelivery).toMatchObject({ attempt: { confirmed: false, attempts: 1 }, status: 200,
        body: { replay: false }, confirmation: { confirmed: true, replay: false } });
    const wrongScopeAck = await page.evaluate(async input => {
        try { await window.__atomic.confirmOutbox(input); } catch (error) { return error.message; }
    }, { ...cosmeticsScope, saleId: fixture.saleId, kind: 'SALE', revision: bodegaCommitted.revision, receiptId: 'forged-cross-business-ack' });
    expect(wrongScopeAck).toBe('ACK_REVISION_MISMATCH');

    expect(backend.entries.size).toBe(3);
    expect(backend.operationOwners.size).toBe(6);
    expect(backend.voidedSales.size).toBe(1);
    const savedBodega = await read(page, bodegaScope);
    const savedCosmetics = await read(page, cosmeticsScope);
    expect(savedBodega.outbox.map(row => [row.kind, row.status, row.attempts])).toEqual([
        ['SALE', 'confirmed', 1], ['VOID', 'confirmed', 1],
    ]);
    expect(savedCosmetics.outbox).toHaveLength(1);
    expect(savedCosmetics.outbox[0]).toMatchObject({ kind: 'SALE', status: 'confirmed', attempts: 1 });
    expect(savedCosmetics.stock.find(row => row.id === 'p').units).toBe('10000000');
});

test('verified private baselines preserve Bodega and Cosméticos through sale, replay and void', async ({ page }, info) => {
    const artifactPath = process.env.PDA_SANDBOX_BASELINES_FILE;
    test.skip(!artifactPath, 'Set PDA_SANDBOX_BASELINES_FILE to the private offline baseline artifact.');
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    expect(artifact.format).toBe('PDA-Offline-Stock-Baselines');
    expect(artifact.version).toBe(1);
    expect(artifact.unitScale).toBe(1_000_000);
    expect(artifact.baselines).toHaveLength(2);
    expect(artifact.sources.find(source => source.kind === 'user-designated-bodega-backup')?.sha256)
        .toBe('9f9f759cd4c1bd2a991489740883c6846e09abf6427fa4a95b88da5ef10ddcef');
    expect(artifact.sources.find(source => source.kind === 'saved-supabase-custom-dump')?.sha256)
        .toBe('99b459383ebb4e12af33d23889240368a9c924c365b9a7bca5ef6868771578ab');

    const bodega = artifact.baselines.find(item => item.businessId === 'neg-1');
    const cosmetics = artifact.baselines.find(item => item.businessId === 'neg-fac22061');
    expect(Boolean(bodega && cosmetics)).toBe(true);
    if (!bodega || !cosmetics) return;
    expect(Object.keys(bodega.stockUnits)).toHaveLength(2423);
    expect(Object.keys(cosmetics.stockUnits)).toHaveLength(3036);
    const bodegaScope = identity(bodega), cosmeticsScope = identity(cosmetics);
    const expectedBodega = stockFingerprint(bodega.stockUnits);
    const expectedCosmetics = stockFingerprint(cosmetics.stockUnits);
    const productId = Object.keys(bodega.stockUnits).sort().find(id => BigInt(bodega.stockUnits[id]) > 0n);
    expect(Boolean(productId)).toBe(true);
    if (!productId) return;

    const databaseName = PREFIX + 'private-baseline-' + info.testId.replace(/[^A-Za-z0-9_-]/g, '_');
    await page.evaluate(async ({ name, bodegaBaseline, cosmeticsBaseline }) => {
        window.__atomic.close();
        const module = await import('/src/services/atomicSaleSandbox.js');
        window.__atomic = await module.openAtomicSaleSandbox({ databaseName: name });
        await window.__atomic.initializeBaseline(bodegaBaseline, { allowNegative: true });
        await window.__atomic.initializeBaseline(cosmeticsBaseline);
    }, { name: databaseName, bodegaBaseline: bodega, cosmeticsBaseline: cosmetics });

    try {
        const sale = { ...fixture, accountId: bodega.accountId, businessId: bodega.businessId,
            epochId: bodega.epochId, saleId: 'private-baseline-sale',
            lines: [{ lineId: 'private-line', operationId: 'private-sale-op', productId, quantityUnits: '1' }] };
        const committed = await commit(page, sale);
        expect(committed).toMatchObject({ committed: true, replay: false });
        expect((await commit(page, sale)).replay).toBe(true);

        const afterSale = await read(page, bodegaScope);
        expect(afterSale.sales).toHaveLength(1);
        expect(afterSale.operations).toHaveLength(1);
        expect(afterSale.outbox).toHaveLength(1);
        const exactOneMicroUnitDebited = await page.evaluate(async ({ scope, id, originalUnits }) => {
            const saved = await window.__atomic.readScope(scope);
            return saved.stock.find(row => row.id === id)?.units === (BigInt(originalUnits) - 1n).toString();
        }, { scope: bodegaScope, id: productId, originalUnits: bodega.stockUnits[productId] });
        expect(exactOneMicroUnitDebited).toBe(true);

        const voidEvent = { version: 1, accountId: bodega.accountId, businessId: bodega.businessId,
            epochId: bodega.epochId, voidId: 'private-baseline-void', saleId: sale.saleId,
            deviceId: sale.deviceId, actorId: sale.actorId, voidedAt: '2026-10-08T12:05:00.000Z',
            reasonCode: 'WRONG_ITEM', lines: sale.lines.map(line => ({
                saleOperationId: line.operationId, operationId: 'private-void-op',
            })) };
        const voided = await page.evaluate(input => window.__atomic.voidSale(input), voidEvent);
        expect(voided).toMatchObject({ voided: true, replay: false });
        expect(await page.evaluate(input => window.__atomic.voidSale(input), voidEvent))
            .toMatchObject({ voided: true, replay: true });

        const restoredBodega = await read(page, bodegaScope);
        const untouchedCosmetics = await read(page, cosmeticsScope);
        expect(restoredBodega.sales).toHaveLength(1);
        expect(restoredBodega.operations.filter(row => row.operation.kind === 'VOID')).toHaveLength(1);
        expect(restoredBodega.outbox).toHaveLength(2);
        expect(await persistedStockFingerprint(page, bodegaScope)).toBe(expectedBodega);
        expect(untouchedCosmetics.sales).toHaveLength(0);
        expect(untouchedCosmetics.operations).toHaveLength(0);
        expect(untouchedCosmetics.outbox).toHaveLength(0);
        expect(await persistedStockFingerprint(page, cosmeticsScope)).toBe(expectedCosmetics);
    } finally {
        await page.evaluate(async name => {
            window.__atomic.close();
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = resolve;
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('PRIVATE_SANDBOX_DATABASE_DELETE_BLOCKED'));
            });
        }, databaseName);
    }
});

test('same IDs in different accounts and businesses stay independent; live app DB is untouched', async ({ page }) => {
    const scopes = [baseline, { ...baseline, businessId: 'cosmetics-test' }, { ...baseline, accountId: 'other-account' }];
    for (const scope of scopes) {
        await page.evaluate(input => window.__atomic.initializeBaseline(input), scope);
        await commit(page, { ...fixture, accountId: scope.accountId, businessId: scope.businessId });
        const saved = await page.evaluate(input => window.__atomic.readScope(input), scope);
        expect(saved.sales).toHaveLength(1); expect(saved.outbox).toHaveLength(1);
        expect(saved.stock.find(row => row.id === 'p').units).toBe('8000000');
    }
    const names = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name));
    expect(names).not.toContain('BodegaApp'); expect(names).not.toContain('BodegaCloudPull');
    expect(names.every(name => name.startsWith(PREFIX))).toBe(true);
});

test('closing and reopening a real persistent browser profile retains pending outbox without reselling', async ({ baseURL }) => {
    test.setTimeout(90_000);
    const profile = await mkdtemp(join(tmpdir(), 'pda-atomic-profile-'));
    const databaseName = PREFIX + 'persistent-profile';
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, { baseURL, headless: true, serviceWorkers: 'block' });
        let page = await context.newPage(); await setup(page, databaseName);
        const result = await commit(page);
        await context.close(); context = null;
        context = await chromium.launchPersistentContext(profile, { baseURL, headless: true, serviceWorkers: 'block' });
        page = await context.newPage(); await setup(page, databaseName);
        const saved = await read(page);
        expect(saved.sales).toHaveLength(1); expect(saved.operations).toHaveLength(2);
        expect(saved.outbox[0]).toMatchObject({ status: 'pending', revision: result.revision, attempts: 0 });
        expect((await commit(page)).replay).toBe(true);
        expect(await read(page)).toEqual(saved);
    } finally {
        if (context) await context.close();
        await rm(profile, { recursive: true, force: true }); // only this test's fresh private temp profile
    }
});

test('lost local completion response replays the already committed sale exactly once', async ({ page }) => {
    // Lose the consumer's response AFTER native commit, not after a request success.
    const lost = await page.evaluate(async input => {
        try { await window.__atomic.commitSale(input); throw new Error('consumer died before showing receipt'); }
        catch (error) { return error.message; }
    }, fixture);
    expect(lost).toContain('consumer died');
    expect((await commit(page)).replay).toBe(true);
    const saved = await read(page);
    expect(saved.sales).toHaveLength(1); expect(saved.operations).toHaveLength(2); expect(saved.outbox).toHaveLength(1);
    expect(saved.stock.find(row => row.id === 'p').units).toBe('8000000');
});

test('two tabs with same ID and different contents commit only one immutable variant', async ({ page, context }, info) => {
    const databaseName = PREFIX + 'e2e-' + info.testId.replace(/[^A-Za-z0-9_-]/g, '_');
    const other = await context.newPage(); await setup(other, databaseName);
    const variant = { ...fixture, lines: fixture.lines.map((line, i) => i ? line : { ...line, quantityUnits: '4000000' }) };
    const results = await Promise.allSettled([commit(page), commit(other, variant)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason.message).toContain('SALE_ID_CONFLICT');
    const saved = await read(page); const winner = saved.sales[0].sale;
    expect(saved.sales).toHaveLength(1); expect(saved.operations).toHaveLength(2); expect(saved.outbox).toHaveLength(1);
    expect(saved.stock.find(row => row.id === 'p').units).toBe((10000000n - BigInt(winner.lines[0].quantityUnits)).toString());
    expect(saved.outbox[0].payload.sale).toEqual(winner);
});

test('synchronous quota failure after previous queued writes rejects without localStorage fallback', async ({ page }) => {
    const before = await page.evaluate(() => localStorage.length);
    const error = await page.evaluate(async input => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'stock') throw new DOMException('Injected storage quota', 'QuotaExceededError');
            return original.apply(this, args);
        };
        try { await window.__atomic.commitSale(input); } catch (error) { return error.name; }
        finally { IDBObjectStore.prototype.put = original; }
    }, fixture);
    expect(error).toBe('QuotaExceededError'); expectEmpty(await read(page));
    expect(await page.evaluate(() => localStorage.length)).toBe(before);
});

test('exact fractional and huge quantities aggregate repeated product lines without floating point', async ({ page }) => {
    const scope = { ...baseline, epochId: 'huge', stockUnits: { p: '9007199254740993123456' } };
    await page.evaluate(input => window.__atomic.initializeBaseline(input), scope);
    const input = { ...fixture, epochId: scope.epochId, lines: [
        { lineId: 'a', operationId: 'a', productId: 'p', quantityUnits: '250000' },
        { lineId: 'b', operationId: 'b', productId: 'p', quantityUnits: '1' },
    ] };
    await commit(page, input);
    const saved = await page.evaluate(input => window.__atomic.readScope(input), scope);
    expect(saved.stock[0].units).toBe('9007199254740992873455');
    expect(saved.operations).toHaveLength(2);
});

// Successful request events must not be exposed as a committed sale.
test('commit Promise remains unresolved at request success and rejects if transaction aborts there', async ({ page }) => {
    const result = await page.evaluate(async input => {
        const original = IDBObjectStore.prototype.add;
        let settled = false, observed;
        IDBObjectStore.prototype.add = function (...args) {
            const request = original.apply(this, args);
            if (this.name === 'outbox') request.addEventListener('success', () => { observed = settled; this.transaction.abort(); });
            return request;
        };
        try {
            await window.__atomic.commitSale(input).then(() => { settled = true; });
            return { ok: true, observed };
        } catch { return { ok: false, observed }; }
        finally { IDBObjectStore.prototype.add = original; }
    }, fixture);
    expect(result).toEqual({ ok: false, observed: false }); expectEmpty(await read(page));
});
