/**
 * SettingsTabEquipos.jsx — Panel de equipos vinculados.
 *
 * Reemplaza la pestaña "Licencia": muestra los equipos asociados a la cuenta
 * (los que se activaron con el código), permite ver sus nombres y desvincularlos.
 * El código de licencia se muestra arriba como referencia.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Smartphone, Trash2, Loader2, KeyRound, AlertTriangle } from 'lucide-react';
import {
    getMyDevices,
    revokeDevice,
    getLocalDeviceId,
    MAX_DEVICES_PER_ACCOUNT,
} from '../../../services/cloudAccount.js';
import { getCustomerProject } from '../../../config/supabaseCloud.js';
import { showToast } from '../../Toast';

function shortId(id) {
    if (!id) return '—';
    return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export default function SettingsTabEquipos() {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState('');
    const myId = getLocalDeviceId();
    const project = getCustomerProject();

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        const res = await getMyDevices();
        setLoading(false);
        if (res.ok) {
            setDevices(res.devices || []);
        } else {
            setError(res.error || 'No se pudieron cargar los equipos.');
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleUnlink = async (deviceId) => {
        if (deviceId === myId) {
            showToast('No puedes desvincular este equipo desde aquí', 'error');
            return;
        }
        if (!window.confirm('¿Desvincular este equipo? Dejará de sincronizar.')) return;
        setBusyId(deviceId);
        const res = await revokeDevice(deviceId);
        setBusyId(null);
        if (res.ok) {
            showToast('Equipo desvinculado', 'success');
            load();
        } else {
            showToast(res.error || 'No se pudo desvincular', 'error');
        }
    };

    const active = devices.filter((d) => !d.revoked);

    return (
        <div className="space-y-4">
            {/* Código de licencia */}
            {project?.code && (
                <div className="flex items-center gap-3 p-3 bg-brand/5 border border-brand/20 rounded-2xl">
                    <KeyRound className="w-5 h-5 text-brand shrink-0" />
                    <div>
                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Código de licencia</p>
                        <p className="font-mono font-black text-brand text-lg">{project.code}</p>
                    </div>
                </div>
            )}

            {/* Contador */}
            <p className="text-sm text-slate-500 dark:text-slate-400">
                <span className="font-black text-slate-800 dark:text-slate-100">{active.length}</span>
                {' '}de {MAX_DEVICES_PER_ACCOUNT} equipos vinculados
            </p>

            {loading && (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-brand" />
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {!loading && !error && (
                <div className="space-y-2">
                    {active.map((d) => (
                        <div
                            key={d.device_id}
                            className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-xl shrink-0">
                                    <Smartphone className="w-5 h-5 text-slate-500" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">
                                        {d.alias || 'Equipo sin nombre'}
                                        {d.device_id === myId && (
                                            <span className="ml-2 text-[10px] font-black uppercase tracking-wide text-brand bg-brand/10 px-2 py-0.5 rounded-full">Este equipo</span>
                                        )}
                                    </p>
                                    <p className="text-xs text-slate-400 font-mono">{shortId(d.device_id)}</p>
                                </div>
                            </div>
                            {d.device_id !== myId && (
                                <button
                                    onClick={() => handleUnlink(d.device_id)}
                                    disabled={busyId === d.device_id}
                                    className="shrink-0 p-2 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                    title="Desvincular equipo"
                                >
                                    {busyId === d.device_id
                                        ? <Loader2 className="w-5 h-5 animate-spin" />
                                        : <Trash2 className="w-5 h-5" />}
                                </button>
                            )}
                        </div>
                    ))}
                    {active.length === 0 && (
                        <p className="text-sm text-slate-400 text-center py-6">No hay equipos vinculados.</p>
                    )}
                </div>
            )}

            <p className="text-xs text-slate-400 leading-relaxed">
                Los equipos se vinculan automáticamente al activar la app con el código de licencia.
                Al desvincular un equipo, dejará de sincronizar con la nube.
            </p>
        </div>
    );
}
