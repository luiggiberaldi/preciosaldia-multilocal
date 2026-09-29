/**
 * bootNegocios.js — Arranque multi-negocio (Fase 1).
 *
 * `bootNegocios()` debe correrse UNA vez antes del primer render (ver main.jsx):
 *
 * 1. Si ya existe el registro de negocios → fija el negocio activo en memoria
 *    y sincroniza el espejo fiscal. No hace nada más (rápido).
 * 2. Si NO existe (primer arranque tras actualizar / instalación nueva) →
 *    MIGRACIÓN AUTOMÁTICA:
 *      a. Mueve todas las claves de IndexedDB no-globales y sin prefijo a
 *         `nb_neg-1:<clave>` (el negocio "Mi negocio"). MOVER, no copiar:
 *         sin pérdida ni duplicados.
 *      b. Mueve las claves de auth (`abasto-auth-storage`, `abasto-device-session`)
 *         a su versión namespaced (PINs/usuarios/sesión por negocio).
 *      c. Crea el registro con "Mi negocio" (`neg-1`), heredando
 *         `business_name`/`business_rif` si ya existían.
 *      d. Sincroniza el espejo fiscal.
 *
 * Después del boot, `useNegociosStore` y `useAuthStore` se rehidratan desde
 * las claves correctas (ver main.jsx).
 *
 * @module utils/bootNegocios
 */
import localforage from 'localforage';
import {
    NEGOCIOS_REGISTRY_KEY,
    NEGOCIO_KEY_PREFIX,
    DEFAULT_NEGOCIO_ID,
    DEFAULT_NEGOCIO_NOMBRE,
    GLOBAL_STORAGE_KEYS,
    isNegocioKey,
    setNegocioActivoId,
    syncFiscalMirror,
} from './negocioContext';

localforage.config({
    name: 'BodegaApp',
    storeName: 'bodega_app_data',
    description: 'Almacenamiento local optimizado para PWA de Bodega'
});

// Claves de auth en localStorage que se mueven al namespace del negocio.
const AUTH_LS_KEYS = ['abasto-auth-storage', 'abasto-device-session'];

function _readRegistry() {
    try {
        const raw = localStorage.getItem(NEGOCIOS_REGISTRY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const state = parsed?.state ?? parsed;
        if (!state || !Array.isArray(state.negocios) || state.negocios.length === 0) return null;
        return state;
    } catch {
        return null;
    }
}

async function _migrateIndexedDBKeys(targetPrefix) {
    let moved = 0;
    let keys = [];
    try {
        keys = await localforage.keys();
    } catch (e) {
        console.error('[bootNegocios] No se pudieron listar claves IndexedDB:', e);
        return 0;
    }
    for (const key of keys) {
        if (typeof key !== 'string') continue;
        if (GLOBAL_STORAGE_KEYS.has(key)) continue;   // globales: se quedan
        if (isNegocioKey(key)) continue;              // ya migrada: se queda
        try {
            const val = await localforage.getItem(key);
            await localforage.setItem(`${targetPrefix}${key}`, val);
            await localforage.removeItem(key);
            moved++;
        } catch (e) {
            console.error(`[bootNegocios] Falló migrar clave ${key}:`, e);
        }
    }
    return moved;
}

function _migrateAuthKeys(targetPrefix) {
    let moved = 0;
    for (const key of AUTH_LS_KEYS) {
        try {
            const namespaced = `${targetPrefix}${key}`;
            const raw = localStorage.getItem(key);
            if (raw === null) continue;
            if (localStorage.getItem(namespaced) === null) {
                localStorage.setItem(namespaced, raw);
            }
            localStorage.removeItem(key);
            moved++;
        } catch (e) {
            console.error(`[bootNegocios] Falló migrar clave auth ${key}:`, e);
        }
    }
    return moved;
}

export async function bootNegocios() {
    const existing = _readRegistry();
    if (existing) {
        // Arranque normal: el módulo negocioContext ya leyó el id al evaluarse;
        // lo reafirmamos y sincronizamos el espejo fiscal.
        setNegocioActivoId(existing.negocioActivoId);
        syncFiscalMirror();
        return { migrated: false, negocioActivoId: existing.negocioActivoId };
    }

    // ── Migración automática (una sola vez) ──────────────────────────
    const targetPrefix = `${NEGOCIO_KEY_PREFIX}${DEFAULT_NEGOCIO_ID}:`;
    console.info('[bootNegocios] Sin registro: migrando datos existentes a "Mi negocio"...');

    const movedIdb = await _migrateIndexedDBKeys(targetPrefix);
    const movedAuth = _migrateAuthKeys(targetPrefix);

    // Heredar datos fiscales si ya existían.
    let prevName = '';
    let prevRif = '';
    try {
        prevName = localStorage.getItem('business_name') || '';
        prevRif = localStorage.getItem('business_rif') || '';
    } catch { /* noop */ }

    const negocio = {
        id: DEFAULT_NEGOCIO_ID,
        nombre: DEFAULT_NEGOCIO_NOMBRE,
        rif: prevRif,
        direccion: '',
        telefono: '',
        createdAt: new Date().toISOString(),
    };
    // Si había un nombre comercial configurado, "Mi negocio" lo adopta.
    if (prevName.trim()) negocio.nombre = prevName.trim();

    const payload = {
        state: { negocios: [negocio], negocioActivoId: DEFAULT_NEGOCIO_ID },
        version: 0,
    };
    try {
        localStorage.setItem(NEGOCIOS_REGISTRY_KEY, JSON.stringify(payload));
    } catch (e) {
        console.error('[bootNegocios] No se pudo guardar el registro:', e);
    }

    setNegocioActivoId(DEFAULT_NEGOCIO_ID);
    syncFiscalMirror();

    // NOTA: no rehidratamos useNegociosStore aquí — el llamador (main.jsx)
    // lo hace tras el boot. Así bootNegocios no arrastra la cadena
    // auditService → storageService → useCloudSync en este punto crítico.

    console.info(
        `[bootNegocios] Migración completa: ${movedIdb} claves IndexedDB + ${movedAuth} claves auth → ${targetPrefix}`
    );
    return { migrated: true, negocioActivoId: DEFAULT_NEGOCIO_ID, movedIdb, movedAuth };
}
