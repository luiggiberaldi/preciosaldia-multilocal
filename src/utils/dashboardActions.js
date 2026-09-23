import { formatBs, formatVzlaPhone, formatCop } from './calculatorUtils';
import { round2, round3, mulR } from './dinero';

/**
 * dashboardActions.js — Acciones del dashboard (compartir venta por WhatsApp).
 *
 * Migrado a dinero.js (deuda técnica detectada por guardrail ESLint):
 *   - `parseFloat(v).toFixed(2)` → `round2(v)` + template string
 *   - `item.qty.toFixed(3)` (peso en kg) → `round3(item.qty)` + template string
 *   - `item.priceUsd * item.qty` → `mulR(item.priceUsd, item.qty)`
 *   - `(sale.totalUsd || 0) * sale.tasaCop` → `mulR(sale.totalUsd || 0, sale.tasaCop)`
 *   - `sale.fiadoUsd * bcvRate` → `mulR(sale.fiadoUsd, bcvRate)`
 */

export function shareSaleWhatsApp(sale, saleCustomer, bcvRate) {
    const isCop = sale.copEnabled && sale.tasaCop > 0;
    // Display de USD: round2 + template (no toFixed).
    const fmtUsd = (v) => isCop ? `USD ${round2(v)}` : `$${round2(v)}`;
    let text = `*COMPROBANTE DE VENTA | PRECIOS AL DÍA*\n`;
    text += `--------------------------------\n`;
    text += `*Orden:* #${sale.id.substring(0, 6).toUpperCase()}\n`;
    text += `Cliente: ${sale.customerName || 'Consumidor Final'}\n`;
    text += `Fecha: ${new Date(sale.timestamp).toLocaleString('es-VE')}\n`;
    text += `===================================\n\n`;
    text += `*DETALLE DE PRODUCTOS:*\n`;

    if (sale.items && sale.items.length > 0) {
        sale.items.forEach(item => {
            // Cantidad: peso usa 3 decimales (round3), unidad es entero.
            const qty = item.isWeight ? `${round3(item.qty)}Kg` : `${item.qty} Und`;
            // Subtotal línea: mulR para evitar drift.
            const lineTotal = mulR(item.priceUsd, item.qty);
            text += `- ${item.name}\n  ${qty} x ${fmtUsd(item.priceUsd)} = *${fmtUsd(lineTotal)}*\n`;
        });
        text += `\n===================================\n`;
    }

    text += `*TOTAL: ${fmtUsd(sale.totalUsd || 0)}*\n`;
    text += ` Ref: ${formatBs(sale.totalBs || 0)} Bs a ${formatBs(sale.rate || bcvRate)} Bs/${isCop ? 'USD' : '$'}\n`;
    if (isCop) {
        // COP: mulR para conversión (tasaCop puede ser grande, drift significativo).
        const totalCop = mulR(sale.totalUsd || 0, sale.tasaCop);
        text += ` COP: ${formatCop(totalCop)} COP\n`;
    }

    if (sale.fiadoUsd > 0) {
        text += `\n*SALDO PENDIENTE (FIADO): ${fmtUsd(sale.fiadoUsd)}*\n`;
        if (bcvRate > 0) {
            // Equivalente en Bs: mulR.
            const fiadoBs = mulR(sale.fiadoUsd, bcvRate);
            text += ` Equivalente: ${formatBs(fiadoBs)} Bs (tasa actual)\n`;
        }
    }
    text += `\n===================================\n`;
    text += `*¡Gracias por su compra!*\n\n`;
    text += `_Este documento no constituye factura fiscal. Comprobante de control interno._`;

    const encoded = encodeURIComponent(text);

    // Buscar el cliente de la venta para abrir WhatsApp directo a su número
    const phone = formatVzlaPhone(saleCustomer?.phone);
    const waUrl = phone
        ? `https://wa.me/${phone}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
}
