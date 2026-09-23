import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { supabaseCloud } from '../../config/supabaseCloud';
import { showToast } from '../Toast';
import { ensureSupervisorSession } from '../../services/supervisorAuth';
import { 
    QrCode, Trash2, KeyRound, Loader2, CheckCircle2, 
    Smartphone, ShieldAlert, RefreshCw, X 
} from 'lucide-react';

export default function PairingManager({ deviceId, triggerHaptic }) {
    const [pairingState, setPairingState] = useState('idle'); // 'idle', 'generating', 'show_qr', 'loading_status', 'paired'
    const [pairedDevice, setPairedDevice] = useState(null);
    const [token, setToken] = useState('');
    const [timeLeft, setTimeLeft] = useState(0);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [showConfirmUnpair, setShowConfirmUnpair] = useState(false);
    
    const canvasRef = useRef(null);
    const timerRef = useRef(null);
    const pollRef = useRef(null);
    const pairingSubscriptionRef = useRef(null);
    const pairingStateRef = useRef('idle');
    const pollingFailuresRef = useRef(0);

    useEffect(() => {
        pairingStateRef.current = pairingState;
    }, [pairingState]);

    // 1. Verificar estado de vinculación inicial
    const checkCurrentPairing = async () => {
        if (!supabaseCloud || !deviceId) return false;
        setCheckingStatus(true);
        try {
            const { session, error: sessionError } = await ensureSupervisorSession();
            if (sessionError || !session) {
                setPairedDevice(null);
                setPairingState('idle');
                return false;
            }

            const { data, error } = await supabaseCloud
                .from('device_pairings')
                .select('monitor_device_id, monitor_auth_id, paired_at, revoked_at, token_expires_at')
                .eq('primary_device_id', deviceId)
                .maybeSingle();

            if (error) throw error;

            if (data && data.monitor_device_id && data.monitor_auth_id && !data.revoked_at) {
                setPairedDevice(data.monitor_device_id);
                setPairingState('paired');
                return true;
            }

            setPairedDevice(null);
            setPairingState('idle');
            return false;
        } catch (err) {
            console.warn('[PairingManager] Fallo al verificar vinculación:', err);
            return false;
        } finally {
            setCheckingStatus(false);
        }
    };

    useEffect(() => {
        let disposed = false;

        const initializePairingStatus = async () => {
            await checkCurrentPairing();
            if (disposed || !supabaseCloud || !deviceId) return;

            const { session, error: sessionError } = await ensureSupervisorSession();
            if (sessionError || !session) return;

            const channel = supabaseCloud
                .channel(`pairing-status:${deviceId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'device_pairings',
                    filter: `primary_device_id=eq.${deviceId}`
                }, (payload) => {
                    const row = payload.new || payload.old;
                    const hasMonitor = payload.eventType !== 'DELETE'
                        && Boolean(row?.monitor_device_id || row?.monitor_auth_id)
                        && !row?.revoked_at;

                    if (hasMonitor) {
                        setPairedDevice(row.monitor_device_id || 'monitor');
                        setPairingState('paired');
                        return;
                    }

                    // Si el QR está abierto, conservarlo; si estaba vinculado,
                    // reflejar inmediatamente la desvinculación remota.
                    if (pairingStateRef.current === 'paired') {
                        setPairedDevice(null);
                        setToken('');
                        setPairingState('idle');
                    }
                })
                .subscribe((status) => {
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        pairingSubscriptionRef.current = null;
                    }
                });

            pairingSubscriptionRef.current = channel;
        };

        initializePairingStatus();

        return () => {
            disposed = true;
            clearInterval(timerRef.current);
            clearInterval(pollRef.current);
            const channel = pairingSubscriptionRef.current;
            pairingSubscriptionRef.current = null;
            if (channel) supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId]);

    // 2. Iniciar generación de QR
    const handleGenerateQR = async () => {
        if (!supabaseCloud || !deviceId) {
            showToast('Sin conexión a la nube', 'error');
            return;
        }

        triggerHaptic?.();
        setPairingState('generating');

        try {
            const { session, error: sessionError } = await ensureSupervisorSession();
            if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del dispositivo');

            const { data: generatedToken, error } = await supabaseCloud.rpc('generate_pairing_token', {
                p_device_id: deviceId
            });

            if (error) throw error;

            setToken(generatedToken);
            setPairingState('show_qr');
            setTimeLeft(300); // 5 minutos (300 segundos)
            pollingFailuresRef.current = 0;

            // Temporizador de expiración
            clearInterval(timerRef.current);
            timerRef.current = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev <= 1) {
                        clearInterval(timerRef.current);
                        clearInterval(pollRef.current);
                        setPairingState('idle');
                        setToken('');
                        showToast('El código QR ha expirado', 'warning');
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            // Polling para detectar cuando el monitor se vincule (cada 3 segundos)
            clearInterval(pollRef.current);
            pollRef.current = setInterval(async () => {
                try {
                    const { data, error: pollError } = await supabaseCloud
                        .from('device_pairings')
                        .select('monitor_device_id, monitor_auth_id, paired_at, revoked_at')
                        .eq('primary_device_id', deviceId)
                        .maybeSingle();

                    if (pollError) {
                        pollingFailuresRef.current += 1;
                        if (pollingFailuresRef.current >= 3) {
                            clearInterval(pollRef.current);
                            pollRef.current = null;
                            showToast('No se pudo confirmar el vínculo. Revisa la conexión e inténtalo de nuevo.', 'error');
                        }
                        return;
                    }

                    pollingFailuresRef.current = 0;
                    if (data?.monitor_device_id && data?.monitor_auth_id && !data.revoked_at) {
                        clearInterval(timerRef.current);
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                        triggerHaptic?.();
                        setPairedDevice(data.monitor_device_id);
                        setPairingState('paired');
                        showToast('¡Celular del supervisor vinculado con éxito!', 'success');
                    }
                } catch (e) {
                    pollingFailuresRef.current += 1;
                    if (pollingFailuresRef.current >= 3) {
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                    }
                }
            }, 3000);

        } catch (err) {
            console.error('[PairingManager] Error generando token:', err);
            showToast('Error al generar el token QR', 'error');
            setPairingState('idle');
        }
    };

    // 3. Dibujar código QR en Canvas localmente
    useEffect(() => {
        if (pairingState === 'show_qr' && token && canvasRef.current) {
            QRCode.toCanvas(
                canvasRef.current, 
                token, 
                { 
                    width: 180, 
                    margin: 1.5,
                    color: {
                        dark: '#1e293b', // slate-800
                        light: '#ffffff'
                    }
                }, 
                (err) => {
                    if (err) console.error('[PairingManager] QR canvas error:', err);
                }
            );
        }
    }, [pairingState, token]);

    // 4. Cancelar emparejamiento / Cerrar QR
    const handleCancelPairing = () => {
        triggerHaptic?.();
        clearInterval(timerRef.current);
        clearInterval(pollRef.current);
        setPairingState('idle');
        setToken('');
    };

    // 5. Desvincular monitor
    const handleUnpair = () => {
        triggerHaptic?.();
        setShowConfirmUnpair(true);
    };

    const handleUnpairConfirm = async () => {
        setShowConfirmUnpair(false);
        triggerHaptic?.();
        setCheckingStatus(true);

        try {
            const { session, error: sessionError } = await ensureSupervisorSession();
            if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del dispositivo');

            const { error } = await supabaseCloud.rpc('unpair_monitor', {
                p_device_id: deviceId
            });

            if (error) throw error;

            const stillPaired = await checkCurrentPairing();
            if (stillPaired) {
                throw new Error('El servidor aún reporta el vínculo activo');
            }
            setPairedDevice(null);
            setPairingState('idle');
            setToken('');
            showToast('Dispositivo desvinculado con éxito', 'success');
        } catch (err) {
            console.error('[PairingManager] Error al desvincular:', err);
            // Reconsultar el servidor para no dejar un estado visual obsoleto.
            await checkCurrentPairing();
            showToast('No se pudo confirmar la desvinculación', 'error');
        } finally {
            setCheckingStatus(false);
        }
    };

    const formatTimeLeft = (sec) => {
        const min = Math.floor(sec / 60);
        const s = sec % 60;
        return `${min}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div className="space-y-4">
            {checkingStatus && pairingState !== 'show_qr' ? (
                <div className="p-6 flex justify-center text-slate-400 gap-2 items-center">
                    <Loader2 className="animate-spin text-emerald-500" size={20} />
                    <span className="text-xs font-bold">Verificando estado de enlace...</span>
                </div>
            ) : pairingState === 'paired' ? (
                /* Estado: Vinculado */
                <div className="space-y-4">
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30 rounded-2xl flex gap-3 items-start">
                        <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="text-sm font-black text-emerald-800 dark:text-emerald-400">Celular del supervisor vinculado</h4>
                            <p className="text-[11px] text-emerald-700 dark:text-emerald-500 leading-normal mt-1">
                                Un dispositivo externo tiene acceso en tiempo real a las estadísticas y el inventario del negocio en modo solo lectura.
                            </p>
                        </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <Smartphone className="text-emerald-500" size={24} />
                            <div>
                                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 block">Celular Conectado</span>
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                                    Dispositivo en vivo (Modo Supervisor Activo)
                                </span>
                            </div>
                        </div>
                        
                        <button
                            onClick={handleUnpair}
                            className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-rose-500/15 active:scale-[0.97] transition-all"
                        >
                            <Trash2 size={14} />
                            <span>Desactivar Modo Supervisor (Desvincular)</span>
                        </button>
                    </div>
                </div>
            ) : pairingState === 'show_qr' ? (
                /* Estado: Mostrando QR */
                <div className="flex flex-col items-center justify-center p-6 border border-slate-200 dark:border-slate-700/50 rounded-3xl bg-slate-50/50 dark:bg-slate-900/10 space-y-4 relative">
                    <button 
                        onClick={handleCancelPairing}
                        className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X size={16} />
                    </button>

                    <div className="text-center space-y-1">
                        <h4 className="text-xs font-black text-slate-800 dark:text-white">Escanea para Vincular Celular</h4>
                        <p className="text-[10px] text-slate-400 font-bold">
                            Abre la app en el celular del supervisor, ve a "Modo Supervisor" y escanea.
                        </p>
                    </div>

                    {/* Contenedor del QR */}
                    <div className="p-3 bg-white border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
                        <canvas ref={canvasRef}></canvas>
                    </div>

                    {/* Código de Respaldo */}
                    <button 
                        onClick={() => {
                            if (!token) return;
                            navigator.clipboard.writeText(token);
                            triggerHaptic?.();
                            showToast('Código manual copiado', 'success');
                        }}
                        className="text-center space-y-1 hover:opacity-80 active:scale-95 transition-all group focus:outline-none block mx-auto"
                        title="Hacer clic para copiar"
                    >
                        <span className="text-[9px] uppercase tracking-wider font-black text-slate-400 group-hover:text-emerald-500 transition-colors flex items-center justify-center gap-1.5">
                            Código Manual
                            <span className="text-[8px] bg-slate-100 dark:bg-slate-800 text-slate-400 group-hover:bg-emerald-500/10 group-hover:text-emerald-500 px-1.5 py-0.5 rounded font-bold uppercase transition-all">Copiar</span>
                        </span>
                        <div className="text-2xl font-black tracking-widest text-slate-800 dark:text-white font-outfit select-all group-hover:text-emerald-500 transition-colors">
                            {token}
                        </div>
                    </button>

                    <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
                        <RefreshCw className="animate-spin text-emerald-500 shrink-0" size={10} />
                        <span>Esperando escaneo... Expira en {formatTimeLeft(timeLeft)}</span>
                    </div>
                </div>
            ) : (
                /* Estado: Idle / Generar QR */
                <div className="space-y-4">
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 rounded-2xl flex gap-3 items-start">
                        <QrCode className="text-slate-400 shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="text-xs font-black text-slate-700 dark:text-slate-200">Monitoreo Remoto por QR</h4>
                            <p className="text-[10px] text-slate-400 leading-normal mt-1">
                                Vincula el teléfono del supervisor para ver las ventas y productos en vivo. <strong>Nota: Requiere conexión a internet activa en ambos dispositivos.</strong>
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={handleGenerateQR}
                        disabled={pairingState === 'generating'}
                        className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:shadow-none transition-all"
                    >
                        {pairingState === 'generating' ? (
                            <>
                                <Loader2 className="animate-spin" size={16} />
                                <span>Generando código QR...</span>
                            </>
                        ) : (
                            <>
                                <QrCode size={16} />
                                <span>Vincular Celular del Supervisor</span>
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Modal de Confirmación de Desvinculación de Supervisor */}
            {showConfirmUnpair && (
                <div className="fixed inset-0 z-[250] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-5 animate-scale-in">
                        <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 rounded-2xl flex items-center justify-center text-rose-500 mx-auto">
                            <Trash2 size={22} />
                        </div>
                        <div className="space-y-1.5 text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">Desvincular Supervisor</h4>
                            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                                ¿Estás seguro de que deseas desvincular el celular del supervisor? Perderá el acceso de monitoreo en tiempo real a las transacciones de esta caja.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { triggerHaptic?.(); setShowConfirmUnpair(false); }}
                                className="flex-1 py-3 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleUnpairConfirm}
                                className="flex-1 py-3 px-4 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-500/20 transition-colors"
                            >
                                Desvincular
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
