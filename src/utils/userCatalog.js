/**
 * userCatalog.js — Sanitización de catálogo de usuarios para la nube (SEC-002).
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
