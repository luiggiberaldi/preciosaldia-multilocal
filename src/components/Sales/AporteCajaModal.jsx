import React, { useState, useEffect } from 'react';
import { Wallet, X, Check } from 'lucide-react';

/**
 * Aporte de efectivo a la caja durante el turno (solo dueño/administrador; el
 * permiso se valida en `useCheckoutFlow.handleSaveAporte`).
 * También define el umbral de alerta de efectivo bajo.
 */
export default function AporteCajaModal({ isOpen, onClose, onConfirm, umbral, copEnabled }) {
    const [usd, setUsd] = useState('');
    const [bs, setBs] = useState('');
    const [cop, setCop] = useState('');
    const [motivo, setMotivo] = useState('');
    const [umbralUsd, setUmbralUsd] = useState('');
    const [umbralBs, setUmbralBs] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setUsd('');
            setBs('');
            setCop('');
            setMotivo('');
            setUmbralUsd(umbral?.usd > 0 ? String(umbral.usd) : '');
            setUmbralBs(umbral?.bs > 0 ? String(umbral.bs) : '');
        }
    }, [isOpen, umbral]);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            const ok = await onConfirm({
                aporteUsd: usd,
                aporteBs: bs,
                aporteCop: copEnabled ? cop : 0,
                motivo,
                umbral: {
                    usd: Math.max(0, parseFloat(umbralUsd) || 0),
                    bs: Math.max(0, parseFloat(umbralBs) || 0),
                },
            });
            if (ok) {
                setUsd('');
                setBs('');
                setCop('');
                setMotivo('');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const inputClass = 'w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all';

    return (
        <div
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 w-full sm:max-w-sm rounded-t-[2rem] sm:rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-6 duration-250"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                            <Wallet size={18} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-800 dark:text-white">Aporte de Efectivo</h2>
                            <p className="text-xs text-slate-400">Dinero que entra a la caja en el turno</p>
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
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Monto en Dólares ($)</label>
                        <input type="number" inputMode="decimal" placeholder="0.00" value={usd} onChange={e => setUsd(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Monto en Bolívares (Bs)</label>
                        <input type="number" inputMode="decimal" placeholder="0.00" value={bs} onChange={e => setBs(e.target.value)} className={inputClass} />
                    </div>
                    {copEnabled && (
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Monto en Pesos (COP)</label>
                            <input type="number" inputMode="decimal" placeholder="0" value={cop} onChange={e => setCop(e.target.value)} className={inputClass} />
                        </div>
                    )}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Motivo</label>
                        <input type="text" placeholder="Ej: cambio de billetes pequeños" maxLength={200} value={motivo} onChange={e => setMotivo(e.target.value)} className={inputClass} />
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-1.5">Alerta de efectivo bajo</p>
                        <p className="text-[10px] text-slate-500 mb-2">Avisar cuando el efectivo esperado baje de estos montos (0 = sin alerta).</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 block mb-1">Mínimo $</label>
                                <input type="number" inputMode="decimal" placeholder="0" value={umbralUsd} onChange={e => setUmbralUsd(e.target.value)} className={inputClass} />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 block mb-1">Mínimo Bs</label>
                                <input type="number" inputMode="decimal" placeholder="0" value={umbralBs} onChange={e => setUmbralBs(e.target.value)} className={inputClass} />
                            </div>
                        </div>
                    </div>

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
                            className="flex-[2] py-3 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-xl active:scale-95 transition-all shadow-md shadow-emerald-500/20 disabled:opacity-60"
                        >
                            <Check size={16} />
                            Registrar Aporte
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
