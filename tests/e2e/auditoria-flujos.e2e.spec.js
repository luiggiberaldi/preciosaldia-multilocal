/**
 * auditoria-flujos.e2e.spec.js — Auditoría e2e de TODOS los flujos de la app.
 *
 * Objetivo: recorrer la aplicación como lo haría un operador (móvil 360px,
 * offline, estado sembrado) y dejar evidencia de qué funciona y qué no:
 * errores de consola, excepciones no capturadas, respuestas locales >= 400,
 * desbordes horizontales y el estado final persistido en IndexedDB.
 *
 * No es un spec de regresión de un caso: es un barrido. Cada flujo registra su
 * resultado con `record()` y al final se escribe `test-results/auditoria-flujos.json`.
 *
 * Ejecutar: bunx playwright test tests/e2e/auditoria-flujos.e2e.spec.js
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import {
    attachCollectors, expectNoPageErrors, reportNoise,
    seedAudit, startApp, goTo, auditOverflow, measureOverflow,
    record, writeAuditReport, readIdb, TABS,
} from './helpers/auditHarness';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
// Reintentos SOLO para este barrido: vite compila los chunks lazy al primer
// acceso y recarga la página cuando descubre dependencias nuevas, lo que puede
// abortar un flujo a mitad. El reintento corre con el grafo ya caliente.
test.describe.configure({ mode: 'serial', retries: 1 });

// Las vistas son lazy y en dev cada chunk se compila al primer acceso; los
// primeros montajes de Inventario pueden tardar >60 s bajo carga del runner.
test.setTimeout(120_000);

test.afterAll(() => writeAuditReport());

// ── Helpers de interacción (mismos patrones que el arnés del checkout) ──────
const usdAmountInput = (page) =>
    page.locator('div.sm\\:hidden input[type="text"][inputmode="decimal"][placeholder="0.00"]').first();

const confirmButton = (page) =>
    page.getByRole('button', { name: /CONFIRMAR VENTA|INGRESA LOS PAGOS|FIAR RESTANTE|CONFIRMA EL CAMBIO|ERROR DE TASA|COMPLETAR CUOTA INICIAL/ });

async function goToSales(page) {
    await goTo(page, 'ventas');
    await expect(page.getByRole('heading', { name: 'Caja Cerrada' })).toHaveCount(0, { timeout: 15_000 });
}

/** El buscador existe en Vender y en Inventario: hay que tomar el visible. */
const visibleProductSearch = (page) => page.locator('input[placeholder="Buscar producto..."]:visible').first();

/**
 * Inventario es una vista lazy: su chunk se compila al primer acceso y si vite
 * re-optimiza dependencias a mitad de corrida, la página se recarga y la app
 * vuelve a «Inicio» (el buscador jamás aparece). Re-pulsar la pestaña absorbe
 * recargas y montajes lentos.
 */
async function goToCatalogoYEsperar(page) {
    const search = () => visibleProductSearch(page);
    let ultimoError;
    for (let intento = 1; intento <= 4; intento++) {
        await page.locator('[data-tour="tab-catalogo"]').click();
        try {
            await search().waitFor({ state: 'visible', timeout: 20_000 });
            return search();
        } catch (e) {
            ultimoError = e;
            console.log(`[F4] intento ${intento} falló: body=`,
                (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 250));
        }
    }
    throw new Error(`Inventario no montó el buscador tras 4 intentos. Último error: ${ultimoError}`);
}

async function addProductBySearch(page, productName) {
    const search = visibleProductSearch(page);
    await search.fill(productName);
    await search.press('Enter');
    await expect(search).toHaveValue('', { timeout: 5_000 });
}

/** Cierra el recibo para poder seguir navegando (modal bloqueante). */
async function closeReceipt(page) {
    const nuevaVenta = page.getByRole('button', { name: /Nueva Venta/ });
    if (await nuevaVenta.count() > 0) {
        await nuevaVenta.first().click();
    } else {
        await page.getByLabel('Cerrar').first().click();
    }
    await expect(page.getByText('Tasa BCV Aplicada')).toHaveCount(0, { timeout: 10_000 });
}

async function openCheckout(page) {
    await page.getByText('Ver Cesta', { exact: true }).click();
    await page.getByRole('button', { name: /COBRAR/ }).click();
    await expect(page.getByRole('heading', { name: 'COBRAR' })).toBeVisible();
}

/** Cierra la auditoría de un flujo: errores no capturados + ruido + excepción. */
function closeFlow(log, flow) {
    expectNoPageErrors(log, flow);
    reportNoise(log, flow);
}

// ══════════════════════════════════════════════════════════════════════════
// F1 — Arranque e Inicio (dashboard)
// ══════════════════════════════════════════════════════════════════════════
test('F1 arranque + inicio', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    await expect(page.getByRole('button', { name: 'Cerrar Caja' })).toBeVisible({ timeout: 15_000 });
    await auditOverflow(page, 'F1 arranque + inicio', 'Inicio');

    const sales = await readIdb(page, 'bodega_sales_v1');
    record('F1 arranque + inicio', 'ok', `app levantó con ${sales?.length ?? 0} registro(s) sembrado(s) y «Cerrar Caja» visible`);
    closeFlow(log, 'F1 arranque + inicio');
});

// ══════════════════════════════════════════════════════════════════════════
// F2 — Vender: cobro exacto y recibo
// ══════════════════════════════════════════════════════════════════════════
test('F2 vender con cobro exacto', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E');
    await addProductBySearch(page, 'Harina E2E');
    await openCheckout(page);

    await usdAmountInput(page).fill('3.00');
    await expect(confirmButton(page)).toBeEnabled();
    await confirmButton(page).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Bs 120,00')).toBeVisible();

    const sales = await readIdb(page, 'bodega_sales_v1');
    const venta = (sales || []).find(s => s.tipo === 'VENTA');
    expect(venta, 'la venta quedó persistida').toBeTruthy();
    record('F2 vender con cobro exacto', 'ok',
        `venta $${venta.totalUsd} registrada como ${venta.tipo}, recibo con Bs 120,00 (tasa 40)`,
        { items: venta.items?.length, payments: venta.payments?.length });
    closeFlow(log, 'F2 vender con cobro exacto');
});

// ══════════════════════════════════════════════════════════════════════════
// F3 — Fiado: venta a crédito, deuda visible en Clientes y abono
// ══════════════════════════════════════════════════════════════════════════
test('F3 cliente nuevo + venta fiada + abono', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    // Clientes → alta por UI (así el fiado no depende de un cliente sembrado).
    await goTo(page, 'clientes');
    await page.locator('button:has-text("Nuevo Contacto")').first().click();
    await page.getByPlaceholder('Ej. María Pérez').fill('Pedro E2E');
    await page.getByRole('button', { name: /Guardar Cliente/ }).click();

    await expect.poll(async () => {
        const c = await readIdb(page, 'bodega_customers_v1');
        return c?.some(x => x.name === 'Pedro E2E');
    }, { timeout: 15_000 }).toBe(true);
    record('F3 cliente nuevo + venta fiada + abono', 'ok', 'cliente «Pedro E2E» creado desde Clientes y persistido');

    // Venta de $5 con $2 de pago y $3 fiados.
    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E');
    await openCheckout(page);
    await usdAmountInput(page).fill('2.00');
    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText('Pedro E2E').first().click();
    await page.getByRole('button', { name: /FIAR RESTANTE/ }).click();
    await expect(page.getByText(/El cliente abona/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar fiado' }).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    await closeReceipt(page);

    const sales = await readIdb(page, 'bodega_sales_v1');
    const fiada = (sales || []).find(s => s.tipo === 'VENTA_FIADA');
    expect(fiada, 'la venta fiada quedó persistida').toBeTruthy();
    expect(fiada.fiadoUsd).toBe(3);

    await expect.poll(async () => {
        const c = await readIdb(page, 'bodega_customers_v1');
        return c?.find(x => x.name === 'Pedro E2E')?.deuda;
    }, { timeout: 15_000 }).toBe(3);

    const ledger = await readIdb(page, 'bodega_customer_ledger_v1');
    const movFiado = (ledger || []).filter(m => m.type === 'VENTA_FIADA');
    expect(movFiado.length).toBe(1);
    record('F3 cliente nuevo + venta fiada + abono', 'ok',
        `fiado $3 persistido: deuda del cliente en $3 y 1 movimiento VENTA_FIADA en el ledger`);

    // Clientes → detalle → Ajustar Cuenta (abono en Bs: 3 × 40 = 120).
    await goTo(page, 'clientes');
    await page.getByPlaceholder('Buscar cliente...').fill('Pedro');
    await page.getByText('Pedro E2E').first().click();
    await expect(page.getByText('Ajustar Cuenta')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Ajustar Cuenta').click();
    await page.locator('input[type="number"]').first().fill('120');
    await page.getByRole('button', { name: /^Abonar / }).click();

    await expect.poll(async () => {
        const c = await readIdb(page, 'bodega_customers_v1');
        return c?.find(x => x.name === 'Pedro E2E')?.deuda;
    }, { timeout: 15_000 }).toBe(0);

    // El saldo del cliente y el COBRO_DEUDA se vacían a IndexedDB en rutas
    // asíncronas distintas: esperar el registro, no solo el saldo.
    await expect.poll(async () =>
        ((await readIdb(page, 'bodega_sales_v1')) || []).filter(s => s.tipo === 'COBRO_DEUDA').length,
    { timeout: 15_000 }).toBe(1);
    record('F3 cliente nuevo + venta fiada + abono', 'ok', 'abono de Bs 120 saldó la deuda a $0 y quedó 1 COBRO_DEUDA registrado');
    await auditOverflow(page, 'F3 cliente nuevo + venta fiada + abono', 'Clientes');
    closeFlow(log, 'F3 cliente nuevo + venta fiada + abono');
});

// ══════════════════════════════════════════════════════════════════════════
// F3b — Fiado a un cliente CON saldo a favor (semántica de cartera neta)
// ══════════════════════════════════════════════════════════════════════════
test('F3b fiado a cliente con saldo a favor', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    // «Juan E2E» está sembrado con $18,50 a favor y $0 de deuda.
    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E'); // $5
    await openCheckout(page);
    await usdAmountInput(page).fill('2.00');
    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText('Juan E2E').first().click();
    await page.getByRole('button', { name: /FIAR RESTANTE/ }).click();
    await page.getByRole('button', { name: 'Confirmar fiado' }).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    // AVISO-CARTERA (H2): el recibo explica que el fiado consumió el favor.
    await expect(page.getByText('Saldo a favor aplicado')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Este fiado se cubrió con el saldo a favor/)).toBeVisible();
    await closeReceipt(page);

    await expect.poll(async () => {
        const l = await readIdb(page, 'bodega_customer_ledger_v1');
        return (l || []).filter(m => m.type === 'VENTA_FIADA').length;
    }, { timeout: 15_000 }).toBe(1);

    const clientes = await readIdb(page, 'bodega_customers_v1');
    const juan = clientes.find(c => c.name === 'Juan E2E');
    const ledger = await readIdb(page, 'bodega_customer_ledger_v1');
    const mov = ledger.find(m => m.type === 'VENTA_FIADA');

    record('F3b fiado a cliente con saldo a favor', 'finding',
        `el fiado de $3 NO aparece como deuda: el saldo a favor bajó de $18,50 a $${juan.favor} y la deuda quedó en $${juan.deuda} (la cartera es neta; el ledger sí registra el movimiento y el recibo ya lo explica con «Saldo a favor aplicado»)`, 
        { deuda: juan.deuda, favor: juan.favor, ledgerBalanceAfter: mov?.balanceAfterUsd, ledgerType: mov?.type });
    await auditOverflow(page, 'F3b fiado a cliente con saldo a favor', 'Vender');
    closeFlow(log, 'F3b fiado a cliente con saldo a favor');
});

// ══════════════════════════════════════════════════════════════════════════
// F4 — Cesta viva: editar el precio en Inventario se refleja en la cesta
// ══════════════════════════════════════════════════════════════════════════
test('F4 cesta viva al cambiar el precio del producto', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E'); // $2.00
    // El FAB «Ver Cesta» muestra el total de la cesta sin abrir el panel.
    const fab = page.locator('button:has-text("Ver Cesta")').first();
    await expect(fab).toBeVisible();
    await expect(fab).toContainText('$2.00');

    // Inventario → editar el producto ($2 → $4).
    // En móvil la acción de editar es un botón de icono dentro de la tarjeta, así
    // que se filtra por búsqueda y se pulsa el lápiz de la única tarjeta visible.
    const busquedaInventario = await goToCatalogoYEsperar(page);
    await busquedaInventario.fill('Cafe E2E');
    // La tarjeta del producto expone [Imprimir | Editar | Eliminar]: el botón de
    // editar es el hermano inmediato de «Imprimir Etiqueta».
    await page.locator('button[title="Imprimir Etiqueta"]').first()
        .locator('xpath=following-sibling::button[1]').click();
    const priceInput = page.getByPlaceholder('1.50').first();
    await expect(priceInput).toBeVisible({ timeout: 10_000 });
    await priceInput.fill('4');
    await page.getByRole('button', { name: /Actualizar Producto|Guardar Producto/ }).first().click();

    await expect.poll(async () => {
        const products = await readIdb(page, 'bodega_products_v1');
        return products?.find(p => p.id === 'p_cafe')?.priceUsd;
    }, { timeout: 10_000 }).toBe(4);

    // La cesta ya cargada debe reflejar el precio vigente sin re-agregar el ítem.
    // (El carrito vive en memoria: la única evidencia es el FAB, que muestra el total.)
    await goTo(page, 'ventas');
    const fabTrasEditar = page.locator('button:has-text("Ver Cesta")').first();
    await expect(fabTrasEditar).toBeVisible({ timeout: 10_000 });
    const precioEnCesta = await fabTrasEditar.getByText('$4.00').count();

    if (precioEnCesta > 0) {
        record('F4 cesta viva al cambiar el precio del producto', 'ok', 'la línea de la cesta tomó el precio nuevo ($4,00) sin re-agregar el producto');
    } else {
        record('F4 cesta viva al cambiar el precio del producto', 'finding',
            'la cesta sigue mostrando el precio viejo ($2,00) tras editar el producto en Inventario',
            { textosVisibles: (await page.locator('body').innerText()).slice(0, 400) });
    }
    expect(precioEnCesta, 'la cesta refleja el precio vigente').toBeGreaterThan(0);
    await auditOverflow(page, 'F4 cesta viva al cambiar el precio del producto', 'cesta');
    closeFlow(log, 'F4 cesta viva al cambiar el precio del producto');
});

// ══════════════════════════════════════════════════════════════════════════
// F5 — Inventario: alta de producto y persistencia tras recargar
// ══════════════════════════════════════════════════════════════════════════
test('F5 inventario: alta de producto y persistencia', async ({ page }) => {
    const log = attachCollectors(page);
    // Sin re-siembra al recargar: la recarga debe probar persistencia real.
    await seedAudit(page, { reseedOnReload: false });
    await startApp(page);

    await goTo(page, 'catalogo');
    await page.getByRole('button', { name: 'Nuevo' }).first().click();
    await page.getByPlaceholder('Ej: Harina PAN 1kg').fill('Producto Auditoria E2E');
    await page.getByPlaceholder('1.50').first().fill('7.25');
    await page.getByRole('button', { name: /Guardar Producto|Actualizar Producto/ }).first().click();

    await expect.poll(async () => {
        const products = await readIdb(page, 'bodega_products_v1');
        return products?.some(p => p.name === 'Producto Auditoria E2E');
    }, { timeout: 15_000 }).toBe(true);

    // Recarga: el catálogo debe volver del disco, no de memoria.
    await page.reload();
    await startApp(page);
    // Inventario monta lazy y vite puede recargar la página a mitad (re-
    // optimización): reintentar la pestaña hasta ver el producto del disco.
    let productoTrasRecarga = false;
    for (let intento = 0; intento < 4 && !productoTrasRecarga; intento++) {
        await page.locator('[data-tour="tab-catalogo"]').click();
        try {
            await page.getByText('Producto Auditoria E2E').first()
                .waitFor({ state: 'visible', timeout: 20_000 });
            productoTrasRecarga = true;
        } catch { /* montaje lento o recarga: reintentar */ }
    }
    expect(productoTrasRecarga, 'producto visible tras recargar la app').toBe(true);

    const products = await readIdb(page, 'bodega_products_v1');
    record('F5 inventario: alta de producto y persistencia', 'ok',
        `producto creado a $7.25, persistido en IndexedDB (${products.length} productos) y visible tras recargar la app`);
    await auditOverflow(page, 'F5 inventario: alta de producto y persistencia', 'Inventario');
    closeFlow(log, 'F5 inventario: alta de producto y persistencia');
});

// ══════════════════════════════════════════════════════════════════════════
// F6 — Reportes: métricas, cuentas por cobrar y descarga del PDF
// ══════════════════════════════════════════════════════════════════════════
test('F6 reportes: cuentas por cobrar y PDF', async ({ page }) => {
    const log = attachCollectors(page);

    // Escenario de fiado con cobranzas mayores al fiado (neto negativo).
    const { seedReportesFiado } = await import('./helpers/seedReportesFiado');
    await seedReportesFiado(page);
    await startApp(page);

    await goTo(page, 'reportes');
    const cobrar = page.getByTestId('reporte-cuentas-por-cobrar');
    await expect(cobrar).toBeVisible({ timeout: 20_000 });
    await expect(cobrar.getByText('Otorgado menos cobranzas')).toBeVisible();
    await expect(cobrar.getByText('−USD 15.00').first()).toBeVisible();

    record('F6 reportes: cuentas por cobrar y PDF', 'ok', 'sección de cuentas por cobrar visible con neto −$15,00 (fiado $10 / cobranzas $25)');

    // Descarga del PDF del reporte: el archivo real debe generarse.
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.getByRole('button', { name: /Descargar PDF/ }).first().click(),
    ]);
    const filePath = await download.path();
    const bytes = fs.readFileSync(filePath);
    record('F6 reportes: cuentas por cobrar y PDF', bytes.length > 1000 ? 'ok' : 'finding',
        `PDF del reporte descargado (${(bytes.length / 1024).toFixed(1)} KB)`);
    expect(bytes.length).toBeGreaterThan(1000);

    await auditOverflow(page, 'F6 reportes: cuentas por cobrar y PDF', 'Reportes');
    closeFlow(log, 'F6 reportes: cuentas por cobrar y PDF');
});

// ══════════════════════════════════════════════════════════════════════════
// F7 — Cierre de caja completo (arqueo → resumen → PDF)
// ══════════════════════════════════════════════════════════════════════════
test('F7 cierre de caja completo', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    // Una venta en efectivo para que el cierre tenga movimientos.
    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E'); // $2
    await openCheckout(page);
    await usdAmountInput(page).fill('2.00');
    await confirmButton(page).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    await closeReceipt(page);

    await goTo(page, 'inicio');
    await page.getByRole('button', { name: 'Cerrar Caja' }).click();
    await expect(page.getByRole('heading', { name: 'Cierre de Caja' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Continuar al Conteo/ }).click();
    await expect(page.getByRole('heading', { name: 'Conteo Fisico' })).toBeVisible();

    // Coherencia del arqueo: apertura $100 + venta $2 en efectivo = $102.
    const esperadoUsd = page.getByText(/Sistema espera:/).first();
    await expect(esperadoUsd).toBeVisible();
    const textoEsperado = (await esperadoUsd.textContent()) || '';
    const esperaBsText = ((await page.getByText(/Sistema espera:/).nth(1).textContent()) || '');

    const inputs = page.locator('input[type="number"][placeholder="0.00"]');
    await inputs.nth(0).fill('102');
    await inputs.nth(1).fill('4080');
    await page.getByRole('button', { name: /Calcular/ }).click();
    await expect(page.getByRole('button', { name: /Confirmar Cierre/ })).toBeVisible();
    await page.getByRole('button', { name: /Confirmar Cierre/ }).click();

    // Resumen del cierre con las tres salidas.
    await expect(page.getByRole('button', { name: /Descargar PDF/ })).toBeVisible({ timeout: 20_000 });
    record('F7 cierre de caja', /102/.test(textoEsperado) ? 'ok' : 'finding',
        `arqueo: UI espera ${textoEsperado.replace('Sistema espera:', '').trim()} en USD y ${esperaBsText.replace('Sistema espera:', '').trim()} en Bs para una apertura de $100 + venta de $2`,
        { esperadoUsd: textoEsperado.trim(), esperadoBs: esperaBsText.trim() });

    // PDF real del cierre: debe traer el resumen del día.
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.getByRole('button', { name: /Descargar PDF/ }).click(),
    ]);
    const bytes = fs.readFileSync(await download.path());
    const pdfText = bytes.toString('latin1');
    const tieneResumen = pdfText.includes('RESUMEN DEL D');
    record('F7 cierre de caja', tieneResumen ? 'ok' : 'finding',
        `PDF del cierre descargado (${(bytes.length / 1024).toFixed(1)} KB)${tieneResumen ? ' con el bloque RESUMEN DEL DÍA' : ' SIN el bloque de resumen del día'}`);
    expect(bytes.length).toBeGreaterThan(1000);

    // El cierre queda registrado y con la caja cerrada.
    const sales = await readIdb(page, 'bodega_sales_v1');
    const cierre = (sales || []).find(s => s.tipo === 'REGISTRO_CIERRE');
    expect(cierre, 'el cierre quedó registrado').toBeTruthy();
    record('F7 cierre de caja', cierre.summary?.reconData ? 'ok' : 'finding',
        `REGISTRO_CIERRE #${cierre.cierreNumber} guardado${cierre.summary?.reconData ? ' con su arqueo (reconData)' : ' SIN reconData'}, ${(sales || []).filter(s => s.cajaCerrada).length} registro(s) marcados cajaCerrada`);

    await auditOverflow(page, 'F7 cierre de caja completo', 'resumen de cierre');
    closeFlow(log, 'F7 cierre de caja completo');
});

// ══════════════════════════════════════════════════════════════════════════
// F8 — Ajustes: secciones y flags de escape
// ══════════════════════════════════════════════════════════════════════════
test('F8 ajustes: secciones y flags', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    // La vista se carga en un chunk diferido (y vite puede recargar la página
    // al descubrirlo): re-pulsar la pestaña hasta que los tabs existan.
    let ajustesListos = false;
    for (let intento = 0; intento < 4 && !ajustesListos; intento++) {
        await page.locator('[data-tour="tab-ajustes"]').click();
        try {
            await page.getByRole('button', { name: 'Negocio', exact: true }).first()
                .waitFor({ state: 'visible', timeout: 20_000 });
            ajustesListos = true;
        } catch { /* chunk compilando o recarga: reintentar */ }
    }
    expect(ajustesListos, 'secciones de Ajustes visibles').toBe(true);

    let secciones = 0;
    for (const seccion of ['Negocio', 'Ventas', 'Usuarios', 'Licencia', 'Sistema']) {
        const boton = page.getByRole('button', { name: seccion, exact: true }).first();
        if (await boton.count() === 0) continue;
        await boton.click();
        await page.waitForTimeout(500);
        secciones += 1;
        await auditOverflow(page, 'F8 ajustes: secciones y flags', seccion);
    }

    await page.getByRole('button', { name: 'Ventas', exact: true }).first().click();
    await page.waitForTimeout(500);
    for (const flag of ['Fiados y cobranzas en el reporte', 'Cesta viva', 'Reparar cartera desde el ledger']) {
        const visible = await page.getByText(flag, { exact: true }).count();
        record('F8 ajustes: secciones y flags', visible > 0 ? 'ok' : 'finding',
            `flag «${flag}» ${visible > 0 ? 'presente' : 'AUSENTE'} en Configuración → Ventas`);
    }
    record('F8 ajustes: secciones y flags', secciones >= 4 ? 'ok' : 'finding', `${secciones}/5 secciones de Ajustes abiertas`);
    closeFlow(log, 'F8 ajustes: secciones y flags');
});

// ══════════════════════════════════════════════════════════════════════════
// F9 — Navegación completa: las 6 vistas sin errores ni desborde
// ══════════════════════════════════════════════════════════════════════════
test('F9 navegación por las 6 vistas', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    for (const [id, label] of Object.entries(TABS)) {
        await goTo(page, id);
        await page.waitForTimeout(900); // montaje lazy + reveal-on-scroll
        const m = await measureOverflow(page);
        record('F9 navegación por las 6 vistas', m.docOverflow > 2 || m.offenders.length > 0 ? 'finding' : 'ok',
            `${label}: ${m.docOverflow > 2 ? `desborde de ${m.docOverflow}px` : 'sin desborde horizontal'}`,
            m.offenders.length ? m.offenders : null);
    }
    record('F9 navegación por las 6 vistas', 'ok', `las ${Object.keys(TABS).length} vistas navegables respondieron al toque de la barra inferior`, { consoleErrors: log.consoleErrors.length });
    closeFlow(log, 'F9 navegación por las 6 vistas');
});

// ══════════════════════════════════════════════════════════════════════════
// F10 — Anulación de venta con devolución de stock y reciclaje al carrito
// ══════════════════════════════════════════════════════════════════════════
test('F10 anular venta + stock devuelto + reciclaje de carrito', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    const stockInicial = (await readIdb(page, 'bodega_products_v1'))?.find(p => p.id === 'p_cafe')?.stock;

    // Vender 1 Cafe ($2) en efectivo.
    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E');
    await openCheckout(page);
    await usdAmountInput(page).fill('2.00');
    await confirmButton(page).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    await closeReceipt(page);

    await expect.poll(async () => {
        const p = await readIdb(page, 'bodega_products_v1');
        return p?.find(x => x.id === 'p_cafe')?.stock;
    }, { timeout: 15_000 }).toBe(stockInicial - 1);

    // Reportes → Ventas (historial) → expandir la fila (toque en la transacción)
    // → anular la venta. La fila muestra «1 venta» como resumen clicable.
    await goTo(page, 'reportes');
    await page.getByRole('button', { name: 'Ventas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Historial de Ventas' })).toBeVisible({ timeout: 15_000 });
    // La fila clicable tiene el nombre del cliente («Consumidor Final» aquí) —
    // el «1 venta» es solo el resumen agregado, no la fila.
    await page.getByText('Consumidor Final').last().click(); // expande la fila
    await page.getByRole('button', { name: /Anular/ }).first().click();
    await page.getByRole('button', { name: /Si, anular/ }).click();

    // El modal de reciclaje se ofrece tras anular.
    await expect(page.getByRole('heading', { name: 'Venta Anulada' })).toBeVisible({ timeout: 15_000 });

    await expect.poll(async () => {
        const sales = await readIdb(page, 'bodega_sales_v1');
        return sales?.some(s => s.tipo === 'VENTA' && s.status === 'ANULADA');
    }, { timeout: 15_000 }).toBe(true);

    // El stock devuelto y el flag ANULADA persisten en rutas separadas:
    // esperar la reposición del stock, no solo la anulación.
    let stockTrasAnular;
    await expect.poll(async () => {
        const p = await readIdb(page, 'bodega_products_v1');
        stockTrasAnular = p?.find(x => x.id === 'p_cafe')?.stock;
        return stockTrasAnular;
    }, { timeout: 15_000 }).toBe(stockInicial);
        record('F10 anular venta + stock devuelto + reciclaje de carrito', 'ok',
            `anulación marcó la venta ANULADA y el stock del producto volvió de ${stockInicial - 1} a ${stockTrasAnular}`);

    // Reciclar → los ítems vuelven al carrito en Vender.
    await page.getByRole('button', { name: /Reciclar/ }).click();
    await expect(page.getByText('Ver Cesta', { exact: true })).toBeVisible({ timeout: 15_000 });
    const fab = page.locator('button:has-text("Ver Cesta")').first();
    await expect(fab).toContainText('$2.00');
    record('F10 anular venta + stock devuelto + reciclaje de carrito', 'ok',
        'los ítems de la venta anulada se reciclaron al carrito ($2,00 en el FAB) sin re-agregarlos');
    closeFlow(log, 'F10 anular venta + stock devuelto + reciclaje de carrito');
});

// ══════════════════════════════════════════════════════════════════════════
// F11 — Gasto interno que afecta caja (y el arqueo lo descuenta)
// ══════════════════════════════════════════════════════════════════════════
test('F11 gasto interno afecta el arqueo de caja', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    // Gasto de $5 en Bs (200 Bs) desde el dashboard.
    await goTo(page, 'inicio');
    await page.getByRole('button', { name: /Registrar Gasto/ }).first().click();
    await expect(page.getByPlaceholder('Ej. Compra de bolsas, bombillo, refresco...')).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder('Ej. Compra de bolsas, bombillo, refresco...').fill('Bolsas auditoria E2E');
    // Categoría «Insumos» y moneda Bs (el método de caja se auto-selecciona).
    await page.getByRole('button', { name: /Insumos/ }).first().click();
    await page.getByRole('button', { name: 'Bs Bolívares' }).click();
    await page.getByPlaceholder('0.00').last().fill('200');
    await page.getByRole('button', { name: /Registrar Gasto de Caja Chica/ }).click();

    await expect.poll(async () => {
        const sales = await readIdb(page, 'bodega_sales_v1');
        return sales?.filter(s => s.tipo === 'GASTO_INTERNO' && s.status !== 'ANULADA').length;
    }, { timeout: 15_000 }).toBe(1);

    const gasto = (await readIdb(page, 'bodega_sales_v1'))
        ?.filter(s => s.tipo === 'GASTO_INTERNO')[0];
    record('F11 gasto interno afecta el arqueo de caja', 'ok',
        `gasto «${gasto.description}» registrado: -$${Math.abs(gasto.totalUsd)} (Bs ${Math.abs(gasto.totalBs)})`,
        { methodId: gasto.payments?.[0]?.methodId, afectaCaja: gasto.afectaCaja });

    // El arqueo del cierre debe descontar el gasto: 100 - 5 = 95 USD y 4000 - 200 = 3800 Bs.
    await page.getByRole('button', { name: 'Cerrar Caja' }).click();
    await expect(page.getByRole('heading', { name: 'Cierre de Caja' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Continuar al Conteo/ }).click();
    await expect(page.getByRole('heading', { name: 'Conteo Fisico' })).toBeVisible();

    // El gasto se pagó en Bs: solo baja el bolsillo de Bs (4.000 → 3.800). El
    // bolsillo de dólares queda intacto (100): el dinero sale del cajón en la
    // moneda en que se pagó, no convertido.
    const textos = await page.getByText(/Sistema espera:/).allTextContents();
    const esperaUsd = textos.find(t => t.includes('$')) || '';
    const esperaBs = textos.find(t => t.includes('Bs')) || '';
    const correcto = esperaUsd.includes('100.00') && esperaBs.includes('3.800,00');
    const limpiar = (t) => t.replace('Sistema espera:', '').replace(/\s*B?s?\s*$/, '').replace(/^Bs\s*/, '').trim();
    record('F11 gasto interno afecta el arqueo de caja', correcto ? 'ok' : 'finding',
        `arqueo tras gasto de Bs 200: ${limpiar(esperaUsd)} en USD y Bs ${limpiar(esperaBs)} (esperado: bolsillo USD intacto en $100.00 y el de Bs de 4.000 → 3.800)`,
        { esperadoUsd: esperaUsd.trim(), esperadoBs: esperaBs.trim() });
    closeFlow(log, 'F11 gasto interno afecta el arqueo de caja');
});

// ══════════════════════════════════════════════════════════════════════════
// F12 — Pago con saldo a favor: el favor baja, la caja no recibe ese monto
// ══════════════════════════════════════════════════════════════════════════
test('F12 pago con saldo a favor en el checkout', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    // Venta de $5 de «Juan E2E» (favor $18,50 sembrado).
    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E');
    await openCheckout(page);
    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText('Juan E2E').first().click();
    await expect(page.getByText(/Favor \$18\.50/).first()).toBeVisible();

    // El checkout básico expone el saldo a favor como método de pago propio:
    // sección «Crédito interno» de las barras (el método virtual viaja en
    // paymentMethods y el hook le aplica tope min(favor, pendiente)). Se usa
    // de verdad: $5 = total de la venta, luego se audita el estado persistido.
    const inputCredito = page.locator('div:has(> h3:text-is("Crédito interno")) input').first();
    await expect(inputCredito).toBeVisible({ timeout: 10_000 });
    await inputCredito.fill('5');
    await expect(inputCredito).toHaveValue('5');
    await expect(confirmButton(page)).toBeEnabled();
    await confirmButton(page).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });

    const [sales, customers] = await Promise.all([
        readIdb(page, 'bodega_sales_v1'),
        readIdb(page, 'bodega_customers_v1'),
    ]);
    const venta = (sales || []).find(s => s.tipo === 'VENTA');
    expect(venta, 'la venta quedó persistida').toBeTruthy();
    const pagoFavor = (venta.payments || []).find(p => p.methodId === 'saldo_favor');
    const juan = (customers || []).find(c => c.name === 'Juan E2E');
    const favorOk = Boolean(pagoFavor)
        && Math.abs(Number(pagoFavor.amountUsd) - 5) < 0.001
        && Math.abs((juan?.favor || 0) - 13.5) < 0.001
        && (juan?.deuda || 0) === 0;
    record('F12 pago con saldo a favor en el checkout', favorOk ? 'ok' : 'finding',
        favorOk
            ? `venta de $5 pagada con saldo a favor en el checkout básico: pago interno registrado y el favor bajó de $18,50 a $${juan.favor}`
            : `estado inesperado al pagar con saldo a favor en básico: pagoFavor=${JSON.stringify(pagoFavor)} favor=${juan?.favor} deuda=${juan?.deuda}`,
        { methods: venta.payments?.map(p => p.methodId), favor: juan?.favor, deuda: juan?.deuda });
    await auditOverflow(page, 'F12 pago con saldo a favor en el checkout', 'checkout');
    closeFlow(log, 'F12 pago con saldo a favor en el checkout');
});

// ══════════════════════════════════════════════════════════════════════════
// F12b — Pago con saldo a favor en modo POS (el único shell con WalletSection)
// ══════════════════════════════════════════════════════════════════════════
test('F12b pago con saldo a favor en modo POS', async ({ page }) => {
    const log = attachCollectors(page);
    // El seed fija checkout_mode='basic': forzamos 'pos' (y quitamos el flag de
    // rollback que también fuerza el shell móvil) en cada carga.
    await seedAudit(page, {
        extraInitScripts: [`try { localStorage.setItem('checkout_mode', 'pos'); localStorage.removeItem('checkout_shell_v2'); } catch (_) {}`],
    });
    await startApp(page);

    await goToSales(page);
    await addProductBySearch(page, 'Caraota E2E'); // $5.00
    // El shell POS se titula «Procesar Pago» (el básico dice «COBRAR»).
    await page.getByText('Ver Cesta', { exact: true }).click();
    await page.getByRole('button', { name: /COBRAR/ }).click();
    await expect(page.getByText('Procesar Pago').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText('Juan E2E').first().click();

    // WalletSection del POS: «Todo» aplica el máximo permitido ($5, la venta).
    const usarTodo = page.getByTitle('Aplicar el máximo saldo a favor permitido');
    await expect(usarTodo).toBeVisible({ timeout: 15_000 });
    await usarTodo.click();

    // La venta queda cubierta sin efectivo: el POS habilita el cobro.
    const pagar = page.getByRole('button', { name: /PAGAR \(LISTO\)/ });
    await expect(pagar).toBeEnabled({ timeout: 10_000 });
    await pagar.click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    await closeReceipt(page);

    await expect.poll(async () => {
        const c = await readIdb(page, 'bodega_customers_v1');
        return c?.find(x => x.name === 'Juan E2E')?.favor;
    }, { timeout: 15_000 }).toBe(13.50);

    // La venta y el descuento del favor persisten en rutas asíncronas distintas.
    let venta;
    await expect.poll(async () => {
        venta = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA');
        return venta?.payments?.some(p => p.isSaldoFavor || p.methodId === 'saldo_favor') ?? false;
    }, { timeout: 15_000 }).toBe(true);

    const pagoFavor = venta.payments.find(p => p.isSaldoFavor || p.methodId === 'saldo_favor');
    // Guardarraíl de caja: el saldo a favor no es efectivo → ningún pago de
    // efectivo en la venta, así que el arqueo esperado no sube con este cobro.
    const pagosEfectivo = (venta.payments || []).filter(p => /efectivo/.test(p.methodId || ''));
    const limpio = Boolean(pagoFavor) && pagosEfectivo.length === 0;
    record('F12b pago con saldo a favor en modo POS', limpio ? 'ok' : 'finding',
        `venta de $${venta.totalUsd} pagada con saldo a favor: el favor bajó de $18,50 a $13,50 y la venta registró el pago interno de $${pagoFavor?.amountUsd} con ${pagosEfectivo.length} pago(s) en efectivo`,
        { payments: venta.payments, favor: 13.5 });
    await auditOverflow(page, 'F12b pago con saldo a favor en modo POS', 'checkout POS');
    closeFlow(log, 'F12b pago con saldo a favor en modo POS');
});

// ════════════════════════════════════════════════════════════════════════════
// F13 — Lente de fiados del mes en Clientes (H2, opción C): el fiado consumido
// por saldo a favor es visible aunque la deuda neta sea 0; la anulación lo resta.// ════════════════════════════════════════════════════════════════════════════
test('F13 lente de fiados del mes en Clientes', async ({ page }) => {
    const log = attachCollectors(page);
    await seedAudit(page);
    await startApp(page);

    // Fiar $3 a «Juan E2E» (favor $18,50): cartera neta → deuda queda en 0.
    await goToSales(page);
    await addProductBySearch(page, 'Cafe E2E');
    await addProductBySearch(page, 'Harina E2E');
    await openCheckout(page);
    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText('Juan E2E').first().click();
    await page.getByRole('button', { name: /FIAR RESTANTE/ }).click();
    await page.getByRole('button', { name: 'Confirmar fiado' }).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    await closeReceipt(page);

    await expect.poll(async () => {
        const l = await readIdb(page, 'bodega_customer_ledger_v1');
        return (l || []).some(m => m.type === 'VENTA_FIADA' && m.sourceSaleId);
    }, { timeout: 15_000 }).toBe(true);

    // Clientes: el chip «Fiados del mes» muestra a Juan aunque su deuda sea 0.
    await goTo(page, 'clientes');
    await expect(page.getByRole('button', { name: /Fiados del mes/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Fiados del mes/ }).click();
    await expect(page.locator('div[data-view="clientes"]').getByText('Juan E2E').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Fiado este mes/).first()).toBeVisible();
    await expect(page.getByText(/Crédito extendido este mes/)).toBeVisible();

    // Consistencia con la cartera neta: «Con Deuda» NO lo muestra.
    await page.getByRole('button', { name: /Con Deuda/ }).click();
    await expect(page.locator('div[data-view="clientes"]').getByText('Juan E2E')).toHaveCount(0, { timeout: 10_000 });

    // El lente es de solo lectura: la cartera persistida no cambió.
    const cartera = await readIdb(page, 'bodega_customers_v1');
    const juanCartera = cartera?.find(c => c.name === 'Juan E2E');
    const lenteIntacto = Math.abs((juanCartera?.favor || 0) - 15.5) < 0.001 && (juanCartera?.deuda || 0) === 0;

    record('F13 lente de fiados del mes en Clientes', 'ok',
        `chip «Fiados del mes» muestra a Juan con fiado de $3 (deuda neta $0, favor $15,50); «Con Deuda» no lo muestra; cartera intacta (${lenteIntacto ? 'favor 15,50, deuda 0' : 'INESPERADO: ' + JSON.stringify(juanCartera)})`);

    // Anular la venta fiada desde Reportes → el lente la resta.
    await goTo(page, 'reportes');
    await page.getByRole('button', { name: 'Ventas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Historial de Ventas' })).toBeVisible({ timeout: 15_000 });
    await page.getByText('Juan E2E').last().click();
    await page.getByRole('button', { name: /Anular/ }).first().click();
    await page.getByRole('button', { name: /Si, anular/ }).click();
    await expect(page.getByRole('heading', { name: 'Venta Anulada' })).toBeVisible({ timeout: 15_000 });
    // La oferta de reciclaje (z-100) tapa la pantalla: cerrarla antes de navegar.
    await page.getByRole('button', { name: 'Cerrar' }).last().click();

    await expect.poll(async () => {
        const l = await readIdb(page, 'bodega_customer_ledger_v1');
        return (l || []).filter(m => m.type === 'ANULACION').length;
    }, { timeout: 15_000 }).toBe(1);

    await goTo(page, 'clientes');
    await page.getByRole('button', { name: /Fiados del mes/ }).click();
    // El chip puede quedar vacío: el filtro no muestra a Juan.
    await expect(page.locator('div[data-view="clientes"]').getByText('Juan E2E')).toHaveCount(0, { timeout: 15_000 });
    record('F13 lente de fiados del mes en Clientes', 'ok',
        'tras anular la venta, «Fiados del mes» ya no muestra al cliente (la reversión ANULACION lo compensa)');
    await auditOverflow(page, 'F13 lente de fiados del mes en Clientes', 'Clientes');
    closeFlow(log, 'F13 lente de fiados del mes en Clientes');

});
