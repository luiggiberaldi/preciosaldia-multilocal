import { test, expect } from '@playwright/test';

const e2eEnabled = process.env.SUPERVISOR_E2E_ENABLED === 'true';
const e2eBaseUrl = process.env.SUPERVISOR_E2E_BASE_URL || '';

const VIEWPORTS = [
    { name: 'mobile-small', width: 320, height: 568 },
    { name: 'mobile-standard', width: 360, height: 800 },
    { name: 'mobile-large', width: 390, height: 844 },
    { name: 'mobile-xl', width: 414, height: 896 },
    { name: 'tablet-portrait', width: 768, height: 1024 },
    { name: 'tablet-landscape', width: 1024, height: 768 },
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'desktop-large', width: 1440, height: 900 },
    { name: 'mobile-landscape', width: 844, height: 390 },
];

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
}

test.describe('Supervisor responsive seguro', () => {
    for (const viewport of VIEWPORTS) {
        test(`no desborda en ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
            requireSafeE2EEnvironment();
            const context = await browser.newContext({ viewport });
            const page = await context.newPage();

            await bootSupervisor(page);

            const dimensions = await page.evaluate(() => ({
                documentWidth: document.documentElement.scrollWidth,
                documentClientWidth: document.documentElement.clientWidth,
                bodyWidth: document.body.scrollWidth,
                bodyClientWidth: document.body.clientWidth,
            }));

            expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth + 1);
            expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth + 1);
            await expect(page.getByTestId('supervisor-header')).toBeVisible();
            await expect(page.getByTestId('supervisor-tabs')).toBeVisible();

            const criticalButtons = await page.getByTestId('supervisor-header button').evaluateAll(buttons =>
                buttons.map(button => {
                    const rect = button.getBoundingClientRect();
                    return { width: rect.width, height: rect.height };
                })
            );
            for (const button of criticalButtons) {
                expect(button.width).toBeGreaterThanOrEqual(40);
                expect(button.height).toBeGreaterThanOrEqual(40);
            }

            await context.close();
        });
    }
});
