/**
 * backupRestoreService.js — Núcleo compartido de respaldo/restauración.
 *
 * Problema que resuelve:
 *   - BACKUP-001: `useCloudBackup.uploadLocalBackup` guardaba en
 *     `cloud_backups.backup_data` SOLO metadatos (drive_url, size_bytes),
 *     pero `applyCloudBackup` espera el payload completo allí. Resultado:
 *     la restauración desde la nube nunca podía funcionar.
 *   - BACKUP-002: la validación del JSON importado era incompleta: un
 *     archivo v2.0 sin `data.idb` pasaba la validación y borraba el
 *     dispositivo sin restaurar nada.
 *   - BACKUP-003: lógica duplicada (colección/validación/aplicación) en
 *     useCloudBackup, useDataImportExport y useAutoBackup con divergencias.
 *
 * Solución: una sola fuente de verdad, testeable sin React.
 *
 * @module utils/backupRestoreService
 */

import { storageService } from './storageService';
import localforage from 'localforage';
import { IDB_KEYS, LS_KEYS, PROTECTED_KEYS } from '../config/backupKeys';
import { decompressString, isCompressionSupported } from './compression';
import { runWithoutEco } from './syncFlags';

export const BACKUP_FORMAT_VERSION = '2.0';

// Claves críticas que se re-sincronizan a la nube tras importar un backup
// (mismo listado que usa useCloudSync con `pda_backup_imported_flag`).
export const CRITICAL_SYNC_KEYS = Object.freeze([
    'bodega_sales_v1',
    'bodega_products_v1',
    'bodega_customers_v1',
    'bodega_customer_ledger_v1',
    'bodega_accounts_v2',
]);

// Claves del formato legado (backups anteriores a v2.0)
const LEGACY_IDB_KEYS = Object.freeze([
    'bodega_products_v1',
    'bodega_accounts_v2',
    'my_categories_v1',
]);
const LEGACY_LS_KEYS = Object.freeze([
    'street_rate_bs', 'catalog_use_auto_usdt', 'catalog_custom_usdt_price',
    'catalog_show_cash_price', 'monitor_rates_v12', 'business_name', 'business_rif',
]);

// ─── COLECCIÓN ──────────────────────────────────────────────────────────────

/**
 * Recolecta el estado actual del dispositivo como payload v2.0.
 * @returns {Promise<{timestamp: string, version: string, appName: string, data: {idb: Object, ls: Object}}>}
 */
export async function collectLocalBackupPayload({ appName = 'TasasAlDia_Bodegas' } = {}) {
    const idbData = {};
    for (const key of IDB_KEYS) {
        const data = await storageService.getItem(key, null);
        if (data !== null) idbData[key] = data;
    }
    const lsData = {};
    for (const key of LS_KEYS) {
        const val = localStorage.getItem(key);
        if (val !== null) lsData[key] = val;
    }
    return {
        timestamp: new Date().toISOString(),
        version: BACKUP_FORMAT_VERSION,
        appName,
        data: { idb: idbData, ls: lsData },
    };
}

// ─── VALIDACIÓN ─────────────────────────────────────────────────────────────

/**
 * Valida la estructura de un backup (v2.0 o legado). Lanza Error con mensaje
 * apto para mostrar al usuario si el archivo es inválido o está vacío.
 * @param {any} json
 * @returns {boolean} true si es formato v2.0, false si es legado.
 */
export function validateBackupJson(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('Formato invalido: el archivo no contiene un backup valido.');
    }
    if (!json.data || typeof json.data !== 'object') {
        throw new Error('Formato invalido: falta campo "data".');
    }
    if (json.version === BACKUP_FORMAT_VERSION) {
        const idb = json.data.idb;
        const ls = json.data.ls;
        if (!idb || typeof idb !== 'object' || Array.isArray(idb)) {
            throw new Error('Formato invalido: el backup v2.0 no contiene datos de la aplicacion (data.idb).');
        }
        if (countBackupRecords(json) === 0) {
            throw new Error('El backup esta vacio: no contiene inventario, ventas ni configuracion.');
        }
        // ls es opcional pero, si viene, debe ser objeto
        if (ls !== undefined && (typeof ls !== 'object' || ls === null || Array.isArray(ls))) {
            throw new Error('Formato invalido: data.ls debe ser un objeto.');
        }
        return true;
    }
    // Legado: al menos una clave conocida debe estar presente
    const hasLegacyData =
        LEGACY_IDB_KEYS.some(k => json.data[k] != null) ||
        LEGACY_LS_KEYS.some(k => json.data[k] != null) ||
        (json.data.idb && typeof json.data.idb === 'object' && Object.keys(json.data.idb).length > 0);
    if (!hasLegacyData) {
        throw new Error('El backup no contiene datos reconocibles de la aplicacion.');
    }
    return false;
}

// ─── DESCOMPRESIÓN (payloads de la nube) ────────────────────────────────────

/**
 * Normaliza un payload de `cloud_backups.backup_data`: descomprime si viene
 * comprimido y devuelve el objeto de backup listo para aplicar.
 * Tolera filas legacy que solo traen metadatos (devuelve backup sin datos).
 * @param {Object} cloudBackup
 * @returns {Promise<Object>} backup normalizado con `data` (puede estar vacío).
 */
export async function decompressCloudBackup(cloudBackup) {
    if (!cloudBackup || typeof cloudBackup !== 'object') {
        throw new Error('El backup de la nube esta vacio o es invalido.');
    }
    if (cloudBackup.compressed) {
        if (!isCompressionSupported()) {
            throw new Error('Este navegador no soporta descomprimir el backup de la nube.');
        }
        try {
            const rawJson = await decompressString(cloudBackup.data);
            const parsed = JSON.parse(rawJson);
            // El payload comprimido puede traer la metadata de la fila mezclada
            return { ...cloudBackup, ...parsed, compressed: false };
        } catch (err) {
            console.error('[backupRestoreService] Error al descomprimir:', err);
            throw new Error('El backup de la nube esta danado o no pudo descomprimirse.');
        }
    }
    return cloudBackup;
}

// ─── APLICACIÓN ─────────────────────────────────────────────────────────────

/**
 * Aplica un backup ya validado al dispositivo.
 *
 * @param {Object} backup     Payload v2.0 o legado (debe pasar validateBackupJson).
 * @param {Object} [options]
 * @param {'storageService'|'direct'} [options.writeMode='storageService']
 *   - 'storageService': escribe via storageService (quota fallback, eventos).
 *     Se envuelve en runWithoutEco para no re-enviar a la nube lo recibido.
 *   - 'direct': escribe via localforage crudo, sin eventos ni eco (usado por
 *     importación de archivo, que luego sincroniza via pda_backup_imported_flag).
 * @returns {Promise<{idbKeys: string[], lsKeys: string[]}>}
 */
export async function applyBackupToStorage(backup, { writeMode = 'storageService' } = {}) {
    const isV2 = backup.version === BACKUP_FORMAT_VERSION && backup.data?.idb;
    const writeIdb = async (key, value) => {
        if (writeMode === 'direct') {
            const parsed = typeof value === 'string' ? safeParse(value) : value;
            await localforage.setItem(key, parsed);
        } else {
            await storageService.setItem(key, value);
        }
    };
    const writeLs = (key, value) => localStorage.setItem(key, value);

    const doApply = async () => {
        const applied = { idbKeys: [], lsKeys: [] };
        if (isV2) {
            for (const [key, value] of Object.entries(backup.data.idb)) {
                await writeIdb(key, value);
                applied.idbKeys.push(key);
            }
            if (backup.data.ls) {
                for (const [key, value] of Object.entries(backup.data.ls)) {
                    writeLs(key, value);
                    applied.lsKeys.push(key);
                }
            }
        } else {
            // Legado
            for (const key of LEGACY_IDB_KEYS) {
                const value = backup.data[key];
                if (value == null) continue;
                await writeIdb(key, value);
                applied.idbKeys.push(key);
            }
            for (const key of LEGACY_LS_KEYS) {
                const value = backup.data[key];
                if (value == null) continue;
                writeLs(key, String(value));
                applied.lsKeys.push(key);
            }
        }
        return applied;
    };

    if (writeMode === 'direct') {
        return doApply();
    }
    // BACKUP-004: la restauración cloud no debe ecoar a la nube (HOOK-014).
    return runWithoutEco(doApply);
}

/**
 * Limpieza selectiva previa a restaurar (HOOK-025): borra solo las claves del
 * catálogo canónico, preservando PROTECTED_KEYS y la sesión de Supabase.
 * @returns {Promise<{removedIdb: string[], removedLs: string[]}>}
 */
export async function clearAppKeysForRestore() {
    const removedIdb = [];
    const removedLs = [];
    for (const key of IDB_KEYS) {
        if (PROTECTED_KEYS.includes(key)) continue;
        try { await localforage.removeItem(key); removedIdb.push(key); } catch { /* noop */ }
    }
    for (const key of LS_KEYS) {
        if (PROTECTED_KEYS.includes(key)) continue;
        localStorage.removeItem(key);
        removedLs.push(key);
    }
    return { removedIdb, removedLs };
}

// ─── INSPECCIÓN ─────────────────────────────────────────────────────────────

/**
 * Cuenta registros de datos contenidos en un backup (v2.0).
 * @param {Object} backup
 * @returns {number}
 */
export function countBackupRecords(backup) {
    if (!backup?.data) return 0;
    const idbCount = backup.data.idb && typeof backup.data.idb === 'object'
        ? Object.keys(backup.data.idb).length : 0;
    const lsCount = backup.data.ls && typeof backup.data.ls === 'object'
        ? Object.keys(backup.data.ls).length : 0;
    return idbCount + lsCount;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function safeParse(val) {
    try { return JSON.parse(val); } catch { return val; }
}

export default {
    BACKUP_FORMAT_VERSION,
    CRITICAL_SYNC_KEYS,
    collectLocalBackupPayload,
    validateBackupJson,
    decompressCloudBackup,
    applyBackupToStorage,
    clearAppKeysForRestore,
    countBackupRecords,
};
