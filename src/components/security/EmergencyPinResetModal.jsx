import React, { useState } from 'react';
import { ShieldAlert, KeyRound, CheckCircle2, AlertCircle, X, Lock, Crown, Eye, EyeOff } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import { LOGIN_RATE_LIMIT } from '../../utils/securityConstants';
import { setMasterPin } from '../../utils/duenoAuth';
import { sha256Hex } from '../../utils/crypto';
import { logEvent } from '../../services/auditService';

/**
 * EmergencyPinResetModal Component
 * Permite restablecer el PIN de un usuario tras ingresar la Clave de Emergencia
 * configurada por el dueño en Ajustes.
 *
 * Fase 1 (CRÍTICO-1): se eliminó la clave de fábrica hardcodeada. Sin una clave
 * personalizada configurada, el flujo queda DESHABILITADO (no hay fallback).
 * Los intentos fallidos aplican rate-limit con backoff (LOGIN_RATE_LIMIT).
 *
 * 2026-10-02: el dueño SÍ puede restablecer su PIN maestro con la clave de
 * emergencia (decisión de Luigi). Requiere confirmación explícita adicional
 * y se registra en auditoría.
 */
const EMERGENCY_KEY_LS = 'pda_emergency_pin';
const EMERGENCY_RL_LS = 'pda_emergency_rl';

function _readRateLimit() {
    try {
        return JSON.parse(localStorage.getItem(EMERGENCY_RL_LS)) || {};
    } catch { return {}; }
}

function _writeRateLimit(rl) {
    try { localStorage.setItem(EMERGENCY_RL_LS, JSON.stringify(rl)); } catch { /* noop */ }
}

export function EmergencyPinResetModal({ onClose, usuarios = [], onResetPin }) {
    // 2026-10-02: el dueño ahora SÍ es elegible (con confirmación extra).
    const eligibleUsers = usuarios || [];
    const [step, setStep] = useState(1);
    const [emergencyInput, setEmergencyInput] = useState('');
    const [showEmergencyText, setShowEmergencyText] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState(eligibleUsers[0]?.id ?? 1);
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showNewPinText, setShowNewPinText] = useState(false);
    // Confirmación extra cuando se elige restablecer el PIN del dueño
    const [duenoConfirmed, setDuenoConfirmed] = useState(false);

    // Sin clave personalizada configurada por el dueño, el flujo no existe.
    // Soporta hash (nuevo) y texto plano (legacy, se migra al usar).
    const storedHash = (() => {
        try { return localStorage.getItem(EMERGENCY_KEY_LS + '_hash') || ''; } catch { return ''; }
    })();
    const legacyPlain = (() => {
        try { return localStorage.getItem(EMERGENCY_KEY_LS) || ''; } catch { return ''; }
    })();
    const isDisabled = !storedHash && !legacyPlain;

    const _lockoutRemainingMs = () => {
        const rl = _readRateLimit();
        const remaining = (rl.lockUntil || 0) - Date.now();
        return remaining > 0 ? remaining : 0;
    };

    // Validar clave de emergencia (con rate-limit persistido)
    const handleVerifyEmergencyKey = async (e) => {
        e.preventDefault();
        setError('');

        const remaining = _lockoutRemainingMs();
        if (remaining > 0) {
            const secs = Math.ceil(remaining / 1000);
            setError(`Demasiados intentos fallidos. Intenta de nuevo en ${secs}s.`);
            return;
        }

        const trimmedInput = emergencyInput.trim();
        let valid = false;
        if (trimmedInput) {
            if (storedHash) {
                // Nuevo: comparar hashes
                const inputHash = await sha256Hex(trimmedInput);
                valid = inputHash === storedHash;
            } else if (legacyPlain) {
                // Legacy: texto plano (se migra a hash al usar)
                valid = trimmedInput === legacyPlain;
                if (valid) {
                    try {
                        const h = await sha256Hex(trimmedInput);
                        localStorage.setItem(EMERGENCY_KEY_LS + '_hash', h);
                        localStorage.removeItem(EMERGENCY_KEY_LS);
                    } catch { /* best-effort */ }
                }
            }
        }
        if (valid) {
            _writeRateLimit({});
            setStep(2);
            setError('');
            return;
        }

        // Fallo: registrar intento con backoff exponencial.
        const now = Date.now();
        const rl = _readRateLimit();
        let failed = (rl.failedAttempts || 0) + 1;
        if (rl.lastFailedAttemptTs && now - rl.lastFailedAttemptTs > LOGIN_RATE_LIMIT.RESET_WINDOW_MS) {
            failed = 1;
        }
        const next = { failedAttempts: failed, lastFailedAttemptTs: now, lockUntil: 0, consecutiveLockouts: rl.consecutiveLockouts || 0 };
        if (failed >= LOGIN_RATE_LIMIT.MAX_ATTEMPTS) {
            const consecutive = next.consecutiveLockouts + 1;
            const rawLockout = LOGIN_RATE_LIMIT.LOCKOUT_MS * Math.pow(LOGIN_RATE_LIMIT.BACKOFF_FACTOR, consecutive - 1);
            next.lockUntil = now + Math.min(rawLockout, LOGIN_RATE_LIMIT.MAX_LOCKOUT_MS);
            next.consecutiveLockouts = consecutive;
            next.failedAttempts = 0;
        }
        _writeRateLimit(next);
        setError('Clave Maestra de Emergencia incorrecta.');
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

        const isDueno = String(selectedUserId) === 'dueno';
        if (isDueno && !duenoConfirmed) {
            setError('Debes confirmar que entiendes que esto restablece el PIN maestro del dueño.');
            return;
        }

        setIsSubmitting(true);
        try {
            if (isDueno) {
                // Restablecer PIN maestro del dueño
                const res = await setMasterPin(newPin);
                if (res?.ok) {
                    try {
                        await logEvent({
                            tipo: 'seguridad',
                            accion: 'pin_dueno_restablecido_emergencia',
                            detalle: 'PIN maestro restablecido vía clave de emergencia',
                        });
                    } catch { /* auditoría best-effort */ }
                    setSuccessMessage('¡PIN del dueño restablecido con éxito! Ya puedes iniciar sesión.');
                    setTimeout(() => { onClose(); }, 2000);
                } else {
                    setError(res?.error || 'Error al restablecer el PIN del dueño.');
                }
            } else {
                const res = await onResetPin(Number(selectedUserId), newPin);
                if (res?.ok) {
                    setSuccessMessage('¡PIN restablecido con éxito! Ya puedes iniciar sesión.');
                    setTimeout(() => {
                        onClose();
                    }, 2000);
                } else {
                    setError(res?.error || 'Error al restablecer el PIN.');
                }
            }
        } catch (err) {
            setError('Ocurrió un error inesperado al actualizar el PIN.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const isDuenoSelected = String(selectedUserId) === 'dueno';

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
                ) : isDisabled ? (
                    /* SIN CLAVE CONFIGURADA: el flujo de emergencia no existe hasta
                       que el dueño defina una clave en Ajustes (Fase 1, CRÍTICO-1). */
                    <div className="space-y-4">
                        <div className="bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-xs text-slate-600 dark:text-slate-300 flex gap-3">
                            <Lock size={18} className="shrink-0 mt-0.5 text-slate-400" />
                            <p>
                                La recuperación de emergencia está <strong>deshabilitada</strong> porque
                                el dueño aún no ha configurado una Clave Maestra de Emergencia.
                                <br /><br />
                                El dueño puede configurarla en <strong>Ajustes → Usuarios → Clave Maestra de Emergencia</strong>.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full py-3 px-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                            Entendido
                        </button>
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
                                    autoComplete="off"
                                    type={showEmergencyText ? "text" : "password"}
                                    value={emergencyInput}
                                    onChange={(e) => setEmergencyInput(e.target.value)}
                                    placeholder="••••••••"
                                    autoFocus
                                    className="w-full pl-10 pr-11 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowEmergencyText(!showEmergencyText)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                >
                                    {showEmergencyText ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
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
                            <CustomSelect
                                value={selectedUserId}
                                onChange={(v) => { setSelectedUserId(v); setDuenoConfirmed(false); }}
                                options={eligibleUsers.map(u => ({
                                    value: u.id,
                                    label: `${u.nombre}${u.rol ? ` (${u.rol})` : ''}`,
                                }))}
                                placeholder="Seleccionar usuario"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Nuevo PIN (6 dígitos)
                            </label>
                            <div className="relative">
                                <input
                                    autoComplete="off"
                                    type={showNewPinText ? "text" : "password"}
                                    maxLength={6}
                                    value={newPin}
                                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                                    placeholder="000000"
                                    autoFocus
                                    className="w-full pl-4 pr-11 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm text-slate-900 dark:text-white text-center tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPinText(!showNewPinText)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                >
                                    {showNewPinText ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Confirmar Nuevo PIN
                            </label>
                            <div className="relative">
                                <input
                                    autoComplete="off"
                                    type={showNewPinText ? "text" : "password"}
                                    maxLength={6}
                                    value={confirmPin}
                                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                                    placeholder="000000"
                                    className="w-full pl-4 pr-11 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm text-slate-900 dark:text-white text-center tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPinText(!showNewPinText)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                >
                                    {showNewPinText ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Confirmación extra para el PIN del dueño */}
                        {isDuenoSelected && (
                            <label className="flex gap-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-3.5 cursor-pointer">
                                <input
                                    autoComplete="off"
                                    type="checkbox"
                                    checked={duenoConfirmed}
                                    onChange={(e) => setDuenoConfirmed(e.target.checked)}
                                    className="mt-1 w-4 h-4 accent-rose-600 shrink-0"
                                />
                                <span className="text-[11px] leading-relaxed text-rose-800 dark:text-rose-200">
                                    <Crown size={13} className="inline -mt-0.5 mr-1" />
                                    <strong>Entiendo que esto restablece el PIN maestro del dueño</strong> y otorga
                                    acceso total a todos los negocios. Esta acción queda registrada en auditoría.
                                </span>
                            </label>
                        )}

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
