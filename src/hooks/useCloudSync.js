import { useEffect, useRef } from 'react';
import localforage from 'localforage';
import { supabaseCloud } from '../config/supabaseCloud';
import { useAuthStore } from './store/useAuthStore';
import { SUPERVISOR_SYNC_KEYS, validateSupervisorSyncDocument } from '../services/supervisorContracts';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { mergeLedgerEntries, rebuildCustomersFromLedger } from '../utils/customerLedger';
import {
    buildSyncEnvelope,
    getSyncMetadataKey,
    isNewerSyncDocument,
    readSyncEnvelope,
    withSyncRetry,
} from '../services/supervisorSyncService';

// Una única allowlist compartida por primary y monitor.
const SYNC_KEYS = SUPERVISOR_SYNC_KEYS;

function shortCloudSyncId(value) {
    if (!value || typeof value !== 'string') return null;
    return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

// SEC-002: `abasto-auth-storage` (hashes de PIN) YA NO se sincroniza a sync_documents.
// Las políticas RLS de `sync_documents` en el schema original permiten lectura global
// (ver SEC-002/INFRA-002 — fix del SQL corresponde a Agente D). Aunque se arregle la
// RLS, los hashes de PIN no deben viajar por una tabla compartida entre dispositivos.
const LOCAL_KEYS = [
    'bodega_custom_rate',
    'bodega_use_auto_rate',
    'bodega_rate_mode',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled'
];

/** Hash ligero para detectar cambios sin comparar objetos enteros (mismo patrón que useAutoBackup.js) */
function quickHash(value) {
    const str = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    let h = 0;
    for (let i = 0; i < Math.min(str.length, 5000); i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return `${str.length}_${h >>> 0}`;
}

const LAST_PUSH_HASH_PREFIX = 'bodega_last_periodic_push_hash_';

// ─── Estado Global del Motor ───────────────────────────────────────────────
let globalSubscription = null;
let isSyncingFromCloud = false; // true mientras aplicamos cambios de la nube → evita eco
let pendingPush = {};           // Debounce: { [key]: timeoutId }
let _currentDeviceId = '';      // Device ID activo para pushCloudSync
let isCloudSyncActive = false;   // Evita empujar a la nube si el dispositivo no está autenticado/emparejado

// SEC-009 / HOOK-011: ELIMINADO el monkeypatch global de `localStorage.setItem`.
// Antes se reemplazaba `localStorage.setItem` a nivel módulo, interceptando TODAS
// las escrituras (incluyendo extensiones y devtools) y empujando a sync_documents.
// Eso causaba:
//   1. Recursión si el módulo se importa dos veces (HMR, tests).
//   2. Filtrado de hashes de PIN a una tabla pública (SEC-002).
//
// Ahora, los puntos de escritura explícitos llaman a `storageService.setItem` (que
// invoca `pushCloudSync` internamente). Para localStorage writes directos, los
// callers deben usar `pushLocalSync(key, value)` explícitamente.
//
// Mantenemos `originalSetItem` como referencia interna solo para aplicar cambios
// venidos de la nube sin disparar re-eco.

const originalSetItem = localStorage.setItem.bind(localStorage);

// Keys pesadas (arrays grandes con imágenes) usan debounce más largo para agrupar ediciones
const HEAVY_KEYS = ['bodega_products_v1', 'bodega_sales_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'abasto_audit_log_v1'];
const DEBOUNCE_LIGHT_MS = 300;
const DEBOUNCE_HEAVY_MS = 3000;

function _debouncePush(key, value) {
    if (pendingPush[key]) clearTimeout(pendingPush[key]);
    const delay = HEAVY_KEYS.includes(key) ? DEBOUNCE_HEAVY_MS : DEBOUNCE_LIGHT_MS;
    pendingPush[key] = setTimeout(() => {
        delete pendingPush[key];
        pushCloudSync(key, value).catch(() => {});
    }, delay);
}

export const pushCloudSync = async (key, value, forceUnconditional = false) => {
    if (!supabaseCloud) return { ok: false, skipped: true, error: 'Supabase no disponible' };
    if (isSyncingFromCloud) return { ok: false, skipped: true, error: 'Cambio remoto en aplicación' };
    if (!isCloudSyncActive) return { ok: false, skipped: true, error: 'Sync no activo' };
    if (!SYNC_KEYS.includes(key)) return { ok: false, skipped: true, error: 'Clave no allowlisted' };
    if (!_currentDeviceId) return { ok: false, skipped: true, error: 'Dispositivo no definido' };

    // SEC-002: jamás empujar `abasto-auth-storage` aunque accidentalmente lo pidan.
    if (key === 'abasto-auth-storage') return { ok: false, skipped: true, error: 'Documento de autenticación bloqueado' };

    const hashKey = LAST_PUSH_HASH_PREFIX + key;
    const currentHash = quickHash(value);
    if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) {
        return { ok: true, skipped: true, reason: 'Sin cambios' };
    }

    const collectionType = LOCAL_KEYS.includes(key) ? 'local' : 'store';
    const updatedAt = new Date().toISOString();
    const document = {
        device_id: _currentDeviceId,
        collection: collectionType,
        doc_id: key,
        data: buildSyncEnvelope(value, updatedAt),
        updated_at: updatedAt,
    };

    try {
        const result = await withSyncRetry(async () => {
            const response = await supabaseCloud
                .from('sync_documents')
                .upsert(document, { onConflict: 'device_id,collection,doc_id' });
            if (response.error) throw response.error;
            return response;
        });

        // Solo confirmar el hash después de que Supabase confirmó el upsert.
        localStorage.setItem(hashKey, currentHash);
        return { ok: true, skipped: false, updatedAt, data: result.data ?? null };
    } catch (error) {
        console.warn('[CloudSync] No se pudo confirmar el push:', error?.message ?? error);
        return { ok: false, skipped: false, error: error?.message || 'Error de sincronización' };
    }
};

/**
 * SEC-009 / HOOK-011: Reemplazo EXPLÍCITO del antiguo monkeypatch.
 *
 * Los callers que escriban directamente en localStorage con una clave en LOCAL_KEYS
 * deben invocar esta función (o usar `storageService.setItem`) para que el cambio
 * se propague a la nube. Ya NO se intercepta automáticamente `localStorage.setItem`.
 *
 * @param {string} key
 * @param {any} value
 */
export const pushLocalSync = (key, value) => {
    if (!LOCAL_KEYS.includes(key) && !SYNC_KEYS.includes(key)) return;
    if (key === 'abasto-auth-storage') return; // SEC-002
    _debouncePush(key, value);
};

/**
 * EGRESS-FIX (RC2 + RC5): encola un push de una key `store` a la nube a través
 * del debounce por-key (`_debouncePush`), en vez de empujar directo. Esto:
 *   • Agrupa ráfagas de ediciones en las keys pesadas (HEAVY_KEYS → 3000ms).
 *   • Colapsa el antiguo doble-push (storageService.setItem + listener de este
 *     hook) en un solo upsert, ya que ambos caían en la misma key del debounce.
 * `_debouncePush` → `pushCloudSync`, que respeta isSyncingFromCloud /
 * isCloudSyncActive / SYNC_KEYS, así que la seguridad anti-eco se preserva.
 *
 * @param {string} key
 * @param {any} value
 */
export const queueCloudSync = (key, value) => {
    if (!SYNC_KEYS.includes(key)) return;
    if (key === 'abasto-auth-storage') return; // SEC-002
    _debouncePush(key, value);
};

/**
 * Empuja de forma forzada TODOS los datos del punto de venta a la nube Supabase.
 * Se invoca al iniciar la app o al vincular el dispositivo.
 */
export const forceSyncAllPOSData = async (overrideDeviceId, forceUnconditional = false) => {
    if (!supabaseCloud) return;
    const isMonitor = localStorage.getItem('pda_pairing_mode') === 'monitor';
    if (isMonitor) return;

    const activeDeviceId = overrideDeviceId || _currentDeviceId || localStorage.getItem('pda_device_id');
    if (!activeDeviceId) return;

    if (!isCloudSyncActive) return { ok: false, error: 'Sync no activo' };

    try {
        const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
        const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
        for (const key of criticalKeys) {
            const val = await lf.getItem(key);
            if (val !== null) {
                await pushCloudSync(key, val, forceUnconditional);
            }
        }
    } catch (e) {
        console.warn('[CloudSync] Error en sincronización forzada POS:', e);
    }
};

// ─── Validación de Esquema para Sincronización Remota (DATA-001) ─────────────
const STORE_SCHEMAS = {
    'bodega_products_v1': (data) => Array.isArray(data),
    'bodega_sales_v1': (data) => Array.isArray(data),
    'bodega_customers_v1': (data) => Array.isArray(data),
    'bodega_customer_ledger_v1': (data) => Array.isArray(data) && data.every(movement => Boolean(movement?.id && movement?.customerId)
        && Number.isFinite(Number(movement?.amountUsd)) && Number(movement.amountUsd) >= 0
        && ['CREDIT', 'DEBIT'].includes(movement?.direction)),
    'bodega_payment_methods_v1': (data) => Array.isArray(data),
    'bodega_accounts_v2': (data) => Array.isArray(data),
    'bodega_categories_v1': (data) => Array.isArray(data),
    'monitor_rates_v12': (data) => typeof data === 'object' && data !== null,
    'abasto_audit_log_v1': (data) => Array.isArray(data),
    'pda_rate_mode': (data) => typeof data === 'string' && ['bcv', 'paralelo', 'promedio', 'custom'].includes(data),
};

/**
 * Aplica un documento recibido de la nube al almacenamiento local.
 * Garantiza que isSyncingFromCloud esté activo durante toda la operación.
 */
async function _applyFromCloud(docId, collection, data) {
    isSyncingFromCloud = true;
    try {
        if (!['store', 'local'].includes(collection)) return false;
        const envelope = readSyncEnvelope(data);
        if (!envelope.valid) {
            console.warn(`[CloudSync] Envelope remoto rechazado: ${envelope.error}`);
            return false;
        }

        const { payload } = envelope;
        let payloadToStore = payload;
        if (docId === 'abasto-auth-storage') return false;

        const metadataKey = getSyncMetadataKey(docId);
        const previousUpdatedAt = localStorage.getItem(metadataKey);
        if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
            return false;
        }

        // Contrato común del supervisor: incluso el primary debe rechazar
        // documentos no allowlisted antes de aplicarlos localmente.
        const supervisorValidation = validateSupervisorSyncDocument(docId, payload);
        if (!supervisorValidation.valid) {
            console.warn(`[CloudSync] Documento remoto rechazado: ${supervisorValidation.error}`);
            return false;
        }

        // DATA-001: Validación de Schema antes de escribir en almacenamiento local
        const validator = STORE_SCHEMAS[docId];
        if (validator) {
            let dataToValidate = payload;
            if (typeof payload === 'string' && (payload.startsWith('[') || payload.startsWith('{'))) {
                try { dataToValidate = JSON.parse(payload); } catch { /* silenciar parse error */ }
            }
            if (!validator(dataToValidate)) {
                console.warn(`[CloudSync] Schema validation falló para ${docId}, ignorando payload remoto.`, payload);
                return false;
            }
        }

        if (collection === 'local') {
            const stringPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
            originalSetItem(docId, stringPayload);   // Escribe sin pasar por interceptor (no existe ya)
            window.dispatchEvent(new StorageEvent('storage', {
                key: docId,
                newValue: stringPayload,
                storageArea: localStorage
            }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId, source: 'remote' } }));
        } else {
            // Colección 'store' → IndexedDB directo, sin pasar por storageService.setItem.
            // El ledger es append-only: nunca se reemplaza por un snapshot remoto.
            const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            if (docId === 'bodega_customer_ledger_v1') {
                const localLedger = await lf.getItem(docId);
                const merged = mergeLedgerEntries(localLedger, payload);
                payloadToStore = merged.ledger;
                if (merged.conflicts.length > 0) {
                    console.warn(`[CloudSync] Conflictos de ledger retenidos localmente: ${merged.conflicts.length}`);
                }
            }
            await lf.setItem(docId, payloadToStore);
            if (docId === 'bodega_customer_ledger_v1') {
                const localCustomers = await lf.getItem('bodega_customers_v1');
                if (Array.isArray(localCustomers)) {
                    await lf.setItem('bodega_customers_v1', rebuildCustomersFromLedger(localCustomers, payloadToStore));
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_customers_v1', source: 'remote' } }));
                }
            }

            // Notificar a los componentes React que lean este store
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId, source: 'remote' } }));
        }

        // Update local hash to prevent periodic push from re-uploading what we just downloaded
        const hashKey = LAST_PUSH_HASH_PREFIX + docId;
        localStorage.setItem(hashKey, quickHash(payloadToStore));
        if (envelope.updatedAt) localStorage.setItem(metadataKey, envelope.updatedAt);
        return true;
    } finally {
        isSyncingFromCloud = false;
    }
}

// ─── Hook de React ─────────────────────────────────────────────────────────
export function useCloudSync(deviceId) {
    const isInitialized = useRef(false);

    useEffect(() => {
        if (!supabaseCloud || !deviceId) {
            console.info('[CloudSync] Listener no iniciado', {
                reason: !supabaseCloud ? 'supabase_no_disponible' : 'device_id_no_definido',
                deviceId: shortCloudSyncId(deviceId),
            });
            isCloudSyncActive = false;
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
                isInitialized.current = false;
                _currentDeviceId = '';
            }
            return;
        }

        // Si el deviceId cambió con respecto al inicializado, forzar reinicio y cleanup de suscripción
        if (isInitialized.current && _currentDeviceId !== deviceId) {
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
            }
            isInitialized.current = false;
        }

        if (isInitialized.current) return;

        _currentDeviceId = deviceId;

        const initSync = async () => {
            try {
                const { session, error: sessionError } = await ensureSupervisorSession();
                if (sessionError || !session) {
                    isCloudSyncActive = false;
                    console.warn('[CloudSync] Sesión no disponible para sincronizar', {
                        deviceId: shortCloudSyncId(deviceId),
                        error: sessionError?.message || 'sin sesión',
                    });
                    return;
                }

                console.info('[CloudSync] Sesión Auth lista', {
                    deviceId: shortCloudSyncId(deviceId),
                    authUserId: shortCloudSyncId(session.user?.id),
                });

                const { data: pairing, error: pairingError } = await supabaseCloud
                    .from('device_pairings')
                    .select('monitor_device_id')
                    .eq('primary_device_id', deviceId)
                    .maybeSingle();

                console.info('[CloudSync] Pairing consultado', {
                    deviceId: shortCloudSyncId(deviceId),
                    paired: Boolean(pairing?.monitor_device_id),
                    monitorDeviceId: shortCloudSyncId(pairing?.monitor_device_id),
                    error: pairingError?.message || null,
                });

                if (pairingError || !pairing?.monitor_device_id) {
                    isCloudSyncActive = false;
                    console.warn('[CloudSync] Sincronización pausada hasta completar el pairing', {
                        reason: pairingError?.message || 'pairing_sin_monitor',
                        deviceId: shortCloudSyncId(deviceId),
                    });
                    if (!globalSubscription) {
                        globalSubscription = supabaseCloud
                            .channel(`device_pairings:${deviceId}`)
                            .on('postgres_changes', {
                                event: '*',
                                schema: 'public',
                                table: 'device_pairings',
                                filter: `primary_device_id=eq.${deviceId}`
                            }, () => {
                                isInitialized.current = false;
                                initSync();
                            })
                            .subscribe();
                    }
                    return;
                }

                isCloudSyncActive = true;
                isInitialized.current = true;
                console.info('[CloudSync] Receptor activo', {
                    deviceId: shortCloudSyncId(deviceId),
                    monitorDeviceId: shortCloudSyncId(pairing.monitor_device_id),
                });

                // Sincronizar automáticamente todos los datos del POS a la nube en segundo plano (Patrón Donde Juancho)
                forceSyncAllPOSData(deviceId, true).catch(() => {});

                // ── Pull Inicial / Sincronización de Importación ──
                // Declarar el snapshot fuera de la rama condicional: el bloque de
                // auto-recuperación posterior también necesita conocer qué claves
                // llegaron desde la nube.
                let docs = [];
                const backupImported = localStorage.getItem('pda_backup_imported_flag') === 'true';
                
                if (backupImported) {
                    console.log('[CloudSync] Detectado backup importado localmente. Subiendo incondicionalmente a la nube...');
                    isCloudSyncActive = true;
                    const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                    for (const key of criticalKeys) {
                        const localValue = await lf.getItem(key);
                        if (localValue !== null) {
                            const result = await pushCloudSync(key, localValue);
                            if (result?.ok) {
                                const hashKey = LAST_PUSH_HASH_PREFIX + key;
                                localStorage.setItem(hashKey, quickHash(localValue));
                            }
                        }
                    }
                    localStorage.setItem('cloud_sync_ts', new Date().toISOString());
                    localStorage.removeItem('pda_backup_imported_flag');
                    console.log('[CloudSync] Sincronización incondicional de importación completada.');
                } else {
                    const { data: initialDocs, error: docsError } = await supabaseCloud
                        .from('sync_documents')
                        .select('collection, doc_id, data')
                        .eq('device_id', deviceId)
                        .in('collection', ['store', 'local']);

                    if (docsError) throw docsError;
                    docs = initialDocs || [];

                    if (docs.length > 0) {
                        for (const doc of docs) {
                            // SEC-002: nunca aplicar `abasto-auth-storage` desde la nube.
                            if (doc.doc_id === 'abasto-auth-storage') continue;
                            try {
                                await _applyFromCloud(doc.doc_id, doc.collection, doc.data);
                            } catch (e) {
                                // HOOK-023: try/catch por documento para no abortar el pull completo.
                                console.warn(`[CloudSync] Error aplicando doc ${doc.doc_id}:`, e);
                            }
                        }
                        console.log(`[CloudSync] Pull inicial: ${docs.length} documentos aplicados.`);
                    }
                }

                // ── Auto-recuperación: Purgar/subir datos locales que no llegaron a enviarse debido al bug anterior ──
                try {
                    const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                    const existingCloudKeys = new Set((docs || []).map(d => d.doc_id));

                    for (const key of criticalKeys) {
                        const localValue = await lf.getItem(key);
                        if (!localValue) continue;

                        const hashKey = LAST_PUSH_HASH_PREFIX + key;
                        const currentHash = quickHash(localValue);
                        if (existingCloudKeys.has(key) && localStorage.getItem(hashKey) === currentHash) continue;

                        // Subimos los datos locales a la base de datos para sincronizar el historial.
                        // El hash solo se confirma si el upsert fue aceptado.
                        const result = await pushCloudSync(key, localValue);
                        if (result?.ok) localStorage.setItem(hashKey, currentHash);
                    }
                } catch (e) {
                    // Silencioso
                }

                // ── Suscripción WebSocket Realtime ─────────────────────────
                // EGRESS-FIX (RC3): ELIMINADA la auto-suscripción a `sync:${deviceId}`.
                // El dispositivo principal es el ÚNICO escritor de su propio device_id,
                // así que ese canal solo le devolvía el ECO de sus propias escrituras
                // (egress puro de Realtime, sin valor). El monitor del dueño mantiene su
                // propia suscripción independiente en useMonitorSync (canal
                // `monitor:${pairedDeviceId}`), por lo que sigue recibiendo cambios en
                // vivo. El estado inicial se obtiene con el pull por PostgREST de arriba.

            } catch (err) {
                console.error('[CloudSync] Fallo en inicialización:', err);
                isInitialized.current = false;
            }
        };

        initSync();

        // ── MECANISMOS DE SINCRONIZACIÓN AUTOMÁTICA Y CONTINUA ──
        //
        // EGRESS-FIX (RC2): ELIMINADO el listener de `app_storage_update` que
        // re-empujaba a la nube. Era la segunda mitad del doble-push: cada escritura
        // por `storageService.setItem` ya encola el push (ahora vía queueCloudSync),
        // así que este listener solo duplicaba el upsert (y su broadcast de Realtime).
        // Ningún write local dependía SOLO de este listener.

        // Escuchar evento 'online' y temporizador periódico para sincronizar datos locales pendientes
        // HOOK: solo re-sube una key si cambió desde el último push (evita gastar cuota de
        // Supabase/Realtime subiendo el mismo dato sin cambios cada 20s — ver quickHash arriba).
        const forcePushLocalData = async () => {
            if (isSyncingFromCloud || !deviceId) return;
            try {
                const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                for (const key of criticalKeys) {
                    const localValue = await lf.getItem(key);
                    if (!localValue) continue;

                    const hashKey = LAST_PUSH_HASH_PREFIX + key;
                    const currentHash = quickHash(localValue);
                    if (localStorage.getItem(hashKey) === currentHash) continue;

                    const result = await pushCloudSync(key, localValue);
                    if (result?.ok) localStorage.setItem(hashKey, currentHash);
                }
            } catch (e) {
                // Silencioso
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                forcePushLocalData();
            }
        };

        window.addEventListener('online', forcePushLocalData);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isCloudSyncActive = false;
            window.removeEventListener('online', forcePushLocalData);
            document.removeEventListener('visibilitychange', handleVisibilityChange);

            // HOOK-012: limpiar suscripción en cleanup para evitar leaks.
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
                isInitialized.current = false;
                _currentDeviceId = '';
            }
        };
    }, [deviceId]);
}
