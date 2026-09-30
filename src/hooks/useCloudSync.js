import { useEffect, useRef } from 'react';
import { appForage } from '../utils/appForage';
import { supabaseCloud } from '../config/supabaseCloud';
import { useAuthStore } from './store/useAuthStore';
import { toCloudDocId, parseCloudDocId, isDocForActiveBusiness } from '../utils/negocioContext';
import { SUPERVISOR_SYNC_KEYS, validateSupervisorSyncDocument } from '../services/supervisorContracts';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { ensureDeviceSessionRegistered } from '../utils/deviceIdentity';
// FASE 1 cuenta multi-dispositivo (migraciones 002/003): modo cuenta como
// alternativa al pairing primario->monitor.
import { getAccountSyncContext } from '../services/cloudAccount';
import { mergeLedgerEntries, rebuildCustomersFromLedger } from '../utils/customerLedger';
// QUOTA-001: sincronización delta (stock liviano vs catálogo) + poda de ventas.
import {
    applyStockMap,
    buildStockMap,
    catalogHash,
    isValidStockMap,
    mergeSales,
    pruneSalesForSync,
} from '../utils/syncDelta';
import { RETENTION } from '../utils/retentionPolicy';
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

// ─── FASE 1 MULTI-NEGOCIO ──────────────────────────────────────────────────
// `doc_id = nb_<negocioId>:<clave>` (la columna `collection` ya separa
// 'store'/'local', así que no se duplica en el doc_id). Las claves globales
// (tasas, etc.) quedan sin prefijo y se comparten entre negocios.
// El hash de último push también es por doc_id: cada negocio tiene su estado.
function _pushHashKey(key) {
    return LAST_PUSH_HASH_PREFIX + toCloudDocId(key);
}

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
// QUOTA-002: `abasto_audit_log_v1` salió del sync (diagnóstico local, crecía sin cota).
const HEAVY_KEYS = ['bodega_products_v1', 'bodega_stock_v1', 'bodega_sales_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1'];
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
    if (key === 'abasto-auth-storage' || parseCloudDocId(key).key === 'abasto-auth-storage') {
        return { ok: false, skipped: true, error: 'Documento de autenticación bloqueado' };
    }

    // QUOTA-001: hash del catálogo pendiente de confirmación (se escribe solo
    // si el upsert del documento completo tiene éxito).
    let pendingCatalogHash = null;

    // QUOTA-001: el 99% de los cambios en productos es SOLO stock (cada venta).
    // En ese caso se empuja únicamente el mapa liviano `bodega_stock_v1`
    // (~40KB) y se omite el catálogo completo (~3MB). El catálogo solo viaja
    // cuando cambia algo estructural (precio, nombre, foto, alta/baja).
    if (key === 'bodega_products_v1' && Array.isArray(value)) {
        const stockResult = await pushCloudSync('bodega_stock_v1', buildStockMap(value), forceUnconditional);
        if (!forceUnconditional) {
            const chKey = `${LAST_PUSH_HASH_PREFIX}catalog:${toCloudDocId(key)}`;
            const ch = catalogHash(value);
            if (localStorage.getItem(chKey) === ch) {
                return { ok: true, skipped: true, reason: 'Solo cambió stock (delta)', stock: stockResult };
            }
            // Se confirma abajo, solo si Supabase acepta el upsert.
            pendingCatalogHash = { chKey, ch };
        }
        // Sigue abajo: empuja el catálogo completo (cambió algo estructural).
    }

    const docId = toCloudDocId(key);
    const hashKey = _pushHashKey(key);
    const currentHash = quickHash(value);
    if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) {
        return { ok: true, skipped: true, reason: 'Sin cambios' };
    }

    // QUOTA-002: las ventas viajan podadas a los últimos 90 días. El receptor
    // fusiona por id (mergeSales), así que la ventana nunca borra historial.
    const payloadValue = (key === 'bodega_sales_v1' && Array.isArray(value))
        ? pruneSalesForSync(value, RETENTION.SALES_SYNC_DAYS)
        : value;

    const collectionType = LOCAL_KEYS.includes(key) ? 'local' : 'store';
    const updatedAt = new Date().toISOString();
    const document = {
        device_id: _currentDeviceId,
        collection: collectionType,
        doc_id: docId,
        data: buildSyncEnvelope(payloadValue, updatedAt),
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

        // Solo confirmar los hashes después de que Supabase confirmó el upsert.
        localStorage.setItem(hashKey, currentHash);
        if (pendingCatalogHash) {
            localStorage.setItem(pendingCatalogHash.chKey, pendingCatalogHash.ch);
        }
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
        // FASE 1: appForage lee del namespace del negocio activo.
        const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
        for (const key of criticalKeys) {
            const val = await appForage.getItem(key);
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
    // QUOTA-001: mapa liviano { productId: stock }.
    'bodega_stock_v1': (data) => isValidStockMap(data),
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
 *
 * FASE 1: el doc_id viene como `nb_<negocioId>:<clave>`. Solo se aplican los
 * documentos del negocio activo (o globales). Los documentos legacy sin
 * prefijo (pre-Fase 1) se ignoran: el push local los re-publica namespaced.
 */
async function _applyFromCloud(docId, collection, data) {
    isSyncingFromCloud = true;
    try {
        if (!['store', 'local'].includes(collection)) return false;

        // ── Filtro multi-negocio (Fase 1) + SEC-002 ──
        if (!isDocForActiveBusiness(docId)) return false;
        const { key } = parseCloudDocId(docId);

        const envelope = readSyncEnvelope(data);
        if (!envelope.valid) {
            console.warn(`[CloudSync] Envelope remoto rechazado: ${envelope.error}`);
            return false;
        }

        const { payload } = envelope;
        let payloadToStore = payload;

        const metadataKey = getSyncMetadataKey(docId);
        const previousUpdatedAt = localStorage.getItem(metadataKey);
        if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
            return false;
        }

        // Contrato común del supervisor: incluso el primary debe rechazar
        // documentos no allowlisted antes de aplicarlos localmente.
        // Se valida con la clave BASE (sin prefijo de negocio).
        const supervisorValidation = validateSupervisorSyncDocument(key, payload);
        if (!supervisorValidation.valid) {
            console.warn(`[CloudSync] Documento remoto rechazado: ${supervisorValidation.error}`);
            return false;
        }

        // DATA-001: Validación de Schema antes de escribir en almacenamiento local
        const validator = STORE_SCHEMAS[key];
        if (validator) {
            let dataToValidate = payload;
            if (typeof payload === 'string' && (payload.startsWith('[') || payload.startsWith('{'))) {
                try { dataToValidate = JSON.parse(payload); } catch { /* silenciar parse error */ }
            }
            if (!validator(dataToValidate)) {
                console.warn(`[CloudSync] Schema validation falló para ${key}, ignorando payload remoto.`, payload);
                return false;
            }
        }

        if (collection === 'local') {
            // Colección 'local' = claves globales (tasas): docId sin prefijo.
            const stringPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
            originalSetItem(docId, stringPayload);   // Escribe sin pasar por interceptor (no existe ya)
            window.dispatchEvent(new StorageEvent('storage', {
                key: docId,
                newValue: stringPayload,
                storageArea: localStorage
            }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key, source: 'remote' } }));
        } else {
            // Colección 'store' → IndexedDB del negocio activo vía appForage
            // (enruta la clave lógica al namespace correcto), sin pasar por
            // storageService.setItem.
            // El ledger es append-only: nunca se reemplaza por un snapshot remoto.
            if (key === 'bodega_customer_ledger_v1') {
                const localLedger = await appForage.getItem(key);
                const merged = mergeLedgerEntries(localLedger, payload);
                payloadToStore = merged.ledger;
                if (merged.conflicts.length > 0) {
                    console.warn(`[CloudSync] Conflictos de ledger retenidos localmente: ${merged.conflicts.length}`);
                }
            }
            // QUOTA-001: el mapa de stock se fusiona sobre el catálogo local.
            // Nunca reemplaza productos: solo actualiza existencias.
            if (key === 'bodega_stock_v1' && payload && typeof payload === 'object') {
                const localProducts = await appForage.getItem('bodega_products_v1');
                if (Array.isArray(localProducts)) {
                    const mergedProducts = applyStockMap(localProducts, payload);
                    if (mergedProducts !== localProducts) {
                        await appForage.setItem('bodega_products_v1', mergedProducts);
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1', source: 'remote' } }));
                    }
                }
                const hashKey = LAST_PUSH_HASH_PREFIX + docId;
                localStorage.setItem(hashKey, quickHash(payload));
                if (envelope.updatedAt) localStorage.setItem(metadataKey, envelope.updatedAt);
                return true;
            }
            // QUOTA-002: las ventas remotas llegan podadas (90 días); se
            // fusionan por id para jamás perder historial local.
            if (key === 'bodega_sales_v1' && Array.isArray(payload)) {
                const localSales = await appForage.getItem(key);
                payloadToStore = mergeSales(localSales, payload);
            }
            await appForage.setItem(key, payloadToStore);
            if (key === 'bodega_customer_ledger_v1') {
                const localCustomers = await appForage.getItem('bodega_customers_v1');
                if (Array.isArray(localCustomers)) {
                    await appForage.setItem('bodega_customers_v1', rebuildCustomersFromLedger(localCustomers, payloadToStore));
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_customers_v1', source: 'remote' } }));
                }
            }

            // Notificar a los componentes React que lean este store (clave lógica)
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key, source: 'remote' } }));
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

                // ── MODO CUENTA (migraciones 002/003) ─────────────────────
                // Si el dueño vinculó este dispositivo a su cuenta (login o
                // código de 6 dígitos), el sync NO requiere device_pairings:
                // el pull abarca todos los dispositivos vinculados (propio +
                // hermanos) y el push sigue siendo por device_id propio.
                // Reclamar la identidad primero: el RLS de 002 resuelve la
                // cuenta vía device_sessions (auth.uid() -> device_id).
                let accountCtx = null;
                try {
                    await ensureDeviceSessionRegistered(deviceId).catch(() => {});
                    accountCtx = await getAccountSyncContext();
                } catch { accountCtx = null; }

                let pairedMonitorId = null;
                if (!accountCtx) {
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
                pairedMonitorId = pairing.monitor_device_id;
                } else {
                    console.info('[CloudSync] Modo cuenta activo', {
                        deviceId: shortCloudSyncId(deviceId),
                        mode: accountCtx.mode,
                        devices: accountCtx.deviceIds.length,
                    });
                }

                isCloudSyncActive = true;
                isInitialized.current = true;
                console.info('[CloudSync] Receptor activo', {
                    deviceId: shortCloudSyncId(deviceId),
                    monitorDeviceId: shortCloudSyncId(pairedMonitorId),
                    accountMode: Boolean(accountCtx),
                });

                // Sincronizar automáticamente todos los datos del POS a la nube en segundo plano (Patrón Donde Juancho)
                // En modo cuenta el push va con hash-gating (sin forzar): siembra la
                // cuenta la primera vez y evita re-subir el catálogo en cada arranque.
                forceSyncAllPOSData(deviceId, !accountCtx).catch(() => {});

                // ── Pull Inicial / Sincronización de Importación ──
                // Declarar el snapshot fuera de la rama condicional: el bloque de
                // auto-recuperación posterior también necesita conocer qué claves
                // llegaron desde la nube.
                let docs = [];
                const backupImported = localStorage.getItem('pda_backup_imported_flag') === 'true';
                
                if (backupImported) {
                    console.log('[CloudSync] Detectado backup importado localmente. Subiendo incondicionalmente a la nube...');
                    isCloudSyncActive = true;
                    const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                    for (const key of criticalKeys) {
                        const localValue = await appForage.getItem(key);
                        if (localValue !== null) {
                            const result = await pushCloudSync(key, localValue);
                            if (result?.ok) {
                                localStorage.setItem(_pushHashKey(key), quickHash(localValue));
                            }
                        }
                    }
                    localStorage.setItem('cloud_sync_ts', new Date().toISOString());
                    localStorage.removeItem('pda_backup_imported_flag');
                    console.log('[CloudSync] Sincronización incondicional de importación completada.');
                } else if (accountCtx) {
                    // ── PULL MULTI-DISPOSITIVO (modo cuenta) ─────────────
                    // Trae los documentos de todos los dispositivos vinculados
                    // (propio + hermanos). Watermark por cuenta: solo lo nuevo
                    // desde el último pull (egress). La corrección no depende
                    // del watermark: _applyFromCloud ignora lo que no sea más
                    // nuevo que la metadata local por documento.
                    const wmKey = `cloud_pull_watermark_${accountCtx.userId}`;
                    const watermark = localStorage.getItem(wmKey);
                    let pullQuery = supabaseCloud
                        .from('sync_documents')
                        .select('collection, doc_id, data, updated_at, device_id')
                        .in('device_id', accountCtx.deviceIds)
                        .in('collection', ['store', 'local'])
                        .order('updated_at', { ascending: true })
                        .limit(2000);
                    if (watermark) pullQuery = pullQuery.gt('updated_at', watermark);

                    const { data: initialDocs, error: docsError } = await pullQuery;

                    if (docsError) throw docsError;
                    docs = initialDocs || [];

                    if (docs.length > 0) {
                        for (const doc of docs) {
                            // FASE 1 + SEC-002: solo documentos del negocio activo
                            // (o globales); los legacy sin prefijo se ignoran.
                            if (!isDocForActiveBusiness(doc.doc_id)) continue;
                            try {
                                await _applyFromCloud(doc.doc_id, doc.collection, doc.data);
                            } catch (e) {
                                // HOOK-023: try/catch por documento para no abortar el pull completo.
                                console.warn(`[CloudSync] Error aplicando doc ${doc.doc_id}:`, e);
                            }
                        }
                        console.log(`[CloudSync] Pull cuenta: ${docs.length} documentos de ${accountCtx.deviceIds.length} dispositivos.`);
                    }
                    const maxTs = docs.reduce(
                        (m, d) => (d.updated_at && d.updated_at > m ? d.updated_at : m),
                        watermark || ''
                    );
                    if (maxTs) {
                        try { localStorage.setItem(wmKey, maxTs); } catch { /* noop */ }
                    }
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
                            // FASE 1 + SEC-002: solo documentos del negocio activo
                            // (o globales); los legacy sin prefijo se ignoran.
                            if (!isDocForActiveBusiness(doc.doc_id)) continue;
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
                    const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                    // FASE 1: los doc_id en la nube van namespaced; comparar contra eso.
                    // MODO CUENTA: `docs` trae documentos de TODOS los dispositivos
                    // vinculados; solo cuentan los del dispositivo PROPIO: un doc
                    // hermano con el mismo doc_id no debe suprimir el push propio.
                    const existingCloudKeys = new Set(
                        (docs || [])
                            .filter(d => !d.device_id || d.device_id === deviceId)
                            .map(d => d.doc_id)
                    );

                    for (const key of criticalKeys) {
                        const localValue = await appForage.getItem(key);
                        if (!localValue) continue;

                        const hashKey = _pushHashKey(key);
                        const currentHash = quickHash(localValue);
                        if (existingCloudKeys.has(toCloudDocId(key)) && localStorage.getItem(hashKey) === currentHash) continue;

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
                const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                for (const key of criticalKeys) {
                    const localValue = await appForage.getItem(key);
                    if (!localValue) continue;

                    const hashKey = _pushHashKey(key);
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
