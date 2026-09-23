import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { buildCloseDaySummary } from '../src/utils/closeDaySummary.js';

const RATE = 849.56;

const fiada = (over = {}) => ({
    id: 'v-fiada',
    tipo: 'VENTA_FIADA',
    totalUsd: 20,
    totalBs: 16991.2,
    fiadoUsd: 20,
    rate: RATE,
    customerName: 'juan perez',
    status: 'COMPLETADA',
    ...over,
});

const cashea = (over = {}) => ({
    id: 'v-cashea',
    tipo: 'VENTA_CASHEA',
    totalUsd: 30,
    totalBs: 25486.8,
    casheaUsd: 21,
    rate: RATE,
    customerName: 'luis',
    status: 'COMPLETADA',
    ...over,
});

const contado = (over = {}) => ({
    id: 'v-contado',
    tipo: 'VENTA',
    totalUsd: 5,
    totalBs: 4247.8,
    rate: RATE,
    status: 'COMPLETADA',
    ...over,
});

const abono = (over = {}) => ({
    id: 'abono',
    tipo: 'COBRO_DEUDA',
    totalUsd: 8,
    totalBs: 6796.48,
    rate: RATE,
    customerName: 'juan perez',
    status: 'COMPLETADA',
    ...over,
});

/** Día del caso faro: $20 fiado + $30 Cashea + $5 contado, $23 cobrados. */
const diaCompleto = [
    fiada(),
    cashea(),
    contado(),
    abono(),
    abono({ id: 'abono-excedente', totalUsd: 15, totalBs: 12743.4, saldoFavorGeneradoUsd: 5 }),
];

const DIA = {
    allSales: diaCompleto,
    bcvRate: RATE,
    todayTotalUsd: 55,
    todayTotalBs: 46725.8,
    todayProfit: 17000,
    carteraUsd: 53.19,
};

const rowOf = (summary, key) => summary.rows.find(r => r.key === key);

describe('buildCloseDaySummary — resumen del día del cierre', () => {
    it('G1: separa las ventas netas en cobrado y crédito, y cierra la invariante', () => {
        const s = buildCloseDaySummary(DIA);

        expect(s.ventasNetasUsd).toBe(55);
        expect(s.ventasNetasBs).toBe(46725.8);
        expect(s.creditosUsd).toBe(41); // fiado 20 + Cashea 21
        expect(s.cobradoUsd).toBe(14);  // 55 − 41
        expect(s.cobradoBs).toBe(11893.84);

        expect(s.invariante.ok).toBe(true);
        expect(s.invariante.diff).toBe(0);
        expect(s.cobradoUsd + s.creditosUsd).toBe(s.ventasNetasUsd);
    });

    it('G2: el crédito se pesa en Bs a la tasa de cada venta, no a la del cierre', () => {
        // La venta fiada se hizo a 800; el cierre es a 849,56. Debe pesar 800.
        const s = buildCloseDaySummary({
            ...DIA,
            allSales: [fiada({ rate: 800, totalBs: 16000 }), cashea({ rate: 800, totalBs: 24000, casheaUsd: 21 })],
            todayTotalUsd: 50,
            todayTotalBs: 40000,
        });

        expect(s.creditosBs).toBe(32800); // (20 + 21) × 800
        expect(rowOf(s, 'fiado').bs).toBe(16000);
        expect(rowOf(s, 'cashea').bs).toBe(16800);
    });

    it('G3: las ventas anuladas no cuentan ni como venta ni como crédito', () => {
        const s = buildCloseDaySummary({
            ...DIA,
            todayTotalUsd: 0, // fuerza a derivar las ventas de las transacciones
            todayTotalBs: 0,
            allSales: [
                fiada(),
                fiada({ id: 'anulada', status: 'ANULADA', totalUsd: 8, totalBs: 6796.48, fiadoUsd: 8 }),
                contado(),
            ],
        });

        expect(s.ventasNetasUsd).toBe(25); // 20 fiado + 5 contado
        expect(s.creditosUsd).toBe(20);
        expect(s.cobradoUsd).toBe(5);
    });

    it('G4: las cobranzas previas entran aparte y no inflan las ventas netas', () => {
        const s = buildCloseDaySummary(DIA);

        expect(s.cobranzasUsd).toBe(23); // 8 + 15
        expect(s.cobranzasBs).toBe(19539.88);
        expect(s.ventasNetasUsd).toBe(55); // el abono no es venta
        expect(rowOf(s, 'cobranzas').hint).toContain('no es venta de hoy');
    });

    it('G5: el saldo a favor generado se muestra como no ingreso', () => {
        const s = buildCloseDaySummary(DIA);
        const row = rowOf(s, 'saldo_favor');

        expect(s.saldoFavorGeneradoUsd).toBe(5);
        expect(row.usd).toBe(5);
        expect(row.tone).toBe('muted');
        expect(row.hint).toContain('No es ingreso');
    });

    it('G6: la ganancia se expone devengada en Bs y convertida por la tasa BCV', () => {
        const s = buildCloseDaySummary(DIA);

        expect(s.gananciaBs).toBe(17000);
        expect(s.gananciaUsd).toBe(20.01); // 17.000 / 849,56
        expect(rowOf(s, 'ganancia').label).toContain('devengada');
        expect(rowOf(s, 'ganancia').hint).toContain('a crédito');
    });

    it('G7: sin tasa no se inventa la conversión de la ganancia', () => {
        const s = buildCloseDaySummary({ ...DIA, bcvRate: 0 });
        expect(s.gananciaBs).toBe(17000);
        expect(s.gananciaUsd).toBe(0);
    });

    it('G8: la cartera al cierre solo aparece si se conoce', () => {
        expect(rowOf(buildCloseDaySummary({ ...DIA, carteraUsd: null }), 'cartera')).toBeUndefined();
        expect(rowOf(buildCloseDaySummary(DIA), 'cartera').usd).toBe(53.19);
    });

    it('G9: un día sin movimientos no produce bloque', () => {
        const s = buildCloseDaySummary({ allSales: [], todayTotalUsd: 0, todayTotalBs: 0, todayProfit: 0 });
        expect(s.hasMovement).toBe(false);
        expect(s.creditosUsd).toBe(0);
        expect(s.cobranzasUsd).toBe(0);
    });

    it('G10: los montos quedan redondeados a 2 decimales y sin deriva de punto flotante', () => {
        const s = buildCloseDaySummary({
            ...DIA,
            allSales: [
                fiada({ totalUsd: 10.1, totalBs: 8580.5, fiadoUsd: 10.1, rate: 849.555 }),
                abono({ totalUsd: 3.03, totalBs: 2574.15, rate: 849.555 }),
            ],
            todayTotalUsd: 10.1,
            todayTotalBs: 8580.5,
            todayProfit: 1234.567,
            carteraUsd: null,
        });

        s.rows.forEach(row => {
            expect(Number.isInteger(Math.round(row.usd * 100)), row.key).toBe(true);
            expect(Math.abs(row.usd * 100 - Math.round(row.usd * 100))).toBeLessThan(1e-9);
        });
        expect(s.ventasNetasUsd).toBe(10.1);
        expect(s.cobradoUsd).toBe(0); // 10,10 − 10,10 fiado
        expect(s.gananciaBs).toBe(1234.57);
    });

    it('G11: cada fila tiene etiqueta corta para el ticket de 58 mm', () => {
        const s = buildCloseDaySummary(DIA);
        s.rows.forEach(row => {
            expect(row.short, row.key).toBeTruthy();
            expect(row.short.length, row.key).toBeLessThanOrEqual(22);
        });
    });

    it('G13: las filas del PDF carta caben en su columna sin invadir las cifras', () => {
        const s = buildCloseDaySummary(DIA);
        const doc = new jsPDF('p', 'mm', 'letter');
        const M = 15;
        const COL_W = 90; // ancho de columna del bloque de resumen en el PDF carta
        const money = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Los dos encabezados de columna deben caber en el ancho de la tarjeta.
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        s.columns.forEach(col => {
            expect(doc.getTextWidth(col.title.toUpperCase()), col.title).toBeLessThan(COL_W - 6);
        });

        s.columns.forEach((col, colIdx) => {
            const x = colIdx === 0 ? M : M + COL_W + 5.9;
            col.rows.forEach(row => {
                const indent = x + 3 + (row.level > 0 ? 3 : 0);

                doc.setFont('helvetica', row.level > 0 ? 'normal' : 'bold');
                doc.setFontSize(7);
                const labelW = doc.getTextWidth(row.label);
                const usdW = doc.getTextWidth(`$${money.format(Math.abs(row.usd))}`);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(5.8);
                const bsW = row.bs ? doc.getTextWidth(`Bs ${money.format(Math.abs(row.bs))}`) : 0;

                // USD pegado al borde derecho de la tarjeta, su Bs a la izquierda.
                const cifrasLeft = x + COL_W - 5 - usdW - (bsW ? bsW : 0);
                expect(indent + labelW + 2, row.key).toBeLessThanOrEqual(cifrasLeft);
            });
        });
    });

    it('G14: las columnas del PDF carta reparten las filas sin perder ninguna', () => {
        const s = buildCloseDaySummary(DIA);
        const enColumnas = s.columns.flatMap(c => c.rows.map(r => r.key));
        expect(enColumnas.sort()).toEqual(s.rows.map(r => r.key).sort());
        expect(s.columns[0].rows.map(r => r.key)).toEqual(['ventas_netas', 'cobrado', 'a_credito']);
    });

    it('G12: la etiqueta corta y su valor caben en el ancho útil del ticket', () => {
        const s = buildCloseDaySummary(DIA);
        const doc = new jsPDF('p', 'mm', [58, 400]);
        const M = 4;
        const RIGHT = 44.5; // valor de 58 mm en dailyCloseGenerator
        const VALUE_RIGHT = RIGHT;
        const money = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        s.rows.forEach(row => {
            const indent = M + (row.level > 0 ? 2.5 : 0);
            doc.setFont('helvetica', row.level > 0 ? 'normal' : 'bold');
            doc.setFontSize(row.level > 0 ? 5.8 : 6.2);
            const labelW = doc.getTextWidth(row.short);
            doc.setFont('helvetica', 'bold');
            const valueW = doc.getTextWidth(`$${money.format(Math.abs(row.usd))}`);
            // 1,5 mm de separación mínima entre etiqueta y cifra.
            expect(indent + labelW + 1.5 + valueW, row.key).toBeLessThanOrEqual(VALUE_RIGHT);
        });
    });
});
