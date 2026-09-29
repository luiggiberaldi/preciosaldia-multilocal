/**
 * supervisionData.test.js — Tests de la lectura cross-negocio (Fase 1.5).
 *
 * Cubren `summarizeSales`: hoy / últimos 7 días / mes / ticket promedio, con
 * el mismo criterio de filtrado que `useDashboardMetrics` (excluye anuladas,
 * caja cerrada y tipos que no son venta).
 */
import { describe, it, expect } from 'vitest';
import { summarizeSales } from '../src/utils/supervisionData';

// Fecha fija para que el test sea determinista.
const TODAY = '2026-09-29';

function sale({ totalUsd, daysAgo = 0, tipo = 'VENTA', status = 'OK', cajaCerrada = false }) {
    const d = new Date(`${TODAY}T12:00:00`);
    d.setDate(d.getDate() - daysAgo);
    return { totalUsd, tipo, status, cajaCerrada, timestamp: d.getTime() };
}

describe('summarizeSales', () => {
    it('suma hoy, semana, mes y calcula el ticket promedio', () => {
        const sales = [
            sale({ totalUsd: 10, daysAgo: 0 }),
            sale({ totalUsd: 20, daysAgo: 0 }),
            sale({ totalUsd: 5, daysAgo: 3 }),
            sale({ totalUsd: 100, daysAgo: 40 }), // mes anterior
        ];
        const r = summarizeSales(sales, TODAY);
        expect(r.todayTotalUsd).toBe(30);
        expect(r.todayCount).toBe(2);
        expect(r.weekTotalUsd).toBe(35);
        expect(r.monthTotalUsd).toBe(35);
        expect(r.ticketAvgUsd).toBe(15);
    });

    it('excluye anuladas, caja cerrada y tipos no-venta', () => {
        const sales = [
            sale({ totalUsd: 10, daysAgo: 0 }),
            sale({ totalUsd: 50, daysAgo: 0, status: 'ANULADA' }),
            sale({ totalUsd: 60, daysAgo: 0, cajaCerrada: true }),
            sale({ totalUsd: 70, daysAgo: 0, tipo: 'COBRO_DEUDA' }),
            sale({ totalUsd: 80, daysAgo: 0, tipo: 'GASTO_INTERNO' }),
            sale({ totalUsd: 15, daysAgo: 0, tipo: 'VENTA_FIADA' }),
            sale({ totalUsd: 25, daysAgo: 0, tipo: 'VENTA_CASHEA' }),
        ];
        const r = summarizeSales(sales, TODAY);
        expect(r.todayTotalUsd).toBe(50); // 10 + 15 + 25
        expect(r.todayCount).toBe(3);
    });

    it('la semana son los últimos 7 días incluyendo hoy', () => {
        const sales = [
            sale({ totalUsd: 10, daysAgo: 6 }),
            sale({ totalUsd: 20, daysAgo: 7 }), // fuera de la ventana
        ];
        const r = summarizeSales(sales, TODAY);
        expect(r.weekTotalUsd).toBe(10);
    });

    it('con cero ventas devuelve ceros (sin NaN)', () => {
        const r = summarizeSales([], TODAY);
        expect(r).toEqual({
            todayTotalUsd: 0,
            todayCount: 0,
            weekTotalUsd: 0,
            monthTotalUsd: 0,
            ticketAvgUsd: 0,
        });
    });

    it('dos sedes no se mezclan (aislamiento por negocio)', () => {
        const sedeA = [sale({ totalUsd: 10, daysAgo: 0 })];
        const sedeB = [sale({ totalUsd: 99, daysAgo: 0 })];
        expect(summarizeSales(sedeA, TODAY).todayTotalUsd).toBe(10);
        expect(summarizeSales(sedeB, TODAY).todayTotalUsd).toBe(99);
    });
});
