/**
 * syncConflicts.js — Detección y aviso de conflictos de sincronización (M-17).
 *
 * Los documentos NO append-only (catálogo/precios, fichas de clientes,
 * cuentas) se resuelven por LWW: el más nuevo gana y el otro se descarta en
 * silencio. Este módulo registra esos descartes cuando hay divergencia real
 * de contenido, para avisar en la UI en vez de perderlos sin rastro.
 *
 * - `recordSyncConflict({ key, docId, direction, detail })`: persiste (tope 20,
 *   los más recientes) y emite el evento `pda_sync_conflict` en window.
 * - `getSyncConflicts()` / `clearSyncConflicts()` / `SYNC_CONFLICT_EVENT`.
 *
 * Direcciones:
 * - 'remote-discarded': llegó un documento remoto pero se descartó por
 *   antiguo y su contenido difiere del confirmado (otro equipo lo modificó y
 *   perdió contra tu versión).
 * - 'local-overwritten': se aplicó un documento remoto más nuevo sobre un
 *   documento local con cambios sin confirmar (tus cambios perdieron).
 */

export const SYNC_CONFLICT_EVENT = 'pda_sync_conflict';
const STORAGE_KEY = 'pda_sync_conflicts';
const MAX_CONFLICTS = 20;

const FRIENDLY_KEY_NAMES = {
    bodega_products_v1: 'catálogo / precios',
    bodega_customers_v1: 'fichas de clientes',
    bodega_customer_ledger_v1: 'cartera (fiados)',
    bodega_accounts_v2: 'cuentas',
    bodega_stock_v1: 'stock',
    bodega_sales_v1: 'ventas',
};

export function friendlyConflictName(key) {
    if (key && FRIENDLY_KEY_NAMES[key]) return FRIENDLY_KEY_NAMES[key];
    return key || 'documento';
}

function conflictIdentity(conflict) {
    // Un conflicto pendiente por documento basta como aviso; releer la misma
    // fila con otro payload/fecha no debe llenar la lista repetidamente.
    return [conflict?.key, conflict?.docId, conflict?.direction]
        .map((part) => String(part ?? ''))
        .join('\u0000');
}

function deduplicateConflicts(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).filter((conflict) => {
        const identity = conflictIdentity(conflict);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
    }).slice(0, MAX_CONFLICTS);
}

/** Solo reporta divergencia si los cambios locales no están en el último push propio. */
export function isUnconfirmedLocalConflict(localHash, incomingHash, lastLocalPushHash) {
    return Boolean(
        lastLocalPushHash
        && localHash
        && incomingHash
        && localHash !== lastLocalPushHash
        && incomingHash !== localHash
    );
}

export function recordSyncConflict({ key, docId, direction, detail, fingerprint = null }) {
    const entry = {
        key: key || null,
        docId: docId || null,
        direction: direction || 'unknown',
        detail: detail || null,
        ...(fingerprint ? { fingerprint } : {}),
        at: new Date().toISOString(),
    };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const existing = deduplicateConflicts(list).find(
            (conflict) => conflictIdentity(conflict) === conflictIdentity(entry),
        );
        if (existing) return existing;
        const next = deduplicateConflicts([entry, ...(Array.isArray(list) ? list : [])]);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { /* almacenamiento no disponible: el evento igual se emite */ }
    try {
        window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail: entry }));
    } catch { /* sin window (tests): silenciar */ }
    return entry;
}

export function getSyncConflicts() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const unique = deduplicateConflicts(list);
        if (JSON.stringify(unique) !== JSON.stringify(list)) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(unique)); } catch { /* no bloquear lectura */ }
        }
        return unique;
    } catch { return []; }
}

export function clearSyncConflicts() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* silenciar */ }
    try {
        window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail: { cleared: true } }));
    } catch { /* sin window (tests): silenciar */ }
}
