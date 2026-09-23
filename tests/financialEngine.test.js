// tests/financialEngine.test.js — Tests para src/core/FinancialEngine.js y voidSaleProcessor.js
// Cubre los fixes FIN-001 a FIN-012 del plan FIN-FIXES.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks de dependencias pesadas (storageService, auditService, useAuthStore) ──
// Must be at top level — hoisted before imports by vitest.

const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            // Clone to avoid sharing references with caller.
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

// ── Imports reales ──
import { FinancialEngine } from '../src/core/FinancialEngine';
import { deepFreeze, isDeepFrozen } from '../src/utils/deepFreeze';
import { round2, mulR, divR, sumR, subR } from '../src/utils/dinero';

// Importar DESPUÉS de mockear storageService para que el mock tenga efecto.
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { storageService } from '../src/utils/storageService';
import { logEvent } from '../src/services/auditService';

// ── Helper para resetear el mock store entre tests ──
function resetMockStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    logEvent.mockClear();
}

// ════════════════════════════════════════════════════════════════════════
// 1. calculatePaymentBreakdown
// ════════════════════════════════════════════════════════════════════════
describe('FinancialEngine.calculatePaymentBreakdown', () => {

    it('FIN-002: apertura COP entra al bucket efectivo_cop', () => {
        const apertura = {
            id: 'ap1',
            tipo: 'APERTURA_CAJA',
            openingUsd: 50,
            openingBs: 1000,
            openingCop: 50000,
            timestamp: new Date().toISOString(),
        };
        const breakdown = FinancialEngine.calculatePaymentBreakdown([apertura]);
        expect(breakdown['efectivo_usd'].total).toBe(50);
        expect(breakdown['efectivo_bs'].total).toBe(1000);
        // FIN-002: antes este bucket no existía. Ahora sí.
        expect(breakdown['efectivo_cop']).toBeDefined();
        expect(breakdown['efectivo_cop'].total).toBe(50000);
    });

    it('FIN-004: VENTA_FIADA usa sale.fiadoUsd (no totalUsd) y procesa pagos reales', () => {
        const sale = {
            id: 's1',
            tipo: 'VENTA_FIADA',
            status: 'COMPLETADA',
            totalUsd: 100,         // total venta
            totalBs: 58000,
            fiadoUsd: 30,          // solo 30 quedaron fiados; 70 pagados en efectivo
            rate: 580,
            payments: [
                { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 70, amountBs: 70 * 580, methodLabel: 'Efectivo $' },
            ],
            timestamp: new Date().toISOString(),
        };
        const breakdown = FinancialEngine.calculatePaymentBreakdown([sale]);
        // Bucket fiado debe tener el fiadoUsd (30), no el totalUsd (100).
        expect(breakdown['fiado'].total).toBe(30);
        // El pago real en efectivo_usd también debe registrarse (FIN-004: no hace return).
        expect(breakdown['efectivo_usd']).toBeDefined();
        expect(breakdown['efectivo_usd'].total).toBe(70);
    });

    it('FIN-005: anomalía de vuelto se devuelve en array (no muta sale)', () => {
        const sale = {
            id: 's2',
            tipo: 'VENTA',
            status: 'COMPLETADA',
            totalUsd: 10,
            totalBs: 5800,
            changeUsd: 600,   // 60x el total → anomalía clara
            changeBs: 0,
            rate: 580,
            payments: [
                { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 610, amountBs: 0, methodLabel: 'Efectivo $' },
            ],
            timestamp: new Date().toISOString(),
        };
        // Snapshot antes de calcular.
        const before = JSON.parse(JSON.stringify(sale));
        const result = FinancialEngine.calculatePaymentBreakdown([sale], { withAnomalies: true });
        // No debe mutar el sale.
        expect(sale).toEqual(before);
        // Debe devolver { breakdown, anomalies }.
        expect(result).toHaveProperty('breakdown');
        expect(result).toHaveProperty('anomalies');
        // Anomalía registrada.
        expect(result.anomalies.length).toBe(1);
        expect(result.anomalies[0].type).toBe('CHANGE_ANOMALY');
        expect(result.anomalies[0].saleId).toBe('s2');
        // Vuelto sigue sumado al bucket (no se zeroa).
        expect(result.breakdown['_vuelto_usd'].total).toBe(600);
    });

    it('FIN-003: venta legacy sin tasaCop no contabiliza COP con tasa=1', () => {
        const sale = {
            id: 's3',
            tipo: 'VENTA',
            status: 'COMPLETADA',
            totalUsd: 10,
            totalBs: 5800,
            rate: 580,
            // No tasaCop → antes: `mulR(amountUsd, (sale.tasaCop || 1))` = 10 COP (incorrecto).
            payments: [
                { methodId: 'efectivo_cop', currency: 'COP', amountUsd: 10, amountBs: 5800, amount: 40000, methodLabel: 'Efectivo COP' },
            ],
            timestamp: new Date().toISOString(),
        };
        const result = FinancialEngine.calculatePaymentBreakdown([sale], { withAnomalies: true });
        // Anomalía registrada.
        const tasaMissingAnomalies = result.anomalies.filter(a => a.type === 'TASA_COP_MISSING');
        expect(tasaMissingAnomalies.length).toBe(1);
        // El bucket COP no debe tener 10 (mal cálculo) sino 10 (USD fallback, no COP).
        // Para que el pago no "desaparezca" del flujo, se suma en USD al bucket.
        expect(result.breakdown['efectivo_cop'].total).toBe(10);
    });

    it('no anomalies en venta normal', () => {
        const sale = {
            id: 's4',
            tipo: 'VENTA',
            status: 'COMPLETADA',
            totalUsd: 50,
            totalBs: 29000,
            changeUsd: 5,
            changeBs: 0,
            rate: 580,
            tasaCop: 4100,
            payments: [
                { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 55, amountBs: 55 * 580, methodLabel: 'Efectivo $' },
            ],
            timestamp: new Date().toISOString(),
        };
        const result = FinancialEngine.calculatePaymentBreakdown([sale], { withAnomalies: true });
        expect(result.anomalies.length).toBe(0);
        expect(result.breakdown['efectivo_usd'].total).toBe(55);
        expect(result.breakdown['_vuelto_usd'].total).toBe(5);
    });

    it('backward compat: sin opts devuelve solo el breakdown (no el wrapper)', () => {
        const sale = {
            id: 's5',
            tipo: 'VENTA',
            status: 'COMPLETADA',
            totalUsd: 50,
            totalBs: 29000,
            rate: 580,
            payments: [
                { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 50, amountBs: 50 * 580, methodLabel: 'Efectivo $' },
            ],
            timestamp: new Date().toISOString(),
        };
        const result = FinancialEngine.calculatePaymentBreakdown([sale]);
        // No debe tener .breakdown ni .anomalies — debe ser el breakdown directo.
        expect(result).not.toHaveProperty('breakdown');
        expect(result).toHaveProperty('efectivo_usd');
    });
});

// ════════════════════════════════════════════════════════════════════════
// 2. calculateSaleProfit
// ════════════════════════════════════════════════════════════════════════
describe('FinancialEngine.calculateSaleProfit — FIN-011 Map vs array', () => {

    const productsArray = [
        { id: 'p1', name: 'Coca 500ml', costUsd: 0.8, unitsPerPackage: 1 },
        { id: 'p2', name: 'Pan', costBs: 50, unitsPerPackage: 1 },
        { id: 'p3', name: 'Harina 1kg', costUsd: 1.2, unitsPerPackage: 1 },
    ];

    const sale = {
        id: 's6',
        rate: 580,
        items: [
            { id: 'p1', name: 'Coca 500ml', priceUsd: 1.5, qty: 2, costUsd: 0.8 },       // costo explícito
            { id: 'p2', name: 'Pan',       priceUsd: 0.5, qty: 4, costBs: 50 },          // costoBs explícito
            { id: 'p3', name: 'Harina 1kg', priceUsd: 2.0, qty: 1 },                      // sin costo → fallback al catálogo
        ],
        discountAmountUsd: 0,
    };

    it('funciona con array (construye Map internamente)', () => {
        const profit = FinancialEngine.calculateSaleProfit(sale, 580, productsArray);
        // Cálculo esperado:
        // item1: revenue = 1.5*2*580 = 1740; cost = 0.8*580*2 = 928; profit = 812
        // item2: revenue = 0.5*4*580 = 1160; cost = 50*4 = 200; profit = 960
        // item3: revenue = 2.0*1*580 = 1160; cost = 1.2*580*1 = 696; profit = 464
        // total = 812 + 960 + 464 = 2236
        expect(profit).toBe(2236);
    });

    it('funciona con Map pre-construido (4to arg) — mismo resultado', () => {
        const pMap = new Map();
        for (const p of productsArray) {
            pMap.set(p.id, p);
            pMap.set(p.name, p);
        }
        const profitWithMap = FinancialEngine.calculateSaleProfit(sale, 580, productsArray, pMap);
        const profitWithArray = FinancialEngine.calculateSaleProfit(sale, 580, productsArray);
        expect(profitWithMap).toBe(profitWithArray);
        expect(profitWithMap).toBe(2236);
    });

    it('calculateAggregateProfit construye el Map una sola vez (mismo resultado que llamada a llamada)', () => {
        const sales = [sale, { ...sale, id: 's7' }];
        const total = FinancialEngine.calculateAggregateProfit(sales, 580, productsArray);
        // Dos veces la misma venta → 2 * 2236 = 4472.
        expect(total).toBe(4472);
    });

    it('sin items → 0', () => {
        expect(FinancialEngine.calculateSaleProfit({ items: [] }, 580, productsArray)).toBe(0);
        expect(FinancialEngine.calculateSaleProfit(null, 580, productsArray)).toBe(0);
    });

    it('item con id _unit: divide cost por unitsPerPackage', () => {
        const productsWithLote = [
            { id: 'pLote', name: 'Caja Coca 12u', costUsd: 9.6, unitsPerPackage: 12 },
        ];
        const saleUnit = {
            id: 's8',
            rate: 580,
            items: [
                { id: 'pLote_unit', name: 'Caja Coca 12u', priceUsd: 1.5, qty: 1, _originalId: 'pLote' },
            ],
            discountAmountUsd: 0,
        };
        const profit = FinancialEngine.calculateSaleProfit(saleUnit, 580, productsWithLote);
        // cost unit = 9.6 / 12 = 0.8 USD → 0.8 * 580 = 464 Bs.
        // revenue = 1.5 * 1 * 580 = 870 Bs.
        // profit = 870 - 464 = 406 Bs.
        expect(profit).toBe(406);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 3. buildCartTotals
// ════════════════════════════════════════════════════════════════════════
describe('FinancialEngine.buildCartTotals — FIN-010 unificación round2/divR', () => {

    const cartItems = [
        { priceUsd: 10, qty: 2 },    // 20 USD
        { priceUsd: 5.5, qty: 1 },   // 5.5 USD
    ];
    const bcvRate = 580;
    const copRate = 4100;

    it('sin descuento: total = subtotal', () => {
        const t = FinancialEngine.buildCartTotals(cartItems, { type: 'percentage', value: 0 }, bcvRate, copRate);
        expect(t.subtotalUsd).toBe(25.5);
        expect(t.discountAmountUsd).toBe(0);
        expect(t.totalUsd).toBe(25.5);
        expect(t.totalBs).toBe(mulR(25.5, 580));
        // COP sin priceCop en items → fallback mulR(totalUsd, copRate).
        expect(t.totalCop).toBe(mulR(25.5, 4100));
    });

    it('descuento porcentual 10%', () => {
        const t = FinancialEngine.buildCartTotals(cartItems, { type: 'percentage', value: 10 }, bcvRate, copRate);
        // subtotal = 25.5, descuento 10% = 2.55
        expect(t.subtotalUsd).toBe(25.5);
        expect(t.discountAmountUsd).toBe(2.55);
        expect(t.totalUsd).toBe(round2(25.5 - 2.55));
        expect(t.totalBs).toBe(mulR(t.totalUsd, 580));
    });

    it('descuento fijo 5 USD', () => {
        const t = FinancialEngine.buildCartTotals(cartItems, { type: 'fixed', value: 5 }, bcvRate, copRate);
        expect(t.discountAmountUsd).toBe(5);
        expect(t.totalUsd).toBe(20.5);
    });

    it('COP con priceCop en todos los items usa descuento proporcional (divR + round2)', () => {
        const cartWithCop = [
            { priceUsd: 10, qty: 2, priceCop: 41000 },    // 82000 COP
            { priceUsd: 5.5, qty: 1, priceCop: 22550 },   // 22550 COP
        ];
        const discountData = { type: 'percentage', value: 10 }; // 10% off
        const t = FinancialEngine.buildCartTotals(cartWithCop, discountData, bcvRate, copRate);
        // subtotal COP = 82000 + 22550 = 104550
        // descuento = 10% = 10455
        // totalCop = 104550 - 10455 = 94095 (con round2 aplicado)
        const expectedSubtotalCop = sumR([mulR(41000, 2), mulR(22550, 1)]);
        const expectedDiscount = mulR(expectedSubtotalCop, subR(1, divR(t.discountAmountUsd, t.subtotalUsd)));
        expect(t.totalCop).toBe(round2(expectedDiscount));
    });

    it('COP sin priceCop usa mulR(totalUsd, copRate)', () => {
        const t = FinancialEngine.buildCartTotals(cartItems, { type: 'percentage', value: 0 }, bcvRate, copRate);
        expect(t.totalCop).toBe(mulR(t.totalUsd, copRate));
    });

    it('copRate = 0 → totalCop = 0', () => {
        const t = FinancialEngine.buildCartTotals(cartItems, null, bcvRate, 0);
        expect(t.totalCop).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 4. voidSaleProcessor revirtiendo COBRO_DEUDA (FIN-001)
// ════════════════════════════════════════════════════════════════════════
describe('processVoidSale — FIN-001 revierte COBRO_DEUDA', () => {

    beforeEach(() => {
        resetMockStore();
    });

    it('revierte abono que había reducido deuda (sin favor)', async () => {
        // Setup: cliente con deuda 100 (había 200, abonó 100 → quedó 100).
        const customer = { id: 'c1', name: 'Juan', deuda: 100, favor: 0 };
        const sale = {
            id: 'cobro1',
            tipo: 'COBRO_DEUDA',
            status: 'COMPLETADA',
            saleNumber: 1,
            totalUsd: 100,
            totalBs: 58000,
            customerId: 'c1',
            customerName: 'Juan',
            rate: 580,
            payments: [
                { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 100, methodLabel: 'Efectivo $' },
            ],
            items: [{ name: 'Abono de deuda: Juan', qty: 1, priceUsd: 100, costBs: 0 }],
            timestamp: new Date().toISOString(),
            vueltoParaMonedero: 100, // FIN-012: registrado en el sale
        };

        // Mock store: sales contiene el cobro, customers contiene al cliente con deuda 100.
        await storageService.setItem('bodega_sales_v1', [sale]);
        await storageService.setItem('bodega_customers_v1', [customer]);
        await storageService.setItem('bodega_products_v1', []);

        await processVoidSale(sale, [sale], []);

        // Verificar que el cliente quedó con deuda 200 (reversión completa).
        const [updatedCustomer] = await storageService.getItem('bodega_customers_v1', []);
        expect(updatedCustomer.deuda).toBe(200);
        expect(updatedCustomer.favor).toBe(0);

        // Verificar que la venta quedó ANULADA.
        const [updatedSale] = await storageService.getItem('bodega_sales_v1', []);
        expect(updatedSale.status).toBe('ANULADA');

        // FIN-032: el console.log fue reemplazado por logEvent.
        expect(logEvent).toHaveBeenCalledWith(
            'VENTA', 'VENTA_ANULADA',
            expect.any(String),
            expect.anything(),
            expect.objectContaining({ saleId: 'cobro1', tipo: 'COBRO_DEUDA' })
        );
    });

    it('revierte abono que había generado favor (cliente sin deuda)', async () => {
        // Setup: cliente con favor 50 (había 0, abonó 50 sin deuda previa → favor 50).
        const customer = { id: 'c2', name: 'Ana', deuda: 0, favor: 50 };
        const sale = {
            id: 'cobro2',
            tipo: 'COBRO_DEUDA',
            status: 'COMPLETADA',
            saleNumber: 2,
            totalUsd: 50,
            customerId: 'c2',
            customerName: 'Ana',
            rate: 580,
            payments: [
                { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 50, methodLabel: 'Efectivo $' },
            ],
            items: [{ name: 'Abono: Ana', qty: 1, priceUsd: 50, costBs: 0 }],
            timestamp: new Date().toISOString(),
            vueltoParaMonedero: 50,
        };

        await storageService.setItem('bodega_sales_v1', [sale]);
        await storageService.setItem('bodega_customers_v1', [customer]);
        await storageService.setItem('bodega_products_v1', []);

        await processVoidSale(sale, [sale], []);

        // FIN-001: el favor debe quedar en 0 (era 50, se revierte el abono).
        const [updatedCustomer] = await storageService.getItem('bodega_customers_v1', []);
        expect(updatedCustomer.favor).toBe(0);
        expect(updatedCustomer.deuda).toBe(0);
    });

    it('revierte VENTA_FIADA: quita deuda generada y favor usado', async () => {
        // Setup: cliente con deuda 50 (había 100, fiado 50 → 150... pero para simplificar:
        // cliente tenía 100, se le fió 50 → deuda 150; al anular, vuelve a 100).
        const customer = { id: 'c3', name: 'Pedro', deuda: 150, favor: 0 };
        const sale = {
            id: 'fiado1',
            tipo: 'VENTA_FIADA',
            status: 'COMPLETADA',
            saleNumber: 3,
            totalUsd: 50,
            totalBs: 29000,
            customerId: 'c3',
            customerName: 'Pedro',
            rate: 580,
            fiadoUsd: 50,
            payments: [],
            items: [{ id: 'p1', name: 'Item', qty: 1, priceUsd: 50, costBs: 0 }],
            timestamp: new Date().toISOString(),
            vueltoParaMonedero: 0,
        };

        await storageService.setItem('bodega_sales_v1', [sale]);
        await storageService.setItem('bodega_customers_v1', [customer]);
        await storageService.setItem('bodega_products_v1', [{ id: 'p1', name: 'Item', stock: 5 }]);

        await processVoidSale(sale, [sale], [{ id: 'p1', name: 'Item', stock: 5 }]);

        // FIN-001-pattern: la deuda vuelve al estado pre-fiado (150 - 50 = 100).
        const [updatedCustomer] = await storageService.getItem('bodega_customers_v1', []);
        expect(updatedCustomer.deuda).toBe(100);
        expect(updatedCustomer.favor).toBe(0);

        // FIN-027: stock restaurado (5 + 1 = 6).
        const [updatedProduct] = await storageService.getItem('bodega_products_v1', []);
        expect(updatedProduct.stock).toBe(6);
    });

    it('FIN-012: revierte vueltoParaMonedero de favor al anular VENTA', async () => {
        // Setup: venta normal donde el cliente sobre-pagó y 20 USD fueron a favor.
        const customer = { id: 'c4', name: 'Luis', deuda: 0, favor: 20 };
        const sale = {
            id: 'venta1',
            tipo: 'VENTA',
            status: 'COMPLETADA',
            saleNumber: 4,
            totalUsd: 80,
            totalBs: 46400,
            customerId: 'c4',
            customerName: 'Luis',
            rate: 580,
            fiadoUsd: 0,
            vueltoParaMonedero: 20, // FIN-012: 20 USD quedaron como favor
            payments: [
                { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 100, methodLabel: 'Efectivo $' },
            ],
            items: [{ id: 'p2', name: 'Item', qty: 1, priceUsd: 80, costBs: 0 }],
            timestamp: new Date().toISOString(),
        };

        await storageService.setItem('bodega_sales_v1', [sale]);
        await storageService.setItem('bodega_customers_v1', [customer]);
        await storageService.setItem('bodega_products_v1', [{ id: 'p2', name: 'Item', stock: 10 }]);

        await processVoidSale(sale, [sale], [{ id: 'p2', name: 'Item', stock: 10 }]);

        // FIN-012: el favor debe quedar en 0 (era 20, se revierte el vuelto digital).
        const [updatedCustomer] = await storageService.getItem('bodega_customers_v1', []);
        expect(updatedCustomer.favor).toBe(0);
        expect(updatedCustomer.deuda).toBe(0);
    });

    it('lanza error si la venta ya está ANULADA', async () => {
        const sale = { id: 'x1', status: 'ANULADA', tipo: 'VENTA', items: [], timestamp: new Date().toISOString() };
        await expect(processVoidSale(sale, [], [])).rejects.toThrow(/ya fue anulada/);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 5. deepFreeze aplicado a sales (FIN-008)
// ════════════════════════════════════════════════════════════════════════
describe('deepFreeze aplicado a sales — FIN-008', () => {

    it('mutar sale deep-frozen lanza TypeError en strict mode', () => {
        const sale = deepFreeze({
            id: 's1',
            items: [{ priceUsd: 10, qty: 2 }],
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20 }],
            customer: { name: 'Juan' },
        });
        // Top-level.
        expect(() => { sale.id = 'mutated'; }).toThrow(TypeError);
        // Nested en array.
        expect(() => { sale.items[0].priceUsd = 999; }).toThrow(TypeError);
        expect(() => { sale.items.push({}); }).toThrow(TypeError);
        // Nested en objeto.
        expect(() => { sale.customer.name = 'Hack'; }).toThrow(TypeError);
        // Array methods que mutan.
        expect(() => { sale.payments.push({}); }).toThrow(TypeError);
    });

    it('isDeepFrozen confirma congelación profunda', () => {
        const sale = deepFreeze({
            id: 's1',
            items: [{ priceUsd: 10 }],
            payments: [{ methodId: 'cash' }],
        });
        expect(isDeepFrozen(sale)).toBe(true);

        const shallow = { id: 's2', items: [{ priceUsd: 10 }] };
        Object.freeze(shallow); // shallow only
        expect(isDeepFrozen(shallow)).toBe(false);
    });

    it('deepFreeze en checkoutProcessor: sale persistida es deep-frozen', async () => {
        // Test integrado: el sale devuelto por processSaleTransaction debe ser deep-frozen.
        resetMockStore();

        const { processSaleTransaction } = await import('../src/utils/checkoutProcessor');

        const cart = [
            { id: 'p1', name: 'Coca', qty: 2, priceUsd: 1.5, costUsd: 0.8, costBs: 0, isWeight: false },
        ];
        const opts = {
            cart,
            cartTotalUsd: 3,
            cartTotalBs: 1740,    // 3 * 580
            cartSubtotalUsd: 3,
            payments: [{ amountUsd: 3, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [{ id: 'p1', name: 'Coca', stock: 10, costUsd: 0.8 }],
            effectiveRate: 580,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };

        const result = await processSaleTransaction(opts);
        expect(result.success).toBe(true);
        // FIN-008: sale deep-frozen.
        expect(isDeepFrozen(result.sale)).toBe(true);
        // Mutar items debe lanzar.
        expect(() => { result.sale.items[0].priceUsd = 999; }).toThrow(TypeError);
        // updatedProducts también deep-frozen.
        expect(isDeepFrozen(result.updatedProducts)).toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 6. procesarImpactoCliente (FIN-015) — round2 en operaciones intermedias
// ════════════════════════════════════════════════════════════════════════
describe('procesarImpactoCliente — FIN-015', () => {

    it('usa round2 en cada paso (no drift)', async () => {
        const { procesarImpactoCliente } = await import('../src/utils/financialLogic');

        // Caso: cliente con favor 0.10 y usa 0.10 → favor debe ser 0 (no -0.00000001).
        const cliente = { favor: 0.10, deuda: 0 };
        const result = procesarImpactoCliente(cliente, { usaSaldoFavor: 0.10 });
        expect(result.favor).toBe(0);
        expect(result.deuda).toBe(0);

        // Caso: deuda 100 + vuelto 33.33 que sobra → favor = 33.33 - 0 = 33.33 (si deuda == 0).
        const cliente2 = { favor: 0, deuda: 0 };
        const result2 = procesarImpactoCliente(cliente2, { vueltoParaMonedero: 33.33 });
        expect(result2.favor).toBe(33.33);
        expect(result2.deuda).toBe(0);

        // Caso: deuda 100, abono 130 → deuda 0, favor 30.
        const cliente3 = { favor: 0, deuda: 100 };
        const result3 = procesarImpactoCliente(cliente3, { vueltoParaMonedero: 130 });
        expect(result3.deuda).toBe(0);
        expect(result3.favor).toBe(30);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 7. FIN-007: withLock envolviendo escrituras — exclusión mutua en checkout
// ════════════════════════════════════════════════════════════════════════
describe('FIN-007: checkoutProcessor serializa ventas con withLock', () => {
    beforeEach(() => resetMockStore());

    it('dos ventas concurrentes obtienen saleNumbers distintos (no se pisan)', async () => {
        const { processSaleTransaction } = await import('../src/utils/checkoutProcessor');

        const cart = [{ id: 'p1', name: 'Coca', qty: 1, priceUsd: 1, costUsd: 0.5, costBs: 0, isWeight: false }];
        const baseOpts = {
            cart,
            cartTotalUsd: 1,
            cartTotalBs: 580,
            cartSubtotalUsd: 1,
            payments: [{ amountUsd: 1, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [{ id: 'p1', name: 'Coca', stock: 100, costUsd: 0.5 }],
            effectiveRate: 580,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };

        // Lanzar dos ventas en paralelo (sin await) — deben serializarse.
        const [r1, r2] = await Promise.all([
            processSaleTransaction(baseOpts),
            processSaleTransaction(baseOpts),
        ]);

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        // Los saleNumbers deben ser 1 y 2 (en cualquier orden, pero distintos).
        const nums = new Set([r1.sale.saleNumber, r2.sale.saleNumber]);
        expect(nums.size).toBe(2);
        expect(nums.has(1)).toBe(true);
        expect(nums.has(2)).toBe(true);
    });

    it('FIN-022: effectiveRate <= 0 rechaza la venta con error claro', async () => {
        const { processSaleTransaction } = await import('../src/utils/checkoutProcessor');
        const opts = {
            cart: [{ id: 'p1', name: 'X', qty: 1, priceUsd: 1, isWeight: false }],
            cartTotalUsd: 1, cartTotalBs: 580, cartSubtotalUsd: 1,
            payments: [{ amountUsd: 1, currency: 'USD', methodId: 'efectivo_usd', methodLabel: '$' }],
            changeBreakdown: {},
            selectedCustomerId: null, customers: [],
            products: [], effectiveRate: 0, tasaCop: 0, copEnabled: false,
            discountData: null, useAutoRate: false,
        };
        const r = await processSaleTransaction(opts);
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/tasa.*BCV.*inv/i);
    });

    it('FIN-022: drift entre cartTotalBs y cartTotalUsd*rate rechaza la venta', async () => {
        const { processSaleTransaction } = await import('../src/utils/checkoutProcessor');
        const opts = {
            cart: [{ id: 'p1', name: 'X', qty: 1, priceUsd: 10, isWeight: false }],
            cartTotalUsd: 10, cartTotalBs: 9999, // 10*580=5800, drift enorme
            cartSubtotalUsd: 10,
            payments: [{ amountUsd: 10, currency: 'USD', methodId: 'efectivo_usd', methodLabel: '$' }],
            changeBreakdown: {},
            selectedCustomerId: null, customers: [],
            products: [], effectiveRate: 580, tasaCop: 0, copEnabled: false,
            discountData: null, useAutoRate: false,
        };
        const r = await processSaleTransaction(opts);
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/inconsistencia/i);
    });

    it('FIN-005: bloquea venta con changeUsd > total*5 (anomalía de vuelto)', async () => {
        const { processSaleTransaction } = await import('../src/utils/checkoutProcessor');
        const opts = {
            cart: [{ id: 'p1', name: 'X', qty: 1, priceUsd: 10, isWeight: false }],
            cartTotalUsd: 10, cartTotalBs: 5800, cartSubtotalUsd: 10,
            // 600 USD pagados para venta de 10 → changeUsd = 590, que es > 50 (5x10) y > 100 (min).
            payments: [{ amountUsd: 600, currency: 'USD', methodId: 'efectivo_usd', methodLabel: '$' }],
            changeBreakdown: { changeUsdGiven: 590, changeBsGiven: 0 },
            selectedCustomerId: null, customers: [],
            products: [], effectiveRate: 580, tasaCop: 0, copEnabled: false,
            discountData: null, useAutoRate: false,
        };
        const r = await processSaleTransaction(opts);
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/anómalo/i);
    });

    it('FIN-014: audita uso de stock negativo cuando allow_negative_stock=true', async () => {
        // Setup: producto con stock 5, venta de 10 unidades → forzará stock negativo.
        localStorage.setItem('allow_negative_stock', 'true');
        try {
            const { processSaleTransaction } = await import('../src/utils/checkoutProcessor');
            const opts = {
                cart: [{ id: 'p1', name: 'X', qty: 10, priceUsd: 1, isWeight: false, _originalId: 'p1' }],
                cartTotalUsd: 10, cartTotalBs: 5800, cartSubtotalUsd: 10,
                payments: [{ amountUsd: 10, currency: 'USD', methodId: 'efectivo_usd', methodLabel: '$' }],
                changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
                selectedCustomerId: null, customers: [],
                products: [{ id: 'p1', name: 'X', stock: 5, costUsd: 0.5 }],
                effectiveRate: 580, tasaCop: 0, copEnabled: false,
                discountData: null, useAutoRate: false,
            };
            const r = await processSaleTransaction(opts);
            expect(r.success).toBe(true);
            // FIN-014: logEvent llamado con CONFIG/NEGATIVE_STOCK_USED.
            const negativeStockCall = logEvent.mock.calls.find(
                (c) => c[0] === 'CONFIG' && c[1] === 'NEGATIVE_STOCK_USED'
            );
            expect(negativeStockCall).toBeDefined();
            // Stock quedó en -5 (permitido por flag).
            expect(r.updatedProducts[0].stock).toBe(-5);
        } finally {
            localStorage.removeItem('allow_negative_stock');
        }
    });
});

// ════════════════════════════════════════════════════════════════════════
// 8. FIN-006: processCustomerTransaction usa withLock (exclusión mutua)
// ════════════════════════════════════════════════════════════════════════
describe('FIN-006: processCustomerTransaction serializa abonos con withLock', () => {
    beforeEach(() => resetMockStore());

    it('dos abonos concurrentes al mismo cliente obtienen saleNumbers distintos', async () => {
        const { processCustomerTransaction } = await import('../src/utils/customerTransactionProcessor');
        const customer = { id: 'c1', name: 'Juan', deuda: 100, favor: 0 };

        // Lanzar dos abonos en paralelo.
        const [r1, r2] = await Promise.all([
            processCustomerTransaction({
                transactionAmount: 10, currencyMode: 'USD', type: 'ABONO',
                customer, paymentMethod: 'efectivo_usd', bcvRate: 580, tasaCop: 0, copEnabled: false,
            }),
            processCustomerTransaction({
                transactionAmount: 20, currencyMode: 'USD', type: 'ABONO',
                customer, paymentMethod: 'efectivo_usd', bcvRate: 580, tasaCop: 0, copEnabled: false,
            }),
        ]);

        // Ambos deben completar sin error.
        expect(r1.error).toBeUndefined();
        expect(r2.error).toBeUndefined();

        // Verificar que se persistieron dos sales con saleNumbers distintos.
        const sales = await storageService.getItem('bodega_sales_v1', []);
        expect(sales.length).toBe(2);
        const nums = new Set(sales.map(s => s.saleNumber));
        expect(nums.size).toBe(2);
    });

    it('CREDITO manual genera VENTA_FIADA con fiadoUsd persistido', async () => {
        const { processCustomerTransaction } = await import('../src/utils/customerTransactionProcessor');
        const customer = { id: 'c2', name: 'Ana', deuda: 0, favor: 0 };
        const r = await processCustomerTransaction({
            transactionAmount: 50, currencyMode: 'USD', type: 'CREDITO',
            customer, paymentMethod: 'efectivo_usd', bcvRate: 580, tasaCop: 0, copEnabled: false,
        });
        expect(r.error).toBeUndefined();
        const sales = await storageService.getItem('bodega_sales_v1', []);
        expect(sales.length).toBe(1);
        expect(sales[0].tipo).toBe('VENTA_FIADA');
        expect(sales[0].fiadoUsd).toBe(50);
        // FIN-012: vueltoParaMonedero siempre presente (aunque sea 0).
        expect(sales[0]).toHaveProperty('vueltoParaMonedero', 0);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 9. FIN-027: voidSaleProcessor re-lee products fresco dentro del lock
// ════════════════════════════════════════════════════════════════════════
describe('FIN-027: voidSaleProcessor re-lee products fresco', () => {
    beforeEach(() => resetMockStore());

    it('no usa currentProducts stale si el storage tiene datos más frescos', async () => {
        // Setup: storage tiene el producto con stock actualizado (5),
        // pero currentProducts (pasado al processor) tiene stock stale (99).
        const sale = {
            id: 'v1', tipo: 'VENTA', status: 'COMPLETADA', saleNumber: 1,
            totalUsd: 10, totalBs: 5800, customerId: null, customerName: 'CF',
            rate: 580, items: [{ id: 'p1', name: 'X', qty: 1, priceUsd: 10, costBs: 0 }],
            timestamp: new Date().toISOString(),
        };
        await storageService.setItem('bodega_sales_v1', [sale]);
        await storageService.setItem('bodega_products_v1', [{ id: 'p1', name: 'X', stock: 5 }]);
        await storageService.setItem('bodega_customers_v1', []);

        // currentProducts stale con stock 99 — debe ser ignorado.
        const staleProducts = [{ id: 'p1', name: 'X', stock: 99 }];
        await processVoidSale(sale, [sale], staleProducts);

        // FIN-027: el stock restaurado debe basarse en el fresco (5) → 5 + 1 = 6.
        const [updatedProduct] = await storageService.getItem('bodega_products_v1', []);
        expect(updatedProduct.stock).toBe(6);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 10. FIN-018: reportsProcessor acumula revenue con round2 (no drift)
// ════════════════════════════════════════════════════════════════════════
describe('FIN-018: reportsProcessor acumula revenue con round2', () => {
    it('revenue total cuadra sin drift tras sumar muchos items', async () => {
        const { calculateReportsData } = await import('../src/utils/reportsProcessor');
        const { getLocalISODate } = await import('../src/utils/dateHelpers');
        const today = getLocalISODate(new Date());
        // 100 ventas del mismo item para forzar acumulación de drift.
        const sales = Array.from({ length: 100 }, (_, i) => ({
            id: `s${i}`,
            tipo: 'VENTA',
            status: 'COMPLETADA',
            timestamp: new Date().toISOString(),
            totalUsd: 0.10,
            totalBs: 58,
            items: [{ id: 'p1', name: 'Coca', priceUsd: 0.10, qty: 1 }],
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 0.10 }],
        }));
        const result = calculateReportsData(sales, today, today, 580, []);
        // 100 * 0.10 = 10.00 exactos (sin drift tipo 9.999999...).
        expect(result.totalUsd).toBe(10);
        // Top products con revenue acumulado correcto.
        expect(result.topProducts[0].revenue).toBe(10);
        expect(result.topProducts[0].qty).toBe(100);
    });
});
