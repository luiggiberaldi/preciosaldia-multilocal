import React, { useState } from 'react';
import { Check, Store } from 'lucide-react';
import { useNegociosStore } from '../hooks/store/useNegociosStore';

/**
 * BusinessSetupOverlay.jsx — Configuración del primer negocio (flujo de primer arranque).
 *
 * Orden del flujo (multi-local): Términos → PIN maestro del dueño →
 * nombrar el primer negocio → app. Se muestra una sola vez por instalación
 * (flag `pda_business_config_done`); las instalaciones que ya aceptaron los
 * términos con el flujo anterior no lo ven de nuevo (migración en App.jsx).
 *
 * El nombre va al registro del negocio activo (fuente de verdad) y el correo
 * se guarda global como correo del dueño (las novedades son de la app, no
 * del negocio).
 */
export default function BusinessSetupOverlay({ onDone }) {
    const [businessName, setBusinessName] = useState('');
    const [ownerEmail, setOwnerEmail] = useState('');

    const handleFinish = () => {
        const trimmedName = businessName.trim();
        const trimmedEmail = ownerEmail.trim();
        // El nombre va al registro del negocio activo (fuente de verdad);
        // el espejo fiscal business_* se refresca solo vía syncFiscalMirror.
        try {
            const { negocioActivoId, actualizarNegocio } = useNegociosStore.getState();
            if (negocioActivoId && trimmedName) actualizarNegocio(negocioActivoId, { nombre: trimmedName });
        } catch { /* boot aún no corrió: el espejo queda como fallback */ }
        localStorage.setItem('business_name', trimmedName); // espejo fiscal
        localStorage.setItem('marketing_email', trimmedEmail); // correo del dueño (global)
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
                        <h3 className="font-display text-3xl text-surface-700 tracking-tight mb-2">¡Bienvenido a Precios al Día!</h3>
                        <p className="text-xs text-surface-500 font-medium leading-relaxed">
                            Este será tu primer negocio en PreciosAlDía. Podrás agregar más negocios después
                            desde el selector en el encabezado; los datos de cada uno se mantienen totalmente separados.
                            Ingresa los siguientes datos para empezar.
                        </p>
                    </div>

                    <div className="space-y-4 max-w-md mx-auto">
                        <div className="space-y-1.5">
                            <label className="text-[10px] uppercase font-bold text-surface-500 block">
                                Nombre de tu Negocio *
                            </label>
                            <input
                                type="text"
                                placeholder="Ej: Bodega Don José, Inversiones Rojas"
                                value={businessName}
                                onChange={e => setBusinessName(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all font-medium"
                                autoFocus
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[10px] uppercase font-bold text-surface-500 block">
                                Correo del Dueño (Opcional)
                            </label>
                            <input
                                type="email"
                                placeholder="Ej: contacto@minegocio.com"
                                value={ownerEmail}
                                onChange={e => setOwnerEmail(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all font-medium"
                            />
                            <p className="text-[10px] text-surface-400 font-medium leading-tight">
                                Lo usaremos para mantenerte al tanto de actualizaciones y promociones de PreciosAlDía.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-surface-200 dark:border-surface-700 bg-surface-200 shrink-0">
                    <button
                        onClick={handleFinish}
                        disabled={!businessName.trim()}
                        className={`btn w-full ${businessName.trim() ? 'btn-primary' : 'bg-surface-300 dark:bg-surface-700 text-surface-500 dark:text-surface-400 cursor-not-allowed'} shadow-tone-md`}
                    >
                        <Check size={20} strokeWidth={2.5} />
                        <span>Finalizar Registro</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
