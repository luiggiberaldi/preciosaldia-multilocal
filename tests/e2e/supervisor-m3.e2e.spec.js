import { test, expect } from '@playwright/test';

const e2eEnabled = process.env.SUPERVISOR_E2E_ENABLED === 'true';
const e2eBaseUrl = process.env.SUPERVISOR_E2E_BASE_URL || '';

function requireSafeE2EEnvironment() {
    test.skip(!e2eEnabled, 'Define SUPERVISOR_E2E_ENABLED=true para ejecutar E2E contra staging controlado.');
    const isAuthorizedVercelPreview = process.env.SUPERVISOR_E2E_ALLOW_VERCEL_PREVIEW === 'true'
        && Boolean(process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
        && /^https:\/\/preciosaldia2026-[a-z0-9-]+-luigis-projects-b0d2f2f7\.vercel\.app$/.test(e2eBaseUrl);
    test.skip(
        !e2eBaseUrl || (!/staging|localhost|127\.0\.0\.1/.test(e2eBaseUrl) && !isAuthorizedVercelPreview),
        'El E2E exige localhost, staging o Preview Vercel autorizado.'
    );
}

async function boot(page, monitor = false) {
    await page.addInitScript(({ isMonitor }) => {
        if (isMonitor) localStorage.setItem('pda_pairing_mode', 'monitor');
        localStorage.setItem('pda_paired_device_id', 'e2e-primary-device');
        localStorage.setItem('business_name', 'Negocio E2E Sintético');
    }, { isMonitor: monitor });
    await page.goto('/');
    if (monitor) await expect(page.getByTestId('supervisor-panel')).toBeVisible({ timeout: 15_000 });
    else await expect(page.locator('body')).toBeVisible();
}

test.describe('Supervisor M3 — dos contextos y modo degradado', () => {
    test.describe.configure({ timeout: 60_000 });
    test('mantiene lectura segura al perder conexión entre caja y Supervisor', async ({ browser }) => {
        requireSafeE2EEnvironment();
        const primary = await browser.newContext();
        const monitor = await browser.newContext();
        const primaryPage = await primary.newPage();
        const monitorPage = await monitor.newPage();

        try {
            await Promise.all([
                boot(primaryPage, false),
                boot(monitorPage, true),
            ]);

            await monitor.setOffline(true);
            await monitorPage.evaluate(() => window.dispatchEvent(new Event('offline')));
            await expect(monitorPage.getByTestId('supervisor-connection-status')).toContainText('Desconectado');
            await expect(monitorPage.getByTestId('supervisor-panel')).toBeVisible();
            await expect(monitorPage.getByText(/mutaciones remotas/i)).toHaveCount(0);
            await expect(primaryPage.locator('body')).toBeVisible();
        } finally {
            await primary.close();
            await monitor.close();
        }
    });
});
