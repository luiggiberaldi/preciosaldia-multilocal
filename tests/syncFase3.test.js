import { describe, expect, it, vi } from 'vitest';
import {
    mergeSales,
    applyStockMapDelta,
    buildSalesDeltaPayload,
    filterTicketsForDay,
    salesDayString,
    salesDeltaTickets,
} from '../src/utils/syncDelta';
import {
    recordSyncConflict,
    getSyncConflicts,
    clearSyncConflicts,
    friendlyConflictName,
    isUnconfirmedLocalConflict,
    SYNC_CONFLICT_EVENT,
} from '../src/utils/syncConflicts';

const dayMs = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n, h = 12) => {
    const d = new Date(Date.now() - n * dayMs);
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
};

describe('M-3: mergeSales prefiere la anulación sobre el timestamp', () => {
    const base = { id: 'v1', total: 10, timestamp: isoDaysAgo(1) };

    it('una ANULADA remota con timestamp menor gana sobre la activa local', () => {
        const local = [{ ...base, status: 'PAGADA', timestamp: isoDaysAgo(0) }];
        const remote = [{ ...base, status: 'ANULADA', voidedAt: isoDaysAgo(1), timestamp: isoDaysAgo(2) }];
        const merged = mergeSales(local, remote);
        expect(merged).toHaveLength(1);
        expect(merged[0].status).toBe('ANULADA');
    });

    it('una ANULADA local no resucita aunque la remota sea más nueva', () => {
        const local = [{ ...base, status: 'ANULADA', voidedAt: isoDaysAgo(1), timestamp: isoDaysAgo(1) }];
        const remote = [{ ...base, status: 'PAGADA', timestamp: isoDaysAgo(0) }];
        const merged = mergeSales(local, remote);
        expect(merged).toHaveLength(1);
        expect(merged[0].status).toBe('ANULADA');
    });

    it('voidedAt solo (sin status) también cuenta como anulada', () => {
        const local = [{ ...base, status: 'PAGADA', timestamp: isoDaysAgo(0) }];
        const remote = [{ ...base, voidedAt: isoDaysAgo(1), timestamp: isoDaysAgo(3) }];
        const merged = mergeSales(local, remote);
        expect(merged[0].voidedAt).toBeDefined();
    });

    it('entre dos activas sigue ganando el timestamp mayor', () => {
        const local = [{ ...base, total: 10, timestamp: isoDaysAgo(2) }];
        const remote = [{ ...base, total: 20, timestamp: isoDaysAgo(0) }];
        const merged = mergeSales(local, remote);
        expect(merged[0].total).toBe(20);
    });

    it('entre dos anuladas gana el timestamp mayor', () => {
        const local = [{ ...base, status: 'ANULADA', voidedAt: isoDaysAgo(2), timestamp: isoDaysAgo(2) }];
        const remote = [{ ...base, status: 'ANULADA', voidedAt: isoDaysAgo(0), timestamp: isoDaysAgo(0) }];
        const merged = mergeSales(local, remote);
        expect(merged[0].voidedAt).toBe(remote[0].voidedAt);
    });
});

describe('M-6: applyStockMapDelta reconcilia por deltas', () => {
    const products = [{ id: 'p1', name: 'Harina', stock: 10 }];

    it('dos cajas vendiendo a la vez no se pisan (10→8 local, mapa 10→7 ⇒ 5)', () => {
        // Caja A vendió 2 (local 8). Llega el mapa de caja B (7, vendió 3
        // desde la misma base 10 que ya vimos).
        const local = [{ id: 'p1', name: 'Harina', stock: 8 }];
        const { products: out, nextRemoteMap } = applyStockMapDelta(local, { p1: 7 }, { p1: 10 });
        expect(out[0].stock).toBe(5);
        expect(nextRemoteMap).toEqual({ p1: 7 });
    });

    it('primera vista de la fuente: asignación absoluta (sin regresión)', () => {
        const local = [{ id: 'p1', name: 'Harina', stock: 8 }];
        const { products: out, nextRemoteMap } = applyStockMapDelta(local, { p1: 7 }, null);
        expect(out[0].stock).toBe(7);
        expect(nextRemoteMap).toEqual({ p1: 7 });
    });

    it('delta cero no toca nada y conserva la referencia', () => {
        const local = [{ id: 'p1', name: 'Harina', stock: 5 }];
        const { products: out } = applyStockMapDelta(local, { p1: 7 }, { p1: 7 });
        expect(out).toBe(local);
    });

    it('una reposición remota (+20) se suma al stock local', () => {
        const local = [{ id: 'p1', name: 'Harina', stock: 5 }];
        const { products: out } = applyStockMapDelta(local, { p1: 27 }, { p1: 7 });
        expect(out[0].stock).toBe(25);
    });

    it('productos fuera del mapa remoto no se tocan', () => {
        const local = [
            { id: 'p1', name: 'Harina', stock: 8 },
            { id: 'p2', name: 'Azúcar', stock: 3 },
        ];
        const { products: out } = applyStockMapDelta(local, { p1: 7 }, { p1: 10 });
        expect(out.find((p) => p.id === 'p2').stock).toBe(3);
        expect(out.find((p) => p.id === 'p1').stock).toBe(5);
    });
});

describe('CRÍTICO-2(a): deltas de días previos se pueden construir', () => {
    const sales = [
        { id: 'ayer-1', total: 5, timestamp: isoDaysAgo(1) },
        { id: 'ayer-2', total: 7, timestamp: isoDaysAgo(1) },
        { id: 'hoy-1', total: 9, timestamp: isoDaysAgo(0) },
    ];

    it('filterTicketsForDay parte por día local', () => {
        const y = salesDayString(new Date(Date.now() - dayMs));
        const t = salesDayString(new Date());
        expect(filterTicketsForDay(sales, y).map((s) => s.id).sort()).toEqual(['ayer-1', 'ayer-2']);
        expect(filterTicketsForDay(sales, t).map((s) => s.id)).toEqual(['hoy-1']);
    });

    it('el delta de ayer solo trae los tickets de ayer', () => {
        const y = salesDayString(new Date(Date.now() - dayMs));
        const payload = buildSalesDeltaPayload(sales, y);
        expect(payload.date).toBe(y);
        expect(payload.tickets).toHaveLength(2);
    });

    it('una anulación editada después de su fecha de venta vuelve a salir en el delta de esa fecha', () => {
        const saleDate = new Date(Date.now() - 3 * dayMs);
        const saleDay = salesDayString(saleDate);
        const now = new Date();
        const voidedSale = {
            id: 'voided-old-sale',
            tipo: 'VENTA',
            status: 'ANULADA',
            timestamp: saleDate.toISOString(),
            voidedAt: now.toISOString(),
        };
        const payload = buildSalesDeltaPayload([voidedSale], saleDay);
        expect(payload.tickets).toEqual([voidedSale]);
        expect(mergeSales([{ ...voidedSale, status: 'PAGADA' }], payload.tickets)[0].status).toBe('ANULADA');
    });

    it('la apertura de caja viaja dentro del delta correspondiente al día local', () => {
        const opening = {
            id: 'opening-test',
            tipo: 'APERTURA_CAJA',
            openingUsd: 50,
            openingBs: 1000,
            timestamp: new Date().toISOString(),
        };
        const day = salesDayString(new Date(opening.timestamp));
        const payload = buildSalesDeltaPayload([opening], day);
        expect(payload.tickets).toEqual([opening]);
    });

    it('flujo E2E simulado: venta offline de ayer llega hoy y aparece en el monitor', () => {
        // La caja estuvo offline ayer: su delta de ayer nunca se empujó.
        // Hoy reconecta: empuja el delta de ayer + el de hoy.
        const y = salesDayString(new Date(Date.now() - dayMs));
        const t = salesDayString(new Date());
        const deltaAyer = buildSalesDeltaPayload(sales, y);
        const deltaHoy = buildSalesDeltaPayload(sales, t);

        // El monitor fusiona por id (idempotente ante duplicados).
        let monitorSales = [];
        monitorSales = mergeSales(monitorSales, salesDeltaTickets(deltaAyer));
        monitorSales = mergeSales(monitorSales, salesDeltaTickets(deltaHoy));
        // Re-entrega del delta de ayer (reintento): no duplica.
        monitorSales = mergeSales(monitorSales, salesDeltaTickets(deltaAyer));

        const ids = monitorSales.map((s) => s.id).sort();
        expect(ids).toEqual(['ayer-1', 'ayer-2', 'hoy-1']);
    });
});

describe('M-17: registro de conflictos de sincronización', () => {
    it('record/get/clear redondo', () => {
        clearSyncConflicts();
        expect(getSyncConflicts()).toEqual([]);
        recordSyncConflict({ key: 'bodega_products_v1', docId: 'nb_1:bodega_products_v1', direction: 'remote-discarded', detail: 'x' });
        const list = getSyncConflicts();
        expect(list).toHaveLength(1);
        expect(list[0].key).toBe('bodega_products_v1');
        expect(list[0].at).toBeDefined();
        clearSyncConflicts();
        expect(getSyncConflicts()).toEqual([]);
    });

    it('emite el evento pda_sync_conflict', () => {
        clearSyncConflicts();
        const seen = [];
        const handler = (e) => seen.push(e.detail);
        window.addEventListener(SYNC_CONFLICT_EVENT, handler);
        recordSyncConflict({ key: 'bodega_customers_v1', direction: 'local-overwritten' });
        window.removeEventListener(SYNC_CONFLICT_EVENT, handler);
        expect(seen).toHaveLength(1);
        expect(seen[0].direction).toBe('local-overwritten');
        clearSyncConflicts();
    });

    it('tope de 20, los más recientes primero', () => {
        clearSyncConflicts();
        for (let i = 0; i < 25; i++) {
            recordSyncConflict({ key: `k${i}`, direction: 'd', detail: `n${i}` });
        }
        const list = getSyncConflicts();
        expect(list).toHaveLength(20);
        expect(list[0].detail).toBe('n24');
        clearSyncConflicts();
    });

    it('deduplica conflictos repetidos por documento y dirección', () => {
        clearSyncConflicts();
        recordSyncConflict({ key: 'bodega_products_v1', docId: 'nb_1:bodega_products_v1', direction: 'local-overwritten', detail: 'primer detalle' });
        recordSyncConflict({ key: 'bodega_products_v1', docId: 'nb_1:bodega_products_v1', direction: 'local-overwritten', detail: 'detalle repetido' });
        expect(getSyncConflicts()).toHaveLength(1);
        expect(getSyncConflicts()[0].detail).toBe('primer detalle');
        clearSyncConflicts();
    });

    it('solo trata como conflicto cambios locales posteriores a una base confirmada', () => {
        expect(isUnconfirmedLocalConflict('local-nuevo', 'remoto-nuevo', 'base')).toBe(true);
        expect(isUnconfirmedLocalConflict('local-nuevo', 'local-nuevo', 'base')).toBe(false);
        expect(isUnconfirmedLocalConflict('base', 'remoto-nuevo', 'base')).toBe(false);
        expect(isUnconfirmedLocalConflict('local-nuevo', 'remoto-nuevo', null)).toBe(false);
    });

    it('friendlyConflictName traduce claves conocidas', () => {
        expect(friendlyConflictName('bodega_products_v1')).toContain('precios');
        expect(friendlyConflictName('otra_clave')).toBe('otra_clave');
    });
});
