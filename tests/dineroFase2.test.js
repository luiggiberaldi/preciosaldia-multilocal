import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fiadosHoy } from '../src/utils/modoJefe.js';

// M-14 (2026-10-01): fiadosHoy era asimétrico — la VENTA_CASHEA no sumaba a
// otorgado pero la remesa (COBRO_CASHEA) sí sumaba a cobrado.

const TODAY = '2026-10-01';
const ts = `${TODAY}T12:00:00.000Z`;

describe('M-14: fiadosHoy simétrico con Cashea', () => {
    it('la porción Cashea de una VENTA_CASHEA suma a otorgado', () => {
        const r = fiadosHoy([
            { tipo: 'VENTA_CASHEA', timestamp: ts, casheaUsd: 60, totalUsd: 100, fiadoUsd: 0 },
        ], TODAY);
        expect(r.otorgadoUsd).toBe(60);
        expect(r.otorgadoCount).toBe(1);
    });

    it('otorgado vs cobrado quedan simétricos tras la remesa', () => {
        const r = fiadosHoy([
            { tipo: 'VENTA_CASHEA', timestamp: ts, casheaUsd: 60, totalUsd: 100, fiadoUsd: 0 },
            { tipo: 'COBRO_CASHEA', timestamp: ts, totalUsd: 60 },
        ], TODAY);
        expect(r.otorgadoUsd).toBe(60);
        expect(r.cobradoUsd).toBe(60);
        expect(r.netoUsd).toBe(0);
    });

    it('VENTA_FIADA sigue contando igual que antes', () => {
        const r = fiadosHoy([
            { tipo: 'VENTA_FIADA', timestamp: ts, fiadoUsd: 100, totalUsd: 100 },
        ], TODAY);
        expect(r.otorgadoUsd).toBe(100);
    });
});

// M-15 (2026-10-01): anular una VENTA_FIADA con cobros parciales creaba favor
// fantasma. Ahora se bloquea con mensaje claro.

const __mem = new Map();
vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (k, d) => (__mem.has(k) ? __mem.get(k) : d)),
        setItem: vi.fn(async (k, v) => { __mem.set(k, v); }),
    },
}));
vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'u1', nombre: 'T', rol: 'dueno' } }) },
}));

const { processVoidSale } = await import('../src/utils/voidSaleProcessor.js');

describe('M-15: anular fiada con cobros se bloquea', () => {
    beforeEach(() => {
        __mem.clear();
        __mem.set('bodega_products_v1', []);
        __mem.set('bodega_customer_ledger_v1', []);
    });

    it('bloquea cuando la deuda actual es menor que el fiado original', async () => {
        // Fiada de $100, cliente abonó $40 → deuda $60.
        __mem.set('bodega_sales_v1', [
            { id: 's1', tipo: 'VENTA_FIADA', status: 'COMPLETADA', fiadoUsd: 100, totalUsd: 100, customerId: 'c1', items: [] },
        ]);
        __mem.set('bodega_customers_v1', [
            { id: 'c1', name: 'Juan', deuda: 60, favor: 0, casheaDeuda: 0 },
        ]);
        await expect(processVoidSale(
            { id: 's1', tipo: 'VENTA_FIADA', fiadoUsd: 100, totalUsd: 100, customerId: 'c1', items: [] },
            [], []
        )).rejects.toThrow(/cobros registrados/);
        // La deuda no se tocó.
        expect(__mem.get('bodega_customers_v1')[0].deuda).toBe(60);
    });

    it('permite anular cuando no hay cobros (deuda >= fiado)', async () => {
        __mem.set('bodega_sales_v1', [
            { id: 's2', tipo: 'VENTA_FIADA', status: 'COMPLETADA', fiadoUsd: 100, totalUsd: 100, customerId: 'c1', items: [] },
        ]);
        __mem.set('bodega_customers_v1', [
            { id: 'c1', name: 'Juan', deuda: 100, favor: 0, casheaDeuda: 0 },
        ]);
        const r = await processVoidSale(
            { id: 's2', tipo: 'VENTA_FIADA', fiadoUsd: 100, totalUsd: 100, customerId: 'c1', items: [] },
            [], []
        );
        expect(r).toBeDefined();
        expect(__mem.get('bodega_customers_v1')[0].deuda).toBe(0);
        expect(__mem.get('bodega_customers_v1')[0].favor).toBe(0);
    });
});

// ALTO-3 / ALTO-4 / ALTO-5: guardrails anti doble-submit.
describe('Fase 2: guardrails anti doble-submit', () => {
    it('ALTO-3: registrarGasto y registrarAutoconsumo tienen guardia in-flight', () => {
        const hook = readFileSync('src/hooks/useGastosInternos.js', 'utf8');
        expect(hook).toContain('inFlightRef');
        expect(hook).toContain("inFlightRef.current.has('gasto')");
        expect(hook).toContain("inFlightRef.current.has('autoconsumo')");
    });

    it('ALTO-4: anularGasto es idempotente (chequea ANULADA en storage fresco)', () => {
        const hook = readFileSync('src/hooks/useGastosInternos.js', 'utf8');
        expect(hook).toContain("inFlightRef.current.has(voidKey)");
        expect(hook).toContain("targetGasto.status === 'ANULADA'");
    });

    it('ALTO-5: handleTransaction y handleCasheaRemittance tienen guardia', () => {
        const view = readFileSync('src/views/CustomersView.jsx', 'utf8');
        expect(view).toContain('transactionInFlightRef');
        expect(view).toContain('isTransactionSubmitting');
    });

    it('M-13: el checkout bloquea fiados sobre el límite de crédito', () => {
        const proc = readFileSync('src/utils/checkoutProcessor.js', 'utf8');
        expect(proc).toContain('limiteCredito');
        expect(proc).toContain('Supera el límite de crédito del cliente');
    });
});
