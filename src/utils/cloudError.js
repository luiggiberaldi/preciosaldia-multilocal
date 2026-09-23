/**
 * cloudError.js — Clasificador de errores de respaldo en la nube (BACKUP-ERR).
 *
 * Problema que resuelve:
 *   - Los handlers de useCloudBackup mostraban `error.message` crudo o el
 *     genérico "Error contactando la nube". Un 42501 (RLS), un PGRST204
 *     (columna inexistente) o un fallo de red requieren explicaciones y
 *     acciones distintas.
 *
 * Solución: función pura que traduce cualquier error de Supabase/PostgREST/
 * fetch a { code, title, detail, hint, technical } listo para la UI.
 *
 * @module utils/cloudError
 */

/**
 * @typedef {Object} CloudErrorInfo
 * @property {string} code       Código de error detectado (ej: '42501', 'PGRST204', 'NETWORK').
 * @property {string} title      Título corto para UI.
 * @property {string} detail     Explicación de la causa probable.
 * @property {string} hint       Acción recomendada para el usuario.
 * @property {string} technical  Mensaje técnico original (para log/auditoría).
 */

const GENERIC = {
    code: 'UNKNOWN',
    title: 'No se pudo completar la operación en la nube',
    detail: 'Ocurrió un error inesperado al comunicarse con Supabase.',
    hint: 'Revisa tu conexión e inténtalo de nuevo. Si persiste, contacta soporte con el detalle técnico.',
};

/**
 * Traduce un error de Supabase/PostgREST/fetch a un mensaje accionable.
 * @param {any} err Error (objeto Supabase, Error, string, Response-like, etc.)
 * @returns {CloudErrorInfo}
 */
export function describeCloudError(err) {
    if (!err) return { ...GENERIC, technical: 'error desconocido (sin objeto)' };

    // ── Extraer campos del error ────────────────────────────────────────────
    const code = typeof err.code === 'string' ? err.code : null;
    const message = typeof err.message === 'string' ? err.message
        : typeof err === 'string' ? err
        : null;
    const details = typeof err.details === 'string' ? err.details : null;
    const status = typeof err.status === 'number' ? err.status : null;

    const technical = [code, message, details, status ? `HTTP ${status}` : null]
        .filter(Boolean).join(' | ') || String(err);

    // ── Clasificación por código PostgREST/Supabase ─────────────────────────
    // 42501: row-level security. El dispositivo no tiene permiso sobre la fila.
    if (code === '42501' || /row-level security/i.test(message || '') || /violate[sd]? row-level/i.test(message || '')) {
        return {
            code: '42501',
            title: 'Permisos insuficientes en la nube (RLS)',
            detail: 'Supabase bloqueó la operación: tu sesión de dispositivo no tiene permitido guardar o leer respaldos en cloud_backups.',
            hint: 'Usa "Exportar Backup" (archivo) como respaldo inmediato y contacta soporte para habilitar el acceso directo a la nube de este equipo.',
            technical,
        };
    }

    // PGRST204: columna inexistente en el esquema (schema cache).
    if (code === 'PGRST204' || /could not find the .* column/i.test(message || '')) {
        const colMatch = /'([^']+)'/.exec(message || '');
        const col = colMatch ? colMatch[1] : 'desconocida';
        return {
            code: 'PGRST204',
            title: 'Esquema de la nube desactualizado',
            detail: `La tabla de respaldos en la nube no tiene la columna "${col}" que esta versión de la app intenta usar.`,
            hint: 'Actualiza la app desde la tienda o contacta soporte: la base de datos necesita una migración para esta versión.',
            technical,
        };
    }

    // PGRST116 / 406: 0 o varias filas cuando .single()/.maybeSingle() espera una.
    if (code === 'PGRST116' || status === 406) {
        return {
            code: 'PGRST116',
            title: 'Respuesta inesperada de la nube',
            detail: 'La consulta devolvió cero o múltiples filas donde se esperaba exactamente una.',
            hint: 'Vuelve a intentarlo; si persiste, el backup en la nube podría estar vacío o duplicado.',
            technical,
        };
    }

    // 42P01: tabla definida en el código pero no creada en la base.
    if (code === '42P01' || /relation .* does not exist/i.test(message || '')) {
        return {
            code: '42P01',
            title: 'Tabla faltante en la nube',
            detail: 'La base de datos no tiene creada la tabla necesaria para esta operación de respaldo.',
            hint: 'Contacta soporte: falta ejecutar una migración en Supabase.',
            technical,
        };
    }

    // 23505: duplicado.
    if (code === '23505') {
        return {
            code: '23505',
            title: 'Registro duplicado en la nube',
            detail: 'Ya existe un respaldo con la misma clave única.',
            hint: 'Inténtalo de nuevo en unos segundos; el sistema lo resolverá al reintentar.',
            technical,
        };
    }

    // 401/403: autenticación/autorización a nivel HTTP.
    if (status === 401 || status === 403 || /invalid api key|jwt|unauthorized/i.test(message || '')) {
        return {
            code: String(status || '401'),
            title: 'Sesión de nube inválida',
            detail: 'Las credenciales del dispositivo no fueron aceptadas por Supabase.',
            hint: 'Cierra y vuelve a abrir la app para renovar tu sesión; si persiste, contacta soporte.',
            technical,
        };
    }

    // 404: recurso no encontrado (tabla/ruta).
    if (status === 404) {
        return {
            code: '404',
            title: 'Recurso no encontrado en la nube',
            detail: 'El endpoint o la tabla consultada no existe en el proyecto de Supabase.',
            hint: 'Contacta soporte: la configuración de la nube no coincide con esta versión de la app.',
            technical,
        };
    }

    // 5xx / PGRST: errores del servidor.
    if ((status && status >= 500) || /^PGRST/.test(code || '')) {
        return {
            code: code || String(status),
            title: 'Error del servidor de la nube',
            detail: 'Supabase reportó un problema interno al procesar el respaldo.',
            hint: 'Espera unos minutos e inténtalo de nuevo. Tus datos locales no se vieron afectados.',
            technical,
        };
    }

    // ── Errores de red (fetch TypeError) ────────────────────────────────────
    if (err instanceof TypeError || /network|failed to fetch|load failed|fetch failed|navigator\.onLine === false/i.test(message || '')) {
        return {
            code: 'NETWORK',
            title: 'Sin conexión con la nube',
            detail: 'No se pudo alcanzar el servidor de Supabase (red caída, sin internet o bloqueo del navegador).',
            hint: 'Verifica tu conexión a internet e inténtalo de nuevo.',
            technical,
        };
    }

    // ── Fallback ────────────────────────────────────────────────────────────
    return { ...GENERIC, technical };
}

/**
 * Variante para `showToast`: devuelve una sola línea lista para mostrar.
 * @param {any} err
 * @returns {string}
 */
export function describeCloudErrorShort(err) {
    const info = describeCloudError(err);
    return `${info.title}. ${info.hint}`;
}

/**
 * Detecta si un error es un bloqueo de RLS (42501) que el relay de
 * Estación Maestra puede resolver (RLS-RELAY). No confundir con 401/403:
 * esos son credenciales inválidas y el relay no ayuda.
 * @param {any} err
 * @returns {boolean}
 */
export function isRlsBlockedError(err) {
    if (!err) return false;
    if (err.code === '42501') return true;
    const msg = typeof err.message === 'string' ? err.message : (typeof err === 'string' ? err : '');
    return /row-level security/i.test(msg);
}

export default { describeCloudError, describeCloudErrorShort, isRlsBlockedError };
