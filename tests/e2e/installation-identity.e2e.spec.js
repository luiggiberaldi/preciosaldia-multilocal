import { test, expect } from '@playwright/test';
import { SEED_LOCALSTORAGE_SNIPPET, SEED_INDEXEDDB_SNIPPET } from './helpers/seedBrowserState';
import { createMockSupabaseBackend, routeMockSupabase } from './helpers/mockSupabaseCloud';

const ID_KEY = 'pda_device_id';
const LEGACY_ID = 'PDA-V2-' + 'E2'.repeat(16);
const UUID_RE = /^PDA-I-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function isolate(page) {
    const backend = createMockSupabaseBackend();
    await routeMockSupabase(page, backend);
    await page.routeWebSocket(/wss:\/\/.*/, socket => socket.close());
    return backend;
}

async function deviceId(page) {
    return page.evaluate(key => localStorage.getItem(key), ID_KEY);
}

test('perfiles limpios iguales crean IDs distintos y recarga mantiene cada ID', async ({ browser }) => {
    const contexts = [];
    try {
        const ids = [];
        for (let index = 0; index < 2; index++) {
            const context = await browser.newContext();
            contexts.push(context);
            const page = await context.newPage();
            await isolate(page);
            await page.goto('/');
            await expect.poll(() => deviceId(page)).toMatch(UUID_RE);
            const id = await deviceId(page);
            ids.push(id);
            await page.reload();
            await expect(page.getByRole('status', { name: 'Verificando identidad de instalación…' })).toHaveCount(0);
            await expect.poll(() => deviceId(page)).toBe(id);
            expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pda_fp_anchor_v1')).anchor)).toBe(id);
        }
        expect(ids[0]).not.toBe(ids[1]);
    } finally {
        for (const context of contexts) await context.close();
    }
});

test('legacy conserva ID y permite vender sin pasos extra', async ({ page }) => {
    const backend = await isolate(page);
    backend.registerDevice(LEGACY_ID, { alias: 'Caja legacy' });
    await page.addInitScript(`window.__e2eDeviceId = ${JSON.stringify(LEGACY_ID)};\n${SEED_LOCALSTORAGE_SNIPPET}`);
    await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Vender', exact: true })).toBeVisible({ timeout: 45_000 });
    expect(await deviceId(page)).toBe(LEGACY_ID);
    await page.getByRole('button', { name: 'Vender', exact: true }).click();
    const search = page.getByPlaceholder('Buscar producto...');
    await search.fill('Cafe E2E');
    await search.press('Enter');
    await page.getByText('Ver Cesta', { exact: true }).click();
    await page.getByRole('button', { name: /COBRAR/ }).click();
    await page.locator('div.sm\\:hidden input[type="text"][inputmode="decimal"][placeholder="0.00"]').first().fill('2.00');
    await page.getByRole('button', { name: 'CONFIRMAR VENTA', exact: true }).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
    expect(await deviceId(page)).toBe(LEGACY_ID);
});

test('conflicto muestra aviso visible, conserva datos y no envía registro/sync', async ({ page }) => {
    await isolate(page);
    const mutations = [];
    page.on('request', request => {
        if (request.method() !== 'GET' && /\/rest\/v1\//.test(request.url())) mutations.push(request.url());
    });
    await page.addInitScript(({ id }) => {
        localStorage.setItem('pda_device_id', id);
        localStorage.setItem('pda_fp_anchor_v1', JSON.stringify({ anchor: 'PDA-V2-' + 'A'.repeat(32) }));
        localStorage.setItem('pda_premium_token', 'fixture-token-preserved');
        localStorage.setItem('bodega_sales_v1', 'fixture-sales-preserved');
    }, { id: LEGACY_ID });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Identidad de instalación pendiente de revisión' })).toBeVisible();
    await expect(page.locator('#initial-splash-overlay')).toHaveCount(0);
    expect(await deviceId(page)).toBe(LEGACY_ID);
    expect(await page.evaluate(() => localStorage.getItem('pda_premium_token'))).toBe('fixture-token-preserved');
    expect(await page.evaluate(() => localStorage.getItem('bodega_sales_v1'))).toBe('fixture-sales-preserved');
    expect(mutations).toEqual([]);
});

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
