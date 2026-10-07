import React from 'react';
import { KeyRound, AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * InitialPinsModal — Fase 1 (ALTO-2).
 * Muestra UNA sola vez los PINs iniciales de Dueño, Administrador y Cajero
 * para que el dueño los anote durante el primer arranque.
 */
export function InitialPinsModal({ pins = [], onDone }) {
    return (
        <div className="fixed inset-0 z-[400] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-12 h-12 rounded-2xl bg-teal-600/10 border border-teal-600/20 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
                        <KeyRound size={26} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                            PINs iniciales creados
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Anótalos ahora: no se volverán a mostrar
                        </p>
                    </div>
                </div>

                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-3.5 text-xs text-amber-800 dark:text-amber-300 mb-4 flex gap-2.5">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <p>
                        Guarda estos PINs iniciales en un lugar seguro antes de continuar.
                    </p>
                </div>

                <div className="space-y-3 mb-6">
                    {pins.map(p => (
                        <div
                            key={p.id}
                            className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3"
                        >
                            <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.nombre}</p>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{p.rol}</p>
                            </div>
                            <p className="text-2xl font-mono font-black tracking-[0.3em] text-teal-700 dark:text-teal-400 select-all">
                                {p.pin}
                            </p>
                        </div>
                    ))}
                </div>

                <button
                    onClick={onDone}
                    className="w-full py-3.5 px-4 active:scale-95 text-white rounded-2xl text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2 hover:brightness-110"
                    style={{ backgroundColor: '#01696f' }}
                >
                    <CheckCircle2 size={18} />
                    Ya los anoté
                </button>
            </div>
        </div>
    );
}

export default InitialPinsModal;
