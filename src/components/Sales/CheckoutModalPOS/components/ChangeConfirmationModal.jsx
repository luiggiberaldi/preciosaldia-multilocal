import React from 'react';
import { AlertTriangle, Banknote, CheckCircle, HandCoins, Wallet, X } from 'lucide-react';

const money = value => `$${Number(value || 0).toFixed(2)}`;
const formatBs = value => `Bs ${Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;

export default function ChangeConfirmationModal({
    cambioUSD,
    tasaSegura,
    distVueltoUSD,
    distVueltoBS,
    plannedPhysicalUsd,
    plannedWalletUsd,
    plannedCashUsd,
    unallocatedChangeUsd,
    changeAllocationComplete,
    changeDestinationSelected,
    isChangeCredited,
    realisticSplit = null,
    onDeliverAllUsd,
    onCancel,
    onConfirm,
    isProcessing = false,
}) {
    const hasExplicitPhysical = distVueltoUSD !== '' || distVueltoBS !== '';
    // VUELTO-REALISTA: con fracción de dólar, ofrece el desglose realista
    // ($ enteros + resto en Bs) como corrección de un toque.
    const showRealisticFixup = typeof onDeliverAllUsd === 'function'
        && realisticSplit && (Number(distVueltoUSD) || 0) + (Number(distVueltoBS) || 0) / Math.max(1, Number(tasaSegura) || 1) < Number(cambioUSD || 0) - 0.005;
    const physicalLabel = !changeDestinationSelected
        ? 'Sin definir'
        : hasExplicitPhysical
            ? [
                Number(distVueltoUSD) > 0 ? money(distVueltoUSD) : null,
                Number(distVueltoBS) > 0 ? formatBs(distVueltoBS) : null,
            ].filter(Boolean).join(' + ') || money(0)
            : money(plannedPhysicalUsd);

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4"
            role="presentation"
            onClick={onCancel}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="change-confirmation-title"
                className="w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700"
                onClick={event => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Último paso</p>
                        <h2 id="change-confirmation-title" className="mt-1 text-lg font-black text-slate-800 dark:text-white">
                            Confirmar distribución del cambio
                        </h2>
                        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                            Revisa dónde quedará cada parte antes de registrar la venta.
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="Cerrar confirmación"
                        onClick={onCancel}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="mx-4 sm:mx-5 mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 px-4 py-3 text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Vuelto total</p>
                    <p className="mt-1 text-3xl font-black text-emerald-700 dark:text-emerald-300">{money(cambioUSD)}</p>
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatBs(Number(cambioUSD || 0) * Number(tasaSegura || 0))}</p>
                </div>

                <div className="mx-4 sm:mx-5 mt-4 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                        <span className="inline-flex items-center gap-2 font-bold text-slate-600 dark:text-slate-300"><Banknote size={16} /> Cambio físico</span>
                        <span className="text-right font-black text-slate-800 dark:text-white">
                            {physicalLabel}
                            {hasExplicitPhysical && <span className="block text-[10px] font-medium text-slate-400">= {money(plannedPhysicalUsd)}</span>}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                        <span className="inline-flex items-center gap-2 font-bold text-slate-600 dark:text-slate-300"><Wallet size={16} /> {isChangeCredited ? 'Saldo a favor acreditado' : 'Saldo a favor'}</span>
                        <strong className="text-slate-800 dark:text-white">{money(plannedWalletUsd)}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                        <span className="inline-flex items-center gap-2 font-bold text-slate-600 dark:text-slate-300"><HandCoins size={16} /> Queda en caja</span>
                        <strong className="text-slate-800 dark:text-white">{money(plannedCashUsd)}</strong>
                    </div>
                </div>

                {!changeAllocationComplete && (
                    <div className="mx-4 sm:mx-5 mt-3 flex flex-col gap-2">
                        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <span>{!changeDestinationSelected ? 'Selecciona si el cambio se entrega en $ o en Bs.' : `Falta asignar ${money(unallocatedChangeUsd)} del vuelto.`}</span>
                        </div>
                        {showRealisticFixup && realisticSplit && (
                            <button
                                type="button"
                                onClick={onDeliverAllUsd}
                                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700 active:scale-[0.99] transition-all"
                            >
                                <HandCoins size={15} />
                                {`Entregar realista: ${money(realisticSplit.usdPart)} + ${formatBs(realisticSplit.bsPart)}`}
                            </button>
                        )}
                    </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-2 px-4 sm:px-5 py-4 sm:py-5">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="min-h-[48px] flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-4 text-sm font-black text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                        Revisar
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isProcessing || !changeAllocationComplete}
                        className="min-h-[48px] flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
                    >
                        {isProcessing ? 'PROCESANDO...' : <><CheckCircle size={18} /> Confirmar venta</>}
                    </button>
                </div>
            </div>
        </div>
    );
}
