/**
 * MasterPinSetupModal.jsx — Creación única del PIN maestro del dueño (Fase 1.5).
 *
 * Se muestra una sola vez: cuando `requireLogin` está activo y aún no existe
 * un PIN maestro (`isMasterPinSetup() === false`). Bloquea la app hasta que
 * el dueño crea su PIN (o cierra la app).
 *
 * UI: todo redondeado, sin alert/confirm/prompt, iconos lucide.
 */
import React, { useState } from 'react';
import { Crown, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { setMasterPin } from '../../utils/duenoAuth';
import { PIN_POLICY } from '../../utils/securityConstants';

const PIN_LENGTH = PIN_POLICY.MIN_LENGTH;

function PinBoxes({ value, onChange, idPrefix, visible }) {
    const digits = (value || '').padEnd(PIN_LENGTH, '').slice(0, PIN_LENGTH).split('');

    const handleChange = (index, digit) => {
        if (!/^\d?$/.test(digit)) return;
        const next = [...digits];
        next[index] = digit;
        onChange(next.join('').replace(/ /g, ''));
        if (digit && index < PIN_LENGTH - 1) {
            document.getElementById(`masterpin-${idPrefix}-${index + 1}`)?.focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            document.getElementById(`masterpin-${idPrefix}-${index - 1}`)?.focus();
        }
    };

    return (
        <div className="flex gap-2 justify-center">
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <input
                    key={i}
                    id={`masterpin-${idPrefix}-${i}`}
                    type={visible ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={1}
                    autoComplete="off"
                    value={digits[i]?.trim() || ''}
                    onChange={(e) => handleChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className="w-11 h-13 py-3 text-center text-xl font-black bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-2xl focus:border-amber-500 outline-none text-slate-800 dark:text-white transition-all"
                />
            ))}
        </div>
    );
}

export default function MasterPinSetupModal({ isOpen, onDone }) {
    const [pin, setPin] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [showPin, setShowPin] = useState(false);

    if (!isOpen) return null;

    const handleSave = async () => {
        setError('');
        if (pin.length !== PIN_LENGTH) {
            setError(`El PIN debe tener ${PIN_LENGTH} dígitos.`);
            return;
        }
        if (pin !== confirm) {
            setError('Los PINs no coinciden. Inténtalo de nuevo.');
            setConfirm('');
            return;
        }
        setSaving(true);
        try {
            const res = await setMasterPin(pin);
            if (res.ok) {
                onDone && onDone();
            } else {
                setError(res.error || 'No se pudo guardar el PIN.');
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-[1.75rem] p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/30">
                        <Crown size={30} className="text-white" />
                    </div>
                    <h2 className="text-xl font-black text-slate-800 dark:text-white mb-2">
                        Crea tu PIN maestro de dueño
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6 max-w-xs">
                        Este PIN te identifica como <strong>dueño</strong> en todos tus
                        negocios. No está atado a ninguna sede: guárdalo bien.
                    </p>

                    <div className="flex items-center justify-center gap-2 mb-2">
                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                            Tu PIN maestro
                        </p>
                        <button
                            type="button"
                            onClick={() => setShowPin(v => !v)}
                            className="p-1 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                            aria-label={showPin ? 'Ocultar PIN' : 'Mostrar PIN'}
                        >
                            {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    <PinBoxes value={pin} onChange={setPin} idPrefix="new" visible={showPin} />

                    <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2 mt-5">
                        Confírmalo
                    </p>
                    <PinBoxes value={confirm} onChange={setConfirm} idPrefix="confirm" visible={showPin} />

                    {error && (
                        <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-4 py-2.5 rounded-2xl border border-rose-200 dark:border-rose-900/50">
                            <AlertCircle size={15} className="shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        onClick={handleSave}
                        disabled={saving || pin.length !== PIN_LENGTH || confirm.length !== PIN_LENGTH}
                        className="mt-6 w-full px-4 py-3.5 rounded-2xl font-extrabold text-sm bg-amber-500 hover:bg-amber-600 active:scale-95 disabled:opacity-40 disabled:pointer-events-none text-white shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2 outline-none focus:ring-2 focus:ring-amber-500/50"
                    >
                        {saving ? (
                            <Loader2 size={17} className="animate-spin" />
                        ) : (
                            <CheckCircle2 size={17} />
                        )}
                        {saving ? 'Guardando…' : 'Guardar PIN maestro'}
                    </button>
                    <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500">
                        Si lo olvidas, puedes restablecerlo con la clave de emergencia
                        (7 toques al logo en esta pantalla).
                    </p>
                </div>
            </div>
        </div>
    );
}
