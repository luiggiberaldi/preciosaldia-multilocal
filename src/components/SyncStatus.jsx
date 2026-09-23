import React, { useState, useEffect } from 'react';
import { Cloud, CloudOff, Wifi, WifiOff } from 'lucide-react';

/**
 * SyncStatus — Indicador visual de conectividad.
 * Muestra un icono de nube en la barra superior que refleja:
 * - Online:  Nube verde con check
 * - Offline: Nube roja tachada
 */
export default function SyncStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);

        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    return (
        <div
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold tracking-wide transition-all duration-300 ${
                isOnline
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 animate-pulse'
            }`}
            title={isOnline ? 'Conectado a Internet' : 'Sin conexion a Internet'}
        >
            {isOnline ? (
                <>
                    <Wifi size={13} strokeWidth={2.5} />
                    <span className="hidden sm:inline">Online</span>
                </>
            ) : (
                <>
                    <WifiOff size={13} strokeWidth={2.5} />
                    <span>Offline</span>
                </>
            )}
        </div>
    );
}
