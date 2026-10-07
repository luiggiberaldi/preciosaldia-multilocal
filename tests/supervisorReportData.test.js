import { describe, expect, it } from 'vitest';
import {
    calculateSupervisorCashSummary,
    buildSupervisorExpenseReport,
    buildSupervisorInventoryMovements,
    filterSupervisorInventoryMovements,
    buildSupervisorProductReport,
    buildSupervisorCloseCashSummary,
    filterSupervisorRecords,
    shouldShowSupervisorCop,
} from '../src/services/supervisorReportData';

describe('Supervisor report data', () => {
    it('solo muestra COP cuando el sistema principal lo tiene activado', () => {
        expect(shouldShowSupervisorCop(true)).toBe(true);
        expect(shouldShowSupervisorCop(false)).toBe(false);
        expect(shouldShowSupervisorCop(undefined)).toBe(false);
        expect(shouldShowSupervisorCop('true')).toBe(false);
    });

    it('calcula efectivo esperado sin duplicar cambios dejados', () => {
        const result = calculateSupervisorCashSummary([
            { tipo: 'APERTURA_CAJA', openingBs: 100, openingUsd: 10 },
            {
                tipo: 'VENTA',
                totalBs: 100,
                totalUsd: 1,
                payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountBs: 150 }],
                changeBs: 50,
                tipDonated: { currency: 'BS', amountBs: 2 },
            },
            {
                tipo: 'GASTO_INTERNO',
                totalBs: -20,
                totalUsd: -0.2,
                payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountBs: -20 }],
            },
        ], 100);

        expect(result.expected).toEqual({ USD: 10, BS: 180, COP: 0 });
        expect(result.changeGiven.BS).toBe(50);
        expect(result.tipsLeft.BS).toBe(2);
    });

    it('no suma el saldo generado a favor como efectivo esperado', () => {
        const result = calculateSupervisorCashSummary([{
            tipo: 'VENTA',
            totalUsd: 5,
            totalBs: 500,
            vueltoParaMonedero: 5,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10 }],
            changeUsd: 0,
            changeBs: 0,
        }], 100);

        expect(result.expected).toEqual({ USD: 10, BS: 0, COP: 0 });
        expect(result.changeGiven).toEqual({ USD: 0, BS: 0, COP: 0 });
    });

    it('usa el arqueo guardado del cierre seleccionado sin recalcularlo con la tasa actual', () => {
        const cash = buildSupervisorCloseCashSummary({
            cierreId: 'close-1',
            totalUsd: 1,
            totalBs: 100,
            reconData: {
                expectedUsd: 125,
                expectedBs: 12500,
                cashUsd: 124,
                cashBs: 12400,
                diffUsd: -1,
                diffBs: -100,
            },
            apertura: { openingUsd: 10, openingBs: 1000 },
        }, { expected: { USD: 999, BS: 99999, COP: 0 } });

        expect(cash.expected).toEqual({ USD: 125, BS: 12500, COP: 0 });
        expect(cash.opening).toEqual({ USD: 10, BS: 1000, COP: 0 });
        expect(cash.reconciliation.declared).toMatchObject({ USD: 124, BS: 12400 });
        expect(cash.reconciliation.difference).toMatchObject({ USD: -1, BS: -100 });
    });

    it('filtra por cierreId sin mezclar turnos', () => {
        const result = filterSupervisorRecords([
            { id: 'a', cierreId: '1', timestamp: '2026-08-09T10:00:00.000Z' },
            { id: 'b', cierreId: '2', timestamp: '2026-08-09T11:00:00.000Z' },
        ], { cierreId: '2' });

        expect(result.map(row => row.id)).toEqual(['b']);
    });

    it('filtra por fechas específicas para consultar un día o rango', () => {
        const result = filterSupervisorRecords([
            { id: 'before', timestamp: '2026-08-09T12:00:00' },
            { id: 'inside', timestamp: '2026-08-10T12:00:00' },
            { id: 'after', timestamp: '2026-08-12T12:00:00' },
        ], { range: 'custom', from: '2026-08-10', to: '2026-08-11' });

        expect(result.map(row => row.id)).toEqual(['inside']);
    });

    it('normaliza movimientos legacy y conserva el motivo disponible', () => {
        const movements = buildSupervisorInventoryMovements([
            {
                id: 'movement-1',
                tipo: 'AJUSTE_SALIDA',
                motivo: 'Producto dañado',
                timestamp: '2026-08-09T10:00:00.000Z',
                items: [{ id: 'p1', name: 'Arroz', qty: 3 }],
            },
            { tipo: 'VENTA', items: [{ id: 'p2', name: 'Pan', qty: 1 }] },
        ]);

        expect(movements).toHaveLength(1);
        expect(movements[0]).toMatchObject(            {
                movementId: 'movement-1',
                productId: 'p1',
                direction: 'egreso',
                unitsDelta: 3,
                reason: 'Producto dañado',
            });
    });

    it('expande todos los productos de un ajuste masivo sin colisiones de ID', () => {
        const movements = buildSupervisorInventoryMovements([{
            id: 'batch-1',
            tipo: 'AJUSTE_ENTRADA',
            timestamp: '2026-08-09T10:00:00.000Z',
            items: [
                { id: 'p1', name: 'Arroz', qty: 24, unitsPerPackage: 24 },
                { id: 'p2', name: 'Pasta', qty: 12, unitsPerPackage: 12 },
            ],
        }]);

        expect(movements).toHaveLength(2);
        expect(new Set(movements.map(row => row.movementId)).size).toBe(2);
        expect(movements.map(row => row.productId).sort()).toEqual(['p1', 'p2']);
    });

    it('filtra movimientos por dirección y búsqueda sin ocultar datos incompletos por defecto', () => {
        const movements = buildSupervisorInventoryMovements([
            { id: 'in-1', tipo: 'AJUSTE_ENTRADA', timestamp: '2026-08-09T10:00:00.000Z', items: [{ id: 'p1', name: 'Arroz', qty: 24 }], proveedor: 'Proveedor A' },
            { id: 'out-1', tipo: 'AJUSTE_SALIDA', timestamp: '2026-08-09T11:00:00.000Z', motivo: 'Merma', items: [{ id: 'p1', name: 'Arroz', qty: 2 }] },
            { id: 'legacy-1', tipo: 'AJUSTE_ENTRADA', items: [{ id: 'p2', name: 'Pasta', qty: 1 }] },
        ]);

        expect(filterSupervisorInventoryMovements(movements, { direction: 'egreso' })).toHaveLength(1);
        expect(filterSupervisorInventoryMovements(movements, { search: 'proveedor a' })).toHaveLength(1);
        expect(filterSupervisorInventoryMovements(movements, { includeIncomplete: false })).toHaveLength(2);
    });

    it('conserva la unidad del lote y el stock antes/después para el Supervisor', () => {
        const [movement] = buildSupervisorInventoryMovements([{
            id: 'batch-1',
            tipo: 'AJUSTE_ENTRADA',
            quantityInput: 2,
            inputUnit: 'bultos',
            unitsPerPackage: 24,
            unitsDelta: 48,
            stockBefore: 10,
            stockAfter: 58,
            reason: 'Mercancía recibida',
        }]);

        expect(movement).toMatchObject({
            quantityInput: 2,
            inputUnit: 'bultos',
            unitsPerPackage: 24,
            unitsDelta: 48,
            stockBefore: 10,
            stockAfter: 58,
        });
    });


    it('agrupa productos por ID y no mezcla nombres iguales', () => {
        const report = buildSupervisorProductReport([
            { tipo: 'VENTA', items: [{ id: 'p1', name: 'Agua', qty: 2, priceUsd: 1 }] },
            { tipo: 'VENTA', items: [{ id: 'p2', name: 'Agua', qty: 5, priceUsd: 2 }] },
            { tipo: 'VENTA', status: 'ANULADA', items: [{ id: 'p1', name: 'Agua', qty: 100, priceUsd: 1 }] },
        ]);

        expect(report).toHaveLength(2);
        expect(report.find(row => row.productId === 'p1')).toMatchObject({ quantity: 2, revenueUsd: 2, revenueBs: 0 });
        expect(report.find(row => row.productId === 'p2')).toMatchObject({ quantity: 5, revenueUsd: 10, revenueBs: 0 });
    });

    it('calcula unidades y montos del producto seleccionado', () => {
        const [report] = buildSupervisorProductReport([
            { tipo: 'VENTA', items: [{ id: 'p1', name: 'Arroz', qty: 2, priceUsd: 3, priceBs: 120 }] },
            { tipo: 'VENTA_FIADA', items: [{ id: 'p1', name: 'Arroz', quantity: 1, priceUsd: 3, priceBs: 120 }] },
        ]);

        expect(report).toMatchObject({
            productId: 'p1',
            quantity: 3,
            salesCount: 2,
            revenueUsd: 9,
            revenueBs: 360,
        });
    });

    it('separa autoconsumo de gastos que afectan caja', () => {
        const report = buildSupervisorExpenseReport([
            { id: 'cash-1', tipo: 'GASTO_INTERNO', category: 'servicios', totalUsd: -10, afectaCaja: true },
            { id: 'stock-1', tipo: 'GASTO_INTERNO', category: 'autoconsumo', isAutoconsumo: true, totalUsd: -5, afectaCaja: false },
            { id: 'supplier-1', tipo: 'PAGO_PROVEEDOR', totalUsd: -20, afectaCaja: true },
        ]);

        expect(report).toHaveLength(3);
        expect(report.find(row => row.id === 'stock-1')).toMatchObject({ isAutoconsumo: true, affectsCash: false });
        expect(report.find(row => row.id === 'supplier-1')).toMatchObject({ category: 'proveedor', affectsCash: true });
    });
});
