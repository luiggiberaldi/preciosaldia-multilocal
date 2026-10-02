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
    CloudOff, Mail, Lock, Loader2, AlertTriangle,
    Trash2, ArrowLeft, Check,
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

const inputBase =
    'w-full px-3 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 ' +
    'rounded-2xl text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 ' +
    'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition';

const inputCode =
    'w-full px-3 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ' +
    'rounded-2xl text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 ' +
    'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition ' +
    'uppercase tracking-[0.2em] text-center font-mono';

const inputIconCls = 'w-4 h-4 absolute left-3.5 top-3.5 text-slate-400 pointer-events-none';

const btnPrimary =
    'w-full py-3 rounded-2xl bg-brand hover:bg-brand-dark text-white text-sm font-extrabold ' +
    'transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ' +
    'flex items-center justify-center gap-2 shadow-lg shadow-brand/25';

const btnGhost =
    'w-full py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 ' +
    'text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ' +
    'flex items-center justify-center gap-2';

function Shell({ children }) {
    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans relative overflow-hidden">
            <div className="absolute -top-[30%] -left-[15%] w-[600px] h-[600px] bg-brand/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute -bottom-[30%] -right-[15%] w-[600px] h-[600px] bg-teal-400/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-7">
                {children}
            </div>
        </div>
    );
}

function BrandHeader() {
    return (
        <div className="flex flex-col items-center mb-5">
            <img
                src="./logo.png"
                alt="PreciosAlDía"
                className="h-11 w-auto object-contain mb-2"
            />
            <span
                className="rounded-full px-4 py-1 text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#2b2113] shadow-[0_4px_14px_rgba(201,150,46,0.45)]"
                style={{ background: 'linear-gradient(135deg, #E7C65A 0%, #C9962E 100%)' }}
            >
                Pro
            </span>
        </div>
    );
}

function Steps({ step }) {
    const pillOn = 'flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-1.5 rounded-full bg-brand/10 text-brand border border-brand/30';
    const pillOff = 'flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700';
    const pillDone = 'flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30';
    const nOn = 'w-4 h-4 rounded-full bg-brand text-white text-[10px] font-black flex items-center justify-center';
    const nOff = 'w-4 h-4 rounded-full bg-slate-300 dark:bg-slate-600 text-white text-[10px] font-black flex items-center justify-center';
    const codeDone = step === 'login';
    return (
        <div className="flex items-center justify-center gap-2 mb-6">
            <span className={codeDone ? pillDone : pillOn}>
                {codeDone ? <Check className="w-3 h-3" /> : <span className={nOn}>1</span>}
                Código
            </span>
            <span className="w-6 h-px bg-slate-200 dark:bg-slate-700" />
            <span className={step === 'login' ? pillOn : pillOff}>
                <span className={step === 'login' ? nOn : nOff}>2</span>
                Cuenta
            </span>
        </div>
    );
}

function Title({ title, subtitle }) {
    return (
        <div className="text-center mb-5">
            <h1 className="text-xl font-black text-slate-800 dark:text-slate-100">{title}</h1>
            {subtitle && (
                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{subtitle}</p>
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
    const [deviceName, setDeviceName] = useState('');
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
        const res = await signInOwner(email, password, deviceName.trim() || null);
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
    }, [email, password, deviceName, onReady]);

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
        } else {
            // B-1 (2026-10-01): antes el fallo quedaba en silencio (spinner
            // apagado sin mensaje). Se muestra el error para reintentar.
            setError(reg.error || 'No se pudo registrar este equipo. Inténtalo de nuevo.');
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
                <div className="flex flex-col items-center py-10">
                    <Loader2 className="w-8 h-8 text-brand animate-spin mb-3" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Verificando…</p>
                </div>
            </Shell>
        );
    }

    if (state === 'code') {
        return (
            <Shell>
                <BrandHeader />
                <Steps step="code" />
                <Title
                    title="Activa tu licencia"
                    subtitle={<>Ingresa el código que recibiste al comprar.<br />Solo se pide una vez.</>}
                />
                <ErrorMsg msg={error} />
                <input
                    className={`${inputCode} mb-4`}
                    placeholder="LIC-XXXXXX"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleCode()}
                    autoCapitalize="characters"
                    autoCorrect="off"
                />
                <button className={btnPrimary} onClick={handleCode} disabled={busy || !code.trim()}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Verificar código
                </button>
                <p className="text-center text-[11px] text-slate-400 mt-4">
                    ¿No tienes código? Escríbenos al <span className="text-brand font-bold">0412 405 1793</span>
                </p>
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
                <BrandHeader />
                <Steps step="login" />
                <Title
                    title="Cuenta en la nube"
                    subtitle={<>Entra con el correo y la clave de tu negocio.<br />Solo se pide una vez; después la app trabaja sin internet.</>}
                />
                <ErrorMsg msg={error} />
                <div className="space-y-3 mb-4">
                    <div className="relative">
                        <Mail className={inputIconCls} />
                        <input
                            className={`${inputBase} pl-10`}
                            type="email"
                            placeholder="correo@negocio.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoCapitalize="none"
                            autoCorrect="off"
                        />
                    </div>
                    <div className="relative">
                        <Lock className={inputIconCls} />
                        <input
                            className={`${inputBase} pl-10`}
                            type="password"
                            placeholder="Contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                        />
                    </div>
                    <div className="relative">
                        <input
                            className={inputBase}
                            type="text"
                            placeholder="Nombre de este equipo (ej: Caja 1)"
                            value={deviceName}
                            onChange={(e) => setDeviceName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                            autoCapitalize="words"
                        />
                    </div>
                </div>
                <button className={btnPrimary} onClick={handleLogin} disabled={busy || !email.trim() || !password}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Entrar
                </button>
                {proj?.code && (
                    <div className="flex items-center justify-center gap-2 mt-4 text-[11px] text-slate-400">
                        <span>Licencia</span>
                        <code className="font-mono font-bold text-brand bg-brand/10 border border-brand/20 rounded-full px-2.5 py-0.5">
                            {proj.code}
                        </code>
                    </div>
                )}
                <button className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-3 flex items-center justify-center gap-1" onClick={handleUseAnotherCode}>
                    <ArrowLeft className="w-3 h-3" /> Usar otro código de licencia
                </button>
            </Shell>
        );
    }

    if (state === 'limit') {
        const myId = getLocalDeviceId();
        return (
            <Shell>
                <BrandHeader />
                <Title
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
                                        <span className="ml-1 text-[10px] font-bold text-brand">ESTE EQUIPO</span>
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
