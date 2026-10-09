import React from 'react';
import { Check, Store } from 'lucide-react';

/**
 * BusinessSetupOverlay.jsx — Configuración del primer negocio (flujo de primer arranque).
 *
 * Orden del flujo (multi-local): Términos → PIN maestro del dueño →
 * PINs iniciales → app. Los nombres de sede se conservan desde el registro
 * existente y se administran después desde el selector de negocios.
 */
export default function BusinessSetupOverlay({ onDone }) {
    const handleFinish = () => {
        localStorage.setItem('pda_business_config_done', 'true');
        if (onDone) onDone();
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="w-full max-w-2xl bg-surface-100 border border-surface-200 dark:border-surface-700 rounded-[2rem] shadow-tone-lg overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-500">

                {/* Header */}
                <div className="px-6 py-5 border-b border-surface-200 dark:border-surface-700 bg-surface-200 flex items-center gap-3 shrink-0">
                    <div className="p-2.5 bg-brand rounded-xl shadow-primary-tone">
                        <Store size={24} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div>
                        <h2 className="font-display text-2xl text-surface-700 tracking-tight leading-tight">Configuración del Negocio</h2>
                        <p className="text-xs text-surface-500 font-medium">Tu primer negocio en PreciosAlDía</p>
                    </div>
                </div>

                {/* Cuerpo */}
                <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
                    <div className="text-center max-w-md mx-auto mb-2">
                        <h3 className="font-display text-3xl text-surface-700 tracking-tight mb-2">¡Listo para comenzar!</h3>
                        <p className="text-xs text-surface-500 font-medium leading-relaxed">
                            Tus sedes existentes se mantienen como están. El dueño puede administrar sus nombres, usuarios y permisos desde la aplicación.
                        </p>
                    </div>

                    <div className="max-w-md mx-auto rounded-2xl border border-surface-200 dark:border-surface-700 bg-white/70 dark:bg-slate-900/40 px-5 py-4">
                        <p className="text-sm text-surface-600 dark:text-surface-300 text-center leading-relaxed">
                            No necesitas volver a escribir el nombre de tu sede ni registrar un correo para empezar.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-surface-200 dark:border-surface-700 bg-surface-200 shrink-0">
                    <button
                        onClick={handleFinish}
                        className="btn btn-primary w-full shadow-tone-md"
                    >
                        <Check size={20} strokeWidth={2.5} />
                        <span>Finalizar Registro</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
