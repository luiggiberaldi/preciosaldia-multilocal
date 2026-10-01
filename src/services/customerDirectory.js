/**
 * customerDirectory.js — resuelve el código de licencia al proyecto Supabase
 * del cliente usando el directorio de la Estación (RPC `lookup_customer_project`).
 *
 * El directorio solo expone url + anon key (la key es pública por diseño);
 * el email del dueño nunca sale del directorio.
 */
import { directoryClient, hasDirectory } from '../config/supabaseCloud.js';

export async function lookupProjectByCode(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return { ok: false, error: 'Ingresa tu código de licencia.' };
    if (!hasDirectory()) {
        return {
            ok: false,
            error: 'Falta configurar el directorio en la app (VITE_DIRECTORY_ANON_KEY).',
        };
    }
    try {
        const { data, error } = await directoryClient.rpc('lookup_customer_project', {
            p_code: clean,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.supabase_url || !row.supabase_anon_key) {
            return { ok: false, error: 'Código no encontrado. Revísalo o pide ayuda.' };
        }
        return {
            ok: true,
            project: { url: row.supabase_url, key: row.supabase_anon_key, code: clean },
        };
    } catch (e) {
        const offline =
            typeof navigator !== 'undefined' &&
            (navigator.onLine === false || /fetch|network|Failed to fetch/i.test(e?.message || ''));
        return {
            ok: false,
            error: offline
                ? 'Sin conexión. Conéctate a internet una vez para activar tu licencia.'
                : `No se pudo verificar el código: ${e?.message || 'error desconocido'}`,
        };
    }
}
