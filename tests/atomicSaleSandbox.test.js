import { describe, expect, it, vi } from 'vitest';
import { openAtomicSaleSandbox, prepareSandboxSale, validateAtomicSaleBackup } from '../src/services/atomicSaleSandbox';

const sale = () => ({ version: 1, accountId: 'account', businessId: 'business', epochId: 'epoch', saleId: 'sale',
    deviceId: 'device', actorId: 'actor', soldAt: '2026-10-08T12:00:00.000Z',
    lines: [{ lineId: 'line', operationId: 'op', productId: 'product', quantityUnits: '2000000' }],
    receipt: { totalMinor: '450', currency: 'USD', items: [{ priceMinor: '225' }] } });

async function backup(data = { baselines: [], sales: [], operations: [], stock: [], outbox: [] }) {
    const body = { format: 'PDA-AtomicSale-Sandbox', version: 1, exportedAt: '2026-10-08T12:00:00.000Z', data };
    const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
        : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(body)));
    return { ...body, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
}

describe('sandbox backup contract', () => {
    it('verifies an empty snapshot and captures a private copy before awaiting crypto', async () => {
        const input = await backup();
        const validating = validateAtomicSaleBackup(input);
        input.data.stock.push({ fake: true });
        const result = await validating;
        expect(result.data.stock).toEqual([]); expect(result.version).toBe(1);
    });
    it('rejects unsupported format/version, missing stores and changed bytes', async () => {
        const input = await backup();
        await expect(validateAtomicSaleBackup({ ...input, version: 3 })).rejects.toThrow('INVALID_BACKUP_VERSION');
        await expect(validateAtomicSaleBackup({ ...input, format: 'TasasAlDia_Bodegas' })).rejects.toThrow('INVALID_BACKUP_VERSION');
        const missing = structuredClone(input); delete missing.data.operations;
        await expect(validateAtomicSaleBackup(missing)).rejects.toThrow('INVALID_BACKUP_STORES');
        await expect(validateAtomicSaleBackup({ ...input, sha256: '0'.repeat(64) })).rejects.toThrow('BACKUP_CHECKSUM_MISMATCH');
    });
    it('rejects orphan data even when checksum is valid', async () => {
        const data = (await backup()).data;
        data.stock = [{ scope: '["account","business","epoch"]', id: 'p', units: '10' }];
        await expect(validateAtomicSaleBackup(await backup(data))).rejects.toThrow('ORPHAN_BACKUP_ROW');
    });
});

describe('atomic sale sandbox input contract', () => {
    it('captures the complete JSON without sharing nested caller objects', () => {
        const input = sale(); const prepared = prepareSandboxSale(input);
        input.receipt.items[0].priceMinor = '999'; input.lines[0].quantityUnits = '9000000';
        expect(prepared.sale.receipt.items[0].priceMinor).toBe('225');
        expect(prepared.operations[0]).toEqual({ version: 1, businessId: 'business', epochId: 'epoch',
            operationId: 'op', deviceId: 'device', actorId: 'actor', productId: 'product', kind: 'SALE', deltaUnits: '-2000000' });
        expect(prepared.scope).toBe('["account","business","epoch"]');
    });
    it('ignores object key/line ordering for immutable replay identity', () => {
        const input = sale(); input.lines.push({ lineId: 'second', operationId: 'op2', productId: 'p2', quantityUnits: '1' });
        const reordered = Object.fromEntries(Object.entries(input).reverse());
        reordered.lines = [...input.lines].reverse();
        expect(prepareSandboxSale(reordered).content).toBe(prepareSandboxSale(input).content);
    });
    it.each(['0', '-1', '-0', '01', '1.1', '1e6', '9'.repeat(41), 2, null])('rejects quantity %s', quantityUnits => {
        const input = sale(); input.lines[0].quantityUnits = quantityUnits;
        expect(() => prepareSandboxSale(input)).toThrow('INVALID_QUANTITY');
    });
    it('does not round amounts beyond Number safe integer', () => {
        const input = sale(); input.lines[0].quantityUnits = '9007199254740993123456';
        expect(prepareSandboxSale(input).operations[0].deltaUnits).toBe('-9007199254740993123456');
    });
    it('rejects duplicate IDs and missing/unknown fields', () => {
        const input = sale(); input.lines.push({ ...input.lines[0] });
        expect(() => prepareSandboxSale(input)).toThrow('DUPLICATE_LINE_OR_OPERATION');
        input.lines[1].lineId = 'different';
        expect(() => prepareSandboxSale(input)).toThrow('DUPLICATE_LINE_OR_OPERATION');
        expect(() => prepareSandboxSale({ ...sale(), stock: 5 })).toThrow('INVALID_SHAPE');
        expect(() => prepareSandboxSale({ ...sale(), actorId: undefined })).toThrow('INVALID_JSON');
    });
    it.each(['yesterday', '2026-02-30T12:00:00.000Z', '2026-10-08T12:00:00Z'])('rejects noncanonical timestamp %s', soldAt => {
        expect(() => prepareSandboxSale({ ...sale(), soldAt })).toThrow('INVALID_SALE_TIME');
    });
    it.each([NaN, Infinity, undefined, 3n, new Date(), () => {}, Symbol('secret')])('does not silently lose invalid receipt values', value => {
        const input = sale(); input.receipt.value = value;
        expect(() => prepareSandboxSale(input)).toThrow();
    });
    it('limits JSON size, nesting, sparse arrays and line count', () => {
        const input = sale(); input.receipt.large = 'x'.repeat(1024 * 1024);
        expect(() => prepareSandboxSale(input)).toThrow('JSON_TOO_LARGE');
        input.receipt = { sparse: new Array(3) };
        expect(() => prepareSandboxSale(input)).toThrow('INVALID_JSON_ARRAY');
        const disguised = new Array(1); disguised.extra = 'must-not-disappear';
        input.receipt = { disguised };
        expect(() => prepareSandboxSale(input)).toThrow('INVALID_JSON_ARRAY');
        input.receipt = {}; let nested = input.receipt;
        for (let i = 0; i < 35; i++) { nested.child = {}; nested = nested.child; }
        expect(() => prepareSandboxSale(input)).toThrow('JSON_TOO_DEEP');
        input.receipt = {}; input.lines = Array.from({ length: 501 }, (_, i) => ({ lineId: 'l' + i, operationId: 'o' + i, productId: 'p', quantityUnits: '1' }));
        expect(() => prepareSandboxSale(input)).toThrow('INVALID_SALE_LINES_OR_RECEIPT');
    });
    it.each([undefined, 'BodegaApp', 'BodegaCloudPull', 'PDA-AtomicSale-Sandbox-', 'PDA-AtomicSale-Sandbox-../bad'])('never opens operational/default storage (%s)', async databaseName => {
        const factory = { open: vi.fn() };
        await expect(openAtomicSaleSandbox({ databaseName, indexedDB: factory })).rejects.toThrow('SANDBOX_DATABASE_NAME_REQUIRED');
        expect(factory.open).not.toHaveBeenCalled();
    });
});
