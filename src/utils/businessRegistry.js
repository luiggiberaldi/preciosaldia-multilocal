/**
 * businessRegistry.js — Registro de negocios sincronizado (multi-sede).
 *
 * El registro de negocios (`pda-negocios-registry`) es GLOBAL (no namespaced
 * por negocio). Para que un equipo nuevo descubra automáticamente las sedes,
 * el registro se publica a la nube como documento global y se fusiona al
 * recibirlo.
 *
 * - Push: `useNegociosStore` publica vía `queueCloudSync` cuando cambia.
 * - Pull: `useCloudSync._applyFromCloud` fusiona con `mergeBusinessRegistry`.
 *
 * El documento solo lleva id, nombre y datos fiscales (para recibos).
 * Jamás incluye PINs ni secretos.
 *
 * @module utils/businessRegistry
 */

export const BUSINESS_REGISTRY_DOC_KEY = 'bodega_businesses_registry_v1';

/**
 * Construye el documento sanitizado para la nube.
 * @param {Array} negocios - Lista local de negocios.
 * @returns {{businesses: Array, updatedAt: string}}
 */
export function buildBusinessRegistryDoc(negocios) {
    const list = Array.isArray(negocios) ? negocios : [];
    return {
        businesses: list
            .filter(n => n && typeof n.id === 'string' && n.id)
            .map(n => ({
                id: n.id,
                nombre: String(n.nombre ?? '').trim() || 'Mi negocio',
                rif: String(n.rif ?? '').trim(),
                direccion: String(n.direccion ?? '').trim(),
                telefono: String(n.telefono ?? '').trim(),
                createdAt: n.createdAt || null,
            })),
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Valida la forma del documento remoto.
 */
export function isValidBusinessRegistryDoc(doc) {
    if (!doc || typeof doc !== 'object') return false;
    if (!Array.isArray(doc.businesses)) return false;
    return doc.businesses.every(b =>
        b && typeof b.id === 'string' && b.id &&
        typeof b.nombre === 'string'
    );
}

/**
 * Fusiona el registro remoto con el local.
 * - Match por id: el remoto actualiza nombre/datos fiscales.
 * - Sin match: el negocio remoto se agrega (sede descubierta).
 * - Los locales sin contraparte remota se conservan.
 * - El `negocioActivoId` NO se toca: cada equipo mantiene su sede activa.
 *
 * @param {Array} localNegocios - Negocios locales.
 * @param {Object} doc - Documento remoto.
 * @returns {Array} Lista fusionada.
 */
export function mergeBusinessRegistry(localNegocios, doc) {
    const local = Array.isArray(localNegocios) ? localNegocios : [];
    const remote = doc && Array.isArray(doc.businesses) ? doc.businesses : [];

    const byId = new Map();
    for (const n of local) {
        if (n && n.id) byId.set(n.id, { ...n });
    }
    for (const r of remote) {
        if (!r || !r.id) continue;
        const existing = byId.get(r.id);
        if (existing) {
            // El remoto actualiza datos descriptivos; se conserva createdAt local.
            byId.set(r.id, {
                ...existing,
                nombre: typeof r.nombre === 'string' && r.nombre.trim() ? r.nombre.trim() : existing.nombre,
                rif: typeof r.rif === 'string' ? r.rif : (existing.rif ?? ''),
                direccion: typeof r.direccion === 'string' ? r.direccion : (existing.direccion ?? ''),
                telefono: typeof r.telefono === 'string' ? r.telefono : (existing.telefono ?? ''),
            });
        } else {
            // Sede nueva descubierta por este equipo.
            byId.set(r.id, {
                id: r.id,
                nombre: r.nombre,
                rif: r.rif ?? '',
                direccion: r.direccion ?? '',
                telefono: r.telefono ?? '',
                createdAt: r.createdAt || new Date().toISOString(),
            });
        }
    }
    return [...byId.values()];
}
