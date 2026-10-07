import { storageService } from '../utils/storageService';

const memoryCache = new Map();

/**
 * Obtiene la URL cifrada/almacenada en IndexedDB para una imagen.
 * @param {string} url - URL remota o relativa de la imagen.
 * @returns {Promise<string|null>} Data URI guardado localmente o null.
 */
export async function getCachedImage(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('data:')) return url;
    if (memoryCache.has(url)) return memoryCache.get(url);

    try {
        const key = `img_blob_${url}`;
        const storedData = await storageService.getItem(key, null);
        if (storedData) {
            memoryCache.set(url, storedData);
            return storedData;
        }
    } catch {
        // Fallback silencioso en contexto sin IndexedDB
    }
    return null;
}

/**
 * Descarga y guarda en IndexedDB el blob de la imagen para disponibilidad 100% offline.
 * @param {string} url - URL de la imagen a guardar.
 */
export async function saveImageToCache(url) {
    if (!url || typeof url !== 'string') return;
    if (url.startsWith('data:')) return;

    try {
        const key = `img_blob_${url}`;
        const existing = await storageService.getItem(key, null);
        if (existing) {
            memoryCache.set(url, existing);
            return;
        }

        let blob = null;
        try {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (res.ok) blob = await res.blob();
        } catch {
            // Intentar con mode no-cors si fallan las cabeceras CORS
            try {
                const resNoCors = await fetch(url, { mode: 'no-cors' });
                if (resNoCors) blob = await resNoCors.blob();
            } catch {
                /* Error de red */
            }
        }

        if (blob && blob.size > 0) {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            await new Promise((resolve) => {
                reader.onloadend = async () => {
                    const dataUrl = reader.result;
                    if (dataUrl && dataUrl.startsWith('data:')) {
                        await storageService.setItem(key, dataUrl);
                        memoryCache.set(url, dataUrl);
                    }
                    resolve();
                };
            });
        }
    } catch {
        // Ignorar fallos de red individuales
    }
}
