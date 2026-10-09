import { describe, expect, it } from 'vitest';
import {
    SUPERVISOR_SYNC_KEYS,
    validateSupervisorSyncDocument,
} from '../src/services/supervisorContracts';
import {
    accumulateReceivedStock,
    applyStockMap,
    applyStockMapDelta,
    buildOwnStockMap,
    buildStockMap,
    catalogHash,
    preserveLocalStock,
    isValidStockMap,
    mergeSales,
    normalizeSalesDeltaPayload,
    physicalDocId,
    pruneSalesForSync,
} from '../src/utils/syncDelta';

describe('delta legado sin fecha', () => {
    const key = 'bodega_sales_delta_2026-09-27';
    const legacy = { tickets: [{ id: 't1', totalUsd: 3 }] };

    it('toma la fecha de la clave y el documento pasa el contrato del supervisor', () => {
        const normalized = normalizeSalesDeltaPayload(key, legacy);
        expect(normalized).toEqual({ date: '2026-09-27', tickets: legacy.tickets });
        expect(validateSupervisorSyncDocument(key, normalized).valid).toBe(true);
        // Sin normalizar sigue rechazado: la validación estricta no cambió.
        expect(validateSupervisorSyncDocument(key, legacy).valid).toBe(false);
    });

    it('no altera deltas ya válidos, claves ajenas ni formas que no son delta', () => {
        const current = { date: '2026-09-27', tickets: [] };
        expect(normalizeSalesDeltaPayload(key, current)).toBe(current);
        expect(normalizeSalesDeltaPayload('bodega_products_v1', legacy)).toBe(legacy);
        expect(normalizeSalesDeltaPayload('bodega_sales_delta_2026-9-27', legacy)).toBe(legacy);
        const array = [{ id: 't1' }];
        expect(normalizeSalesDeltaPayload(key, array)).toBe(array);
        const noTickets = { items: [] };
        expect(normalizeSalesDeltaPayload(key, noTickets)).toBe(noTickets);
    });
});

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

describe('syncDelta — eco de stock entre equipos', () => {
    // Un equipo: stock del producto p1, lo recibido de otros y el último mapa visto.
    const device = (stock) => ({ products: [{ id: 'p1', stock }], received: {}, lastSeen: null });
    const publish = (d) => buildOwnStockMap(d.products, d.received);
    // Mismo flujo que useCloudSync: aplicar delta, persistir y acumular lo recibido.
    const receive = (dst, srcMap) => {
        const r = applyStockMapDelta(dst.products, srcMap, dst.lastSeen);
        dst.products = r.products;
        dst.lastSeen = r.nextRemoteMap;
        dst.received = accumulateReceivedStock(dst.received, r.deltas);
    };
    const sync = (a, b, cycles = 5) => {
        for (let i = 0; i < cycles; i++) {
            receive(b, publish(a));
            receive(a, publish(b));
        }
    };

    it('una venta en A se aplica una sola vez en ambos equipos (sin eco)', () => {
        const A = device(10);
        const B = device(10);
        A.lastSeen = publish(B);
        B.lastSeen = publish(A);
        A.products[0].stock = 9; // venta única
        sync(A, B);
        expect(A.products[0].stock).toBe(9);
        expect(B.products[0].stock).toBe(9);
    });

    it('ventas simultáneas en A (1) y B (2) convergen a 7 sin duplicarse', () => {
        const A = device(10);
        const B = device(10);
        A.lastSeen = publish(B);
        B.lastSeen = publish(A);
        A.products[0].stock = 9;
        B.products[0].stock = 8;
        sync(A, B);
        expect(A.products[0].stock).toBe(7);
        expect(B.products[0].stock).toBe(7);
    });

    it('buildOwnStockMap resta lo recibido de otras fuentes', () => {
        expect(buildOwnStockMap([{ id: 'p1', stock: 7 }], { p1: -1 })).toEqual({ p1: 8 });
        expect(buildOwnStockMap([{ id: 'p1', stock: 7 }], {})).toEqual({ p1: 7 });
    });

    it('accumulateReceivedStock suma deltas y descarta los que vuelven a cero', () => {
        expect(accumulateReceivedStock({ p1: -1 }, { p1: -2 })).toEqual({ p1: -3 });
        expect(accumulateReceivedStock({ p1: 2 }, { p1: -2 })).toEqual({});
    });

    it('accumulateReceivedStock descarta residuos de punto flotante', () => {
        expect(accumulateReceivedStock({ p1: 1 }, { p1: -1 + 1e-12 })).toEqual({});
        expect(accumulateReceivedStock({ p1: 1 }, { p1: -0.5 })).toEqual({ p1: 0.5 });
    });

    it('preserveLocalStock: el catálogo remoto no pisa el stock local', () => {
        const local = [{ id: 'p1', name: 'A', stock: 7 }, { id: 'p2', name: 'B', stock: 3 }];
        const remote = [{ id: 'p1', name: 'A2', stock: 10 }, { id: 'p3', name: 'Nuevo', stock: 4 }];
        const merged = preserveLocalStock(local, remote);
        expect(merged.find((p) => p.id === 'p1')).toEqual({ id: 'p1', name: 'A2', stock: 7 });
        expect(merged.find((p) => p.id === 'p3').stock).toBe(4);
    });
});

describe('syncDelta — delta diario de ventas (QUOTA-003)', () => {
    it('isSalesDeltaKey detecta el formato YYYY-MM-DD', async () => {
        const m = await import('../src/utils/syncDelta');
        expect(m.isSalesDeltaKey('bodega_sales_delta_2026-10-01')).toBe(true);
        expect(m.isSalesDeltaKey('bodega_sales_v1')).toBe(false);
        expect(m.isSalesDeltaKey('bodega_sales_delta_ayer')).toBe(false);
        expect(m.isSalesDeltaKey(null)).toBe(false);
    });

    it('buildSalesDeltaPayload filtra solo los tickets del día', async () => {
        const m = await import('../src/utils/syncDelta');
        const day = '2026-10-01';
        const tickets = [
            { id: 't1', timestamp: '2026-10-01T10:00:00', totalUsd: 5 },
            { id: 't2', timestamp: '2026-10-01T23:59:00', totalUsd: 3 },
            { id: 't3', timestamp: '2026-09-30T20:00:00', totalUsd: 7 },
            { id: 't4', timestamp: '2026-10-02T00:01:00', totalUsd: 9 },
        ];
        const payload = m.buildSalesDeltaPayload(tickets, day);
        expect(payload.date).toBe(day);
        expect(payload.tickets.map((t) => t.id).sort()).toEqual(['t1', 't2']);
        expect(m.isValidSalesDelta(payload)).toBe(true);
    });

    it('isValidSalesDelta rechaza payloads malformados', async () => {
        const m = await import('../src/utils/syncDelta');
        expect(m.isValidSalesDelta(null)).toBe(false);
        expect(m.isValidSalesDelta([])).toBe(false);
        expect(m.isValidSalesDelta({ date: 'ayer', tickets: [] })).toBe(false);
        expect(m.isValidSalesDelta({ date: '2026-10-01' })).toBe(false);
        expect(m.isValidSalesDelta({ date: '2026-10-01', tickets: [] })).toBe(true);
    });

    it('el delta es idempotente: mergeSales no duplica al recibir dos veces', async () => {
        const m = await import('../src/utils/syncDelta');
        const local = [{ id: 't1', timestamp: '2026-10-01T10:00:00' }];
        const delta = [{ id: 't1', timestamp: '2026-10-01T10:00:00' }, { id: 't2', timestamp: '2026-10-01T11:00:00' }];
        const once = m.mergeSales(local, delta);
        const twice = m.mergeSales(once, delta);
        expect(twice.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    });

    it('validateSupervisorSyncDocument acepta el delta diario', async () => {
        const c = await import('../src/services/supervisorContracts');
        const key = 'bodega_sales_delta_2026-10-01';
        expect(c.isSupervisorSyncKey(key)).toBe(true);
        const ok = c.validateSupervisorSyncDocument(key, { date: '2026-10-01', tickets: [{ id: 't1' }] });
        expect(ok.valid).toBe(true);
        const bad = c.validateSupervisorSyncDocument(key, { date: 'ayer', tickets: [] });
        expect(bad.valid).toBe(false);
    });

    it('salesDeltaTickets extrae tickets del payload o array legacy', async () => {
        const m = await import('../src/utils/syncDelta');
        expect(m.salesDeltaTickets({ date: '2026-10-01', tickets: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
        expect(m.salesDeltaTickets([{ id: 'b' }])).toEqual([{ id: 'b' }]);
        expect(m.salesDeltaTickets(null)).toEqual([]);
    });
});
