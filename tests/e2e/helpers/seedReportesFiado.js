/**
 * seedReportesFiado.js — Estado inicial determinista para el E2E del reporte
 * de fiados (FIA-REPORT-001).
 *
 * Escenario sembrado (mismo caso que el fixture unitario E2):
 *   - 2 ventas fiadas: $4,00 + $6,00  ⇒ fiado otorgado $10,00
 *   - 3 abonos en efectivo USD: $4,00 + $6,00 + $15,00 (deuda anterior)
 *                                     ⇒ cobranzas $25,00
 *   - Neto del período: −$15,00 (el caso que ANTES borraba la sección)
 *   - Cartera al cierre: $0 → el ledger cuadra (saldo inicial $15 migrado)
 *
 * Con `customerDeudaUsd` ≠ 0 se siembra un descuadre para probar la alerta de
 * conciliación (H5) sin tocar el ledger.
 *
 * Estrategia (igual que seedBrowserState.js del checkout):
 *   - localStorage: licencia, sesión ADMIN, tasa manual 40 Bs/$.
 *   - IndexedDB (localforage): productos, clientes, métodos, ventas y ledger.
 *   - Red externa neutralizada con page.route.
 */

import {
    SEED_LOCALSTORAGE_SNIPPET,
    neutralizeExternalNetwork,
} from './seedBrowserState';

export const REPORTES_RATE = 40; // Bs por USD, fija y determinista

const TEST_PRODUCTS = [
    { id: 'p_cafe', name: 'Cafe E2E', category: 'abastos', stock: 50, costUsd: 1, priceUsd: 2, priceUsdt: 2, isWeight: false, barcode: 'E2ECAFE1' },
];

const TEST_PAYMENT_METHODS = [
    { id: 'efectivo_usd', label: 'Efectivo en Dólares', icon: '💲', currency: 'USD', isFactory: true, isEnabled: true },
    { id: 'efectivo_bs', label: 'Efectivo en Bolívares', icon: '💵', currency: 'BS', isFactory: true, isEnabled: true },
    { id: 'pago_movil', label: 'Pago Móvil', icon: '📱', currency: 'BS', isFactory: true, isEnabled: true },
];

const CLIENTE = { id: 'cli_e2e_juan', code: 'CLI-00001', name: 'Juan E2E', documentId: '12345', phone: '' };

/**
 * Construye el snippet que siembra IndexedDB **en el navegador** (las fechas se
 * calculan en runtime para que el período por defecto del reporte las incluya).
 */
export function buildReportesSeedSnippet({ customerDeudaUsd = 0 } = {}) {
    const customers = [{ ...CLIENTE, deuda: customerDeudaUsd, favor: 0, createdAt: '2026-01-01T00:00:00.000Z' }];

    return `
(function () { async function __seedReportes() {
    const RATE = ${REPORTES_RATE};
    // Los registros se anclan a la FECHA LOCAL de hoy a una hora fija:
    // el reporte filtra por día, y "hace N minutos" se sale del rango cuando la
    // corrida cae de madrugada o en el borde de la semana (el rango semanal
    // arranca el domingo). Con hora fija 00:xx de hoy el registro siempre entra.
    const todayAt = (hour, minute) => {
        const d = new Date();
        d.setHours(hour, minute, 0, 0);
        return d.toISOString();
    };
    const iso = (slot) => todayAt(0, 5 + slot);
    const bs = (usd) => Math.round(usd * RATE * 100) / 100;

    const item = (name, usd, costUsd) => [{ id: 'p_cafe', name, qty: 1, priceUsd: usd, costUsd }];
    const efectivoUsd = (usd) => [{ methodId: 'efectivo_usd', methodLabel: 'Efectivo $', amount: usd, currency: 'USD', amountUsd: usd, amountBs: bs(usd) }];

    const ventaFiada = (id, usd, slot) => ({
        id, tipo: 'VENTA_FIADA', status: 'COMPLETADA', rate: RATE, timestamp: iso(slot),
        totalUsd: usd, totalBs: bs(usd), fiadoUsd: usd, payments: [],
        customerId: '${CLIENTE.id}', customerName: '${CLIENTE.name}',
        items: item('Harina E2E', usd, usd * 0.75), sellerName: 'E2E', saleNumber: 5000 + Math.round(usd),
    });

    const abono = (id, usd, slot) => ({
        id, tipo: 'COBRO_DEUDA', status: 'COMPLETADA', rate: RATE, timestamp: iso(slot),
        totalUsd: usd, totalBs: bs(usd), saldoFavorGeneradoUsd: 0, payments: efectivoUsd(usd),
        customerId: '${CLIENTE.id}', customerName: '${CLIENTE.name}',
        items: [{ id: null, name: 'Abono de deuda: ${CLIENTE.name}', qty: 1, priceUsd: usd, costBs: 0 }],
        sellerName: 'E2E', saleNumber: 6000 + Math.round(usd),
    });

    // Ledger consistente con la cartera: saldo inicial $15 (deuda previa) y luego
    // fiados/abonos hasta dejar el saldo en 0. Convención: negativo = debe.
    const mov = (id, type, direction, amountUsd, before, after, slot, reason) => ({
        id, customerId: '${CLIENTE.id}', type, direction, amountUsd, currency: 'USD',
        balanceBeforeUsd: before, balanceAfterUsd: after,
        sourceType: 'SALE', sourceId: null, sourceSaleId: null, paymentMethodId: null,
        reason, userId: 'E2E', userName: 'E2E', timestamp: iso(slot), status: 'COMPLETED',
    });

    const DATA = {
        'bodega_products_v1': ${JSON.stringify(TEST_PRODUCTS)},
        'bodega_customers_v1': ${JSON.stringify(customers)},
        'bodega_payment_methods_v1': ${JSON.stringify(TEST_PAYMENT_METHODS)},
        'bodega_customer_ledger_v1': [
            mov('led_0', 'SALDO_INICIAL_MIGRADO', 'DEBIT', 15, 0, -15, 0, 'Saldo inicial migrado'),
            mov('led_1', 'VENTA_FIADA', 'DEBIT', 4, -15, -19, 1, 'Venta fiada'),
            mov('led_2', 'VENTA_FIADA', 'DEBIT', 6, -19, -25, 2, 'Venta fiada'),
            mov('led_3', 'ABONO_DEUDA', 'CREDIT', 4, -25, -21, 3, 'Abono de deuda'),
            mov('led_4', 'ABONO_DEUDA', 'CREDIT', 6, -21, -15, 4, 'Abono de deuda'),
            mov('led_5', 'ABONO_DEUDA', 'CREDIT', 15, -15, 0, 5, 'Abono de deuda'),
        ],
        'bodega_sales_v1': [
            { id: 'apertura_rep_1', tipo: 'APERTURA_CAJA', openingUsd: 100, openingBs: bs(100), openingCop: 0, timestamp: todayAt(0, 1), cajaCerrada: false },
            ventaFiada('rep_fiado_1', 4, 1),
            ventaFiada('rep_fiado_2', 6, 2),
            abono('rep_cobro_1', 4, 3),
            abono('rep_cobro_2', 6, 4),
            abono('rep_cobro_3', 15, 5),
        ],
    };

    const existing = await indexedDB.databases?.().catch(() => []) || [];
    for (const db of existing) {
        if (db && db.name) indexedDB.deleteDatabase(db.name);
    }
    const req = indexedDB.open('BodegaApp', 1);
    req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('bodega_app_data')) db.createObjectStore('bodega_app_data');
    };
    await new Promise((resolve, reject) => {
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('bodega_app_data', 'readwrite');
            const store = tx.objectStore('bodega_app_data');
            for (const [key, value] of Object.entries(DATA)) store.put(value, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
    });
}
__seedReportes().catch(e => console.error('[e2e-seed-reportes] IndexedDB', e));
})();
`;
}

/**
 * Siembra el estado completo del escenario de reporte de fiados.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ customerDeudaUsd?: number }} [opts]
 */
export async function seedReportesFiado(page, { customerDeudaUsd = 0 } = {}) {
    await neutralizeExternalNetwork(page);
    await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
    await page.addInitScript(buildReportesSeedSnippet({ customerDeudaUsd }));
}
