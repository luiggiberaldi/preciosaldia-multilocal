import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateDailyClosePDF } from '../src/utils/dailyCloseGenerator.js';

// Se captura el documento jsPDF real para auditar el contenido serializado.
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
const aporte = {
    id: 'aporte_1',
    tipo: 'APORTE_CAJA',
    aporteUsd: 20,
    aporteBs: 1000,
    aporteCop: 0,
    motivo: 'cambio billetes',
    registradoPor: 'Ana',
    timestamp: '2026-10-09T15:00:00.000Z',
    cajaCerrada: false,
};

async function pdfText(extra) {
    await generateDailyClosePDF({
        action: 'share',
        sales: [],
        allSales: [],
        bcvRate: RATE,
        paymentBreakdown: {},
        topProducts: [],
        todayTotalUsd: 0,
        todayTotalBs: 0,
        todayProfit: 0,
        todayItemsSold: 0,
        ...extra,
    });
    const doc = documentos[documentos.length - 1];
    return { text: Buffer.from(doc.output('arraybuffer')).toString('latin1'), height: doc.internal.pageSize.getHeight() };
}

describe('PDF de cierre: aportes de efectivo', () => {
    beforeEach(() => {
        vi.stubGlobal('Image', class { set src(_v) { setTimeout(() => this.onerror?.(new Error('sin imagen'))); } });
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:cid'), revokeObjectURL: vi.fn() }));
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        documentos.length = 0;
    });

    afterEach(() => {
        vi.mocked(HTMLAnchorElement.prototype.click).mockRestore();
        vi.unstubAllGlobals();
    });

    it('imprime una sección propia con el motivo y los montos del aporte', async () => {
        const { text } = await pdfText({ aportes: [aporte] });
        expect(text).toContain('APORTES DE EFECTIVO');
        expect(text).toContain('cambio billetes');
    });

    it('reserva alto adicional para los aportes', async () => {
        const sin = await pdfText({ aportes: [] });
        const con = await pdfText({ aportes: [aporte, { ...aporte, id: 'aporte_2' }] });
        expect(con.height).toBeGreaterThan(sin.height);
    });

    it('sin aportes no imprime la sección', async () => {
        const { text } = await pdfText({ aportes: [] });
        expect(text).not.toContain('APORTES DE EFECTIVO');
    });
});
