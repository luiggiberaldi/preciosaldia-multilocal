// tests/checkout.test.js — Tests para src/utils/checkoutProcessor.js
// Cubre los fixes FIN-034 (doble conteo de vuelto), FIN-035 (vuelto en Cashea),
// FIN-036 (auditoría con total dinámico) y FIN-037 (cliente fresco).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (copiados de tests/financialEngine.test.js, deben ir arriba del todo) ──
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
import { calculateChangeRemainder } from '../src/utils/dinero';
import { shouldShowWalletSection } from '../src/components/Sales/CheckoutModalPOS/components/WalletSection';
import { storageService } from '../src/utils/storageService';
import { logEvent } from '../src/services/auditService';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

function resetMockStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    logEvent.mockClear();
}

// Opts base: venta de $10 a tasa 40. Sobreescribe lo que necesites por test.
function baseOpts(over = {}) {
    return {
        cart: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
        cartTotalUsd: 10,
        cartTotalBs: 400,
        cartSubtotalUsd: 10,
        payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
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

beforeEach(() => resetMockStore());

// ════════════════════════════════════════════════════════════════════════
// FIN-034 — El vuelto declarado nunca puede superar el vuelto real
// ════════════════════════════════════════════════════════════════════════
describe('FIN-034: normalización del vuelto', () => {

    it('NO duplica el vuelto cuando la UI declara el mismo monto en USD y en Bs', async () => {
        // Venta $10, paga con $20 → vuelto real = $10 (o 400 Bs). NUNCA ambos.
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 20, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 400 },
        }));

        expect(result.success).toBe(true);
        // El valor total del vuelto entregado, expresado en USD, no puede pasar de $10.
        const vueltoTotalUsd = result.sale.changeUsd + (result.sale.changeBs / 40);
        expect(vueltoTotalUsd).toBeLessThanOrEqual(10.01);
        // Política: se prioriza el tramo en Bs (es el que el operador escribe explícito).
        expect(result.sale.changeBs).toBe(400);
        expect(result.sale.changeUsd).toBe(0);
    });

    it('REGRESIÓN: un desglose de vuelto válido se persiste intacto', async () => {
        // Venta $10, paga $20, entrega $4 en efectivo USD + 240 Bs ($6). Total $10. Válido.
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 20, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 4, changeBsGiven: 240 },
        }));

        expect(result.success).toBe(true);
        expect(result.sale.changeUsd).toBe(4);
        expect(result.sale.changeBs).toBe(240);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-035 — Una venta Cashea con sobrepago sí registra su vuelto
// ════════════════════════════════════════════════════════════════════════
describe('FIN-035: vuelto en ventas Cashea', () => {

    it('conserva el vuelto de la cuota inicial en una VENTA_CASHEA', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }]);

        // Venta $100. Cashea remesa $60, el cliente paga $50 en efectivo → vuelto $10.
        const result = await processSaleTransaction(baseOpts({
            cart: [{ id: 'p1', name: 'Harina', qty: 10, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
            cartTotalUsd: 100,
            cartTotalBs: 4000,
            cartSubtotalUsd: 100,
            payments: [
                { amountUsd: 50, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' },
                { amountUsd: 60, amountBs: 2400, currency: 'USD', methodId: 'cashea', methodLabel: 'Cashea' },
            ],
            changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_CASHEA');
        // El vuelto de la cuota inicial es dinero real que salió de la caja.
        expect(result.sale.changeUsd).toBe(10);
    });

    it('REGRESIÓN: una VENTA_FIADA no registra vuelto', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }]);

        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 4, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_FIADA');
        expect(result.sale.changeUsd).toBe(0);
        expect(result.sale.changeBs).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-036 — La auditoría reporta el mismo total que la venta persistida
// ════════════════════════════════════════════════════════════════════════
describe('FIN-036: coherencia entre auditoría y venta', () => {

    it('el log de auditoría usa el total dinámico, no el prop crudo', async () => {
        _memoryStore.set(CUSTOMERS_KEY, []);

        // Item con doble precio: $10 en USD, pero $11 de referencia si se paga en Bs.
        const result = await processSaleTransaction(baseOpts({
            cart: [{
                id: 'p1', name: 'Harina', qty: 1,
                priceUsd: 10, priceBsUsdRef: 11, pricingMode: 'dual_usd',
                costUsd: 4, costBs: 0, isWeight: false,
            }],
            cartTotalUsd: 10,
            cartTotalBs: 400,
            cartSubtotalUsd: 10,
            // Pago en Bs → el motor recalcula el total a $11 / 440 Bs.
            payments: [{ amountUsd: 11, amountBs: 440, currency: 'BS', methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs' }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.totalUsd).toBe(11);

        // El 5º argumento de logEvent es el objeto de metadata { saleId, total, items }.
        const meta = logEvent.mock.calls[0][4];
        expect(meta.total).toBe(result.sale.totalUsd);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-037 — El saldo del cliente se lee fresco del storage
// ════════════════════════════════════════════════════════════════════════
describe('FIN-037: cliente leído fresco dentro del lock', () => {

    it('parte de la deuda persistida, no de la del prop obsoleto', async () => {
        // Verdad en storage: Ana ya debe $5.
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 5, favor: 0 }]);

        // El prop que llega desde React está desactualizado (deuda 0).
        const result = await processSaleTransaction(baseOpts({
            payments: [],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_FIADA');

        const persisted = _memoryStore.get(CUSTOMERS_KEY).find(c => c.id === 'c1');
        // 5 previos + 10 de esta venta = 15. Si sale 10, se perdió deuda.
        expect(persisted.deuda).toBe(15);
    });
});

// ════════════════════════════════════════════════════════════════════════
// CARTERA — el modo Crédito nunca absorbe un sobrepago
// ════════════════════════════════════════════════════════════════════════
describe('Cartera: validación de sobrepago en venta fiada', () => {
    it('bloquea una venta fiada de $4.80 cuando se ingresan $10', async () => {
        const customer = { id: 'c-credit', name: 'Chaylin', deuda: 0, favor: 0 };
        const result = await processSaleTransaction(baseOpts({
            cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 4.8, costUsd: 2, costBs: 0, isWeight: false }],
            cartTotalUsd: 4.8,
            cartTotalBs: 192,
            cartSubtotalUsd: 4.8,
            payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { esCredito: true },
            selectedCustomerId: customer.id,
            customers: [customer],
        }));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/excede la venta/i);
        expect(_memoryStore.get(SALES_KEY)).toBeUndefined();
        expect(_memoryStore.get(CUSTOMERS_KEY)).toBeUndefined();
    });

    it('permite pago parcial en Crédito y registra únicamente el restante como fiado', async () => {
        const customer = { id: 'c-partial', name: 'Ana', deuda: 0, favor: 0 };
        const result = await processSaleTransaction(baseOpts({
            cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 10, costUsd: 2, costBs: 0, isWeight: false }],
            payments: [{ amountUsd: 4, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { esCredito: true },
            selectedCustomerId: customer.id,
            customers: [customer],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_FIADA');
        expect(result.sale.fiadoUsd).toBe(6);
        expect(_memoryStore.get(CUSTOMERS_KEY)[0]).toMatchObject({ deuda: 6, favor: 0 });
    });
});

// ════════════════════════════════════════════════════════════════════════
// AVISO-CARTERA (H2, auditoría E2E) — la venta congela la cartera previa para
// que el recibo pueda explicar el consumo de saldo a favor.
// ════════════════════════════════════════════════════════════════════════
describe('AVISO-CARTERA: snapshot de cartera previa en la venta', () => {
    const baseFavor = { id: 'c-favor', name: 'Juan', deuda: 0, favor: 18.5 };

    it('fiado total con favor: congela favorAntes/deudaAntes y consume el favor', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ ...baseFavor }]);
        const result = await processSaleTransaction(baseOpts({
            cart: [{ id: 'p1', name: 'Prestobarba', qty: 1, priceUsd: 3, costUsd: 1, costBs: 0, isWeight: false }],
            cartTotalUsd: 3,
            cartTotalBs: 120,
            cartSubtotalUsd: 3,
            payments: [],
            changeBreakdown: { esCredito: true },
            selectedCustomerId: baseFavor.id,
            customers: [{ ...baseFavor }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_FIADA');
        expect(result.sale.walletSnapshot).toEqual({ favorAntes: 18.5, deudaAntes: 0 });
        // Semántica de cartera neta: el fiado consumió el favor, la deuda no aumenta.
        expect(_memoryStore.get(CUSTOMERS_KEY)[0]).toMatchObject({ deuda: 0, favor: 15.5 });
    });

    it('fiado parcialmente cubierto: el snapshot conserva ambos componentes', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c-favor', name: 'Juan', deuda: 0, favor: 2 }]);
        const result = await processSaleTransaction(baseOpts({
            cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 5, costUsd: 2, costBs: 0, isWeight: false }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            payments: [],
            changeBreakdown: { esCredito: true },
            selectedCustomerId: 'c-favor',
            customers: [{ id: 'c-favor', name: 'Juan', deuda: 0, favor: 2 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.walletSnapshot).toEqual({ favorAntes: 2, deudaAntes: 0 });
        // Cartera neta: el favor se agota ($2) y el resto queda como deuda ($3).
        expect(_memoryStore.get(CUSTOMERS_KEY)[0]).toMatchObject({ deuda: 3, favor: 0 });
    });

    it('venta cobrada a cliente con favor: snapshot presente aunque no se use', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c-favor', name: 'Juan', deuda: 0, favor: 18.5 }]);
        const result = await processSaleTransaction(baseOpts({
            selectedCustomerId: 'c-favor',
            customers: [{ id: 'c-favor', name: 'Juan', deuda: 0, favor: 18.5 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA');
        expect(result.sale.walletSnapshot).toEqual({ favorAntes: 18.5, deudaAntes: 0 });
        expect(_memoryStore.get(CUSTOMERS_KEY)[0]).toMatchObject({ favor: 18.5 });
    });

    it('venta sin cliente: no hay snapshot', async () => {
        const result = await processSaleTransaction(baseOpts({}));
        expect(result.success).toBe(true);
        expect(result.sale.walletSnapshot).toBeUndefined();
    });
});

describe('Cambio parcial dejado en caja', () => {
    const customer = { id: 'c-change', name: 'Ana', deuda: 0, favor: 0 };

    it('divide el vuelto entre caja y entrega física sin crear saldo a favor', async () => {
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            changeBreakdown: {
                changeUsdGiven: 3,
                changeBsGiven: 0,
                tipDonated: { amountUsd: 2, currency: 'USD' },
            },
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipDonated).toMatchObject({ amountUsd: 2, currency: 'USD' });
        expect(result.sale.changeUsd).toBe(3);
        expect(result.sale.vueltoParaMonedero).toBe(0);
        expect(result.sale.changeAllocation).toMatchObject({
            totalUsd: 5,
            keptInCashUsd: 2,
            deliveredUsd: 3,
            creditedUsd: 0,
        });
    });

    it('divide el vuelto entre caja y billetera cuando se acredita el resto', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [customer]);
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                vueltoCredito: true,
                tipDonated: { amountUsd: 2, currency: 'USD' },
            },
            selectedCustomerId: customer.id,
            customers: [customer],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.changeUsd).toBe(0);
        expect(result.sale.vueltoParaMonedero).toBe(3);
        expect(result.sale.changeAllocation).toMatchObject({ keptInCashUsd: 2, creditedUsd: 3 });
        expect(_memoryStore.get(CUSTOMERS_KEY)[0].favor).toBe(3);
    });

    it('combina caja, vuelto físico en Bs y billetera sin superar el vuelto real', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [customer]);
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            changeBreakdown: {
                changeUsdGiven: 1,
                changeBsGiven: 40,
                vueltoCredito: true,
                tipDonated: { amountUsd: 1, currency: 'USD' },
            },
            selectedCustomerId: customer.id,
            customers: [customer],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.changeUsd).toBe(1);
        expect(result.sale.changeBs).toBe(40);
        expect(result.sale.vueltoParaMonedero).toBe(2);
        expect(result.sale.changeAllocation).toMatchObject({
            totalUsd: 5,
            keptInCashUsd: 1,
            deliveredUsd: 1,
            deliveredBs: 40,
            creditedUsd: 2,
        });
    });

    it('entrega $1.88 y acredita exactamente $7.00 del vuelto restante', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [customer]);
        const result = await processSaleTransaction(baseOpts({
            cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 1.12, costUsd: 0.5, costBs: 0, isWeight: false }],
            cartTotalUsd: 1.12,
            cartTotalBs: 952,
            cartSubtotalUsd: 1.12,
            payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 1.88, changeBsGiven: 0, vueltoCredito: true },
            selectedCustomerId: customer.id,
            customers: [customer],
            effectiveRate: 850,
        }));

        expect(result.success).toBe(true);
        expect(result.sale.changeUsd).toBe(1.88);
        expect(result.sale.vueltoParaMonedero).toBe(7);
        expect(result.sale.changeAllocation).toMatchObject({ deliveredUsd: 1.88, creditedUsd: 7 });
        expect(_memoryStore.get(CUSTOMERS_KEY)[0].favor).toBe(7);
    });
});

describe('Remanente de cambio entre USD y Bs', () => {
    it('convierte a Bs el remanente cuando se declara cambio en USD', () => {
        expect(calculateChangeRemainder(2.88, 1, 0, 724)).toEqual({
            remainingUsd: 1.88,
            remainingBs: 1361.12,
            givenUsd: 1,
        });
    });

    it('convierte a USD el remanente cuando se declara cambio en Bs', () => {
        expect(calculateChangeRemainder(2.88, 0, 100, 724)).toEqual({
            remainingUsd: 2.74,
            remainingBs: 1983.76,
            givenUsd: 0.14,
        });
    });

    it('combina USD y Bs sin duplicar el mismo vuelto', () => {
        expect(calculateChangeRemainder(8.88, 1.88, 100, 850)).toMatchObject({
            remainingUsd: 6.88,
            remainingBs: 5848,
        });
    });

    it('nunca permite que una combinación sobreasignada produzca remanente negativo', () => {
        expect(calculateChangeRemainder(2.88, 2, 2085, 724)).toMatchObject({
            remainingUsd: 0,
            remainingBs: 0,
        });
    });
});

describe('Visibilidad inteligente de saldo a favor', () => {
    it('oculta el método cuando el pago ya cubre o supera la venta', () => {
        expect(shouldShowWalletSection({ saldoDisponible: 2.76, faltaSinSaldo: 0, saldoAplicado: 0 })).toBe(false);
    });

    it('lo muestra cuando todavía falta pagar y hay saldo disponible', () => {
        expect(shouldShowWalletSection({ saldoDisponible: 2.76, faltaSinSaldo: 2, saldoAplicado: 0 })).toBe(true);
    });

    it('mantiene el bloque si ya había saldo aplicado para poder editarlo', () => {
        expect(shouldShowWalletSection({ saldoDisponible: 2.76, faltaSinSaldo: 0, saldoAplicado: 1 })).toBe(true);
    });
});
