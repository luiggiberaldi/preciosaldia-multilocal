import localforage from 'localforage';

const shadowStore = localforage.createInstance({
    name: 'BodegaApp',
    storeName: 'bodega_shadow_backups',
    description: 'Copias de sombra de alta seguridad para prevención de pérdida de catálogo'
});

const SHADOW_SUFFIX = '_shadow_backup';

export const shadowBackupService = {
    /**
     * Guarda silenciosamente una copia espejada del valor en el Shadow Store.
     * Solo guarda si el valor es válido y (para arrays) no está vacío.
     */
    async saveShadow(key, value) {
        if (!key || value == null) return;
        if (Array.isArray(value) && value.length === 0) return; // No guardar listas vacías sobre sombras válidas

        try {
            const shadowKey = `${key}${SHADOW_SUFFIX}`;
            const payload = {
                timestamp: new Date().toISOString(),
                count: Array.isArray(value) ? value.length : 1,
                data: value
            };
            await shadowStore.setItem(shadowKey, payload);
            console.log(`[ShadowBackup] Copia de sombra guardada para ${key} (${payload.count} ítems)`);
        } catch (e) {
            console.error(`[ShadowBackup Error] No se pudo guardar la copia de sombra para ${key}:`, e);
        }
    },

    /**
     * Lee la última copia de sombra disponible para una clave.
     */
    async readShadow(key) {
        try {
            const shadowKey = `${key}${SHADOW_SUFFIX}`;
            const shadowPayload = await shadowStore.getItem(shadowKey);
            return shadowPayload; // { timestamp, count, data }
        } catch (e) {
            console.error(`[ShadowBackup Error] Leyendo sombra de ${key}:`, e);
            return null;
        }
    },

    /**
     * Restaura la copia de sombra activando el flag administrativo.
     */
    async restoreShadow(key, storageService) {
        try {
            const shadowPayload = await this.readShadow(key);
            if (!shadowPayload || !shadowPayload.data) {
                throw new Error('No existe una copia de sombra válida para restaurar.');
            }

            // Flag de bypass administrativo para pasar por el Circuit Breaker
            localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');
            
            await storageService.setItem(key, shadowPayload.data);
            console.log(`[ShadowBackup] Restaurada exitosamente la copia de sombra de ${key} (${shadowPayload.count} ítems)`);
            return shadowPayload;
        } catch (e) {
            console.error(`[ShadowBackup Error] Error al restaurar sombra de ${key}:`, e);
            throw e;
        }
    }
};

export default shadowBackupService;
