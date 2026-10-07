import { jsPDF } from 'jspdf';
import { formatBs, formatCop, formatUsd } from './calculatorUtils.js';

const TITLE_BY_TYPE = Object.freeze({
    close: 'Cierre de Caja del Supervisor',
    products: 'Reporte de Productos Vendidos',
    expenses: 'Reporte de Gastos y Egresos',
    summary: 'Reporte General del Supervisor',
});

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value) => `$${formatUsd(number(value))}`;
const dateLabel = (value = new Date()) => new Date(value).toLocaleString('es-VE');

export function buildSupervisorReportRows({
    reportType = 'summary',
    cash = { expected: {}, opening: {}, changeGiven: {}, tipsLeft: {} },
    productsSold = [],
    expenses = [],
    inventoryMovements = [],
    copEnabled = false,
} = {}) {
    const rows = [];
    const expected = cash.expected || {};
    const opening = cash.opening || {};
    const changes = cash.changeGiven || {};
    const tips = cash.tipsLeft || {};
    const reconciliation = cash.reconciliation || {};
    const declared = reconciliation.declared || {};
    const difference = reconciliation.difference || {};

    if (reportType === 'close' || reportType === 'summary') {
        rows.push(['Efectivo esperado USD', money(expected.USD)]);
        rows.push(['Efectivo esperado Bs', `${formatBs(expected.BS)} Bs`]);
        if (copEnabled) rows.push(['Efectivo esperado COP', `${formatCop(expected.COP)} COP`]);
        rows.push(['Apertura USD', money(opening.USD)]);
        rows.push(['Apertura Bs', `${formatBs(opening.BS)} Bs`]);
        if (copEnabled) rows.push(['Apertura COP', `${formatCop(opening.COP)} COP`]);
        rows.push(['Cambios entregados USD', money(changes.USD)]);
        rows.push(['Cambios entregados Bs', `${formatBs(changes.BS)} Bs`]);
        if (copEnabled) rows.push(['Cambios entregados COP', `${formatCop(changes.COP)} COP`]);
        rows.push(['Cambios dejados USD', money(tips.USD)]);
        rows.push(['Cambios dejados Bs', `${formatBs(tips.BS)} Bs`]);
        if (copEnabled) rows.push(['Cambios dejados COP', `${formatCop(tips.COP)} COP`]);

        const hasReconciliation = Object.values(declared).some(value => value != null)
            || Object.values(difference).some(value => value != null);
        if (hasReconciliation) {
            rows.push(['EFECTIVO DECLARADO', '']);
            rows.push(['Declarado USD', declared.USD == null ? 'Sin declarar' : money(declared.USD)]);
            rows.push(['Diferencia USD', difference.USD == null ? 'Sin calcular' : money(difference.USD)]);
            rows.push(['Declarado Bs', declared.BS == null ? 'Sin declarar' : `${formatBs(declared.BS)} Bs`]);
            rows.push(['Diferencia Bs', difference.BS == null ? 'Sin calcular' : `${formatBs(difference.BS)} Bs`]);
            if (copEnabled) {
                rows.push(['Declarado COP', declared.COP == null ? 'Sin declarar' : `${formatCop(declared.COP)} COP`]);
                rows.push(['Diferencia COP', difference.COP == null ? 'Sin calcular' : `${formatCop(difference.COP)} COP`]);
            }
        }
    }

    if (reportType === 'products' || reportType === 'summary' || reportType === 'close') {
        rows.push(['', '']);
        rows.push(['PRODUCTOS VENDIDOS', '']);
        for (const product of productsSold) {
            rows.push([
                `${product.productName} · ${number(product.quantity)} uds`,
                `${money(product.revenueUsd)} · ${product.salesCount} ventas`,
            ]);
        }
    }

    if (reportType === 'expenses' || reportType === 'summary' || reportType === 'close') {
        rows.push(['', '']);
        rows.push(['GASTOS Y EGRESOS', '']);
        for (const expense of expenses) {
            rows.push([
                `${expense.description} · ${expense.category}`,
                `-${money(expense.totalUsd)}${expense.affectsCash ? '' : ' · No caja'}`,
            ]);
        }
    }

    if (reportType === 'close' || reportType === 'summary') {
        rows.push(['', '']);
        rows.push(['MOVIMIENTOS DE INVENTARIO', '']);
        for (const movement of inventoryMovements) {
            rows.push([
                `${movement.direction.toUpperCase()} · ${movement.productName}`,
                `${number(movement.unitsDelta)} uds · ${movement.reason}`,
            ]);
        }
    }

    return rows;
}

export async function generateSupervisorReportPDF({
    reportType = 'summary',
    rangeLabel = 'Todos',
    cierreId = 'all',
    records = [],
    cash,
    productsSold = [],
    expenses = [],
    inventoryMovements = [],
    copEnabled = false,
    businessName = 'Mi Negocio',
    action = 'download',
} = {}) {
    const doc = new jsPDF('p', 'mm', 'letter');
    const width = 215.9;
    const height = 279.4;
    const margin = 14;
    const title = TITLE_BY_TYPE[reportType] || TITLE_BY_TYPE.summary;
    let y = margin;
    let page = 1;

    const footer = () => {
        doc.setFontSize(8);
        doc.setTextColor(130, 130, 130);
        doc.text(`Precios Al Día · Supervisor · Página ${page}`, width / 2, height - 10, { align: 'center' });
    };

    const newPageIfNeeded = (needed = 8) => {
        if (y + needed <= height - 18) return;
        footer();
        doc.addPage();
        page += 1;
        y = margin;
    };

    doc.setTextColor(1, 105, 111);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(title, margin, y);
    y += 8;

    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Negocio: ${businessName}`, margin, y);
    y += 5;
    doc.text(`Período: ${rangeLabel} · Cierre: ${cierreId === 'all' ? 'Todos' : cierreId}`, margin, y);
    y += 5;
    doc.text(`Generado: ${dateLabel()}`, margin, y);
    y += 8;

    const rows = buildSupervisorReportRows({
        reportType,
        cash,
        productsSold,
        expenses,
        inventoryMovements,
        copEnabled,
    });

    for (const [label, value] of rows) {
        newPageIfNeeded(7);
        if (!value) {
            doc.setTextColor(1, 105, 111);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text(label, margin, y);
            y += 6;
            continue;
        }
        doc.setTextColor(60, 60, 60);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        const labelLines = doc.splitTextToSize(String(label), 115);
        const valueLines = doc.splitTextToSize(String(value), 65);
        const rowHeight = Math.max(labelLines.length, valueLines.length) * 4.5;
        newPageIfNeeded(rowHeight + 2);
        doc.text(labelLines, margin, y);
        doc.text(valueLines, width - margin, y, { align: 'right' });
        y += rowHeight + 1.5;
    }

    footer();
    if (action === 'download' || action === 'share' || action === 'print') {
        const suffix = reportType === 'close' ? 'cierre' : reportType;
        doc.save(`supervisor-${suffix}-${new Date().toISOString().slice(0, 10)}.pdf`);
    }

    return { ok: true, rows: rows.length, records: records.length };
}

export default {
    buildSupervisorReportRows,
    generateSupervisorReportPDF,
};
