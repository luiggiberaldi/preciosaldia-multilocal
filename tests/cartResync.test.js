/**
 * tests/cartResync.test.js — Re-sincronización viva cesta ↔ inventario (SYNC-CESTA-001).
 *
 * Matriz del PLAN-AVISO-REPRECIO-BS.md (Trabajo 2). Contrato central:
 * `resyncCartItems` devuelve `null` cuando NADA cambió — el caller no hace
 * setState y no hay loops de render.
 */

import { describe, it, expect } from 'vitest';
import {
    deriveCartFields,
    resyncCartItems,
    isSyntheticCartLine,
    cartLineName,
} from '../src/utils/cartSync.js';

const CTX = { tasaCop: 4000, effectiveRate: 850 };

function makeItem(product, overrides = {}) {
    return {
        ...product,
        id: product.id,
        name: product.name,
        ...deriveCartFields(product, overrides._mode || 'package', product.unitsPerPackage, CTX),
        qty: 1,
        isWeight: false,
        _originalId: product.id,
        _mode: 'package',
        _unitsPerPackage: 1,
        ...overrides,
    };
}

describe('SYNC-CESTA-001 · deriveCartFields (paridad con addToCart)', () => {
    it('precio USD simple y costo en Bs derivado de la tasa', () => {
        const f = deriveCartFields({ priceUsdt: 22, costUsd: 10 }, 'package', 1, CTX);
        expect(f.priceUsd).toBe(22);
        expect(f.priceCop).toBeNull();
        expect(f.costUsd).toBe(10);
        expect(f.costBs).toBe(8500); // costUsd × effectiveRate
    });

    it('precio COP manda cuando hay tasaCop', () => {
        const f = deriveCartFields({ priceUsdt: 5, priceCop: 48000 }, 'package', 1, CTX);
        expect(f.priceUsd).toBe(12); // 48000 / 4000
        expect(f.priceCop).toBe(48000);
    });

    it('modo unit deriva del bulto (unitPriceCop / unidades por empaque)', () => {
        const f = deriveCartFields(
            { priceUsdt: 2, priceCop: 48000, unitPriceCop: 2400, unitsPerPackage: 20, costUsd: 2 },
            'unit',
            20,
            CTX,
        );
        expect(f.priceUsd).toBeCloseTo(0.6, 10); // 2400 / 4000
        expect(f.priceCop).toBe(2400);
        expect(f.costUsd).toBeCloseTo(0.1, 10); // 2 / 20
    });
});

describe('SYNC-CESTA-001 · resyncCartItems — matriz del plan', () => {
    it('CASO DEL INCIDENTE: se quita el Doble Precio al producto → la línea deja de re-preciar en Bs', () => {
        const dual = { id: 'p1', name: 'Harina', priceUsdt: 22, pricingMode: 'dual_usd', priceBsUsdRef: 1.2, costUsd: 10, unitsPerPackage: 1 };
        const item = makeItem(dual);

        // En inventario ya se quitó el Doble Precio (modo tasa_dia, sin Ref).
        const product = { id: 'p1', name: 'Harina', priceUsdt: 22, pricingMode: 'tasa_dia', costUsd: 10, unitsPerPackage: 1 };

        const r = resyncCartItems([item], [product], CTX);
        expect(r).not.toBeNull();
        expect(r.cart[0].pricingMode).toBe('tasa_dia');
        expect(r.cart[0].priceBsUsdRef).toBeUndefined();
        expect(r.cart[0]._productMissing).toBeUndefined();
        expect(r.priceChanges).toHaveLength(0); // el precio USD no cambió: sin ruido
    });

    it('cambio de precio USD en inventario → se refleja y se reporta', () => {
        const product = { id: 'p1', name: 'Harina', priceUsdt: 22, priceUsd: 22, costUsd: 10, unitsPerPackage: 1 };
        const item = makeItem(product);

        const updated = { ...product, priceUsdt: 25 };
        const r = resyncCartItems([item], [updated], CTX);

        expect(r.cart[0].priceUsd).toBe(25);
        expect(r.priceChanges).toEqual([{ name: 'Harina', from: 22, to: 25 }]);
    });

    it('qty, modo de venta y peso NO se tocan aunque el producto mute', () => {
        const dual = { id: 'p1', name: 'Harina', priceUsdt: 22, pricingMode: 'dual_usd', priceBsUsdRef: 1.2, unitsPerPackage: 1 };
        const item = makeItem(dual, { qty: 3.5, isWeight: true, _originalId: 'p1' });

        const product = { id: 'p1', name: 'Harina', priceUsdt: 30, pricingMode: 'tasa_dia', unitsPerPackage: 1 };
        const r = resyncCartItems([item], [product], CTX);

        expect(r.cart[0].priceUsd).toBe(30); // pricing sí se refresca
        expect(r.cart[0].qty).toBe(3.5);
        expect(r.cart[0].isWeight).toBe(true);
        expect(r.cart[0]._mode).toBe('package');
        expect(r.cart[0]._unitsPerPackage).toBe(1);
    });

    it('producto eliminado del catálogo → marca _productMissing y conserva la línea', () => {
        const product = { id: 'p1', name: 'Harina', priceUsdt: 22, unitsPerPackage: 1 };
        const item = makeItem(product, { qty: 2 });

        const r = resyncCartItems([item], [{ id: 'otro', name: 'Otro', priceUsdt: 1 }], CTX);

        expect(r.cart[0]._productMissing).toBe(true);
        expect(r.cart[0].qty).toBe(2);
        expect(r.cart[0].priceUsd).toBe(22);
    });

    it('producto que vuelve al catálogo → se limpia _productMissing', () => {
        const product = { id: 'p1', name: 'Harina', priceUsdt: 22, unitsPerPackage: 1 };
        const item = makeItem(product);
        item._productMissing = true;

        const r = resyncCartItems([item], [product], CTX);
        expect(r.cart[0]._productMissing).toBeUndefined();
    });

    it('venta libre y avance de efectivo se ignoran (aunque no estén en el catálogo)', () => {
        const custom = { id: 'custom_123', name: 'Venta Libre', priceUsdt: 5, qty: 1, _originalId: 'custom_123', _mode: 'package' };
        const advance = { id: 'advance_9', name: 'Avance Efectivo (USD)', priceUsdt: 20, qty: 1, isCashAdvance: true, _mode: 'package' };

        const r = resyncCartItems([custom, advance], [{ id: 'p1', name: 'Harina', priceUsdt: 22 }], CTX);

        expect(r).toBeNull(); // nada que sincronizar, nada que marcar
        expect(isSyntheticCartLine(custom)).toBe(true);
        expect(isSyntheticCartLine(advance)).toBe(true);
    });

    it('CONTRATO ANTI-LOOP: sin cambios devuelve null', () => {
        const product = { id: 'p1', name: 'Harina', priceUsdt: 22, costUsd: 10, unitPriceCop: null, unitsPerPackage: 1 };
        const item = makeItem(product);
        expect(resyncCartItems([item], [product], CTX)).toBeNull();
    });

    it('CONTRATO ANTI-LOOP: el resultado es idempotente (segunda pasada null)', () => {
        const product = { id: 'p1', name: 'Harina', priceUsdt: 22, costUsd: 10, unitsPerPackage: 1 };
        const item = makeItem(product, { qty: 2 });
        const dual = { ...product, pricingMode: 'dual_usd', priceBsUsdRef: 1.5 };

        const first = resyncCartItems([item], [dual], CTX);
        expect(first).not.toBeNull();
        expect(resyncCartItems(first.cart, [dual], CTX)).toBeNull();
    });

    it('catálogo vacío (carga en curso) no marca todo como faltante', () => {
        const product = { id: 'p1', name: 'Harina', priceUsdt: 22, unitsPerPackage: 1 };
        const item = makeItem(product);
        expect(resyncCartItems([item], [], CTX)).toBeNull();
    });

    it('nombre actualizado respetando el sufijo de unidad', () => {
        const base = { id: 'p1', name: 'Café', priceUsdt: 2, unitPriceCop: 2400, unitsPerPackage: 20 };
        const item = makeItem(base, { _mode: 'unit', name: 'Café (Ud.)' });

        const r = resyncCartItems([item], [{ ...base, name: 'Café Molido' }], CTX);
        expect(r.cart[0].name).toBe(cartLineName('Café Molido', 'unit'));
        expect(r.cart[0].name).toBe('Café Molido (Ud.)');
    });

    it('cesta vacía devuelve null', () => {
        expect(resyncCartItems([], [{ id: 'p1' }], CTX)).toBeNull();
    });
});
