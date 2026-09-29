/**
 * roles.test.js — Tests del modelo de roles Fase 1.5.
 *
 * Cubren la matriz de permisos: dueño global, supervisor (ADMIN) y cajero
 * (CAJERO). Los valores almacenados siguen siendo 'ADMIN'/'CAJERO' por
 * compatibilidad con el pairing congelado; aquí se verifica el significado.
 */
import { describe, it, expect } from 'vitest';
import {
    ROL_DUENO,
    ROL_SUPERVISOR,
    ROL_CAJERO,
    isOwner,
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
const SUPERVISOR = { id: 1, nombre: 'Admin', rol: 'ADMIN' };
const CAJERO = { id: 2, nombre: 'Caja', rol: 'CAJERO' };

describe('identidad de roles', () => {
    it('distingue dueño / supervisor / cajero', () => {
        expect(isOwner(DUENO)).toBe(true);
        expect(isSupervisor(SUPERVISOR)).toBe(true);
        expect(isCashier(CAJERO)).toBe(true);
        expect(isOwner(SUPERVISOR)).toBe(false);
        expect(isSupervisor(CAJERO)).toBe(false);
        expect(isCashier(DUENO)).toBe(false);
    });

    it('hasAdminAccess: dueño y supervisor sí, cajero no', () => {
        expect(hasAdminAccess(DUENO)).toBe(true);
        expect(hasAdminAccess(SUPERVISOR)).toBe(true);
        expect(hasAdminAccess(CAJERO)).toBe(false);
        expect(hasAdminAccess(null)).toBe(false);
    });
});

describe('gestión de negocios', () => {
    it('solo el dueño puede crear/editar/eliminar negocios', () => {
        expect(canManageBusinesses(DUENO)).toBe(true);
        expect(canManageBusinesses(SUPERVISOR)).toBe(false);
        expect(canManageBusinesses(CAJERO)).toBe(false);
    });
});

describe('gestión de usuarios', () => {
    it('el dueño puede crear supervisores y cajeros (nunca otro dueño)', () => {
        expect(canCreateRole(DUENO, ROL_SUPERVISOR)).toBe(true);
        expect(canCreateRole(DUENO, ROL_CAJERO)).toBe(true);
        expect(canCreateRole(DUENO, ROL_DUENO)).toBe(false);
    });

    it('el supervisor solo puede crear cajeros', () => {
        expect(canCreateRole(SUPERVISOR, ROL_CAJERO)).toBe(true);
        expect(canCreateRole(SUPERVISOR, ROL_SUPERVISOR)).toBe(false);
        expect(canCreateRole(SUPERVISOR, ROL_DUENO)).toBe(false);
    });

    it('el cajero no puede crear usuarios', () => {
        expect(canCreateRole(CAJERO, ROL_CAJERO)).toBe(false);
    });

    it('el dueño puede administrar a cualquiera; el supervisor solo a cajeros', () => {
        expect(canManageUser(DUENO, SUPERVISOR)).toBe(true);
        expect(canManageUser(DUENO, CAJERO)).toBe(true);
        expect(canManageUser(SUPERVISOR, CAJERO)).toBe(true);
        expect(canManageUser(SUPERVISOR, SUPERVISOR)).toBe(false);
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

    it('dueño y supervisor ven todo incl. supervisión', () => {
        for (const s of [DUENO, SUPERVISOR]) {
            const tabs = visibleTabIds({ requireLogin: true, usuarioActivo: s });
            expect(tabs).toEqual(
                expect.arrayContaining(['inicio', 'ventas', 'catalogo', 'clientes', 'reportes', 'ajustes', 'supervision'])
            );
        }
    });

    it('el cajero solo ve ventas y clientes', () => {
        const tabs = visibleTabIds({ requireLogin: true, usuarioActivo: CAJERO });
        expect(tabs).toEqual(['ventas', 'clientes']);
    });
});

describe('tab de aterrizaje', () => {
    it('cajero → ventas, dueño → supervisión, supervisor → inicio', () => {
        expect(landingTab({ requireLogin: true, usuarioActivo: CAJERO })).toBe('ventas');
        expect(landingTab({ requireLogin: true, usuarioActivo: DUENO })).toBe('supervision');
        expect(landingTab({ requireLogin: true, usuarioActivo: SUPERVISOR })).toBe('inicio');
        expect(landingTab({ requireLogin: false, usuarioActivo: null })).toBe('inicio');
    });
});
