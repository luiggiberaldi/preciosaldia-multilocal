import { formatUsd } from './calculatorUtils';
import { salesDayString } from './syncDelta';
import { getPaperConfig } from './ticketConstants';
import { escapeHtml } from './ticketHtmlTemplate';
import { openPrintWindow } from './printerUtils';

/**
 * Deja solo los registros cuyo día local (YYYY-MM-DD) cae en [desde, hasta].
 * Límites vacíos = sin límite. Sin fecha válida = se excluye cuando hay rango.
 */
export function filterActivityByRange(items, desde = '', hasta = '') {
    if (!Array.isArray(items)) return [];
    if (!desde && !hasta) return items;
    return items.filter((item) => {
        const raw = item?.date || item?.timestamp;
        if (!raw) return false;
        const time = new Date(raw);
        if (Number.isNaN(time.getTime())) return false;
        const day = salesDayString(time);
        return (!desde || day >= desde) && (!hasta || day <= hasta);
    });
}

/** Texto legible del rango: 'Del 01/10/2026 al 09/10/2026', 'Todo el historial', etc. */
export function rangeLabel(desde = '', hasta = '') {
    const fmt = (s) => {
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y}`;
    };
    if (desde && hasta) return `Del ${fmt(desde)} al ${fmt(hasta)}`;
    if (desde) return `Desde ${fmt(desde)}`;
    if (hasta) return `Hasta ${fmt(hasta)}`;
    return 'Todo el historial';
}

/**
 * Une facturas y pagos en líneas de ticket, filtradas por rango.
 * Facturas suman a la deuda; pagos la reducen (montos en USD positivos).
 */
export function buildSupplierActivityLines({ invoices = [], payments = [], desde = '', hasta = '' }) {
    const facturas = filterActivityByRange(invoices, desde, hasta).map((i) => ({
        time: new Date(i.date || i.timestamp).getTime(),
        date: new Date(i.date || i.timestamp),
        label: `Factura #${i.invoiceNumber || '-'}`,
        amountUsd: Number(i.amountUsd) || 0,
        kind: 'factura',
    }));
    const pagos = filterActivityByRange(payments, desde, hasta).map((p) => ({
        time: new Date(p.date || p.timestamp).getTime(),
        date: new Date(p.date || p.timestamp),
        label: 'Pago',
        amountUsd: Math.abs(Number(p.totalUsd) || 0),
        kind: 'pago',
    }));
    const lines = [...facturas, ...pagos].sort((a, b) => b.time - a.time);
    const facturasUsd = facturas.reduce((s, l) => s + l.amountUsd, 0);
    const pagosUsd = pagos.reduce((s, l) => s + l.amountUsd, 0);
    return { lines, facturasUsd, pagosUsd, netoUsd: facturasUsd - pagosUsd };
}

/**
 * HTML de ticket térmico del reporte de proveedores. Puro: recibe el
 * paperConfig y los datos ya filtrados.
 */
export function buildSupplierReportTicketHtml({
    businessName = 'Bodega',
    title = 'Reporte de proveedores',
    rangeText = 'Todo el historial',
    supplierName = '',
    lines = [],
    totals = { facturasUsd: 0, pagosUsd: 0, netoUsd: 0 },
    paperConfig,
}) {
    const { cssPageSize, cssBodyWidth, fTitle, fBase, fSmall, fTotalU } = paperConfig;
    const money = (v) => `$${formatUsd(v)}`;
    const rowsHtml = lines.map((l) => `
        <div class="row" style="font-size:${fSmall}">
            <span>${escapeHtml(l.date.toLocaleDateString('es-VE'))} ${escapeHtml(l.label)}${l.kind === 'pago' ? ' (-)' : ''}</span>
            <span>${l.kind === 'pago' ? '-' : ''}${money(l.amountUsd)}</span>
        </div>`).join('');
    const now = new Date().toLocaleString('es-VE');
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
    @page { size: ${cssPageSize}; margin: 0; }
    body { width: ${cssBodyWidth}; margin: 0 auto; font-family: monospace; color: #000; }
    .c { text-align: center; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
    .hr { border-top: 1px dashed #000; margin: 4px 0; }
</style></head>
<body>
    <div class="c" style="font-size:${fTitle}"><b>${escapeHtml(businessName)}</b></div>
    <div class="c" style="font-size:${fSmall}">${escapeHtml(title)}</div>
    ${supplierName ? `<div class="c" style="font-size:${fSmall}">${escapeHtml(supplierName)}</div>` : ''}
    <div class="c" style="font-size:${fSmall}">${escapeHtml(rangeText)}</div>
    <div class="hr"></div>
    ${lines.length ? rowsHtml : `<div class="c" style="font-size:${fSmall}">Sin movimientos en el rango</div>`}
    <div class="hr"></div>
    <div class="row" style="font-size:${fBase}"><span>Facturas</span><span>${money(totals.facturasUsd)}</span></div>
    <div class="row" style="font-size:${fBase}"><span>Pagos</span><span>-${money(totals.pagosUsd)}</span></div>
    <div class="row" style="font-size:${fTotalU}"><b>Saldo neto</b><b>${money(totals.netoUsd)}</b></div>
    <div class="hr"></div>
    <div class="c" style="font-size:${fSmall}">Generado ${escapeHtml(now)}</div>
</body></html>`;
}

/** Abre la impresión térmica del reporte con el ancho de papel configurado. */
export function printSupplierReportThermal({ invoices, payments, desde = '', hasta = '', supplierName = '', title }) {
    const paperWidth = localStorage.getItem('printer_paper_width') || '58';
    const paperConfig = getPaperConfig(paperWidth);
    const businessName = localStorage.getItem('business_name') || 'Bodega Sin Nombre';
    const { lines, facturasUsd, pagosUsd, netoUsd } = buildSupplierActivityLines({ invoices, payments, desde, hasta });
    const html = buildSupplierReportTicketHtml({
        businessName,
        title: title || (supplierName ? 'Estado de cuenta' : 'Reporte de proveedores'),
        rangeText: rangeLabel(desde, hasta),
        supplierName,
        lines,
        totals: { facturasUsd, pagosUsd, netoUsd },
        paperConfig,
    });
    openPrintWindow(html);
}
