/**
 * cloudSchema.js — Contrato de columnas de las tablas cloud del backend.
 *
 * Problema que resuelve (BUG-7d06e1b / PGRST204):
 *   - `useCloudBackup` subía a `cloud_backups` una columna `size_bytes` que no
 *     existe en la tabla → PostgREST rechazaba el upsert con PGRST204. La forma
 *     de la fila vivía hardcodeada en cada writer y podía divergir del esquema.
 *
 * Solución:
 *   - Única fuente de verdad: la lista canónica de columnas por tabla y unos
 *     builders puros `buildCloudBackupsRow(...)` / `buildSyncDocumentRow(...)`
 *     que solo aceptan claves permitidas. El test de contrato
 *     (tests/cloudSchemaContract.test.js) verifica que ninguna fila producida
 *     por los writers contenga claves fuera de la allowlist, y el script
 *     opcional `scripts/check_cloud_schema.mjs` detecta drift contra el
 *     OpenAPI real de Supabase.
 *
 * @module config/cloudSchema
 */

/**
 * TODAS las columnas de `public.cloud_backups` (esquema real vía OpenAPI de
 * Supabase; los metadatos como size/drive_url viven DENTRO del JSON de
 * `backup_data`). `id` es PK autogenerada; `email`/`password_hash` son
 * columnas legacy que los writers NO deben tocar.
 * @type {readonly string[]}
 */
export const CLOUD_BACKUPS_COLUMNS = Object.freeze([
    'device_id',
    'backup_data',
    'updated_at',
    'id',
    'email',
    'password_hash',
]);

/**
 * Columnas que un writer de la app puede ENVIAR en un upsert de cloud_backups
 * (subset de CLOUD_BACKUPS_COLUMNS; lo demás lo gestiona la base).
 * @type {readonly string[]}
 */
export const CLOUD_BACKUPS_WRITABLE = Object.freeze([
    'device_id',
    'backup_data',
    'updated_at',
]);

/**
 * TODAS las columnas de `public.sync_documents` (esquema real vía OpenAPI).
 * `id` es PK autogenerada; `payload` es columna legacy no usada por los
 * writers actuales (el dato viaja dentro de `data.payload`).
 * @type {readonly string[]}
 */
export const SYNC_DOCUMENTS_COLUMNS = Object.freeze([
    'device_id',
    'collection',
    'doc_id',
    'data',
    'updated_at',
    'id',
    'payload',
]);

/** Columnas escribibles por los writers de la app en sync_documents. */
export const SYNC_DOCUMENTS_WRITABLE = Object.freeze([
    'device_id',
    'collection',
    'doc_id',
    'data',
    'updated_at',
]);

/** Colecciones válidas de sync_documents. */
export const SYNC_COLLECTIONS = Object.freeze(['store', 'local']);

/**
 * Valida que un objeto fila solo contenga columnas de la allowlist.
 * @param {Object} row
 * @param {readonly string[]} allowed
 * @param {string} table Nombre de tabla (para el mensaje de error)
 * @returns {{ok: boolean, invalidKeys: string[]}}
 */
export function validateRowShape(row, allowed, table) {
    const allowedSet = new Set(allowed);
    const invalidKeys = Object.keys(row || {}).filter(k => !allowedSet.has(k));
    if (invalidKeys.length > 0) {
        console.error(
            `[cloudSchema] Fila inválida para ${table}: claves no permitidas ${invalidKeys.join(', ')}. ` +
            `Columnas permitidas: ${allowed.join(', ')}.`
        );
    }
    return { ok: invalidKeys.length === 0, invalidKeys };
}

/**
 * Construye la fila de upsert para `cloud_backups`. Lanza si aparece una
 * clave no permitida (fallo temprano en desarrollo, no 400 en producción).
 *
 * @param {Object} params
 * @param {string} params.deviceId
 * @param {Object} params.backupData  Payload completo (comprimido o raw).
 * @param {string} [params.updatedAt] ISO date; por defecto ahora.
 * @returns {Object} fila lista para `.upsert(..., { onConflict: 'device_id' })`
 */
const CLOUD_BACKUPS_INPUT_KEYS = Object.freeze(['deviceId', 'backupData', 'updatedAt']);

export function buildCloudBackupsRow(params) {
    // Guard de regresión PGRST204: un parámetro desconocido casi siempre es
    // alguien intentando enviar una columna que no existe (ej: size_bytes).
    // No se descarta silenciosamente: se lanza inmediatamente.
    const unknownParams = Object.keys(params || {}).filter(k => !CLOUD_BACKUPS_INPUT_KEYS.includes(k));
    if (unknownParams.length > 0) {
        throw new Error(
            `[cloudSchema] buildCloudBackupsRow recibió parámetros desconocidos: ${unknownParams.join(', ')}. ` +
            `¿Estás intentando enviar una columna que no existe en cloud_backups?`
        );
    }
    const { deviceId, backupData, updatedAt } = params;
    const row = {
        device_id: deviceId,
        backup_data: backupData,
        updated_at: updatedAt || new Date().toISOString(),
    };
    const { ok, invalidKeys } = validateRowShape(row, CLOUD_BACKUPS_WRITABLE, 'cloud_backups');
    if (!ok) {
        throw new Error(`[cloudSchema] cloud_backups row tiene columnas no escribibles: ${invalidKeys.join(', ')}`);
    }
    return row;
}

/**
 * Construye una fila para `sync_documents`.
 *
 * @param {Object} params
 * @param {string} params.deviceId
 * @param {'store'|'local'} params.collection
 * @param {string} params.docId
 * @param {any} params.data  { payload: ... } o envelope de sync.
 * @param {string} [params.updatedAt]
 * @returns {Object} fila lista para upsert con onConflict 'device_id,collection,doc_id'
 */
const SYNC_DOCUMENTS_INPUT_KEYS = Object.freeze(['deviceId', 'collection', 'docId', 'data', 'updatedAt']);

export function buildSyncDocumentRow(params) {
    const unknownParams = Object.keys(params || {}).filter(k => !SYNC_DOCUMENTS_INPUT_KEYS.includes(k));
    if (unknownParams.length > 0) {
        throw new Error(
            `[cloudSchema] buildSyncDocumentRow recibió parámetros desconocidos: ${unknownParams.join(', ')}. ` +
            `¿Estás intentando enviar una columna que no existe en sync_documents?`
        );
    }
    const { deviceId, collection, docId, data, updatedAt } = params;
    if (!SYNC_COLLECTIONS.includes(collection)) {
        throw new Error(`[cloudSchema] collection inválida: ${collection}. Permitidas: ${SYNC_COLLECTIONS.join(', ')}`);
    }
    const row = {
        device_id: deviceId,
        collection,
        doc_id: docId,
        data,
        updated_at: updatedAt || new Date().toISOString(),
    };
    const { ok, invalidKeys } = validateRowShape(row, SYNC_DOCUMENTS_WRITABLE, 'sync_documents');
    if (!ok) {
        throw new Error(`[cloudSchema] sync_documents row tiene columnas no escribibles: ${invalidKeys.join(', ')}`);
    }
    return row;
}

export default {
    CLOUD_BACKUPS_COLUMNS,
    CLOUD_BACKUPS_WRITABLE,
    SYNC_DOCUMENTS_COLUMNS,
    SYNC_DOCUMENTS_WRITABLE,
    SYNC_COLLECTIONS,
    validateRowShape,
    buildCloudBackupsRow,
    buildSyncDocumentRow,
};
