import React, { useState, useEffect } from 'react';
import { supabase } from '../../core/supabaseClient';
import { showToast } from '../Toast';
import { 
    Smartphone, Monitor, Wifi, WifiOff, CheckCircle2, 
    Shield, Clock, RefreshCw, Copy, Check, Lock, Zap
} from 'lucide-react';

const PRODUCT_ID = 'bodega';

export default function DevicesManager({ triggerHaptic, currentDeviceId }) {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [copiedId, setCopiedId] = useState(null);

    const fetchDevices = async () => {
        if (!supabase || !import.meta.env.VITE_SUPABASE_URL) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('licenses')
                .select('*')
                .eq('product_id', PRODUCT_ID)
                .order('updated_at', { ascending: false, nullsFirst: false });

            if (error) throw error;
            setDevices(data || []);
        } catch (err) {
            console.warn('[DevicesManager] Error al obtener dispositivos:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDevices();

        // Suscripción Realtime para actualizar la lista cuando se abra un nuevo dispositivo o cambie el estado
        if (!supabase || !import.meta.env.VITE_SUPABASE_URL) return;

        const channel = supabase
            .channel('realtime_devices_list')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'licenses', filter: `product_id=eq.${PRODUCT_ID}` },
                () => {
                    fetchDevices();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const handleCopyId = (id) => {
        triggerHaptic?.();
        navigator.clipboard.writeText(id).then(() => {
            setCopiedId(id);
            showToast('ID de dispositivo copiado', 'info');
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const isDeviceOnline = (updatedAtStr) => {
        if (!updatedAtStr) return false;
        const lastSeen = new Date(updatedAtStr).getTime();
        const now = Date.now();
        return (now - lastSeen) <= 10 * 60 * 1000; // Visto en los últimos 10 minutos
    };

    const formatLastSeen = (updatedAtStr) => {
        if (!updatedAtStr) return 'Sin fecha';
        const diffMs = Date.now() - new Date(updatedAtStr).getTime();
        const mins = Math.floor(diffMs / (1000 * 60));
        if (mins < 1) return 'Hace un momento';
        if (mins < 60) return `Hace ${mins} m`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `Hace ${hours} h`;
        const days = Math.floor(hours / 24);
        return `Hace ${days} d`;
    };

    const getLicenseBadge = (item) => {
        if (!item.is_active || item.type === 'revoked') {
            return (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 flex items-center gap-1">
                    <Lock size={10} /> Sin Licencia
                </span>
            );
        }
        if (item.type === 'permanent') {
            return (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 flex items-center gap-1">
                    <Zap size={10} /> Permanente
                </span>
            );
        }
        if (item.type === 'monthly') {
            return (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/40 flex items-center gap-1">
                    <Shield size={10} /> Mensual
                </span>
            );
        }
        if (item.type === 'demo7' || item.type === 'demo3') {
            return (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 flex items-center gap-1">
                    <Clock size={10} /> Demo ({item.type === 'demo7' ? '7d' : '3d'})
                </span>
            );
        }
        return (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500">
                Registrado
            </span>
        );
    };

    return (
        <div className="space-y-4">
            {/* Header / Refresh */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Smartphone size={16} className="text-brand" />
                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                        Terminales Detectados ({devices.length})
                    </span>
                </div>
                <button
                    onClick={() => { triggerHaptic?.(); fetchDevices(); }}
                    disabled={loading}
                    className="p-1.5 text-slate-400 hover:text-brand hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all"
                    title="Actualizar lista"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* List */}
            {loading && devices.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs font-bold animate-pulse">
                    Detectando dispositivos...
                </div>
            ) : devices.length === 0 ? (
                <div className="py-8 text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-4">
                    <Smartphone size={24} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">No hay dispositivos registrados aún</p>
                    <p className="text-[10px] text-slate-400 mt-1">Cualquier equipo que abra la app aparecerá automáticamente aquí.</p>
                </div>
            ) : (
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {devices.map((dev) => {
                        const online = isDeviceOnline(dev.updated_at);
                        const isThisDevice = dev.device_id === currentDeviceId;

                        return (
                            <div
                                key={dev.device_id}
                                className={`p-3.5 rounded-2xl border transition-all ${
                                    isThisDevice
                                        ? 'bg-brand-light/40 dark:bg-brand/10 border-brand/40'
                                        : 'bg-slate-50/60 dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    {/* Info Left */}
                                    <div className="flex items-start gap-3 min-w-0">
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                                            online ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200/60 dark:bg-slate-800 text-slate-400'
                                        }`}>
                                            {isThisDevice ? <Monitor size={18} /> : <Smartphone size={18} />}
                                        </div>

                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-xs font-black text-slate-800 dark:text-white truncate">
                                                    {dev.client_name || 'Terminal Sin Nombre'}
                                                </p>
                                                {isThisDevice && (
                                                    <span className="text-[9px] font-black uppercase tracking-wider bg-brand text-white px-1.5 py-0.2 rounded-full">
                                                        Este Equipo
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 mt-1">
                                                <p className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[150px] sm:max-w-[220px]">
                                                    ID: {dev.device_id}
                                                </p>
                                                <button
                                                    onClick={() => handleCopyId(dev.device_id)}
                                                    className="text-slate-400 hover:text-brand transition-colors p-0.5"
                                                    title="Copiar Device ID"
                                                >
                                                    {copiedId === dev.device_id ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                                                </button>
                                            </div>

                                            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
                                                <span className="flex items-center gap-1 font-bold">
                                                    {online ? (
                                                        <><Wifi size={11} className="text-emerald-500 animate-pulse" /> <span className="text-emerald-600 dark:text-emerald-400">En Línea</span></>
                                                    ) : (
                                                        <><WifiOff size={11} className="text-slate-400" /> <span>Desconectado</span></>
                                                    )}
                                                </span>
                                                <span>· {formatLastSeen(dev.updated_at)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Badge Right */}
                                    <div className="shrink-0">
                                        {getLicenseBadge(dev)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
