import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, AlertTriangle, RefreshCw, ChevronDown } from 'lucide-react';
import { getSyncConflicts, clearSyncConflicts, friendlyConflictName, SYNC_CONFLICT_EVENT } from '../utils/syncConflicts';
import { getLastSyncPushError, SYNC_PUSH_ERROR_EVENT, syncNow } from '../hooks/useCloudSync';
import { getCloudPullStatus, CLOUD_PULL_STATUS_EVENT } from '../services/cloudPullService';

// Causas por las que un documento queda pendiente en el journal de pull (ver cloudPullService).
const PENDING_REASON_LABELS = {
    'unknown-business': 'Sede no conocida en este equipo',
    'invalid-registry': 'Registro de sedes inválido',
    'invalid-document': 'Documento inválido',
    'apply-failed': 'Error al aplicar en este equipo',
};

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
    const [pullStatus, setPullStatus] = useState(() => getCloudPullStatus());
    const [retrying, setRetrying] = useState(false);
    const [retryMessage, setRetryMessage] = useState('');
    const [showCauses, setShowCauses] = useState(false);

    useEffect(() => {
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        const onConflict = () => setConflicts(getSyncConflicts());
        const onPushError = () => setPushError(getLastSyncPushError());
        const onPullStatus = () => setPullStatus(getCloudPullStatus());

        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        window.addEventListener(SYNC_CONFLICT_EVENT, onConflict);
        window.addEventListener(SYNC_PUSH_ERROR_EVENT, onPushError);
        window.addEventListener(CLOUD_PULL_STATUS_EVENT, onPullStatus);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
            window.removeEventListener(SYNC_CONFLICT_EVENT, onConflict);
            window.removeEventListener(SYNC_PUSH_ERROR_EVENT, onPushError);
            window.removeEventListener(CLOUD_PULL_STATUS_EVENT, onPullStatus);
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

    const retryPending = async () => {
        setRetrying(true);
        setRetryMessage('');
        try {
            const result = await syncNow();
            setRetryMessage(result.message);
            setPullStatus(getCloudPullStatus());
        } catch {
            setRetryMessage('No se pudo reintentar; los documentos pendientes se conservan.');
        } finally { setRetrying(false); }
    };
    const incompletePull = pullStatus && ['partial', 'failed'].includes(pullStatus.status);
    const causes = Object.entries(pullStatus?.pendingByReason || {}).filter(([, n]) => n > 0);

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {incompletePull && (
                <button
                    onClick={retryPending}
                    disabled={retrying || !isOnline}
                    aria-label={`Sync parcial: ${pullStatus.applied} aplicados, ${pullStatus.pending} pendientes. Reintentar`}
                    title={`${pullStatus.pending} pendientes conservados. Última confirmación completa: ${pullStatus.lastConfirmedAt || 'sin confirmar'}. Toca para reintentar, no para borrar.`}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-bold bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 disabled:opacity-50"
                >
                    <RefreshCw size={13} className={retrying ? 'animate-spin' : ''} />
                    <span>Parcial: {pullStatus.applied} aplicados / {pullStatus.pending} pendientes</span>
                </button>
            )}
            {incompletePull && (
                <div className="relative">
                    <button
                        onClick={() => setShowCauses(v => !v)}
                        aria-expanded={showCauses}
                        className="flex items-center gap-0.5 px-2 py-1.5 rounded-xl text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20"
                    >
                        <span>Causas</span>
                        <ChevronDown size={12} className={showCauses ? 'rotate-180' : ''} />
                    </button>
                    {showCauses && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 shadow-xl p-2.5 text-[11px] text-slate-700 dark:text-slate-200">
                            <p className="font-bold mb-1.5">Pendientes por causa</p>
                            {causes.length === 0 ? (
                                <p className="text-slate-500">Sin desglose todavía. Reintenta para actualizarlo.</p>
                            ) : (
                                <ul className="space-y-1 mb-2">
                                    {causes.map(([reason, n]) => (
                                        <li key={reason} className="flex justify-between gap-2">
                                            <span>{PENDING_REASON_LABELS[reason] || `Otra causa (${reason})`}</span>
                                            <span className="font-bold tabular-nums">{n}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="text-slate-500 mb-2">Se conservan; no se borra nada.</p>
                            <button
                                onClick={retryPending}
                                disabled={retrying || !isOnline}
                                className="w-full px-2 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500 text-white disabled:opacity-50"
                            >
                                {retrying ? 'Reintentando…' : 'Reintentar ahora'}
                            </button>
                        </div>
                    )}
                </div>
            )}
            {retryMessage && <span role="status" className="text-[10px]">{retryMessage}</span>}
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
