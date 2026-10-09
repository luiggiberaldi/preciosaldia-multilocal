/**
 * Aplicación de documentos de stock y catálogo en el MONITOR, sin estado de React.
 * Extraído de useMonitorSync para poder probarlo. Misma semántica que useCloudSync:
 * el stock cambia solo por deltas de `bodega_stock_v1`; el catálogo nunca pisa el
 * stock local.
 */
import { applyStockMapDelta, physicalDocId, preserveLocalStock } from './syncDelta';

/**
 * Aplica un mapa de stock remoto sobre el catálogo local del negocio.
 * @returns {Promise<{ changed: boolean }>}
 */
export async function applyMonitorStockDoc({ localforage, storage, docId, negocioId, sourceDeviceId, payload }) {
    const productsDocId = physicalDocId(negocioId, 'bodega_products_v1');
    const current = await localforage.getItem(productsDocId);
    if (!Array.isArray(current)) return { changed: false };

    const lrKey = `pda_stock_lastremote_${docId}__${sourceDeviceId || 'unknown'}`;
    let lastRemote = null;
    try {
        const raw = storage.getItem(lrKey);
        lastRemote = raw ? JSON.parse(raw) : null;
    } catch {
        lastRemote = null;
    }

    const { products: merged, nextRemoteMap } = applyStockMapDelta(current, payload, lastRemote);
    try {
        if (nextRemoteMap) storage.setItem(lrKey, JSON.stringify(nextRemoteMap));
    } catch { /* cuota llena: se re-siembra en el próximo ciclo */ }

    if (merged === current) return { changed: false };
    await localforage.setItem(productsDocId, merged);
    return { changed: true };
}

/** Aplica el catálogo del primario conservando el stock local por producto. */
export async function applyMonitorCatalogDoc({ localforage, docId, payload }) {
    const current = await localforage.getItem(docId);
    await localforage.setItem(docId, preserveLocalStock(current, payload));
}
