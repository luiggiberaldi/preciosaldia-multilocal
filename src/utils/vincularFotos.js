// VINCULAR-FOTOS-001: vincula fotos de productos desde Supabase Storage.
// Usa el mapeo barcode -> filename (public/barcode_to_photo.json) generado
// desde ~/workspace/inventarios-limpios/mapeo_fotos_bodega.json
// Actualiza el campo `image` de cada producto cuyo barcode tenga foto.

const STORAGE_BASE = 'https://oshexsmweswzbwaksvra.supabase.co/storage/v1/object/public/product-images';

let _mapeoCache = null;

async function cargarMapeo() {
    if (_mapeoCache) return _mapeoCache;
    const res = await fetch('/barcode_to_photo.json');
    if (!res.ok) throw new Error('No se pudo cargar el mapeo de fotos');
    _mapeoCache = await res.json();
    return _mapeoCache;
}

/**
 * Vincula fotos a productos por barcode.
 * @param {Array} products - Lista de productos (con campo barcode)
 * @returns {Promise<{actualizados: number, total: number}>}
 */
export async function vincularFotos(products) {
    const mapeo = await cargarMapeo();
    let actualizados = 0;

    for (const p of products) {
        const barcode = String(p.barcode || '').trim();
        if (!barcode) continue;
        const filename = mapeo[barcode];
        if (filename && p.image !== `${STORAGE_BASE}/${filename}`) {
            p.image = `${STORAGE_BASE}/${filename}`;
            actualizados++;
        }
    }

    return { actualizados, total: products.length };
}

export { STORAGE_BASE };
