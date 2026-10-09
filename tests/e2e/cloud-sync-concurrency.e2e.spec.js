import { test, expect } from '@playwright/test';
import { createMockSupabaseBackend, routeMockSupabase } from './helpers/mockSupabaseCloud';
import { SEED_LOCALSTORAGE_SNIPPET, SEED_INDEXEDDB_SNIPPET } from './helpers/seedBrowserState';

const OWN = 'PDA-V2-' + 'A1'.repeat(16);
const OTHER = 'PDA-V2-' + 'B2'.repeat(16);
const B = 'neg-concurrency-b';
const bridge = `window.__raceImport = async suffix => {
 const urls = performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes(suffix));
 return import(/* @vite-ignore */ urls[urls.length - 1] || suffix);
};`;

test('sede capturada, debounce independiente y revisiones serializadas en app real', async ({ page }) => {
    test.setTimeout(150_000);
    const backend = createMockSupabaseBackend();
    backend.registerDevice(OWN); backend.registerDevice(OTHER);
    const updatedAt = '2026-10-01T10:00:00.000Z';
    const registry = { device_id: OTHER, collection: 'store', doc_id: 'bodega_businesses_registry_v1', updated_at: updatedAt,
        data: { schemaVersion: 1, updatedAt, payload: { businesses: [
            { id: 'neg-1', nombre: 'Sede A test' }, { id: B, nombre: 'Sede B test' },
        ] } } };
    backend.syncDocuments.set(`${OTHER}|store|${registry.doc_id}`, registry);
    await routeMockSupabase(page, backend);
    await page.routeWebSocket(/wss:\/\/.*/, socket => socket.close());
    await page.addInitScript(`window.__e2eDeviceId = ${JSON.stringify(OWN)};\n${SEED_LOCALSTORAGE_SNIPPET}\n${bridge}`);
    await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
    await page.goto('/');
    await expect(page.locator('[data-tour="tab-inicio"]')).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => page.evaluate(async () => (await window.__raceImport('/src/hooks/useCloudSync.js')).isCloudSyncActiveNow()), { timeout: 45_000 }).toBe(true);
    expect((await page.evaluate(async () => (await window.__raceImport('/src/hooks/useCloudSync.js')).syncNow())).ok).toBe(true);

    // Two physical destinations from the same logical key survive one debounce window.
    await page.evaluate(async b => {
        const context = await window.__raceImport('/src/utils/negocioContext.js');
        const sync = await window.__raceImport('/src/hooks/useCloudSync.js');
        context.setNegocioActivoId('neg-1');
        sync.queueCloudSync('bodega_employees_v1', [{ id: 'employee-a', nombre: 'A' }]);
        context.setNegocioActivoId(b);
        sync.queueCloudSync('bodega_employees_v1', [{ id: 'employee-b', nombre: 'B' }]);
    }, B);
    await expect.poll(() => backend.docsFrom(OWN, 'nb_neg-1:bodega_employees_v1')[0]?.data.payload).toEqual([{ id: 'employee-a', nombre: 'A' }]);
    await expect.poll(() => backend.docsFrom(OWN, `nb_${B}:bodega_employees_v1`)[0]?.data.payload).toEqual([{ id: 'employee-b', nombre: 'B' }]);

    // Hold the server response to the old revision, then enqueue the new one.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const intercepted = [];
    await page.route('**/rest/v1/sync_documents**', async route => {
        const request = route.request();
        const row = request.method() === 'POST' ? request.postDataJSON() : null;
        if (row?.doc_id === 'nb_neg-1:bodega_employees_v1' && row.data.payload[0]?.id?.startsWith('race-')) {
            intercepted.push(row);
            if (row.data.payload[0].id === 'race-old') await gate;
        }
        await backend.handle(route);
    });
    try {
        await page.evaluate(async () => {
            const context = await window.__raceImport('/src/utils/negocioContext.js');
            const sync = await window.__raceImport('/src/hooks/useCloudSync.js');
            context.setNegocioActivoId('neg-1');
            window.__oldWrite = sync.pushCloudSync('bodega_employees_v1', [{ id: 'race-old' }]);
        });
        await expect.poll(() => intercepted.length).toBe(1);
        await page.evaluate(async b => {
            const sync = await window.__raceImport('/src/hooks/useCloudSync.js');
            window.__newWrite = sync.pushCloudSync('bodega_employees_v1', [{ id: 'race-new' }]);
            (await window.__raceImport('/src/utils/negocioContext.js')).setNegocioActivoId(b);
        }, B);
        // A bounded stability window deliberately checks absence of a second POST.
        await page.waitForTimeout(350);
        expect(intercepted).toHaveLength(1);
        release();
        const result = await page.evaluate(() => Promise.all([window.__oldWrite, window.__newWrite]));
        expect(result.every(r => r.ok)).toBe(true);
        expect(intercepted.map(r => r.data.payload[0].id)).toEqual(['race-old', 'race-new']);
        expect(backend.docsFrom(OWN, 'nb_neg-1:bodega_employees_v1')[0].data.payload).toEqual([{ id: 'race-new' }]);
        expect(backend.docsFrom(OWN, `nb_${B}:bodega_employees_v1`)[0].data.payload).toEqual([{ id: 'employee-b', nombre: 'B' }]);
    } finally { release(); }
    await page.evaluate(async () => (await window.__raceImport('/src/utils/negocioContext.js')).setNegocioActivoId('neg-1'));
    await page.locator('[data-tour="tab-ventas"]').click();
    await expect(page.getByPlaceholder('Buscar producto...')).toBeVisible({ timeout: 30_000 });
});
