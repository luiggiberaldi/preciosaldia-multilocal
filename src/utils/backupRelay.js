/**
 * backupRelay.js — Cliente del relay de respaldos vía Estación Maestra.
 *
 * Problema que resuelve (RLS-RELAY):
 *   - Sin aplicar 001_device_own_row_rls.sql, RLS bloquea al dispositivo:
 *     42501 al escribir cloud_backups y 0 filas al leer. El botón
 *     "Sincronizar con la Nube" reintenta vía /api/backup/relay de la
 *     Estación Maestra (service-role del lado servidor). Tras aplicar la
 *     migración, el camino directo vuelve a ser el primario y este relay
 *     queda como fallback.
 *
 * @module utils/backupRelay
 */

/**
 * true cuando el bundle corre en un build de producción (vite define PROD).
 * En dev y en pruebas el valor de import.meta.env.PROD es false.
 */
function isProdBuild() {
    return import.meta.env?.PROD === true;
}

/**
 * URL base de la API de Estación Maestra.
 *
 * Guardarraíl de entorno: el default a producción SOLO aplica en builds de
 * producción. En desarrollo/pruebas sin VITE_ESTACION_API_URL se devuelve ""
 * para que ningún entorno de prueba pueda tocar el backend real (hallazgo de
 * la auditoría E2E: el auto-backup llamaba a producción desde el test).
 * Lectura por llamada para testabilidad.
 */
export function getEstacionApiUrl() {
    return (
        import.meta.env?.VITE_ESTACION_API_URL ||
        (isProdBuild() ? 'https://estacion-2026.vercel.app' : '')
    );
}

/** Shared secret que exigen los endpoints de backup de Estación Maestra. */
function getEstacionBackupSecret() {
    return import.meta.env?.VITE_ESTACION_BACKUP_SECRET || '';
}

/**
 * Sube el backup de un dispositivo vía relay.
 * @param {string} deviceId
 * @param {Object} backupData  Payload completo (el mismo JSON que iría en la fila).
 * @returns {Promise<{ok: boolean, relayed: boolean, skipped?: boolean, error?: any}>}
 */
export async function relayUploadBackup(deviceId, backupData) {
    const base = getEstacionApiUrl();
    if (!base) return { ok: false, relayed: false, skipped: true, error: 'relay no configurado' };

    try {
        const res = await fetch(`${base}/api/backup/relay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-backup-secret': getEstacionBackupSecret(),
            },
            body: JSON.stringify({ deviceId, backup_data: backupData }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { ok: false, relayed: false, error: data?.error || `HTTP ${res.status}` };
        }
        return { ok: true, relayed: true, error: null };
    } catch (err) {
        return { ok: false, relayed: false, error: err };
    }
}

/**
 * Lee el backup de un dispositivo vía relay.
 * @param {string} deviceId
 * @returns {Promise<{ok: boolean, backupData: Object|null, updatedAt: string|null, error?: any}>}
 */
export async function relayFetchBackup(deviceId) {
    const base = getEstacionApiUrl();
    if (!base) return { ok: false, backupData: null, updatedAt: null, error: 'relay no configurado' };

    try {
        const res = await fetch(`${base}/api/backup/relay?deviceId=${encodeURIComponent(deviceId)}`, {
            headers: { 'x-backup-secret': getEstacionBackupSecret() },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { ok: false, backupData: null, updatedAt: null, error: data?.error || `HTTP ${res.status}` };
        }
        return {
            ok: true,
            backupData: data.backup_data ?? null,
            updatedAt: data.updated_at ?? null,
            error: null,
        };
    } catch (err) {
        return { ok: false, backupData: null, updatedAt: null, error: err };
    }
}

export default { relayUploadBackup, relayFetchBackup, getEstacionApiUrl };
