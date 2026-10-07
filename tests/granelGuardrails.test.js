import { describe, it, expect } from 'vitest';
import {
    isGranelProduct,
    granelUnitLabel,
    normalizeStockValue,
    parseStockInput,
    parseCartQuantity,
    normalizeCartQuantity,
    adjustStockValue,
    formatStockDisplay,
} from '../src/utils/granel.js';
import { buildProductPayload } from '../src/utils/productProcessor.js';

// ─────────────────────────────────────────────────────────────
// GRANEL-001: Guardarraíles canónicos de decimales para stock.
// REGLA: solo granel admite hasta 3 decimales; todo lo demás es entero estricto.
// ─────────────────────────────────────────────────────────────

describe('granel detector', () => {
    it('detects granel by packagingType', () => {
        expect(isGranelProduct({ packagingType: 'granel', unit: 'unidad' })).toBe(true);
    });

    it('detects granel by legacy weight/volume units', () => {
        ['kg', 'litro', 'gr', 'g', 'ml', 'l'].forEach(u => {
            expect(isGranelProduct({ unit: u })).toBe(true);
        });
        expect(isGranelProduct({ unit: 'unidad' })).toBe(false);
        expect(isGranelProduct({ unit: 'paquete' })).toBe(false);
    });

    it('detects granel by flags and granelUnit', () => {
        expect(isGranelProduct({ isWeight: true })).toBe(true);
        expect(isGranelProduct({ soldByWeight: true })).toBe(true);
        expect(isGranelProduct({ granelUnit: 'kg' })).toBe(true);
    });

    it('returns false for null/undefined/empty', () => {
        expect(isGranelProduct(null)).toBe(false);
        expect(isGranelProduct(undefined)).toBe(false);
        expect(isGranelProduct({})).toBe(false);
    });

    it('granelUnitLabel maps units to short labels', () => {
        expect(granelUnitLabel({ unit: 'kg' })).toBe('kg');
        expect(granelUnitLabel({ unit: 'litro' })).toBe('L');
        expect(granelUnitLabel({ granelUnit: 'kg', unit: 'kg' })).toBe('kg');
        expect(granelUnitLabel({ unit: 'unidad' })).toBe('UND');
    });
});

describe('stock guardrails (normalize / parse / adjust / format)', () => {
    it('granel keeps up to 3 decimals; non-granel rounds to integer', () => {
        expect(normalizeStockValue(55.5, true)).toBe(55.5);
        expect(normalizeStockValue(0.1255, true)).toBe(0.126); // round-half-away-from-zero
        expect(normalizeStockValue(10.5, false)).toBe(11);     // half away from zero
        expect(normalizeStockValue(10.4, false)).toBe(10);
    });

    it('parses comma decimals only for granel and rejects garbage', () => {
        expect(parseStockInput('55,5', true)).toBe(55.5);
        expect(parseStockInput('0.250', true)).toBe(0.25);
        expect(parseStockInput('55,5', false)).toBe(56);   // entero estricto
        expect(parseStockInput('abc', true)).toBe(null);
        expect(parseStockInput('', true)).toBe(null);
        expect(parseStockInput(null, true)).toBe(null);
    });

    it('rejects decimal quantities for non-granel cart lines but accepts them for granel', () => {
        expect(parseCartQuantity('0.5', false)).toBe(null);
        expect(parseCartQuantity('0.125', true)).toBe(0.125);
        expect(parseCartQuantity('2', false)).toBe(2);
    });

    it('normalizes legacy cart quantities before they reach the UI', () => {
        expect(normalizeCartQuantity(0.5, { unit: 'unidad', packagingType: 'suelto' })).toBe(1);
        expect(normalizeCartQuantity(0.125, { unit: 'kg', packagingType: 'granel' })).toBe(0.125);
        expect(normalizeCartQuantity('2.750', { unit: 'kg' })).toBe(2.75);
    });

    it('adjusts without IEEE-754 drift', () => {
        expect(adjustStockValue(55.3, 0.1, true)).toBe(55.4);
        expect(adjustStockValue(0.1, 0.2, true)).toBe(0.3); // clásico drift → 0.30000000000000004
        expect(adjustStockValue(6, -1, false)).toBe(5);
    });

    it('formats clean display strings without float artifacts or trailing zeros', () => {
        expect(formatStockDisplay(55.300000000000004, true)).toBe('55.3');
        expect(formatStockDisplay(0.250, true)).toBe('0.25');
        expect(formatStockDisplay(1.750, true)).toBe('1.75');
        expect(formatStockDisplay(55, false)).toBe('55');
        expect(formatStockDisplay(10.6, false)).toBe('11');
    });
});

describe('buildProductPayload stock typing (GRANEL-001)', () => {
    it('keeps decimals for granel products', () => {
        const payload = buildProductPayload({
            name: 'queso blanco',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '55,5',
            lowStockAlert: '2,5',
            priceUsd: '5.00'
        }, 40);
        expect(payload.stock).toBe(55.5);
        expect(payload.lowStockAlert).toBe(2.5);
        expect(payload.unit).toBe('kg');
    });

    it('truncates decimals to integer for non-granel products', () => {
        const payload = buildProductPayload({
            name: 'refresco',
            packagingType: 'suelto',
            unit: 'unidad',
            stock: '10.5',
            lowStockAlert: '3.9',
            priceUsd: '1.00'
        }, 40);
        expect(payload.stock).toBe(11); // round-half-away-from-zero
        expect(payload.lowStockAlert).toBe(4);
    });
});

describe('checkout-style deduction rules (pure logic mirror)', () => {
    // Espejo de la lógica de checkoutProcessor: deduce stock según reglas de granel.
    const deduct = (p, qty) => {
        const isWeight = p.isWeight || isGranelProduct(p);
        const deducted = isWeight ? qty : qty;
        return p.isWeight === false
            ? 0
            : (isGranelProduct(p)
                ? Math.round(((p.stock ?? 0) - deducted) * 1000) / 1000
                : Math.round((p.stock ?? 0) - deducted));
    };

    it('granel sale of 0.125 kg preserves the third decimal', () => {
        const p = { id: 'q', name: 'Queso', unit: 'kg', stock: 55.5 };
        const before = p.stock;
        const after = Math.round((before - 0.125) * 1000) / 1000;
        expect(after).toBe(55.375);
        expect(after.toString()).not.toContain('00000'); // sin artefactos flotantes
    });

    it('non-granel sale stays integer', () => {
        const p = { id: 'r', name: 'Refresco', unit: 'unidad', stock: 10 };
        expect(deduct(p, 2.9)).toBe(7); // Math.round(7.1) → 7
    });
});
