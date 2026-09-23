// ============================================================
// FIA-REPORT-001 (H1, H2, H3, H9) — Cuentas por cobrar y cobranzas
// ------------------------------------------------------------
// Fuente de verdad única para "cuánto se fió", "cuánto se cobró" y
// "cuánto queda por cobrar" en reportes y Dashboard.
//
// Distinciones que este módulo hace explícitas (antes se confundían en un
// único número neto llamado "Por Cobrar"):
//   - Flujo del período : fiado otorgado − cobranzas (puede ser negativo).
//   - Cartera (stock)   : deuda pendiente acumulada de los clientes.
//
// Núcleo puro: sin React, sin storage, solo aritmética con utils/dinero.
// ============================================================

import { round2, sumR } from './dinero';
import { getLocalISODate } from './dateHelpers';

const RECEIVABLE_SALE_TYPES = new Set(['VENTA_FIADA', 'VENTA_CASHEA']);
const COLLECTION_TYPES = new Set(['COBRO_DEUDA', 'COBRO_CASHEA']);

const isVoided = (sale) => !sale || sale.status === 'ANULADA';

/** ¿Es un cobro de cartera y no una venta de mercancía? */
export function isCollectionSale(sale) {
    return Boolean(sale) && COLLECTION_TYPES.has(sale.tipo);
}

/**
 * Filtro de tipo para los historiales (H3): 'ventas' | 'cobranzas' | 'todo'.
 * El default ('ventas') excluye las cobranzas para que no se mezclen con las
 * transacciones de venta.
 */
export function filterHistoryByKind(sales = [], kind = 'ventas') {
    const list = Array.isArray(sales) ? sales : [];
    if (kind === 'todo') return list;
    if (kind === 'cobranzas') return list.filter(isCollectionSale);
    return list.filter(sale => !isCollectionSale(sale));
}

function inRange(sale, from, to) {
    if (!from && !to) return true;
    if (!sale.timestamp) return true;
    const day = getLocalISODate(new Date(sale.timestamp));
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
}

function safeRate(sale) {
    const rate = Number(sale?.rate);
    if (Number.isFinite(rate) && rate > 0) return rate;
    const totalUsd = Number(sale?.totalUsd) || 0;
    const totalBs = Number(sale?.totalBs) || 0;
    if (totalUsd > 0 && totalBs > 0) return totalBs / totalUsd;
    return 0;
}

/**
 * Movimientos de cuentas por cobrar del período.
 *
 * @param {Array} sales - ventas/cobros ya filtrados por rango (o usar `from`/`to`)
 * @param {{ from?: string|null, to?: string|null }} [opts]
 * @returns {{
 *   fiadoOtorgadoUsd: number, cobranzasUsd: number, netoUsd: number,
 *   saldoFavorGeneradoUsd: number, movimientoCount: number,
 *   fiados: Array, cobranzas: Array
 * }}
 */
export function computeReceivablesMovements(sales = [], { from = null, to = null } = {}) {
    const fiados = [];
    const cobranzas = [];
    let fiadoOtorgadoUsd = 0;
    let cobranzasUsd = 0;
    let saldoFavorGeneradoUsd = 0;

    (Array.isArray(sales) ? sales : []).forEach(sale => {
        if (isVoided(sale)) return;
        if (!inRange(sale, from, to)) return;

        if (RECEIVABLE_SALE_TYPES.has(sale.tipo)) {
            // El crédito otorgado es `fiadoUsd` (fiado) o `casheaUsd` (Cashea), nunca el
            // total del ticket: una venta a crédito puede llevar pagos parciales reales
            // (FIN-004) y en Cashea el local cobra una cuota inicial.
            const creditUsd = sale.tipo === 'VENTA_CASHEA'
                ? (sale.casheaUsd != null ? sale.casheaUsd : (sale.fiadoUsd != null ? sale.fiadoUsd : sale.totalUsd))
                : (sale.fiadoUsd != null ? sale.fiadoUsd : sale.totalUsd);
            const montoUsd = round2(creditUsd || 0);
            if (montoUsd <= 0) return;
            const rate = safeRate(sale);
            fiadoOtorgadoUsd = round2(fiadoOtorgadoUsd + montoUsd);
            fiados.push({
                saleId: sale.id || null,
                saleNumber: sale.saleNumber ?? null,
                timestamp: sale.timestamp || null,
                tipo: sale.tipo,
                clienteId: sale.customerId || sale.clienteId || null,
                cliente: sale.customerName || sale.clienteName || 'Consumidor Final',
                montoUsd,
                montoBs: rate > 0 ? round2(montoUsd * rate) : round2(sale.totalBs || 0),
            });
            return;
        }

        if (COLLECTION_TYPES.has(sale.tipo)) {
            const montoUsd = round2(sale.totalUsd || 0);
            if (montoUsd <= 0) return;
            const rate = safeRate(sale);
            const saldoFavor = round2(Math.max(0, Number(sale.saldoFavorGeneradoUsd) || 0));
            cobranzasUsd = round2(cobranzasUsd + montoUsd);
            saldoFavorGeneradoUsd = round2(saldoFavorGeneradoUsd + saldoFavor);
            const methodId = sale.payments?.[0]?.methodId || sale.paymentMethod || null;
            cobranzas.push({
                saleId: sale.id || null,
                saleNumber: sale.saleNumber ?? null,
                timestamp: sale.timestamp || null,
                tipo: sale.tipo,
                clienteId: sale.customerId || sale.clienteId || null,
                cliente: sale.customerName || sale.clienteName || 'Consumidor Final',
                montoUsd,
                montoBs: rate > 0 ? round2(montoUsd * rate) : round2(sale.totalBs || 0),
                methodId,
                // Sobrante de un abono mayor que la deuda: se convierte en saldo a favor.
                saldoFavorGeneradoUsd: saldoFavor,
            });
        }
    });

    return {
        fiadoOtorgadoUsd,
        cobranzasUsd,
        netoUsd: round2(fiadoOtorgadoUsd - cobranzasUsd),
        saldoFavorGeneradoUsd,
        movimientoCount: fiados.length + cobranzas.length,
        fiados,
        cobranzas,
    };
}

/**
 * Cartera: deuda pendiente ACUMULADA (stock), no flujo del período.
 * Es la contraparte que faltaba para no etiquetar un neto como "por cobrar".
 */
export function computeCarteraUsd(customers = []) {
    return round2(sumR((Array.isArray(customers) ? customers : []).map(c => round2(
        (Number(c?.deuda) || 0) + (Number(c?.casheaDeuda) || 0)
    ))));
}

/**
 * Modelo de vista compartido por Reportes y Dashboard.
 *
 * @param {ReturnType<typeof computeReceivablesMovements>} receivables
 * @param {{ carteraUsd?: number|null, labelPeriodo?: string }} [opts]
 */
export function buildReceivablesView(receivables, { carteraUsd = null } = {}) {
    const data = receivables || {
        fiadoOtorgadoUsd: 0,
        cobranzasUsd: 0,
        netoUsd: 0,
        saldoFavorGeneradoUsd: 0,
        fiados: [],
        cobranzas: [],
    };

    const rows = [
        {
            key: 'fiado_otorgado',
            label: 'Fiado otorgado',
            hint: 'Crédito entregado en el período',
            amountUsd: round2(data.fiadoOtorgadoUsd),
            count: data.fiados?.length || 0,
        },
        {
            key: 'cobranzas',
            label: 'Cobranzas',
            hint: 'Abonos recibidos en el período',
            amountUsd: round2(data.cobranzasUsd),
            count: data.cobranzas?.length || 0,
        },
        {
            key: 'neto',
            label: 'Neto del período',
            hint: 'Otorgado menos cobranzas',
            amountUsd: round2(data.netoUsd),
            count: null,
        },
    ];

    if (carteraUsd !== null && carteraUsd !== undefined && Number.isFinite(Number(carteraUsd))) {
        rows.push({
            key: 'cartera',
            label: 'Cartera al cierre',
            hint: 'Deuda pendiente acumulada (no es flujo del período)',
            amountUsd: round2(Number(carteraUsd)),
            count: null,
            isStock: true,
        });
    }

    return {
        rows,
        // H1: la sección se muestra si HUBO movimiento, aunque el neto sea 0 o negativo.
        hasMovement: round2(data.fiadoOtorgadoUsd) !== 0 || round2(data.cobranzasUsd) !== 0,
        saldoFavorGeneradoUsd: round2(data.saldoFavorGeneradoUsd),
        fiados: data.fiados || [],
        cobranzas: data.cobranzas || [],
    };
}
