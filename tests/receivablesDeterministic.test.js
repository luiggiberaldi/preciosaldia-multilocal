// tests/receivablesDeterministic.test.js — FIA-REPORT-001
// Regresión de extremo a extremo del motor financiero sobre el dataset
// determinista v4.0 (102 ventas + abonos + excedente + Cashea + anulaciones).
//
// Tres capas de verificación:
//   1. El dataset es reproducible al bit (misma semilla ⇒ mismos datos).
//   2. Los agregados del reporte coinciden con los valores CONGELADOS.
//   3. Cada agregado coincide además con una suma INDEPENDIENTE hecha sobre los
//      registros crudos (nunca con el propio motor).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

import { buildDeterministicDataset, DETERMINISTIC_SALES_COUNT, DETERMINISTIC_SEED } from '../src/testing/deterministicDataset';
import { injectDeterministicSales } from '../src/testing/deterministicInjector';
import { calculateReportsData } from '../src/utils/reportsProcessor';
import { computeCarteraUsd } from '../src/utils/receivablesReport';
import { reconcileCustomersWithLedger } from '../src/utils/pocketReconciliation';
import { CUSTOMER_LEDGER_KEY } from '../src/utils/customerLedger';
import { round2 } from '../src/utils/dinero';
import { DETERMINISTIC_DATE, DETERMINISTIC_EXPECTED, DETERMINISTIC_PERIOD } from './fixtures/deterministicExpected';

const { from, to } = DETERMINISTIC_PERIOD;
const EXPECTED = DETERMINISTIC_EXPECTED;

const build = () => buildDeterministicDataset({ dateStr: DETERMINISTIC_DATE });

const runReport = (dataset) => calculateReportsData(
    dataset.sales, from, to, dataset.rate, dataset.products, dataset.customers
);

/** Importe en Bs de un pago, con el mismo contrato que el motor: `amount` si es BS. */
const bsAmountOf = (payment) => (payment.amountBs != null ? payment.amountBs : payment.amount);

/**
 * Suma independiente y naíva sobre los registros crudos.
 * El costo se resuelve por catálogo porque los ítems del dataset deterministico
 * no lo traen (así lo hace el motor: `_lookupProduct` por id/nombre).
 */
function sumRawByHand(sales, products = []) {
    const costOf = (item) => {
        if (item.costUsd != null) return item.costUsd;
        const product = products.find(p => p.id === item.id || p.name === item.name);
        return product?.costUsd || 0;
    };
    const totals = {
        fiadoUsd: 0, casheaUsd: 0, abonosUsd: 0, remesasUsd: 0, saldoFavorUsd: 0,
        usdMetodos: 0, bsMetodos: 0, ventasUsd: 0, items: 0, gananciaVentas: 0,
        vueltosUsd: 0, anuladas: 0, fiados: 0, cobranzas: 0, historial: 0,
    };
    sales.forEach(sale => {
        const esVenta = sale.tipo === 'VENTA' || sale.tipo === 'VENTA_FIADA' || sale.tipo === 'VENTA_CASHEA';
        // El historial del reporte NO filtra anuladas (igual que reportsProcessor).
        if (esVenta) totals.historial += 1;

        if (sale.status === 'ANULADA') { totals.anuladas += 1; return; }

        if (sale.tipo === 'VENTA_FIADA') {
            totals.fiados += 1;
            totals.fiadoUsd += sale.fiadoUsd != null ? sale.fiadoUsd : sale.totalUsd;
        }
        if (sale.tipo === 'VENTA_CASHEA') {
            totals.fiados += 1;
            totals.casheaUsd += sale.casheaUsd || 0;
        }
        if (sale.tipo === 'COBRO_DEUDA') {
            totals.cobranzas += 1;
            totals.abonosUsd += sale.totalUsd;
            totals.saldoFavorUsd += sale.saldoFavorGeneradoUsd || 0;
        }
        if (sale.tipo === 'COBRO_CASHEA') {
            totals.cobranzas += 1;
            totals.remesasUsd += sale.totalUsd;
        }
        if (esVenta) {
            totals.ventasUsd += sale.totalUsd;
            totals.items += (sale.items || []).reduce((acc, item) => acc + item.qty, 0);
            totals.gananciaVentas += (sale.items || []).reduce(
                (acc, item) => acc + (item.priceUsd - costOf(item)) * item.qty * sale.rate,
                0
            ) - (sale.discountAmountUsd || 0) * sale.rate;
        }
        (sale.payments || []).forEach(payment => {
            if (payment.isCashea || payment.methodId === 'cashea') return;
            if (payment.isInternalCredit || payment.currency === 'INTERNAL_CREDIT') return;
            if (payment.currency === 'USD') totals.usdMetodos += payment.amountUsd;
            if (payment.currency === 'BS') totals.bsMetodos += bsAmountOf(payment);
        });
        totals.vueltosUsd += sale.changeUsd || 0;
    });
    Object.keys(totals).forEach(key => { totals[key] = round2(totals[key]); });
    return totals;
}

describe('dataset determinista v4.0 — reproducibilidad', () => {
    it('dos construcciones con la misma fecha son idénticas al bit', () => {
        const first = build();
        const second = build();
        expect(JSON.stringify(second.sales)).toBe(JSON.stringify(first.sales));
        expect(JSON.stringify(second.customers)).toBe(JSON.stringify(first.customers));
        expect(JSON.stringify(second.ledger)).toBe(JSON.stringify(first.ledger));
        expect(JSON.stringify(second.products)).toBe(JSON.stringify(first.products));
    });

    it('conserva las 102 ventas originales y añade el bloque de cartera', () => {
        const { sales } = build();
        expect(sales.filter(s => String(s.id).startsWith('det_v3_')).length).toBe(DETERMINISTIC_SALES_COUNT);
        expect(sales.length).toBe(EXPECTED.totalRecords);
        expect(sales.filter(s => s.status === 'ANULADA').length).toBe(EXPECTED.voidedRecords);
        expect(DETERMINISTIC_SEED).toBe(12345);
    });

    it('el bloque de cartera tiene una muestra de cada tipo nuevo', () => {
        const { sales } = build();
        const byTipo = (tipo) => sales.filter(s => s.tipo === tipo && s.status !== 'ANULADA');
        expect(byTipo('COBRO_DEUDA').length).toBe(4);
        expect(byTipo('VENTA_CASHEA').length).toBe(2);
        expect(byTipo('COBRO_CASHEA').length).toBe(2);
        expect(byTipo('COBRO_DEUDA').some(s => s.saldoFavorGeneradoUsd > 0)).toBe(true);
        // Anulaciones explícitas de los dos tipos críticos.
        const anuladas = sales.filter(s => s.status === 'ANULADA');
        expect(anuladas.some(s => s.tipo === 'VENTA_FIADA')).toBe(true);
        expect(anuladas.some(s => s.tipo === 'COBRO_DEUDA')).toBe(true);
    });
});

describe('agregados congelados — motor vs literales', () => {
    const dataset = build();
    const report = runReport(dataset);
    const breakdown = report.paymentBreakdown;

    it('cuentas por cobrar: otorgado, cobranzas, neto', () => {
        expect(report.receivables.fiadoOtorgadoUsd).toBe(EXPECTED.fiadoOtorgadoUsd);
        expect(report.receivables.cobranzasUsd).toBe(EXPECTED.cobranzasUsd);
        expect(report.receivables.netoUsd).toBe(EXPECTED.netoUsd);
        expect(report.receivables.saldoFavorGeneradoUsd).toBe(EXPECTED.saldoFavorGeneradoUsd);
        expect(report.receivables.fiados.length).toBe(EXPECTED.fiadosCount);
        expect(report.receivables.cobranzas.length).toBe(EXPECTED.cobranzasCount);
        expect(report.receivables.movimientoCount).toBe(EXPECTED.movimientosCount);
    });

    it('el historial de ventas no incluye las cobranzas', () => {
        expect(report.historySales.length).toBe(EXPECTED.historySales);
        expect(report.historySales.length).toBe(sumRawByHand(dataset.sales, dataset.products).historial);
        expect(report.historySales.some(s => s.tipo === 'COBRO_DEUDA' || s.tipo === 'COBRO_CASHEA')).toBe(false);
        expect(report.salesForStats.length).toBe(EXPECTED.salesCountStats);
    });

    it('ventas y ganancia del período', () => {
        expect(report.totalUsd).toBe(EXPECTED.totalUsd);
        expect(report.totalBs).toBe(EXPECTED.totalBs);
        expect(report.totalItems).toBe(EXPECTED.totalItems);
        expect(report.profit).toBe(EXPECTED.profitBs);
    });

    it('buckets del motor: caja, fiado neto y saldo a favor generado', () => {
        expect(breakdown.efectivo_usd.total).toBe(EXPECTED.efectivoUsd);
        expect(breakdown.efectivo_bs.total).toBe(EXPECTED.efectivoBs);
        expect(breakdown.pago_movil.total).toBe(EXPECTED.pagoMovilBs);
        expect(breakdown.fiado.total).toBe(EXPECTED.fiadoBucketUsd);
        expect(breakdown.fiado.bsAtSaleRate).toBe(EXPECTED.fiadoBsAtSaleRate);
        expect(breakdown._saldo_favor_generado.total).toBe(EXPECTED.saldoFavorBucketUsd);
        expect(breakdown._saldo_favor_generado.origins).toEqual(EXPECTED.saldoFavorOrigins);
    });

    it('cartera por cliente derivada del ledger', () => {
        expect(report.carteraUsd).toBe(EXPECTED.carteraUsd);
        expect(computeCarteraUsd(dataset.customers)).toBe(EXPECTED.carteraUsd);
        EXPECTED.clientes.forEach(cliente => {
            const found = dataset.customers.find(c => c.id === cliente.id);
            expect(found.deuda).toBe(cliente.deudaUsd);
            expect(found.favor).toBe(cliente.favorUsd);
            expect(found.casheaDeuda || 0).toBe(cliente.casheaDeudaUsd);
        });
    });

    it('la conciliación del dataset cuadra (dataset consistente por construcción)', () => {
        const result = reconcileCustomersWithLedger(dataset.customers, dataset.ledger);
        expect(result.ok).toBe(EXPECTED.reconciliation.ok);
        expect(result.drift).toHaveLength(EXPECTED.reconciliation.drift);
        expect(result.checkedCount).toBe(EXPECTED.reconciliation.checkedCount);
        expect(result.ledgerOrphans).toHaveLength(EXPECTED.reconciliation.ledgerOrphans);
        expect(dataset.ledger.length).toBe(EXPECTED.ledgerMovements);
    });
});

describe('suma independiente — el motor no inventa ni pierde dinero', () => {
    const dataset = build();
    const report = runReport(dataset);
    const raw = sumRawByHand(dataset.sales, dataset.products);

    it('la cuenta por cobrar coincide con la suma cruda (fiado + Cashea)', () => {
        expect(round2(raw.fiadoUsd + raw.casheaUsd)).toBe(report.receivables.fiadoOtorgadoUsd);
        expect(raw.fiadoUsd).toBe(EXPECTED.fiadoSoloUsd);
        expect(raw.casheaUsd).toBe(EXPECTED.casheaOtorgadoUsd);
    });

    it('las cobranzas coinciden con la suma cruda (abonos + remesas)', () => {
        expect(round2(raw.abonosUsd + raw.remesasUsd)).toBe(report.receivables.cobranzasUsd);
        expect(raw.abonosUsd).toBe(EXPECTED.abonosUsd);
        expect(raw.remesasUsd).toBe(EXPECTED.remesasUsd);
        expect(raw.saldoFavorUsd).toBe(EXPECTED.saldoFavorGeneradoUsd);
    });

    it('la caja del motor es exactamente los pagos reales (sin fantasma)', () => {
        const bd = report.paymentBreakdown;
        expect(bd.efectivo_usd.total).toBe(raw.usdMetodos);
        expect(round2((bd.efectivo_bs?.total || 0) + (bd.pago_movil?.total || 0))).toBe(raw.bsMetodos);
        expect(bd.efectivo_cop).toBeUndefined();
        // Y ninguna venta anulada dejó rastro en la caja.
        expect(raw.anuladas).toBe(EXPECTED.voidedRecords);
        expect(bd.efectivo_usd.total).toBe(EXPECTED.efectivoUsd);
    });

    it('las ventas del reporte son solo las no anuladas (con su ganancia)', () => {
        expect(report.totalUsd).toBe(raw.ventasUsd);
        expect(report.totalItems).toBe(raw.items);
        // La ganancia se compara con tolerancia: el motor redondea (round2) en cada paso
        // intermedio y la suma a mano es continua, así que en ~500 líneas de ítem
        // aparecen centavos de deriva (medido: 0,28 Bs sobre 11.826 Bs = 0,0024%).
        // El valor EXACTO del motor está congelado en el test de agregados.
        const diffBs = Math.abs(report.profit - raw.gananciaVentas);
        expect(diffBs).toBeLessThanOrEqual(0.5);
        expect(diffBs / report.profit).toBeLessThan(0.0001);
        expect(report.profit).toBe(EXPECTED.profitBs);
    });

    it('el neto coincide con el bucket `fiado` del motor', () => {
        expect(report.paymentBreakdown.fiado.total).toBe(report.receivables.netoUsd);
    });
});

describe('persistencia determinista del inyector', () => {
    beforeEach(() => {
        _memoryStore.clear();
    });

    it('escribe ventas, productos, clientes y ledger sin tocar datos reales', async () => {
        await _memoryStore.set('bodega_sales_v1', [{ id: 'real-1', tipo: 'VENTA', totalUsd: 1, items: [] }]);

        const result = await injectDeterministicSales({ interactive: false });

        const sales = _memoryStore.get('bodega_sales_v1');
        const customers = _memoryStore.get('bodega_customers_v1');
        const ledger = _memoryStore.get(CUSTOMER_LEDGER_KEY);
        const products = _memoryStore.get('bodega_products_v1');

        expect(sales.some(s => s.id === 'real-1')).toBe(true);           // el dato real sigue ahí
        expect(sales.filter(s => String(s.id).startsWith('det_')).length).toBe(EXPECTED.totalRecords);
        expect(customers).toHaveLength(3);
        expect(products).toHaveLength(10);
        expect(ledger).toHaveLength(EXPECTED.ledgerMovements);

        // El reporte sobre lo persistido coincide con los agregados congelados.
        const stored = calculateReportsData(
            sales, from, to, result.dataset.rate, products, customers
        );
        expect(stored.receivables.netoUsd).toBe(EXPECTED.netoUsd);
        expect(stored.carteraUsd).toBe(EXPECTED.carteraUsd);
    });

    it('es idempotente: inyectar dos veces no duplica los registros det_', async () => {
        await injectDeterministicSales({ interactive: false });
        const first = JSON.parse(JSON.stringify(_memoryStore.get('bodega_sales_v1')));
        await injectDeterministicSales({ interactive: false });
        const second = _memoryStore.get('bodega_sales_v1');

        expect(second.length).toBe(first.length);
        expect(second.length).toBe(EXPECTED.totalRecords);
        expect(_memoryStore.get(CUSTOMER_LEDGER_KEY).length).toBe(EXPECTED.ledgerMovements);
        expect(_memoryStore.get('bodega_customers_v1')).toHaveLength(3);
    });
});
