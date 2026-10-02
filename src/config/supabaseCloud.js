import { createClient } from '@supabase/supabase-js';

// ────────────────────────────────────────────────────────────────────────────
// Proyecto del CLIENTE (dinámico): cada cliente Pro tiene su propio proyecto
// Supabase (tier gratis). El proyecto se resuelve con el código de licencia
// (vía el directorio de la Estación) y se recuerda en localStorage para que
// la app abra sin internet.
//
// `supabaseCloud` es un Proxy perezoso: todo el código existente lo sigue
// usando igual (`supabaseCloud.from(...)`, `supabaseCloud.auth...`). Si se
// toca antes de resolver el proyecto, lanza un error claro en vez de fallar
// en silencio.
// ────────────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'pda_customer_project'; // { url, key, code }
const useSupervisorE2EStaging = import.meta.env.VITE_SUPERVISOR_E2E_STAGING === 'true';

const stagingUrl =
    import.meta.env.VITE_SUPABASE_STAGING_URL || 'https://tdfcpwctvumbdjmifypd.supabase.co';
const stagingKey = import.meta.env.VITE_SUPABASE_STAGING_KEY;

let _client = null;
let _resolved = null; // { url, key, code } | null

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        return p && p.url && p.key ? p : null;
    } catch {
        return null;
    }
}

function buildClient(url, key) {
    return createClient(url, key, {
        auth: {
            // La sesión identifica al dispositivo ante RLS; no contiene PINs del POS.
            // Debe persistir para que una recarga o un corte de internet no pierda
            // el vínculo: el gate acepta la sesión guardada aunque no haya red.
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
        },
    });
}

/**
 * Devuelve el cliente del proyecto del cliente, o null si aún no se resolvió
 * (→ mostrar el CloudGate). Nunca hace handshake de red por sí solo.
 */
export function ensureCustomerClient() {
    if (_client) return _client;
    if (useSupervisorE2EStaging) {
        if (!stagingKey) {
            throw new Error('Falta VITE_SUPABASE_STAGING_KEY para ejecutar E2E contra staging');
        }
        _resolved = { url: stagingUrl, key: stagingKey, code: 'STAGING' };
        _client = buildClient(stagingUrl, stagingKey);
        return _client;
    }
    const cached = readCache();
    if (!cached) return null;
    _resolved = cached;
    _client = buildClient(cached.url, cached.key);
    return _client;
}

export function hasCustomerProject() {
    return useSupervisorE2EStaging || !!_client || !!readCache();
}

/** Fija el proyecto del cliente (tras resolver el código) y lo recuerda. */
export function setCustomerProject({ url, key, code, maxDevices, revokedDeviceIds }) {
    _resolved = { url, key, code, maxDevices: maxDevices ?? 6, revokedDeviceIds: revokedDeviceIds || [] };
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(_resolved));
    } catch {
        /* almacenamiento no disponible: se resuelve de nuevo al recargar */
    }
    _client = buildClient(url, key);
    return _client;
}

export function getCustomerProject() {
    return _resolved || readCache();
}

/** Desvincula este equipo: cierra sesión y olvida el proyecto. */
export async function clearCustomerProject() {
    try {
        await _client?.auth.signOut();
    } catch {
        /* sin red: igual se olvida local */
    }
    _client = null;
    _resolved = null;
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch {
        /* noop */
    }
}

export const supabaseCloud = new Proxy(
    {},
    {
        get(_t, prop) {
            // Evita que `await supabaseCloud` o inspecciones lo traten como thenable.
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            const c = ensureCustomerClient();
            if (!c) {
                throw new Error(
                    '[CloudGate] Proyecto del cliente sin resolver: ingresa el código de licencia primero.'
                );
            }
            const v = c[prop];
            return typeof v === 'function' ? v.bind(c) : v;
        },
    }
);

// ────────────────────────────────────────────────────────────────────────────
// DIRECTORIO (Estación): proyecto FIJO y compartido. Solo resuelve
// código de licencia → { supabase_url, supabase_anon_key } del cliente.
// No guarda sesión (persistSession: false).
// Requiere VITE_DIRECTORY_URL y VITE_DIRECTORY_ANON_KEY en el entorno.
// ────────────────────────────────────────────────────────────────────────────

const directoryUrl =
    import.meta.env.VITE_DIRECTORY_URL || 'https://sodgzkablshladvbtnes.supabase.co';
const directoryKey = import.meta.env.VITE_DIRECTORY_ANON_KEY || '';

export const directoryClient = directoryKey
    ? createClient(directoryUrl, directoryKey, {
          auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export function hasDirectory() {
    return !!directoryClient;
}
