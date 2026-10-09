/**
 * userCatalogSede.test.js — Aislamiento del catálogo de usuarios por sede.
 *
 * Los usuarios viven en una lista global del dispositivo, pero cada uno lleva
 * `sedeId`. El catálogo de una sede solo fusiona y publica a sus usuarios.
 */
import { describe, expect, it } from 'vitest';
import {
    buildUserCatalogDoc,
    mergeUserCatalog,
    userBelongsToSede,
    usersOfSede,
} from '../src/utils/userCatalog.js';

const PIN_HASH = 'pbkdf2$fake-hash';

// Bodega: ids 1,2 · Cosméticos: ids 3,4 (ids únicos en toda la lista).
const localBothSedes = () => ([
    { id: 1, uid: 'uid-b-admin', nombre: 'Administrador', rol: 'ADMIN', pin: PIN_HASH, requirePin: true, sedeId: 'bodega' },
    { id: 2, uid: 'uid-b-cajero', nombre: 'Cajero', rol: 'CAJERO', pin: PIN_HASH, requirePin: true, sedeId: 'bodega' },
    { id: 3, uid: 'uid-c-admin', nombre: 'Administrador', rol: 'ADMIN', pin: PIN_HASH, requirePin: true, sedeId: 'cos' },
    { id: 4, uid: 'uid-c-cajero', nombre: 'Cajero', rol: 'CAJERO', pin: PIN_HASH, requirePin: true, sedeId: 'cos' },
]);

const bodegaDoc = (extra = {}) => ({
    v: 1,
    users: [
        { id: 1, uid: 'uid-b-admin', nombre: 'Administrador', rol: 'ADMIN', requirePin: true },
        { id: 2, uid: 'uid-b-cajero', nombre: 'Cajero', rol: 'CAJERO', requirePin: true },
    ],
    deleted: [],
    ...extra,
});

const cosDoc = () => ({
    v: 1,
    users: [
        { id: 3, uid: 'uid-c-admin', nombre: 'Administrador', rol: 'ADMIN', requirePin: true },
        { id: 4, uid: 'uid-c-cajero', nombre: 'Cajero', rol: 'CAJERO', requirePin: true },
    ],
    deleted: [],
});

describe('visibilidad por sede', () => {
    it('usersOfSede devuelve solo los usuarios de la sede pedida', () => {
        const out = usersOfSede(localBothSedes(), 'bodega');
        expect(out.map(u => u.id)).toEqual([1, 2]);
    });

    it('sin sede consultada devuelve todos (comportamiento previo)', () => {
        expect(usersOfSede(localBothSedes(), null)).toHaveLength(4);
    });

    it('usuarios legacy sin sedeId son visibles en cualquier sede si no hay sede dueña', () => {
        const legacy = [{ id: 9, nombre: 'Legacy', rol: 'CAJERO' }];
        expect(userBelongsToSede(legacy[0], 'bodega', null)).toBe(true);
        expect(userBelongsToSede(legacy[0], 'cos', null)).toBe(true);
    });

    it('usuarios legacy sin sedeId pertenecen a la sede dueña indicada', () => {
        const legacy = [{ id: 9, nombre: 'Legacy', rol: 'CAJERO' }];
        expect(usersOfSede(legacy, 'bodega', 'bodega')).toHaveLength(1);
        expect(usersOfSede(legacy, 'cos', 'bodega')).toHaveLength(0);
    });
});

describe('publicación del catálogo por sede', () => {
    it('buildUserCatalogDoc publica solo los usuarios de la sede', () => {
        const doc = buildUserCatalogDoc(localBothSedes(), [], 'bodega');
        expect(doc.users.map(u => u.id)).toEqual([1, 2]);
    });

    it('el doc nunca incluye PINs ni sedeId', () => {
        const doc = buildUserCatalogDoc(localBothSedes(), [], 'cos');
        const serialized = JSON.stringify(doc);
        expect(serialized).not.toContain('pbkdf2');
        expect(serialized).not.toContain('sedeId');
        expect(serialized).not.toContain('"pin"');
    });
});

describe('fusión del catálogo por sede', () => {
    it('fusionar Bodega no altera a los usuarios de Cosméticos', () => {
        const before = localBothSedes();
        const merged = mergeUserCatalog(before, bodegaDoc(), 'bodega');
        const cos = merged.filter(u => u.sedeId === 'cos');
        expect(cos).toHaveLength(2);
        expect(cos.map(u => u.id).sort()).toEqual([3, 4]);
        expect(cos.every(u => u.pin === PIN_HASH)).toBe(true);
    });

    it('no duplica usuarios al alternar entre sedes', () => {
        let list = localBothSedes();
        list = mergeUserCatalog(list, bodegaDoc(), 'bodega');
        list = mergeUserCatalog(list, cosDoc(), 'cos');
        list = mergeUserCatalog(list, bodegaDoc(), 'bodega');
        list = mergeUserCatalog(list, cosDoc(), 'cos');
        expect(list).toHaveLength(4);
        expect(new Set(list.map(u => u.id)).size).toBe(4);
    });

    it('un uid de otra sede no se adopta en esta sede', () => {
        // Bodega recibe un doc que trae el uid de Cosméticos: no debe reasociarse.
        const docConUidAjeno = {
            v: 1,
            users: [{ id: 1, uid: 'uid-c-admin', nombre: 'Administrador', rol: 'ADMIN', requirePin: true }],
            deleted: [],
        };
        const merged = mergeUserCatalog(localBothSedes(), docConUidAjeno, 'bodega');
        const cosAdmin = merged.find(u => u.id === 3);
        expect(cosAdmin.uid).toBe('uid-c-admin');
        expect(merged.filter(u => u.sedeId === 'bodega')).toHaveLength(2);
    });

    it('un usuario nuevo remoto queda etiquetado con la sede del doc', () => {
        const doc = {
            v: 1,
            users: [
                { id: 1, uid: 'uid-b-admin', nombre: 'Administrador', rol: 'ADMIN', requirePin: true },
                { id: 2, uid: 'uid-b-cajero', nombre: 'Cajero', rol: 'CAJERO', requirePin: true },
                { id: 7, uid: 'uid-b-nuevo', nombre: 'Nuevo', rol: 'CAJERO', requirePin: true },
            ],
            deleted: [],
        };
        const merged = mergeUserCatalog(localBothSedes(), doc, 'bodega');
        const nuevo = merged.find(u => u.uid === 'uid-b-nuevo');
        expect(nuevo.sedeId).toBe('bodega');
        expect(nuevo.pinPendiente).toBe(true);
    });

    it('un tombstone de Bodega solo borra usuarios de Bodega', () => {
        const doc = bodegaDoc({ deleted: [{ id: 2, deletedAt: Date.now() }] });
        const merged = mergeUserCatalog(localBothSedes(), doc, 'bodega');
        expect(merged.find(u => u.id === 2)).toBeUndefined();
        expect(merged.find(u => u.id === 4)).toBeDefined();
    });

    it('sin sedeId se conserva el comportamiento previo (fusión sobre toda la lista)', () => {
        const merged = mergeUserCatalog(localBothSedes(), bodegaDoc());
        // Sin acotar, Cosméticos no es parte del doc y se conserva como creación local.
        expect(merged).toHaveLength(4);
    });
});
