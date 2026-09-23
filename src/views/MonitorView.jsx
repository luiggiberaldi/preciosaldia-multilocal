import React, { useState, useRef } from 'react';
import { showToast } from '../components/Toast';
import { RefreshCw, TrendingUp, TrendingDown, WifiOff, Clock, Maximize, Minimize, Camera, Loader2, AlertTriangle, Sun, Moon } from 'lucide-react';
import html2canvas from 'html2canvas';

export default function MonitorView({ rates: propRates, loading, isOffline, onRefresh, toggleTheme, theme, copyLogs, addLog, triggerHaptic, onClose }) {

    const rates = {
        bcv: { price: 0, change: 0, source: 'BCV Oficial', ...propRates?.bcv },
        euro: { price: 0, change: 0, source: 'Euro BCV', ...propRates?.euro },
        usdt: { price: 0, change: 0, source: 'Paralelo / Binance', ...propRates?.usdt },
        lastUpdate: propRates?.lastUpdate ?? null
    };

    const [secretCount, setSecretCount] = useState(0);

    // Referencia al contenedor del Kiosco (para la foto)
    const kioskRef = useRef(null);

    // Detección de Datos Viejos (> 4 Horas)
    const isOldData = (() => {
        if (!rates || !rates.lastUpdate) return false;
        const diff = new Date() - new Date(rates.lastUpdate);
        return diff > 4 * 60 * 60 * 1000; // 4 Hours
    })();

    // SEC-023: el "debug secreto" (7 clics en el logo para copiar logs) solo
    // está disponible en desarrollo. En producción el handler se vuelve no-op
    // para evitar que cualquier usuario final (o atacante con acceso físico)
    // acceda a logs internos o datos de diagnóstico.
    const handleSecretDebug = () => {
        if (!import.meta.env.DEV) return;
        triggerHaptic && triggerHaptic();
        const newCount = secretCount + 1;
        setSecretCount(newCount);
        if (newCount === 7) {
            copyLogs && copyLogs();
            setSecretCount(0);
        }
        if (newCount === 1) setTimeout(() => setSecretCount(0), 2000);
    };

    const formatVES = (amount) => {
        return new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 }).format(Math.ceil(amount));
    };

    // Formato exacto para tasas (2 decimales, sin redondeo hacia arriba)
    const formatExactRate = (amount) => {
        return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    };

    // --- SKELETON LOADING (Carga inicial adaptado a Kiosco) ---
    if (loading && (!rates || !rates.bcv || rates.bcv.price === 0)) {
        return (
            <div className="fixed inset-0 z-[100] bg-slate-50 flex flex-col justify-between items-center p-6 animate-pulse overflow-hidden">
                <style>{`
                  .font-outfit { font-family: 'Outfit', sans-serif; }
                `}</style>
                
                {/* Glow de fondo suave */}
                <div className="bg-gradient-to-tr from-emerald-100/40 via-transparent to-teal-50/60 blur-[120px] pointer-events-none absolute inset-0"></div>

                {/* Encabezado Kiosco Skeleton */}
                <div className="flex flex-col items-center mt-12 gap-2 relative z-10 w-full">
                    <div className="h-16 w-48 bg-slate-200 border border-slate-300 rounded-2xl"></div>
                    <div className="h-4 w-32 bg-slate-200 border border-slate-300 rounded-lg mt-1"></div>
                    <div className="h-8 w-44 bg-slate-200 border border-slate-300 rounded-full mt-3"></div>
                </div>
                
                {/* PRECIO GIGANTE Skeleton */}
                <div className="flex flex-col items-center justify-center -mt-8 relative z-10 w-full">
                    <div className="h-24 w-64 bg-slate-200 border border-slate-300 rounded-3xl"></div>
                    <div className="h-4 w-48 bg-slate-200 border border-slate-300 rounded-lg mt-4"></div>
                </div>
                
                {/* Tarjetas Informativas Skeleton */}
                <div className="w-full max-w-md rounded-[2.5rem] border border-slate-200 p-6 sm:p-8 flex gap-4 justify-between items-center mb-8 relative z-10 bg-white/50 backdrop-blur-sm">
                    <div className="flex-1 flex flex-col items-center gap-2">
                        <div className="h-3 w-16 bg-slate-200 rounded"></div>
                        <div className="h-8 w-24 bg-slate-200 rounded-xl"></div>
                    </div>
                    <div className="w-[1px] h-12 bg-slate-200"></div>
                    <div className="flex-1 flex flex-col items-center gap-2">
                        <div className="h-3 w-16 bg-slate-200 rounded"></div>
                        <div className="h-8 w-24 bg-slate-200 rounded-xl"></div>
                    </div>
                    <div className="w-[1px] h-12 bg-slate-200"></div>
                    <div className="flex-1 flex flex-col items-center gap-2">
                        <div className="h-3 w-16 bg-slate-200 rounded"></div>
                        <div className="h-8 w-24 bg-slate-200 rounded-xl"></div>
                    </div>
                </div>
                
                {/* Pie de página Skeleton */}
                <div className="flex flex-col items-center gap-2 mb-8 w-full relative z-10">
                    <div className="h-6 w-36 bg-slate-200 border border-slate-300 rounded-lg"></div>
                    <div className="h-4 w-28 bg-slate-200 border border-slate-300 rounded-lg mt-1"></div>
                </div>
            </div>
        );
    }

    const priceStr = formatExactRate(rates.bcv.price);
    const [integers, decimals] = priceStr.split(',');

    return (
        <div
            ref={kioskRef}
            className="fixed inset-0 z-[100] bg-slate-50 text-slate-900 flex flex-col justify-between items-center p-6 animate-in zoom-in duration-300 overflow-hidden"
        >
            <style>{`
              .font-outfit { font-family: 'Outfit', sans-serif; }
              .font-dm-mono { font-family: 'DM Mono', monospace; }
            `}</style>
            
            {/* Glow de fondo suave */}
            <div className="bg-gradient-to-tr from-emerald-100/60 via-transparent to-teal-50/80 blur-[120px] pointer-events-none absolute inset-0"></div>

            {/* Botón Salir */}
            {onClose && (
                <button
                    data-hide-on-capture
                    onClick={() => { triggerHaptic && triggerHaptic(); onClose(); }}
                    className="absolute top-6 right-6 p-3 bg-slate-100 border border-slate-200 rounded-full text-slate-500 hover:text-slate-800 transition-colors z-20 active:scale-95 shadow-sm"
                >
                    <Minimize size={24} />
                </button>
            )}

            {/* Encabezado Kiosco */}
            <div className="flex flex-col items-center mt-12 gap-2 relative z-10">
                <button onClick={handleSecretDebug} className="active:scale-95 transition-transform outline-none">
                    <img src="./logo.png" alt="PreciosAlDía" className="h-20 w-auto object-contain drop-shadow-sm" />
                </button>
                <p className="text-slate-700 text-sm font-medium -mt-2 font-outfit">Actualizado donde vayas</p>
                <div className="bg-white/80 px-4 py-1.5 rounded-full border border-slate-200 backdrop-blur-md shadow-sm mt-2">
                    <p className="text-[10px] font-bold text-slate-500 tracking-[0.25em] uppercase font-outfit">MONITOR EN TIEMPO REAL</p>
                </div>
            </div>

            {/* PRECIO GIGANTE */}
            <div className="flex flex-col items-center justify-center -mt-8 relative z-10">
                <div className="flex items-baseline font-dm-mono select-none">
                    <span className="text-4xl sm:text-5xl text-slate-400 font-bold self-start mt-2 mr-3">$</span>
                    <h1 className="text-[16vw] sm:text-[9rem] font-bold leading-none tracking-tighter text-slate-900">
                        {integers}
                    </h1>
                    <span className="text-5xl sm:text-7xl font-bold text-emerald-500 leading-none">
                        ,{decimals}
                    </span>
                    <span className="text-2xl sm:text-3xl font-bold text-slate-400 ml-4">Bs</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 font-dm-mono tracking-widest mt-4 uppercase">Valor del Dólar BCV Oficial</p>
            </div>

            {/* Tarjetas Informativas */}
            <div 
                className={`w-full max-w-sm sm:max-w-md rounded-[2rem] sm:rounded-[2.5rem] border border-slate-200/80 p-4 sm:p-6 md:p-8 grid ${rates.usdt.price > 0 ? 'grid-cols-3' : 'grid-cols-2'} gap-1 sm:gap-2 mb-8 relative z-10 shadow-sm`}
                style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(10px)' }}
            >
                <div className="text-center w-full border-r border-slate-200/80 pr-1 sm:pr-2">
                    <p className="text-[10px] sm:text-xs font-bold uppercase text-slate-500 tracking-wider mb-2 font-outfit truncate">BCV DÓLAR</p>
                    <p className="text-lg sm:text-xl md:text-2xl font-dm-mono font-bold text-slate-900 truncate">{formatExactRate(rates.bcv.price)}</p>
                </div>
                <div className={`text-center w-full px-1 sm:px-2 ${rates.usdt.price > 0 ? 'border-r border-slate-200/80' : ''}`}>
                    <p className="text-[10px] sm:text-xs font-bold uppercase text-slate-500 tracking-wider mb-2 font-outfit truncate">BCV EURO</p>
                    <p className="text-lg sm:text-xl md:text-2xl font-dm-mono font-bold text-slate-900 truncate">{formatExactRate(rates.euro.price)}</p>
                </div>
                {rates.usdt.price > 0 && (
                    <div className="text-center w-full pl-1 sm:pl-2">
                        <p className="text-[10px] sm:text-xs font-bold uppercase text-amber-600 tracking-wider mb-2 font-outfit truncate">USDT</p>
                        <p className="text-lg sm:text-xl md:text-2xl font-dm-mono font-bold text-slate-900 truncate">{formatExactRate(rates.usdt.price)}</p>
                    </div>
                )}
            </div>

            {/* Pie de página + Botón Actualizar */}
            <div className="flex flex-col items-center gap-6 mb-8 w-full relative z-10 font-outfit">
                <div className="text-center">
                    <p className="text-lg font-bold text-emerald-600">
                        {rates.lastUpdate ? new Date(rates.lastUpdate).toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' }) : '---'}
                    </p>
                    <p className="text-sm font-dm-mono text-slate-500 mt-1">
                        Actualizado: {rates.lastUpdate ? new Date(rates.lastUpdate).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--'}
                    </p>
                </div>

                {onRefresh && (
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); onRefresh(); }}
                        disabled={loading}
                        className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-3 rounded-full font-bold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all text-sm"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        <span>{loading ? 'Actualizando...' : 'Actualizar Tasas'}</span>
                    </button>
                )}
            </div>
        </div>
    );
}
