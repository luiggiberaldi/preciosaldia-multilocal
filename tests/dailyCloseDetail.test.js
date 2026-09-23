import { describe, it, expect, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { describeSaleSettlement, formatBreakdownValue, generateDailyClosePDF } from '../src/utils/dailyCloseGenerator.js';

// Se captura el documento jsPDF real para poder auditar el contenido serializado.
const { documentos } = vi.hoisted(() => ({ documentos: [] }));
vi.mock('jspdf', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        jsPDF: class extends actual.jsPDF {
            constructor(...args) {
                super(...args);
                documentos.push(this);
            }
        },
    };
});

const RATE = 849.56;

const fiadoTotal = {
    id: 'v-fiada',
    tipo: 'VENTA_FIADA',
    totalUsd: 20,
    totalBs: 16991.2,
    fiadoUsd: 20,
    rate: RATE,
    customerName: 'juan perez',
    items: [{ name: 'Prestobarba Dorco', qty: 1, priceUsd: 2 }],
    payments: [],
};

describe('describeSaleSettlement — el detalle del cierre debe decir el método de pago', () => {
    it('FIA-1: venta 100% fiada nombra el FIADO aunque no tenga pagos', () => {
        const r = describeSaleSettlement(fiadoTotal);
        expect(r.methodLine).toBe('FIADO (Por Cobrar) $20.00');
        expect(r.creditUsd).toBe(20);
        expect(r.creditBs).toBe(16991.2);
        expect(r.tags).toEqual([{ text: 'FIADO $20.00', tone: 'credit' }]);
    });

    it('FIA-2: fiado parcial muestra el pago real y la parte fiada por separado', () => {
        const r = describeSaleSettlement({
            ...fiadoTotal,
            payments: [{ methodId: 'efectivo_upd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 5 }],
            fiadoUsd: 15,
        });
        expect(r.methodLine).toBe('Efectivo $ $5.00 + FIADO (Por Cobrar) $15.00');
        expect(r.creditUsd).toBe(15);
    });

    it('FIA-3: venta Cashea separa la cuota inicial del monto financiado', () => {
        const r = describeSaleSettlement({
            id: 'v-cashea',
            tipo: 'VENTA_CASHEA',
            totalUsd: 30,
            totalBs: 25486.8,
            casheaUsd: 21,
            rate: RATE,
            payments: [
                { methodId: 'cashea', methodLabel: 'Cashea', currency: 'USD', amountUsd: 21 },
                { methodId: 'efectivo_upd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 9 },
            ],
        });
        expect(r.methodLine).toBe('Efectivo $ $9.00 + CASHEA (Por Cobrar) $21.00');
        expect(r.tags).toEqual([{ text: 'CASHEA $21.00', tone: 'credit' }]);
    });

    it('FIA-4: venta cobrada dice su método con el monto, sin etiqueta de crédito', () => {
        const r = describeSaleSettlement({
            id: 'v-bs',
            tipo: 'VENTA',
            totalUsd: 5,
            totalBs: 4247.8,
            rate: RATE,
            payments: [{ methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs', currency: 'BS', amountBs: 4247.8, amountUsd: 5 }],
        });
        expect(r.methodLine).toBe('Efectivo Bs Bs 4.247,80');
        expect(r.tags).toEqual([]);
        expect(r.creditUsd).toBe(0);
    });

    it('FIA-5: venta fiada anulada conserva ambas marcas', () => {
        const r = describeSaleSettlement({ ...fiadoTotal, status: 'ANULADA' });
        expect(r.tags.map(t => t.text)).toEqual(['ANULADA', 'FIADO $20.00']);
    });

    it('FIA-6: un abono de deuda se identifica como tal y declara el método cobrado', () => {
        const r = describeSaleSettlement({
            id: 'abono',
            tipo: 'COBRO_DEUDA',
            totalUsd: 12,
            totalBs: 10194.72,
            rate: RATE,
            payments: [{ methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs', currency: 'BS', amountBs: 10194.72, amountUsd: 12 }],
        });
        expect(r.methodLine).toBe('Efectivo Bs Bs 10.194,72');
        expect(r.tags).toEqual([{ text: 'ABONO DE DEUDA', tone: 'info' }]);
    });

    it('FIA-7: apertura de caja no queda como método vacío', () => {
        const r = describeSaleSettlement({ tipo: 'APERTURA_CAJA', openingUsd: 10, openingBs: 5000 });
        expect(r.methodLine).toBe('Fondo inicial');
        expect(r.tags).toEqual([]);
    });

    it('FIA-8: venta legacy sin payments cae a su paymentMethod', () => {
        const r = describeSaleSettlement({ tipo: 'VENTA', totalUsd: 3, totalBs: 2548.68, rate: RATE, paymentMethod: 'pago_movil' });
        expect(r.methodLine).toContain('Pago Móvil $3.00');
    });
});

describe('PDF detallado del cierre (descarga a carta)', () => {
    const allSales = [
        fiadoTotal,
        { ...fiadoTotal, id: 'v-fiada-anulada', status: 'ANULADA', totalUsd: 8, totalBs: 6796.48, fiadoUsd: 8, customerName: 'ana' },
        {
            id: 'v-cashea', tipo: 'VENTA_CASHEA', totalUsd: 30, totalBs: 25486.8, casheaUsd: 21, rate: RATE,
            customerName: 'luis', items: [{ name: 'Pan', qty: 2, priceUsd: 1 }],
            payments: [
                { methodId: 'cashea', methodLabel: 'Cashea', currency: 'USD', amountUsd: 21 },
                { methodId: 'efectivo_upd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 9 },
            ],
        },
        {
            id: 'abono', tipo: 'COBRO_DEUDA', totalUsd: 8, totalBs: 6796.48, rate: RATE, customerName: 'juan perez',
            payments: [{ methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs', currency: 'BS', amountBs: 6796.48, amountUsd: 8 }],
            items: [{ name: 'Abono de deuda', qty: 1, priceUsd: 8 }],
        },
        {
            id: 'gasto', tipo: 'GASTO_INTERNO', afectaCaja: true, category: 'insumos', description: 'Bolsas',
            totalUsd: -3, totalBs: -2548.68, rate: RATE, afectaCajaUi: true,
            payments: [{ methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs', currency: 'BS', amountBs: -2548.68, amountUsd: -3 }],
        },
        { id: 'apertura', tipo: 'APERTURA_CAJA', openingUsd: 10, openingBs: 5000 },
    ];

    const paymentBreakdown = {
        efectivo_bs: { total: 25389.44, currency: 'BS', label: 'Efectivo Bs' },
        efectivo_usd: { total: 44, currency: 'USD', label: 'Efectivo $' },
        fiado: { total: 21, currency: 'FIADO', label: 'Fiado (Por Cobrar)', isReceivable: true },
        cashea: { total: 21, currency: 'FIADO', label: 'Cashea (Por Cobrar)', isReceivable: true },
        _saldo_favor_generado: { total: 5, currency: 'INTERNAL_CREDIT', label: 'Saldo a Favor Generado', isInternalCredit: true },
    };

    it('FIA-11: se genera sin errores con fiado, Cashea, abono, gasto, apertura y una anulada', async () => {
        // jsdom no carga imágenes ni descarga archivos: se neutralizan ambos efectos.
        vi.stubGlobal('Image', class { set src(_v) { setTimeout(() => this.onerror?.(new Error('sin imagen'))); } });
        // jsPDF descarga con URL.createObjectURL + un <a download>: se neutraliza la descarga real.
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:cid'), revokeObjectURL: vi.fn() }));
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        documentos.length = 0;

        await expect(generateDailyClosePDF({
            action: 'download',
            sales: allSales.filter(s => s.tipo !== 'APERTURA_CAJA'),
            allSales,
            bcvRate: RATE,
            paymentBreakdown,
            topProducts: [{ name: 'Prestobarba Dorco', qty: 3, revenue: 6 }],
            todayTotalUsd: 58,
            todayTotalBs: 49274.48,
            todayProfit: 17000, // la fila «Ganancia Estimada Bs» se imprime en Bs
            todayItemsSold: 6,
            reconData: { expectedUsd: 44, expectedBs: 25389.44, cashUsd: 44, cashBs: 25389.44, diffUsd: 0, diffBs: 0 },
            apertura: allSales[5],
            carteraUsd: 53.19,
        })).resolves.toBeUndefined();

        // El PDF se serializó de verdad: su contenido trae las marcas nuevas.
        expect(documentos).toHaveLength(1);
        const pdfText = Buffer.from(documentos[0].output('arraybuffer')).toString('latin1');
        expect(pdfText).toContain('DETALLE INDIVIDUAL DE TRANSACCIONES');
        expect(pdfText).toContain('todo de Pago'); // «Artículos / Método de Pago» (los acentos van escapados)
        expect(pdfText).toContain('FIADO \\(Por Cobrar\\)');
        expect(pdfText).toContain('CASHEA \\(Por Cobrar\\)');
        expect(pdfText).toContain('ABONO DE DEUDA');
        expect(pdfText).toContain('ANULADA');
        expect(pdfText).toContain('no entraron a la caja');
        // Las cuentas por cobrar ya no se imprimen como Bs.
        expect(pdfText).toContain('\\(por cobrar\\)');
        // Antes, el bucket de Cashea ($21) se imprimía como «Bs 21,00».
        expect(pdfText).not.toContain('Bs 21,00');
        expect(pdfText).not.toContain('Bs 20,00');

        // FIA-CIERRE-001: el resumen del día cierra el PDF con el puente entre
        // lo devengado y la caja (ventas netas / cobrado / créditos / ganancia).
        expect(pdfText).toContain('RESUMEN DEL D');
        expect(pdfText).toContain('Ventas netas del d');
        expect(pdfText).toContain('Cobrado de esas ventas');
        expect(pdfText).toContain('Cobranzas de deudas anteriores');
        expect(pdfText).toContain('devengada');
        expect(pdfText).toContain('Cartera pendiente al cierre');
        expect(pdfText).toContain('no forman parte del efectivo esperado');
        expect(pdfText).toContain('VENTAS Y COBROS');
        expect(pdfText).toContain('DITOS Y RESULTADO'); // «CRÉDITOS Y RESULTADO»
        // El bloque aparece una sola vez: no duplica cifras en el cierre.
        expect(pdfText.match(/RESUMEN DEL D/g)).toHaveLength(1);
        vi.mocked(HTMLAnchorElement.prototype.click).mockRestore();
        vi.unstubAllGlobals();
    });
});

describe('paginación del PDF carta', () => {
    it('FIA-14: el resumen del día no empuja un día chico a una segunda página', async () => {
        vi.stubGlobal('Image', class { set src(_v) { setTimeout(() => this.onerror?.(new Error('sin imagen'))); } });
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:cid'), revokeObjectURL: vi.fn() }));
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        documentos.length = 0;

        const diaChico = [
            fiadoTotal,
            {
                id: 'abono', tipo: 'COBRO_DEUDA', totalUsd: 8, totalBs: 6796.48, rate: RATE,
                payments: [{ methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs', currency: 'BS', amountBs: 6796.48, amountUsd: 8 }],
            },
        ];

        await generateDailyClosePDF({
            action: 'download',
            sales: diaChico,
            allSales: diaChico,
            bcvRate: RATE,
            paymentBreakdown: {},
            topProducts: [],
            todayTotalUsd: 20,
            todayTotalBs: 16991.2,
            todayProfit: 5000,
            todayItemsSold: 1,
            carteraUsd: 53.19,
        });

        expect(documentos).toHaveLength(1);
        // Dos columnas de resumen dentro de una sola página carta.
        expect(documentos[0].getNumberOfPages()).toBe(1);
        vi.mocked(HTMLAnchorElement.prototype.click).mockRestore();
        vi.unstubAllGlobals();
    });
});

describe('PDF ticket del cierre (58 mm)', () => {
    it('FIA-13: el ticket imprime el RESUMEN DEL DÍA con etiquetas cortas', async () => {
        vi.stubGlobal('Image', class { set src(_v) { setTimeout(() => this.onerror?.(new Error('sin imagen'))); } });
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:cid'), revokeObjectURL: vi.fn() }));
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        documentos.length = 0;

        const ticketSales = [
            fiadoTotal,
            {
                id: 'v-cashea', tipo: 'VENTA_CASHEA', totalUsd: 30, totalBs: 25486.8, casheaUsd: 21, rate: RATE,
                payments: [{ methodId: 'efectivo_upd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 9 }],
            },
            {
                id: 'abono', tipo: 'COBRO_DEUDA', totalUsd: 8, totalBs: 6796.48, rate: RATE,
                payments: [{ methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs', currency: 'BS', amountBs: 6796.48, amountUsd: 8 }],
            },
        ];

        await expect(generateDailyClosePDF({
            action: 'share',
            sales: ticketSales,
            allSales: ticketSales,
            bcvRate: RATE,
            paymentBreakdown: { efectivo_bs: { total: 6796.48, currency: 'BS', label: 'Efectivo Bs' } },
            topProducts: [],
            todayTotalUsd: 58,
            todayTotalBs: 49274.48,
            todayProfit: 17000,
            todayItemsSold: 3,
            carteraUsd: 53.19,
        })).resolves.toBeUndefined();

        expect(documentos).toHaveLength(1);
        const pdfText = Buffer.from(documentos[0].output('arraybuffer')).toString('latin1');
        expect(pdfText).toContain('RESUMEN DEL D');
        expect(pdfText).toContain('Ventas netas');
        expect(pdfText).toContain('Cobrado');
        expect(pdfText).toContain('A cr'); // «A crédito (por cobrar)»
        expect(pdfText).toContain('ditos: Fiado');
        expect(pdfText).toContain('ditos: Cashea');
        expect(pdfText).toContain('Cobranzas previas');
        expect(pdfText).toContain('Ganancia estimada');
        expect(pdfText).toContain('Cartera pendiente');
        // El alto del ticket debe reservar las filas nuevas: sin eso, jsPDF recorta.
        expect(documentos[0].internal.pageSize.getHeight()).toBeGreaterThan(120);
        vi.mocked(HTMLAnchorElement.prototype.click).mockRestore();
        vi.unstubAllGlobals();
    });
});

describe('geometría de la columna del cliente (M+18 → M+68 = 50 mm)', () => {
    it('FIA-12: el nombre truncado y las etiquetas caben sin invadir la columna de detalle', () => {
        const doc = new jsPDF('p', 'mm', 'letter');
        const ANCHO = 50;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        // El nombre se trunca a 34 caracteres: el caso realista más largo cabe.
        const nombre = 'maria alejandra rodriguez mendoza';
        expect(nombre.length).toBeLessThanOrEqual(34);
        expect(doc.getTextWidth(nombre)).toBeLessThan(ANCHO);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        ['ANULADA', 'ABONO DE DEUDA', 'REMESA CASHEA', 'CASHEA $21.00', 'FIADO $16991.20'].forEach(tag => {
            expect(doc.getTextWidth(tag), tag).toBeLessThan(ANCHO);
        });
    });
});

describe('formatBreakdownValue — las cuentas por cobrar no son Bs', () => {
    it('FIA-9: fiado y Cashea se imprimen en dólares y marcados como por cobrar', () => {
        expect(formatBreakdownValue({ total: 11, currency: 'FIADO', isReceivable: true })).toBe('$11.00 (por cobrar)');
        expect(formatBreakdownValue({ total: -7, currency: 'FIADO', label: 'Fiado (Por Cobrar)' })).toBe('$-7.00 (por cobrar)');
    });

    it('FIA-10: cada moneda conserva su formato', () => {
        expect(formatBreakdownValue({ total: 44, currency: 'USD' })).toBe('$44.00');
        expect(formatBreakdownValue({ total: 25389.44, currency: 'BS' })).toBe('Bs 25.389,44');
        expect(formatBreakdownValue({ total: 12000, currency: 'COP' })).toBe('12.000 COP');
        expect(formatBreakdownValue({ total: 5, currency: 'INTERNAL_CREDIT', isInternalCredit: true })).toBe('$5.00 (crédito interno)');
    });
});
