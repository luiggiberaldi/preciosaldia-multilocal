import { formatBs, formatCop, formatUsd } from './calculatorUtils.js';
import { mulR, divR } from './dinero.js';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Genera el HTML completo para impresión térmica de un ticket de venta.
 */
export function buildTicketHtml(sale, bcvRate, paperConfig, settings) {
    const {
        is80, cssPageSize, cssBodyWidth, cssLogoW,
        fDisclaimer, fTiny, fSmall, fBase, fTitle, fTotalU, fTotalB,
    } = paperConfig;

    const receiptCurrencyMode = (typeof localStorage !== 'undefined' ? localStorage.getItem('receipt_currency_mode') : null) || 'bs';
    const rate = sale.rate || bcvRate || 1;
    const isCop = sale.copEnabled && sale.tasaCop > 0;
    // FIN-024: formatUsd en vez de parseFloat(v).toFixed(2).
    const fmtUsd = (v) => isCop ? `USD ${formatUsd(v)}` : `$${formatUsd(v)}`;
    const saleNum = String(sale.saleNumber || 0).padStart(7, '0');
    const d = new Date(sale.timestamp);
    const fecha = d.toLocaleDateString('es-VE');
    const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    const hasFiado = sale.fiadoUsd > 0;

    const isBsSale = (sale.payments || []).some(p => {
        const isCop = p.currency === 'COP';
        const isBs = !isCop && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
        return isBs && parseFloat(p.amountBs || 0) > 0;
    });

    // Generar filas de productos
    const itemsHtml = (sale.items || []).map(item => {
        const isDualBs = item.pricingMode === 'dual_usd' && parseFloat(item.priceBsUsdRef) > 0 && isBsSale;
        const effectivePriceUsd = isDualBs ? parseFloat(item.priceBsUsdRef) : item.priceUsd;

        // FIN-024: formatUsd para qty peso, sin toFixed.
        const qty = item.isWeight ? formatUsd(item.qty) : String(item.qty);
        const unit = item.isWeight ? 'Kg' : 'u';
        // FIN-024: mulR en vez de multiplicación raw.
        const itemExactBs = item.exactBs ?? (item.isCashAdvance && item.currency === 'BS' ? (item.montoEfectivo + item.montoComision) : null);
        const sub = itemExactBs != null ? (rate > 0 ? divR(itemExactBs, rate) : effectivePriceUsd) : mulR(effectivePriceUsd, item.qty);
        const subBs = itemExactBs != null ? mulR(itemExactBs, item.qty) : mulR(sub, rate);
        const name = escapeHtml(item.name);
        const priceBs = itemExactBs != null ? itemExactBs : mulR(effectivePriceUsd, rate);

        let totalStr = '';
        let unitPriceStr = '';

        if (receiptCurrencyMode === 'usd') {
            totalStr = fmtUsd(sub);
            unitPriceStr = `$${formatUsd(effectivePriceUsd)}`;
        } else if (receiptCurrencyMode === 'bs') {
            totalStr = 'Bs ' + formatBs(subBs);
            unitPriceStr = `Bs ${formatBs(priceBs)}`;
        } else {
            totalStr = fmtUsd(sub);
            unitPriceStr = isCop
                ? 'USD ' + formatUsd(effectivePriceUsd) + ' (' + formatCop(item.priceCop || Math.round(effectivePriceUsd * sale.tasaCop)) + ' COP)'
                : `$${formatUsd(effectivePriceUsd)}`;
        }

        return `
            <tr>
                <td colspan="2" style="text-align:left;font-size:${fBase};font-weight:bold;padding:6px 0 1px 0;line-height:1.25;word-break:break-word;">
                    ${name}
                </td>
            </tr>
            <tr>
                <td style="text-align:left;font-size:${fSmall};color:#666;padding:1px 4px 6px 0;width:65%;vertical-align:middle;border-bottom:1px dotted #ccc;">
                    ${qty}${unit} x ${unitPriceStr}
                </td>
                <td style="text-align:right;font-size:${fBase};font-weight:bold;padding:1px 0 6px 0;width:35%;vertical-align:middle;white-space:nowrap;border-bottom:1px dotted #ccc;">
                    ${totalStr}
                </td>
            </tr>`;
    }).join('');

    // Generar filas de pagos
    const paymentsHtml = (sale.payments || []).map(p => {
        const pIsCop = p.currency === 'COP';
        const pIsInternalCredit = p.methodId === 'saldo_favor' || p.currency === 'INTERNAL_CREDIT' || p.isInternalCredit;
        const isBs = !pIsCop && !pIsInternalCredit && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
        // FIN-024: mulR en vez de multiplicación raw.
        const val = pIsInternalCredit
            ? '-' + fmtUsd(p.amountUsd || 0)
            : pIsCop
            ? 'COP ' + (p.amountInput || mulR(p.amountUsd, (sale.tasaCop || 1))).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : isBs
            ? 'Bs ' + formatBs(p.amountBs || mulR(p.amountUsd, rate))
            : fmtUsd(p.amountUsd || 0);
        return `
            <tr>
                <td style="font-size:11px;padding:2px 4px 2px 0;text-align:left;width:65%;word-break:break-word;vertical-align:top;">${escapeHtml(pIsInternalCredit ? 'Saldo a favor utilizado' : (p.methodLabel || 'Pago'))}</td>
                <td style="font-size:11px;font-weight:bold;text-align:right;width:35%;white-space:nowrap;vertical-align:top;">${val}</td>
            </tr>`;
    }).join('');

    const fiadoRate = bcvRate || rate;
    const walletCreditUsd = sale.tipo === 'COBRO_DEUDA'
        ? Math.max(0, Number(sale.saldoFavorGeneradoUsd) || 0)
        : ['VENTA', 'VENTA_CASHEA'].includes(sale.tipo)
            ? Math.max(0, Number(sale.vueltoParaMonedero) || 0)
            : 0;
    const walletCreditLabel = sale.tipo === 'COBRO_DEUDA'
        ? 'Saldo a favor generado (sobrante de abono):'
        : 'Saldo a favor acreditado:';
    const walletCreditHtml = walletCreditUsd > 0
        ? `<div style="margin-top:6px;padding:4px 0;border-top:1px dashed #000;"><table style="width:100%"><tr><td style="color:#087f8c;font-weight:bold;font-size:11px;width:65%;text-align:left;">${walletCreditLabel}</td><td style="color:#087f8c;font-weight:bold;font-size:11px;width:35%;text-align:right;white-space:nowrap;">+${fmtUsd(walletCreditUsd)}</td></tr></table></div>`
        : '';
    const physicalChangeHtml = (Number(sale.changeUsd) > 0 || Number(sale.changeBs) > 0)
        ? `<div style="margin-top:6px;padding:4px 0;border-top:1px dashed #000;"><table style="width:100%">${Number(sale.changeUsd) > 0 ? `<tr><td style="font-weight:bold;font-size:11px;width:65%;text-align:left;">Vuelto entregado:</td><td style="font-weight:bold;font-size:11px;width:35%;text-align:right;white-space:nowrap;">${fmtUsd(sale.changeUsd)}</td></tr>` : ''}${Number(sale.changeBs) > 0 ? `<tr><td style="font-weight:bold;font-size:11px;width:65%;text-align:left;">Vuelto entregado Bs:</td><td style="font-weight:bold;font-size:11px;width:35%;text-align:right;white-space:nowrap;">Bs ${formatBs(sale.changeBs)}</td></tr>` : ''}</table></div>`
        : '';
    const tipDonatedUsd = Math.max(0, Number(sale.tipDonated?.amountUsd) || 0);
    const tipHtml = tipDonatedUsd > 0
        ? `<div style="margin-top:6px;padding:4px 0;border-top:1px dashed #000;"><table style="width:100%"><tr><td style="color:#087f8c;font-weight:bold;font-size:11px;width:65%;text-align:left;">Cambio dejado en caja:</td><td style="color:#087f8c;font-weight:bold;font-size:11px;width:35%;text-align:right;white-space:nowrap;">+${fmtUsd(tipDonatedUsd)}</td></tr></table></div>`
        : '';
    // FIN-024: mulR en vez de multiplicación raw.
    let fiadoHtml = '';
    if (hasFiado) {
        let debtVal = '';
        let debtSub = '';

        if (receiptCurrencyMode === 'usd') {
            debtVal = fmtUsd(sale.fiadoUsd);
        } else if (receiptCurrencyMode === 'bs') {
            debtVal = 'Bs ' + formatBs(mulR(sale.fiadoUsd, fiadoRate));
        } else {
            debtVal = fmtUsd(sale.fiadoUsd);
            debtSub = `<tr><td></td><td style="color:#000;font-size:9px;width:35%;text-align:right;white-space:nowrap;vertical-align:top;">Bs ${formatBs(mulR(sale.fiadoUsd, fiadoRate))} (tasa actual)</td></tr>`;
        }

        fiadoHtml = `
            <div style="margin-top:6px;padding:4px 0;border-top:1px dashed #000;">
                <table style="width:100%"><tr>
                    <td style="color:#000;font-weight:bold;font-size:11px;width:65%;text-align:left;vertical-align:top;">Deuda pendiente:</td>
                    <td style="color:#000;font-weight:bold;font-size:11px;width:35%;text-align:right;white-space:nowrap;vertical-align:top;">${debtVal}</td>
                </tr>${debtSub}</table>
            </div>`;
    }

    // Generar bloque de subtotal y descuento dinámico
    let subtotalBlockHtml = '';
    if (sale.discountAmountUsd > 0) {
        let subVal = '';
        let descVal = '';

        if (receiptCurrencyMode === 'usd') {
            subVal = fmtUsd(sale.cartSubtotalUsd || (sale.totalUsd + sale.discountAmountUsd));
            descVal = '-' + fmtUsd(sale.discountAmountUsd);
        } else if (receiptCurrencyMode === 'bs') {
            subVal = 'Bs ' + formatBs(mulR(sale.cartSubtotalUsd || (sale.totalUsd + sale.discountAmountUsd), rate));
            descVal = '-Bs ' + formatBs(mulR(sale.discountAmountUsd, rate));
        } else {
            subVal = fmtUsd(sale.cartSubtotalUsd || (sale.totalUsd + sale.discountAmountUsd));
            descVal = '-' + fmtUsd(sale.discountAmountUsd);
        }

        subtotalBlockHtml = `
        <table style="margin-bottom:6px; font-size:${fTiny}; border-bottom: 1px dashed #000; padding-bottom: 4px;">
            <tr>
                <td style="text-align:left; color:#000; font-weight:bold;">SUBTOTAL:</td>
                <td style="text-align:right; color:#000; font-weight:bold;">${subVal}</td>
            </tr>
            <tr>
                <td style="text-align:left; color:#000; font-weight:bold;">${sale.discountType === 'percentage' ? `DESCUENTO (${sale.discountValue}%):` : 'DESCUENTO:'}</td>
                <td style="text-align:right; color:#000; font-weight:bold;">${descVal}</td>
            </tr>
        </table>
        `;
    }

    // Generar bloque total dinámico
    let totalBlockHtml = '';
    if (receiptCurrencyMode === 'usd') {
        totalBlockHtml = `<div class="total-usd">${fmtUsd(sale.totalUsd || 0)}</div>`;
    } else if (receiptCurrencyMode === 'bs') {
        totalBlockHtml = `<div class="total-usd">Bs ${formatBs(sale.totalBs || 0)}</div>`;
    } else {
        totalBlockHtml = `
        <div class="total-usd">${fmtUsd(sale.totalUsd || 0)}</div>
        ${isCop ? `<div class="total-bs" style="font-size:${is80 ? '16px' : '13px'};">COP ${formatCop(sale.totalCop || mulR(sale.totalUsd, sale.tasaCop))}</div>` : ''}
        <div class="total-bs" style="margin-bottom:4px">Bs ${formatBs(sale.totalBs || 0)}</div>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Ticket #${saleNum}</title>
<style>
    @page {
        size: ${cssPageSize};
        margin: 0;
    }
    * { 
        margin: 0; 
        padding: 0; 
        box-sizing: border-box; 
        font-weight: bold !important; 
        color: #000 !important;
    }
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-weight: bold;
        width: ${cssBodyWidth};
        max-width: ${cssBodyWidth};
        margin: 0 auto;
        padding: 4mm 2mm;
        color: #000;
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .dash {
        border: none;
        border-top: 1px dashed #000 !important;
        margin: ${is80 ? '8px 0' : '6px 0'};
    }
    .total-usd {
        font-size: ${fTotalU};
        font-weight: 900;
        color: #000;
        text-align: center;
        margin: 4px 0;
    }
    .total-bs {
        font-size: ${fTotalB};
        font-weight: bold;
        text-align: center;
        margin-bottom: 4px;
    }
    table { width: 100%; border-collapse: collapse; }
    @media print {
        body { width: ${cssBodyWidth}; max-width: ${cssBodyWidth}; }
    }
    @media screen {
        body {
            border: 1px solid #ccc;
            margin-top: 10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
    }
</style>
</head>
<body>
    <!-- Logo -->
    <div class="center" style="margin-bottom:6px;">
        <img src="./logo.png" alt="Logo" style="max-width:${cssLogoW};max-height:16mm;" onerror="this.style.display='none'">
    </div>

    <!-- Info del Negocio -->
    <div class="center" style="margin-bottom:6px;line-height:1.2;">
        ${settings.name ? `<div class="bold" style="font-size:${fTitle};text-transform:uppercase;">${escapeHtml(settings.name)}</div>` : ''}
        ${settings.rif ? `<div style="font-size:${fTiny};">RIF: ${escapeHtml(settings.rif)}</div>` : ''}
        ${settings.address ? `<div style="font-size:${fTiny};">${escapeHtml(settings.address)}</div>` : ''}
        ${settings.phone ? `<div style="font-size:${fTiny};">Tel: ${escapeHtml(settings.phone)}</div>` : ''}
        ${settings.instagram ? `<div style="font-size:${fTiny};">Ig: ${escapeHtml(settings.instagram)}</div>` : ''}
    </div>

    <hr class="dash">

    <!-- Info -->
    <div style="font-size:${fSmall};font-weight:bold;margin-bottom:2px;text-align:left;">N: #${saleNum}</div>
    <div style="font-size:${fTiny};color:#000;margin-bottom:4px;text-align:left;">Fecha: ${fecha} ${hora}</div>
    <div style="font-size:${fSmall};margin:3px 0 2px;">
        <span style="font-weight:bold;">Cliente:</span> ${escapeHtml(sale.customerName || 'Consumidor Final')}
    </div>
    ${sale.customerDocument ? `<div style="font-size:${fTiny};color:#000;">C.I/RIF: ${escapeHtml(sale.customerDocument)}</div>` : ''}

    <hr class="dash">

    <!-- Productos Header -->
    <table style="margin-bottom:4px;width:100%;">
        <tr style="font-size:${fTiny};color:#555;font-weight:bold;">
            <td style="text-align:left;width:70%;">CONCEPTO</td>
            <td style="text-align:right;width:30%;">TOTAL</td>
        </tr>
    </table>

    <!-- Productos -->
    <table style="width:100%;">${itemsHtml}</table>

    <!-- Total -->
    <div style="margin:8px 0;">
        ${subtotalBlockHtml}
        <div class="center bold" style="font-size:${fSmall};color:#000;margin-bottom:4px;">TOTAL</div>
        ${totalBlockHtml}
    </div>

    <hr class="dash">

    <!-- Pagos -->
    ${(sale.payments && sale.payments.length > 0) || hasFiado || walletCreditUsd > 0 || tipDonatedUsd > 0 || Number(sale.changeUsd) > 0 || Number(sale.changeBs) > 0 ? `
    <div style="margin:4px 0;">
        <div style="font-size:${fTiny};color:#000;font-weight:bold;margin-bottom:4px;">PAGOS REALIZADOS</div>
        <table>${paymentsHtml}</table>
        ${fiadoHtml}
        ${physicalChangeHtml}
        ${tipHtml}
        ${walletCreditHtml}
    </div>
    <hr class="dash">
    ` : ''}

    <!-- Pie -->
    <div class="center bold" style="font-size:${fBase};margin:8px 0 4px;">Gracias por tu compra!</div>
    <div class="center" style="font-size:${fDisclaimer};color:#888;margin-top:4px;line-height:1.4;">Este documento no constituye factura fiscal.<br>Comprobante de control interno sin validez tributaria.</div>
</body>
</html>`;
}
