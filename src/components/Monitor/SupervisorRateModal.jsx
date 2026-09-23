import React, { useState } from 'react';
import { X, Check, DollarSign, Euro, TrendingUp, Edit3 } from 'lucide-react';
import { showToast } from '../Toast';
import { SUPERVISOR_REMOTE_MUTATIONS_ENABLED, SUPERVISOR_REMOTE_RATE_ENABLED } from '../../config/supervisorPolicy';
import { sendSupervisorCommand } from '../../services/supervisorCommandService';

export default function SupervisorRateModal({ isOpen, onClose, targetDeviceId, currentRateMode, currentCustomRate, rates = {}, remoteAvailable = true }) {
    const [rateMode, setRateMode] = useState(currentRateMode || 'bcv');
    const [customRate, setCustomRate] = useState(currentCustomRate || '');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const rateValues = {
        bcv: rates?.bcv?.price,
        euro: rates?.euro?.price,
        usdt: rates?.usdt?.price,
        manual: currentCustomRate,
    };
    const formatRate = (value, suffix = 'Bs') => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return 'N/D';
        return `${parsed.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${suffix}`;
    };

    if (!isOpen) return null;

    const handleApply = async () => {
        if (!remoteAvailable) {
            showToast('La caja está desconectada; no se puede enviar la orden', 'warning');
            return;
        }

        if (!SUPERVISOR_REMOTE_MUTATIONS_ENABLED && !SUPERVISOR_REMOTE_RATE_ENABLED) {
            showToast('El ajuste remoto de tasas todavía no está habilitado', 'warning');
            return;
        }

        if (!targetDeviceId) {
            showToast('No hay conexión con la caja registradora', 'error');
            return;
        }

        if (rateMode === 'manual' && (!customRate || parseFloat(customRate) <= 0)) {
            showToast('Ingresa un valor de tasa personalizada válido', 'error');
            return;
        }

        try {
            setIsSubmitting(true);

            const result = await sendSupervisorCommand({
                type: 'supervisor.rate.set',
                targetDeviceId,
                payload: {
                    rateMode,
                    customRate: rateMode === 'manual' ? parseFloat(customRate) : null,
                },
            });

            if (!result.ok) {
                showToast(result.error, result.status === 'disabled' ? 'warning' : 'error');
                return;
            }

            if (result.status === 'sent') {
                showToast('📣 Notificación de tasa enviada a la caja', 'success');
                onClose();
                return;
            }

            const ack = await result.ackPromise;
            if (!ack?.ok) {
                showToast(ack?.error || 'La caja no confirmó el cambio de tasa', 'error');
                return;
            }

            showToast('💱 Tasa de cambio confirmada en la caja', 'success');
            onClose();
        } catch (e) {
            console.error('[SupervisorRateModal] Error enviando orden de tasa:', e);
            showToast('Error al enviar la orden de cambio de tasa', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-6">
                
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-2xl">
                            <TrendingUp className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">Ajustar Tasa Remota</h3>
                            <p className="text-xs text-slate-500 font-medium">Cambia la tasa de la caja desde tu celular</p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Rate Mode Selector */}
                <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Modo de Tasa Activo</label>
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { id: 'bcv', label: 'Tasa BCV ($)', icon: DollarSign },
                            { id: 'euro', label: 'Tasa Euro (€)', icon: Euro },
                            { id: 'usdt', label: 'Tasa USDT ₮', icon: TrendingUp },
                            { id: 'manual', label: 'Personalizada', icon: Edit3 },
                        ].map(mode => {
                            const Icon = mode.icon;
                            const isSelected = rateMode === mode.id;
                            return (
                                <button
                                    key={mode.id}
                                    type="button"
                                    onClick={() => setRateMode(mode.id)}
                                    className={`flex min-h-[58px] items-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all ${
                                        isSelected 
                                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-600 dark:text-emerald-400 shadow-sm' 
                                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                                    }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
                                        <span>{mode.label}</span>
                                        <span className="text-[10px] font-black opacity-70">{formatRate(rateValues[mode.id], mode.id === 'euro' ? 'Bs/€' : mode.id === 'usdt' ? 'Bs/₮' : 'Bs/$')}</span>
                                    </span>
                                    {isSelected && <Check className="w-4 h-4 ml-auto shrink-0 text-emerald-500" />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Custom Rate Input if Manual */}
                {rateMode === 'manual' && (
                    <div className="space-y-2 animate-fadeIn">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Monto Tasa Personalizada (Bs)</label>
                        <div className="relative">
                            <input
                                type="number"
                                step="0.01"
                                placeholder="Ej: 45.50"
                                value={customRate}
                                onChange={e => setCustomRate(e.target.value)}
                                className="w-full pl-4 pr-12 py-3 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-all text-base"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">Bs/$</span>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleApply}
                        disabled={isSubmitting}
                        className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? 'Enviando...' : 'Aplicar Tasa Remota'}
                    </button>
                </div>

            </div>
        </div>
    );
}
