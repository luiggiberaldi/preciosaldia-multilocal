/**
 * driveBackupUploader.js
 * Utility to upload backup JSON payloads to Google Drive via Google Apps Script.
 * Reusable by useAutoBackup, useCloudBackup, and useRemoteBackupListener.
 */
export async function uploadToGoogleDrive(payload, deviceId, clientName) {
    const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_BACKUPS_URL || import.meta.env.VITE_GOOGLE_SCRIPT_URL;
    if (!GOOGLE_SCRIPT_URL) {
        return null;
    }

    // GUARDA-RAIL: validación post-sanitización en el punto de envío (defensa en profundidad)
    const sanitizedClientName = (() => {
        const name = typeof clientName === 'string' ? clientName.trim() : '';
        const valid = name.length >= 2 && !/^\d+$/.test(name);
        return valid ? name : `Bodega_${(deviceId || 'Unknown').substring(0, 8)}`;
    })();

    const body = JSON.stringify({
        action: 'upload_backup',
        deviceId,
        clientName: sanitizedClientName,
        backupData: payload
    });

    try {
        // Enviar vía mode: 'no-cors' con text/plain para Apps Script, evitando bloqueos por 302 redirect
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body
        });
        return { downloadUrl: null, sizeBytes: body.length, status: 'submitted' };
    } catch (e) {
        return null;
    }

    return null;
}
