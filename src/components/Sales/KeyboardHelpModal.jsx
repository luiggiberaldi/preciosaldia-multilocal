import React from 'react';
import { X, Keyboard } from 'lucide-react';

export default function KeyboardHelpModal({ isOpen, onClose }) {
    if (!isOpen) return null;

    const shortcuts = [
        { key: 'Enter', action: 'Buscar / Agregar a cesta / Volver a buscar', desc: 'Flujo principal continuo' },
        { key: 'F2', action: 'Enfocar buscador', desc: 'Alternativa rápida' },
        { key: 'F4', action: 'Vaciar cesta', desc: 'Pide confirmación' },
        { key: 'F9', action: 'Procesar cobro', desc: 'Abre modal de pago' },
        { key: '↑ / ↓', action: 'Navegar en cesta', desc: 'Mueve la selección verde' },
        { key: '+ / -', action: 'Ajustar cantidad', desc: 'Aumenta o disminuye item' },
        { key: 'Supr', action: 'Eliminar item', desc: 'Borra el item seleccionado' },
        { key: 'Esc', action: 'Cerrar modales', desc: 'O limpia la búsqueda' }
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95">
                
                {/* Header */}
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <div className="bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand p-1.5 rounded-lg">
                            <Keyboard size={20} />
                        </div>
                        Atajos de Teclado (PC)
                    </h3>
                    <button 
                        onClick={onClose}
                        className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 max-h-[70vh] overflow-y-auto">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 font-medium">
                        Usa estos atajos para agilizar tus ventas sin necesidad de usar el mouse. El flujo principal se maneja usando la tecla <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-sm font-sans font-bold text-slate-700 dark:text-slate-300">Enter</kbd>.
                    </p>

                    <div className="grid gap-2">
                        {shortcuts.map((s, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 transition-colors border border-slate-100 dark:border-slate-700/50">
                                <div className="flex flex-col">
                                    <span className="font-bold text-slate-700 dark:text-slate-200 text-sm">
                                        {s.action}
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                        {s.desc}
                                    </span>
                                </div>
                                <div className="shrink-0 flex gap-1">
                                    {s.key.split(' / ').map((k, idx) => (
                                        <kbd key={idx} className="min-w-[32px] text-center inline-block px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm text-xs font-bold text-slate-700 dark:text-slate-300">
                                            {k}
                                        </kbd>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-right">
                    <button 
                        onClick={onClose}
                        className="px-5 py-2 bg-brand-light hover:bg-brand-light dark:bg-brand/10 dark:hover:bg-brand/20 text-brand-dark dark:text-brand font-bold rounded-xl transition-colors"
                    >
                        Entendido
                    </button>
                </div>
            </div>
        </div>
    );
}
