// tests/granelSaleVoidE2E.test.js — Test E2E de integración GRANEL-001.
//
// Flujo completo sobre storage en memoria: venta de 0.350 kg de un producto a
// granel → deducción exacta de stock en checkout → anulación → restauración
// exacta al valor original. Verifica también la regla de integridad: los
// productos NO granel permanecen con stock entero estricto.
//
// Mocks copiados de tests/checkout.test.js (mismo patrón del repo).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (copiados de tests/checkout.test.js, deben ir arriba del todo) ──
const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'test-user', nombre: 'Tester', rol: 'ADMIN' } }) },
}));

import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { storageService } from '../src/utils/storageService';

const SALES_KEY = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

// Producto a granel: Queso Blanco, 55.5 kg de stock inicial.
const GRANEL_PRODUCT = {
    id: 'queso-001',
    name: 'Queso Blanco',
    unit: 'kg',
    packagingType: 'granel',
    granelUnit: 'kg',
    stock: 55.5,
    priceUsdt: 5.0,
    priceUsd: 5.0,
    costUsd: 3.0,
    costBs: 0,
    isWeight: true,
};

// Producto NO granel: entero estricto.
const UNIT_PRODUCT = {
    id: 'refresco-001',
    name: 'Refresco',
    unit: 'unidad',
    packagingType: 'suelto',
    stock: 10,
    priceUsdt: 1.0,
    priceUsd: 1.0,
    costUsd: 0.5,
    costBs: 0,
    isWeight: false,
};

const INITIAL_STOCK = 55.5;

function resetMockStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    _memoryStore.set(PRODUCTS_KEY, [JSON.parse(JSON.stringify(GRANEL_PRODUCT))]);
    _memoryStore.set(SALES_KEY, []);
}

// Opts base para vender `qty` kg del queso a $5/kg, pago exacto, sin vuelto.
function granelSaleOpts(qty) {
    return {
        cart: [{
            id: 'queso-001',
            _originalId: 'queso-001',
            name: 'Queso Blanco',
            qty,
            priceUsd: 5.0,
            costUsd: 3.0,
            costBs: 0,
            isWeight: true,
        }],
        cartTotalUsd: qty * 5.0,
        cartTotalBs: qty * 5.0 * 40,
        cartSubtotalUsd: qty * 5.0,
        payments: [{ amountUsd: qty * 5.0, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
        changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
        selectedCustomerId: null,
        customers: [],
        products: [JSON.parse(JSON.stringify(GRANEL_PRODUCT))],
        effectiveRate: 40,
        tasaCop: 0,
        copEnabled: false,
        discountData: null,
        useAutoRate: false,
    };
}

beforeEach(() => resetMockStore());

// ════════════════════════════════════════════════════════════════════════
// GRANEL-001 — E2E: venta por peso → anulación → stock exacto
// ════════════════════════════════════════════════════════════════════════
describe('GRANEL-001 E2E: venta 0.350 kg + anulación restaura el stock exacto', () => {

    it('vende 0.350 kg de Queso Blanco, anula la venta y el stock vuelve a 55.5 exacto', async () => {
        // ── 1. Vender 0.350 kg ($5/kg × 0.350 = $1.75, pago exacto, sin vuelto) ──
        const saleResult = await processSaleTransaction(granelSaleOpts(0.350));
        expect(saleResult.success).toBe(true);

        // La venta registra el peso vendido
        expect(saleResult.sale.items[0].qty).toBe(0.350);

        // ── Verificar deducción exacta: 55.5 − 0.350 = 55.15 (3 decimales) ──
        const productsAfterSale = await storageService.getItem(PRODUCTS_KEY, []);
        const quesoAfterSale = productsAfterSale.find(p => p.id === 'queso-001');
        expect(quesoAfterSale.stock).toBe(55.15);
        // Sin artefactos IEEE-754: la serialización JSON del stock no debe tener deriva
        expect(JSON.stringify(quesoAfterSale.stock)).not.toMatch(/\d{7,}/);

        // El resultado de la transacción coincide con el storage persistido
        const quesoInResult = saleResult.updatedProducts.find(p => p.id === 'queso-001');
        expect(quesoInResult.stock).toBe(55.15);

        // La venta quedó persistida
        const salesAfterSale = await storageService.getItem(SALES_KEY, []);
        expect(salesAfterSale).toHaveLength(1);
        expect(salesAfterSale[0].id).toBe(saleResult.sale.id);

        // ── 2. Anular la venta ──
        await processVoidSale(saleResult.sale, salesAfterSale, productsAfterSale);

        // ── 3. El stock vuelve EXACTAMENTE al valor original ──
        const productsAfterVoid = await storageService.getItem(PRODUCTS_KEY, []);
        const quesoAfterVoid = productsAfterVoid.find(p => p.id === 'queso-001');
        expect(quesoAfterVoid.stock).toBe(INITIAL_STOCK); // 55.5 exacto
        // Comparación bit a bit: (55.5 − 0.35 + 0.35) === 55.5
        expect(quesoAfterVoid.stock).toBe(55.5 - 0.350 + 0.350);

        // La venta queda marcada como ANULADA y no genera doble restauración
        const salesAfterVoid = await storageService.getItem(SALES_KEY, []);
        expect(salesAfterVoid[0].status).toBe('ANULADA');
        expect(salesAfterVoid).toHaveLength(1);
    });

    it('vende 0.125 kg (tercer decimal) y lo anula sin perder el tercer decimal', async () => {
        // Este caso es el que rompía el código anterior: subR/sumR redondeaban a
        // 2 decimales y el stock quedaba en 55.37/55.38 en lugar de 55.375.
        const saleResult = await processSaleTransaction(granelSaleOpts(0.125));
        expect(saleResult.success).toBe(true);

        const productsAfterSale = await storageService.getItem(PRODUCTS_KEY, []);
        const quesoAfterSale = productsAfterSale.find(p => p.id === 'queso-001');
        expect(quesoAfterSale.stock).toBe(55.375);

        const sales = await storageService.getItem(SALES_KEY, []);
        await processVoidSale(saleResult.sale, sales, productsAfterSale);

        const productsAfterVoid = await storageService.getItem(PRODUCTS_KEY, []);
        const quesoAfterVoid = productsAfterVoid.find(p => p.id === 'queso-001');
        expect(quesoAfterVoid.stock).toBe(INITIAL_STOCK); // 55.5 exacto, tercer decimal intacto
    });

    it('un producto NO granel mantiene entero estricto en venta y anulación', async () => {
        // Regla de integridad: solo granel acepta decimales.
        _memoryStore.set(PRODUCTS_KEY, [
            JSON.parse(JSON.stringify(GRANEL_PRODUCT)),
            JSON.parse(JSON.stringify(UNIT_PRODUCT)),
        ]);

        const saleOpts = {
            cart: [{
                id: 'refresco-001',
                _originalId: 'refresco-001',
                name: 'Refresco',
                qty: 2.9, // decimal ilícito para un producto por unidad: debe redondearse
                priceUsd: 1.0,
                costUsd: 0.8,
                costBs: 0,
                isWeight: false,
            }],
            cartTotalUsd: 3,
            cartTotalBs: 120,
            cartSubtotalUsd: 3,
            payments: [{ amountUsd: 3, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [
                JSON.parse(JSON.stringify(GRANEL_PRODUCT)),
                JSON.parse(JSON.stringify(UNIT_PRODUCT)),
            ],
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };

        const result = await processSaleTransaction(saleOpts);
        expect(result.success).toBe(true);

        // Deducción entera: round0(10 − 2.9) = round0(7.1) = 7
        const products = await storageService.getItem(PRODUCTS_KEY, []);
        const refrescoAfter = products.find(p => p.id === 'refresco-001');
        expect(refrescoAfter.stock).toBe(7);
        // El queso NO se ve afectado por la venta del refresco
        expect(products.find(p => p.id === 'queso-001').stock).toBe(55.5);

        // ── Anulación: restaura entero estricto (7 + 2.9 → 10) ──
        const sales = await storageService.getItem(SALES_KEY, []);
        await processVoidSale(result.sale, sales, products);

        const productsAfterVoid = await storageService.getItem(PRODUCTS_KEY, []);
        const refrescoAfterVoid = productsAfterVoid.find(p => p.id === 'refresco-001');
        expect(refrescoAfterVoid.stock).toBe(10);
    });

    it('la restauración tras anulación no genera drift flotante acumulado', async () => {
        // Tres ciclos completos de venta + anulación sobre el mismo stock inicial.
        for (let cycle = 0; cycle < 3; cycle++) {
            const productsBefore = await storageService.getItem(PRODUCTS_KEY, []);
            const stockBefore = productsBefore.find(p => p.id === 'queso-001').stock;

            const saleResult = await processSaleTransaction(granelSaleOpts(0.350));
            expect(saleResult.success).toBe(true);

            const sales = await storageService.getItem(SALES_KEY, []);
            await processVoidSale(saleResult.sale, sales, await storageService.getItem(PRODUCTS_KEY, []));

            const productsAfter = await storageService.getItem(PRODUCTS_KEY, []);
            const stockAfter = productsAfter.find(p => p.id === 'queso-001').stock;
            expect(stockAfter).toBe(stockBefore); // exacto, ciclo tras ciclo
        }
    });

    it('vender más de una línea del mismo producto (dos pesos) deduce la suma exacta', async () => {
        // Dos renglones del mismo granel en el mismo carrito: 0.100 + 0.250 = 0.350 kg.
        const opts = granelSaleOpts(0.100);
        opts.cart.push({
            id: 'queso-001',
            _originalId: 'queso-001',
            name: 'Queso Blanco',
            qty: 0.250,
            priceUsd: 5.0,
            costUsd: 3.0,
            costBs: 0,
            isWeight: true,
        });
        opts.cartTotalUsd = 0.350 * 5.0;
        opts.cartTotalBs = 0.350 * 5.0 * 40;
        opts.cartSubtotalUsd = 0.350 * 5.0;
        opts.payments = [{ amountUsd: 1.75, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }];

        const saleResult = await processSaleTransaction(opts);
        expect(saleResult.success).toBe(true);

        const products = await storageService.getItem(PRODUCTS_KEY, []);
        expect(products.find(p => p.id === 'queso-001').stock).toBe(55.15); // 55.5 − 0.350
    });
});
