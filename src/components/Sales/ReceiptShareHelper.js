import { formatBs } from '../../utils/calculatorUtils';

/**
 * Builds a WhatsApp-ready receipt URL for sharing a sale.
 * @param {object} receipt - The sale/receipt object
 * @returns {string} WhatsApp URL with pre-filled message
 */
export function buildReceiptWhatsAppUrl(receipt, currentRate) {
    const r = receipt;
    const isCop = r.copEnabled && r.tasaCop > 0;
    const fmtUsd = (v) => isCop ? `USD ${parseFloat(v).toFixed(2)}` : `$${parseFloat(v).toFixed(2)}`;
    const fecha = new Date(r.timestamp).toLocaleDateString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const saleNum = r.id?.slice(-6).toUpperCase() ?? '------';
    const sep = '================================';
    const sep2 = '--------------------------------';

    const receiptCurrencyMode = localStorage.getItem('receipt_currency_mode') || 'bs';

    // Items
    const itemsLines = (r.items ?? []).map(item => {
        const qty = item.isWeight
            ? `${parseFloat(item.qty).toFixed(3)} kg`
            : `${item.qty} und`;
        const subUsd = (item.priceUsd * item.qty).toFixed(2);
        const unitPriceUsd = parseFloat(item.priceUsd).toFixed(2);
        const priceBs = item.priceUsd * (r.rate || 1);
        const subBs = item.priceUsd * item.qty * (r.rate || 1);

        if (receiptCurrencyMode === 'usd') {
            const subStr = isCop ? `USD ${subUsd}` : `$${subUsd}`;
            const unitStr = isCop ? `USD ${unitPriceUsd}` : `$${unitPriceUsd}`;
            return `- ${item.name}\n  ${qty} x ${unitStr} = ${subStr}`;
        }
        
        if (receiptCurrencyMode === 'bs') {
            const subStr = `Bs ${formatBs(subBs)}`;
            const unitStr = `Bs ${formatBs(priceBs)}`;
            return `- ${item.name}\n  ${qty} x ${unitStr} = ${subStr}`;
        }

        // mixto
        const subStr = isCop ? `USD ${subUsd}` : `$${subUsd}`;
        const unitStr = isCop ? `USD ${unitPriceUsd}` : `$${unitPriceUsd}`;
        let line = `- ${item.name}\n  ${qty} x ${unitStr} = ${subStr}`;
        if (isCop) {
            const copSub = (item.priceUsd * item.qty * r.tasaCop).toLocaleString('es-CO', { maximumFractionDigits: 0 });
            line += ` (${copSub} COP)`;
        }
        return line;
    }).join('\n');

    // Pagos
    const paymentsLines = (r.payments ?? []).map(p => {
        const pIsCop = p.currency === 'COP';
        const isBs = p.currency === 'BS';
        const val = pIsCop
            ? `COP ${(p.amountInput ?? p.amountUsd * (r.tasaCop || 1)).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
            : isBs
            ? `Bs ${formatBs(p.amountBs ?? p.amountUsd * r.rate)}`
            : `USD ${parseFloat(p.amountUsd).toFixed(2)}`;
        return `  ${p.methodLabel}: ${val}`;
    }).join('\n');

    // Totales
    const totalBs = r.totalBs ?? (r.totalUsd * r.rate);
    const totalUsdStr = fmtUsd(r.totalUsd || 0);
    const totalBsStr = `Bs ${formatBs(totalBs)}`;
    const totalCopStr = isCop ? `  /  COP ${(r.totalCop || (r.totalUsd * r.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

    let totalLine = '';
    if (receiptCurrencyMode === 'usd') {
        totalLine = `TOTAL: ${totalUsdStr}`;
    } else if (receiptCurrencyMode === 'bs') {
        totalLine = `TOTAL: ${totalBsStr}`;
    } else {
        totalLine = `TOTAL: ${totalUsdStr}  /  ${totalBsStr}${totalCopStr}`;
    }

    // Vuelto
    const changeLines = (r.changeUsd > 0.005 || r.changeBs > 0.5)
        ? receiptCurrencyMode === 'usd'
            ? r.changeUsd > 0.005
                ? `\nVUELTO: ${fmtUsd(r.changeUsd)}`
                : `\nVUELTO: Bs ${formatBs(r.changeBs)}`
            : receiptCurrencyMode === 'bs'
            ? `\nVUELTO: Bs ${formatBs(r.changeBs)}`
            : `\nVUELTO: ${fmtUsd(r.changeUsd)} / Bs ${formatBs(r.changeBs)}`
        : '';

    // TIP-007: parte del cambio dejada en caja
    const tipLine = (r.tipDonated && r.tipDonated.amountUsd > 0.005)
        ? (r.tipDonated.currency === 'BS'
            ? `\nCAMBIO DEJADO EN CAJA: Bs ${formatBs(r.tipDonated.amountBs)}`
            : `\nCAMBIO DEJADO EN CAJA: ${fmtUsd(r.tipDonated.amountUsd)}`)
        : '';

    // Fiado
    const fiadoRate = currentRate || r.rate || 1;
    const fiadoLine = r.fiadoUsd > 0.005
        ? receiptCurrencyMode === 'usd'
            ? `\nPENDIENTE (fiado): ${fmtUsd(r.fiadoUsd)}`
            : receiptCurrencyMode === 'bs'
            ? `\nPENDIENTE (fiado): Bs ${formatBs(r.fiadoUsd * fiadoRate)}`
            : `\nPENDIENTE (fiado): ${fmtUsd(r.fiadoUsd)} / Bs ${formatBs(r.fiadoUsd * fiadoRate)}`
        : '';

    // Cliente
    let clienteStrContent = '';
    if (r.customerName && r.customerName !== 'Consumidor Final') {
        clienteStrContent += `Cliente: ${r.customerName}\n`;
        if (r.customerDocument) {
            clienteStrContent += `Documento: ${r.customerDocument}\n`;
        }
    }
    const clienteLine = clienteStrContent;

    const bName = localStorage.getItem('business_name');
    const bRif = localStorage.getItem('business_rif');

    let headerBlocks = [];
    if (bName) {
        headerBlocks.push(`*${bName.toUpperCase()}*`);
        if (bRif) headerBlocks.push(`RIF: ${bRif}`);
        headerBlocks.push(sep2);
        headerBlocks.push(`COMPROBANTE DE VENTA`);
    } else {
        headerBlocks.push(`COMPROBANTE DE VENTA | PRECIOS AL DIA`);
    }

    const text = [
        ...headerBlocks,
        sep2,
        `Orden: #${saleNum}`,
        `${clienteLine}Fecha: ${fecha}`,
        sep,
        ``,
        `DETALLE DE PRODUCTOS:`,
        itemsLines,
        ``,
        sep,
        totalLine,
        paymentsLines ? `\nPAGOS:\n${paymentsLines}` : '',
        changeLines,
        tipLine,
        fiadoLine,
        sep,
        r.tasaCop > 0 ? `Tasa COP: ${r.tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` : '',
        `Gracias por su compra!`,
        ``,
        `_Este documento no constituye factura fiscal. Comprobante de control interno._`,
        `Precios Al Dia - Sistema POS`,
    ].filter(Boolean).join('\n');

    const formatVzlaPhone = (phone) => {
        if (!phone) return null;
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('58')) return digits;
        if (digits.startsWith('0')) return '58' + digits.slice(1);
        return '58' + digits;
    };

    const phone = formatVzlaPhone(r.customerPhone);
    return phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
}
