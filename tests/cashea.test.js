// Arnés de regresión del módulo Cashea.
// MODELO DE NEGOCIO: Cashea le remesa a la bodega. El monto financiado es una
// CUENTA POR COBRAR A CASHEA, no dinero cobrado ni deuda del cliente.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { procesarImpactoCliente } from '../src/utils/financialLogic';

const RATE = 40;

/** Venta Cashea $100: 40% inicial en efectivo USD, 60% financiado por Cashea. */
function ventaCashea() {
    return {
        id: 'v-cashea-1',
        tipo: 'VENTA_CASHEA',
        rate: RATE,
        totalUsd: 100,
        totalBs: 4000,
        casheaUsd: 60,
        changeUsd: 0,
        changeBs: 0,
        payments: [
            { id: 'p1', methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 40, amountBs: 1600 },
            { id: 'p2', methodId: 'cashea', methodLabel: 'Cashea', currency: 'USD', amountUsd: 60, amountBs: 2400, isCashea: true, casheaPercent: 60 },
        ],
    };
}

/** Remesa de Cashea por $60, recibida en efectivo USD. */
function remesaCashea(monto = 60) {
    return {
        id: 'r-cashea-1',
        tipo: 'COBRO_CASHEA',
        rate: RATE,
        totalUsd: monto,
        totalBs: monto * RATE,
        changeUsd: 0,
        changeBs: 0,
        vueltoParaMonedero: 0,
        payments: [
            { methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amount: monto, amountUsd: monto, amountBs: monto * RATE },
        ],
    };
}

describe('Cashea — el financiado es una cuenta por cobrar, no ingreso', () => {
    const bd = FinancialEngine.calculatePaymentBreakdown([ventaCashea()]);

    it('crea el bucket cashea con el monto financiado', () => {
        expect(bd.cashea).toBeDefined();
        expect(bd.cashea.total).toBe(60);
    });

    it('marca el bucket como por-cobrar, NO como USD cobrado', () => {
        expect(bd.cashea.currency).toBe('FIADO');
        expect(bd.cashea.isReceivable).toBe(true);
    });

    it('lo etiqueta como "Cashea (Por Cobrar)"', () => {
        expect(bd.cashea.label).toBe('Cashea (Por Cobrar)');
    });

    it('el filtro de Reportes ya NO lo suma al neto USD', () => {
        // Réplica del filtro de ReportsMetricsTab.jsx
        const entries = Object.entries(bd).filter(([, d]) => d.total > 0);
        const usdMethods = entries.filter(([m, d]) => d.currency === 'USD' && m !== 'cashea' && !d.isChange);
        const subtotalUsd = usdMethods.reduce((s, [, d]) => s + d.total, 0);
        expect(subtotalUsd).toBe(40);
    });

    it('el arqueo de caja sigue esperando solo la inicial (no-regresión)', () => {
        const expectedUsd = (bd['efectivo_usd']?.total || 0) - (bd['_vuelto_usd']?.total || 0);
        expect(expectedUsd).toBe(40);
    });
});

describe('Cashea — la remesa cancela la cuenta por cobrar', () => {
    const bd = FinancialEngine.calculatePaymentBreakdown([ventaCashea(), remesaCashea(60)]);

    it('venta + remesa completa => por cobrar neto 0 (bucket filtrado)', () => {
        expect(!bd.cashea || bd.cashea.total === 0).toBe(true);
    });

    it('el dinero de la remesa SÍ entra como efectivo cobrado', () => {
        expect(bd['efectivo_usd'].total).toBe(100); // 40 inicial + 60 remesa
    });

    it('remesa parcial deja el remanente por cobrar', () => {
        const parcial = FinancialEngine.calculatePaymentBreakdown([ventaCashea(), remesaCashea(25)]);
        expect(parcial.cashea.total).toBe(35);
        expect(parcial.cashea.currency).toBe('FIADO');
    });
});

describe('Cashea — la lógica de cliente NO cambia (guardarraíl anti-regresión)', () => {
    it('la venta Cashea genera casheaDeuda, no deuda', () => {
        const c = procesarImpactoCliente(
            { id: 'c1', deuda: 0, favor: 0, casheaDeuda: 0 },
            { esCredito: true, esCashea: true, deudaGenerada: 60 },
        );
        expect(c.casheaDeuda).toBe(60);
        expect(c.deuda).toBe(0);
    });

    it('G1: un abono del cliente NUNCA toca casheaDeuda (el cliente no la debe)', () => {
        const c = procesarImpactoCliente(
            { id: 'c1', deuda: 0, favor: 0, casheaDeuda: 60 },
            { esCredito: false, deudaGenerada: 0, vueltoParaMonedero: 60 },
        );
        expect(c.casheaDeuda).toBe(60); // intacta: es plata de Cashea, no del cliente
        expect(c.favor).toBe(60);       // correcto: el cliente entregó $60 sin deber nada
    });
});

// ── Procesador de remesa ────────────────────────────────────────────────────
const __mem = new Map();
vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (k, d) => (__mem.has(k) ? __mem.get(k) : d)),
        setItem: vi.fn(async (k, v) => { __mem.set(k, v); }),
    },
}));

const { processCasheaRemittance } = await import('../src/utils/casheaRemittanceProcessor');

describe('processCasheaRemittance', () => {
    beforeEach(() => {
        __mem.clear();
        __mem.set('bodega_customers_v1', [{ id: 'c1', name: 'Juan', deuda: 0, favor: 0, casheaDeuda: 60 }]);
        __mem.set('bodega_sales_v1', []);
    });

    it('remesa total deja casheaDeuda en 0 y crea el registro COBRO_CASHEA', async () => {
        const r = await processCasheaRemittance({
            transactionAmount: '60', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.error).toBeUndefined();
        expect(r.updatedCustomer.casheaDeuda).toBe(0);

        const sales = __mem.get('bodega_sales_v1');
        expect(sales).toHaveLength(1);
        expect(sales[0].tipo).toBe('COBRO_CASHEA');
        expect(sales[0].totalUsd).toBe(60);
        expect(sales[0].vueltoParaMonedero).toBe(0);
    });

    it('remesa parcial deja el remanente pendiente', async () => {
        const r = await processCasheaRemittance({
            transactionAmount: '25', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.updatedCustomer.casheaDeuda).toBe(35);
    });

    it('NO toca deuda ni favor del cliente', async () => {
        const r = await processCasheaRemittance({
            transactionAmount: '60', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.updatedCustomer.deuda).toBe(0);
        expect(r.updatedCustomer.favor).toBe(0);
    });

    it('rechaza montos que exceden lo pendiente', async () => {
        const r = await processCasheaRemittance({
            transactionAmount: '500', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.error).toBeTruthy();
        expect(__mem.get('bodega_sales_v1')).toHaveLength(0);
    });

    it('rechaza clientes sin remesa pendiente', async () => {
        __mem.set('bodega_customers_v1', [{ id: 'c1', name: 'Juan', deuda: 0, favor: 0, casheaDeuda: 0 }]);
        const r = await processCasheaRemittance({
            transactionAmount: '10', currencyMode: 'USD',
            customer: { id: 'c1', name: 'Juan' },
            paymentMethod: 'efectivo_usd', bcvRate: 40, tasaCop: 0, copEnabled: false,
        });
        expect(r.error).toBeTruthy();
    });
});
