// ============================================================
// INYECTOR DETERMINISTA v4.0 — Audit Mode (FIA-REPORT-001)
// ------------------------------------------------------------
// La generación vive en `deterministicDataset.js` (pura, sin window ni storage)
// para que la app y los tests produzcan EXACTAMENTE el mismo dataset.
// Este módulo solo se encarga de la UI y de la persistencia.
//
// Novedades v4.0:
//   - Bloque de cartera: abonos (COBRO_DEUDA), un abono con excedente a favor,
//     dos ventas Cashea con su remesa parcial y dos anulaciones (venta fiada y
//     abono) que NO deben aparecer en ningún agregado.
//   - Ledger de clientes (`bodega_customer_ledger_v1`) consistente con el
//     snapshot de cada cliente ⇒ la conciliación del reporte cuadra.
// ============================================================

import { storageService } from '../utils/storageService';
import { CUSTOMER_LEDGER_KEY } from '../utils/customerLedger';
import { FinancialEngine } from '../core/FinancialEngine';
import { round2 } from '../utils/dinero';
import {
    DETERMINISTIC_EXCEDENTE_USD,
    DETERMINISTIC_RATE,
    DETERMINISTIC_SALES_COUNT,
    DETERMINISTIC_SEED,
    buildDeterministicDataset,
} from './deterministicDataset';

const CONFIRM_TEXT =
    `Inyectar ${DETERMINISTIC_SALES_COUNT} ventas DETERMINISTAS + cartera?\n\n` +
    `- Semilla: ${DETERMINISTIC_SEED} (mismos datos siempre)\n` +
    `- Tasa fija: ${DETERMINISTIC_RATE.toFixed(2)} Bs/$\n` +
    `- 10 productos de prueba (con costo)\n` +
    `- 3 clientes fijos con abonos, excedente de $${DETERMINISTIC_EXCEDENTE_USD.toFixed(2)},\n` +
    `  ventas Cashea con remesa parcial y 2 movimientos anulados\n` +
    `- Ledger de clientes consistente (para probar la conciliación)\n` +
    `- Limpia datos det_* anteriores\n\n` +
    `Los datos reales NO se tocan.`;

/**
 * Genera e inyecta el dataset determinista.
 *
 * @param {{ interactive?: boolean }} [opts] - `false` salta confirm/alert/reload
 *        (lo usan los tests). Por defecto es interactivo.
 */
export async function injectDeterministicSales({ interactive = true } = {}) {
    const hasWindow = typeof window !== 'undefined';
    if (interactive && hasWindow && !window.confirm(CONFIRM_TEXT)) return { cancelled: true };

    const dataset = buildDeterministicDataset();
    const { sales: testSales, products, customers, ledger } = dataset;

    try {
        // ── Persistencia idempotente: limpia lo det_* previo y escribe lo nuevo ──
        const existingSales = await storageService.getItem('bodega_sales_v1', []);
        const cleanSales = existingSales.filter(s => !String(s.id).startsWith('det_'));

        const existingProducts = await storageService.getItem('bodega_products_v1', []);
        const cleanProducts = existingProducts.filter(p => !String(p.id).startsWith('det-'));

        const existingCustomers = await storageService.getItem('bodega_customers_v1', []);
        const cleanCustomers = existingCustomers.filter(c => !String(c.id).startsWith('det-'));

        const existingLedger = await storageService.getItem(CUSTOMER_LEDGER_KEY, []);
        const cleanLedger = existingLedger.filter(m => !String(m.id).startsWith('det_'));

        await storageService.setItem('bodega_sales_v1', [...cleanSales, ...testSales]);
        await storageService.setItem('bodega_products_v1', [...cleanProducts, ...products]);
        await storageService.setItem('bodega_customers_v1', [...cleanCustomers, ...customers]);
        await storageService.setItem(CUSTOMER_LEDGER_KEY, [...cleanLedger, ...ledger]);

        // ── Resumen de verificacion ──
        const netSales = testSales.filter(s => s.status !== 'ANULADA' && (s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA'));
        const voidedCount = testSales.filter(s => s.status === 'ANULADA').length;
        const fiadoSales = netSales.filter(s => s.tipo === 'VENTA_FIADA');
        const casheaSales = netSales.filter(s => s.tipo === 'VENTA_CASHEA');
        const abonos = testSales.filter(s => s.tipo === 'COBRO_DEUDA' && s.status !== 'ANULADA');
        const remesas = testSales.filter(s => s.tipo === 'COBRO_CASHEA' && s.status !== 'ANULADA');

        const netTotalUsd = round2(netSales.reduce((s, v) => s + (v.totalUsd || 0), 0));
        const netTotalBs = round2(netSales.reduce((s, v) => s + (v.totalBs || 0), 0));
        const netItems = netSales.reduce((s, v) => s + (v.items || []).reduce((is, it) => is + it.qty, 0), 0);
        const fiadoTotalUsd = round2(fiadoSales.reduce((s, v) => s + (v.fiadoUsd != null ? v.fiadoUsd : (v.totalUsd || 0)), 0));
        const abonosTotalUsd = round2(abonos.reduce((s, v) => s + (v.totalUsd || 0), 0));
        const remesasTotalUsd = round2(remesas.reduce((s, v) => s + (v.totalUsd || 0), 0));
        const saldoFavorUsd = round2(abonos.reduce((s, v) => s + (v.saldoFavorGeneradoUsd || 0), 0));
        const carteraUsd = round2(customers.reduce((s, c) => s + (c.deuda || 0) + (c.casheaDeuda || 0), 0));
        const netoFiadoUsd = round2(fiadoTotalUsd - abonosTotalUsd);
        const discountTotalUsd = round2(netSales.reduce((s, v) => s + (v.discountAmountUsd || 0), 0));

        let profitBs = 0;
        try {
            profitBs = FinancialEngine.calculateAggregateProfit(netSales, DETERMINISTIC_RATE, products);
        } catch { /* falla silenciosa: el resumen no debe romper la inyección */ }
        const profitUsd = DETERMINISTIC_RATE > 0 ? round2(profitBs / DETERMINISTIC_RATE) : 0;

        let breakdownText = '';
        try {
            const bd = FinancialEngine.calculatePaymentBreakdown(testSales);
            Object.entries(bd).forEach(([, data]) => {
                const label = data.label || 'Otro';
                if (data.currency === 'USD' || data.currency === 'FIADO' || data.currency === 'INTERNAL_CREDIT') {
                    breakdownText += `  ${label}: $${data.total.toFixed(2)}\n`;
                } else {
                    breakdownText += `  ${label}: Bs ${data.total.toLocaleString('es-VE', { minimumFractionDigits: 2 })}\n`;
                }
            });
        } catch { breakdownText = '  (error calculando desglose)\n'; }

        const fmtBs = (v) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const report = {
            netSales, voidedCount, fiadoSales, casheaSales, abonos, remesas,
            netTotalUsd, netTotalBs, netItems, fiadoTotalUsd, abonosTotalUsd,
            remesasTotalUsd, saldoFavorUsd, carteraUsd, netoFiadoUsd,
            discountTotalUsd, profitBs, profitUsd, ledgerMovements: ledger.length,
            breakdownText,
        };

        if (interactive && hasWindow) {
            window.alert(
                `TESTER DETERMINISTA v4.0 completado.\n` +
                `Semilla: ${DETERMINISTIC_SEED} | Tasa: ${DETERMINISTIC_RATE} Bs/$\n` +
                `(Mismos datos en cada ejecucion)\n` +
                `\n── RESUMEN ──\n` +
                `Ventas normales: ${netSales.filter(s => s.tipo === 'VENTA').length}\n` +
                `Ventas fiadas: ${fiadoSales.length}\n` +
                `Ventas Cashea: ${casheaSales.length}\n` +
                `Anuladas: ${voidedCount}\n` +
                `Articulos vendidos: ${netItems}\n` +
                `Descuentos: $${discountTotalUsd.toFixed(2)}\n` +
                `Ingresos brutos: $${netTotalUsd.toFixed(2)} / Bs ${fmtBs(netTotalBs)}\n` +
                `Ganancia estimada: $${profitUsd.toFixed(2)} / Bs ${fmtBs(profitBs)}\n` +
                `\n── CARTERA ──\n` +
                `Fiado otorgado: $${fiadoTotalUsd.toFixed(2)}\n` +
                `Cobranzas: ${abonos.length} abonos por $${abonosTotalUsd.toFixed(2)}\n` +
                `Remesas Cashea: ${remesas.length} por $${remesasTotalUsd.toFixed(2)}\n` +
                `Neto fiado del periodo: $${netoFiadoUsd.toFixed(2)}\n` +
                `Saldo a favor generado: $${saldoFavorUsd.toFixed(2)}\n` +
                `Cartera (deuda + Cashea): $${carteraUsd.toFixed(2)}\n` +
                `Movimientos del ledger: ${ledger.length}\n` +
                `\n── PAGOS ──\n` +
                breakdownText +
                `\n── INVENTARIO INYECTADO ──\n` +
                `10 productos det-01 a det-10 (con costo conocido)`
            );
            setTimeout(() => window.location.reload(), 100);
        }

        return { ...report, dataset };
    } catch (e) {
        console.error(e);
        if (interactive && hasWindow) {
            window.alert('Error en inyeccion determinista: ' + e.message);
        }
        throw e;
    }
}
