/**
 * roles.js — Modelo de roles Fase 1.5 (dueño global + administrador/cajero por negocio).
 *
 * Roles:
 * - `'DUENO'` — dueño global (PIN maestro, `utils/duenoAuth`). No está atado a
 *   ningún negocio: ve todo, gestiona negocios y ve la vista Supervisión
 *   (por sede + consolidado).
 * - `'ADMIN'` — administrador del negocio ACTIVO: dashboard de su sede,
 *   inventario, tasas y gestión de cajeros. Sin datos fiscales ni
 *   crear/eliminar negocios.
 * - `'CAJERO'` — cajero del negocio activo: Inicio (resumen de su turno, sin
 *   finanzas), POS (ventas), inventario en modo solo-lectura (ver productos,
 *   precios y stock; sin crear/editar/eliminar, sin costos ni ajustes de
 *   stock) y clientes (fiados). Sin dashboard financiero, tasas, usuarios
 *   ni ajustes.
 *
 * Compatibilidad: los valores almacenados en usuarios siguen siendo
 * `'ADMIN'`/`'CAJERO'` porque varios servicios comparan esos strings
 * literalmente. El significado documentado de `ADMIN` es "administrador del
 * negocio". (Antes se le decía "supervisor"; se renombró en Fase B para
 * unificar con la UI y no chocar con el modo pairing congelado, que también
 * se llamaba "supervisor".)
 * `'DUENO'` nunca aparece en la lista de usuarios de un negocio: es solo
 * sesión global.
 *
 * @module utils/roles
 */

export const ROL_DUENO = 'DUENO';
export const ROL_ADMINISTRADOR = 'ADMIN';
export const ROL_CAJERO = 'CAJERO';

/** Tabs de la app (ids usados en App.jsx). */
export const TABS_DUENO_ADMIN = Object.freeze([
    'inicio', 'ventas', 'catalogo', 'clientes', 'reportes', 'ajustes', 'supervision',
]);
export const TABS_CAJERO = Object.freeze(['inicio', 'ventas', 'catalogo', 'clientes']);

export function getRol(session) {
    return session?.rol ?? null;
}

export function isOwner(session) {
    return getRol(session) === ROL_DUENO;
}

export function isAdministrador(session) {
    return getRol(session) === ROL_ADMINISTRADOR;
}

export function isCashier(session) {
    return getRol(session) === ROL_CAJERO;
}

/**
 * Acceso nivel "admin": dueño o administrador del negocio.
 * Reemplaza los chequeos dispersos `rol === 'ADMIN'` (el dueño puede todo
 * lo que puede un administrador, y más).
 */
export function hasAdminAccess(session) {
    return isOwner(session) || isAdministrador(session);
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
    if (isOwner(managerSession)) return rol === ROL_ADMINISTRADOR || rol === ROL_CAJERO;
    if (isAdministrador(managerSession)) return rol === ROL_CAJERO;
    return false;
}

/**
 * ¿Puede el gestor administrar (editar/eliminar) al usuario objetivo?
 * El dueño puede todo; el administrador solo a cajeros.
 */
export function canManageUser(managerSession, targetUser) {
    if (isOwner(managerSession)) return true;
    if (isAdministrador(managerSession)) return targetUser?.rol === ROL_CAJERO;
    return false;
}

/**
 * Tabs visibles para la sesión dada.
 * Sin `requireLogin` no hay sesión: acceso total (comportamiento legacy).
 */
export function visibleTabIds({ requireLogin, usuarioActivo } = {}) {
    if (!requireLogin) return [...TABS_DUENO_ADMIN];
    if (isOwner(usuarioActivo) || isAdministrador(usuarioActivo)) return [...TABS_DUENO_ADMIN];
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

// ── Aliases deprecated (Fase B): se mantienen una versión para no romper
// imports externos; usar los nombres nuevos. ──
/** @deprecated usar ROL_ADMINISTRADOR */
export const ROL_SUPERVISOR = ROL_ADMINISTRADOR;
/** @deprecated usar TABS_DUENO_ADMIN */
export const TABS_DUENO_SUPERVISOR = TABS_DUENO_ADMIN;
/** @deprecated usar isAdministrador */
export const isSupervisor = isAdministrador;
