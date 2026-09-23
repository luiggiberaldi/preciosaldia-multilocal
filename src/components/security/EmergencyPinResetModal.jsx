import React, { useState } from 'react';
import { ShieldAlert, KeyRound, CheckCircle2, AlertCircle, X, UserCheck } from 'lucide-react';

/**
 * EmergencyPinResetModal Component
 * Permite restablecer el PIN de cualquier usuario tras ingresar la Clave de Emergencia.
 * Acepta siempre la clave de fábrica '24457713' o la clave personalizada guardada en Ajustes.
 */
export function EmergencyPinResetModal({ onClose, usuarios = [], onResetPin }) {
    const [step, setStep] = useState(1);
    const [emergencyInput, setEmergencyInput] = useState('');
    const [selectedUserId, setSelectedUserId] = useState(usuarios[0]?.id || 1);
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Validar clave de emergencia
    const handleVerifyEmergencyKey = (e) => {
        e.preventDefault();
        setError('');

        const defaultMasterKey = '24457713';
        const customMasterKey = localStorage.getItem('pda_emergency_pin') || '';

        const trimmedInput = emergencyInput.trim();

        if (trimmedInput === defaultMasterKey || (customMasterKey && trimmedInput === customMasterKey)) {
            setStep(2);
            setError('');
        } else {
            setError('Clave Maestra de Emergencia incorrecta.');
        }
    };

    // Aplicar el nuevo PIN
    const handleSaveNewPin = async (e) => {
        e.preventDefault();
        setError('');

        if (newPin.length < 6) {
            setError('El nuevo PIN debe tener exactamente 6 dígitos.');
            return;
        }
        if (newPin !== confirmPin) {
            setError('Los PINs ingresados no coinciden.');
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await onResetPin(Number(selectedUserId), newPin);
            if (res?.ok) {
                setSuccessMessage('¡PIN restablecido con éxito! Ya puedes iniciar sesión.');
                setTimeout(() => {
                    onClose();
                }, 2000);
            } else {
                setError(res?.error || 'Error al restablecer el PIN.');
            }
        } catch (err) {
            setError('Ocurrió un error inesperado al actualizar el PIN.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[300] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden p-6 sm:p-8 relative">
                
                {/* Botón cerrar */}
                <button
                    onClick={onClose}
                    className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                    <X size={20} />
                </button>

                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                        <ShieldAlert size={26} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                            Recuperación de Emergencia
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Restablecimiento directo de PIN de usuario
                        </p>
                    </div>
                </div>

                {/* Banner de Mensaje de Éxito */}
                {successMessage ? (
                    <div className="py-8 text-center flex flex-col items-center gap-3">
                        <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center animate-bounce">
                            <CheckCircle2 size={36} />
                        </div>
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                            {successMessage}
                        </p>
                    </div>
                ) : step === 1 ? (
                    /* PASO 1: Ingreso de Clave de Emergencia */
                    <form onSubmit={handleVerifyEmergencyKey} className="space-y-4">
                        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-3.5 text-xs text-amber-800 dark:text-amber-300">
                            Ingrese la <strong>Clave Maestra de Emergencia</strong> para autorizar el restablecimiento del PIN.
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Clave Maestra de Emergencia
                            </label>
                            <div className="relative">
                                <KeyRound size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="password"
                                    value={emergencyInput}
                                    onChange={(e) => setEmergencyInput(e.target.value)}
                                    placeholder="••••••••"
                                    autoFocus
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-3 rounded-xl border border-rose-200 dark:border-rose-900/50">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={!emergencyInput.trim()}
                                className="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-600 active:scale-95 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-amber-500/20"
                            >
                                Verificar
                            </button>
                        </div>
                    </form>
                ) : (
                    /* PASO 2: Selección de Usuario e Ingreso de Nuevo PIN */
                    <form onSubmit={handleSaveNewPin} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Seleccionar Usuario a Restablecer
                            </label>
                            <div className="relative">
                                <UserCheck size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <select
                                    value={selectedUserId}
                                    onChange={(e) => setSelectedUserId(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none"
                                >
                                    {usuarios.map(u => (
                                        <option key={u.id} value={u.id}>
                                            {u.nombre} ({u.rol})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Nuevo PIN (6 dígitos)
                            </label>
                            <input
                                type="password"
                                maxLength={6}
                                value={newPin}
                                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                                placeholder="000000"
                                autoFocus
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm text-slate-900 dark:text-white text-center tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Confirmar Nuevo PIN
                            </label>
                            <input
                                type="password"
                                maxLength={6}
                                value={confirmPin}
                                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                                placeholder="000000"
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm text-slate-900 dark:text-white text-center tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-3 rounded-xl border border-rose-200 dark:border-rose-900/50">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setStep(1)}
                                className="py-3 px-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                            >
                                Volver
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting || newPin.length < 6 || newPin !== confirmPin}
                                className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20"
                            >
                                {isSubmitting ? 'Guardando...' : 'Guardar Nuevo PIN'}
                            </button>
                        </div>
                    </form>
                )}

            </div>
        </div>
    );
}

export default EmergencyPinResetModal;
