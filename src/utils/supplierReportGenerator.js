import { jsPDF } from 'jspdf';
import { formatBs, formatCop, formatUsd } from './calculatorUtils';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';

export async function generateSupplierHistoryPDF({
    supplier,
    historyData = [],
    bcvRate = 0,
    tasaCop = 0,
    copEnabled = false,
}) {
    const doc = new jsPDF('p', 'mm', 'letter');
    const WIDTH = 215.9;
    const HEIGHT = 279.4;
    const M = 15;
    const RIGHT = WIDTH - M;
    let y = 15;
    let pageNum = 1;

    // Colores del tema de impresión premium (Coordinado con el branding de Precios Al Día)
    const INK = [33, 37, 41];
    const BODY = [73, 80, 87];
    const MUTED = [134, 142, 150];
    const GREEN = [16, 124, 65];
    const RED = [180, 40, 50];
    const BLUE = [1, 105, 111]; // Tono brand "Precios Al Día"
    const RULE = [222, 226, 230];

    const addFooter = (pNum) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`Precios Al Día Bodega · Estado de Cuenta Individual · Página ${pNum}`, WIDTH / 2, HEIGHT - 10, { align: 'center' });
    };

    const checkPageBreak = (neededHeight) => {
        if (y + neededHeight > HEIGHT - 20) {
            addFooter(pageNum);
            doc.addPage();
            pageNum++;
            y = 15;
            return true;
        }
        return false;
    };

    // --- Header ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...BLUE);
    doc.text('ESTADO DE CUENTA', M, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BODY);
    doc.text(`Proveedor: ${supplier.name.toUpperCase()}`, M, y);
    
    // Fecha de emisión
    const nowStr = new Date().toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`Emitido: ${nowStr}`, RIGHT, y, { align: 'right' });
    y += 6;

    if (supplier.documentId || supplier.contactName) {
        let details = [];
        if (supplier.documentId) details.push(`RIF/Doc: ${supplier.documentId}`);
        if (supplier.contactName) details.push(`Contacto: ${supplier.contactName}`);
        if (supplier.phone) details.push(`Tlf: ${supplier.phone}`);
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...BODY);
        doc.text(details.join('  |  '), M, y);
        y += 6;
    }

    // Línea de separación
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(M, y, RIGHT, y);
    y += 8;

    // --- Resumen de Saldos ---
    doc.setFillColor(252, 242, 242); // Fondo rosa suave
    doc.rect(M, y, WIDTH - 2 * M, 20, 'F');
    doc.setDrawColor(245, 200, 200);
    doc.rect(M, y, WIDTH - 2 * M, 20, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...RED);
    doc.text('BALANCE TOTAL PENDIENTE', M + 5, y + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...RED);
    doc.text(`USD ${formatUsd(supplier.deuda || 0)}`, RIGHT - 5, y + 13, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...BODY);
    let extraBalances = [];
    if (bcvRate > 0) extraBalances.push(`${formatBs((supplier.deuda || 0) * bcvRate)} Bs`);
    if (copEnabled && tasaCop > 0) extraBalances.push(`${formatCop((supplier.deuda || 0) * tasaCop)} COP`);
    doc.text(extraBalances.join('  |  '), M + 5, y + 13);
    y += 28;

    // --- Tabla de Movimientos ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BLUE);
    doc.text('HISTORIAL DE MOVIMIENTOS', M, y);
    y += 6;

    // Cabecera Tabla
    const drawTableHeader = (posY) => {
        doc.setFillColor(...BLUE);
        doc.rect(M, posY, WIDTH - 2 * M, 8, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        
        doc.text('Fecha / Hora', M + 3, posY + 5.5);
        doc.text('Tipo', M + 32, posY + 5.5);
        doc.text('Referencia / Concepto', M + 60, posY + 5.5);
        doc.text('Caja', M + 122, posY + 5.5);
        doc.text('Método', M + 136, posY + 5.5);
        doc.text('Monto USD', RIGHT - 3, posY + 5.5, { align: 'right' });
    };

    drawTableHeader(y);
    y += 8;

    if (historyData.length === 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(10);
        doc.setTextColor(...MUTED);
        doc.text('No hay movimientos registrados para este proveedor.', WIDTH / 2, y + 10, { align: 'center' });
    } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        
        historyData.forEach((record, index) => {
            checkPageBreak(8);

            // Fondo alterno para filas
            if (index % 2 === 1) {
                doc.setFillColor(248, 249, 250);
                doc.rect(M, y, WIDTH - 2 * M, 7, 'F');
            }

            const isInvoice = record.type === 'INVOICE';
            const dateObj = new Date(record.date || record.timestamp);
            const dateStr = dateObj.toLocaleDateString('es-VE') + ' ' + dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });

            doc.setTextColor(...INK);
            doc.text(dateStr, M + 3, y + 4.8);

            // Tipo con color
            if (isInvoice) {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...RED);
                doc.text('Factura', M + 32, y + 4.8);
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...GREEN);
                doc.text('Abono/Pago', M + 32, y + 4.8);
            }
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...INK);

            // Referencia
            const refText = isInvoice 
                ? `Factura #${record.invoiceNumber || 'S/N'}` 
                : (record.description || 'Pago Registrado');
            const truncatedRef = refText.length > 32 ? refText.slice(0, 30) + '...' : refText;
            doc.text(truncatedRef, M + 60, y + 4.8);

            // Afecta Caja (Y/N)
            const cajaText = isInvoice 
                ? 'N/A' 
                : (record.afectaCaja !== false ? 'SÍ' : 'NO');
            if (cajaText === 'SÍ') {
                doc.setTextColor(...BLUE);
                doc.setFont('helvetica', 'bold');
            } else {
                doc.setTextColor(...MUTED);
            }
            doc.text(cajaText, M + 122, y + 4.8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...INK);

            // Método de Pago
            const methodLabel = isInvoice 
                ? 'N/A' 
                : toTitleCase(getPaymentLabel(record.paymentMethod || (record.payments && record.payments[0]?.methodId) || ''));
            const truncatedMethod = methodLabel.length > 18 ? methodLabel.slice(0, 16) + '...' : methodLabel;
            doc.text(truncatedMethod, M + 136, y + 4.8);

            // Monto
            const amountUsdVal = isInvoice ? (record.amountUsd || 0) : Math.abs(record.totalUsd || 0);
            const prefix = isInvoice ? '+' : '−';
            
            if (isInvoice) {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...RED);
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...GREEN);
            }
            
            doc.text(`${prefix} ${formatUsd(amountUsdVal)}`, RIGHT - 3, y + 4.8, { align: 'right' });
            doc.setFont('helvetica', 'normal');

            // Separador horizontal fino
            doc.setDrawColor(...RULE);
            doc.setLineWidth(0.2);
            doc.line(M, y + 7, RIGHT, y + 7);

            y += 7;
        });
    }

    addFooter(pageNum);
    doc.save(`Estado_Cuenta_${supplier.name.replace(/\s+/g, '_')}.pdf`);
}

export async function generateGlobalSuppliersPDF({
    suppliers = [],
    invoices = [],
    allSales = [],
    bcvRate = 0,
    tasaCop = 0,
    copEnabled = false,
}) {
    const doc = new jsPDF('p', 'mm', 'letter');
    const WIDTH = 215.9;
    const HEIGHT = 279.4;
    const M = 15;
    const RIGHT = WIDTH - M;
    let y = 15;
    let pageNum = 1;

    const INK = [33, 37, 41];
    const BODY = [73, 80, 87];
    const MUTED = [134, 142, 150];
    const GREEN = [16, 124, 65];
    const RED = [180, 40, 50];
    const BLUE = [1, 105, 111];
    const RULE = [222, 226, 230];

    const addFooter = (pNum) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`Precios Al Día Bodega · Reporte General de Proveedores · Página ${pNum}`, WIDTH / 2, HEIGHT - 10, { align: 'center' });
    };

    const checkPageBreak = (neededHeight) => {
        if (y + neededHeight > HEIGHT - 20) {
            addFooter(pageNum);
            doc.addPage();
            pageNum++;
            y = 15;
            return true;
        }
        return false;
    };

    // --- Header ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...BLUE);
    doc.text('REPORTE GENERAL DE PROVEEDORES', M, y);
    y += 6;

    // Fecha de emisión
    const nowStr = new Date().toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`Emitido: ${nowStr}`, M, y);
    y += 8;

    // --- Cálculos Generales ---
    const totalDebtUsd = suppliers.reduce((sum, s) => sum + (s.deuda || 0), 0);
    const activeSuppliersCount = suppliers.filter(s => (s.deuda || 0) > 0.01).length;

    // Cuadros de Resumen
    doc.setFillColor(248, 249, 250);
    doc.rect(M, y, WIDTH - 2 * M, 24, 'F');
    doc.setDrawColor(...RULE);
    doc.rect(M, y, WIDTH - 2 * M, 24, 'S');

    // Caja 1: Proveedores Totales
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('PROVEEDORES REGISTRADOS', M + 5, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(`${suppliers.length}`, M + 5, y + 14);

    // Caja 2: Con Deuda Activa
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('CON DEUDA ACTIVA', M + 65, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...RED);
    doc.text(`${activeSuppliersCount}`, M + 65, y + 14);

    // Caja 3: Total Deuda Consolidada
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('DEUDA TOTAL CONSOLIDADA', RIGHT - 5, y + 6, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...RED);
    doc.text(`USD ${formatUsd(totalDebtUsd)}`, RIGHT - 5, y + 14, { align: 'right' });
    
    let totalDetails = [];
    if (bcvRate > 0) totalDetails.push(`${formatBs(totalDebtUsd * bcvRate)} Bs`);
    if (copEnabled && tasaCop > 0) totalDetails.push(`${formatCop(totalDebtUsd * tasaCop)} COP`);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(totalDetails.join('  |  '), RIGHT - 5, y + 20, { align: 'right' });

    y += 32;

    // --- Listado de Proveedores ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BLUE);
    doc.text('RESUMEN DE SALDOS POR PROVEEDOR', M, y);
    y += 6;

    // Cabecera Tabla Proveedores
    const drawSuppliersHeader = (posY) => {
        doc.setFillColor(...BLUE);
        doc.rect(M, posY, WIDTH - 2 * M, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        doc.text('Proveedor', M + 3, posY + 5.5);
        doc.text('Rif / Documento', M + 60, posY + 5.5);
        doc.text('Contacto', M + 105, posY + 5.5);
        doc.text('Monto Deuda (USD)', RIGHT - 3, posY + 5.5, { align: 'right' });
    };

    drawSuppliersHeader(y);
    y += 8;

    if (suppliers.length === 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(10);
        doc.setTextColor(...MUTED);
        doc.text('No hay proveedores registrados.', WIDTH / 2, y + 10, { align: 'center' });
        y += 18;
    } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);

        const sortedSuppliers = [...suppliers].sort((a, b) => (b.deuda || 0) - (a.deuda || 0));

        sortedSuppliers.forEach((s, idx) => {
            checkPageBreak(8);

            if (idx % 2 === 1) {
                doc.setFillColor(248, 249, 250);
                doc.rect(M, y, WIDTH - 2 * M, 7, 'F');
            }

            doc.setTextColor(...INK);
            doc.setFont('helvetica', 'bold');
            doc.text(s.name, M + 3, y + 4.8);
            doc.setFont('helvetica', 'normal');

            doc.text(s.documentId || 'S/D', M + 60, y + 4.8);
            doc.text(s.contactName || 'S/D', M + 105, y + 4.8);

            const debt = s.deuda || 0;
            if (debt > 0.01) {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...RED);
            } else {
                doc.setTextColor(...MUTED);
            }
            doc.text(`USD ${formatUsd(debt)}`, RIGHT - 3, y + 4.8, { align: 'right' });
            doc.setTextColor(...INK);
            doc.setFont('helvetica', 'normal');

            doc.setDrawColor(...RULE);
            doc.setLineWidth(0.2);
            doc.line(M, y + 7, RIGHT, y + 7);
            y += 7;
        });
    }

    y += 8;

    // --- Historial Reciente de Egresos / Facturas Global ---
    checkPageBreak(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BLUE);
    doc.text('ACTIVIDAD RECIENTE (ÚLTIMAS TRANSACCIONES)', M, y);
    y += 6;

    // Cabecera Historial Reciente
    const drawActivityHeader = (posY) => {
        doc.setFillColor(...BODY);
        doc.rect(M, posY, WIDTH - 2 * M, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        doc.text('Fecha / Hora', M + 3, posY + 5.5);
        doc.text('Proveedor', M + 32, posY + 5.5);
        doc.text('Operación', M + 75, posY + 5.5);
        doc.text('Caja', M + 115, posY + 5.5);
        doc.text('Método', M + 130, posY + 5.5);
        doc.text('Monto USD', RIGHT - 3, posY + 5.5, { align: 'right' });
    };

    drawActivityHeader(y);
    y += 8;

    const allPayments = allSales.filter(s => s.tipo === 'PAGO_PROVEEDOR');
    const combinedActivity = [
        ...invoices.map(i => ({ ...i, type: 'INVOICE' })),
        ...allPayments.map(p => ({ ...p, type: 'PAYMENT' }))
    ].sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp))
     .slice(0, 20);

    if (combinedActivity.length === 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(10);
        doc.setTextColor(...MUTED);
        doc.text('No hay transacciones recientes registradas.', WIDTH / 2, y + 10, { align: 'center' });
    } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.2);

        combinedActivity.forEach((act, idx) => {
            checkPageBreak(8);

            if (idx % 2 === 1) {
                doc.setFillColor(248, 249, 250);
                doc.rect(M, y, WIDTH - 2 * M, 7, 'F');
            }

            const isInvoice = act.type === 'INVOICE';
            const dateObj = new Date(act.date || act.timestamp);
            const dateStr = dateObj.toLocaleDateString('es-VE') + ' ' + dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });

            doc.setTextColor(...INK);
            doc.text(dateStr, M + 3, y + 4.8);

            const provName = act.supplierName || suppliers.find(s => s.id === act.supplierId)?.name || 'Desconocido';
            const truncatedProv = provName.length > 20 ? provName.slice(0, 18) + '...' : provName;
            doc.text(truncatedProv, M + 32, y + 4.8);

            if (isInvoice) {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...RED);
                doc.text(`Factura #${act.invoiceNumber || 'S/N'}`, M + 75, y + 4.8);
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...GREEN);
                doc.text(act.description || 'Abono/Pago', M + 75, y + 4.8);
            }
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...INK);

            const cajaText = isInvoice ? 'N/A' : (act.afectaCaja !== false ? 'SÍ' : 'NO');
            if (cajaText === 'SÍ') {
                doc.setTextColor(...BLUE);
                doc.setFont('helvetica', 'bold');
            } else {
                doc.setTextColor(...MUTED);
            }
            doc.text(cajaText, M + 115, y + 4.8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...INK);

            const methodLabel = isInvoice ? 'N/A' : toTitleCase(getPaymentLabel(act.paymentMethod || (act.payments && act.payments[0]?.methodId) || ''));
            const truncatedMethod = methodLabel.length > 18 ? methodLabel.slice(0, 16) + '...' : methodLabel;
            doc.text(truncatedMethod, M + 130, y + 4.8);

            const amtVal = isInvoice ? (act.amountUsd || 0) : Math.abs(act.totalUsd || 0);
            const prefix = isInvoice ? '+' : '−';

            if (isInvoice) {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...RED);
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...GREEN);
            }
            doc.text(`${prefix} ${formatUsd(amtVal)}`, RIGHT - 3, y + 4.8, { align: 'right' });
            doc.setFont('helvetica', 'normal');

            doc.setDrawColor(...RULE);
            doc.setLineWidth(0.2);
            doc.line(M, y + 7, RIGHT, y + 7);
            y += 7;
        });
    }

    addFooter(pageNum);
    doc.save(`Reporte_Global_Proveedores_${nowStr.split(' ')[0].replace(/\//g, '_')}.pdf`);
}
