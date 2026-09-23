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

async function bootSupervisor(page) {
    await page.addInitScript(() => {
        localStorage.setItem('pda_pairing_mode', 'monitor');
        localStorage.setItem('pda_paired_device_id', 'e2e-primary-device');
        localStorage.setItem('business_name', 'Negocio E2E Sintético');
    });
    await page.goto('/');
    await expect(page.getByTestId('supervisor-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Reportes', exact: true }).click();
}

test.describe('Supervisor reportes seguros', () => {
    test('muestra filtros y controles PDF sin overflow', async ({ page }) => {
        requireSafeE2EEnvironment();
        await bootSupervisor(page);

        await expect(page.getByTestId('supervisor-reports')).toBeVisible();
        await expect(page.getByTestId('supervisor-report-filters')).toBeVisible();
        await expect(page.getByRole('button', { name: 'PDF Cierre', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'PDF Ventas', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'PDF Gastos', exact: true })).toBeVisible();

        const periodControl = page.getByTestId('supervisor-report-period-select');
        await periodControl.locator('button[aria-haspopup="listbox"]').click();
        await expect(periodControl.getByRole('listbox')).toBeVisible();
        await expect(periodControl.locator('select')).toHaveCount(0);
        await expect(periodControl.getByRole('option', { name: 'Hoy', exact: true })).toBeVisible();
        await periodControl.getByRole('option', { name: 'Hoy', exact: true }).click();

        const dimensions = await page.evaluate(() => ({
            documentWidth: document.documentElement.scrollWidth,
            documentClientWidth: document.documentElement.clientWidth,
        }));
        expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth + 1);
    });
});
