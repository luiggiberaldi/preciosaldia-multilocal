import React, { useState, useEffect } from 'react';
import { Cloud, CloudOff, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { getSyncConflicts, clearSyncConflicts, friendlyConflictName, SYNC_CONFLICT_EVENT } from '../utils/syncConflicts';
import { getLastSyncPushError, SYNC_PUSH_ERROR_EVENT } from '../hooks/useCloudSync';

/**
 * SyncStatus — Indicador visual de conectividad.
 * Muestra un icono de nube en la barra superior que refleja:
 * - Online:  Nube verde con check
 * - Offline: Nube roja tachada
 * M-17 (2026-10-01): si hay conflictos de sincronización sin revisar
 * (documentos no append-only resueltos por LWW), muestra un aviso ámbar
 * con el conteo; al tocarlo se marcan como revisados.
 */
export default function SyncStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [conflicts, setConflicts] = useState(() => getSyncConflicts());
    // Auditoría post-plan (2026-10-01): B-13a quedaba invisible — nadie
    // consumía el evento de error de push. Se muestra aquí hasta que se limpie.
    const [pushError, setPushError] = useState(() => getLastSyncPushError());

    useEffect(() => {
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        const onConflict = () => setConflicts(getSyncConflicts());
        const onPushError = () => setPushError(getLastSyncPushError());

        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        window.addEventListener(SYNC_CONFLICT_EVENT, onConflict);
        window.addEventListener(SYNC_PUSH_ERROR_EVENT, onPushError);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
            window.removeEventListener(SYNC_CONFLICT_EVENT, onConflict);
            window.removeEventListener(SYNC_PUSH_ERROR_EVENT, onPushError);
        };
    }, []);

    const conflictTitle = conflicts.length > 0
        ? `Conflictos de sincronización (${conflicts.length}):\n` +
          conflicts.slice(0, 5).map((c) =>
              `• ${friendlyConflictName(c.key)}: ${c.detail || c.direction}`
          ).join('\n') +
          '\n\nToca para marcar como revisados.'
        : '';

    const handleClick = () => {
        if (conflicts.length > 0) {
            clearSyncConflicts();
            setConflicts([]);
        }
        // Tocar el indicador de error limpia el aviso (el próximo push fallido
        // lo vuelve a mostrar). El reintento lo dispara el propio sync.
        if (pushError) setPushError(null);
    };

    const pushErrorTitle = pushError
        ? `Error de sincronización (${pushError.key}):\n${pushError.error}\n\nToca para ocultar el aviso.`
        : '';

    return (
        <div className="flex items-center gap-1.5">
            {pushError && (
                <button
                    onClick={handleClick}
                    title={pushErrorTitle}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-bold tracking-wide bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 animate-pulse"
                >
                    <AlertTriangle size={13} strokeWidth={2.5} />
                    <span className="hidden sm:inline">Error de sincronización</span>
                </button>
            )}
            {conflicts.length > 0 && (
                <button
                    onClick={handleClick}
                    title={conflictTitle}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-bold tracking-wide bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 animate-pulse"
                >
                    <AlertTriangle size={13} strokeWidth={2.5} />
                    <span className="hidden sm:inline">{conflicts.length} conflicto{conflicts.length === 1 ? '' : 's'}</span>
                </button>
            )}
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
        </div>
    );
}
