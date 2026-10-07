/**
 * imageMaintenance.js — Higiene de fotos de producto (QUOTA-001/P1).
 *
 * Si un producto se guarda sin internet, su foto queda en base64 dentro del
 * documento de productos y CADA sync arrastra ese peso para siempre.
 * `retryPendingImageUploads()` las sube a Storage en cuanto hay conexión y
 * reemplaza el base64 por la URL (corre al abrir la app y al recuperar red).
 *
 * Se procesa un tope por ejecución para no bloquear el arranque si hay
 * cientos pendientes; el resto cae en la siguiente ejecución.
 */
import { appForage } from './appForage';
import { storageService } from './storageService';
import { uploadProductImage } from './imageUpload';

const MAX_UPLOADS_PER_RUN = 25;

export async function retryPendingImageUploads() {
    const report = { ran: false, uploaded: 0, stillPending: 0 };
    try {
        const products = await appForage.getItem('bodega_products_v1');
        if (!Array.isArray(products) || products.length === 0) return report;

        let changed = false;
        let budget = MAX_UPLOADS_PER_RUN;
        for (const p of products) {
            if (typeof p?.image !== 'string' || !p.image.startsWith('data:')) continue;
            if (budget <= 0) {
                report.stillPending += 1;
                continue;
            }
            budget -= 1;
            try {
                const url = await uploadProductImage(p.image, { id: p.id });
                if (url) {
                    p.image = url;
                    changed = true;
                    report.uploaded += 1;
                } else {
                    report.stillPending += 1;
                }
            } catch {
                report.stillPending += 1;
            }
        }

        if (changed) {
            // storageService dispara app_storage_update + el push delta a la nube.
            await storageService.setItem('bodega_products_v1', products);
        }
        report.ran = true;
    } catch (e) {
        console.warn('[ImageMaintenance] Reintento de fotos falló (no crítico):', e?.message ?? e);
    }
    return report;
}
