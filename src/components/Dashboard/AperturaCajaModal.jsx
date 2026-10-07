import React, { useState } from 'react';
import { Lock, DollarSign, X, Check } from 'lucide-react';

export default function AperturaCajaModal({ isOpen, onClose, onConfirm, copEnabled, copPrimary }) {
    const [usd, setUsd] = useState('');
    const [bs, setBs] = useState('');
    const [cop, setCop] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        const openingUsd = parseFloat(usd) || 0;
        const openingBs = parseFloat(bs) || 0;
        const openingCop = parseFloat(cop) || 0;

        setIsSubmitting(true);
        try {
            await onConfirm({
                openingUsd,
                openingBs,
                ...(copEnabled && openingCop > 0 ? { openingCop } : {}),
            });
            setUsd('');
            setBs('');
            setCop('');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 w-full sm:max-w-sm rounded-t-[2rem] sm:rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-6 duration-250"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                            <Lock size={18} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-800 dark:text-white">Apertura de Caja</h2>
                            <p className="text-xs text-slate-400">Fondo inicial del día</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4">
                    {/* COP Opening - FIRST when copPrimary */}
                    {copEnabled && copPrimary && (
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Efectivo en Pesos (COP)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 font-bold text-[10px]">COP</span>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    value={cop}
                                    onChange={e => setCop(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl pl-12 pr-4 py-3 text-sm font-bold text-amber-600 dark:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
                                    autoFocus
                                />
                            </div>
                        </div>
                    )}

                    {/* USD Opening */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Efectivo en Dólares ($)</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 font-bold text-sm">$</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={usd}
                                onChange={e => setUsd(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-4 py-3 text-sm font-bold text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                                autoFocus={!copPrimary}
                            />
                        </div>
                    </div>

                    {/* Bs Opening */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Efectivo en Bolívares (Bs)</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand font-bold text-xs">Bs</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={bs}
                                onChange={e => setBs(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-3 text-sm font-bold text-brand-dark dark:text-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                            />
                        </div>
                    </div>

                    {/* COP Opening - at the end when NOT copPrimary */}
                    {copEnabled && !copPrimary && (
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Efectivo en Pesos (COP)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 font-bold text-[10px]">COP</span>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    value={cop}
                                    onChange={e => setCop(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl pl-12 pr-4 py-3 text-sm font-bold text-amber-600 dark:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
                                />
                            </div>
                        </div>
                    )}

                    {/* Info note */}
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-xl">
                        <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                            Este monto <strong>se sumará a la caja física</strong> al final del día. El Cierre de Caja lo descontará automáticamente para mostrar las ganancias reales del día.
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-1">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isSubmitting}
                            className="flex-2 flex-[2] py-3 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-xl active:scale-95 transition-all shadow-md shadow-emerald-500/20 disabled:opacity-60"
                        >
                            <Check size={16} />
                            Aperturar Caja
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
