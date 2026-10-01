import { useState } from 'react';
import { storageService } from '../utils/storageService';
import localforage from 'localforage';
import { showToast } from '../components/Toast';
import { IDB_KEYS, LS_KEYS, PROTECTED_KEYS } from '../config/backupKeys';
import { validateBackupJson, applyBackupToStorage, clearAppKeysForRestore } from '../utils/backupRestoreService';
import { isCloudSyncActiveNow } from './useCloudSync';

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
    // ALTO-8 (2026-10-01): confirmación explícita antes de restaurar.
    // { json, backupDate, lastSaleDate, backupIsOlder }
    const [restoreConfirm, setRestoreConfirm] = useState(null);

    // Fecha de la última venta local (para comparar contra el backup).
    const getLastLocalSaleDate = async () => {
        try {
            const sales = await storageService.getItem('bodega_sales_v1', []);
            if (!Array.isArray(sales) || sales.length === 0) return null;
            let max = null;
            for (const s of sales) {
                const raw = s?.timestamp || s?.fecha || s?.date;
                if (!raw) continue;
                const d = new Date(raw);
                if (Number.isNaN(d.getTime())) continue;
                if (!max || d > max) max = d;
            }
            return max;
        } catch { return null; }
    };

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

                // ALTO-8 (2026-10-01): no restaurar a ciegas. Mostrar fecha del
                // backup vs última venta local y pedir confirmación explícita.
                const backupDate = json.timestamp ? new Date(json.timestamp) : null;
                const lastSaleDate = await getLastLocalSaleDate();
                const backupIsOlder = Boolean(
                    backupDate && !Number.isNaN(backupDate.getTime()) &&
                    lastSaleDate && backupDate < lastSaleDate
                );
                setRestoreConfirm({ json, backupDate, lastSaleDate, backupIsOlder });
                setImportStatus(null);
                setStatusMessage('Esperando confirmación para restaurar el backup...');
            } catch (error) {
                console.error('[IMPORT ERROR]', error);
                setImportStatus('error');
                setStatusMessage('Error: El archivo esta corrupto o es invalido.');
            }
        };
        reader.readAsText(file);
    };

    const cancelRestore = () => {
        setRestoreConfirm(null);
        setImportStatus(null);
        setStatusMessage('');
    };

    const confirmRestore = async () => {
        const pending = restoreConfirm;
        if (!pending) return;
        const json = pending.json;
        setRestoreConfirm(null);
        try {
            setImportStatus('loading');
            // ── FASE 1: LIMPIEZA SELECTIVA (HOOK-025) ─────────────────────────
            // HOOK-025: NO usar `localforage.clear()` — borraría flags críticos
            // como `bodega_autobackup_v1`. La limpieza ahora
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
            console.error('[RESTORE ERROR]', error);
            setImportStatus('error');
            setStatusMessage('Error: no se pudo restaurar el backup.');
        }
    };

    const handleDeleteAllData = async () => {
        if (deleteInput !== 'ELIMINAR') return;
        // M-22 (2026-10-01): con sync activo el borrado local no es durable —
        // las ventas "resucitan" en el próximo pull (mergeSales es aditivo).
        // Se bloquea con mensaje claro en vez de prometer un borrado falso.
        try {
            if (isCloudSyncActiveNow()) {
                showToast('No se puede borrar el historial con la sincronización activa: las ventas volverían desde la nube. Desactívala primero si de verdad quieres borrar.', 'error');
                return;
            }
        } catch { /* si no se puede verificar, se permite (modo local) */ }
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
        restoreConfirm,
        confirmRestore,
        cancelRestore,
        handleExport,
        handleFileChange,
        handleDeleteAllData,
    };
}
