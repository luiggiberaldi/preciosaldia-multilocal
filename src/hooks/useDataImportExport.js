import { useState } from 'react';
import { storageService } from '../utils/storageService';
import localforage from 'localforage';
import { showToast } from '../components/Toast';
import { IDB_KEYS, LS_KEYS, PROTECTED_KEYS } from '../config/backupKeys';
import { validateBackupJson, applyBackupToStorage, clearAppKeysForRestore } from '../utils/backupRestoreService';

/**
 * Hook that encapsulates JSON import/export and delete-all-data logic.
 *
 * @param {Object}   params
 * @param {Function} params.auditLog
 * @param {Function} [params.triggerHaptic]
 * @param {Function} params.setImportStatus  – shared status setter (from useCloudBackup)
 * @param {Function} params.setStatusMessage – shared message setter (from useCloudBackup)
 */
export function useDataImportExport({
    auditLog,
    triggerHaptic,
    setImportStatus,
    setStatusMessage,
}) {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteInput, setDeleteInput] = useState('');

    const handleExport = async () => {
        try {
            setImportStatus('loading');
            setStatusMessage('Generando backup completo...');

            // HOOK-041: usa las listas canónicas de backupKeys.js.
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

            const backupData = {
                timestamp: new Date().toISOString(),
                version: '2.0',
                appName: 'TasasAlDia_Bodegas',
                data: { idb: idbData, ls: lsData }
            };

            const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup_tasasaldia_completo_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setStatusMessage('Backup completo descargado.');
            setImportStatus('success');
            auditLog('SISTEMA', 'BACKUP_EXPORTADO', 'Backup completo exportado');
            setTimeout(() => setImportStatus(null), 3000);
        } catch (error) {
            console.error(error);
            setStatusMessage('Error al generar backup.');
            setImportStatus('error');
        }
    };

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                setImportStatus('loading');
                setStatusMessage('Validando archivo...');
                const json = JSON.parse(e.target.result);

                // BACKUP-002: validar COMPLETAMENTE antes de borrar nada del
                // dispositivo. Un v2.0 sin data.idb o vacío ya no destruye los datos.
                validateBackupJson(json);

                // ── FASE 1: LIMPIEZA SELECTIVA (HOOK-025) ─────────────────────────
                // HOOK-025: NO usar `localforage.clear()` — borraría flags críticos
                // como `pda_demo_flag_v1` y `bodega_autobackup_v1`. La limpieza ahora
                // vive en backupRestoreService.clearAppKeysForRestore (mismo contrato:
                // solo claves del catálogo canónico, preservando PROTECTED_KEYS y sesión).
                setStatusMessage('Limpiando datos del dispositivo...');
                await clearAppKeysForRestore();

                // ── FASE 2: RESTAURACIÓN (directo a localforage, sin eventos) ───────
                setStatusMessage('Restaurando backup...');

                await applyBackupToStorage(json, { writeMode: 'direct' });

                setImportStatus('success');
                setStatusMessage('Restauracion completa. Sincronizando con la nube...');
                localStorage.setItem('pda_backup_imported_flag', 'true');
                const idbKeyList = json.data?.idb ? Object.keys(json.data.idb).join(', ') : 'legacy';
                auditLog('SISTEMA', 'BACKUP_IMPORTADO', `Backup restaurado (${json.source || 'archivo'}) — ${idbKeyList}`);
                triggerHaptic?.();

                // Damos tiempo a guardar los datos antes de reiniciar
                setTimeout(() => window.location.reload(), 1200);
            } catch (error) {
                console.error('[IMPORT ERROR]', error);
                setImportStatus('error');
                setStatusMessage('Error: El archivo esta corrupto o es invalido.');
            }
        };
        reader.readAsText(file);
    };

    const handleDeleteAllData = async () => {
        if (deleteInput !== 'ELIMINAR') return;
        try {
            triggerHaptic && triggerHaptic();
            await storageService.setItem('bodega_sales_v1', []);
            auditLog('SISTEMA', 'HISTORIAL_BORRADO', 'Historial de ventas eliminado completamente');
            showToast('Historial de ventas eliminado exitosamente', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            showToast('Error eliminando historial', 'error');
        }
    };

    return {
        showDeleteConfirm,
        setShowDeleteConfirm,
        deleteInput,
        setDeleteInput,
        handleExport,
        handleFileChange,
        handleDeleteAllData,
    };
}
