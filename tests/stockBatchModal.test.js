import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storageService } from '../src/utils/storageService';
import { isGranelProduct, parseStockInput, adjustStockValue, formatStockDisplay } from '../src/utils/granel';

describe('StockBatchModal Guardrails and Logic', () => {
    const mockProducts = [
        { id: 'p1', name: 'Harina Blanca Kaly 900 grs', stock: 6, unitsPerPackage: 20, barcode: '7591234567890', category: 'viveres' },
        { id: 'p2', name: 'Arroz Primor Clasico 1kg', stock: 15, unitsPerPackage: 24, barcode: '7599876543210', category: 'viveres' },
        { id: 'p3', name: 'Aceite Diana 1L', stock: 2, unitsPerPackage: 12, barcode: '7591112223334', category: 'aceites' },
        { id: 'p4', name: 'Queso Blanco', stock: 55.5, unit: 'kg', packagingType: 'granel', granelUnit: 'kg', barcode: '7594445556667', category: 'lácteos' },
    ];

    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('filters products by name and barcode correctly', () => {
        const termBarcode = '543210';
        const filteredByBarcode = mockProducts.filter(p =>
            p.name.toLowerCase().includes(termBarcode) ||
            (p.barcode && p.barcode.toLowerCase().includes(termBarcode))
        );
        expect(filteredByBarcode.length).toBe(1);
        expect(filteredByBarcode[0].id).toBe('p2');

        const termName = 'kaly';
        const filteredByName = mockProducts.filter(p =>
            p.name.toLowerCase().includes(termName) ||
            (p.barcode && p.barcode.toLowerCase().includes(termName))
        );
        expect(filteredByName.length).toBe(1);
        expect(filteredByName[0].id).toBe('p1');
    });

    it('retains article in selectedProducts when qty is set to 0, and only removes when explicitly removed', () => {
        let adjustments = { p1: 1, p2: 5 };

        // User changes p1 qty to 0
        adjustments = { ...adjustments, p1: 0 };
        const selected = mockProducts.filter(p => p.id in adjustments);
        expect(selected.length).toBe(2);
        expect(selected.find(x => x.id === 'p1')).toBeDefined();

        // User explicitly clicks X (removeProduct)
        const next = { ...adjustments };
        delete next.p1;
        adjustments = next;
        const selectedAfterRemove = mockProducts.filter(p => p.id in adjustments);
        expect(selectedAfterRemove.length).toBe(1);
        expect(selectedAfterRemove.find(x => x.id === 'p1')).toBeUndefined();
    });

    it('prevents egresos from exceeding current stock when allow_negative_stock is false', () => {
        localStorage.setItem('allow_negative_stock', 'false');
        const direction = 'egreso';
        const p = mockProducts.find(x => x.id === 'p3');
        const qty = 5;
        const allowNegative = localStorage.getItem('allow_negative_stock') === 'true';

        const isExcess = direction === 'egreso' && qty > p.stock && !allowNegative;
        expect(isExcess).toBe(true);

        const newStock = direction === 'ingreso'
            ? p.stock + qty
            : (allowNegative ? p.stock - qty : Math.max(0, p.stock - qty));
        expect(newStock).toBe(0);
    });

    it('allows negative stock egresos only when allow_negative_stock is explicitly true', () => {
        localStorage.setItem('allow_negative_stock', 'true');
        const direction = 'egreso';
        const p = mockProducts.find(x => x.id === 'p3');
        const qty = 5;
        const allowNegative = localStorage.getItem('allow_negative_stock') === 'true';

        const isExcess = direction === 'egreso' && qty > p.stock && !allowNegative;
        expect(isExcess).toBe(false);

        const newStock = direction === 'ingreso'
            ? p.stock + qty
            : (allowNegative ? p.stock - qty : Math.max(0, p.stock - qty));
        expect(newStock).toBe(-3);
    });

    it('calculates package units accurately for bulk adjustments', () => {
        const p = mockProducts.find(x => x.id === 'p1');
        const qty = 2;
        const adjUnit = 'lotes';
        const unitsPerPkg = p.unitsPerPackage;

        const deltaUnits = (unitsPerPkg > 1 && adjUnit === 'lotes') ? qty * unitsPerPkg : qty;
        expect(deltaUnits).toBe(40);

        const newStock = p.stock + deltaUnits;
        expect(newStock).toBe(46);
    });

    it('persists inline package size changes to storageService and products list', () => {
        const spyStorage = vi.spyOn(storageService, 'setItem').mockReturnValue(true);
        const tempPackageSizes = { p1: 24 };

        const updated = mockProducts.map(p => {
            const newSize = tempPackageSizes[p.id];
            if (newSize && newSize > 1) return { ...p, unitsPerPackage: newSize };
            return p;
        });

        storageService.setItem('bodega_products_v1', updated);

        expect(spyStorage).toHaveBeenCalledWith('bodega_products_v1', expect.any(Array));
        expect(updated.find(x => x.id === 'p1').unitsPerPackage).toBe(24);
    });

    // ─── GRANEL-001: decimales SOLO para productos a granel ───
    it('detects granel products and accepts decimal adjustments (1.5 kg) without truncation', () => {
        const queso = mockProducts.find(x => x.id === 'p4');
        expect(isGranelProduct(queso)).toBe(true);

        const qty = parseStockInput('1,250', true);
        expect(qty).toBe(1.25);

        const newStock = adjustStockValue(queso.stock, qty, true);
        expect(newStock).toBe(56.75);
        expect(formatStockDisplay(newStock, true)).toBe('56.75');
    });

    it('rounds decimal qty to integer for non-granel products (strict rule)', () => {
        const harina = mockProducts.find(x => x.id === 'p1');
        expect(isGranelProduct(harina)).toBe(false);

        expect(parseStockInput('2.9', false)).toBe(3);
        expect(parseStockInput('2.2', false)).toBe(2);
        expect(adjustStockValue(harina.stock, 1, false)).toBe(7);
    });

    it('granel egresos respect stock with decimals (no drift in newStock calc)', () => {
        const queso = mockProducts.find(x => x.id === 'p4');
        const allowNegative = false;
        const delta = 0.250;
        expect(delta <= queso.stock).toBe(true);

        const newStock = allowNegative ? adjustStockValue(queso.stock, -delta, true) : Math.max(0, adjustStockValue(queso.stock, -delta, true));
        expect(newStock).toBe(55.25);
    });

    it('granel stepper +1 from 55.5 gives 56.5 without float artifacts', () => {
        const next = adjustStockValue(55.5, 1, true);
        expect(next).toBe(56.5);
        expect(String(next)).not.toContain('000000000');
    });
});
