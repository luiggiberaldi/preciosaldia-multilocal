/**
 * deviceBackend.js — Guard para el backend de dispositivos/licencias.
 *
 * Contexto: el backend de licencias/dispositivos (`licenses`, `backup_requests`,
 * RPCs `get_license_status` / `auto_register_device` / `heartbeat_device`) NO
 * existe en Supabase (el modelo comercial no está decidido). La app lo consulta
 * en varios `setInterval`, lo que genera ráfagas de 404 en la consola del
 * navegador. Esos 404 los pinta Chrome automáticamente por cada fetch fallido:
 * desde JS no se pueden "silenciar" — la única forma de limpiar el log es
 * dejar de hacer las peticiones.
 *
 * Estrategia:
 * - `isDeviceBackendDown()`: true si ya confirmamos (en esta sesión o en
 *   localStorage con TTL de 24 h) que el backend no está implementado.
 * - `markDeviceBackendDown()` / `markDeviceBackendUp()`: actualizan el estado.
 * - `isBackendMissingError(err)`: detecta el "no implementado" (404 de
 *   PostgREST, códigos PGRST2xx, mensajes "not found"/"does not exist").
 *   OJO: errores de red, 401/403 (RLS) o 500 NO marcan como caído — en esos
 *   casos el backend existe pero no responde, y hay que seguir intentando.
 * - Cuando el backend se cree en Supabase (tablas + RPCs), el TTL expira, la
 *   app vuelve a intentar y `markDeviceBackendUp()` reactiva todo solo.
 *
 * Puro salvo localStorage; sin imports para evitar ciclos.
 */

const LS_KEY = 'pda_device_backend_down_v1';
/** Tras este tiempo sin backend, se vuelve a intentar (por si ya lo crearon). */
export const DEVICE_BACKEND_RETRY_MS = 24 * 60 * 60 * 1000;

let downCache = null; // null = desconocido, true/false = confirmado
let skippedLogged = false;

function readMarker() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return false;
        const ts = Number(raw);
        if (!ts || Number.isNaN(ts)) return false;
        if (Date.now() - ts > DEVICE_BACKEND_RETRY_MS) {
            try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/** true si ya sabemos que el backend de dispositivos no está implementado. */
export function isDeviceBackendDown() {
    if (downCache !== null) return downCache;
    downCache = readMarker();
    return downCache;
}

/** Marca el backend como no implementado (deja de intentarlo por 24 h). */
export function markDeviceBackendDown() {
    downCache = true;
    try { localStorage.setItem(LS_KEY, String(Date.now())); } catch { /* noop */ }
}

/** Marca el backend como disponible (reactiva las llamadas). */
export function markDeviceBackendUp() {
    downCache = false;
    try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
}

/** Solo para tests: olvida el estado en memoria. */
export function resetDeviceBackendCache() {
    downCache = null;
    skippedLogged = false;
}

/**
 * ¿El error significa "tabla/función no existe en Supabase"?
 * PostgREST responde 404 cuando el objeto no está en el schema cache
 * (códigos PGRST2xx). No confundir con red caída, 401/403 ni 500.
 */
export function isBackendMissingError(err) {
    if (!err || typeof err !== 'object') return false;
    const code = String(err.code ?? '');
    // PGRST2xx = el objeto no existe en el schema cache (404 de PostgREST).
    // PGRST301 = JWT inválido/expirado → NO es "no implementado".
    if (/^PGRST2\d\d$/.test(code)) return true;
    const status = Number(err.status ?? err.statusCode ?? NaN);
    if (status === 404) return true;
    const msg = String(err.message ?? '').toLowerCase();
    return (
        msg.includes('not found') ||
        msg.includes('does not exist') ||
        msg.includes('no existe') ||
        msg.includes('could not find the function') ||
        msg.includes('could not find the table')
    );
}

/**
 * Log informativo único por sesión cuando se omiten llamadas al backend.
 * No es un error: es el estado esperado hasta que se cree el backend.
 */
export function noteDeviceBackendSkipped(origen) {
    if (skippedLogged) return;
    skippedLogged = true;
    try {
        console.info(
            `[Nube] Backend de dispositivos no configurado (${origen}): ` +
            'se omiten licencia/heartbeat/backup remoto. La app sigue 100% local. ' +
            'Se reintentará automáticamente en 24 h.'
        );
    } catch { /* noop */ }
}
