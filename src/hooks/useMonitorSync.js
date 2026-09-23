import { useEffect, useRef, useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { runWithoutEco } from '../utils/syncFlags';
import localforage from 'localforage';
import { validateSupervisorSyncDocument } from '../services/supervisorContracts';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import {
    getSyncMetadataKey,
    isNewerSyncDocument,
    readSyncEnvelope,
    buildSupervisorRealtimeChannelName,
    SUPERVISOR_SYNC_STATES,
} from '../services/supervisorSyncService';

localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

const SUBSCRIBE_TIMEOUT_MS = 8000;
const RECONNECT_DELAYS_MS = [1000, 3000, 10000, 30000];

export function useMonitorSync(pairedDeviceId) {
    const [isConnected, setIsConnected] = useState(false);
    const [lastSync, setLastSync] = useState(() => {
        const stored = localStorage.getItem('monitor_last_sync');
        if (!stored) return null;
        const parsed = new Date(stored);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    });
    const [loading, setLoading] = useState(true);
    const [syncState, setSyncState] = useState(SUPERVISOR_SYNC_STATES.IDLE);
    const [syncError, setSyncError] = useState(null);
    const subscriptionRef = useRef(null);
    const disposedRef = useRef(false);
    const initInFlightRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const lastSyncRef = useRef(lastSync);
    const lifecycleRef = useRef(0);
    const subscribeInFlightRef = useRef(null);
    const removeInFlightRef = useRef(Promise.resolve());

    const updateLastSync = (value) => {
        lastSyncRef.current = value;
        setLastSync(value);
        if (value) localStorage.setItem('monitor_last_sync', value.toISOString());
    };

    const isActiveLifecycle = (lifecycleId) => (
        !disposedRef.current && lifecycleRef.current === lifecycleId
    );

    const removeChannel = async (channel) => {
        if (!channel) return;
        if (subscriptionRef.current === channel) subscriptionRef.current = null;

        const removal = supabaseCloud.removeChannel(channel).catch(() => {});
        removeInFlightRef.current = removal;
        await removal;
        if (removeInFlightRef.current === removal) removeInFlightRef.current = Promise.resolve();
    };

    const clearSubscription = async () => removeChannel(subscriptionRef.current);

    const scheduleReconnect = (lifecycleId = lifecycleRef.current) => {
        if (!isActiveLifecycle(lifecycleId) || !pairedDeviceId || reconnectTimerRef.current) return;
        const attempt = Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS_MS.length - 1);
        const delay = RECONNECT_DELAYS_MS[attempt];
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (isActiveLifecycle(lifecycleId)) initMonitor(lifecycleId);
        }, delay);
    };

    const applyDocToLocal = async (doc) => {
        const docId = doc?.doc_id;
        const collection = doc?.collection;
        const envelope = readSyncEnvelope(doc?.data);

        if (!envelope.valid) {
            return { applied: false, rejected: true, error: envelope.error };
        }

        const validation = validateSupervisorSyncDocument(docId, envelope.payload);
        if (!validation.valid) {
            return { applied: false, rejected: true, error: validation.error };
        }

        if (!['store', 'local'].includes(collection)) {
            return { applied: false, rejected: true, error: `Colección remota rechazada: ${collection}` };
        }

        const metadataKey = getSyncMetadataKey(docId);
        const previousUpdatedAt = localStorage.getItem(metadataKey);
        if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
            return { applied: false, rejected: true, stale: true, error: 'Documento antiguo o repetido' };
        }

        await runWithoutEco(async () => {
            if (collection === 'local') {
                const stringPayload = typeof envelope.payload === 'string'
                    ? envelope.payload
                    : JSON.stringify(envelope.payload);
                localStorage.setItem(docId, stringPayload);
                window.dispatchEvent(new StorageEvent('storage', {
                    key: docId,
                    newValue: stringPayload,
                    storageArea: localStorage,
                }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId, source: 'remote' } }));
            } else {
                await localforage.setItem(docId, envelope.payload);
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId, source: 'remote' } }));
            }
        });

        if (envelope.updatedAt) localStorage.setItem(metadataKey, envelope.updatedAt);
        return { applied: true, rejected: false, updatedAt: envelope.updatedAt };
    };

    const applyBatch = async (docs) => {
        let applied = 0;
        let rejected = 0;
        for (const doc of docs || []) {
            try {
                const result = await applyDocToLocal(doc);
                if (result.applied) applied += 1;
                if (result.rejected && !result.stale) rejected += 1;
            } catch (error) {
                rejected += 1;
                console.warn('[MonitorSync] Error aplicando documento:', error?.message ?? error);
            }
        }
        return { applied, rejected };
    };

    const subscribeToRealtime = (lifecycleId = lifecycleRef.current) => {
        if (!isActiveLifecycle(lifecycleId)) return Promise.resolve({ ok: false, error: 'Ciclo de sincronización obsoleto' });
        if (subscriptionRef.current) return Promise.resolve({ ok: true, error: null });
        if (subscribeInFlightRef.current) return subscribeInFlightRef.current;

        const subscriptionPromise = (async () => {
            await removeInFlightRef.current;
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };

            return new Promise((resolve) => {
                let settled = false;
                let timeout;
                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    resolve(result);
                };

                timeout = setTimeout(() => {
                    void removeChannel(channel);
                    setIsConnected(false);
                    setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
                    finish({ ok: false, error: 'Tiempo agotado al conectar Realtime' });
                    scheduleReconnect(lifecycleId);
                }, SUBSCRIBE_TIMEOUT_MS);

                const channel = supabaseCloud
                    .channel(buildSupervisorRealtimeChannelName(pairedDeviceId, lifecycleId))
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'sync_documents',
                        filter: `device_id=eq.${pairedDeviceId}`,
                    }, async (realtimePayload) => {
                        if (!isActiveLifecycle(lifecycleId) || !realtimePayload.new) return;
                        try {
                            const result = await applyDocToLocal(realtimePayload.new);
                            if (result.applied && isActiveLifecycle(lifecycleId)) {
                                updateLastSync(new Date());
                                setSyncError(null);
                            }
                        } catch (error) {
                            if (!isActiveLifecycle(lifecycleId)) return;
                            setSyncError(error?.message || 'No se pudo aplicar la actualización remota');
                            setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
                        }
                    })
                    .subscribe((status) => {
                        if (!isActiveLifecycle(lifecycleId)) {
                            void removeChannel(channel);
                            finish({ ok: false, error: 'Ciclo de sincronización obsoleto' });
                            return;
                        }
                        if (status === 'SUBSCRIBED') {
                            reconnectAttemptRef.current = 0;
                            setIsConnected(true);
                            setSyncState(SUPERVISOR_SYNC_STATES.CONNECTED);
                            setSyncError(null);
                            finish({ ok: true, error: null });
                        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            void removeChannel(channel);
                            setIsConnected(false);
                            setSyncState(lastSyncRef.current ? SUPERVISOR_SYNC_STATES.DEGRADED : SUPERVISOR_SYNC_STATES.ERROR);
                            finish({ ok: false, error: `Canal Realtime: ${status}` });
                            scheduleReconnect(lifecycleId);
                        }
                    });

                subscriptionRef.current = channel;
            });
        })();

        subscribeInFlightRef.current = subscriptionPromise;
        return subscriptionPromise.finally(() => {
            if (subscribeInFlightRef.current === subscriptionPromise) subscribeInFlightRef.current = null;
        });
    };

    const initMonitor = async (lifecycleId = lifecycleRef.current) => {
        if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };
        if (initInFlightRef.current) return initInFlightRef.current;

        const run = (async () => {
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };
            if (!pairedDeviceId) {
                setLoading(false);
                setIsConnected(false);
                setSyncState(SUPERVISOR_SYNC_STATES.IDLE);
                setSyncError(null);
                return { ok: false, error: 'No hay dispositivo vinculado' };
            }

            setLoading(true);
            setSyncState(SUPERVISOR_SYNC_STATES.AUTHENTICATING);
            setSyncError(null);

            try {
                const { session, error: sessionError } = await ensureSupervisorSession();
                if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del monitor');
                if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };

                setSyncState(SUPERVISOR_SYNC_STATES.PULLING);
                const { data: docs, error } = await supabaseCloud
                    .from('sync_documents')
                    .select('collection, doc_id, data, updated_at')
                    .eq('device_id', pairedDeviceId)
                    .in('collection', ['store', 'local']);

                if (error) throw error;

                const batch = await applyBatch(docs || []);
                if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };
                if (batch.applied > 0) updateLastSync(new Date());

                const realtime = await subscribeToRealtime(lifecycleId);
                if (!realtime.ok) {
                    setIsConnected(false);
                    setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
                    setSyncError(realtime.error);
                    return { ok: false, error: realtime.error, ...batch };
                }

                return { ok: true, error: null, ...batch };
            } catch (error) {
                setIsConnected(false);
                setSyncState(lastSyncRef.current ? SUPERVISOR_SYNC_STATES.DEGRADED : SUPERVISOR_SYNC_STATES.ERROR);
                setSyncError(error?.message || 'No se pudo sincronizar el monitor');
                scheduleReconnect(lifecycleId);

                return { ok: false, error: error?.message || 'No se pudo sincronizar el monitor' };
            } finally {
                if (!disposedRef.current) setLoading(false);
            }
        })();

        initInFlightRef.current = run;
        try {
            return await run;
        } finally {
            if (initInFlightRef.current === run) initInFlightRef.current = null;
        }
    };

    const triggerRefresh = async () => initMonitor();

    useEffect(() => {
        disposedRef.current = false;
        const lifecycleId = lifecycleRef.current + 1;
        lifecycleRef.current = lifecycleId;
        reconnectAttemptRef.current = 0;
        if (!supabaseCloud || !pairedDeviceId) {
            setLoading(false);
            setIsConnected(false);
            setSyncState(SUPERVISOR_SYNC_STATES.IDLE);
            setSyncError(null);
            return undefined;
        }

        initMonitor(lifecycleId);

        const handleOnline = () => {
            reconnectAttemptRef.current = 0;
            setSyncError(null);
            initMonitor(lifecycleId);
        };
        const handleOffline = () => {
            setIsConnected(false);
            setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
            setSyncError('Sin conexión a internet');
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            disposedRef.current = true;
            lifecycleRef.current += 1;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
            initInFlightRef.current = null;
            subscribeInFlightRef.current = null;
            clearSubscription();
        };
    }, [pairedDeviceId]);

    return {
        isConnected,
        lastSync,
        loading,
        syncState,
        syncError,
        triggerRefresh,
    };
}
