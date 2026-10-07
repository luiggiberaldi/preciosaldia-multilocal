// tests/tipDonated.test.js — Propina donada ("Cliente deja el cambio").
// Cubre TIP-001 a TIP-006. Ver PLAN-VUELTO-DONADO.md.
//
// ALCANCE: capas puras (checkoutProcessor + FinancialEngine).
// La UI (CheckoutModalPOS, PaymentLeftColumn, CheckoutModal) NO se testea aquí:
// @testing-library no es dependencia del proyecto. Se valida con el checklist manual.

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
import { FinancialEngine } from '../src/core/FinancialEngine';
import { storageService } from '../src/utils/storageService';
import { logEvent } from '../src/services/auditService';

const SALES_KEY = 'bodega_sales_v1';

function resetMockStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    logEvent.mockClear();
}

// Venta de $10 a tasa 40, pagada con $15 en efectivo USD → vuelto real $5.
function baseOpts(over = {}) {
    return {
        cart: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
        cartTotalUsd: 10,
        cartTotalBs: 400,
        cartSubtotalUsd: 10,
        payments: [{ amountUsd: 15, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
        changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
        selectedCustomerId: null,
        customers: [],
        products: [{ id: 'p1', name: 'Harina', stock: 50, costUsd: 4 }],
        effectiveRate: 40,
        tasaCop: 0,
        copEnabled: false,
        discountData: null,
        useAutoRate: false,
        ...over,
    };
}

async function persistedSale() {
    const sales = _memoryStore.get(SALES_KEY) || [];
    return sales[0];
}

beforeEach(() => resetMockStore());

// ════════════════════════════════════════════════════════════════════════
// TIP-001 — La propina se guarda en UNA sola moneda (corrige T-1)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-001: una sola moneda canónica', () => {

    it('propina en USD: amountUsd = 5, amountBs = 0', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 5, amountBs: 200, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipDonated).toBeTruthy();
        expect(sale.tipDonated.currency).toBe('USD');
        expect(sale.tipDonated.amountUsd).toBe(5);
        // amountBs debe quedar en 0: la moneda canónica es USD.
        expect(sale.tipDonated.amountBs).toBe(0);
    });

    it('propina en BS: amountUsd = 5 (canónico) y amountBs = 200 (nativo)', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 5, amountBs: 999999, currency: 'BS' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipDonated.currency).toBe('BS');
        expect(sale.tipDonated.amountUsd).toBe(5);
        // amountBs se RECALCULA desde amountUsd × tasa: no se confía en el input.
        expect(sale.tipDonated.amountBs).toBe(200);
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-002 — Propina donada ⟹ vuelto entregado 0 (D3)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-002: propina y vuelto son mutuamente excluyentes', () => {

    it('fuerza changeUsd/changeBs a 0 aunque la UI mande vuelto', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: {
                changeUsdGiven: 5,   // la UI se equivocó y mandó vuelto
                changeBsGiven: 0,
                tipDonated: { amountUsd: 5, amountBs: 0, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.changeUsd).toBe(0);
        expect(sale.changeBs).toBe(0);
        expect(sale.tipDonated.amountUsd).toBe(5);
    });

    it('sin propina, el vuelto se entrega normal', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: { changeUsdGiven: 5, changeBsGiven: 0 },
        }));
        const sale = await persistedSale();
        expect(sale.changeUsd).toBe(5);
        expect(sale.tipDonated).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-003 — Techo y saneamiento (corrige T-2 en la capa de datos)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-003: la propina nunca supera el vuelto real', () => {

    it('recorta una propina inflada al vuelto real ($5)', async () => {
        await processSaleTransaction(baseOpts({
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 500, amountBs: 0, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipDonated.amountUsd).toBe(5);
    });

    it('descarta una propina residual bajo el epsilon', async () => {
        await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 0.001, amountBs: 0, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipDonated).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-004 — VENTA_FIADA no admite propina (D4)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-004: incompatibilidad con venta fiada', () => {

    it('una VENTA_FIADA descarta la propina', async () => {
        await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 4, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Juan', balanceUsd: 0, saldoFavorUsd: 0 }],
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 3, amountBs: 0, currency: 'USD' },
            },
        }));
        const sale = await persistedSale();
        expect(sale.tipo).toBe('VENTA_FIADA');
        expect(sale.tipDonated).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-005 — Bucket del motor: forma estándar (corrige T-9)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-005: bucket _propina_* en calculatePaymentBreakdown', () => {

    const ventaConPropinaUsd = {
        id: 's1',
        tipo: 'VENTA',
        totalUsd: 10,
        totalBs: 400,
        rate: 40,
        changeUsd: 0,
        changeBs: 0,
        tipDonated: { amountUsd: 5, amountBs: 0, currency: 'USD' },
        payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 15, amountBs: 600 }],
    };

    it('crea _propina_usd con la forma { total, currency, label, isTip }', () => {
        const breakdown = FinancialEngine.calculatePaymentBreakdown([ventaConPropinaUsd]);
        const tip = breakdown['_propina_usd'];
        expect(tip).toBeTruthy();
        expect(tip.total).toBe(5);
        expect(tip.currency).toBe('USD');
        expect(tip.isTip).toBe(true);
        expect(typeof tip.label).toBe('string');
        // No debe existir un bucket en Bs para la MISMA propina.
        expect(breakdown['_propina_bs']).toBeUndefined();
    });

    it('crea _propina_bs cuando la moneda es BS, y no crea el de USD', () => {
        const ventaBs = {
            ...ventaConPropinaUsd,
            id: 's2',
            tipDonated: { amountUsd: 5, amountBs: 200, currency: 'BS' },
        };
        const breakdown = FinancialEngine.calculatePaymentBreakdown([ventaBs]);
        expect(breakdown['_propina_bs'].total).toBe(200);
        expect(breakdown['_propina_bs'].currency).toBe('BS');
        expect(breakdown['_propina_usd']).toBeUndefined();
    });

    it('acumula varias propinas en el mismo bucket', () => {
        const breakdown = FinancialEngine.calculatePaymentBreakdown([
            ventaConPropinaUsd,
            { ...ventaConPropinaUsd, id: 's3', tipDonated: { amountUsd: 2.5, amountBs: 0, currency: 'USD' } },
        ]);
        expect(breakdown['_propina_usd'].total).toBe(7.5);
    });

    it('no crea bucket cuando no hay propina', () => {
        const breakdown = FinancialEngine.calculatePaymentBreakdown([
            { ...ventaConPropinaUsd, id: 's4', tipDonated: null },
        ]);
        expect(breakdown['_propina_usd']).toBeUndefined();
        expect(breakdown['_propina_bs']).toBeUndefined();
    });
});

// ════════════════════════════════════════════════════════════════════════
// TIP-006 — La propina NO se resta ni se suma al efectivo (D1)
// ════════════════════════════════════════════════════════════════════════
describe('TIP-006: la propina no altera el efectivo esperado', () => {

    it('el bucket efectivo_usd es idéntico con y sin propina donada', () => {
        const base = {
            id: 'a', tipo: 'VENTA', totalUsd: 10, totalBs: 400, rate: 40,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 15, amountBs: 600 }],
        };
        // Caso A: vuelto entregado $5 → efectivo neto = 15 - 5 = 10
        const conVuelto = FinancialEngine.calculatePaymentBreakdown([
            { ...base, changeUsd: 5, changeBs: 0, tipDonated: null },
        ]);
        // Caso B: propina donada $5 → no hay vuelto, el efectivo se queda: 15
        const conPropina = FinancialEngine.calculatePaymentBreakdown([
            { ...base, changeUsd: 0, changeBs: 0, tipDonated: { amountUsd: 5, amountBs: 0, currency: 'USD' } },
        ]);

        expect(conVuelto['efectivo_usd'].total).toBe(15);
        expect(conVuelto['_vuelto_usd'].total).toBe(5);
        expect(conPropina['efectivo_usd'].total).toBe(15);
        // Con propina NO hay bucket de vuelto: nada se resta del cajón.
        expect(conPropina['_vuelto_usd']).toBeUndefined();
        // Y la propina no añade un ingreso extra: solo informa.
        expect(conPropina['_propina_usd'].isTip).toBe(true);
    });
});
