/**
 * reportes-fiado.e2e.spec.js — FIA-REPORT-001 (H1, H2, H4, H5) en pantalla.
 *
 * Escenario: 2 ventas fiadas ($10) y 3 abonos ($25) ⇒ neto del período −$15.
 * Antes del fix la sección «Por Cobrar» **desaparecía** en este caso (el bucket
 * del motor venía negativo y la UI filtraba por `total > 0`).
 *
 * Se corre a 320px de ancho: es el ancho más angosto que soporta la app y donde
 * la tarjeta con filas nuevas podría desbordar.
 *
 * Ejecutar: bun run test:e2e -- tests/e2e/reportes-fiado.e2e.spec.js
 */
import { test, expect } from '@playwright/test';
import { seedReportesFiado } from './helpers/seedReportesFiado';

test.use({
    viewport: { width: 320, height: 740 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
});

async function goToReports(page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Reportes', exact: true }).click();
    await expect(page.locator('[data-view="reportes"]')).toBeVisible({ timeout: 15_000 });
}

test('cobranzas mayores al fiado: la sección aparece con neto negativo y sin overflow', async ({ page }) => {
    await seedReportesFiado(page);
    await goToReports(page);

    const reports = page.locator('[data-view="reportes"]');
    const section = page.getByTestId('reporte-cuentas-por-cobrar');
    await expect(section).toBeVisible();

    // ── Las tres filas, separadas y con la etiqueta correcta ──
    await expect(section.getByText(/^Fiado otorgado/).first()).toBeVisible();
    await expect(section.getByText(/^Cobranzas/).first()).toBeVisible();
    await expect(section.getByText(/^Neto del período/).first()).toBeVisible();

    // ── Las cifras exactas de cada fila ──
    await expect(section.getByText('USD 10.00', { exact: true })).toBeVisible();
    await expect(section.getByText('USD 25.00', { exact: true })).toBeVisible();

    // ── El neto negativo se muestra CON signo (antes la sección ni existía) ──
    await expect(section.getByText('−USD 15.00', { exact: true })).toBeVisible();
    await expect(section.getByText(/USD 15\.00 neto/)).toBeVisible();

    // ── H2: la etiqueta ambigua ya no se usa en la tarjeta ("Por Cobrar" era el
    // nombre del flujo neto, no de la cartera). El alcance es la tarjeta porque
    // "Fiado (Por Cobrar)" sigue siendo la etiqueta del bucket del motor.
    await expect(section.getByText('Por Cobrar', { exact: true })).toHaveCount(0);
    await expect(section.getByText(/Cartera al cierre/).first()).toBeVisible();

    // ── H3: la cobranza es trazable (cliente + monto), no un número neto ──
    await expect(section.getByText('Detalle de cobranzas')).toBeVisible();
    await expect(section.getByText(/Juan E2E/).first()).toBeVisible();

    // ── H4: el efectivo es el 100% de los medios de pago (el fiado no diluye) ──
    await expect(reports.getByText('100%', { exact: true }).first()).toBeVisible();

    // ── H5: con la cartera cuadrando, NO debe aparecer la alerta de conciliación ──
    await expect(page.getByText('Cartera descuadrada con el ledger')).toHaveCount(0);

    // ── Sin overflow horizontal en 320px ──
    const dims = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(dims.scrollWidth).toBeLessThanOrEqual(dims.clientWidth + 1);

    const box = await section.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(dims.clientWidth + 1);
});

test('cartera desviada del ledger: aparece la alerta de conciliación sin el botón de reparación', async ({ page }) => {
    // Mismo escenario, pero el cliente queda debiendo $2,50 que el ledger no respalda.
    await seedReportesFiado(page, { customerDeudaUsd: 2.5 });
    await goToReports(page);

    const notice = page.getByText('Cartera descuadrada con el ledger');
    await expect(notice).toBeVisible();
    await expect(page.getByText(/1 cliente · diferencia USD 2\.50/)).toBeVisible();

    // La reparación está apagada por defecto (flag `reportes_reparacion_ledger`).
    await page.getByLabel('Ver detalle').click();
    await expect(page.getByText(/guardado USD 2\.50/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Reconstruir/ })).toHaveCount(0);

    const dims = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(dims.scrollWidth).toBeLessThanOrEqual(dims.clientWidth + 1);
});
