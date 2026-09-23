import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldAlert, ShieldCheck, Clock, Calendar, Hash, Copy, Check } from 'lucide-react';
import { SectionCard } from '../../SettingsShared';

export default function SettingsTabLicencia({ deviceId, triggerHaptic }) {
    const [idCopied, setIdCopied] = useState(false);
    const [license, setLicense] = useState(null);

    useEffect(() => {
        const loadLicense = () => {
            const raw = localStorage.getItem('pda_license_cache');
            if (raw) {
                try {
                    setLicense(JSON.parse(raw));
                } catch (e) {
                    console.error(e);
                }
            } else {
                setLicense(null);
            }
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

    const isPremium = license?.isActive && license?.type && license.type !== 'revoked' && license.type !== 'registered';

    // Formatear fechas
    const formatDate = (dateValue) => {
        if (!dateValue) return 'N/D';
        try {
            const date = new Date(dateValue);
            return date.toLocaleDateString('es-VE', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            });
        } catch (e) {
            return 'N/D';
        }
    };

    // Calcular días restantes
    const getDaysRemaining = (expiresAt) => {
        if (!expiresAt) return 0;
        const diffTime = expiresAt - Date.now();
        return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    };

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

        if (type === 'demo7' || type === 'demo3') {
            const daysRemaining = getDaysRemaining(expiresAt);
            return (
                <div className="space-y-4">
                    <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-800/30 rounded-2xl flex gap-3 items-start">
                        <Clock className="text-amber-500 shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="text-sm font-black text-amber-800 dark:text-amber-400">Período de Demostración</h4>
                            <p className="text-xs text-amber-700 dark:text-amber-500 leading-normal mt-1">
                                Tienes acceso temporal a todas las funciones premium para evaluar el sistema.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 max-w-sm">
                        <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 p-3.5 rounded-2xl">
                            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-550 dark:text-slate-450 block mb-1">Días Disponibles</span>
                            <span className="text-lg font-black text-slate-700 dark:text-white tabular-nums">{daysRemaining} {daysRemaining === 1 ? 'día' : 'días'}</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 p-3.5 rounded-2xl">
                            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-550 dark:text-slate-450 block mb-1">Vence el</span>
                            <span className="text-xs font-bold text-slate-650 dark:text-slate-200">{formatDate(expiresAt)}</span>
                        </div>
                    </div>
                </div>
            );
        }

        if (type === 'monthly') {
            const daysRemaining = getDaysRemaining(expiresAt);
            // Si tiene fecha de vencimiento, estimar último pago como 30 días antes de expiresAt
            const estimatedLastPayment = expiresAt ? expiresAt - 30 * 24 * 60 * 60 * 1000 : null;

            return (
                <div className="space-y-4">
                    <div className="p-4 bg-brand-light/50 dark:bg-surface-800/10 border border-brand/20 rounded-2xl flex gap-3 items-start">
                        <ShieldCheck className="text-brand shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="text-sm font-black text-brand-dark dark:text-brand">Suscripción Mensual Activa</h4>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-normal mt-1">
                                Tu suscripción mensual está al día. Gracias por confiar en PreciosAlDía Bodega.
                            </p>
                        </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 p-3.5 rounded-2xl flex items-center justify-between">
                        <div>
                            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-550 dark:text-slate-450 block mb-0.5">Días Restantes</span>
                            <span className="text-lg font-black text-slate-700 dark:text-white tabular-nums">{daysRemaining} {daysRemaining === 1 ? 'día' : 'días'}</span>
                        </div>
                        <div className="bg-brand-light dark:bg-surface-800/30 text-brand font-black text-xs px-3 py-1.5 rounded-xl">
                            Mensual
                        </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl space-y-3">
                        <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-550 dark:text-slate-450 flex items-center gap-1.5"><Calendar size={12} /> Fecha de Pago</span>
                            <span className="font-bold text-slate-700 dark:text-slate-200">{formatDate(estimatedLastPayment)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
                            <span className="font-bold text-slate-550 dark:text-slate-450 flex items-center gap-1.5"><ShieldAlert size={12} /> Fecha de Corte</span>
                            <span className="font-bold text-slate-700 dark:text-slate-200">{formatDate(expiresAt)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
                            <span className="font-bold text-slate-550 dark:text-slate-450 flex items-center gap-1.5"><KeyRound size={12} /> Próximo Pago</span>
                            <span className="font-bold text-brand-dark dark:text-brand">{formatDate(expiresAt)}</span>
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
                                {!isPremium ? 'Sin Licencia' : 
                                 license.type === 'permanent' ? 'Permanente' :
                                 (license.type === 'demo7' || license.type === 'demo3') ? 'Demo' : 'Mensual'}
                            </span>
                        </div>

                        {renderLicenseDetails()}

                        {(!license || license.type !== 'permanent') && (
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
