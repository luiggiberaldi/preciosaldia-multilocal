import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from './Toast';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { ArrowLeft, Camera, ShieldAlert, KeyRound, Loader2, ArrowRight, SwitchCamera } from 'lucide-react';

const PAIRING_TOKEN_LENGTH = 24;

export default function PairingScanScreen({ onCancel, triggerHaptic }) {
    const [scanMethod, setScanMethod] = useState('camera'); // 'camera' o 'manual'
    const [manualCode, setManualCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [cameraState, setCameraState] = useState('idle'); // 'idle', 'requesting', 'active', 'permission_denied', 'error'
    const [cameras, setCameras] = useState([]);
    const [activeCamera, setActiveCamera] = useState(null); // Puede ser 'environment', 'user' o un ID de cámara string
    const scannerRef = useRef(null);
    const scanInFlightRef = useRef(false);
    const restartTimerRef = useRef(null);
    const startPromiseRef = useRef(null);
    const stopPromiseRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => () => {
        mountedRef.current = false;
        scanInFlightRef.current = false;
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
        stopScanning();
    }, []);

    // 1. Cargar cámaras disponibles e inicializar la cámara por defecto
    useEffect(() => {
        if (scanMethod !== 'camera') {
            setCameras([]);
            setActiveCamera(null);
            return;
        }

        const loadCameras = async () => {
            try {
                const devices = await Html5Qrcode.getCameras();
                setCameras(devices || []);
                if (devices && devices.length > 0) {
                    const backCamera = devices.find(device => {
                        const label = device.label.toLowerCase();
                        return label.includes('back') || 
                               label.includes('rear') || 
                               label.includes('trasera') || 
                               label.includes('environment') || 
                               label.includes('entorno') ||
                               label.includes('principal') ||
                               label.includes('main');
                    });
                    // Si se encuentra, usar ese ID. Si no, usar la última cámara (suele ser trasera en móviles)
                    const defaultCamera = backCamera ? backCamera.id : devices[devices.length - 1].id;
                    setActiveCamera(defaultCamera);
                } else {
                    setActiveCamera('environment'); // Fallback genérico
                }
            } catch (e) {
                console.warn('[PairingScanScreen] Error al listar cámaras:', e);
                setActiveCamera('environment'); // Fallback genérico
            }
        };

        loadCameras();
    }, [scanMethod]);

    // 2. Iniciar/Detener scanner según método y cámara activa
    useEffect(() => {
        if (scanMethod !== 'camera' || activeCamera === null) {
            stopScanning();
            return;
        }

        startScanning();

        return () => {
            stopScanning();
        };
    }, [scanMethod, activeCamera]);

    const startScanning = async () => {
        if (!mountedRef.current || scanMethod !== 'camera' || activeCamera === null) return;
        if (startPromiseRef.current) return startPromiseRef.current;

        const startPromise = (async () => {
            setCameraState('requesting');
            setErrorMsg('');

            try {
            // Esperar un tick de render para asegurar que el DOM de qr-reader-container exista
            await new Promise(resolve => setTimeout(resolve, 50));
            const container = document.getElementById('qr-reader-container');
            if (!container) return;

            if (scannerRef.current) {
                await stopScanning();
            }

            const html5QrCode = new Html5Qrcode("qr-reader-container");
            scannerRef.current = html5QrCode;

            const onScanSuccess = async (decodedText) => {
                if (scanInFlightRef.current || loading || !mountedRef.current) return;
                scanInFlightRef.current = true;
                triggerHaptic?.();
                
                // Detener scanner
                try {
                    await html5QrCode.stop();
                } catch (e) {}
                
                const cleanToken = decodedText.trim().toUpperCase();
                if (cleanToken.length === PAIRING_TOKEN_LENGTH) {
                    await executePairing(cleanToken);
                    scanInFlightRef.current = false;
                } else {
                    showToast('Formato de código QR inválido', 'error');
                    scanInFlightRef.current = false;
                    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
                    restartTimerRef.current = setTimeout(() => {
                        restartTimerRef.current = null;
                        if (mountedRef.current) startScanning();
                    }, 2000);
                }
            };

            const config = { 
                fps: 10, 
                qrbox: (width, height) => {
                    const size = Math.min(width, height) * 0.7;
                    return { width: size, height: size };
                },
                aspectRatio: 1.0
            };

            if (activeCamera === 'environment' || activeCamera === 'user') {
                await html5QrCode.start(
                    { facingMode: activeCamera },
                    config,
                    onScanSuccess,
                    () => {}
                );
            } else {
                await html5QrCode.start(
                    activeCamera,
                    config,
                    onScanSuccess,
                    () => {}
                );
            }

                if (mountedRef.current) setCameraState('active');
            } catch (err) {
                if (!mountedRef.current) return;
                console.error('[PairingScanScreen] Error al iniciar cámara:', err);
                const errStr = String(err).toLowerCase();
                const isPermissionError = errStr.includes('permission') ||
                                         errStr.includes('notallowederror') ||
                                         errStr.includes('denied');
                if (isPermissionError) {
                    setCameraState('permission_denied');
                } else {
                    setCameraState('error');
                    setErrorMsg('No se pudo acceder a la cámara. Revisa tu conexión o usa el código manual.');
                }
            } finally {
                startPromiseRef.current = null;
            }
        })();

        startPromiseRef.current = startPromise;
        return startPromise;
    };

    const stopScanning = async () => {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
        if (stopPromiseRef.current) return stopPromiseRef.current;

        const scanner = scannerRef.current;
        scannerRef.current = null;
        if (!scanner) return;

        const stopPromise = (async () => {
            try {
                if (scanner.isScanning) await scanner.stop();
            } catch (e) {
                console.warn('[PairingScanScreen] Error al detener scanner:', e);
            } finally {
                stopPromiseRef.current = null;
            }
        })();
        stopPromiseRef.current = stopPromise;
        return stopPromise;
    };

    const handleSwitchCamera = () => {
        triggerHaptic?.();
        if (cameras.length > 1) {
            const currentIndex = cameras.findIndex(c => c.id === activeCamera);
            const nextIndex = (currentIndex + 1) % cameras.length;
            setActiveCamera(cameras[nextIndex].id);
        } else {
            // Si la API no retornó múltiples cámaras, alternar entre restricciones genéricas de entorno
            setActiveCamera(prev => {
                if (prev === 'environment') return 'user';
                if (prev === 'user') return 'environment';
                // Si era un ID y queremos alternar, asumir que venía de la trasera y pasar a la frontal
                return 'user';
            });
        }
    };

    // Ejecutar el emparejamiento con el token
    const executePairing = async (token) => {
        if (loading) return;
        if (!supabaseCloud) {
            showToast('Sin conexión a la nube', 'error');
            scanInFlightRef.current = false;
            return;
        }
        setLoading(true);

        setErrorMsg('');

        try {
            const { session, error: sessionError } = await ensureSupervisorSession();
            if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del dispositivo');

            // Obtener el device_id local para mostrarlo en la relación del monitor.
            let monitorId = localStorage.getItem('pda_device_id');
            if (!monitorId) {
                // Generar uno de respaldo si por algún motivo no existe
                monitorId = 'mon_' + Math.random().toString(36).substring(2, 15);
                localStorage.setItem('pda_device_id', monitorId);
            }

            // Llamar al RPC en Supabase
            const { data, error } = await supabaseCloud.rpc('pair_monitor_device', {
                p_token: token.trim().toUpperCase(),
                p_monitor_device_id: monitorId
            });

            if (error) throw error;

            if (data && data.success) {
                // Éxito: Guardar credenciales de emparejamiento
                localStorage.setItem('pda_paired_device_id', data.primary_device_id);
                localStorage.setItem('pda_pairing_mode', 'monitor');
                showToast('¡Vinculado con éxito! Cargando monitor...', 'success');
                
                // Forzar reinicio de la app para cargar la nueva vista limpia
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                setErrorMsg(data?.message || 'Error desconocido al vincular.');
                startScanning(); // Volver a habilitar cámara
            }
        } catch (err) {
            console.error('[PairingScanScreen] Error al vincular:', err);
            setErrorMsg(err.message || 'Error de conexión con el servidor.');
            startScanning(); // Volver a habilitar cámara
        } finally {
            setLoading(false);
            scanInFlightRef.current = false;
        }
    };

    const handleManualSubmit = (e) => {
        e.preventDefault();
        if (manualCode.length !== PAIRING_TOKEN_LENGTH) {
            setErrorMsg(`El código debe tener exactamente ${PAIRING_TOKEN_LENGTH} caracteres.`);
            return;
        }
        executePairing(manualCode);
    };

    return (
        <div className="fixed inset-0 z-[300] bg-slate-50 dark:bg-slate-950 flex flex-col justify-between p-6 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between w-full max-w-md mx-auto">
                <button 
                    onClick={onCancel}
                    className="p-2.5 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 transition-colors"
                >
                    <ArrowLeft size={18} />
                </button>
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">Modo Supervisor</span>
                <div className="w-10"></div>
            </div>

            {/* Centro */}
            <div className="flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto my-8 space-y-6">
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white">Conectar a mi caja</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 px-4 leading-relaxed">
                        Escanea el código QR desde la pantalla de la caja de tu negocio para sincronizar los datos en tiempo real.
                    </p>
                </div>

                {/* Tabs de Selección de Método */}
                <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-2xl w-full">
                    <button
                        onClick={() => { triggerHaptic?.(); setScanMethod('camera'); setErrorMsg(''); }}
                        className={`flex-1 py-2 text-xs font-black rounded-xl transition-all duration-300 ${
                            scanMethod === 'camera' 
                                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        Escanear QR
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setScanMethod('manual'); setErrorMsg(''); }}
                        className={`flex-1 py-2 text-xs font-black rounded-xl transition-all duration-300 ${
                            scanMethod === 'manual' 
                                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        Código de vinculación
                    </button>
                </div>

                {/* Área de Cámara */}
                {scanMethod === 'camera' && (
                    <div className="w-full aspect-square bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden flex flex-col justify-center items-center relative group">
                        
                        {/* 1. Cargando / Solicitando Permiso */}
                        {cameraState === 'requesting' && (
                            <div className="absolute inset-0 bg-slate-50 dark:bg-slate-900 z-10 flex flex-col justify-center items-center text-center p-6 gap-3">
                                <Loader2 className="animate-spin text-emerald-500" size={32} />
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Accediendo a la cámara...</p>
                                <p className="text-[10px] text-slate-400">Por favor, presiona "Permitir" si tu navegador lo solicita.</p>
                            </div>
                        )}

                        {/* 2. Permiso Denegado / Bloqueado */}
                        {cameraState === 'permission_denied' && (
                            <div className="absolute inset-0 bg-slate-50 dark:bg-slate-900 z-10 flex flex-col justify-center items-center text-center p-6 gap-4">
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-500 rounded-full">
                                    <ShieldAlert size={28} />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-slate-800 dark:text-white">Permiso de cámara requerido</p>
                                    <p className="text-[10px] text-slate-400 leading-relaxed px-2">
                                        Has bloqueado el acceso a la cámara. Para activar los permisos directamente:
                                    </p>
                                </div>
                                <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-xl text-[10px] text-slate-500 dark:text-slate-400 text-left w-full space-y-1 font-medium leading-relaxed">
                                    <p className="font-bold text-slate-700 dark:text-slate-200">En el celular:</p>
                                    <p>1. Toca el ícono de <strong className="text-slate-800 dark:text-white">ajustes / candado</strong> al lado de la barra de dirección URL.</p>
                                    <p>2. Activa el interruptor de <strong className="text-slate-800 dark:text-white">Cámara</strong>.</p>
                                    <p>3. Recarga esta página.</p>
                                </div>
                                <button
                                    onClick={() => { triggerHaptic?.(); startScanning(); }}
                                    className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-[11px] rounded-xl active:scale-95 transition-transform flex items-center gap-1.5 shadow-md shadow-emerald-500/10"
                                >
                                    <Camera size={14} /> Reintentar Cámara
                                </button>
                            </div>
                        )}

                        {/* 3. Cargando Vinculación (cuando el QR es leído) */}
                        {loading && (
                            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-10 flex flex-col justify-center items-center text-white gap-2">
                                <Loader2 className="animate-spin text-emerald-400" size={32} />
                                <span className="text-xs font-black">Vinculando...</span>
                            </div>
                        )}

                        {/* Contenedor del Feed de Cámara */}
                        <div id="qr-reader-container" className="w-full h-full [&_video]:object-cover [&_video]:w-full [&_video]:h-full [&_video]:rounded-3xl"></div>

                        {/* Botón flotante para cambiar de cámara (se muestra siempre que esté activa) */}
                        {cameraState === 'active' && (
                            <button
                                type="button"
                                onClick={handleSwitchCamera}
                                className="absolute bottom-4 right-4 z-20 p-3 bg-white/90 hover:bg-white dark:bg-slate-800/90 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-full border border-slate-200/50 dark:border-slate-700/50 active:scale-90 transition-all flex items-center justify-center shadow-lg backdrop-blur-md"
                                title="Cambiar Cámara"
                            >
                                <SwitchCamera size={20} />
                            </button>
                        )}
                    </div>
                )}

                {/* Área Manual */}
                {scanMethod === 'manual' && (
                    <form onSubmit={handleManualSubmit} className="w-full bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-6 rounded-3xl shadow-sm space-y-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Código de vinculación</label>
                            <input 
                                type="text"
                                maxLength={PAIRING_TOKEN_LENGTH}
                                value={manualCode}
                                onChange={(e) => setManualCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                                placeholder="Escribe el código de vinculación"
                                className={`w-full py-3.5 px-4 border border-slate-200 dark:border-slate-700/60 dark:bg-slate-800 rounded-2xl text-center focus:outline-none focus:border-emerald-500 transition-all ${
                                    manualCode 
                                        ? 'text-xl font-black uppercase tracking-widest text-slate-800 dark:text-white' 
                                        : 'text-xs font-bold text-slate-400 placeholder-slate-400'
                                }`}
                                disabled={loading}
                            />
                        </div>

                        <button 
                            type="submit" 
                            disabled={loading || manualCode.length !== PAIRING_TOKEN_LENGTH}
                            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:shadow-none transition-all"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin" size={16} />
                                    <span>Vinculando...</span>
                                </>
                            ) : (
                                <>
                                    <span>Vincular Dispositivo</span>
                                    <ArrowRight size={16} />
                                </>
                            )}
                        </button>
                    </form>
                )}

                {/* Mensaje de Error */}
                {errorMsg && (
                    <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800/30 rounded-2xl flex gap-3 items-start w-full">
                        <ShieldAlert className="text-rose-500 shrink-0 mt-0.5" size={18} />
                        <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 leading-normal">
                            {errorMsg}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="text-center max-w-xs mx-auto">
                <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                    El código de vinculación se muestra en el dispositivo principal debajo del código QR de emparejamiento y expira en pocos minutos.
                </p>
            </div>
        </div>
    );
}
