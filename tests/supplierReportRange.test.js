import { beforeEach, describe, expect, it, vi } from 'vitest';

const openPrintWindow = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/printerUtils', () => ({ openPrintWindow }));

// jsPDF simulado: registra los textos y el nombre del archivo guardado.
const pdfState = vi.hoisted(() => ({ texts: [], saved: null }));
vi.mock('jspdf', () => {
    const make = () => new Proxy(function () {}, {
        get(_t, p) {
            if (p === Symbol.toPrimitive) return () => 0;
            if (p === 'then') return undefined;
            if (p === 'text') return (s) => { pdfState.texts.push(Array.isArray(s) ? s.join(' ') : String(s)); return make(); };
            if (p === 'save') return (name) => { pdfState.saved = name; return make(); };
            return make();
        },
        apply() { return make(); },
    });
    class FakeJsPDF { constructor() { return make(); } }
    return { jsPDF: FakeJsPDF };
});

import {
    buildSupplierActivityLines,
    buildSupplierReportTicketHtml,
    filterActivityByRange,
    printSupplierReportThermal,
    rangeLabel,
} from '../src/utils/supplierReportRange';
import { getPaperConfig } from '../src/utils/ticketConstants';
import { generateGlobalSuppliersPDF, generateSupplierHistoryPDF } from '../src/utils/supplierReportGenerator';

// Fechas construidas en hora local para que el día local no dependa de la zona del runner.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();

const invoices = [
    { id: 'f1', invoiceNumber: 'A-1', date: at(2026, 10, 1), amountUsd: 10 },
    { id: 'f2', invoiceNumber: 'A-2', date: at(2026, 10, 5), amountUsd: 20 },
    { id: 'f3', invoiceNumber: 'A-3', date: at(2026, 9, 20), amountUsd: 99 },
];
const payments = [
    { id: 'p1', tipo: 'PAGO_PROVEEDOR', timestamp: at(2026, 10, 3), totalUsd: -4 },
    { id: 'p2', tipo: 'PAGO_PROVEEDOR', timestamp: at(2026, 10, 9), totalUsd: -6 },
];

beforeEach(() => {
    openPrintWindow.mockClear();
    localStorage.clear();
});

describe('filterActivityByRange', () => {
    it('incluye los extremos del rango y excluye lo que queda fuera', () => {
        const kept = filterActivityByRange(invoices, '2026-10-01', '2026-10-05').map(i => i.id);
        expect(kept).toEqual(['f1', 'f2']);
    });

    it('sin límites devuelve todo; con rango excluye registros sin fecha', () => {
        expect(filterActivityByRange(invoices)).toBe(invoices);
        const noDate = [{ id: 'x', amountUsd: 1 }];
        expect(filterActivityByRange(noDate)).toBe(noDate);
        expect(filterActivityByRange(noDate, '2026-10-01', '')).toEqual([]);
    });

    it('acepta solo desde o solo hasta', () => {
        expect(filterActivityByRange(invoices, '2026-10-05', '').map(i => i.id)).toEqual(['f2']);
        expect(filterActivityByRange(invoices, '', '2026-09-30').map(i => i.id)).toEqual(['f3']);
    });
});

describe('rangeLabel', () => {
    it('describe el rango en formato local', () => {
        expect(rangeLabel('2026-10-01', '2026-10-09')).toBe('Del 01/10/2026 al 09/10/2026');
        expect(rangeLabel('2026-10-01', '')).toBe('Desde 01/10/2026');
        expect(rangeLabel('', '2026-10-09')).toBe('Hasta 09/10/2026');
        expect(rangeLabel('', '')).toBe('Todo el historial');
    });
});

describe('buildSupplierActivityLines', () => {
    it('suma facturas, resta pagos y deja el neto dentro del rango', () => {
        const r = buildSupplierActivityLines({ invoices, payments, desde: '2026-10-01', hasta: '2026-10-05' });
        expect(r.facturasUsd).toBe(30);
        expect(r.pagosUsd).toBe(4);
        expect(r.netoUsd).toBe(26);
        // Orden descendente por fecha: factura del 5, pago del 3, factura del 1.
        expect(r.lines.map(l => l.kind)).toEqual(['factura', 'pago', 'factura']);
    });

    it('sin rango incluye todo el historial', () => {
        const r = buildSupplierActivityLines({ invoices, payments });
        expect(r.facturasUsd).toBe(129);
        expect(r.pagosUsd).toBe(10);
    });
});

describe('buildSupplierReportTicketHtml', () => {
    const paperConfig = getPaperConfig('58');

    it('imprime totales, rango y escapa el nombre del negocio', () => {
        const { lines, facturasUsd, pagosUsd, netoUsd } = buildSupplierActivityLines({ invoices, payments, desde: '2026-10-01' });
        const html = buildSupplierReportTicketHtml({
            businessName: '<script>x</script> Bodega',
            title: 'Reporte',
            rangeText: 'Desde 01/10/2026',
            lines,
            totals: { facturasUsd, pagosUsd, netoUsd },
            paperConfig,
        });
        expect(html).toContain('Saldo neto');
        expect(html).toContain('Desde 01/10/2026');
        expect(html).toContain(`size: ${paperConfig.cssPageSize}`);
        expect(html).not.toContain('<script>x</script>');
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt; Bodega');
    });

    it('sin movimientos muestra un aviso en lugar de filas vacías', () => {
        const html = buildSupplierReportTicketHtml({ lines: [], paperConfig });
        expect(html).toContain('Sin movimientos en el rango');
    });
});

describe('PDF de proveedores por rango', () => {
    beforeEach(() => { pdfState.texts.length = 0; pdfState.saved = null; });

    it('estado de cuenta: filtra fuera de rango y muestra el rango en la cabecera', async () => {
        await generateSupplierHistoryPDF({
            supplier: { name: 'Acme' },
            // El historial real marca las facturas con type 'INVOICE' (como en useSupplierManagement).
            historyData: [...invoices.map(i => ({ ...i, type: 'INVOICE' })), ...payments],
            desde: '2026-10-01',
            hasta: '2026-10-05',
        });
        const all = pdfState.texts.join('\n');
        expect(all).toContain('Del 01/10/2026 al 05/10/2026');
        expect(all).toContain('A-1');
        expect(all).not.toContain('A-3');
        expect(pdfState.saved).toBe('Estado_Cuenta_Acme.pdf');
    });

    it('reporte global: genera con rango y excluye facturas fuera del rango', async () => {
        await generateGlobalSuppliersPDF({
            suppliers: [{ id: 's1', name: 'Acme', deuda: 5 }],
            invoices,
            allSales: payments,
            desde: '2026-10-01',
            hasta: '2026-10-05',
        });
        const all = pdfState.texts.join('\n');
        expect(all).toContain('Del 01/10/2026 al 05/10/2026');
        expect(all).not.toContain('A-3');
        expect(pdfState.saved).toMatch(/^Reporte_Global_Proveedores_.*\.pdf$/);
    });
});

describe('printSupplierReportThermal', () => {
    it('usa el ancho de papel y el nombre de negocio guardados, y filtra por rango', () => {
        localStorage.setItem('printer_paper_width', '80');
        localStorage.setItem('business_name', 'Mi Bodega');
        printSupplierReportThermal({ invoices, payments, desde: '2026-10-01', hasta: '2026-10-05', supplierName: 'Proveedor X' });
        expect(openPrintWindow).toHaveBeenCalledTimes(1);
        const html = openPrintWindow.mock.calls[0][0];
        expect(html).toContain('Mi Bodega');
        expect(html).toContain('Proveedor X');
        expect(html).toContain(`size: ${getPaperConfig('80').cssPageSize}`);
        expect(html).toContain('Del 01/10/2026 al 05/10/2026');
        expect(html).toContain('$26.00');
    });
});
