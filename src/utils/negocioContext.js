/**
 * negocioContext.js — Núcleo del multi-negocio (Fase 1).
 *
 * Este módulo es la única fuente de verdad sobre QUÉ negocio está activo y
 * CÓMO se aíslan sus datos:
 *
 *  - El negocio activo vive en un módulo mutable (`_negocioActivoId`), que se
 *    inicializa de forma SÍNCRONA desde el registro en localStorage al evaluar
 *    el módulo, y que `useNegociosStore` mantiene actualizado.
 *  - `routeStorageKey(key)`: antepone `nb_<id>:` a toda clave de datos del
 *    negocio. Las claves en `GLOBAL_STORAGE_KEYS` (tasas, identidad del
 *    dispositivo, registro de negocios, espejo fiscal, prefs UI) NO se tocan.
 *  - `routeAuthKey(key)`: los PIN/usuarios/sesión SIEMPRE van namespaced
 *    (cada negocio tiene su personal).
 *  - `toCloudDocId(key)` / `parseCloudDocId(docId)`: el sync cloud separa por
 *    negocio con `doc_id = nb_<id>:<clave>`; las globales quedan sin prefijo.
 *
 * Regla de oro: NADA fuera de aquí decide si una clave lleva prefijo o no.
 *
 * @module utils/negocioContext
 */

export const NEGOCIOS_REGISTRY_KEY = 'pda-negocios-registry';
export const NEGOCIO_KEY_PREFIX = 'nb_';
export const DEFAULT_NEGOCIO_ID = 'neg-1';
export const DEFAULT_NEGOCIO_NOMBRE = 'Mi negocio';
export const NEGOCIO_CHANGED_EVENT = 'pda:negocio-changed';

/**
 * Claves que NUNCA se namespacing: son globales del dispositivo/app.
 * - Tasas BCV/paralelo/USDT: compartidas entre negocios (decisión de negocio).
 * - Identidad del dispositivo y pairing: el teléfono es el mismo.
 * - Registro de negocios: la fuente de verdad no puede aislarse por negocio.
 * - Espejo fiscal (`business_*`): `bootNegocios`/`useNegociosStore` lo mantienen
 *   sincronizado con los datos fiscales del negocio ACTIVO, así todo el código
 *   existente que lee `business_name`/`business_rif` sigue funcionando.
 * - Preferencias UI, licencia: a nivel dispositivo.
 */
export const GLOBAL_STORAGE_KEYS = new Set([
    // Registro de negocios
    'pda-negocios-registry',
    // Registro de negocios sincronizado (multi-sede, v2.1.36)
    'bodega_businesses_registry_v1',
    // Identidad del dispositivo / pairing / sync
    'pda_device_id',
    'pda_pairing_mode',
    'pda_last_splash_date',
    'pda_backup_imported_flag',
    'pda_cloud_sync_pending',
    'cloud_sync_ts',
    // Tasas (globales y compartidas)
    'monitor_rates_v12',
    'bodega_custom_rate',
    'bodega_use_auto_rate',
    'bodega_rate_mode',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled',
    'street_rate_bs',
    'catalog_use_auto_usdt',
    'catalog_custom_usdt_price',
    'catalog_show_cash_price',
    'cop_primary',
    'pda_rate_mode',
    // Licencia
    'premium_token',
    // Espejo fiscal del negocio activo (ver syncFiscalMirror)
    'business_name',
    'business_rif',
    'business_direccion',
    'business_telefono',
    // Preferencias UI / dispositivo
    'theme',
    'ui_scale',
    'ios_install_dismissed',
    'bodega_inventory_view',
    'printer_paper_width',
    'allow_negative_stock',
    'label_currency_mode',
    // Flag legado de demo (ya no se escribe; se conserva protegido)
    'pda_demo_flag_v1',
    // PIN maestro global del dueño (Fase 1.5): jamás namespaced, jamás atado
    // a un negocio. Ver utils/duenoAuth.js.
    'pda-dueno-pin',
    'pda-dueno-session',
    'pda-dueno-pin-lock',
]);

function _lsGet(key) {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function _readActiveIdFromRegistry() {
    try {
        const raw = _lsGet(NEGOCIOS_REGISTRY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Formato zustand persist: { state: {...} }. Toleramos plano también.
        const state = parsed?.state ?? parsed;
        return typeof state?.negocioActivoId === 'string' ? state.negocioActivoId : null;
    } catch {
        return null;
    }
}

// Inicialización síncrona al evaluar el módulo: antes de que cualquier
// store/contexto lea storage, el id ya está disponible (salvo primer arranque,
// donde bootNegocios() lo fija antes del primer render).
let _negocioActivoId = _readActiveIdFromRegistry();

/** @returns {string|null} id del negocio activo */
export function getNegocioActivoId() {
    return _negocioActivoId;
}

/** Fija el negocio activo en memoria (lo persiste useNegociosStore). */
export function setNegocioActivoId(id) {
    _negocioActivoId = typeof id === 'string' && id ? id : null;
}

/** @returns {boolean} true si la clave es global (sin prefijo de negocio) */
export function isGlobalKey(key) {
    return typeof key === 'string' && GLOBAL_STORAGE_KEYS.has(key);
}

/** @returns {boolean} true si la clave ya trae prefijo de negocio */
export function isNegocioKey(key) {
    return typeof key === 'string' && key.startsWith(NEGOCIO_KEY_PREFIX);
}

/**
 * Router de storage: antepone `nb_<id>:` a las claves de datos del negocio.
 * Idempotente: una clave ya namespaced o global se devuelve intacta.
 * Si aún no hay negocio activo (ventana del primer boot), pasa sin prefijo.
 */
export function routeStorageKey(key) {
    if (typeof key !== 'string' || !key) return key;
    if (isGlobalKey(key) || isNegocioKey(key)) return key;
    const id = getNegocioActivoId();
    return id ? `${NEGOCIO_KEY_PREFIX}${id}:${key}` : key;
}

/**
 * Router para auth (PINs/usuarios/sesión): SIEMPRE namespaced por negocio.
 * A diferencia de routeStorageKey, aquí no hay excepciones globales.
 */
export function routeAuthKey(key) {
    if (typeof key !== 'string' || !key) return key;
    if (isNegocioKey(key)) return key;
    const id = getNegocioActivoId();
    return id ? `${NEGOCIO_KEY_PREFIX}${id}:${key}` : key;
}

/**
 * Convierte una clave lógica de storage en el `doc_id` para `sync_documents`.
 * Convención Fase 1: `doc_id = nb_<negocioId>:<clave>`; las claves globales
 * (tasas, etc.) quedan sin prefijo.
 */
export function toCloudDocId(key) {
    if (typeof key !== 'string' || !key) return key;
    if (isGlobalKey(key)) return key;
    const id = getNegocioActivoId();
    if (!id) return key;
    const prefix = `${NEGOCIO_KEY_PREFIX}${id}:`;
    return key.startsWith(prefix) ? key : `${prefix}${key}`;
}

/**
 * Inversa de toCloudDocId.
 * @returns {{ negocioId: string|null, key: string }}
 */
export function parseCloudDocId(docId) {
    if (typeof docId !== 'string' || !docId) return { negocioId: null, key: docId };
    const m = docId.match(/^nb_([^:]+):(.+)$/);
    if (!m) return { negocioId: null, key: docId };
    return { negocioId: m[1], key: m[2] };
}

/**
 * ¿Debe aplicarse localmente un documento remoto con este doc_id?
 * - Documentos de otro negocio → no.
 * - Documentos legacy sin prefijo (pre-Fase 1) → solo si son globales
 *   (tasas, etc.); los de datos se ignoran porque el push local los
 *   re-publica namespaced.
 * - `abasto-auth-storage` → nunca (SEC-002).
 */
export function isDocForActiveBusiness(docId) {
    const { negocioId, key } = parseCloudDocId(docId);
    if (key === 'abasto-auth-storage') return false;
    if (negocioId) return negocioId === getNegocioActivoId();
    return isGlobalKey(key);
}

/**
 * V2.1.50: el supervisor necesita datos de TODAS las sedes, no solo la activa.
 * Retorna true si el doc es para el negocio activo, para cualquier negocio
 * en el registro local, o si es una clave global.
 * Solo se usa en el PULL (la subida sigue siendo solo del negocio activo).
 */
export function isDocForKnownBusiness(docId) {
    const { negocioId, key } = parseCloudDocId(docId);
    if (key === 'abasto-auth-storage') return false;
    if (!negocioId) return isGlobalKey(key);
    if (negocioId === getNegocioActivoId()) return true;
    // ¿Está en el registro de negocios conocido?
    try {
        const state = _readRegistryState();
        const ids = (state?.negocios || []).map((n) => n?.id).filter(Boolean);
        return ids.includes(negocioId);
    } catch {
        return false;
    }
}

/** Lee el registro crudo (sin depender del store). */
function _readRegistryState() {
    try {
        const raw = _lsGet(NEGOCIOS_REGISTRY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const state = parsed?.state ?? parsed;
        if (!state || !Array.isArray(state.negocios)) return null;
        return state;
    } catch {
        return null;
    }
}

/** @returns {Array} negocios registrados */
export function getNegocios() {
    return _readRegistryState()?.negocios ?? [];
}

/** @returns {object|null} el negocio activo con sus datos fiscales */
export function getNegocioActivo() {
    const state = _readRegistryState();
    if (!state) return null;
    return state.negocios.find((n) => n.id === state.negocioActivoId) ?? null;
}

/**
 * Espejo fiscal: vuelca los datos fiscales del negocio activo a las claves
 * `business_*` de localStorage, que es lo que lee todo el código existente
 * (ticketGenerator, recibos, WhatsApp, impresora). La fuente de verdad es el
 * registro; esto es solo una vista materializada del negocio activo.
 */
export function syncFiscalMirror() {
    try {
        if (typeof localStorage === 'undefined') return;
        const n = getNegocioActivo();
        if (!n) return;
        localStorage.setItem('business_name', n.nombre || '');
        localStorage.setItem('business_rif', n.rif || '');
        localStorage.setItem('business_direccion', n.direccion || '');
        localStorage.setItem('business_telefono', n.telefono || '');
    } catch {
        /* noop */
    }
}
