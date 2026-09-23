export const SUPERVISOR_SYNC_SCHEMA_VERSION = 1;

export const SUPERVISOR_SYNC_STATES = Object.freeze({
    IDLE: 'idle',
    AUTHENTICATING: 'authenticating',
    PULLING: 'pulling',
    CONNECTED: 'connected',
    DEGRADED: 'degraded',
    ERROR: 'error',
    REVOKED: 'revoked',
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function buildSyncEnvelope(payload, updatedAt = new Date().toISOString()) {
    return {
        schemaVersion: SUPERVISOR_SYNC_SCHEMA_VERSION,
        payload,
        updatedAt,
    };
}

/**
 * Acepta el formato versionado nuevo y el formato legacy { payload } durante
 * la migración. Nunca inventa un payload si el documento está incompleto.
 */
export function readSyncEnvelope(data) {
    if (!isPlainObject(data) || !Object.prototype.hasOwnProperty.call(data, 'payload')) {
        return { valid: false, error: 'Envelope de sincronización inválido' };
    }

    const schemaVersion = data.schemaVersion ?? 1;
    if (schemaVersion !== SUPERVISOR_SYNC_SCHEMA_VERSION) {
        return { valid: false, error: `Versión de schema no soportada: ${schemaVersion}` };
    }

    const updatedAt = data.updatedAt || null;
    if (updatedAt && Number.isNaN(Date.parse(updatedAt))) {
        return { valid: false, error: 'updatedAt inválido' };
    }

    return {
        valid: true,
        error: null,
        payload: data.payload,
        schemaVersion,
        updatedAt,
    };
}

export function isNewerSyncDocument(incomingUpdatedAt, previousUpdatedAt) {
    if (!incomingUpdatedAt) return !previousUpdatedAt;
    if (!previousUpdatedAt) return true;
    return Date.parse(incomingUpdatedAt) > Date.parse(previousUpdatedAt);
}

export function getSyncMetadataKey(docId) {
    return `supervisor_sync_updated_at_${docId}`;
}

/**
 * Cada ciclo de vida usa un topic único para que React StrictMode, un cambio
 * de dispositivo o una reconexión no intenten añadir callbacks a un canal ya
 * suscrito.
 */
export function buildSupervisorRealtimeChannelName(deviceId, lifecycleId = 0) {
    return `monitor:${String(deviceId)}:${String(lifecycleId)}`;
}

export async function withSyncRetry(task, {
    attempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 2000,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await task(attempt);
        } catch (error) {
            lastError = error;
            if (attempt === attempts - 1) break;
            const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
            await sleep(delay);
        }
    }

    throw lastError || new Error('La sincronización falló');
}

export default {
    SUPERVISOR_SYNC_SCHEMA_VERSION,
    SUPERVISOR_SYNC_STATES,
    buildSyncEnvelope,
    readSyncEnvelope,
    isNewerSyncDocument,
    getSyncMetadataKey,
    buildSupervisorRealtimeChannelName,
    withSyncRetry,
};
