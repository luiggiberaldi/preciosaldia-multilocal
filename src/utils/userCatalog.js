/**
 * userCatalog.js — Catálogo de usuarios sincronizado entre equipos (sin PINs).
 *
 * SEC-002: los hashes de PIN (`pin`) y PINs en texto plano (`plainPin`) NUNCA
 * viajan a la nube. Lo que sí se sincroniza vía `sync_documents`
 * (`bodega_users_catalog_v1`, colección `store`) es el catálogo sanitizado:
 * `{ v, users: [{ id, nombre, rol, requirePin }], deleted: [{ id, deletedAt }] }`.
 *
 * - Push: `useAuthStore` publica el doc tras agregar/eliminar/editar usuario.
 * - Pull: `useCloudSync._applyFromCloud` fusiona con `mergeUserCatalog`,
 *   preservando los PINs locales. Un usuario que llega sin PIN local queda
 *   marcado `pinPendiente: true` hasta que un admin defina su PIN en el equipo.
 * - Borrados: se propagan con tombstones (`deleted`), podados a 30 días.
 *
 * @module utils/userCatalog
 */

import { getNegocioActivoId } from './negocioContext';

/** Clave del documento en `sync_documents`. */
export const USER_CATALOG_DOC_KEY = 'bodega_users_catalog_v1';

/** Versión del formato del documento. */
export const USER_CATALOG_DOC_VERSION = 1;

/** TTL de los tombstones: un borrado se recuerda 30 días. */
export const USER_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOMBSTONE_STORAGE_PREFIX = 'bodega_users_tombstones_v1';

/**
 * Elimina hashes de PIN (`pin`) y PINs en texto plano (`plainPin`) antes de
 * sincronizar `bodega_users_catalog_v1` a sync_documents.
 */
export function sanitizeUserCatalog(users) {
    if (!Array.isArray(users)) return [];
    return users.map(user => {
        const { pin, plainPin, ...safeUser } = user;
        return safeUser;
    });
}

/** Clave de localStorage para los tombstones (por negocio, como el auth). */
function tombstoneStorageKey() {
    const id = (() => { try { return getNegocioActivoId(); } catch { return null; } })();
    return id ? `nb_${id}:${TOMBSTONE_STORAGE_PREFIX}` : TOMBSTONE_STORAGE_PREFIX;
}

function safeRead(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function safeWrite(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch { /* almacenamiento lleno/bloqueado: no romper el flujo */ }
}

/** Lee los tombstones locales `[{ id, deletedAt }]`. */
export function readUserTombstones() {
    return safeRead(tombstoneStorageKey())
        .filter(t => t && t.id != null)
        .map(t => ({ id: t.id, deletedAt: Number(t.deletedAt) || 0 }));
}

/** Persiste la lista de tombstones. */
export function writeUserTombstones(tombstones) {
    safeWrite(tombstoneStorageKey(), Array.isArray(tombstones) ? tombstones : []);
}

/**
 * Registra el borrado de un usuario para propagarlo a los demás equipos.
 * Idempotente: refresca `deletedAt` si ya existía.
 */
export function addUserTombstone(userId) {
    if (userId == null) return readUserTombstones();
    const now = Date.now();
    const rest = readUserTombstones().filter(t => t.id !== userId);
    const next = [...rest, { id: userId, deletedAt: now }];
    writeUserTombstones(next);
    return next;
}

/** Poda tombstones más viejos que el TTL (evita crecimiento sin cota). */
export function pruneUserTombstones(tombstones, now = Date.now()) {
    if (!Array.isArray(tombstones)) return [];
    return tombstones.filter(t => t && t.id != null && (now - (Number(t.deletedAt) || 0)) < USER_TOMBSTONE_TTL_MS);
}

/**
 * Construye el documento a publicar en `sync_documents`.
 * Solo viajan id/nombre/rol/requirePin + tombstones. NUNCA PINs.
 */
export function buildUserCatalogDoc(users, tombstones) {
    const cleanUsers = sanitizeUserCatalog(users)
        .filter(u => u && u.id != null)
        .map(u => ({
            id: u.id,
            // uid estable (ver _newUserUid en useAuthStore): distingue un
            // renombrado de una colisión de id entre equipos.
            ...(u.uid ? { uid: u.uid } : {}),
            nombre: typeof u.nombre === 'string' ? u.nombre : '',
            rol: typeof u.rol === 'string' ? u.rol : 'CAJERO',
            requirePin: u.requirePin !== false,
        }));
    return {
        v: USER_CATALOG_DOC_VERSION,
        users: cleanUsers,
        deleted: pruneUserTombstones(tombstones),
    };
}

/** Valida la forma del documento (allowlist + STORE_SCHEMAS). */
export function isValidUserCatalogDoc(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
    if (doc.v !== USER_CATALOG_DOC_VERSION || !Array.isArray(doc.users)) return false;
    if (doc.deleted !== undefined && !Array.isArray(doc.deleted)) return false;
    // SEC-002: el doc jamás debe incluir PINs, ni siquiera por accidente.
    return doc.users.every(u =>
        u && typeof u === 'object'
        && u.id != null
        && typeof u.nombre === 'string'
        && typeof u.rol === 'string'
        && !('pin' in u)
        && !('plainPin' in u)
    );
}

/**
 * Fusiona el catálogo remoto con los usuarios locales.
 *
 * Reglas:
 * - Match por `uid` (estable): un renombrado actualiza nombre/rol/requirePin
 *   del mismo usuario y conserva su PIN local.
 * - Sin `uid` (usuarios legacy): match por id + mismo nombre; si el nombre
 *   difiere se trata como colisión (nunca se reasocia un PIN a otro nombre).
 * - El PIN local (`pin`/`plainPin`) se preserva SIEMPRE.
 * - Usuario remoto sin contraparte local → se agrega con `pin: null` y
 *   `pinPendiente: true` (un admin debe definir su PIN en este equipo). Si su
 *   id numérico ya está ocupado por otro usuario, se le asigna uno libre.
 * - Tombstone remoto → el usuario se elimina localmente (no resucita).
 * - Usuario local ausente del remoto y sin tombstone → se conserva (su push
 *   posterior lo propagará; evita borrar creaciones offline).
 *
 * @param {Array} localUsers usuarios del auth store local (con PINs)
 * @param {object} doc documento remoto `{ v, users, deleted }`
 * @returns {Array} usuarios fusionados listos para el store
 */
export function mergeUserCatalog(localUsers, doc) {
    const local = Array.isArray(localUsers) ? localUsers : [];
    const remoteUsers = doc && Array.isArray(doc.users) ? doc.users : [];
    const deletedIds = new Set(
        (doc && Array.isArray(doc.deleted) ? doc.deleted : [])
            .map(d => d && d.id)
            .filter(id => id != null)
    );

    const localByUid = new Map();
    const localById = new Map();
    for (const u of local) {
        if (!u) continue;
        if (u.uid) localByUid.set(u.uid, u);
        if (u.id != null) localById.set(u.id, u);
    }
    let nextId = local.reduce((m, u) => Math.max(m, Number(u?.id) || 0), 0);
    // Ids numéricos ocupados (locales + asignados en este merge): jamás se
    // reutilizan dentro del merge para no pisar a otro usuario.
    const takenIds = new Set(localById.keys());
    const seenRemoteIds = new Set();
    const mergedById = new Map();

    const pushMerged = (u) => {
        if (!u || u.id == null) return;
        mergedById.set(u.id, u);
        takenIds.add(u.id);
    };

    const allocId = (preferred) => {
        let id = preferred;
        while (id == null || takenIds.has(id)) {
            nextId += 1;
            id = nextId;
        }
        return id;
    };

    for (const r of remoteUsers) {
        if (!r || r.id == null || deletedIds.has(r.id) || seenRemoteIds.has(r.id)) continue;
        seenRemoteIds.add(r.id);

        // 1) Match por uid: es el mismo usuario aunque lo hayan renombrado.
        //    El PIN local se conserva; nombre/rol/requirePin remotos ganan.
        const byUid = (r.uid && localByUid.get(r.uid)) || null;
        if (byUid) {
            pushMerged({
                ...byUid,
                nombre: typeof r.nombre === 'string' ? r.nombre : byUid.nombre,
                rol: typeof r.rol === 'string' ? r.rol : byUid.rol,
                requirePin: r.requirePin !== false,
            });
            continue;
        }

        // 2) Fallback legacy (sin uid en ningún lado): solo si id + nombre
        //    coinciden se considera el mismo usuario.
        if (!r.uid) {
            const byId = localById.get(r.id);
            if (byId && !byId.uid && byId.nombre === r.nombre && !mergedById.has(byId.id)) {
                pushMerged({
                    ...byId,
                    rol: typeof r.rol === 'string' ? r.rol : byId.rol,
                    requirePin: r.requirePin !== false,
                });
                continue;
            }
        }

        // 2b) Fallback equipo nuevo: el usuario local (creado por defecto con
        //     uid aleatorio) y el remoto son el mismo si coinciden nombre+rol
        //     y el local aún no fue fusionado. Adopta el uid remoto para que
        //     futuros merges lo reconozcan por uid.
        if (r.uid) {
            const byNameRol = local.find(u =>
                u && u.id != null &&
                !mergedById.has(u.id) &&
                u.nombre === r.nombre &&
                u.rol === r.rol
            );
            if (byNameRol) {
                pushMerged({
                    ...byNameRol,
                    uid: r.uid,
                    nombre: typeof r.nombre === 'string' ? r.nombre : byNameRol.nombre,
                    rol: typeof r.rol === 'string' ? r.rol : byNameRol.rol,
                    requirePin: r.requirePin !== false,
                });
                continue;
            }
        }

        // 2c) Remoto legacy SIN uid: si un local aún no fusionado tiene el mismo
        //     nombre+rol, es el mismo usuario. Sin esto cada merge agrega una
        //     copia nueva (duplica al cambiar de sede). Conserva el uid local.
        if (!r.uid) {
            const byNameRolLegacy = local.find(u =>
                u && u.id != null &&
                !mergedById.has(u.id) &&
                u.nombre === r.nombre &&
                u.rol === r.rol
            );
            if (byNameRolLegacy) {
                pushMerged({
                    ...byNameRolLegacy,
                    nombre: typeof r.nombre === 'string' ? r.nombre : byNameRolLegacy.nombre,
                    rol: typeof r.rol === 'string' ? r.rol : byNameRolLegacy.rol,
                    requirePin: r.requirePin !== false,
                });
                continue;
            }
        }

        // 3) Usuario nuevo para este equipo: entra con `pinPendiente: true`.
        //    Si su id numérico ya está ocupado, se le asigna uno libre
        //    (el uid lo identifica de forma estable entre equipos).
        pushMerged({
            id: allocId(r.id),
            ...(r.uid ? { uid: r.uid } : {}),
            nombre: r.nombre,
            rol: r.rol,
            requirePin: r.requirePin !== false,
            pin: null,
            pinPendiente: true,
        });
    }

    for (const u of local) {
        if (!u || u.id == null) continue;
        if (deletedIds.has(u.id)) continue;      // borrado propagado
        if (mergedById.has(u.id)) continue;      // ya fusionado arriba
        pushMerged(u);                           // creación local aún no vista
    }

    return [...mergedById.values()];
}
