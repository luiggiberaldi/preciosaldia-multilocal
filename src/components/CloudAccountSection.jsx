/**
 * CloudAccountSection.jsx — "Cuenta en la nube" para Ajustes → Sistema.
 *
 * Versión simplificada (mockup aprobado 2026-09-30): solo entrar con email +
 * contraseña. Al entrar, este dispositivo se vincula solo a la cuenta del
 * dueño. Máximo 6 equipos por cuenta (tope en el servidor); al llegar al
 * tope se muestra el estado "Límite alcanzado".
 *
 * Al vincular, useCloudSync entra en "modo cuenta": este dispositivo lee los
 * datos de todas las sedes vinculadas y sus cambios se propagan a todos.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    Cloud, CloudOff, LogOut, RefreshCw, Smartphone,
    ChevronDown, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { showToast } from './Toast';
import {
    getOwnerSession,
    signInOwner,
    signOutOwner,
    getMyDevices,
    revokeDevice,
    getLocalDeviceId,
    isAccountLinkedLocally,
    MAX_DEVICES_PER_ACCOUNT,
} from '../services/cloudAccount';

const LIMIT_MESSAGE = `Límite de ${MAX_DEVICES_PER_ACCOUNT} equipos alcanzado. Revoca uno para liberar un cupo.`;

function shortId(id) {
    if (!id) return '—';
    return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function timeAgo(iso) {
    if (!iso) return 'nunca';
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'ahora mismo';
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    return `hace ${Math.floor(s / 86400)} d`;
}

const inputCls =
    'w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 ' +
    'rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 ' +
    'focus:border-sky-500 focus:outline-none';

const btnPrimary =
    'w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold ' +
    'transition-colors active:scale-[0.98] disabled:opacity-50';

const btnGhost =
    'w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 ' +
    'text-sm font-bold transition-colors active:scale-[0.98] disabled:opacity-50';

export default function CloudAccountSection() {
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState(null);
    const [fEmail, setFEmail] = useState('');
    const [fPass, setFPass] = useState('');
    const [busy, setBusy] = useState(false);
    const [limitHit, setLimitHit] = useState(false);
    const [devices, setDevices] = useState([]);
    const [linked, setLinked] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState(null); // {deviceId, alias}

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const { session } = await getOwnerSession();
            setEmail(session?.user?.email || null);
            setLinked(isAccountLinkedLocally());
            if (session?.user) {
                const r = await getMyDevices();
                if (r.ok) setDevices(r.devices);
            } else {
                setDevices([]);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const handleLogin = async () => {
        setBusy(true);
        setLimitHit(false);
        try {
            const r = await signInOwner(fEmail, fPass);
            if (r.ok) {
                showToast('Sesión iniciada. Este dispositivo quedó vinculado.', 'success');
                setFPass('');
                await refresh();
            } else if (r.limitReached) {
                setLimitHit(true);
            } else {
                showToast(r.error || 'Error', 'error');
            }
        } finally {
            setBusy(false);
        }
    };

    const handleLogout = async () => {
        setBusy(true);
        try {
            const r = await signOutOwner();
            if (r.ok) {
                showToast('Sesión cerrada', 'success');
                await refresh();
            } else {
                showToast('Error cerrando sesión', 'error');
            }
        } finally {
            setBusy(false);
        }
    };

    const confirmRevoke = async () => {
        if (!revokeTarget) return;
        setBusy(true);
        try {
            const r = await revokeDevice(revokeTarget.deviceId);
            if (r.ok) {
                showToast('Dispositivo revocado', 'success');
                setRevokeTarget(null);
                await refresh();
            } else {
                showToast(r.error || 'Error', 'error');
            }
        } finally {
            setBusy(false);
        }
    };

    const myDeviceId = getLocalDeviceId();
    const activeDevices = devices.filter(d => !d.revoked);
    const statusLabel = loading
        ? 'Cargando…'
        : (email ? `Conectado: ${email}` : (linked ? 'Vinculado' : 'Sin vincular'));

    return (
        <div className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <button
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
            >
                <div className={`p-2 rounded-lg ${email || linked ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-slate-200 dark:bg-slate-700'}`}>
                    {email || linked
                        ? <Cloud size={18} className="text-emerald-600" />
                        : <CloudOff size={18} className="text-slate-500" />}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Cuenta en la nube</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{statusLabel}</p>
                </div>
                <ChevronDown size={18} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>

            {expanded && (
                <div className="p-3 space-y-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-700">
                    {loading && <p className="text-xs text-slate-500">Cargando…</p>}

                    {!loading && !email && (
                        <div className="space-y-2">
                            {limitHit && (
                                <div className="flex items-start gap-2 p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl">
                                    <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                                    <p className="text-xs text-red-700 dark:text-red-300 font-semibold">{LIMIT_MESSAGE}</p>
                                </div>
                            )}
                            <input
                                className={inputCls}
                                type="email"
                                inputMode="email"
                                autoComplete="email"
                                placeholder="tu@email.com"
                                value={fEmail}
                                onChange={e => setFEmail(e.target.value)}
                            />
                            <input
                                className={inputCls}
                                type="password"
                                autoComplete="current-password"
                                placeholder="Contraseña"
                                value={fPass}
                                onChange={e => setFPass(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !busy) handleLogin(); }}
                            />
                            <button className={btnPrimary} disabled={busy} onClick={handleLogin}>
                                {busy ? 'Entrando…' : 'Entrar y vincular'}
                            </button>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                                La cuenta es del dueño. Al entrar, <b>este dispositivo</b> se vincula:
                                sus datos suben a la nube y recibe los de tus otras sedes.
                                Máximo {MAX_DEVICES_PER_ACCOUNT} equipos por cuenta.
                            </p>
                        </div>
                    )}

                    {!loading && email && (
                        <>
                            <div className="flex items-center gap-2 p-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/30 rounded-xl">
                                <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
                                <p className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold truncate">{email}</p>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                        Dispositivos vinculados ({activeDevices.length} de {MAX_DEVICES_PER_ACCOUNT})
                                    </p>
                                    <button onClick={refresh} className="p-1.5 text-slate-400 hover:text-slate-600" title="Actualizar">
                                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                                    </button>
                                </div>
                                {activeDevices.map(d => {
                                    const isMine = d.device_id === myDeviceId;
                                    return (
                                        <div key={d.device_id} className="flex items-center gap-2.5 p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                                            <Smartphone size={16} className="text-slate-400 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                                                    {d.alias || shortId(d.device_id)}
                                                    {isMine && <span className="ml-1.5 text-[10px] font-bold text-sky-600">ESTE</span>}
                                                </p>
                                                <p className="text-[10px] text-slate-500">activo {timeAgo(d.last_seen)}</p>
                                            </div>
                                            {!isMine && (
                                                <button
                                                    onClick={() => setRevokeTarget({ deviceId: d.device_id, alias: d.alias })}
                                                    className="text-[11px] font-bold text-red-500 hover:text-red-600 px-2 py-1"
                                                >
                                                    Revocar
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                                {activeDevices.length === 0 && (
                                    <p className="text-[11px] text-slate-500">No hay dispositivos registrados todavía.</p>
                                )}
                            </div>

                            <button className={btnGhost} disabled={busy} onClick={handleLogout}>
                                <span className="inline-flex items-center gap-2"><LogOut size={16} /> Cerrar sesión</span>
                            </button>
                        </>
                    )}
                </div>
            )}

            {revokeTarget && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
                    onClick={() => setRevokeTarget(null)}
                >
                    <div
                        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-2xl p-5 space-y-3"
                        onClick={e => e.stopPropagation()}
                    >
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">¿Revocar este equipo?</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            <b>{revokeTarget.alias || shortId(revokeTarget.deviceId)}</b> dejará de
                            sincronizar con tu cuenta al instante y liberará su cupo.
                            Podrás volver a vincularlo cuando quieras.
                        </p>
                        <div className="flex gap-2">
                            <button
                                className={btnGhost}
                                disabled={busy}
                                onClick={() => setRevokeTarget(null)}
                            >
                                Cancelar
                            </button>
                            <button
                                className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors active:scale-[0.98] disabled:opacity-50"
                                disabled={busy}
                                onClick={confirmRevoke}
                            >
                                {busy ? 'Revocando…' : 'Revocar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
