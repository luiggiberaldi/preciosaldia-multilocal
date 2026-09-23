import { useMemo } from 'react';
import { round2, divR, mulR, subR, sumR } from '../../../../utils/dinero';
import { FINANCIAL_EPSILON } from '../../../../utils/securityConstants';
import { CurrencyService } from '../../../../services/CurrencyService';

/**
 * usePaymentCalculations — Portado de Listo POS ModalPago.
 * Usa directamente las utilidades de bodega (dinero.js, CurrencyService)
 * en lugar del FinancialController de Listo POS.
 * Añade soporte COP cuando copEnabled=true.
 */
export const usePaymentCalculations = ({
    totalUSD,
    totalBS,
    pagos,
    tasa,
    metodosActivos,
    val,
    pagoSaldoFavor,
    casheaActive = false,
    casheaPercent = 60,
    copEnabled = false,
    tasaCop = 0,
}) => {
    const tasaSegura = tasa > 0 ? tasa : 1;
    const safeTasaCop = tasaCop > 0 ? tasaCop : 0;

    // Monto financiado por Cashea
    const casheaAmountUsd = useMemo(() => {
        if (!casheaActive) return 0;
        return round2(mulR(totalUSD, (100 - casheaPercent) / 100));
    }, [casheaActive, totalUSD, casheaPercent]);

    // Total pagado en USD (convirtiendo BS y COP)
    const totalPagadoUSD = useMemo(() => {
        return sumR(metodosActivos.map(m => {
            const v = val(m.id);
            if (m.tipo === 'DIVISA') return round2(v);
            if (m.tipo === 'COP' && safeTasaCop > 0) return divR(v, safeTasaCop);
            return tasaSegura > 0 ? divR(v, tasaSegura) : 0;
        }));
    }, [pagos, metodosActivos, tasaSegura, safeTasaCop]);

    // Total pagado en BS (para visualización)
    const totalPagadoBS = useMemo(() => {
        return sumR(metodosActivos.map(m => {
            const v = val(m.id);
            if (m.tipo === 'BS') return round2(v);
            if (m.tipo === 'COP' && safeTasaCop > 0 && tasaSegura > 0)
                return mulR(divR(v, safeTasaCop), tasaSegura);
            return tasaSegura > 0 ? mulR(v, tasaSegura) : 0;
        }));
    }, [pagos, metodosActivos, tasaSegura, safeTasaCop]);

    // Saldo a favor
    const pagoSaldoFavorNum = useMemo(() => {
        const v = parseFloat(pagoSaldoFavor);
        return isNaN(v) || v < 0 ? 0 : v;
    }, [pagoSaldoFavor]);

    // Total global con Cashea + saldo a favor
    const totalPagadoGlobalUSD = useMemo(() => {
        return round2(totalPagadoUSD + casheaAmountUsd + pagoSaldoFavorNum);
    }, [totalPagadoUSD, casheaAmountUsd, pagoSaldoFavorNum]);

    const faltaPorPagar = Math.max(0, subR(totalUSD, totalPagadoGlobalUSD));
    const faltaPorPagarBS = Math.max(0, subR(totalBS, totalPagadoBS + mulR(casheaAmountUsd, tasaSegura) + mulR(pagoSaldoFavorNum, tasaSegura)));
    const cambioUSD = Math.max(0, subR(totalPagadoGlobalUSD, totalUSD));

    // IGTF — simplificado (la bodega no usa FinancialController de Listo POS)
    const montoIGTF = 0; // La bodega calcula IGTF en useCheckoutCalculations; en POS mode no se recalcula aquí
    const totalConIGTF = totalUSD;
    const totalConIGTFBS = totalBS;

    return {
        totalPagadoUSD,
        totalPagadoBS,
        totalPagadoGlobalUSD,
        faltaPorPagar,
        faltaPorPagarBS,
        cambioUSD,
        montoIGTF,
        totalConIGTF,
        totalConIGTFBS,
        tasaSegura,
        casheaAmountUsd,
    };
};
