import React, { useState } from 'react';
import { DollarSign, Wallet, X, CheckCircle2 } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { round2, subR } from '../../utils/dinero';

/**
 * CashReconciliationModal — Cuadre de caja física.
 *
 * FIN-029: Ahora soporta COP además de USD/Bs. La UI del campo COP solo aparece
 *   cuando se pasa `expectedCop` > 0 o `copEnabled` true.
 */
export default function CashReconciliationModal({
    isOpen,
    onClose,
    onConfirm,
    expectedUsd = 0,
    expectedBs = 0,
    expectedCop = 0,
    bcvRate = 1,
    copEnabled = false,
    tasaCop = 0
}) {
    const [actualUsd, setActualUsd] = useState('');
    const [actualBs, setActualBs] = useState('');
    const [actualCop, setActualCop] = useState('');

    if (!isOpen) return null;

    const showCop = copEnabled || expectedCop > 0;

    const handleConfirm = () => {
        const declaredUsd = round2(parseFloat(actualUsd) || 0);
        const declaredBs = round2(parseFloat(actualBs) || 0);
        const declaredCop = round2(parseFloat(actualCop) || 0);

        // FIN-029: incluir diffCop en el payload del onConfirm.
        onConfirm({
            declaredUsd,
            declaredBs,
            declaredCop,
            diffUsd: subR(declaredUsd, expectedUsd),
            diffBs: subR(declaredBs, expectedBs),
            diffCop: subR(declaredCop, expectedCop)
        });

        setActualUsd('');
        setActualBs('');
        setActualCop('');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-[1.5rem] p-6 max-w-sm w-full shadow-2xl border border-slate-100 dark:bg-slate-800 animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}>

                {/* Close Button */}
                <button onClick={onClose} className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:bg-slate-800 transition-colors">
                    <X size={16} />
                </button>

                {/* Header */}
                <div className="w-14 h-14 bg-brand-light dark:bg-surface-800/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Wallet size={28} className="text-brand" />
                </div>
                <h3 className="text-xl font-black text-slate-800 dark:text-white text-center mb-1">Cuadre de Caja</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-6 leading-relaxed">
                    Ingresa cuánto efectivo físico tienes en la gaveta en este momento.
                </p>

                {/* Expected Summary (Optional visibility, can be hidden if blind close is preferred) */}
                <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl mb-4 border border-slate-100 dark:bg-slate-700/50">
                    <span className="text-xs font-bold text-slate-500 uppercase">Sistema espera:</span>
                    <div className="text-right">
                        <div className="text-sm font-black text-slate-800 dark:text-white">${round2(expectedUsd)}</div>
                        <div className="text-xs font-bold text-slate-400">{formatBs(expectedBs)} Bs</div>
                        {showCop && (
                            <div className="text-xs font-bold text-slate-400">{formatCop(expectedCop)} COP</div>
                        )}
                    </div>
                </div>

                {/* Inputs */}
                <div className="space-y-4 mb-6">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1 block">Efectivo Físico (USD)</label>
                        <div className="relative flex items-center">
                            <DollarSign size={16} className="absolute left-3.5 text-slate-400" />
                            <input
                                type="number"
                                step="any"
                                value={actualUsd}
                                onChange={e => setActualUsd(e.target.value)}
                                placeholder="0.00"
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:bg-slate-800 rounded-xl py-3 pl-10 pr-4 text-slate-800 dark:text-white font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all font-mono"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1 block">Efectivo Físico (Bs)</label>
                        <div className="relative flex items-center">
                            <span className="absolute left-3.5 font-bold text-slate-400">Bs</span>
                            <input
                                type="number"
                                step="any"
                                value={actualBs}
                                onChange={e => setActualBs(e.target.value)}
                                placeholder="0.00"
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:bg-slate-800 rounded-xl py-3 pl-10 pr-4 text-slate-800 dark:text-white font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all font-mono"
                            />
                        </div>
                    </div>
                    {/* FIN-029: Campo COP solo si COP está habilitado o hay expectativa COP. */}
                    {showCop && (
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1 block">Efectivo Físico (COP)</label>
                            <div className="relative flex items-center">
                                <span className="absolute left-3.5 font-bold text-slate-400">COP</span>
                                <input
                                    type="number"
                                    step="any"
                                    value={actualCop}
                                    onChange={e => setActualCop(e.target.value)}
                                    placeholder="0"
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:bg-slate-800 rounded-xl py-3 pl-10 pr-4 text-slate-800 dark:text-white font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all font-mono"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 w-full">
                    <button onClick={onClose}
                        className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:bg-slate-800 rounded-xl transition-colors">
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="flex-1 py-3.5 text-sm font-bold text-white bg-brand hover:bg-brand-dark rounded-xl shadow-lg shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                        <CheckCircle2 size={18} /> Continuar
                    </button>
                </div>
            </div>
        </div>
    );
}
