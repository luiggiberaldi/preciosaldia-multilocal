import { describe, expect, it } from 'vitest';
import {
    buildSupervisorRegisterCloses,
    calculateSupervisorPaymentBreakdown,
    calculateSupervisorSalesMetrics,
    normalizeProduct,
    normalizeReconciliation,
    normalizeSale,
} from '../src/services/supervisorFinancials';
import { validateSupervisorCommand } from '../src/services/supervisorContracts';

describe('Supervisor financial contract', () => {
    it('normaliza nombres legacy sin cambiar el documento original', () => {
        const legacy = { id: 'p1', priceUsdt: '5', costPrice: '2', minStock: '3', stock: '4' };
        const normalized = normalizeProduct(legacy);

        expect(normalized).toMatchObject({ priceUsd: 5, costUsd: 2, lowStockAlert: 3, stock: 4 });
        expect(legacy).toEqual({ id: 'p1', priceUsdt: '5', costPrice: '2', minStock: '3', stock: '4' });
    });

    it('mantiene null como ausencia de arqueo COP y no produce NaN', () => {
        const normalized = normalizeReconciliation({ expectedCop: 12000, cashCop: null });
        const sale = normalizeSale({ totalUsd: null, totalBs: undefined, items: [{ qty: null }] });

        expect(normalized).toMatchObject({ expectedCop: 12000, cashCop: null });
        expect(sale).toMatchObject({ totalUsd: 0, totalBs: 0 });
        expect(Number.isNaN(sale.items[0].qty)).toBe(false);
    });

    it('netea cobranzas contra el fiado sin alterar el efectivo recibido', () => {
        const breakdown = calculateSupervisorPaymentBreakdown([
            {
                tipo: 'VENTA_FIADA',
                totalUsd: 10,
                totalBs: 1000,
                fiadoUsd: 6,
                rate: 100,
                payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 4, amountBs: 400 }],
            },
            {
                tipo: 'COBRO_DEUDA',
                totalUsd: 6,
                totalBs: 600,
                payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 6, amountBs: 600 }],
            },
        ], 100);

        const fiado = breakdown.find(([key]) => key === 'fiado')?.[1];
        const efectivo = breakdown.find(([key]) => key === 'efectivo_usd')?.[1];
        expect(fiado).toMatchObject({ totalUsd: 0, totalBs: 0, isReceivable: true });
        expect(efectivo).toMatchObject({ totalUsd: 10, totalBs: 1000 });
    });

    it('usa el mismo cálculo de margen del FinancialEngine cuando el item tiene precio', () => {
        const result = calculateSupervisorSalesMetrics([
            {
                tipo: 'VENTA',
                totalUsd: 20,
                totalBs: 2_000,
                items: [{ id: 'p1', priceUsd: 10, costUsd: 4, qty: 2 }],
            },
        ], [{ id: 'p1', costUsd: 4 }], 100);

        expect(result.revenueUsd).toBe(20);
        expect(result.costUsd).toBe(8);
        expect(result.profitUsd).toBe(12);
        expect(result.profitBs).toBe(1200);
    });

    it('separa saldo aplicado y saldo generado sin llevarlo al efectivo', () => {
        const breakdown = calculateSupervisorPaymentBreakdown([
            {
                tipo: 'VENTA', totalUsd: 5, totalBs: 500, vueltoParaMonedero: 5,
                payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10 }],
            },
            {
                tipo: 'VENTA', totalUsd: 5, totalBs: 500,
                payments: [{ methodId: 'saldo_favor', currency: 'INTERNAL_CREDIT', amountUsd: 5 }],
            },
        ], 100);
        expect(breakdown).toEqual(expect.arrayContaining([
            expect.arrayContaining(['saldo_favor_generado', expect.objectContaining({ totalUsd: 5, isWalletCredit: true, currency: 'INTERNAL_CREDIT' })]),
            expect.arrayContaining(['saldo_favor', expect.objectContaining({ totalUsd: 5, isInternalCredit: true })]),
        ]));
    });

    it('usa el desglose canónico e incluye apertura COP sin romper pagos', () => {
        const breakdown = calculateSupervisorPaymentBreakdown([
            { tipo: 'APERTURA_CAJA', openingCop: 12000, openingBs: 100 },
            { tipo: 'VENTA', totalBs: 100, payments: [{ methodId: 'efectivo_bs', currency: 'BS', amount: 100, amountBs: 100 }] },
        ], 100);

        expect(breakdown).toEqual(expect.arrayContaining([
            expect.arrayContaining(['efectivo_bs', expect.objectContaining({ totalBs: 200 })]),
        ]));
        const close = buildSupervisorRegisterCloses([
            { id: 'open', tipo: 'APERTURA_CAJA', openingCop: 12000, cierreId: 1 },
            { id: 'close', tipo: 'REGISTRO_CIERRE', cierreId: 1, summary: {} },
        ])[0];
        expect(close.canonicalBreakdown.efectivo_cop.total).toBe(12000);
    });

    it('agrupa por cierreId explícito y no mezcla dos turnos', () => {
        const closes = buildSupervisorRegisterCloses([
            { id: 'open-a', tipo: 'APERTURA_CAJA', openingBs: 100, timestamp: '2026-08-09T08:00:00Z', cierreId: 101 },
            { id: 'sale-a', tipo: 'VENTA', totalUsd: 10, totalBs: 1000, items: [], cierreId: 101 },
            { id: 'close-a', tipo: 'REGISTRO_CIERRE', cierreId: 101, timestamp: '2026-08-09T12:00:00Z', summary: {} },
            { id: 'open-b', tipo: 'APERTURA_CAJA', openingBs: 200, timestamp: '2026-08-09T13:00:00Z', cierreId: 202 },
            { id: 'sale-b', tipo: 'VENTA', totalUsd: 20, totalBs: 2000, items: [], cierreId: 202 },
            { id: 'close-b', tipo: 'REGISTRO_CIERRE', cierreId: 202, timestamp: '2026-08-09T18:00:00Z', summary: {} },
        ], [], 100);

        expect(closes).toHaveLength(2);
        expect(closes.find(close => close.cierreId === 101).totalUsd).toBe(10);
        expect(closes.find(close => close.cierreId === 202).totalUsd).toBe(20);
        expect(closes.find(close => close.cierreId === 101).sales).not.toContainEqual(expect.objectContaining({ id: 'sale-b' }));
    });

    it('requiere cierreId junto con shiftId para cerrar o reabrir', () => {
        const base = {
            commandId: 'command-shift-1',
            type: 'supervisor.shift.close',
            monitorDeviceId: 'monitor-1',
            targetDeviceId: 'primary-1',
            issuedAt: 1_000,
            expiresAt: 50_000,
            payload: { shiftId: 'open-a' },
        };
        expect(validateSupervisorCommand(base, {
            targetDeviceId: 'primary-1',
            monitorDeviceId: 'monitor-1',
            now: 2_000,
        }).valid).toBe(false);
        expect(validateSupervisorCommand({ ...base, payload: { shiftId: 'open-a', cierreId: 'close-a' } }, {
            targetDeviceId: 'primary-1',
            monitorDeviceId: 'monitor-1',
            now: 2_000,
        }).valid).toBe(true);
    });
});
