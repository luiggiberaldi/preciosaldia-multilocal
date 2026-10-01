/**
 * roles.test.js — Tests del modelo de roles (Fase 1.5, renombre Fase B).
 *
 * Cubren la matriz de permisos: dueño global, administrador (ADMIN) y cajero
 * (CAJERO). Los valores almacenados siguen siendo 'ADMIN'/'CAJERO' por
 * compatibilidad; aquí se verifica el significado. Los alias deprecated
 * (ROL_SUPERVISOR, isSupervisor, TABS_DUENO_SUPERVISOR) se verifican una vez.
 */
import { describe, it, expect } from 'vitest';
import {
    ROL_DUENO,
    ROL_ADMINISTRADOR,
    ROL_CAJERO,
    ROL_SUPERVISOR,
    TABS_DUENO_ADMIN,
    TABS_DUENO_SUPERVISOR,
    isOwner,
    isAdministrador,
    isSupervisor,
    isCashier,
    hasAdminAccess,
    canManageBusinesses,
    canCreateRole,
    canManageUser,
    visibleTabIds,
    landingTab,
} from '../src/utils/roles';

const DUENO = { id: 'dueno', nombre: 'Dueño', rol: 'DUENO', global: true };
const ADMIN = { id: 1, nombre: 'Admin', rol: 'ADMIN' };
const CAJERO = { id: 2, nombre: 'Caja', rol: 'CAJERO' };

describe('identidad de roles', () => {
    it('distingue dueño / administrador / cajero', () => {
        expect(isOwner(DUENO)).toBe(true);
        expect(isAdministrador(ADMIN)).toBe(true);
        expect(isCashier(CAJERO)).toBe(true);
        expect(isOwner(ADMIN)).toBe(false);
        expect(isAdministrador(CAJERO)).toBe(false);
        expect(isCashier(DUENO)).toBe(false);
    });

    it('hasAdminAccess: dueño y administrador sí, cajero no', () => {
        expect(hasAdminAccess(DUENO)).toBe(true);
        expect(hasAdminAccess(ADMIN)).toBe(true);
        expect(hasAdminAccess(CAJERO)).toBe(false);
        expect(hasAdminAccess(null)).toBe(false);
    });

    it('aliases deprecated (Fase B) siguen resolviendo al mismo valor', () => {
        expect(ROL_SUPERVISOR).toBe(ROL_ADMINISTRADOR);
        expect(ROL_SUPERVISOR).toBe('ADMIN');
        expect(TABS_DUENO_SUPERVISOR).toBe(TABS_DUENO_ADMIN);
        expect(isSupervisor(ADMIN)).toBe(true);
        expect(isSupervisor(CAJERO)).toBe(false);
    });
});

describe('gestión de negocios', () => {
    it('solo el dueño puede crear/editar/eliminar negocios', () => {
        expect(canManageBusinesses(DUENO)).toBe(true);
        expect(canManageBusinesses(ADMIN)).toBe(false);
        expect(canManageBusinesses(CAJERO)).toBe(false);
    });
});

describe('gestión de usuarios', () => {
    it('el dueño puede crear administradores y cajeros (nunca otro dueño)', () => {
        expect(canCreateRole(DUENO, ROL_ADMINISTRADOR)).toBe(true);
        expect(canCreateRole(DUENO, ROL_CAJERO)).toBe(true);
        expect(canCreateRole(DUENO, ROL_DUENO)).toBe(false);
    });

    it('el administrador solo puede crear cajeros', () => {
        expect(canCreateRole(ADMIN, ROL_CAJERO)).toBe(true);
        expect(canCreateRole(ADMIN, ROL_ADMINISTRADOR)).toBe(false);
        expect(canCreateRole(ADMIN, ROL_DUENO)).toBe(false);
    });

    it('el cajero no puede crear usuarios', () => {
        expect(canCreateRole(CAJERO, ROL_CAJERO)).toBe(false);
    });

    it('el dueño puede administrar a cualquiera; el administrador solo a cajeros', () => {
        expect(canManageUser(DUENO, ADMIN)).toBe(true);
        expect(canManageUser(DUENO, CAJERO)).toBe(true);
        expect(canManageUser(ADMIN, CAJERO)).toBe(true);
        expect(canManageUser(ADMIN, ADMIN)).toBe(false);
        expect(canManageUser(CAJERO, CAJERO)).toBe(false);
    });
});

describe('tabs visibles', () => {
    it('sin requireLogin hay acceso total (legacy)', () => {
        const tabs = visibleTabIds({ requireLogin: false, usuarioActivo: null });
        expect(tabs).toContain('reportes');
        expect(tabs).toContain('ajustes');
        expect(tabs).toContain('supervision');
    });

    it('dueño y administrador ven todo incl. supervisión', () => {
        for (const s of [DUENO, ADMIN]) {
            const tabs = visibleTabIds({ requireLogin: true, usuarioActivo: s });
            expect(tabs).toEqual(
                expect.arrayContaining(['inicio', 'ventas', 'catalogo', 'clientes', 'reportes', 'ajustes', 'supervision'])
            );
        }
    });

    it('el cajero solo ve ventas y clientes', () => {
        const tabs = visibleTabIds({ requireLogin: true, usuarioActivo: CAJERO });
        expect(tabs).toEqual(['inicio', 'ventas', 'catalogo', 'clientes']);
    });
});

describe('tab de aterrizaje', () => {
    it('cajero → ventas, dueño → supervisión, administrador → inicio', () => {
        expect(landingTab({ requireLogin: true, usuarioActivo: CAJERO })).toBe('ventas');
        expect(landingTab({ requireLogin: true, usuarioActivo: DUENO })).toBe('supervision');
        expect(landingTab({ requireLogin: true, usuarioActivo: ADMIN })).toBe('inicio');
        expect(landingTab({ requireLogin: false, usuarioActivo: null })).toBe('inicio');
    });
});
