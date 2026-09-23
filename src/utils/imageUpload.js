import { supabaseCloud } from '../config/supabaseCloud';

// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 (Egress): las imágenes de producto se guardaban como base64 embebido
// dentro de `bodega_products_v1`, que se sincroniza entero por Realtime. Editar
// UN producto reenviaba el array completo con TODAS las imágenes (≈534KB de un
// doc de 564KB). Este módulo sube la imagen a Supabase Storage (bucket público
// `product-images`) y devuelve la URL pública, de modo que el doc de sync solo
// lleve una URL corta. El egress de imágenes se mueve de Realtime (caro) a
// Storage (barato) y deja de re-emitirse en cada cambio de stock/precio.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'product-images';
const MAX_BYTES = 1048576; // Debe coincidir con file_size_limit del bucket (1MB).

/** Convierte un data URI base64 a Blob para subirlo a Storage. */
function dataUriToBlob(dataUri) {
    const [meta, b64] = dataUri.split(',');
    const mime = meta.match(/data:([^;]+)/)?.[1] || 'image/webp';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

function extFromMime(mime) {
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    return 'webp';
}

/** true si el valor ya es una URL de Storage del bucket product-images. */
export function isStorageImageUrl(value) {
    return typeof value === 'string'
        && /\/storage\/v1\/object\/public\/product-images\//.test(value);
}

/**
 * Sube una imagen (data URI base64) a Supabase Storage y devuelve su URL pública.
 *
 * SEGURO POR DISEÑO: devuelve `null` si no hay cliente cloud, si el valor no es
 * un data URI, si excede el límite del bucket, o si el upload falla (p.ej.
 * offline). En todos esos casos el caller DEBE conservar el base64 original para
 * no perder la imagen. Nunca lanza.
 *
 * @param {string} dataUri  data:image/...;base64,....
 * @param {{ id?: string }} opts  id estable (product.id) → ruta determinística,
 *        de modo que re-subir la imagen de un producto sobreescriba (upsert) en
 *        vez de acumular huérfanos.
 * @returns {Promise<string|null>} URL pública o null.
 */
export async function uploadProductImage(dataUri, opts = {}) {
    if (!supabaseCloud) return null;
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) return null;

    try {
        const blob = dataUriToBlob(dataUri);
        if (blob.size === 0 || blob.size > MAX_BYTES) return null;

        const deviceId = localStorage.getItem('pda_device_id') || 'shared';
        const ext = extFromMime(blob.type);
        const id = opts.id
            || (typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `${blob.size}_${blob.type.length}`);
        const path = `${deviceId}/${id}.${ext}`;

        const { error } = await supabaseCloud.storage
            .from(BUCKET)
            .upload(path, blob, { contentType: blob.type, upsert: true });

        const { data } = supabaseCloud.storage.from(BUCKET).getPublicUrl(path);
        if (!data?.publicUrl) return null;

        // OFFLINE-IMG (F4): la ruta es determinística y se sube con upsert, así
        // que cambiar la foto de un producto NO cambia la URL. El SW la sirve con
        // CacheFirst y mostraría la imagen vieja hasta que expire (90 días).
        // Un sello ?v= por subida hace que cada versión sea una clave de cache
        // distinta. Sigue matcheando el urlPattern de runtimeCaching y el regex
        // de isStorageImageUrl, que no anclan el final de la URL.
        const stamp = Date.now();
        const sep = data.publicUrl.includes('?') ? '&' : '?';
        return `${data.publicUrl}${sep}v=${stamp}`;
    } catch {
        return null;
    }
}

/**
 * Migra en lote las imágenes base64 ya existentes en un array de productos a
 * Storage, reemplazándolas por URLs. SEGURO: si un upload falla, conserva el
 * base64 de ese producto (nunca pierde datos). Solo llama a `saveFn` si migró
 * al menos una imagen.
 *
 * @param {Array} products
 * @param {(out:Array)=>Promise<void>} [saveFn]  persistidor (storageService.setItem)
 * @returns {Promise<{migrated:number,failed:number,total:number,products:Array}>}
 */
export async function migrateProductImagesToStorage(products, saveFn) {
    if (!Array.isArray(products) || !supabaseCloud) {
        return { migrated: 0, failed: 0, total: 0, products: products || [] };
    }

    let migrated = 0;
    let failed = 0;
    let total = 0;
    const out = [];

    for (const p of products) {
        if (p && typeof p.image === 'string' && p.image.startsWith('data:')) {
            total++;
            const url = await uploadProductImage(p.image, { id: p.id });
            if (url) {
                out.push({ ...p, image: url });
                migrated++;
            } else {
                out.push(p);
                failed++;
            }
        } else {
            out.push(p);
        }
    }

    if (migrated > 0 && typeof saveFn === 'function') {
        await saveFn(out);
    }

    return { migrated, failed, total, products: out };
}
