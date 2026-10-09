import { useEffect, useRef, useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { runWithoutEco } from '../utils/syncFlags';
import localforage from 'localforage';
import { parseCloudDocId, isGlobalKey } from '../utils/negocioContext';
import { validateSupervisorSyncDocument } from '../services/supervisorContracts';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { getAccountSyncContext } from '../services/cloudAccount';
// QUOTA-001/002: fusión delta al recibir (stock liviano, ventas podadas).
import { applyStockMapDelta, isSalesDeltaKey, mergeSales, physicalDocId, preserveLocalStock, salesDeltaTickets } from '../utils/syncDelta';
import {
    getSyncMetadataKey,
    isNewerSyncDocument,
    readSyncEnvelope,
    buildSupervisorRealtimeChannelName,
    SUPERVISOR_SYNC_STATES,
} from '../services/supervisorSyncService';

const MERGED_SYNC_KEYS = new Set(['bodega_sales_v1', 'bodega_customer_ledger_v1', 'bodega_stock_v1']);
const isMergeSemanticsKey = (key) => MERGED_SYNC_KEYS.has(key) || isSalesDeltaKey(key);

localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

const SUBSCRIBE_TIMEOUT_MS = 8000;
const RECONNECT_DELAYS_MS = [1000, 3000, 10000, 30000];
// B-13 (2026-10-01): tope de reintentos de reconexión. Sin tope, el monitor
// reintentaba para siempre en silencio si la red caía de forma permanente.
// Al agotarse, se expone syncError para que la UI ofrezca reintento manual.
const MAX_RECONNECT_ATTEMPTS = 12;

/**
 * ALTO-1 (2026-10-01): el monitor ya no es ciego a vendedores no pareados.
 * Acepta un deviceId o un array; en modo cuenta usa TODOS los deviceIds de
 * la cuenta (getAccountSyncContext) para el pull inicial y el Realtime.
 */
export function useMonitorSync(deviceIdsInput, { excludeDeviceId = null, enabled = true } = {}) {
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
    const subscriptionsRef = useRef([]);
    const disposedRef = useRef(false);
    const initInFlightRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const lastSyncRef = useRef(lastSync);
    const lifecycleRef = useRef(0);
    const subscribeInFlightRef = useRef(null);
    const removeInFlightRef = useRef(Promise.resolve());
    // Lista efectiva de devices a monitorear (modo cuenta o fallback 1:1).
    const deviceIdsRef = useRef([]);

    const resolveDeviceIds = async () => {
        // Modo cuenta: todos los equipos vinculados (propio + hermanos).
        try {
            const ctx = await getAccountSyncContext().catch(() => null);
            if (ctx && Array.isArray(ctx.deviceIds) && ctx.deviceIds.length > 0) {
                return [...new Set(ctx.deviceIds)].filter((id) => id !== excludeDeviceId);
            }
        } catch { /* fallback abajo */ }
        const input = Array.isArray(deviceIdsInput) ? deviceIdsInput : [deviceIdsInput];
        return [...new Set(input.filter((id) => Boolean(id) && id !== excludeDeviceId))];
    };

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
        subscriptionsRef.current = subscriptionsRef.current.filter((c) => c !== channel);

        const removal = supabaseCloud.removeChannel(channel).catch(() => {});
        removeInFlightRef.current = removal;
        await removal;
        if (removeInFlightRef.current === removal) removeInFlightRef.current = Promise.resolve();
    };

    const clearSubscription = async () => {
        const channels = [...subscriptionsRef.current];
        subscriptionsRef.current = [];
        await Promise.all(channels.map((c) => removeChannel(c)));
    };

    const scheduleReconnect = (lifecycleId = lifecycleRef.current) => {
        if (!isActiveLifecycle(lifecycleId) || deviceIdsRef.current.length === 0 || reconnectTimerRef.current) return;
        // B-13 (2026-10-01): tope de intentos; al agotarse se avisa en vez de
        // reintentar eternamente en silencio.
        if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
            setSyncError('Se perdió la conexión con el monitor tras varios intentos. Revisa tu internet y usa Actualizar para reintentar.');
            return;
        }
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

        // FASE 1: el doc_id viene como `nb_<negocioId>:<clave>`. Se valida con
        // la clave BASE. Los documentos legacy sin prefijo (pre-Fase 1) se
        // ignoran; el primario los re-publica namespaced. Se escribe con el
        // docId COMPLETO (clave física): así los datos del primario quedan en
        // el namespace de SU negocio y nunca se mezclan con el del monitor.
        // FASE 1: el monitor acepta documentos de CUALQUIER negocio del primario
        // pareado (es su única fuente; el primario solo publica su negocio activo).
        // Se escriben con el docId completo (clave física) para no mezclarlos con
        // los datos propios del monitor. Legacy sin prefijo y auth se rechazan.
        const { negocioId, key } = parseCloudDocId(docId);
        if (key === 'abasto-auth-storage') {
            return { applied: false, rejected: true, error: 'Documento de autenticación bloqueado (SEC-002)' };
        }
        if (!negocioId && !isGlobalKey(key)) {
            return { applied: false, rejected: true, error: 'Documento legacy pre-Fase 1 ignorado' };
        }

        const validation = validateSupervisorSyncDocument(key, envelope.payload);
        if (!validation.valid) {
            return { applied: false, rejected: true, error: validation.error };
        }

        if (!['store', 'local'].includes(collection)) {
            return { applied: false, rejected: true, error: `Colección remota rechazada: ${collection}` };
        }

        const metadataKey = getSyncMetadataKey(
            docId,
            isMergeSemanticsKey(key) ? doc?.device_id : null,
        );
        const previousUpdatedAt = localStorage.getItem(metadataKey);
        if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
            return { applied: false, rejected: true, stale: true, error: 'Documento antiguo o repetido' };
        }

        await runWithoutEco(async () => {
            // QUOTA-001: el mapa de stock se fusiona sobre el catálogo del
            // negocio pareado; nunca reemplaza productos.
            // M-6 (2026-10-01): reconciliación por deltas por fuente (mismo
            // helper que el primario) para no perder descuentos concurrentes.
            if (key === 'bodega_stock_v1' && envelope.payload && typeof envelope.payload === 'object') {
                const productsDocId = physicalDocId(negocioId, 'bodega_products_v1');
                const current = await localforage.getItem(productsDocId);
                if (Array.isArray(current)) {
                    const lrKey = `pda_stock_lastremote_${docId}__${doc?.device_id || 'unknown'}`;
                    let lastRemote = null;
                    try {
                        const raw = localStorage.getItem(lrKey);
                        lastRemote = raw ? JSON.parse(raw) : null;
                    } catch { lastRemote = null; }
                    const { products: merged, nextRemoteMap } =
                        applyStockMapDelta(current, envelope.payload, lastRemote);
                    try {
                        if (nextRemoteMap) localStorage.setItem(lrKey, JSON.stringify(nextRemoteMap));
                    } catch { /* cuota llena: se re-siembra en el próximo ciclo */ }
                    if (merged !== current) {
                        await localforage.setItem(productsDocId, merged);
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1', source: 'remote' } }));
                    }
                }
            } else if (key === 'bodega_sales_v1' && Array.isArray(envelope.payload)) {
                // QUOTA-002: las ventas llegan podadas (90 días); fusión por id
                // para no perder historial en el monitor.
                const current = await localforage.getItem(docId);
                const merged = mergeSales(current, envelope.payload);
                await localforage.setItem(docId, merged);
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key, source: 'remote' } }));
            } else if (isSalesDeltaKey(key)) {
                // QUOTA-003: el delta diario trae { date, tickets }; se fusiona
                // por id en la vista de ventas del negocio pareado (idempotente).
                const salesDocId = physicalDocId(negocioId, 'bodega_sales_v1');
                const current = await localforage.getItem(salesDocId);
                const merged = mergeSales(current, salesDeltaTickets(envelope.payload));
                await localforage.setItem(salesDocId, merged);
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1', source: 'remote' } }));
            } else if (key === 'bodega_products_v1' && Array.isArray(envelope.payload)) {
                // El catálogo del primario trae su stock absoluto: conservar el stock local.
                // Los cambios de stock llegan por bodega_stock_v1 como deltas; si el catálogo
                // lo pisara, esas ventas se sumarían dos veces.
                const current = await localforage.getItem(docId);
                await localforage.setItem(docId, preserveLocalStock(current, envelope.payload));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key, source: 'remote' } }));
            } else if (collection === 'local') {
                const stringPayload = typeof envelope.payload === 'string'
                    ? envelope.payload
                    : JSON.stringify(envelope.payload);
                localStorage.setItem(docId, stringPayload);
                window.dispatchEvent(new StorageEvent('storage', {
                    key: docId,
                    newValue: stringPayload,
                    storageArea: localStorage,
                }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key, source: 'remote' } }));
            } else {
                await localforage.setItem(docId, envelope.payload);
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key, source: 'remote' } }));
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
        if (subscriptionsRef.current.length > 0) return Promise.resolve({ ok: true, error: null });
        if (subscribeInFlightRef.current) return subscribeInFlightRef.current;

        const subscriptionPromise = (async () => {
            await removeInFlightRef.current;
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };
            const deviceIds = deviceIdsRef.current;
            if (deviceIds.length === 0) return { ok: false, error: 'Sin dispositivos a monitorear' };

            // ALTO-1: un canal Realtime por equipo (los filtros de Supabase no
            // soportan `in`). Se considera éxito si al menos uno suscribe.
            const results = await Promise.all(deviceIds.map((deviceId) => new Promise((resolve) => {
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
                    finish({ ok: false, error: 'Tiempo agotado al conectar Realtime' });
                }, SUBSCRIBE_TIMEOUT_MS);

                const channel = supabaseCloud
                    .channel(buildSupervisorRealtimeChannelName(deviceId, lifecycleId))
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'sync_documents',
                        filter: `device_id=eq.${deviceId}`,
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
                            subscriptionsRef.current.push(channel);
                            finish({ ok: true, error: null, deviceId });
                        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            void removeChannel(channel);
                            finish({ ok: false, error: `Canal Realtime: ${status}`, deviceId });
                        }
                    });
            })));

            if (!isActiveLifecycle(lifecycleId)) {
                await clearSubscription();
                return { ok: false, error: 'Ciclo de sincronización obsoleto' };
            }
            const okCount = results.filter((r) => r.ok).length;
            if (okCount > 0) {
                reconnectAttemptRef.current = 0;
                setIsConnected(true);
                setSyncState(SUPERVISOR_SYNC_STATES.CONNECTED);
                setSyncError(null);
                if (okCount < results.length) {
                    console.warn(`[MonitorSync] ${results.length - okCount} canal(es) Realtime no suscribieron; reintentando`);
                    scheduleReconnect(lifecycleId);
                }
                return { ok: true, error: null, channels: okCount };
            }
            setIsConnected(false);
            setSyncState(lastSyncRef.current ? SUPERVISOR_SYNC_STATES.DEGRADED : SUPERVISOR_SYNC_STATES.ERROR);
            scheduleReconnect(lifecycleId);
            return { ok: false, error: 'Ningún canal Realtime suscribió' };
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
            // ALTO-1: resolver la lista efectiva (modo cuenta → todos los
            // equipos; si no, el/los deviceId que pasó la vista).
            const deviceIds = await resolveDeviceIds();
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };
            deviceIdsRef.current = deviceIds;
            if (deviceIds.length === 0) {
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
                    .select('collection, doc_id, data, updated_at, device_id')
                    .in('device_id', deviceIds)
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

    // B-13 (2026-10-01): el reintento manual resetea el contador de intentos y
    // limpia el error de "reconexión agotada".
    const triggerRefresh = async () => {
        reconnectAttemptRef.current = 0;
        setSyncError(null);
        return initMonitor();
    };

    // Clave estable del input (string o array) para el efecto.
    const inputKey = `${Array.isArray(deviceIdsInput)
        ? deviceIdsInput.filter(Boolean).sort().join(',')
        : (deviceIdsInput || '')}|exclude:${excludeDeviceId || ''}|enabled:${enabled}`;

    useEffect(() => {
        disposedRef.current = false;
        const lifecycleId = lifecycleRef.current + 1;
        lifecycleRef.current = lifecycleId;
        reconnectAttemptRef.current = 0;
        if (!enabled || !supabaseCloud || !inputKey) {
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
    }, [inputKey, enabled]);

    return {
        isConnected,
        lastSync,
        loading,
        syncState,
        syncError,
        triggerRefresh,
    };
}
