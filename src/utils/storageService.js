import localforage from 'localforage';
import { queueCloudSync } from '../hooks/useCloudSync';
import { shadowBackupService } from './shadowBackupService';
import { isSyncingFromCloud } from './syncFlags';
import { routeStorageKey, getNegocioActivoId, isGlobalKey, NEGOCIO_KEY_PREFIX } from './negocioContext';

localforage.config({
    name: 'BodegaApp',
    storeName: 'bodega_app_data',
    description: 'Almacenamiento local optimizado para PWA de Bodega'
});

const _retryQueue = [];
const QUOTA_RETRY_MAX = 3;
const atomicSnapshotState = new WeakMap();

/** Umbral del Circuit Breaker: si la reducción es < 10% del catálogo actual (>5 ítems), bloquea */
const CIRCUIT_BREAKER_MIN_RATIO = 0.1;

export const storageService = {
    /**
     * Obtiene un item de IndexedDB.
     * Si no existe, intenta leerlo de localStorage (Retrocompatibilidad),
     * lo guarda en IndexedDB y lo borra de localStorage.
     *
     * MULTI-NEGOCIO (Fase 1): la clave se enruta con `routeStorageKey()` —
     * las claves de datos del negocio activo llevan el prefijo `nb_<id>:`.
     * `key` sigue siendo la clave LÓGICA para el resto de la app.
     */
    async getItem(key, defaultValue = null) {
        const rkey = routeStorageKey(key);
        try {
            // 0. Router multi-negocio: clave física namespaced por negocio.
            // 1. Intentar leer de IndexedDB
            const value = await localforage.getItem(rkey);

            if (value !== null) {
                return value;
            }

            // --- INTENTO DE RECUPERAR DATOS ANTERIORES AUTOMÁTICAMENTE ---
            try {
                if (key === 'bodega_products_v1' || key === 'bodega_customers_v1' || key === 'bodega_accounts_v2') {
                    const oldKeyMap = {
                        'bodega_products_v1': 'my_products_v1',
                        'bodega_customers_v1': 'my_customers_v1',
                        'bodega_accounts_v2': 'my_accounts_v2',
                    };
                    const oldKey = oldKeyMap[key];
                    if (oldKey) {
                        const oldStore = localforage.createInstance({
                            name: 'TasasAlDiaApp',
                            storeName: 'app_data'
                        });
                        const oldVal = await oldStore.getItem(oldKey);
                        if (oldVal !== null) {
                            await localforage.setItem(rkey, oldVal);
                            console.log(`[Migración Auto] Recuperado ${oldKey} -> ${rkey}`);
                            return oldVal;
                        }
                    }
                }
            } catch(e) {
                console.error("Error intentando recuperar datos antiguos", e);
            }

            // 2. Si no existe, revisar LocalStorage.
            //    Primero la contingencia namespaced (rkey), luego los residuos
            //    viejos con la clave lógica sin prefijo (migración al vuelo).
            const fallbackValue = localStorage.getItem(rkey) ?? localStorage.getItem(key);
            if (fallbackValue !== null) {
                let parsedValue;

                try {
                    parsedValue = JSON.parse(fallbackValue);
                } catch (e) {
                    parsedValue = fallbackValue;
                }

                await localforage.setItem(rkey, parsedValue);
                localStorage.removeItem(rkey);
                localStorage.removeItem(key);
                return parsedValue;
            }

            return defaultValue;

        } catch (error) {
            console.error(`[Storage Error] Leyendo ${key}:`, error);
            const backup = localStorage.getItem(rkey) ?? localStorage.getItem(key);
            if (backup) {
                try { return JSON.parse(backup); } catch (e) { return backup; }
            }
            return defaultValue;
        }
    },

    /**
     * Lee una instantánea coherente de IndexedDB para un conjunto de claves.
     * No migra ni escribe durante la lectura: si hay datos pendientes en
     * localStorage, falla para evitar que una lectura parcial parezca vacía.
     */
    async readAtomicSnapshot(keys, { businessId = getNegocioActivoId(), defaults = {} } = {}) {
        if (!Array.isArray(keys) || keys.length === 0 || keys.some(key => typeof key !== 'string' || !key)
            || new Set(keys).size !== keys.length) throw atomicStorageError('ATOMIC_KEYS_INVALID');
        const physicalByLogical = Object.fromEntries(keys.map(key => [key, routeAtomicBusinessKey(key, businessId)]));
        const physicalKeys = Object.values(physicalByLogical);
        if (new Set(physicalKeys).size !== physicalKeys.length) throw atomicStorageError('ATOMIC_KEYS_COLLIDE');
        const { db, storeName } = await getAtomicIndexedDB();
        const defaultsByPhysical = Object.fromEntries(keys.map(key => [physicalByLogical[key], cloneAtomicDefault(defaults[key])]));
        const result = await runAtomicKeyTransaction({
            db, storeName, mode: 'readonly', keys: physicalKeys, defaults: defaultsByPhysical,
        });
        for (const key of keys) {
            const physicalKey = physicalByLogical[key];
            if (result.raw[physicalKey] !== undefined) continue;
            let legacyValue = null;
            try { legacyValue = localStorage.getItem(physicalKey) ?? localStorage.getItem(key); } catch { /* unavailable localStorage is not a migration source */ }
            if (legacyValue !== null) throw atomicStorageError('ATOMIC_LEGACY_MIGRATION_REQUIRED');
        }
        const values = Object.fromEntries(keys.map(key => [key, freezeAtomicValue(result.values[physicalByLogical[key]])]));
        const snapshot = {
            businessId,
            physicalByLogical: Object.freeze({ ...physicalByLogical }),
            raw: freezeAtomicValue(result.raw),
            values: Object.freeze(values),
        };
        const expectedRaw = Object.fromEntries(physicalKeys.map(key => [key, atomicStableValue(result.raw[key])]));
        atomicSnapshotState.set(snapshot, {
            physicalByLogical: { ...physicalByLogical },
            expectedRaw,
            values,
        });

        return snapshot;
    },

    /**
     * Atomically persist all related POS projections, failing closed on any IDB error.
     * The snapshot is optimistic: any intervening write to an included key aborts the transaction.
     */
    async commitAtomicSnapshot({ snapshot, writes }) {
        const state = snapshot && typeof snapshot === 'object' ? atomicSnapshotState.get(snapshot) : null;
        if (!state || !writes || typeof writes !== 'object') throw atomicStorageError('ATOMIC_SNAPSHOT_INVALID');
        const entries = Object.entries(writes);
        if (!entries.length || entries.some(([key]) => !Object.hasOwn(state.physicalByLogical, key))) {
            throw atomicStorageError('ATOMIC_WRITE_KEYS_INVALID');
        }
        const { db, storeName } = await getAtomicIndexedDB();
        const atomicWrites = {};
        for (const [logicalKey, value] of entries) {
            atomicWrites[state.physicalByLogical[logicalKey]] = value === undefined ? null : value;
        }
        const catalog = entries.find(([key]) => key === 'bodega_products_v1');
        if (catalog && Array.isArray(state.values.bodega_products_v1)
            && state.values.bodega_products_v1.length > 5) {
            const nextCount = Array.isArray(catalog[1]) ? catalog[1].length : 0;
            if (nextCount / state.values.bodega_products_v1.length < CIRCUIT_BREAKER_MIN_RATIO) {
                throw atomicStorageError('ATOMIC_CATALOG_REDUCTION_BLOCKED');
            }
            await shadowBackupService.saveShadow(state.physicalByLogical.bodega_products_v1, state.values.bodega_products_v1);
        }
        await runAtomicKeyTransaction({
            db, storeName, mode: 'readwrite', keys: Object.values(state.physicalByLogical),
            expectedRaw: state.expectedRaw, writes: atomicWrites,
        });
        for (const [logicalKey, value] of entries) {
            const physicalKey = state.physicalByLogical[logicalKey];
            try { localStorage.removeItem(physicalKey); localStorage.removeItem(logicalKey); } catch { /* commit already completed */ }
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: logicalKey, source: 'atomic-pos' } }));
            }
            if (!isSyncingFromCloud()) queueCloudSync(physicalKey, value);
        }
        atomicSnapshotState.delete(snapshot);
        return { committed: true, keys: entries.map(([key]) => key) };
    },

    /**
     * Guarda un item directamente en IndexedDB
     *
     * TRIPLE-LOCK VAULT:
     * 1. Storage Circuit Breaker: bloquea vaciados o reducciones drásticas (>5 ítems → <10%).
     * 2. Shadow Snapshots: guarda una copia espejo en IndexedDB antes de cada sobrescritura.
     */
    async setItem(key, value) {
        // 0. Router multi-negocio (Fase 1). `key` = clave lógica;
        //    `rkey` = clave física namespaced por negocio.
        const rkey = routeStorageKey(key);
        try {
            // 🧱 CAPA 1: DISYUNTOR DE ALMACENAMIENTO (Circuit Breaker para Catálogo)
            if (key === 'bodega_products_v1') {
                const currentCatalog = await localforage.getItem(rkey);
                if (Array.isArray(currentCatalog) && currentCatalog.length > 5) {
                    const incomingCount = Array.isArray(value) ? value.length : 0;
                    const ratio = incomingCount / currentCatalog.length;

                    if (ratio < CIRCUIT_BREAKER_MIN_RATIO) {
                        const confirmed = localStorage.getItem('confirm_bulk_delete_catalog_flag') === 'true';
                        if (confirmed) {
                            localStorage.removeItem('confirm_bulk_delete_catalog_flag');
                            // Guardar copia de sombra del catálogo completo antes del borrado intencional
                            await shadowBackupService.saveShadow(rkey, currentCatalog);
                        } else {
                            if (typeof window !== 'undefined') {
                                window.dispatchEvent(new CustomEvent('circuit_breaker_triggered', {
                                    detail: { key, currentCount: currentCatalog.length, incomingCount, ratio }
                                }));
                            }
                            throw new Error(`[CircuitBreaker] Sobrescritura anómala bloqueada: el nuevo catálogo (${incomingCount}) es menor al 10% del catálogo actual (${currentCatalog.length}).`);
                        }
                    } else {
                        // Guardar copia de sombra previa a la modificación válida
                        await shadowBackupService.saveShadow(rkey, currentCatalog);
                    }
                }
            }

            await localforage.setItem(rkey, value);
            localStorage.removeItem(rkey); // FASE 1: contingencia namespaced
            localStorage.removeItem(key); // residuo legacy
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key } }));
            }
            // BACKUP-004/HOOK-014: el eco se corta EN LA COLA, no solo al ejecutar
            // el push. `queueCloudSync` usa debounce, así que para cuando el push
            // real corra el flag ya estaría restaurado; verificamos aquí, de forma
            // síncrona, mientras runWithoutEco mantiene el flag activo.
            if (!isSyncingFromCloud()) queueCloudSync(rkey, value);
        } catch (error) {
            // RE-LANZAR CircuitBreaker obligatoriamente para evitar que el catch general escriba en localStorage
            if (error?.message?.includes('[CircuitBreaker]')) {
                console.warn(error.message);
                throw error;
            }

            if (_isQuotaError(error)) {
                // La cola de reintentos guarda la clave FÍSICA (rkey) para no
                // escribir fuera del namespace del negocio al reintentar.
                _dispatchQuotaExceeded(rkey, value, error);
                try {
                    // FASE 1: la contingencia también va namespaced.
                    localStorage.setItem(rkey, typeof value === 'string' ? value : JSON.stringify(value));
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key } }));
                    }
                    console.warn(`[Storage] Quota IndexedDB llena para ${key}, salvado en localStorage como contingencia.`);
                    return;
                } catch (lsErr) {
                    if (_isQuotaError(lsErr)) {
                        _dispatchQuotaExceeded(rkey, value, lsErr);
                    }
                    console.error(`[Storage CRÍTICO] Ni IndexedDB ni LocalStorage aceptan ${key}. Operación encolada para reintento.`, lsErr);
                    return;
                }
            }
            console.error(`[Storage Error] Guardando ${key}:`, error);
            try {
                localStorage.setItem(rkey, typeof value === 'string' ? value : JSON.stringify(value)); // FASE 1
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key } }));
                }
            } catch (e) {
                console.error(`[Storage Error CRÍTICO] Ni IndexedDB ni LocalStorage funcionan para ${key}`, e);
            }
        }
    },

    /**
     * Elimina un item (enrutado al namespace del negocio activo).
     */
    async removeItem(key) {
        try {
            await localforage.removeItem(routeStorageKey(key));
            localStorage.removeItem(key); // Por si acaso quedó algún residuo sin prefijo
        } catch (error) {
            console.error(`[Storage Error] Borrando ${key}:`, error);
        }
    },

    /**
     * Limpieza para restauración desde backup.
     * MULTI-NEGOCIO (Fase 1): borra SOLO las claves del negocio activo en
     * IndexedDB (las namespaced `nb_<id>:`), nunca las de otros negocios.
     * Preserva la sesión de Supabase (sb-*) y las claves globales.
     */
    async clearAllData() {
        try {
            // 1. Limpiar solo el namespace del negocio activo en IndexedDB
            const negocioId = getNegocioActivoId();
            if (negocioId) {
                const prefix = `${NEGOCIO_KEY_PREFIX}${negocioId}:`;
                const keys = await localforage.keys();
                for (const k of keys) {
                    if (typeof k === 'string' && k.startsWith(prefix)) {
                        try { await localforage.removeItem(k); } catch { /* noop */ }
                    }
                }
                console.log('[clearAllData] IndexedDB del negocio limpiado.');
            } else {
                await localforage.clear();
                console.log('[clearAllData] IndexedDB limpiado.');
            }

            // 2. Limpiar claves del NEGOCIO ACTIVO en localStorage (namespaced).
            //    Las globales (tasas, business_*, premium_token, registro) se
            //    preservan: no pertenecen a un negocio.
            if (negocioId) {
                const prefix = `${NEGOCIO_KEY_PREFIX}${negocioId}:`;
                const doomed = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(prefix)) doomed.push(k);
                }
                doomed.forEach((k) => { try { localStorage.removeItem(k); } catch { /* noop */ } });
                console.log('[clearAllData] LocalStorage del negocio limpiado.');
            }

            // HOOK-007: tras limpiar, flush de la cola de reintentos por si había ops pendientes.
            _flushRetryQueue();
        } catch (error) {
            console.error('[Storage Error] Limpiando todo:', error);
            throw error; // Propagar para que el importador aborte si falla la limpieza
        }
    },

    /**
     * Devuelve (copia) el estado actual de la cola de reintentos por QuotaExceeded.
     * Útil para diagnóstico en UI.
     * @returns {Array<{ key: string, attempts: number }>}
     */
    getPendingRetries() {
        return _retryQueue.map(({ key, attempts }) => ({ key, attempts }));
    },

    /**
     * Reintenta manualmente todas las operaciones encoladas. Devuelve el número
     * de ops que se lograron persistir.
     */
    async flushRetries() {
        return _flushRetryQueue();
    },
};

// ─── Helpers internos (HOOK-007) ─────────────────────────────────────────

function routeAtomicBusinessKey(key, businessId) {
    if (key.startsWith(NEGOCIO_KEY_PREFIX)) return key;
    if (isGlobalKey(key)) return key;
    return businessId ? `${NEGOCIO_KEY_PREFIX}${businessId}:${key}` : key;
}

function atomicStorageError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

async function getAtomicIndexedDB() {
    await localforage.ready();
    if (localforage.driver() !== 'asyncStorage') throw atomicStorageError('ATOMIC_INDEXEDDB_REQUIRED');
    const dbInfo = localforage._dbInfo;
    const db = dbInfo?.db;
    const storeName = dbInfo?.storeName || localforage.config('storeName');
    if (!db || !storeName || !db.objectStoreNames.contains(storeName)) {
        throw atomicStorageError('ATOMIC_INDEXEDDB_UNAVAILABLE');
    }
    return { db, storeName };
}

function cloneAtomicDefault(value) {
    if (value === undefined) return undefined;
    try { return structuredClone(value); }
    catch { throw atomicStorageError('ATOMIC_DEFAULT_NOT_CLONEABLE'); }
}

function atomicStableValue(value, seen = new Set()) {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (value instanceof Date) return `date:${value.toISOString()}`;
    if (seen.has(value)) throw atomicStorageError('ATOMIC_VALUE_NOT_COMPARABLE');
    if (Array.isArray(value)) {
        seen.add(value);
        const result = `[${value.map(item => atomicStableValue(item, seen)).join(',')}]`;
        seen.delete(value);
        return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw atomicStorageError('ATOMIC_VALUE_NOT_COMPARABLE');
    seen.add(value);
    const result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${atomicStableValue(value[key], seen)}`).join(',')}}`;
    seen.delete(value);
    return result;
}

function atomicValuesEqual(value, expectedFingerprint) {
    return atomicStableValue(value) === expectedFingerprint;
}

function freezeAtomicValue(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
    seen.add(value);
    for (const child of Object.values(value)) freezeAtomicValue(child, seen);
    return Object.freeze(value);
}

function runAtomicKeyTransaction({ db, storeName, mode, keys, expectedRaw = {}, writes = {}, defaults = {} }) {
    return new Promise((resolve, reject) => {
        let tx;
        try {
            tx = mode === 'readwrite'
                ? db.transaction(storeName, mode, { durability: 'strict' })
                : db.transaction(storeName, mode);
        } catch (error) {
            if (error?.name !== 'TypeError') { reject(error); return; }
            try { tx = db.transaction(storeName, mode); }
            catch (fallbackError) { reject(fallbackError); return; }
        }
        let cause;
        let settled = false;
        tx.onerror = event => {
            cause ||= event.target?.error || tx.error || atomicStorageError('ATOMIC_TRANSACTION_FAILED');
            try { tx.abort(); } catch { /* transaction already inactive */ }
        };
        tx.onabort = () => {
            if (settled) return;
            settled = true;
            reject(cause || tx.error || atomicStorageError('ATOMIC_TRANSACTION_ABORTED'));
        };
        tx.oncomplete = () => {
            if (settled) return;
            settled = true;
            resolve(mode === 'readonly' ? { values, raw } : undefined);
        };
        const fail = error => {
            cause ||= error;
            try { tx.abort(); } catch { /* transaction already inactive; abort handler owns settlement */ }
        };
        const raw = {};
        const values = {};
        try {
            const store = tx.objectStore(storeName);
            let remaining = keys.length;
            const onRead = (key, request) => {
                request.onerror = () => fail(request.error || atomicStorageError('ATOMIC_READ_FAILED'));
                request.onsuccess = () => {
                    try {
                        raw[key] = request.result;
                        if (mode === 'readonly') {
                            values[key] = request.result === undefined ? defaults[key] : request.result;
                        }
                        remaining--;
                        if (remaining !== 0) return;
                        if (mode === 'readonly') return;
                        for (const expectedKey of keys) {
                            if (!atomicValuesEqual(raw[expectedKey], expectedRaw[expectedKey])) {
                                fail(atomicStorageError('ATOMIC_SNAPSHOT_CONFLICT'));
                                return;
                            }
                        }
                        for (const [writeKey, value] of Object.entries(writes)) {
                            const request = store.put(value, writeKey);
                            request.onerror = () => fail(request.error || atomicStorageError('ATOMIC_WRITE_FAILED'));
                        }
                    } catch (error) { fail(error); }
                };
            };
            for (const key of keys) onRead(key, store.get(key));
        } catch (error) { fail(error); }
    });
}

function _isQuotaError(err) {
    if (!err) return false;
    if (err.name === 'QuotaExceededError') return true;
    if (err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true; // Firefox
    if (err.code === 22 || err.code === 1014) return true; // Legacy codes
    if (typeof err.message === 'string' && /quota/i.test(err.message)) return true;
    return false;
}

function _dispatchQuotaExceeded(key, value, originalError) {
    // Encolar para reintento
    _retryQueue.push({ key, value, attempts: 0 });
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quota_exceeded', {
            detail: {
                key,
                queueLength: _retryQueue.length,
                message: originalError?.message || 'QuotaExceededError',
            },
        }));
    }
}

async function _flushRetryQueue() {
    let flushed = 0;
    while (_retryQueue.length > 0) {
        const op = _retryQueue[0];
        if (op.attempts >= QUOTA_RETRY_MAX) {
            _retryQueue.shift();
            console.warn(`[Storage] Descartando op encolada para ${op.key} tras ${QUOTA_RETRY_MAX} intentos.`);
            continue;
        }
        op.attempts++;
        try {
            await localforage.setItem(op.key, op.value);
            _retryQueue.shift();
            flushed++;
        } catch (err) {
            if (_isQuotaError(err)) {
                // Aún sin espacio; dejar en cola y parar el flush.
                break;
            }
            // Error no relacionado con cuota: descartar para no reintentar indefinidamente.
            _retryQueue.shift();
            console.error(`[Storage] Error no-cuota reintentando ${op.key}:`, err);
        }
    }
    return flushed;
}

export default storageService;
