import React from 'react';
import { TrendingDown } from 'lucide-react';
import { formatBs, formatCop } from '../../../utils/calculatorUtils';

/**
 * PaymentStatusSummary — Fase 1/5 (shell móvil de cobro).
 *
 * Barra de estado ÚNICA del checkout: Total → Pagado → Resta/Vuelto.
 * Es el único lugar de la UI con esos tres números a la vista (mata UX-4:
 * estado financiero dividido). Actualización viva vía aria-live.
 */
export default function PaymentStatusSummary({
    cartTotalUsd,
    cartTotalBs,
    totalPaidUsd,
    totalPaidBs,
    isPaid,
    remainingUsd,
    remainingBs,
    changeUsd,
    changeBs,
    discountData,
    copEnabled = false,
    copPrimary = false,
    tasaCop = 0,
}) {
    const paidSecondary = copEnabled && tasaCop > 0
        ? (copPrimary ? `Bs ${formatBs(totalPaidBs)}` : `${formatCop(totalPaidUsd * tasaCop)} COP`)
        : `Bs ${formatBs(totalPaidBs)}`;
    const remainderPrimary = isPaid ? changeUsd : remainingUsd;
    const remainderSecondary = isPaid ? changeBs : remainingBs;
    const remainderTone = isPaid ? 'emerald' : (remainingUsd > 0.009 ? 'orange' : 'emerald');
    const remainderLabel = isPaid ? 'Vuelto' : (remainingUsd > 0.009 ? 'Resta' : 'Cubierto');
    const toneClasses = {
        emerald: { label: 'text-emerald-700 dark:text-emerald-400', value: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50/70 dark:bg-emerald-950/20' },
        orange: { label: 'text-orange-700 dark:text-orange-400', value: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-50/70 dark:bg-orange-950/20' },
    };
    const statusTone = toneClasses[remainderTone];

    return (
        <div className={`shrink-0 border-b border-slate-100 dark:border-slate-800 px-4 py-2 flex items-center justify-between ${statusTone.bg}`}>
            <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Total</span>
                <span className="text-lg font-black text-slate-900 dark:text-white leading-none">${cartTotalUsd.toFixed(2)}</span>
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">· Bs {formatBs(cartTotalBs)}</span>
                {discountData?.active && (
                    <span className="text-[9px] font-black text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1 py-0.5 rounded">
                        -{discountData.type === 'percentage' ? `${discountData.value}%` : `$${discountData.amountUsd.toFixed(2)}`}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-baseline gap-1">
                    <TrendingDown size={12} className="self-center text-emerald-500" />
                    <div>
                        <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none">Pagado</span>
                        <span className="block text-xs font-black text-emerald-700 dark:text-emerald-400 leading-none">${totalPaidUsd.toFixed(2)}</span>
                        <span className="block text-[10px] font-bold text-slate-500 leading-none">{paidSecondary}</span>
                    </div>
                </div>
                <div className="flex items-baseline gap-1">
                    <div>
                        <span className={`block text-[10px] font-black uppercase tracking-wider leading-none ${statusTone.label}`}>{remainderLabel}</span>
                        <span className={`block text-xs font-black leading-none ${statusTone.value}`}>${remainderPrimary.toFixed(2)}</span>
                        <span className="block text-[10px] font-bold text-slate-500 leading-none">Bs {formatBs(remainderSecondary)}</span>
                    </div>
                </div>
                <div aria-live="polite" className="sr-only">
                    {`Total ${cartTotalUsd.toFixed(2)} dólares, pagado ${totalPaidUsd.toFixed(2)}, ${remainderLabel} ${remainderPrimary.toFixed(2)} dólares, equivalente a ${formatBs(remainderSecondary)} bolívares.`}
                </div>
            </div>
        </div>
    );
}
