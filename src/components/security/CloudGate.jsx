/**
 * CloudGate.jsx — Puerta de entrada del Pro.
 *
 * Orden: código de licencia (una sola vez) → login en la nube (una sola vez)
 * → menú PIN local. Después, la app recuerda el proyecto y la sesión y abre
 * sin internet: la caja nunca se bloquea por un corte de red.
 *
 * Estados: checking → code → login → ready (+ limit si la cuenta llegó al
 * tope de 6 equipos).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    Cloud, CloudOff, KeyRound, Mail, Lock, Loader2, AlertTriangle,
    Smartphone, Trash2, ArrowLeft, CheckCircle2,
} from 'lucide-react';
import {
    ensureCustomerClient,
    setCustomerProject,
    clearCustomerProject,
    getCustomerProject,
    supabaseCloud,
} from '../../config/supabaseCloud.js';
import { lookupProjectByCode } from '../../services/customerDirectory.js';
import {
    getOwnerSession,
    signInOwner,
    getMyDevices,
    revokeDevice,
    registerCurrentDevice,
    getLocalDeviceId,
    MAX_DEVICES_PER_ACCOUNT,
} from '../../services/cloudAccount.js';

const inputCls =
    'w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 ' +
    'rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 ' +
    'focus:border-sky-500 focus:outline-none';

const btnPrimary =
    'w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold ' +
    'transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ' +
    'flex items-center justify-center gap-2';

const btnGhost =
    'w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 ' +
    'text-sm font-bold transition-colors active:scale-[0.98] disabled:opacity-50 ' +
    'flex items-center justify-center gap-2';

function Shell({ children }) {
    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
            <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6">
                {children}
            </div>
        </div>
    );
}

function Header({ icon: Icon, title, subtitle }) {
    return (
        <div className="text-center mb-5">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center mb-3">
                <Icon className="w-6 h-6 text-sky-600 dark:text-sky-400" />
            </div>
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h1>
            {subtitle && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>
            )}
        </div>
    );
}

function ErrorMsg({ msg }) {
    if (!msg) return null;
    return (
        <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2 mb-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{msg}</span>
        </div>
    );
}

function shortId(id) {
    if (!id) return '—';
    return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export default function CloudGate({ onReady }) {
    const [state, setState] = useState('checking'); // checking|code|login|limit|ready
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [code, setCode] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [devices, setDevices] = useState([]);
    const [offline] = useState(
        typeof navigator !== 'undefined' && navigator.onLine === false
    );

    // Arranque: ¿ya hay proyecto recordado? ¿Hay sesión guardada?
    // getSession() es local: no exige red. Sin red y con sesión → se entra igual.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const client = ensureCustomerClient();
                if (!client) {
                    if (alive) setState('code');
                    return;
                }
                const { session } = await getOwnerSession();
                if (!alive) return;
                if (session && !session.user?.is_anonymous) {
                    setState('ready');
                    onReady();
                } else {
                    setState('login');
                }
            } catch {
                if (alive) setState('code');
            }
        })();
        return () => {
            alive = false;
        };
    }, [onReady]);

    const handleCode = useCallback(async () => {
        setBusy(true);
        setError('');
        const res = await lookupProjectByCode(code);
        setBusy(false);
        if (!res.ok) {
            setError(res.error);
            return;
        }
        setCustomerProject(res.project);
        setState('login');
    }, [code]);

    const handleLogin = useCallback(async () => {
        setBusy(true);
        setError('');
        const res = await signInOwner(email, password);
        setBusy(false);
        if (res.ok) {
            setState('ready');
            onReady();
            return;
        }
        if (res.limitReached) {
            // La sesión se firmó pero el cupo está lleno: entrar igual para
            // listar equipos y liberar uno (signInOwner cerró la sesión a
            // medias; re-autenticamos aquí para administrar).
            setBusy(true);
            try {
                const { error } = await supabaseCloud.auth.signInWithPassword({
                    email: String(email).trim().toLowerCase(),
                    password,
                });
                if (error) throw error;
                const devs = await getMyDevices();
                setDevices(devs.ok ? devs.devices : []);
                setState('limit');
            } catch (e) {
                setError(e?.message || 'No se pudo listar los equipos.');
            }
            setBusy(false);
            return;
        }
        setError(res.error || 'No se pudo iniciar sesión.');
    }, [email, password, onReady]);

    const handleRevoke = useCallback(async (deviceId) => {
        setBusy(true);
        const res = await revokeDevice(deviceId);
        if (!res.ok) {
            setError(res.error);
            setBusy(false);
            return;
        }
        const devs = await getMyDevices();
        setDevices(devs.ok ? devs.devices : []);
        // Reintentar el registro de este equipo tras liberar el cupo.
        const reg = await registerCurrentDevice();
        setBusy(false);
        if (reg.ok) {
            setState('ready');
            onReady();
        }
    }, [onReady]);

    const handleUseAnotherCode = useCallback(async () => {
        await clearCustomerProject();
        setCode('');
        setEmail('');
        setPassword('');
        setError('');
        setState('code');
    }, []);

    if (state === 'checking') {
        return (
            <Shell>
                <div className="flex flex-col items-center py-8">
                    <Loader2 className="w-8 h-8 text-sky-600 animate-spin mb-3" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Verificando…</p>
                </div>
            </Shell>
        );
    }

    if (state === 'code') {
        return (
            <Shell>
                <Header
                    icon={KeyRound}
                    title="Activa tu licencia"
                    subtitle="Ingresa el código que recibiste al comprar PreciosAlDía Pro. Solo se pide una vez."
                />
                <ErrorMsg msg={error} />
                <input
                    className={`${inputCls} uppercase tracking-widest text-center font-mono mb-3`}
                    placeholder="LIC-XXXXXX"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleCode()}
                    autoCapitalize="characters"
                    autoCorrect="off"
                />
                <button className={btnPrimary} onClick={handleCode} disabled={busy || !code.trim()}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Verificar código
                </button>
                {offline && (
                    <p className="flex items-center justify-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mt-3">
                        <CloudOff className="w-3.5 h-3.5" /> Sin conexión: conéctate una vez para activar.
                    </p>
                )}
            </Shell>
        );
    }

    if (state === 'login') {
        const proj = getCustomerProject();
        return (
            <Shell>
                <Header
                    icon={Cloud}
                    title="Cuenta en la nube"
                    subtitle="Entra con el correo y la clave de tu negocio. Solo se pide una vez; después la app trabaja sin internet."
                />
                <ErrorMsg msg={error} />
                <div className="space-y-3 mb-3">
                    <div className="relative">
                        <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                        <input
                            className={`${inputCls} pl-9`}
                            type="email"
                            placeholder="correo@negocio.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoCapitalize="none"
                            autoCorrect="off"
                        />
                    </div>
                    <div className="relative">
                        <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                        <input
                            className={`${inputCls} pl-9`}
                            type="password"
                            placeholder="Contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                        />
                    </div>
                </div>
                <button className={btnPrimary} onClick={handleLogin} disabled={busy || !email.trim() || !password}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Entrar
                </button>
                <button className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-3 flex items-center justify-center gap-1" onClick={handleUseAnotherCode}>
                    <ArrowLeft className="w-3 h-3" /> Usar otro código de licencia
                </button>
                {proj?.code && (
                    <p className="text-center text-[11px] text-slate-400 mt-2">Licencia {proj.code}</p>
                )}
            </Shell>
        );
    }

    if (state === 'limit') {
        const myId = getLocalDeviceId();
        return (
            <Shell>
                <Header
                    icon={Smartphone}
                    title="Límite de equipos"
                    subtitle={`Tu licencia cubre ${MAX_DEVICES_PER_ACCOUNT} equipos y ya están todos en uso. Libera uno para entrar en este.`}
                />
                <ErrorMsg msg={error} />
                <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                    {devices.filter((d) => !d.revoked).map((d) => (
                        <div
                            key={d.device_id}
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                        >
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                                    {d.alias || shortId(d.device_id)}
                                    {d.device_id === myId && (
                                        <span className="ml-1 text-[10px] font-bold text-sky-600 dark:text-sky-400">ESTE EQUIPO</span>
                                    )}
                                </p>
                                <p className="text-[11px] text-slate-400 font-mono">{shortId(d.device_id)}</p>
                            </div>
                            {d.device_id !== myId && (
                                <button
                                    className="shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                    onClick={() => handleRevoke(d.device_id)}
                                    disabled={busy}
                                    title="Liberar este equipo"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ))}
                    {devices.filter((d) => !d.revoked).length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-4">No se pudo listar los equipos.</p>
                    )}
                </div>
                <button className={btnGhost} onClick={handleUseAnotherCode} disabled={busy}>
                    <ArrowLeft className="w-4 h-4" /> Atrás
                </button>
            </Shell>
        );
    }

    // ready: el padre muestra el PIN local.
    return null;
}
