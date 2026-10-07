import { describe, expect, it } from 'vitest';
import { buildSupervisorReportRows } from '../src/utils/supervisorReportGenerator';

describe('Supervisor report PDF contract', () => {
    const input = {
        cash: {
            expected: { USD: 10, BS: 100, COP: 5000 },
            opening: { USD: 1, BS: 10, COP: 1000 },
            changeGiven: { USD: 0, BS: 5, COP: 0 },
            tipsLeft: { USD: 0, BS: 2, COP: 0 },
            reconciliation: {
                declared: { USD: 9, BS: 90, COP: 4000 },
                difference: { USD: -1, BS: -10, COP: -1000 },
            },
        },
        productsSold: [{ productName: 'Arroz', quantity: 3, revenueUsd: 9, salesCount: 1 }],
        expenses: [{ description: 'Luz', category: 'servicios', totalUsd: 4, affectsCash: true }],
        inventoryMovements: [],
    };

    it('incluye COP en las filas solo cuando está habilitado', () => {
        const enabled = buildSupervisorReportRows({ ...input, reportType: 'close', copEnabled: true });
        const disabled = buildSupervisorReportRows({ ...input, reportType: 'close', copEnabled: false });

        expect(enabled.some(([label]) => label.includes('COP'))).toBe(true);
        expect(disabled.some(([label]) => label.includes('COP'))).toBe(false);
        expect(enabled.some(([label, value]) => label === 'Declarado USD' && value === '$9.00')).toBe(true);
        expect(enabled.some(([label]) => label === 'Diferencia Bs')).toBe(true);
        expect(disabled.some(([label]) => label.includes('Declarado COP') || label.includes('Diferencia COP'))).toBe(false);
    });

    it('no añade una sección de arqueo si el cierre no la guardó', () => {
        const rows = buildSupervisorReportRows({
            ...input,
            cash: { ...input.cash, reconciliation: undefined },
            reportType: 'close',
            copEnabled: false,
        });

        expect(rows.some(([label]) => label === 'EFECTIVO DECLARADO')).toBe(false);
    });

    it('genera filas diferenciadas para ventas y gastos', () => {
        const rows = buildSupervisorReportRows({ ...input, reportType: 'summary', copEnabled: false });
        expect(rows).toEqual(expect.arrayContaining([
            ['PRODUCTOS VENDIDOS', ''],
            ['GASTOS Y EGRESOS', ''],
        ]));
    });
});
