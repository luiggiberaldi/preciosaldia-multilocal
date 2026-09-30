import { describe, expect, it } from 'vitest';
import {
    SUPERVISOR_SYNC_KEYS,
    validateSupervisorSyncDocument,
} from '../src/services/supervisorContracts';
import {
    applyStockMap,
    buildStockMap,
    catalogHash,
    isValidStockMap,
    mergeSales,
    physicalDocId,
    pruneSalesForSync,
} from '../src/utils/syncDelta';

const products = [
    { id: 'p1', name: 'A', priceUsd: 1, stock: 10, updatedAt: 't1' },
    { id: 'p2', name: 'B', priceUsd: 2, stock: 5, updatedAt: 't2' },
];

describe('syncDelta — catálogo vs stock', () => {
    it('el hash del catálogo ignora cambios solo de stock/updatedAt', () => {
        const before = catalogHash(products);
        const afterSale = products.map((p) => ({ ...p, stock: p.stock - 1, updatedAt: 't3' }));
        expect(catalogHash(afterSale)).toBe(before);
    });

    it('el hash del catálogo cambia con precio, nombre, alta o baja', () => {
        const before = catalogHash(products);
        expect(catalogHash(products.map((p) => (p.id === 'p1' ? { ...p, priceUsd: 9 } : p)))).not.toBe(before);
        expect(catalogHash([...products, { id: 'p3', name: 'C', stock: 1 }])).not.toBe(before);
        expect(catalogHash(products.slice(1))).not.toBe(before);
    });

    it('buildStockMap genera el mapa liviano', () => {
        expect(buildStockMap(products)).toEqual({ p1: 10, p2: 5 });
    });

    it('applyStockMap fusiona sin reemplazar el catálogo', () => {
        const merged = applyStockMap(products, { p1: 7 });
        expect(merged.find((p) => p.id === 'p1').stock).toBe(7);
        expect(merged.find((p) => p.id === 'p1').name).toBe('A');
        expect(merged.find((p) => p.id === 'p2').stock).toBe(5);
    });

    it('applyStockMap devuelve el mismo array si nada cambió', () => {
        expect(applyStockMap(products, { p1: 10 })).toBe(products);
        expect(applyStockMap(products, { px: 3 })).toBe(products);
    });

    it('isValidStockMap valida la forma', () => {
        expect(isValidStockMap({ a: 1, b: 0 })).toBe(true);
        expect(isValidStockMap([])).toBe(false);
        expect(isValidStockMap(null)).toBe(false);
        expect(isValidStockMap({ a: 'x' })).toBe(false);
    });

    it('physicalDocId arma el doc_id namespaced', () => {
        expect(physicalDocId('neg-1', 'bodega_products_v1')).toBe('nb_neg-1:bodega_products_v1');
        expect(physicalDocId(null, 'bodega_products_v1')).toBe('bodega_products_v1');
    });
});

describe('syncDelta — contrato de sync (QUOTA-001/002)', () => {
    it('bodega_stock_v1 está allowlisted y valida como objeto plano', () => {
        expect(SUPERVISOR_SYNC_KEYS).toContain('bodega_stock_v1');
        expect(validateSupervisorSyncDocument('bodega_stock_v1', { p1: 5 }).valid).toBe(true);
        expect(validateSupervisorSyncDocument('bodega_stock_v1', [1, 2]).valid).toBe(false);
    });

    it('abasto_audit_log_v1 ya NO se sincroniza', () => {
        expect(SUPERVISOR_SYNC_KEYS).not.toContain('abasto_audit_log_v1');
        expect(validateSupervisorSyncDocument('abasto_audit_log_v1', []).valid).toBe(false);
    });
});

describe('syncDelta — ventas podadas y fusión', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const sale = (id, daysAgo) => ({
        id,
        timestamp: new Date(now - daysAgo * day).toISOString(),
        total: 10,
    });

    it('pruneSalesForSync deja solo la ventana de 90 días', () => {
        const sales = [sale('a', 10), sale('b', 89), sale('c', 91), sale('d', 400)];
        const pruned = pruneSalesForSync(sales, 90);
        expect(pruned.map((s) => s.id).sort()).toEqual(['a', 'b']);
    });

    it('mergeSales une por id sin borrar historial local', () => {
        const local = [sale('a', 200), sale('b', 10)];
        const remote = [sale('b', 10), sale('c', 5)]; // 'b' duplicada, 'c' nueva
        const merged = mergeSales(local, remote);
        expect(merged.map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('mergeSales: ante duplicado gana la más nueva', () => {
        const old = { id: 'x', timestamp: new Date(now - 5 * day).toISOString(), total: 1 };
        const newer = { id: 'x', timestamp: new Date(now - 1 * day).toISOString(), total: 2 };
        expect(mergeSales([old], [newer])[0].total).toBe(2);
        expect(mergeSales([newer], [old])[0].total).toBe(2);
    });

    it('mergeSales tolera nulls', () => {
        expect(mergeSales(null, [sale('a', 1)]).map((s) => s.id)).toEqual(['a']);
        expect(mergeSales([sale('a', 1)], null).map((s) => s.id)).toEqual(['a']);
    });
});
