import React from 'react';
import { DollarSign } from 'lucide-react';

export default function CajaCerradaOverlay({ cartCount, onOpenApertura }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-y-auto min-h-0">
            <div className="w-24 h-24 sm:w-32 sm:h-32 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-6 shadow-sm border-4 border-white dark:border-slate-900">
                <DollarSign size={48} className="text-emerald-500" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 mb-3 tracking-tight">Caja Cerrada</h2>
            <p className="text-slate-500 dark:text-slate-400 max-w-sm mb-6 sm:mb-10 text-sm sm:text-base leading-relaxed">
                Para comenzar a registrar ventas o escanear productos, primero debes aperturar la caja indicando el fondo inicial del turno.
            </p>
            <button
                onClick={onOpenApertura}
                className="bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white px-8 md:px-12 py-4 md:py-5 rounded-2xl md:rounded-3xl font-bold shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-3 text-base md:text-lg"
            >
                <DollarSign size={24} />
                <span>Aperturar Caja Ahora</span>
            </button>
            {cartCount > 0 && (
                <p className="mt-8 text-xs font-semibold text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-500/10 px-4 py-2 rounded-xl">
                    Nota: Tienes {cartCount} productos en espera en el carrito.
                </p>
            )}
        </div>
    );
}
