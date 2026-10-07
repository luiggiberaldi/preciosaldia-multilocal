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
 * V2.1.57: acepta las tumbas de eliminación (`deletedBusinesses`) para que
 * un borrado viaje con el documento y ninguna caja lo reviva al fusionar.
 * @param {Array} negocios - Lista local de negocios.
 * @param {Array} [deletedBusinesses] - Tumbas: [{ id, deletedAt }].
 * @returns {{businesses: Array, updatedAt: string, deletedBusinesses?: Array}}
 */
export function buildBusinessRegistryDoc(negocios, deletedBusinesses) {
    const list = Array.isArray(negocios) ? negocios : [];
    const doc = {
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
    const tombs = sanitizeTombstones(deletedBusinesses);
    if (tombs.length > 0) doc.deletedBusinesses = tombs;
    return doc;
}

/**
 * Normaliza una lista de tumbas: solo {id, deletedAt}, sin duplicados.
 * @param {Array} list
 * @returns {Array<{id: string, deletedAt: string}>}
 */
export function sanitizeTombstones(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const t of list) {
        if (!t || typeof t.id !== 'string' || !t.id || seen.has(t.id)) continue;
        seen.add(t.id);
        out.push({ id: t.id, deletedAt: typeof t.deletedAt === 'string' ? t.deletedAt : '' });
    }
    return out;
}

/**
 * Extrae las tumbas válidas de un documento (vacío si no trae).
 * @param {object} doc
 * @returns {Array<{id: string, deletedAt: string}>}
 */
export function readTombstones(doc) {
    if (!doc || typeof doc !== 'object') return [];
    return sanitizeTombstones(doc.deletedBusinesses);
}

/**
 * Une tumbas de varias fuentes por id (una sede borrada es borrada en todas).
 * @param {...Array} lists
 * @returns {Array<{id: string, deletedAt: string}>}
 */
export function mergeTombstones(...lists) {
    const byId = new Map();
    for (const list of lists) {
        for (const t of sanitizeTombstones(list)) {
            const prev = byId.get(t.id);
            // Conservar la tumba más reciente si llega por dos caminos.
            if (!prev || (t.deletedAt && t.deletedAt > prev.deletedAt)) byId.set(t.id, t);
        }
    }
    return [...byId.values()];
}

/**
 * Quita de `businesses` toda sede con tumba de eliminación.
 * @param {Array} businesses
 * @param {Array} tombstones
 * @returns {Array}
 */
export function pruneTombstoned(businesses, tombstones) {
    const list = Array.isArray(businesses) ? businesses : [];
    if (!tombstones || tombstones.length === 0) return list;
    const dead = new Set(tombstones.map(t => t.id));
    return list.filter(n => n && !dead.has(n.id));
}

/**
 * Valida la forma del documento remoto.
 * V2.1.57: acepta `deletedBusinesses` (tumbas) si viene; si trae un tipo
 * distinto a array, el documento es inválido (protege el merge).
 */
export function isValidBusinessRegistryDoc(doc) {
    if (!doc || typeof doc !== 'object') return false;
    if (!Array.isArray(doc.businesses)) return false;
    if (doc.deletedBusinesses !== undefined) {
        if (!Array.isArray(doc.deletedBusinesses)) return false;
        const ok = doc.deletedBusinesses.every(t => t && typeof t.id === 'string' && t.id);
        if (!ok) return false;
    }
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
