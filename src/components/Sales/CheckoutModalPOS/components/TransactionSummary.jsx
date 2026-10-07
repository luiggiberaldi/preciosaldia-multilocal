import React, { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { round2 } from '../../../../utils/dinero';

/**
 * TransactionSummary — Resumen del total a pagar en la columna izquierda.
 */
const TransactionSummary = ({ totalUSD, totalBS, discountData, tasaSegura }) => {
    return (
        <div className="px-3 py-2 shrink-0 bg-white dark:bg-slate-950 z-20 border-b border-slate-100 dark:border-slate-800">
            <div className="text-center px-3 py-2 bg-slate-900 dark:bg-slate-800 text-white rounded-xl shadow-md relative overflow-hidden">
                <p className="text-white/50 text-[9px] font-bold uppercase tracking-widest leading-tight">Total a Pagar</p>

                <div className="flex items-baseline justify-center gap-2 mt-0.5">
                    <span className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                        ${totalUSD.toFixed(2)}
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-emerald-400">
                        Bs {round2(totalBS).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                    </span>
                </div>

                {discountData?.active && (
                    <div className="mt-1 pt-1 border-t border-white/10 flex justify-between items-center text-[9px]">
                        <span className="text-white/50 uppercase tracking-wide">Descuento</span>
                        <span className="text-emerald-400 font-black">
                            -{discountData.type === 'percentage' ? `${discountData.value}%` : `$${discountData.amountUsd?.toFixed(2)}`}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default memo(TransactionSummary);
