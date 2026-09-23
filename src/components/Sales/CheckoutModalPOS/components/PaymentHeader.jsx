import React from 'react';
import { Calculator, DollarSign, Wallet, X, LayoutGrid, Zap } from 'lucide-react';

/**
 * PaymentHeader — Header del modo POS.
 * Incluye tabs Contado/Crédito + botón de cambio rápido de modo (a Basic).
 */
export default function PaymentHeader({ modo, setModo, onClose, onSwitchToBasic, tasa, casheaActive = false }) {
    return (
        <div className="min-h-[48px] sm:h-14 px-3 sm:px-4 py-1 pt-[env(safe-area-inset-top)] bg-white dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center gap-2 shrink-0 shadow-sm">
            {/* Título */}
            <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-brand/10 dark:bg-brand/20 flex items-center justify-center">
                    <Calculator size={16} className="text-brand dark:text-brand" />
                </div>
                <div className="flex flex-col">
                    <h2 className="text-sm font-black text-slate-800 dark:text-white tracking-wide whitespace-nowrap">Procesar Pago</h2>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 leading-none">
                        {tasa > 0 ? `Tasa: ${tasa.toFixed(2)} Bs/$` : 'Tasa no configurada'}
                    </span>
                </div>
            </div>

            {/* Tabs Contado / Crédito */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-0.5">
                <button
                    type="button"
                    aria-pressed={modo === 'contado'}
                    onClick={() => setModo('contado')}
                    className={`px-2.5 sm:px-5 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1 sm:gap-1.5 ${
                        modo === 'contado'
                            ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <DollarSign size={13} /> Contado
                </button>
                <button
                    type="button"
                    aria-pressed={modo === 'credito'}
                    onClick={() => setModo('credito')}
                    disabled={casheaActive}
                    title={casheaActive ? "No disponible para compras financiadas con Cashea" : ""}
                    className={`px-2.5 sm:px-5 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1 sm:gap-1.5 ${
                        casheaActive
                            ? 'opacity-40 cursor-not-allowed text-slate-400 dark:text-slate-600'
                            : modo === 'credito'
                                ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm ring-1 ring-amber-200 dark:ring-amber-800/40'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Wallet size={13} /> Crédito
                </button>
            </div>

            {/* Acciones: cerrar */}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar cobro"
                    className="w-11 h-11 bg-slate-50 dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500 text-slate-400 rounded-xl transition-all flex items-center justify-center active:scale-90 shrink-0"
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    );
}
