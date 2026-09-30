import { describe, expect, it } from 'vitest';
import { compactOldSales } from '../src/utils/purgeService';
import { RETENTION } from '../src/utils/retentionPolicy';

const day = 24 * 60 * 60 * 1000;
const sale = (id, daysAgo, total = 10, metodoPago = 'efectivo') => ({
    id,
    timestamp: new Date(Date.now() - daysAgo * day).toISOString(),
    total,
    totalBs: total * 100,
    metodoPago,
});

describe('purgeService — compactOldSales', () => {
    it('conserva el detalle dentro de la ventana de 12 meses', () => {
        const sales = [sale('a', 30), sale('b', 300)];
        const { sales: kept, compacted } = compactOldSales(sales, []);
        expect(kept.map((s) => s.id).sort()).toEqual(['a', 'b']);
        expect(compacted).toBe(0);
    });

    it('compacta lo más viejo que 12 meses a resúmenes mensuales', () => {
        const sales = [sale('old1', 400, 10, 'efectivo'), sale('old2', 410, 20, 'pago_movil'), sale('new', 10, 5)];
        const { sales: kept, summaries, compacted } = compactOldSales(sales, []);
        expect(compacted).toBe(2);
        expect(kept.map((s) => s.id)).toEqual(['new']);
        const total = summaries.reduce((acc, s) => acc + s.count, 0);
        expect(total).toBe(2);
        const all = summaries.reduce((acc, s) => acc + s.totalUsd, 0);
        expect(all).toBe(30);
    });

    it('los resúmenes agrupan por mes y método de pago', () => {
        const base = new Date();
        base.setDate(1);
        const daysAgo = Math.floor((Date.now() - base.getTime()) / day) + 400;
        const sales = [sale('a', daysAgo, 10, 'efectivo'), sale('b', daysAgo + 2, 20, 'efectivo')];
        const { summaries } = compactOldSales(sales, []);
        expect(summaries.length).toBe(1);
        expect(summaries[0].byMethod).toEqual({ efectivo: 2 });
    });

    it('fusiona con resúmenes ya existentes sin duplicar meses', () => {
        const sales = [sale('a', 400, 10)];
        const first = compactOldSales(sales, []);
        const second = compactOldSales([], first.summaries);
        expect(second.compacted).toBe(0);
        const total = second.summaries.reduce((acc, s) => acc + s.count, 0);
        expect(total).toBe(1);
    });

    it('no toca ventas sin fecha legible (conservador)', () => {
        const sales = [{ id: 'x', total: 5 }, sale('old', 500, 7)];
        const { sales: kept, compacted } = compactOldSales(sales, []);
        expect(kept.map((s) => s.id)).toContain('x');
        expect(compacted).toBe(1);
    });

    it('RETENTION expone las ventanas aprobadas', () => {
        expect(RETENTION.SALES_SYNC_DAYS).toBe(90);
        expect(RETENTION.SALES_DETAIL_MONTHS).toBe(12);
    });
});
