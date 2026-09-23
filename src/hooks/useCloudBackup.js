import { useState } from 'react';
import { showToast } from '../components/Toast';
import { supabaseCloud } from '../config/supabaseCloud';
import { runWithoutEco } from '../utils/syncFlags';
import { compressString, isCompressionSupported } from '../utils/compression';
import { uploadToGoogleDrive } from '../utils/driveBackupUploader';
import { describeCloudError, isRlsBlockedError } from '../utils/cloudError';
import { buildCloudBackupsRow, buildSyncDocumentRow } from '../config/cloudSchema';
import { ensureDeviceSessionRegistered } from '../utils/deviceIdentity';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { relayUploadBackup, relayFetchBackup } from '../utils/backupRelay';
import {
    collectLocalBackupPayload,
    validateBackupJson,
    decompressCloudBackup,
    applyBackupToStorage,
    countBackupRecords,
} from '../utils/backupRestoreService';

/**
 * Hook that encapsulates cloud backup/restore logic using device_id as the sole identifier.
 * No email or password required.
 *
 * BACKUP-001: ahora `cloud_backups.backup_data` guarda el payload COMPLETO
 * (comprimido cuando el navegador lo soporta) y no solo metadatos. La fila
 * incluye además un resumen (`summary`) para UI sin descomprimir.
 * Esquema: la tabla solo expone `device_id`, `backup_data` y `updated_at`
 * (mismo contrato que usa useAutoBackup); `size_bytes`/`drive_url` viven
 * DENTRO del JSON de `backup_data`, no como columnas.
 *
 * @param {Object} params
 * @param {string}   params.deviceId
 * @param {Function} params.auditLog
 * @param {Function} params.forceHeartbeat
 * @param {boolean}  [params.isLicensedCloud] Licencia completa activa (no demo).
 *   La sincronización con la nube es exclusiva de licencias completas.
 * @param {Function} [params.triggerHaptic]
 */
export function useCloudBackup({
    deviceId,
    auditLog,
    forceHeartbeat,
    isLicensedCloud = false,
    triggerHaptic,
}) {
    const [importStatus, setImportStatus] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [dataConflictPending, setDataConflictPending] = useState(null);
    // BACKUP-ERR: último error estructurado para la UI (título, detalle, hint).
    const [lastError, setLastError] = useState(null);

    // ─── HELPER: Apply a cloud backup to local storage ───────────────────────
    // HOOK-014: toda la restauración corre dentro de `runWithoutEco`
    // (lo garantiza applyBackupToStorage con writeMode 'storageService').
    const applyCloudBackup = async (cloudBackup) => {
        const backup = await decompressCloudBackup(cloudBackup);
        validateBackupJson(backup);
        return applyBackupToStorage(backup, { writeMode: 'storageService' });
    };

    // ─── HELPER: Upload local backup + initialize sync_documents ─────────────
    const uploadLocalBackup = async (backupData) => {
        if (!supabaseCloud || !deviceId) return;

        // BACKUP-001: subir el payload COMPLETO (comprimido si es posible).
        let payloadToUpload = backupData;
        if (isCompressionSupported()) {
            try {
                const compressedData = await compressString(JSON.stringify(backupData));
                payloadToUpload = {
                    compressed: true,
                    version: '2.0',
                    timestamp: backupData.timestamp,
                    appName: backupData.appName,
                    summary: {
                        idbKeys: Object.keys(backupData.data.idb || {}),
                        lsKeys: Object.keys(backupData.data.ls || {}),
                        recordCount: countBackupRecords(backupData),
                    },
                    data: compressedData
                };
            } catch (err) {
                console.error('[CloudBackup] Error al comprimir manual backup, usando raw JSON:', err);
            }
        }

        // 1. Subir a Google Drive (copia externa, best-effort) y guardar
        //    payload completo + metadatos en Supabase.
        const clientName = localStorage.getItem('business_name') || 'Mi Negocio';
        let driveResult = null;
        try {
            driveResult = await uploadToGoogleDrive(payloadToUpload, deviceId, clientName);
        } catch (driveErr) {
            console.error('[CloudBackup] Error al subir manual backup a Google Drive:', driveErr);
        }

        const metadataPayload = {
            ...payloadToUpload,
            drive_url: driveResult?.downloadUrl || null,
            size_bytes: driveResult?.sizeBytes || JSON.stringify(payloadToUpload).length,
            updated_at: new Date().toISOString()
        };

        // Contrato de esquema: el builder valida contra la allowlist real de
        // columnas (evita regresiones PGRST204 como el bug de size_bytes).
        const { error } = await supabaseCloud
            .from('cloud_backups')
            .upsert(
                buildCloudBackupsRow({ deviceId, backupData: metadataPayload }),
                { onConflict: 'device_id' }
            );
        if (error) {
            // RLS-RELAY: sin la migración own-row, RLS rechaza al dispositivo
            // (42501). Reintento vía Estación Maestra (service-role del lado
            // servidor) antes de fallar.
            if (isRlsBlockedError(error)) {
                const relay = await relayUploadBackup(deviceId, metadataPayload);
                if (!relay.ok) {
                    throw new Error(
                        `RLS bloqueó la escritura directa y el relay falló: ${relay.error?.message || relay.error || 'sin detalle'}`
                    );
                }
                console.info('[CloudBackup] Escritura realizada vía relay de Estación Maestra (RLS).');
            } else {
                throw error;
            }
        }

        // 2. Inyección inicial en sync_documents para P2P (best-effort)
        try {
            const syncPayloads = [];
            for (const [key, value] of Object.entries(backupData.data.idb || {})) {
                syncPayloads.push(buildSyncDocumentRow({
                    deviceId,
                    collection: 'store',
                    docId: key,
                    data: { payload: value },
                }));
            }
            for (const [key, value] of Object.entries(backupData.data.ls || {})) {
                let finalVal = value;
                try { finalVal = JSON.parse(value); } catch { /* keep as string */ }
                syncPayloads.push(buildSyncDocumentRow({
                    deviceId,
                    collection: 'local',
                    docId: key,
                    data: { payload: finalVal },
                }));
            }
            if (syncPayloads.length > 0) {
                await supabaseCloud.from('sync_documents').upsert(syncPayloads, { onConflict: 'device_id,collection,doc_id' });
            }
        } catch (syncErr) {
            console.warn('[CloudBackup] Fallo inicializando sync_documents:', syncErr);
        }
    };

    // ─── HANDLER: Data conflict resolution ───────────────────────────────────
    const handleDataConflictChoice = async (choice) => {
        if (!dataConflictPending) return;
        const { cloudBackup, localBackup } = dataConflictPending;
        setDataConflictPending(null);
        setImportStatus('loading');
        setStatusMessage('Aplicando tu elección...');
        try {
            if (choice === 'cloud') {
                await applyCloudBackup(cloudBackup);
                showToast('Datos de la nube restaurados. Reiniciando...', 'success');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                await uploadLocalBackup(localBackup);
                showToast('Datos locales guardados en la nube', 'success');
            }
            auditLog('NUBE', 'CONFLICTO_RESUELTO', `Conflicto datos resuelto: usuario eligió ${choice}`);
            setImportStatus(null);
        } catch (err) {
            console.error('[CloudBackup] Error al resolver conflicto:', err);
            const info = describeCloudError(err);
            setLastError(info);
            showToast(`${info.title}. ${info.hint}`, 'error');
            setImportStatus('error');
        }
    };

    // ─── HANDLER: Sync cloud (initial connect) ────────────────────────────────
    const handleSyncCloud = async () => {
        // LICENCIA-CLOUD: la nube es exclusiva de licencias completas.
        // Los demos solo tienen respaldo local (exportar/importar archivo).
        if (!isLicensedCloud) {
            showToast('La sincronización con la nube requiere licencia completa', 'error');
            return;
        }
        if (!supabaseCloud || !deviceId) {
            showToast('Sin conexión a la nube', 'error');
            return;
        }

        try {
            setImportStatus('loading');
            setStatusMessage('Consultando backup en la nube...');

            // RLS-IDENTITY: las políticas own-row (001_device_own_row_rls.sql)
            // requieren que el dispositivo esté registrado en device_sessions
            // vinculado a su sesión. Fail-soft: si falla, el error de RLS
            // posterior se clasificará y mostrará con instrucciones claras.
            const { session } = await ensureSupervisorSession();
            if (session) {
                const reg = await ensureDeviceSessionRegistered(deviceId);
                if (!reg.ok) {
                    console.warn('[CloudBackup] device_sessions no disponible:', reg.error);
                }
            }

            let cloudRow = null;
            let fetchError = null;
            ({ data: cloudRow, error: fetchError } = await supabaseCloud
                .from('cloud_backups')
                .select('backup_data')
                .eq('device_id', deviceId)
                .maybeSingle());

            if (fetchError) {
                if (!isRlsBlockedError(fetchError)) throw fetchError;
                console.warn('[CloudBackup] Lectura directa bloqueada por RLS, probando relay...');
            } else if (!cloudRow) {
                // RLS-RELAY: RLS también bloquea el SELECT silenciosamente
                // (0 filas en vez de error). Si el directo no ve nada, sondear
                // el relay antes de concluir que la nube está vacía.
                const relayProbe = await relayFetchBackup(deviceId);
                if (relayProbe.ok && relayProbe.backupData) {
                    cloudRow = { backup_data: relayProbe.backupData };
                    console.info('[CloudBackup] Backup obtenido vía relay de Estación Maestra.');
                }
            }

            const cloudBackup = cloudRow?.backup_data || null;
            const localBackup = await collectLocalBackupPayload({ appName: 'TasasAlDia_Bodegas_Cloud' });
            // BACKUP-001: con payloads completos, un backup de la nube con solo
            // metadatos ya no cuenta como "datos en la nube".
            const hasCloudData = (() => {
                if (!cloudBackup) return false;
                if (cloudBackup.compressed) return true; // comprimido ⇒ payload completo
                const summary = cloudBackup.summary;
                if (summary && typeof summary === 'object') return summary.recordCount > 0;
                return countBackupRecords(cloudBackup) > 0;
            })();
            const hasLocalData = Object.keys(localBackup.data.idb).length > 0;

            if (hasCloudData && hasLocalData) {
                // ⚠️ Conflicto: ambos tienen datos → preguntar al usuario
                setDataConflictPending({ cloudBackup, localBackup });
                setImportStatus(null);
                setStatusMessage('');
                auditLog('NUBE', 'CONFLICTO_DETECTADO', 'Conflicto datos nube/local');
                return;
            }

            if (hasCloudData && !hasLocalData) {
                // Dispositivo vacío → restaurar desde nube
                setStatusMessage('Restaurando backup de la nube...');
                await applyCloudBackup(cloudBackup);
                showToast('Datos restaurados automáticamente desde la nube', 'success');
                auditLog('NUBE', 'RESTORE_AUTO', 'Backup restaurado automáticamente');
                triggerHaptic?.();
                setImportStatus('success');
                setStatusMessage('Restauración completa. Reiniciando...');
                setTimeout(() => window.location.reload(), 1500);
                return;
            }

            // Sin datos en la nube → subir datos locales
            setStatusMessage('Guardando datos locales en la nube...');
            await uploadLocalBackup(localBackup);
            showToast('Datos sincronizados con la nube', 'success');
            auditLog('NUBE', 'SYNC_INICIAL', 'Datos locales subidos a la nube');
            triggerHaptic?.();
            setImportStatus(null);

        } catch (err) {
            console.error('[CloudBackup] Error:', err);
            const info = describeCloudError(err);
            setLastError(info);
            showToast(`${info.title}. ${info.hint}`, 'error');
            setImportStatus('error');
        }
    };

    return {
        importStatus,
        setImportStatus,
        statusMessage,
        setStatusMessage,
        dataConflictPending,
        setDataConflictPending,
        lastError,
        setLastError,
        applyCloudBackup,
        collectLocalBackup: collectLocalBackupPayload,
        uploadLocalBackup,
        handleSyncCloud,
        handleDataConflictChoice,
    };
}

// Aliases para no romper imports históricos (p. ej. tests)
export { runWithoutEco };
