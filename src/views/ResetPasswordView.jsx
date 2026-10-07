// v1.2.0: Rebrand al design system "Precios al Día" — OKLCH + Instrument Serif + cream/cian.
// - Fondo cream (bg-surface-50) con dark mode nativo vía tokens OKLCH.
// - Títulos h1 con font-display (Instrument Serif).
// - Botón submit usando primitiva Button (variant=primary) — touch target 48px, focus ring cian.
// - Inputs con focus ring cian (focus:ring-brand/50 focus:border-brand).
// - Animación reveal en el card principal vía useReveal.
import React, { useState, useEffect } from 'react';
import { Lock, EyeOff, Eye, CheckCircle, ShieldCheck, AlertTriangle, Loader2, Mail, LogIn } from 'lucide-react';
import { supabaseCloud } from '../config/supabaseCloud';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useReveal } from '../hooks/useReveal';
import { Button } from '../components/ui/Button';

// ─── Pantalla: Elegir nueva contraseña ────────────────────────────────────────
function ChangePasswordScreen({ onPasswordChanged }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [status, setStatus] = useState('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [sessionReady, setSessionReady] = useState(false);

    useEffect(() => {
        if (!supabaseCloud) return;
        const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange(
            async (event, session) => {
                if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
                    setSessionReady(true);
                }
            }
        );
        return () => subscription.unsubscribe();
    }, []);

    const strength = (() => {
        if (!password) return 0;
        let s = 0;
        if (password.length >= 6) s++;
        if (password.length >= 10) s++;
        if (/[A-Z]/.test(password)) s++;
        if (/[0-9]/.test(password)) s++;
        if (/[^A-Za-z0-9]/.test(password)) s++;
        return s;
    })();

    const strengthLabel = ['', 'Muy débil', 'Débil', 'Regular', 'Fuerte', 'Muy fuerte'][strength];
    // v1.2.0: Paleta tone-matched (danger/accent/warning/success) en vez de red/orange/yellow/emerald crudos.
    const strengthColor = ['', 'bg-red-500', 'bg-accent-500', 'bg-amber-400', 'bg-emerald-400', 'bg-emerald-500'][strength];
    const strengthTextColor = ['', 'text-red-500', 'text-accent-500', 'text-amber-500', 'text-emerald-500', 'text-emerald-500'][strength];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        if (password.length < 6) { setErrorMsg('Mínimo 6 caracteres.'); return; }
        if (password !== confirm) { setErrorMsg('Las contraseñas no coinciden.'); return; }

        setStatus('loading');
        try {
            const { error } = await supabaseCloud.auth.updateUser({ password });
            if (error) throw error;

            // Cerrar la sesión de recuperación para que el usuario haga login manual
            await supabaseCloud.auth.signOut();
            onPasswordChanged();
        } catch (err) {
            setErrorMsg(err.message || 'Error al actualizar la contraseña.');
            setStatus('idle');
        }
    };

    return (
        <>
            {/* v1.2.0: Icono brand con shadow-primary-tone en vez de gradiente azul */}
            <div className="w-16 h-16 bg-brand rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-primary-tone">
                <ShieldCheck size={30} className="text-white" />
            </div>
            <h1 className="font-display text-3xl text-surface-700 dark:text-surface-100 text-center mb-1 leading-tight">Nueva contraseña</h1>
            <p className="text-surface-500 dark:text-surface-400 text-sm text-center mb-8">Elige una contraseña segura para tu cuenta.</p>

            {!sessionReady && (
                <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl flex items-center gap-2">
                    <Loader2 size={14} className="text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">Verificando enlace de recuperación...</p>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Nueva contraseña */}
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider ml-1">Nueva contraseña</label>
                    <div className="relative">
                        <input
                            type={showPass ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Mínimo 6 caracteres"
                            className="w-full bg-surface-100 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-2xl pl-11 pr-11 py-3.5 text-sm text-surface-700 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                            autoFocus
                            disabled={!sessionReady || status === 'loading'}
                        />
                        <Lock size={16} className="absolute left-4 top-4 text-surface-400" />
                        <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-4 top-3.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
                            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    {password.length > 0 && (
                        <div className="px-1 animate-in fade-in duration-200">
                            <div className="flex gap-1 mt-2">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= strength ? strengthColor : 'bg-surface-300 dark:bg-surface-700'}`} />
                                ))}
                            </div>
                            <p className={`text-[10px] font-bold mt-1.5 ${strengthTextColor}`}>
                                {strengthLabel}
                            </p>
                        </div>
                    )}
                </div>

                {/* Confirmar */}
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider ml-1">Confirmar contraseña</label>
                    <div className="relative">
                        <input
                            type={showConfirm ? 'text' : 'password'}
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                            placeholder="Repite la contraseña"
                            className={`w-full bg-surface-100 dark:bg-surface-800 border rounded-2xl pl-11 pr-11 py-3.5 text-sm text-surface-700 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 transition-all ${
                                confirm && confirm !== password ? 'border-red-500/50 focus:ring-red-500/30'
                                : confirm && confirm === password ? 'border-emerald-500/50 focus:ring-emerald-500/30'
                                : 'border-surface-300 dark:border-surface-700 focus:ring-brand/50 focus:border-brand'
                            }`}
                            disabled={!sessionReady || status === 'loading'}
                        />
                        <Lock size={16} className="absolute left-4 top-4 text-surface-400" />
                        <button type="button" onClick={() => setShowConfirm(p => !p)} className="absolute right-4 top-3.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
                            {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    {confirm && confirm === password && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold ml-1 flex items-center gap-1 animate-in fade-in">
                            <CheckCircle size={10} /> Las contraseñas coinciden
                        </p>
                    )}
                    {confirm && confirm !== password && (
                        <p className="text-[10px] text-red-500 font-bold ml-1 animate-in fade-in">Las contraseñas no coinciden</p>
                    )}
                </div>

                {errorMsg && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl flex items-start gap-2 animate-in fade-in">
                        <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-red-700 dark:text-red-300">{errorMsg}</p>
                    </div>
                )}

                {/* v1.2.0: Primitiva Button con variant=primary + size=lg (touch target 56px, focus ring cian nativo). */}
                <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={!sessionReady || status === 'loading' || !password || password !== confirm}
                    className="w-full mt-2"
                >
                    {status === 'loading' ? (
                        <><Loader2 size={16} className="animate-spin" /> Guardando...</>
                    ) : (
                        <><ShieldCheck size={16} /> Guardar nueva contraseña</>
                    )}
                </Button>
            </form>
        </>
    );
}

// ─── Pantalla: Login tras reseteo ─────────────────────────────────────────────
function LoginAfterResetScreen({ onDone }) {
    const setAdminCredentials = useAuthStore(s => s.setAdminCredentials);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [status, setStatus] = useState('idle');
    const [errorMsg, setErrorMsg] = useState('');

    const handleLogin = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        if (!email.includes('@')) { setErrorMsg('Ingresa un correo válido.'); return; }
        if (password.length < 6) { setErrorMsg('La contraseña debe tener al menos 6 caracteres.'); return; }

        setStatus('loading');
        try {
            const { error } = await supabaseCloud.auth.signInWithPassword({
                email: email.trim().toLowerCase(),
                password,
            });
            if (error) throw error;

            // Guardar credenciales en el store para activar la sincronización P2P
            setAdminCredentials(email.trim().toLowerCase(), password);
            onDone();
        } catch (err) {
            setErrorMsg(err.message || 'Correo o contraseña incorrectos.');
            setStatus('idle');
        }
    };

    return (
        <>
            {/* Icon */}
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-tone-sm">
                <CheckCircle size={32} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="font-display text-3xl text-surface-700 dark:text-surface-100 text-center mb-1 leading-tight">Contraseña actualizada</h1>
            <p className="text-surface-500 dark:text-surface-400 text-sm text-center mb-8 leading-relaxed">
                Ingresa tu correo y tu nueva contraseña para iniciar sesión.
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
                {/* Email */}
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider ml-1">Correo electrónico</label>
                    <div className="relative">
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="tu@correo.com"
                            className="w-full bg-surface-100 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-surface-700 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                            autoFocus
                            disabled={status === 'loading'}
                        />
                        <Mail size={16} className="absolute left-4 top-4 text-surface-400" />
                    </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider ml-1">Nueva contraseña</label>
                    <div className="relative">
                        <input
                            type={showPass ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Tu nueva contraseña"
                            className="w-full bg-surface-100 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-2xl pl-11 pr-11 py-3.5 text-sm text-surface-700 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                            disabled={status === 'loading'}
                        />
                        <Lock size={16} className="absolute left-4 top-4 text-surface-400" />
                        <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-4 top-3.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
                            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                </div>

                {errorMsg && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl flex items-start gap-2 animate-in fade-in">
                        <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-red-700 dark:text-red-300">{errorMsg}</p>
                    </div>
                )}

                {/* v1.2.0: Primitiva Button — variant=primary, size=lg. */}
                <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={status === 'loading'}
                    className="w-full mt-2"
                >
                    {status === 'loading' ? (
                        <><Loader2 size={16} className="animate-spin" /> Iniciando sesión...</>
                    ) : (
                        <><LogIn size={16} /> Entrar y Sincronizar</>
                    )}
                </Button>
            </form>
        </>
    );
}

// ─── Componente Raíz ──────────────────────────────────────────────────────────
export default function ResetPasswordView({ onDone }) {
    const [step, setStep] = useState('change'); // 'change' | 'login'
    // v1.2.0: reveal-on-scroll para la card principal (fade-up + stagger).
    const revealRef = useReveal();

    return (
        // v1.2.0: Fondo cream (bg-surface-50) — dark mode nativo vía tokens OKLCH.
        <div ref={revealRef} className="fixed inset-0 z-[300] bg-surface-50 dark:bg-surface-950 flex items-center justify-center p-6 font-sans">
            {/* Background glow — tone-matched cian */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-brand/10 rounded-full blur-[100px]" />
                <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-brand/10 rounded-full blur-[100px]" />
            </div>

            {/* v1.2.0: card principal con clase reveal — animación on-mount (IntersectionObserver). */}
            <div className="reveal relative w-full max-w-sm bg-surface dark:bg-surface-100 border border-surface-200 dark:border-surface-700 rounded-[2rem] shadow-tone-lg p-8 animate-in slide-in-from-bottom-6 duration-300">
                {step === 'change' ? (
                    <ChangePasswordScreen onPasswordChanged={() => setStep('login')} />
                ) : (
                    <LoginAfterResetScreen onDone={onDone} />
                )}
            </div>
        </div>
    );
}
