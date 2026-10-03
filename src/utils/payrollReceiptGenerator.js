import { jsPDF } from 'jspdf';
import { formatBs, formatUsd } from './calculatorUtils';

/**
 * payrollReceiptGenerator.js — Recibo de pago de nómina (ticket térmico 80mm / 56mm).
 *
 * Sigue el patrón REAL de `dailyCloseGenerator.js` (opción B):
 * - PDF jsPDF con página continua [WIDTH, H].
 * - `paperWidthSetting = localStorage.getItem('printer_paper_width')`: '80' → layout 80mm;
 *   cualquier otro valor → layout angosto (56mm, válido también en 58mm).
 * - print: iframe oculto + contentWindow.print().
 * - share: navigator.share con el archivo, fallback a descarga.
 *
 * Sin imports de React. Tolerante a nulos (muestra '—').
 */

const INK = [33, 37, 41];
const BODY = [73, 80, 87];
const MUTED = [134, 142, 150];
const BLUE = [1, 105, 111]; // Tono brand "Precios Al Día"
const RULE = [222, 226, 230];

/** Lee el ancho de papel configurado; 'paperWidth' permite override (tests). */
function resolvePaperWidth(paperWidth) {
    const setting =
        paperWidth ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('printer_paper_width') : null) ||
        '58';
    return setting === '80' ? '80' : 'narrow';
}

/** Texto seguro: nulos/vacíos → '—'. */
function S(v) {
    return v === null || v === undefined || v === '' ? '—' : String(v);
}

/** Número seguro para mostrar (formatters ya hacen `val || 0`). */
function moneyUsd(v) {
    return `$${formatUsd(v)}`;
}
function moneyBs(v) {
    return `Bs ${formatBs(v)}`;
}
function moneyMonto(monto, moneda) {
    return moneda === 'Bs' ? moneyBs(monto) : moneyUsd(monto);
}

function fmtFechaHora(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return '—';
    const fecha = d.toLocaleDateString('es-VE', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
    const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    return `${fecha}  ${hora}`;
}

function fmtFecha(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function metodoPagoLabel(liquidacion) {
    const p = Array.isArray(liquidacion?.payments) ? liquidacion.payments[0] : null;
    if (!p) return '—';
    return S(p.metodo || p.method || p.tipo || p.label);
}

function safeFilename(folio) {
    const base = S(folio).replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 40);
    return `recibo_nomina_${base || 'sin_folio'}.pdf`;
}

/**
 * Construye el documento jsPDF del recibo. Uso interno.
 * @returns {{ doc, width, filename }}
 */
function buildDoc({ negocio = {}, empleado = {}, periodo = {}, liquidacion = {}, consumoCount = 0, paperWidth } = {}) {
    const wide = resolvePaperWidth(paperWidth) === '80';

    const WIDTH = wide ? 80 : 56;
    const M = wide ? 6 : 4;
    const RIGHT = wide ? 74 : 52;
    const CX = WIDTH / 2;
    const VALUE_RIGHT = wide ? RIGHT - 5 : RIGHT;

    const fTitle = wide ? 11 : 9;
    const fSection = wide ? 7.5 : 7;
    const fBody = wide ? 7 : 6.4;
    const fMuted = wide ? 6.5 : 5.8;
    const fNeto = wide ? 13 : 11;

    // Altura estimada: secciones fijas + un margen de seguridad.
    const H = wide ? 200 : 210;
    const doc = new jsPDF('p', 'mm', [WIDTH, H]);
    let y = 7;

    const dash = (yy) => {
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([1, 1], 0);
        doc.line(M, yy, RIGHT, yy);
        doc.setLineDashPattern([], 0);
    };

    const sectionTitle = (text, yy) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fSection);
        doc.setTextColor(...BLUE);
        doc.text(text, M, yy);
        return yy + 5;
    };

    const row = (label, value, yy, valueBold = true) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fBody);
        doc.setTextColor(...BODY);
        doc.text(S(label), M, yy);
        doc.setFont('helvetica', valueBold ? 'bold' : 'normal');
        doc.setTextColor(...INK);
        doc.text(S(value), VALUE_RIGHT, yy, { align: 'right' });
        return yy + 5;
    };

    const centered = (text, yy, size, bold = false, color = INK) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(...color);
        doc.text(S(text), CX, yy, { align: 'center' });
        return yy + size * 0.55 + 2;
    };

    // ── Encabezado ──────────────────────────────────────────
    const negocioLines = doc.splitTextToSize(S(negocio.nombre) || 'Mi Negocio', WIDTH - M * 2).slice(0, 2);
    negocioLines.forEach((line) => {
        y = centered(line, y, fTitle, true);
    });
    if (negocio.rif) y = centered(`RIF: ${negocio.rif}`, y, fMuted, false, MUTED);

    y = centered('RECIBO DE PAGO', y + 1, fTitle, true);
    y = centered('NÓMINA', y, fMuted, true, MUTED);
    y = centered(`Folio: ${S(liquidacion.folio)}`, y + 1, fMuted, false, MUTED);
    y = centered(fmtFechaHora(liquidacion.createdAt), y, fMuted, false, MUTED);

    y += 2; dash(y); y += 6;

    // ── Empleado ─────────────────────────────────────────────
    y = sectionTitle('EMPLEADO', y);
    y = row('Nombre', S(empleado.nombre), y);
    y = row('Cédula', S(empleado.cedula), y);
    y += 1; dash(y); y += 6;

    // ── Período ───────────────────────────────────────────────
    y = sectionTitle('PERÍODO', y);
    y = row('Frecuencia', S(periodo.frecuencia), y);
    y = row('Rango', `${fmtFecha(periodo.inicioISO)} al ${fmtFecha(periodo.finISO)}`, y);
    const snap = periodo.salarioSnapshot || {};
    y = row('Sueldo del período', moneyMonto(snap.monto, snap.moneda), y);
    y += 1; dash(y); y += 6;

    // ── Consumos ──────────────────────────────────────────────
    y = sectionTitle('CONSUMOS APLICADOS', y);
    y = row('Cantidad', `${Number(consumoCount) || 0}`, y);
    y = row('Total', moneyUsd(liquidacion.totalConsumosUsd), y);
    y += 1; dash(y); y += 6;

    // ── Neto pagado (destacado) ───────────────────────────────
    y = centered('NETO PAGADO', y, fSection, true, BLUE);
    y = centered(moneyUsd(liquidacion.netoUsd), y + 2, fNeto, true);
    const netoBs = Number(liquidacion.netoBs);
    const tasa = Number(liquidacion.tasaBcvLiquidacion);
    if (Number.isFinite(netoBs) && netoBs > 0) {
        y = centered(moneyBs(netoBs), y + 1, fBody + 1, true);
    }
    if (Number.isFinite(tasa) && tasa > 0) {
        y = centered(`Tasa BCV: ${moneyBs(tasa)}`, y, fMuted, false, MUTED);
    }
    y += 2; dash(y); y += 6;

    // ── Método de pago ────────────────────────────────────────
    y = row('Método de pago', metodoPagoLabel(liquidacion), y);
    y += 1; dash(y); y += 8;

    // ── Firmas ────────────────────────────────────────────────
    const sigLine = (label, yy) => {
        doc.setDrawColor(...BODY);
        doc.setLineWidth(0.3);
        doc.line(M + 4, yy, RIGHT - 4, yy);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fMuted);
        doc.setTextColor(...MUTED);
        doc.text(label, CX, yy + 4, { align: 'center' });
        return yy + 12;
    };
    y = sigLine('Recibido (firma y cédula)', y);
    y = sigLine('Entregado (firma y cédula)', y);

    y += 2;
    y = centered('Generado por PreciosAlDía Pro', y, fMuted, false, MUTED);
    y = centered('Documento sin valor fiscal', y, fMuted, false, MUTED);

    return { doc, width: WIDTH, filename: safeFilename(liquidacion.folio) };
}

/**
 * Genera el PDF del recibo sin guardarlo.
 * @returns {{ pdfDataUri, width }}
 */
export function buildPayrollReceiptPdf(args) {
    const { doc, width } = buildDoc(args || {});
    return { pdfDataUri: doc.output('datauristring'), width };
}

/**
 * Genera el recibo y lo manda a imprimir (iframe oculto, patrón dailyCloseGenerator).
 */
export async function printPayrollReceipt(args) {
    if (typeof document === 'undefined') throw new Error('printPayrollReceipt requiere DOM');
    const { doc, width } = buildDoc(args || {});
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${width}mm;height:auto;`;
    document.body.appendChild(iframe);
    const blob = doc.output('blob');
    const blobUrl = URL.createObjectURL(blob);
    iframe.src = blobUrl;
    iframe.onload = () => {
        setTimeout(() => {
            iframe.contentWindow.print();
            setTimeout(() => {
                try {
                    document.body.removeChild(iframe);
                    URL.revokeObjectURL(blobUrl);
                } catch (_) { /* noop */ }
            }, 60000);
        }, 300);
    };
}

/**
 * Genera el recibo y lo comparte (navigator.share) o lo descarga como fallback.
 */
export async function sharePayrollReceipt(args) {
    const { doc, filename } = buildDoc(args || {});
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (
        typeof navigator !== 'undefined' &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
    ) {
        try {
            await navigator.share({ title: 'Recibo de pago — Nómina', files: [file] });
            return;
        } catch (_) { /* cae al fallback de descarga */ }
    }
    doc.save(filename);
}
