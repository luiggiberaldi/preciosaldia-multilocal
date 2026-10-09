import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const prefix = 'PDA-AtomicSale-Sandbox-';
const baseline = { version: 1, accountId: 'account', businessId: 'bodega', epochId: 'epoch', stockUnits: { p: '10000000' } };
const sale = id => ({ version: 1, accountId: 'account', businessId: 'bodega', epochId: 'epoch', saleId: id,
    deviceId: 'pc', actorId: 'actor', soldAt: '2026-10-08T12:00:00.000Z',
    lines: [{ lineId: 'line', operationId: 'op-' + id, productId: 'p', quantityUnits: '2000000' }], receipt: { totalMinor: '400' } });

test.beforeEach(async ({ page }, info) => {
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
        if (url.pathname === '/atomic-backup-test') {
            await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sandbox backup test</title><button id="export">Export</button><input type="file" id="restore" accept=".json">' }); return;
        }
        await route.continue();
    });
    await page.goto('/atomic-backup-test');
    await page.evaluate(async ({ name, baseline, sales }) => {
        const module = await import('/src/services/atomicSaleSandbox.js');
        window.__source = await module.openAtomicSaleSandbox({ databaseName: name + '-source' });
        window.__target = await module.openAtomicSaleSandbox({ databaseName: name + '-target' });
        window.__name = name;
        await window.__source.initializeBaseline(baseline);
        for (const sale of sales) {
            const result = await window.__source.commitSale(sale);
            const identity = { ...baseline, saleId: sale.saleId, revision: result.revision };
            await window.__source.recordOutboxAttempt(identity);
            if (sale.saleId === 'confirmed') await window.__source.confirmOutbox({ ...identity, receiptId: 'receipt' });
        }
        document.querySelector('#export').onclick = async () => {
            const backup = await window.__source.exportBackup();
            const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = 'atomic-sale-sandbox-v1.json'; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        document.querySelector('#restore').onchange = async event => {
            try { window.__restored = await window.__target.restoreBackup(JSON.parse(await event.target.files[0].text())); }
            catch (error) { window.__restoreError = error.message; }
        };
    }, { name: prefix + 'backup-' + info.testId.replace(/[^A-Za-z0-9_-]/g, '_'), baseline, sales: [sale('confirmed'), sale('pending')] });
});
const exportCopy = page => page.evaluate(() => window.__source.exportBackup());
const targetState = page => page.evaluate(input => window.__target.readScope(input), baseline);
async function resignInBrowser(page, backup) {
    return page.evaluate(async data => {
        const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
            : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
        const { sha256: _sha256, ...body } = data;
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(body)));
        data.sha256 = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
        return data;
    }, backup);
}

test('downloaded JSON restores every store and ACK state, replay never reapplies stock', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('atomic-sale-sandbox-v1.json');
    const raw = await readFile(await download.path(), 'utf8'); const backup = JSON.parse(raw);
    expect(backup.format).toBe('PDA-AtomicSale-Sandbox'); expect(backup.sha256).toMatch(/^[a-f0-9]{64}$/);
    await page.locator('#restore').setInputFiles({ name: 'atomic-sale-sandbox-v1.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
    await expect.poll(() => page.evaluate(() => window.__restored)).toMatchObject({ restored: true, replay: false, rows: 8 });
    const source = await page.evaluate(input => window.__source.readScope(input), baseline);
    expect(await targetState(page)).toEqual(source);
    expect(source.outbox.map(row => [row.id, row.status, row.attempts])).toEqual([['confirmed', 'confirmed', 1], ['pending', 'pending', 1]]);
    expect(await page.evaluate(data => window.__target.restoreBackup(data), backup)).toMatchObject({ restored: false, replay: true });
    expect((await page.evaluate(input => window.__target.commitSale(input), sale('confirmed'))).replay).toBe(true);
    expect(await targetState(page)).toEqual(source);
    const name = await page.evaluate(() => window.__name);
    await page.reload();
    await page.evaluate(async name => { window.__target = await (await import('/src/services/atomicSaleSandbox.js')).openAtomicSaleSandbox({ databaseName: name + '-target' }); }, name);
    expect(await targetState(page)).toEqual(source);
});

for (const corrupt of ['checksum', 'stock', 'missing-operation', 'outbox-payload', 'revision', 'orphan', 'duplicate', 'ack']) {
    test(`rejects ${corrupt} corruption before any writes, even with recomputed checksum`, async ({ page }) => {
        let backup = await exportCopy(page);
        if (corrupt === 'checksum') backup.sha256 = '0'.repeat(64);
        if (corrupt === 'stock') backup.data.stock[0].units = '999';
        if (corrupt === 'missing-operation') backup.data.operations.pop();
        if (corrupt === 'outbox-payload') backup.data.outbox[0].payload.sale.receipt.totalMinor = '999';
        if (corrupt === 'revision') backup.data.sales[0].revision = '0'.repeat(64);
        if (corrupt === 'orphan') backup.data.stock.push({ ...backup.data.stock[0], id: 'unknown' });
        if (corrupt === 'duplicate') backup.data.sales.push(backup.data.sales[0]);
        if (corrupt === 'ack') backup.data.outbox.find(row => row.status === 'pending').receiptId = 'forged';
        if (corrupt !== 'checksum') backup = await resignInBrowser(page, backup);
        const error = await page.evaluate(async input => { try { await window.__target.restoreBackup(input); } catch (error) { return error.message; } }, backup);
        expect(error).toMatch(/BACKUP|INCONSISTENT|REVISION/);
        expect(await targetState(page)).toEqual({ baseline: null, sales: [], operations: [], stock: [], outbox: [] });
    });
}

for (const store of ['baselines', 'sales', 'operations', 'stock', 'outbox']) {
    test(`restore abort at ${store} leaves destination empty and retry recovers`, async ({ page }) => {
        const backup = await exportCopy(page);
        const result = await page.evaluate(async ({ backup, store }) => {
            const original = IDBObjectStore.prototype.add; let injected = false;
            IDBObjectStore.prototype.add = function (...args) {
                const request = original.apply(this, args);
                if (!injected && this.name === store) { injected = true; request.addEventListener('success', () => this.transaction.abort()); }
                return request;
            };
            try { await window.__target.restoreBackup(backup); return { ok: true, injected }; }
            catch { return { ok: false, injected }; }
            finally { IDBObjectStore.prototype.add = original; }
        }, { backup, store });
        expect(result).toEqual({ ok: false, injected: true });
        expect((await targetState(page)).baseline).toBeNull();
        expect((await targetState(page)).sales).toEqual([]);
        expect(await page.evaluate(input => window.__target.restoreBackup(input), backup)).toMatchObject({ restored: true });
        expect(await targetState(page)).toEqual(await page.evaluate(input => window.__source.readScope(input), baseline));
    });
}

test('legacy v1 sale-only backup remains restorable after void support was added', async ({ page }) => {
    const backup = await exportCopy(page);
    backup.version = 1;
    for (const entry of backup.data.outbox) delete entry.kind;
    const legacy = await resignInBrowser(page, backup);
    expect(await page.evaluate(input => window.__target.restoreBackup(input), legacy)).toMatchObject({ restored: true, replay: false });
    expect(await targetState(page)).toEqual(await page.evaluate(input => window.__source.readScope(input), baseline));
    const saleReplay = await page.evaluate(input => window.__target.commitSale(input), sale('confirmed'));
    expect(saleReplay.replay).toBe(true);
    expect(await targetState(page)).toEqual(await page.evaluate(input => window.__source.readScope(input), baseline));
});

test('old backup cannot roll back newer sale or confirmed ACK in destination', async ({ page }) => {
    const backup = await exportCopy(page);
    await page.evaluate(input => window.__target.restoreBackup(input), backup);
    await page.evaluate(async input => {
        const state = await window.__target.readScope(input);
        const pending = state.outbox.find(row => row.status === 'pending');
        await window.__target.confirmOutbox({ ...input, saleId: pending.id, revision: pending.revision, receiptId: 'new-ack' });
    }, baseline);
    const confirmed = await targetState(page);
    const error = await page.evaluate(async input => { try { await window.__target.restoreBackup(input); } catch (error) { return error.message; } }, backup);
    expect(error).toBe('RESTORE_DESTINATION_NOT_EMPTY'); expect(await targetState(page)).toEqual(confirmed);
    await page.evaluate(input => window.__target.commitSale(input), sale('new-sale'));
    const changed = await targetState(page);
    expect(await page.evaluate(async input => { try { await window.__target.restoreBackup(input); } catch (error) { return error.message; } }, backup)).toBe('RESTORE_DESTINATION_NOT_EMPTY');
    expect(await targetState(page)).toEqual(changed);
});

test('every account/business scope and untouched baseline survives restore', async ({ page }) => {
    const other = { ...baseline, accountId: 'another-account', businessId: 'cosmetics' };
    await page.evaluate(async ({ baseline, sale }) => {
        await window.__source.initializeBaseline(baseline, { allowNegative: true });
        await window.__source.commitSale(sale);
        await window.__source.initializeBaseline({ ...baseline, epochId: 'untouched' });
    }, { baseline: other, sale: { ...sale('other'), accountId: other.accountId, businessId: other.businessId } });
    const backup = await exportCopy(page);
    expect(backup.data.baselines).toHaveLength(3);
    await page.evaluate(input => window.__target.restoreBackup(input), backup);
    for (const scope of [baseline, other, { ...other, epochId: 'untouched' }]) {
        expect(await page.evaluate(input => window.__target.readScope(input), scope))
            .toEqual(await page.evaluate(input => window.__source.readScope(input), scope));
    }
});

test('two connections restoring the same snapshot produce one import and one replay', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const backup = await window.__source.exportBackup();
        const other = await (await import('/src/services/atomicSaleSandbox.js')).openAtomicSaleSandbox({ databaseName: window.__name + '-target' });
        try { return await Promise.all([window.__target.restoreBackup(backup), other.restoreBackup(backup)]); }
        finally { other.close(); }
    });
    expect(result.filter(entry => entry.restored)).toHaveLength(1);
    expect(result.filter(entry => entry.replay)).toHaveLength(1);
    expect(await targetState(page)).toEqual(await page.evaluate(input => window.__source.readScope(input), baseline));
});

test('export refuses corrupted local projection instead of certifying a broken backup', async ({ page }) => {
    await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open(window.__name + '-source'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        await new Promise((resolve, reject) => {
            const tx = db.transaction('stock', 'readwrite'); const store = tx.objectStore('stock');
            const req = store.getAll(); req.onsuccess = () => store.put({ ...req.result[0], units: 'wrong' });
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        }); db.close();
    });
    const error = await page.evaluate(async () => { try { await window.__source.exportBackup(); } catch (error) { return error.message; } });
    expect(error).toBe('INCONSISTENT_BACKUP');
});

test('export holds a coherent all-store snapshot while another connection commits', async ({ page }) => {
    const result = await page.evaluate(async input => {
        const module = await import('/src/services/atomicSaleSandbox.js');
        const writer = await module.openAtomicSaleSandbox({ databaseName: window.__name + '-source' });
        try {
            const [backup] = await Promise.all([window.__source.exportBackup(), writer.commitSale(input)]);
            await module.validateAtomicSaleBackup(backup);
            return { sales: backup.data.sales.length, ops: backup.data.operations.length, outbox: backup.data.outbox.length,
                units: backup.data.stock[0].units };
        } finally { writer.close(); }
    }, sale('race'));
    expect([2, 3]).toContain(result.sales); expect(result.ops).toBe(result.sales); expect(result.outbox).toBe(result.sales);
    expect(result.units).toBe((10000000n - BigInt(result.sales) * 2000000n).toString());
});
