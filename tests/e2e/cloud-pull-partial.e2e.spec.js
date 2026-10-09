import { test, expect } from '@playwright/test';
import { SEED_LOCALSTORAGE_SNIPPET, SEED_INDEXEDDB_SNIPPET } from './helpers/seedBrowserState';
import { createMockSupabaseBackend, routeMockSupabase } from './helpers/mockSupabaseCloud';

const OWN = 'PDA-V2-' + 'A1'.repeat(16);
const OTHER = 'PDA-V2-' + 'B2'.repeat(16);
const stamp = '2026-10-09T10:00:00.000Z';
function document(docId, payload, updatedAt = stamp, deviceId = OTHER) {
    return { device_id: deviceId, collection: 'store', doc_id: docId, updated_at: updatedAt,
        data: { schemaVersion: 1, payload, updatedAt } };
}
const bridge = `
window.__f2Import = async suffix => {
 const entries = performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes(suffix));
 return import(/* @vite-ignore */ entries[entries.length - 1] || suffix);
};
`;

test('válidos continúan, tres inválidos persisten, y reintento explícito recupera tras reparación', async ({ page }) => {
    test.setTimeout(180_000);
    const autoSyncMessages = [];
    page.on('console', message => { if (message.text().includes('[AutoSync] Post-vinculación:')) autoSyncMessages.push(message.text()); });
    const backend = createMockSupabaseBackend();
    backend.registerDevice(OWN); backend.registerDevice(OTHER);
    const bad = [1, 2, 3].map(index => document(`nb_neg-1:bodega_sales_delta_2026-10-0${index}`, { legacyUnknown: index }));
    const registry = document('bodega_businesses_registry_v1', { businesses: [{ id: 'neg-1', nombre: 'Caja local' }] });
    const valid = document('nb_neg-1:bodega_employees_v1', [{ id: 'employee-f2', nombre: 'Empleado F2' }]);
    for (const row of [registry, valid, ...bad]) backend.syncDocuments.set(`${row.device_id}|${row.collection}|${row.doc_id}`, row);
    await routeMockSupabase(page, backend);
    await page.routeWebSocket(/wss:\/\/.*/, socket => socket.close());
    await page.addInitScript(`window.__e2eDeviceId = ${JSON.stringify(OWN)};\n${SEED_LOCALSTORAGE_SNIPPET}\n${bridge}`);
    // Seed only the first navigation: reload must preserve the real journal.
    await page.addInitScript(`if (!sessionStorage.getItem('f2-idb-seeded')) {
      sessionStorage.setItem('f2-idb-seeded', 'true');
      ${SEED_INDEXEDDB_SNIPPET}
    }`);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Sync parcial:.*3 pendientes/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Vender', exact: true })).toBeVisible();
    const read = () => page.evaluate(async () => {
        const { appForage } = await window.__f2Import('/src/utils/appForage.js');
        const service = await window.__f2Import('/src/services/cloudPullService.js');
        const sync = await window.__f2Import('/src/hooks/useCloudSync.js');
        const pending = await service.getPendingCloudDocuments(service.cloudPullScope({ userId: 'e2e-owner-user' }, localStorage.getItem('pda_device_id')));
        return { employees: await appForage.getItem('bodega_employees_v1'),
            sales: await appForage.getItem('bodega_sales_v1'), pending: pending.map(e => e.row.data.payload),
            active: sync.isCloudSyncActiveNow(), status: service.getCloudPullStatus() };
    });
    await expect.poll(async () => (await read()).employees).toEqual([{ id: 'employee-f2', nombre: 'Empleado F2' }]);
    expect((await read()).pending).toEqual([{ legacyUnknown: 1 }, { legacyUnknown: 2 }, { legacyUnknown: 3 }]);
    expect((await read()).active).toBe(true);
    // Affected sales key does not overwrite evidence; unrelated products push.
    await expect.poll(() => backend.docsFrom(OWN).some(r => r.doc_id.endsWith('bodega_products_v1'))).toBe(true);
    // Historical broken days stay pending, but today's valid local delta
    // must still leave the caja; only the whole-history snapshot is held.
    expect(backend.docsFrom(OWN).some(r => bad.some(b => b.doc_id === r.doc_id))).toBe(false);
    await expect.poll(() => backend.docsFrom(OWN).some(r => r.doc_id.includes('bodega_sales_delta_'))).toBe(true);
    const windowResult = await page.evaluate(async () => (await window.__f2Import('/src/hooks/useCloudSync.js')).pushSalesWindow());
    expect(windowResult).toMatchObject({ skipped: true, pending: true });
    autoSyncMessages.length = 0;
    await page.reload();
    await expect(page.getByRole('button', { name: /Sync parcial:.*3 pendientes/ })).toBeVisible({ timeout: 45_000 });
    // Let the existing post-login automatic cycle finish while data is still
    // invalid, so it cannot race the user-triggered recovery we are testing.
    await expect.poll(() => autoSyncMessages.some(message => message.includes('Sync parcial')), { timeout: 45_000 }).toBe(true);
    expect((await read()).pending).toHaveLength(3);
    // Download and restore the actual canonical JSON through Settings, not a
    // synthetic call to the backup service. Only this test's isolated DB is lost.
    await page.locator('[data-tour="tab-ajustes"]').click();
    await page.getByRole('button', { name: 'Sistema', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar Backup/ }).click();
    const download = await downloadPromise;
    const backupFile = await download.path();
    const fs = await import('node:fs/promises');
    const exported = JSON.parse(await fs.readFile(backupFile, 'utf8'));
    expect(download.suggestedFilename()).toMatch(/^backup_tasasaldia_completo_\d{4}-\d{2}-\d{2}\.json$/);
    expect(exported.version).toBe('2.0');
    expect(exported.data.cloudPullJournal.version).toBe(1);
    expect(exported.data.cloudPullJournal.entries.filter(entry => entry.status === 'pending')).toHaveLength(3);
    expect(exported.data.cloudPullJournal.entries.map(entry => entry.row.data.payload)).toEqual([
        { legacyUnknown: 1 }, { legacyUnknown: 2 }, { legacyUnknown: 3 },
    ]);
    expect(JSON.stringify(exported.data.cloudPullJournal)).not.toContain('cursor:');
    // Remove only the mock's invalid rows: if recovery did not restore the
    // file's journal, a network pull could no longer recreate those failures.
    for (const row of bad) backend.syncDocuments.delete(`${row.device_id}|${row.collection}|${row.doc_id}`);
    await page.evaluate(async () => {
        const { default: forage } = await window.__f2Import('/node_modules/.vite/deps/localforage.js');
        await forage.createInstance({ name: 'BodegaCloudPull', storeName: 'pending_documents_v1' }).clear();
    });
    expect((await read()).pending).toEqual([]);
    await page.getByRole('button', { name: /Importar Backup/ }).click();
    await page.locator('input[type="file"][accept=".json"]').setInputFiles({
        name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)),
    });
    await expect(page.getByRole('heading', { name: 'Restaurar backup?' })).toBeVisible();
    autoSyncMessages.length = 0;
    await page.getByRole('button', { name: 'Sí, restaurar', exact: true }).click();
    await page.waitForEvent('load', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Sync parcial:.*3 pendientes/ })).toBeVisible({ timeout: 45_000 });
    await expect.poll(async () => (await read()).active).toBe(true);
    expect((await read()).pending).toHaveLength(3);
    expect(await page.evaluate(() => localStorage.getItem('pda_device_id'))).toBe(OWN);
    // Finish the restored startup/post-login cycle with failures still intact,
    // before publishing the mock's repaired revisions for the explicit retry.
    await expect.poll(() => autoSyncMessages.some(message => message.includes('Sync parcial')), { timeout: 45_000 }).toBe(true);
    for (let index = 0; index < bad.length; index++) {
        const original = bad[index];
        const day = `2026-10-0${index + 1}`;
        const repaired = document(original.doc_id, { date: day, tickets: [{ id: `F2-ticket-${index}`, tipo: 'VENTA', timestamp: `${day}T12:00:00.000Z`, total: 2 }] }, '2026-10-10T10:00:00.000Z');
        backend.syncDocuments.set(`${repaired.device_id}|${repaired.collection}|${repaired.doc_id}`, repaired);
    }
    await page.getByRole('button', { name: /Sync parcial:.*3 pendientes/ }).click();
    await expect(page.getByText(/Sincronizado correctamente/)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: /Sync parcial:/ })).toHaveCount(0);
    const result = await read();
    expect(result.pending).toEqual([]);
    expect(result.sales.filter(ticket => ticket.id.startsWith('F2-ticket-'))).toHaveLength(3);
    // Replaying through the actual UI/result path does not duplicate sales.
    await page.evaluate(async () => (await window.__f2Import('/src/hooks/useCloudSync.js')).syncNow());
    expect((await read()).sales.filter(ticket => ticket.id.startsWith('F2-ticket-'))).toHaveLength(3);
    // Exercise the actual supabase-js keyset URL against the local mock too,
    // not just the in-memory page fixture used by the unit test.
    backend.reset();
    for (let index = 0; index < 2003; index++) {
        const row = document(`retired_key_${String(index).padStart(5, '0')}`, []);
        backend.syncDocuments.set(`${row.device_id}|${row.collection}|${row.doc_id}`, row);
    }
    const pagination = await page.evaluate(async ({ own, other }) => {
        const service = await window.__f2Import('/src/services/cloudPullService.js');
        const { supabaseCloud } = await window.__f2Import('/src/config/supabaseCloud.js');
        const state = new Map();
        const store = { keys: async () => [...state.keys()], getItem: async key => state.get(key) ?? null,
            setItem: async (key, value) => { state.set(key, value); } };
        return service.runCloudPull({ scope: 'pagination-only-fixture', deviceIds: [own, other], store,
            manual: true, fetchPage: options => service.fetchCloudPullPage(supabaseCloud, [own, other], options),
            classify: () => 'skip', apply: async () => { throw new Error('retired fixture must never apply'); } });
    }, { own: OWN, other: OTHER });
    expect(pagination).toMatchObject({ rows: 2003, skipped: 2003, pending: 0, queryFailed: false, status: 'confirmed' });
});

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
