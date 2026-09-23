// ============================================================
// 🔔 TOAST — Premium notification system
// Replaces native alert() with styled toast notifications
// ============================================================

import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
};

const COLORS = {
    success: {
        bg: 'bg-emerald-950/90 border-emerald-700/40',
        icon: 'text-emerald-400',
        bar: 'bg-emerald-500',
    },
    error: {
        bg: 'bg-rose-950/90 border-rose-700/40',
        icon: 'text-rose-400',
        bar: 'bg-rose-500',
    },
    warning: {
        bg: 'bg-amber-950/90 border-amber-700/40',
        icon: 'text-amber-400',
        bar: 'bg-amber-500',
    },
    info: {
        bg: 'bg-slate-800/90 border-slate-600/40',
        icon: 'text-brand',
        bar: 'bg-brand',
    },
};

let _globalToast = null;

/** Usage anywhere: showToast('Mensaje', 'success') */
export function showToast(message, type = 'info', duration = 3000) {
    _globalToast?.(message, type, duration);
}

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    // HOOK-032: Track de timeout IDs para limpiarlos en unmount y evitar
    // setStates después del unmount (warning React) y memory leaks.
    const timeoutsRef = useRef([]);

    const addToast = useCallback((message, type = 'info', duration = 3000) => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev.slice(-4), { id, message, type, duration }]);

        if (duration > 0) {
            const tid = setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
                // Auto-remove del registro.
                timeoutsRef.current = timeoutsRef.current.filter((x) => x !== tid);
            }, duration);
            timeoutsRef.current.push(tid);
        }
    }, []);

    // HOOK-032: cleanup de todos los timeouts pendientes al desmontar el provider.
    useEffect(() => {
        return () => {
            for (const id of timeoutsRef.current) {
                clearTimeout(id);
            }
            timeoutsRef.current = [];
        };
    }, []);

    useEffect(() => {
        _globalToast = addToast;
        return () => { _globalToast = null; };
    }, [addToast]);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={addToast}>
            {children}
            {/* Toast container con ARIA live region */}
            <div 
                role="status" 
                aria-live="polite" 
                aria-atomic="true"
                className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[90vw] max-w-sm pointer-events-none"
            >
                {toasts.map((toast) => {
                    const colors = COLORS[toast.type] || COLORS.info;
                    const IconComp = ICONS[toast.type] || Info;
                    return (
                        <div
                            key={toast.id}
                            className={`pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border backdrop-blur-xl shadow-2xl shadow-black/40 animate-in slide-in-from-top-3 fade-in duration-300 ${colors.bg}`}
                        >
                            <IconComp size={18} className={`${colors.icon} shrink-0`} />
                            <p className="text-sm text-white/90 font-medium flex-1 leading-snug">{toast.message}</p>
                            <button
                                onClick={() => removeToast(toast.id)}
                                aria-label="Cerrar notificación"
                                className="text-white/40 hover:text-white transition-colors shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center -mr-1.5"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used inside ToastProvider');
    return ctx;
}
