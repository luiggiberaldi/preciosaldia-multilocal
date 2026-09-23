import { jsPDF } from 'jspdf';
import { formatBs, formatCop, formatUsd } from './calculatorUtils';
import {
    INK, BODY, MUTED, GREEN, RULE, RED,
    PDF_WIDTH, PDF_MARGIN, PDF_CENTER_X, PDF_RIGHT,
    getPaperConfig,
} from './ticketConstants';
import { buildTicketHtml } from './ticketHtmlTemplate';
import { openPrintWindow } from './printerUtils';
import { mulR, divR } from './dinero';

// Re-export generarEtiquetas so existing imports keep working
export { generarEtiquetas } from './labelGenerator';

/**
 * Genera un ticket PDF estilo recibo termico 80mm.
 * Cada dato ocupa su propia linea — nada se solapa.
 */
export async function generateTicketPDF(sale, bcvRate) {
    const paperWidth = localStorage.getItem('printer_paper_width') || '58';
    const is80 = paperWidth === '80';
    const WIDTH = is80 ? 80 : 58;
    const M = is80 ? 6 : 4;
    const CX = WIDTH / 2;
    const RIGHT = WIDTH - M;

    const rate = sale.rate || bcvRate || 1;
    const isCop = sale.copEnabled && sale.tasaCop > 0;
    // FIN-024: fmtUsd usa formatUsd (Intl.NumberFormat) — sin parseFloat/toFixed.
    const fmtUsd = (v) => isCop ? `USD ${formatUsd(v)}` : `$${formatUsd(v)}`;
    const itemCount = sale.items?.length || 0;
    const paymentCount = sale.payments?.length || 0;
    const hasFiado = sale.fiadoUsd > 0;
    const walletCreditUsd = sale.tipo === 'COBRO_DEUDA'
        ? Math.max(0, Number(sale.saldoFavorGeneradoUsd) || 0)
        : ['VENTA', 'VENTA_CASHEA'].includes(sale.tipo)
            ? Math.max(0, Number(sale.vueltoParaMonedero) || 0)
            : 0;
    const walletCreditLabel = sale.tipo === 'COBRO_DEUDA'
        ? 'Saldo a favor generado (sobrante de abono):'
        : 'Saldo a favor acreditado:';
    const tipDonatedUsd = Math.max(0, Number(sale.tipDonated?.amountUsd) || 0);
    const hasPhysicalChange = Number(sale.changeUsd) > 0 || Number(sale.changeBs) > 0;

    // Altura MUY generosa para que nunca se corte
    const H = 160 + (itemCount * 14) + (paymentCount * 7) + (hasFiado ? 18 : 0)
        + (walletCreditUsd > 0 ? 10 : 0) + (tipDonatedUsd > 0 ? 10 : 0)
        + (hasPhysicalChange ? 10 : 0);

    const doc = new jsPDF('p', 'mm', [WIDTH, H]);

    let y = 8;

    // ── Helper: linea punteada ──
    const dash = (yy) => {
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([1, 1], 0);
        doc.line(M, yy, RIGHT, yy);
        doc.setLineDashPattern([], 0);
    };

    // ════════════════════════════════════
    //  LOGO
    // ════════════════════════════════════
    try {
        const img = new Image();
        img.src = './logo.png';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        const logoW = 50;
        const logoH = 12; // ~4:1 aspect ratio matching original
        doc.addImage(img, 'PNG', CX - logoW / 2, y, logoW, logoH);
        y += logoH + 4;
    } catch (_) { y += 2; }

    dash(y); y += 5;

    // ════════════════════════════════════
    //  INFO DEL TICKET (cada dato en su linea)
    // ════════════════════════════════════
    const saleNum = String(sale.saleNumber || 0).padStart(7, '0');
    const d = new Date(sale.timestamp);
    const fecha = d.toLocaleDateString('es-VE');
    const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text('N°:', M, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`#${saleNum}`, M + 8, y);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`${fecha}  ${hora}`, RIGHT, y, { align: 'right' });
    y += 5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text('Cliente:', M, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BODY);
    doc.text(sale.customerName || 'Consumidor Final', M + 14, y);
    y += 6;

    if (sale.customerDocument) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...INK);
        doc.text('C.I/RIF:', M, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...BODY);
        doc.text(sale.customerDocument, M + 14, y);
        y += 6;
    }

    dash(y); y += 5;

    // ════════════════════════════════════
    //  ENCABEZADO DE PRODUCTOS
    // ════════════════════════════════════
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text('CANT', M, y);
    doc.text('DESCRIPCIÓN', M + 10, y);
    doc.text('IMPORTE', RIGHT, y, { align: 'right' });
    y += 5;

    const isBsSale = (sale.payments || []).some(p => {
        const isCop = p.currency === 'COP';
        const isBs = !isCop && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
        return isBs && parseFloat(p.amountBs || 0) > 0;
    });

    // ════════════════════════════════════
    //  PRODUCTOS
    // ════════════════════════════════════
    if (sale.items && sale.items.length > 0) {
        sale.items.forEach(item => {
            const isDualBs = item.pricingMode === 'dual_usd' && parseFloat(item.priceBsUsdRef) > 0 && isBsSale;
            const effectivePriceUsd = isDualBs ? parseFloat(item.priceBsUsdRef) : item.priceUsd;

            // FIN-024: formatUsd para cantidades peso (2 decimales), sin toFixed.
            const qty = item.isWeight ? formatUsd(item.qty) : String(item.qty);
            const unit = item.isWeight ? 'Kg' : 'u';
            // FIN-024: mulR en vez de multiplicación raw.
            const itemExactBs = item.exactBs ?? (item.isCashAdvance && item.currency === 'BS' ? (item.montoEfectivo + item.montoComision) : null);
            const sub = itemExactBs != null ? (rate > 0 ? divR(itemExactBs, rate) : effectivePriceUsd) : mulR(effectivePriceUsd, item.qty);
            const subBs = itemExactBs != null ? mulR(itemExactBs, item.qty) : mulR(sub, rate);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(...INK);
            doc.text(`${qty}${unit}`, M, y);
            
            const nameLines = doc.splitTextToSize(item.name, RIGHT - (M + 10) - 2);
            doc.text(nameLines, M + 10, y);
            
            doc.setFont('helvetica', 'bold');
            doc.text(fmtUsd(sub), RIGHT, y, { align: 'right' });
            
            const textHeight = Math.max(1, nameLines.length) * 3.5;
            y += textHeight;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(is80 ? 6 : 5.2);
            doc.setTextColor(...MUTED);
            // FIN-024: mulR para conversiones (priceCop*qty, sub*tasaCop, etc.).
            let detailLine = itemExactBs != null
                ? 'Bs ' + formatBs(itemExactBs) + ' c/u'
                : (isCop
                    ? 'USD ' + formatUsd(effectivePriceUsd) + ' c/u  ·  ' + formatCop(item.priceCop ? mulR(item.priceCop, item.qty) : mulR(sub, sale.tasaCop)) + ' COP  ·  Bs ' + formatBs(subBs)
                    : '$' + formatUsd(effectivePriceUsd) + ' c/u  ·  Bs ' + formatBs(subBs));
            if (!isCop && sale.tasaCop > 0) {
                const copUnit = (item.priceCop || mulR(effectivePriceUsd, sale.tasaCop)).toLocaleString('es-CO', { maximumFractionDigits: 0 });
                detailLine += '  ·  ' + copUnit + ' COP';
            }
            doc.text(detailLine, M + 10, y);
            y += 5;
        });
    }

    y += 2;
    dash(y); y += 7;

    // ════════════════════════════════════
    //  TASA DE CAMBIO (centrada, sola)
    // ════════════════════════════════════
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text('Tasa BCV: Bs ' + formatBs(rate) + ' por ' + (isCop ? 'USD 1' : '$1'), CX, y, { align: 'center' });
    y += 5;
    if (sale.tasaCop > 0) {
        doc.text('Tasa COP: ' + sale.tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' por USD 1', CX, y, { align: 'center' });
        y += 5;
    }
    y += 3;

    // ════════════════════════════════════
    //  TOTAL (cada cosa en su propia linea, centrado)
    // ════════════════════════════════════
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);

    if (sale.discountAmountUsd > 0) {
        doc.setTextColor(...BODY);
        doc.text('SUBTOTAL:', M, y);
        doc.text(fmtUsd(sale.cartSubtotalUsd || (sale.totalUsd + sale.discountAmountUsd)), RIGHT, y, { align: 'right' });
        y += 5;
        doc.setTextColor(...RED);
        const discountLabel = sale.discountType === 'percentage' ? `DESCUENTO (${sale.discountValue}%):` : 'DESCUENTO:';
        doc.text(discountLabel, M, y);
        doc.text('-' + fmtUsd(sale.discountAmountUsd), RIGHT, y, { align: 'right' });
        y += 7;
    }

    doc.setTextColor(...BODY);
    doc.text('TOTAL', CX, y, { align: 'center' });
    y += 8;

    const receiptCurrencyMode = localStorage.getItem('receipt_currency_mode') || 'bs';

    if (receiptCurrencyMode === 'usd') {
        doc.setFontSize(20);
        doc.setTextColor(...GREEN);
        const totalUsdStr = isCop
            ? 'USD ' + formatUsd(sale.totalUsd || 0)
            : '$' + formatUsd(sale.totalUsd || 0);
        doc.text(totalUsdStr, CX, y, { align: 'center' });
        y += 8;
    } else if (receiptCurrencyMode === 'bs') {
        doc.setFontSize(20);
        doc.setTextColor(...GREEN);
        const totalBsStr = 'Bs ' + formatBs(sale.totalBs || 0);
        doc.text(totalBsStr, CX, y, { align: 'center' });
        y += 8;
    } else {
        // mixto (original)
        doc.setFontSize(20);
        doc.setTextColor(...GREEN);
        const totalUsdStr = isCop
            ? 'USD ' + formatUsd(sale.totalUsd || 0)
            : '$' + formatUsd(sale.totalUsd || 0);
        doc.text(totalUsdStr, CX, y, { align: 'center' });
        y += 8;

        if (isCop) {
            doc.setFontSize(10);
            doc.setTextColor(...BODY);
            const totalCopStr = 'COP ' + formatCop(sale.totalCop || mulR(sale.totalUsd, sale.tasaCop));
            doc.text(totalCopStr, CX, y, { align: 'center' });
            y += 6;
        }

        doc.setFontSize(10);
        doc.setTextColor(...BODY);
        const totalBsStr = 'Bs ' + formatBs(sale.totalBs || 0);
        doc.text(totalBsStr, CX, y, { align: 'center' });
        y += 6;

        if (!isCop && sale.copEnabled && sale.tasaCop > 0) {
            doc.setFontSize(10);
            doc.setTextColor(...BODY);
            const totalCopStr2 = 'COP ' + (sale.totalCop || mulR(sale.totalUsd, sale.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            doc.text(totalCopStr2, CX, y, { align: 'center' });
            y += 8;
        } else {
            y += 2;
        }
    }

    dash(y); y += 7;

    // ════════════════════════════════════
    //  PAGOS REALIZADOS
    // ════════════════════════════════════
    const showPayments = (sale.payments && sale.payments.length > 0) || hasFiado || walletCreditUsd > 0 || tipDonatedUsd > 0 || hasPhysicalChange;
    if (showPayments) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...MUTED);
        doc.text('PAGOS REALIZADOS', M, y);
        y += 5;

        if (sale.payments && sale.payments.length > 0) {
            sale.payments.forEach(p => {
                const pIsCop = p.currency === 'COP';
                const pIsInternalCredit = p.methodId === 'saldo_favor' || p.currency === 'INTERNAL_CREDIT' || p.isInternalCredit;
                const isBs = !pIsCop && !pIsInternalCredit && (p.currency ? p.currency !== 'USD' : (p.methodId.includes('_bs') || p.methodId === 'pago_movil'));
                // FIN-024: mulR para conversiones raw.
                const val = pIsInternalCredit
                    ? '-' + fmtUsd(p.amountUsd || 0)
                    : pIsCop
                    ? 'COP ' + (p.amountInput || mulR(p.amountUsd, (sale.tasaCop || 1))).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : isBs
                    ? 'Bs ' + formatBs(p.amountBs || mulR(p.amountUsd, rate))
                    : fmtUsd(p.amountUsd || 0);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(...BODY);
                doc.text(pIsInternalCredit ? 'Saldo a favor utilizado:' : (p.methodLabel || 'Pago'), M, y);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...INK);
                doc.text(val, RIGHT, y, { align: 'right' });
                y += 5;
            });
        }

        if (hasFiado) {
            y += 2;
            const fiadoRate = bcvRate || rate; // Usar tasa actual para deuda pendiente
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...RED);
            doc.text('Deuda pendiente:', M, y);

            if (receiptCurrencyMode === 'usd') {
                doc.text(fmtUsd(sale.fiadoUsd), RIGHT, y, { align: 'right' });
                y += 6;
            } else if (receiptCurrencyMode === 'bs') {
                doc.text('Bs ' + formatBs(mulR(sale.fiadoUsd, fiadoRate)), RIGHT, y, { align: 'right' });
                y += 6;
            } else {
                doc.text(fmtUsd(sale.fiadoUsd), RIGHT, y, { align: 'right' });
                y += 4;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.5);
                doc.text('Bs ' + formatBs(mulR(sale.fiadoUsd, fiadoRate)) + ' (tasa actual)', RIGHT, y, { align: 'right' });
                y += 6;
            }
        }

        if (hasPhysicalChange) {
            y += 2;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...BODY);
            if (sale.changeUsd > 0) {
                doc.text('Vuelto entregado:', M, y);
                doc.text(fmtUsd(sale.changeUsd), RIGHT, y, { align: 'right' });
                y += 5;
            }
            if (sale.changeBs > 0) {
                doc.text('Vuelto entregado Bs:', M, y);
                doc.text('Bs ' + formatBs(sale.changeBs), RIGHT, y, { align: 'right' });
                y += 5;
            }
        }

        if (tipDonatedUsd > 0) {
            y += 2;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...GREEN);
            doc.text('Cambio dejado en caja:', M, y);
            doc.text('+' + fmtUsd(tipDonatedUsd), RIGHT, y, { align: 'right' });
            y += 6;
        }

        if (walletCreditUsd > 0) {
            y += 2;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...GREEN);
            doc.text(walletCreditLabel, M, y);
            doc.text('+' + fmtUsd(walletCreditUsd), RIGHT, y, { align: 'right' });
            y += 6;
        }

        y += 2;
        dash(y); y += 7;
    }

    // ════════════════════════════════════
    //  PIE
    // ════════════════════════════════════
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text('¡Gracias por tu compra!', CX, y, { align: 'center' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(...MUTED);
    doc.text('Este documento no constituye factura', CX, y, { align: 'center' });
    y += 3.5;
    doc.text('fiscal. Es un comprobante de control', CX, y, { align: 'center' });
    y += 3.5;
    doc.text('interno sin validez tributaria.', CX, y, { align: 'center' });

    // ── DESCARGAR DIRECTO ──
    const filename = 'ticket_' + saleNum + '.pdf';
    doc.save(filename);
}

/**
 * Imprime un ticket de venta en impresora termica via window.print().
 * Genera un HTML optimizado para papel termico 58mm/80mm.
 * Compatible con impresoras USB (PC) y Bluetooth emparejadas (movil Android/iOS).
 */
export function printThermalTicket(sale, bcvRate) {
    const paperWidth = localStorage.getItem('printer_paper_width') || '58';
    const paperConfig = getPaperConfig(paperWidth);

    // ── OBTENER CONFIGURACION DEL NEGOCIO ──
    const settings = {
        name: localStorage.getItem('business_name') || 'Bodega Sin Nombre',
        rif: localStorage.getItem('business_rif') || '',
        address: localStorage.getItem('business_address') || '',
        phone: localStorage.getItem('business_phone') || '',
        instagram: localStorage.getItem('business_instagram') || ''
    };

    const html = buildTicketHtml(sale, bcvRate, paperConfig, settings);
    openPrintWindow(html);
}
