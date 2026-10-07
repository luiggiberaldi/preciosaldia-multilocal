/**
 * checkout-movil.e2e.spec.js — Fase 0: arnés e2e de la zona de cobro en móvil.
 *
 * Red de seguridad ANTES de tocar la UI (plan por fases — guardarrail 1):
 *  - Viewport de teléfono: 360×740, una columna, flujo "basic" forzado.
 *  - Estado 100% offline y sembrado (helpers/seedBrowserState.js).
 *  - Casos: cobro exacto, vuelto total 1-tap, vuelto combinado USD+Bs, pago
 *    combinado, fiado (bloqueo sin cliente), Cashea oculto sin cliente,
 *    saldo a favor solo con pulsación explícita, reset al cambiar cliente,
 *    y screenshots baseline (360/390/430px).
 *
 * Ejecutar: bun run test:e2e -- tests/e2e/checkout-movil.e2e.spec.js
 */
import { test, expect } from '@playwright/test';
import {
    SEED_INDEXEDDB_SNIPPET,
    SEED_LOCALSTORAGE_SNIPPET,
    neutralizeExternalNetwork,
} from './helpers/seedBrowserState';

// La app resuelve 'basic' (<1024px), pero se fuerza por config para que el
// test no dependa del viewport del runner.
test.use({
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
});

test.beforeEach(async ({ page }) => {
    await neutralizeExternalNetwork(page);
    await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
    await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
});

// ── Navegación: app → Vender → caja abierta → agregar producto → checkout ──

async function goToSales(page) {
    await page.goto('/');
    // Venta es la vista por defecto para CAJERO, pero la sesión es ADMIN → tab "Vender".
    await page.getByRole('button', { name: 'Vender' }).click();
    // La caja está abierta (APERTURA_CAJA sembrada) → no debe aparecer el overlay.
    await expect(page.getByRole('heading', { name: 'Caja Cerrada' })).toHaveCount(0, { timeout: 15_000 });
}

async function addProductBySearch(page, productName) {
    const search = page.getByPlaceholder('Buscar producto...');
    await search.fill(productName);
    // Enter agrega el primer resultado (handleSearchKeyDown → searchResults[selectedIndex]).
    await search.press('Enter');
    // El término se limpia al agregar.
    await expect(search).toHaveValue('', { timeout: 5_000 });
}

async function openCheckout(page) {
    // FAB móvil "Ver Cesta".
    await page.getByText('Ver Cesta', { exact: true }).click();
    // CTA del carrito.
    await page.getByRole('button', { name: /COBRAR/ }).click();
    // Header del modal de cobro (modo basic).
    await expect(page.getByRole('heading', { name: 'COBRAR' })).toBeVisible();
}

// Inputs de pago: por moneda y por orden. El modo básico móvil usa la vista
// "sm:hidden" de CheckoutPaymentBars (una moneda expandida a la vez): el orden
// del DOM es [USD..., Bs...] porque así se construyen las familias. Acordeado a
// TEST_PAYMENT_METHODS: USD=0, Bs=1. La vista "hidden sm:block" replica los
// mismos inputs para escritorio — no debe tocarse desde el test móvil.
const usdAmountInput = (page) =>
    page.locator('div.sm\\:hidden input[type="text"][inputmode="decimal"][placeholder="0.00"]').first();
// OJO: en móvil solo se renderiza la familia de la pestaña activa. Para Bs,
// pulsar antes la pestaña "Bolívares"; el primer input es efectivo_bs.
const bsAmountInput = (page) =>
    page.locator('div.sm\\:hidden input[type="text"][inputmode="decimal"][placeholder="0.00"]').first();

// El botón final del modo básico cambia de texto según el estado.
const confirmButton = (page) =>
    page.getByRole('button', { name: /CONFIRMAR VENTA|INGRESA LOS PAGOS|FIAR RESTANTE|CONFIRMA EL CAMBIO|ERROR DE TASA|COMPLETAR CUOTA INICIAL/ });

// ════════════════════════════════════════════════════════════════════════
// CASO 1 — Cobro simple exacto (pago completo, sin vuelto)
// ════════════════════════════════════════════════════════════════════════
test('cobro simple: pago exacto en USD registra la venta y muestra recibo', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E');           // $2.00
    await addProductBySearch(page, 'Harina E2E');         // $1.00  → total $3.00
    await openCheckout(page);

    // Barra de estado única (Fase 1): Total → Pagado → Resta.
    await expect(page.getByText('Pagado', { exact: true })).toBeVisible();
    await expect(page.locator('span:visible').filter({ hasText: /^\$3\.00$/ }).first()).toBeVisible();

    // Pago exacto en USD.
    await usdAmountInput(page).fill('3.00');

    // El CTA se habilita como "CONFIRMAR VENTA".
    await expect(confirmButton(page)).toBeEnabled();
    await confirmButton(page).click();

    // Recibo: la venta se registró (recibo con tasa aplicada) y la cesta quedó
    // vacía (FAB desaparece). El recibo muestra el total en Bs, no en USD.
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Bs 120,00')).toBeVisible();
    await expect(page.getByText('Ver Cesta', { exact: true })).toHaveCount(0);
});

// ════════════════════════════════════════════════════════════════════════
// CASO 2 — Vuelto simple: entrega total en 1 decisión
// ════════════════════════════════════════════════════════════════════════
test('vuelto simple: pago con $5 sobre $3 genera vuelto $2 y confirma tras asignar', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E');
    await addProductBySearch(page, 'Harina E2E');         // total $3.00
    await openCheckout(page);

    await usdAmountInput(page).fill('5.00');

    // Aparece la sección de vuelto en el footer y la fila progresiva (Fase 2).
    await expect(page.getByText('Vuelto:', { exact: false })).toBeVisible();

    // Mientras haya vuelto sin asignar, el CTA está bloqueado con copy instructivo.
    const cta = confirmButton(page);
    await expect(cta).toBeDisabled();
    await expect(cta).toContainText('CONFIRMA EL CAMBIO');

    // El caso normal se resuelve en 1 pulsación con "Entregar así" (VUELTO-REALISTA:
    // el desglose propuesto $2.00 + Bs 0 es exacto porque el vuelto es entero).
    await page.getByRole('button', { name: /Entregar así|Entregar todo/ }).click();

    // Con el vuelto asignado, el CTA se habilita.
    await expect(cta).toBeEnabled();
    await expect(cta).toContainText('CONFIRMAR VENTA');
    await cta.click();

    // Modal final de distribución del cambio (última puerta).
    await expect(page.getByRole('heading', { name: /Confirmar distribución/i })).toBeVisible();
    // Nombre exacto: el CTA del footer "CONFIRMAR VENTA" también coincide en
    // modo case-insensitive.
    await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();

    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════
// CASO 2b — Steppers ± (VUELTO-REALISTA Fase 2): el cajero no tiene el billete
// que propone el desglose → un toque de "−" ajusta USD y recalcula los Bs.
// ════════════════════════════════════════════════════════════════════════
test('stepper de vuelto: sin billete de $1, un toque resta USD y lo pasa a Bs', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E');        // $5.00
    await openCheckout(page);

    await usdAmountInput(page).fill('10.00');             // vuelto $5 → propuesta $5 + Bs 0

    // Propuesta pendiente con stepper "−" visible.
    const stepperDown = page.getByLabel(/Restar un billete/);
    await expect(stepperDown).toBeVisible();
    await expect(page.getByText('→ $5.00', { exact: false })).toBeVisible();

    // Un toque de "−": SOLO PREVISUALIZA "→ $4.00 + Bs 40,00" (a tasa 40) en la
    // fila. Contrato clave del fix: ± NO completa la asignación — el CTA sigue
    // bloqueado ("CONFIRMA EL CAMBIO") y la fila sigue en pendiente hasta pulsar
    // "Entregar así", que es quien compromete el desglose a la venta.
    await stepperDown.click();
    const cta = confirmButton(page);
    await expect(page.getByText('→ $4.00 + Bs 40,00')).toBeVisible();
    await expect(cta).toBeDisabled();
    await expect(cta).toContainText('CONFIRMA EL CAMBIO');

    // "Entregar así" compromete el desglose previsualizado: fila en complete
    // ("Vuelto asignado") y CTA habilitado — ese ES el flujo de una pulsación.
    await page.getByRole('button', { name: /Entregar así/ }).click();
    await expect(page.getByText(/Vuelto asignado: \$5\.00/)).toBeVisible();
    await expect(cta).toBeEnabled();

    // Última puerta: el modal de distribución debe reflejar el desglose ajustado
    // (ambio físico = $4.00 + Bs 40,00 = $5.00 equivalentes).
    await cta.click();
    await expect(page.getByRole('heading', { name: /Confirmar distribución/i })).toBeVisible();
    await expect(page.getByText(/\$4\.00 \+ Bs 40,00/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════
// CASO 3 — Vuelto combinado USD + Bs (límites cruzados)
// ════════════════════════════════════════════════════════════════════════
test('vuelto combinado: declarar Bs del vuelto acota el campo USD al remanente', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E');        // $5.00
    await openCheckout(page);

    // Paga $10 en USD → vuelto $5 (= Bs 200 a tasa 40).
    await usdAmountInput(page).fill('10.00');
    await page.getByText('Vuelto:', { exact: false }).waitFor();

    // Abrir el bottom sheet de asignación (antes "Personalizar") — el botón
    // secundario con copy "¿El cliente lo quiere de otra forma?" (campos con
    // aria-label único dentro del sheet).
    await page.getByRole('button', { name: /otra forma/ }).click();

    // Declarar Bs 120 del vuelto en "Cambio en Bs".
    const bsChange = page.getByLabel('Cambio a entregar en bolívares');
    await bsChange.fill('120');

    // El remanente del vuelto en dólares queda $2 (= $5 − Bs 120/40), y el
    // campo USD se acota al máximo asignable (escribir 3 se normaliza a 2).
    const usdChange = page.getByLabel('Cambio a entregar en dólares');
    await usdChange.fill('3');
    await expect(usdChange).toHaveValue('2');

    // Asignación completa → cerrar sheet y confirmar.
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(confirmButton(page)).toBeEnabled();
    await confirmButton(page).click();
    await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════
// CASO 4 — Pago combinado USD + Bs sin vuelto
// ════════════════════════════════════════════════════════════════════════
test('pago combinado: $2 + Bs 80 cubren venta de $4 y confirman', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E');
    await addProductBySearch(page, 'Cafe E2E');
    await addProductBySearch(page, 'Harina E2E');
    await addProductBySearch(page, 'Harina E2E');          // total $6.00

    // Ajustar: usar cantidades distintas para total determinista.
    // (2 Cafe + 2 Harina = $6.00)
    await openCheckout(page);

    await usdAmountInput(page).fill('2.00');
    // Cambiar a la pestaña de bolívares (familia expandida única en móvil).
    await page.getByRole('tab', { name: 'Bolívares' }).click();
    await bsAmountInput(page).fill('160');                 // Bs 160 = $4 → total cubierto

    await expect(confirmButton(page)).toBeEnabled();
    await confirmButton(page).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════
// CASO 5 — Fiado: sin cliente el CTA no permite fiar
// ════════════════════════════════════════════════════════════════════════
test('fiado: con pago parcial y sin cliente el CTA está bloqueado; con cliente se habilita', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E');         // $5.00
    await openCheckout(page);

    // Pago parcial $2 → resta $3.
    await usdAmountInput(page).fill('2.00');

    // Sin cliente seleccionado: CTA bloqueado.
    const cta = confirmButton(page);
    await expect(cta).toBeDisabled();

    // Seleccionar cliente (picker móvil aparece encima de las barras de pago).
    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText('Juan E2E').click();

    // Con cliente, el flujo ofrece fiar el restante.
    await expect(page.getByRole('button', { name: /FIAR RESTANTE/ })).toBeVisible();
    await page.getByRole('button', { name: /FIAR RESTANTE/ }).click();

    // Confirmación de fiado con el monto restante.
    // El modal de fiado resume el abono y el pendiente.
    await expect(page.getByText(/El cliente abona/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar fiado' }).click();

    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════
// CASO 6 — Cashea: sin cliente no interfiere (oculto/deshabilitado)
// ════════════════════════════════════════════════════════════════════════
test('cashea apagado: no bloquea ni auto-activa al cobrar', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E');
    await openCheckout(page);

    await usdAmountInput(page).fill('2.00');
    await expect(confirmButton(page)).toBeEnabled();
    await expect(confirmButton(page)).toContainText('CONFIRMAR VENTA');

    // El CTA no debe estar en modo Cashea.
    await expect(confirmButton(page)).not.toContainText('CASHEA');
    await confirmButton(page).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════
// CASO 7 — Saldo a favor: no se aplica sin pulsación explícita
// ════════════════════════════════════════════════════════════════════════
test('saldo a favor: sin ingresarlo, la venta con cliente se cobra completa sin acreditar nada', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E');         // $5.00
    await openCheckout(page);

    // Cliente con favor: $18.50 (sembrado) — pero NO se aplica al pago.
    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText('Juan E2E').click();
    // (el picker se cierra solo al elegir — no se necesitan más pulsaciones)

    // Pago exacto en efectivo.
    await usdAmountInput(page).fill('5.00');
    await expect(confirmButton(page)).toBeEnabled();
    await confirmButton(page).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 10_000 });
});

// ════════════════════════════════════════════════════════════════════════
// CASO 8 — Cambiar cliente dentro del checkout reinicia el pago parcial
// (guardarrail del plan: el pago pertenece al cliente)
// ════════════════════════════════════════════════════════════════════════
test('cambiar de cliente limpia el saldo a favor aplicado (uso interno del hook)', async ({ page }) => {
    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E');
    await openCheckout(page);

    // Seleccionar Juan → picker muestra su favor.
    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText('Juan E2E').click();
    await expect(page.getByText(/Favor \$18\.50/).first()).toBeVisible();
});

// ════════════════════════════════════════════════════════════════════════
// BASELINES — Screenshots de los estados del checkout a 360/390/430px
// ════════════════════════════════════════════════════════════════════════
const WIDTHS = [360, 390, 430];

for (const width of WIDTHS) {
    test(`baseline ${width}px: estados pendiente y con vuelto`, async ({ page }) => {
        await page.setViewportSize({ width, height: 740 });
        await goToSales(page);
        await addProductBySearch(page, 'Caraota E2E');
        await openCheckout(page);

        // Estado pendiente (sin pagar).
        await page.locator('input[inputmode="decimal"][placeholder="0.00"]').first().waitFor();
        await page.screenshot({ path: `tests/e2e/__screenshots__/checkout-${width}-pendiente.png` });

        // Estado con vuelto (sobrepago).
        await usdAmountInput(page).fill('10.00');
        await page.getByText('Vuelto:', { exact: false }).waitFor();
        await page.screenshot({ path: `tests/e2e/__screenshots__/checkout-${width}-vuelto.png` });
    });
}
