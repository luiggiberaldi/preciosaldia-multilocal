/**
 * roles.js — Modelo de roles Fase 1.5 (dueño global + supervisor/cajero por negocio).
 *
 * Roles:
 * - `'DUENO'` — dueño global (PIN maestro, `utils/duenoAuth`). No está atado a
 *   ningún negocio: ve todo, gestiona negocios y ve la vista Supervisión
 *   (por sede + consolidado).
 * - `'ADMIN'` — supervisor del negocio ACTIVO: dashboard de su sede,
 *   inventario, tasas y gestión de cajeros. Sin datos fiscales ni
 *   crear/eliminar negocios.
 * - `'CAJERO'` — cajero del negocio activo: solo POS (ventas) y clientes
 *   (fiados). Sin dashboard financiero, inventario administrativo, tasas,
 *   usuarios ni ajustes.
 *
 * Compatibilidad: los valores almacenados en usuarios siguen siendo
 * `'ADMIN'`/`'CAJERO'` porque el modo supervisor por pairing (congelado,
 * Fase 0.x) y varios servicios comparan esos strings literalmente. El
 * significado documentado de `ADMIN` pasa a ser "supervisor del negocio".
 * `'DUENO'` nunca aparece en la lista de usuarios de un negocio: es solo
 * sesión global.
 *
 * @module utils/roles
 */

export const ROL_DUENO = 'DUENO';
export const ROL_SUPERVISOR = 'ADMIN';
export const ROL_CAJERO = 'CAJERO';

/** Tabs de la app (ids usados en App.jsx). */
export const TABS_DUENO_SUPERVISOR = Object.freeze([
    'inicio', 'ventas', 'catalogo', 'clientes', 'reportes', 'ajustes', 'supervision',
]);
export const TABS_CAJERO = Object.freeze(['ventas', 'clientes']);

export function getRol(session) {
    return session?.rol ?? null;
}

export function isOwner(session) {
    return getRol(session) === ROL_DUENO;
}

export function isSupervisor(session) {
    return getRol(session) === ROL_SUPERVISOR;
}

export function isCashier(session) {
    return getRol(session) === ROL_CAJERO;
}

/**
 * Acceso nivel "admin": dueño o supervisor del negocio.
 * Reemplaza los chequeos dispersos `rol === 'ADMIN'` (el dueño puede todo
 * lo que puede un supervisor, y más).
 */
export function hasAdminAccess(session) {
    return isOwner(session) || isSupervisor(session);
}

/**
 * ¿Puede crear/editar/eliminar negocios (incluidos sus datos fiscales)?
 * Solo el dueño global.
 */
export function canManageBusinesses(session) {
    return isOwner(session);
}

/**
 * ¿Puede el gestor (`managerSession`) crear un usuario con el rol dado
 * dentro del negocio activo?
 */
export function canCreateRole(managerSession, rol) {
    if (isOwner(managerSession)) return rol === ROL_SUPERVISOR || rol === ROL_CAJERO;
    if (isSupervisor(managerSession)) return rol === ROL_CAJERO;
    return false;
}

/**
 * ¿Puede el gestor administrar (editar/eliminar) al usuario objetivo?
 * El dueño puede todo; el supervisor solo a cajeros.
 */
export function canManageUser(managerSession, targetUser) {
    if (isOwner(managerSession)) return true;
    if (isSupervisor(managerSession)) return targetUser?.rol === ROL_CAJERO;
    return false;
}

/**
 * Tabs visibles para la sesión dada.
 * Sin `requireLogin` no hay sesión: acceso total (comportamiento legacy).
 */
export function visibleTabIds({ requireLogin, usuarioActivo } = {}) {
    if (!requireLogin) return [...TABS_DUENO_SUPERVISOR];
    if (isOwner(usuarioActivo) || isSupervisor(usuarioActivo)) return [...TABS_DUENO_SUPERVISOR];
    if (isCashier(usuarioActivo)) return [...TABS_CAJERO];
    return [];
}

/**
 * Tab de aterrizaje tras un login exitoso.
 */
export function landingTab({ requireLogin, usuarioActivo } = {}) {
    if (!requireLogin) return 'inicio';
    if (isCashier(usuarioActivo)) return 'ventas';
    if (isOwner(usuarioActivo)) return 'supervision';
    return 'inicio';
}
