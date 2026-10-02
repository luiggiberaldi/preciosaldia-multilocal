import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldAlert, ShieldCheck, Hash, Copy, Check } from 'lucide-react';
import { SectionCard } from '../../SettingsShared';
import { getCustomerProject } from '../../../config/supabaseCloud.js';

export default function SettingsTabLicencia({ deviceId, triggerHaptic }) {
    const [idCopied, setIdCopied] = useState(false);
    const [license, setLicense] = useState(null);

    useEffect(() => {
        const loadLicense = () => {
            const raw = localStorage.getItem('pda_license_cache');
            if (raw) {
                try {
                    setLicense(JSON.parse(raw));
                    return;
                } catch (e) {
                    console.error(e);
                }
            }
            // Si hay código Pro activo, la licencia es válida aunque no esté en el caché viejo
            try {
                const proj = getCustomerProject();
                if (proj?.code) {
                    setLicense({ isActive: true, type: 'permanent', code: proj.code, productId: 'pro' });
                    return;
                }
            } catch {}
            setLicense(null);
        };

        loadLicense();
        // Escuchar cambios locales si ocurre una activación en segundo plano
        window.addEventListener('storage', loadLicense);
        return () => window.removeEventListener('storage', loadLicense);
    }, []);

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            setIdCopied(true);
            triggerHaptic?.();
            setTimeout(() => setIdCopied(false), 2000);
        });
    };

    const isPremium = license?.isActive === true && license?.type === 'permanent';

    // Renderizar detalles de acuerdo al tipo de licencia
    const renderLicenseDetails = () => {
        if (!isPremium) {
            return (
                <div className="space-y-4">
                    <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800/30 rounded-2xl flex gap-3 items-start">
                        <ShieldAlert className="text-rose-500 shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="text-sm font-black text-rose-800 dark:text-rose-400">Sin Licencia Activa</h4>
                            <p className="text-xs text-rose-700 dark:text-rose-500 leading-normal mt-1">
                                Este dispositivo no cuenta con una licencia activa de PreciosAlDía Bodega. Algunas herramientas premium como el control de inventario y estadísticas avanzadas pueden no estar disponibles.
                            </p>
                        </div>
                    </div>
                    <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/20 p-3.5 space-y-2">
                        <p className="text-xs font-bold text-slate-500">¿Cómo activar una licencia?</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            Copia tu ID de instalación y envíalo al administrador del sistema para activar una licencia.
                        </p>
                    </div>
                </div>
            );
        }

        const { type, expiresAt } = license;

        if (type === 'permanent') {
            return (
                <div className="space-y-4">
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30 rounded-2xl flex gap-3 items-start">
                        <ShieldCheck className="text-emerald-500 shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="text-sm font-black text-emerald-800 dark:text-emerald-400">Licencia de por Vida</h4>
                            <p className="text-xs text-emerald-700 dark:text-emerald-500 leading-normal mt-1">
                                Disfrutas de acceso ilimitado a todas las herramientas premium del sistema PreciosAlDía Bodega sin fecha de vencimiento.
                            </p>
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {/* Estado de Licencia */}
            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={KeyRound} title="Licencia de Software" subtitle="Detalles de activación de la app" iconColor="text-brand">
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-500">Tipo de Licencia</span>
                            <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${
                                isPremium 
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400' 
                                    : 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                            }`}>
                                {!isPremium ? 'Sin Licencia' : 'Permanente'}
                            </span>
                        </div>

                        {renderLicenseDetails()}

                        {!isPremium && (
                            <div className="mt-2 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                                <div className="p-3.5 bg-brand-light/20 dark:bg-surface-800/5 border border-brand/10 rounded-2xl flex flex-col gap-2">
                                    <div className="flex justify-between items-center">
                                        <h4 className="text-xs font-black text-slate-800 dark:text-white">Adquirir Licencia Premium</h4>
                                        <span className="text-[10px] bg-emerald-500 text-white font-black px-2 py-0.5 rounded-lg">$50 / Pago Único</span>
                                    </div>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                        Obtén tu licencia permanente por <strong>$50</strong>. Válido para <strong>solo 1 equipo (Caja)</strong> con el <strong>Modo Supervisor (Monitoreo en Vivo)</strong> incluido para tu celular.
                                    </p>
                                    <button 
                                        onClick={() => {
                                            triggerHaptic?.();
                                            window.open(`https://wa.me/584124051793?text=Hola! Quiero adquirir la licencia de $50 (1 equipo + modo supervisor). Mi ID es: ${deviceId || 'N/A'}`.replace(/\s+/g, '%20'), '_blank');
                                        }}
                                        className="w-full mt-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black rounded-xl transition-all shadow-sm shadow-emerald-500/20 active:scale-[0.97] text-center"
                                    >
                                        Solicitar por WhatsApp
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </SectionCard>
            </div>

            {/* Datos Técnicos de Licencia */}
            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={Hash} title="Identificación del Equipo" subtitle="ID asociado para licenciamiento" iconColor="text-slate-500">
                    <div className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-800 p-3 rounded-xl">
                        <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 mb-1">ID de Instalación</p>
                            <p className="font-mono text-xs font-black text-slate-600 dark:text-slate-300 select-all truncate">{deviceId || '...'}</p>
                        </div>
                        <button
                            onClick={() => copyToClipboard(deviceId)}
                            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-all"
                            title="Copiar ID"
                        >
                            {idCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal mt-1">Este ID identifica de manera única a este navegador y equipo. Es necesario para el registro de cualquier licencia.</p>
                </SectionCard>
            </div>
        </div>
    );
}
