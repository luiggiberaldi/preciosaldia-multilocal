// ============================================================
// FIA-REPORT-001 (H4) — Modelo de vista de Medios de Pago
// ------------------------------------------------------------
// Núcleo puro compartido por ReportsMetricsTab y DashboardPaymentBreakdown.
// Antes cada pantalla recalculaba su propio `toBsEquiv` / denominador de
// porcentajes (lógica duplicada que ya había divergido).
//
// Reglas de negocio que centraliza:
//   1. Los `%` se calculan SOLO sobre medios de pago reales (BS/USD/COP netos
//      de vuelto). Las cuentas por cobrar (fiado/cashea), el crédito interno,
//      la propina y el vuelto NO diluyen el denominador.
//   2. Una cuenta por cobrar con movimiento SIEMPRE tiene fila, incluso con
//      neto negativo o cero (H1: antes se filtraba por `total > 0` y la
//      sección desaparecía cuando las cobranzas superaban al fiado).
//   3. El peso en Bs de una cuenta por cobrar usa la tasa de SU venta
//      (`bsAtSaleRate`, H8) y cae a la tasa vigente solo en registros legacy.
// ============================================================

import { divR, mulR, round2, sumR } from './dinero';

/**
 * ¿El bucket representa una cuenta por cobrar (crédito otorgado) y NO dinero
 * recibido? El motor marca Cashea con `isReceivable` y Fiado con
 * `currency: 'FIADO'`.
 */
export function isReceivableBucket(data = {}) {
    return data.isReceivable === true
        || data.currency === 'FIADO'
        || data.currency === 'FIADO_BS';
}

/** ¿Es crédito interno (saldo a favor) en cualquiera de sus dos patas? */
export function isInternalCreditBucket(data = {}) {
    return data.isInternalCredit === true || data.currency === 'INTERNAL_CREDIT';
}

/**
 * Convierte un bucket a su equivalente en Bs para poder sumar y comparar.
 * El crédito interno vale 0 (no es dinero que entró ni salió).
 */
export function toBsEquivalent(data, { bcvRate = 1, tasaCop = 0 } = {}) {
    if (!data) return 0;
    if (isInternalCreditBucket(data)) return 0;
    const total = Number(data.total) || 0;
    if (isReceivableBucket(data)) {
        // H8: la tasa de la venta manda. `bsAtSaleRate` es aditivo en el motor.
        const atSaleRate = Number(data.bsAtSaleRate);
        if (Number.isFinite(atSaleRate)) return round2(atSaleRate);
        const safeRate = bcvRate > 0 ? bcvRate : 1;
        return round2(mulR(total, safeRate));
    }
    if (data.currency === 'USD') {
        const safeRate = bcvRate > 0 ? bcvRate : 1;
        return round2(mulR(total, safeRate));
    }
    if (data.currency === 'COP') {
        if (!(tasaCop > 0) || !(bcvRate > 0)) return 0;
        return round2(mulR(divR(total, tasaCop), bcvRate));
    }
    return round2(total);
}

/**
 * Construye las filas normalizadas del desglose de pago con su porcentaje.
 *
 * @param {Object} paymentBreakdown - salida de FinancialEngine.calculatePaymentBreakdown
 * @param {{ bcvRate?: number, tasaCop?: number }} [opts]
 * @returns {{ rows: Array, denominatorBs: number, totals: Object }}
 */
export function buildPaymentBreakdownRows(paymentBreakdown, { bcvRate = 1, tasaCop = 0 } = {}) {
    const rows = Object.entries(paymentBreakdown || {}).map(([key, data]) => {
        const amount = round2(Number(data?.total) || 0);
        const receivable = isReceivableBucket(data);
        const internalCredit = isInternalCreditBucket(data);
        const isChange = data?.isChange === true;
        const isTip = data?.isTip === true;
        const isCommission = data?.isCommission === true;
        // El denominador son SOLO medios de pago reales.
        const inDenominator = !receivable && !internalCredit && !isChange && !isTip && !isCommission;
        return {
            key,
            label: data?.label || key,
            currency: data?.currency || 'BS',
            amount,
            amountBs: toBsEquivalent(data, { bcvRate, tasaCop }),
            bsAtSaleRate: Number.isFinite(Number(data?.bsAtSaleRate)) ? round2(Number(data.bsAtSaleRate)) : null,
            origins: data?.origins || null,
            isReceivable: receivable,
            isInternalCredit: internalCredit,
            isWalletCredit: data?.isWalletCredit === true,
            isChange,
            isTip,
            isCommission,
            inDenominator,
            // H1: el movimiento se decide por el importe, no por su signo.
            hasMovement: amount !== 0,
        };
    });

    const denominatorBs = round2(sumR(rows.filter(r => r.inDenominator).map(r => r.amountBs)));

    const withPct = rows.map(row => ({
        ...row,
        pct: (row.inDenominator && denominatorBs !== 0)
            ? round2(divR(mulR(row.amountBs, 100), denominatorBs))
            : null,
    }));

    const receivables = withPct.filter(r => r.isReceivable);
    const internalCredit = withPct.filter(r => r.isInternalCredit);
    const methods = withPct.filter(r => r.inDenominator);

    return {
        rows: withPct,
        denominatorBs,
        totals: {
            receivablesUsd: round2(sumR(receivables.map(r => r.amount))),
            receivablesBs: round2(sumR(receivables.map(r => r.amountBs))),
            internalCreditAppliedUsd: round2(sumR(internalCredit.filter(r => !r.isWalletCredit).map(r => r.amount))),
            internalCreditGeneratedUsd: round2(sumR(internalCredit.filter(r => r.isWalletCredit).map(r => r.amount))),
            methodsBs: denominatorBs,
            methodsUsd: round2(sumR(methods.filter(r => r.currency === 'USD').map(r => r.amount))),
            methodsBsNative: round2(sumR(methods.filter(r => r.currency === 'BS').map(r => r.amount))),
            methodsCop: round2(sumR(methods.filter(r => r.currency === 'COP').map(r => r.amount))),
        },
        receivables,
        internalCredit,
        methods,
    };
}
