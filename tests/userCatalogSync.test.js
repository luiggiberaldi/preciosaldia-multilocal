/**
 * userCatalogSync.test.js — Catálogo de usuarios sincronizado sin PINs (SEC-002).
 *
 * Cubre: sanitizado, construcción del doc, merge con preservación de PINs,
 * tombstones, colisiones de id, allowlist y validadores.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
    sanitizeUserCatalog,
    buildUserCatalogDoc,
    isValidUserCatalogDoc,
    mergeUserCatalog,
    readUserTombstones,
    writeUserTombstones,
    addUserTombstone,
    pruneUserTombstones,
    USER_TOMBSTONE_TTL_MS,
    USER_CATALOG_DOC_VERSION,
} from '../src/utils/userCatalog.js';
import {
    isSupervisorSyncKey,
    validateSupervisorSyncDocument,
} from '../src/services/supervisorContracts.js';

const PIN_HASH = 'pbkdf2$fake-hash';

const localUsers = () => ([
    { id: 1, uid: 'uid-ana', nombre: 'Ana', rol: 'ADMIN', pin: PIN_HASH, requirePin: true },
    { id: 2, uid: 'uid-beto', nombre: 'Beto', rol: 'CAJERO', pin: PIN_HASH, requirePin: true },
]);

beforeEach(() => {
    localStorage.clear();
});

describe('sanitizeUserCatalog (SEC-002)', () => {
    it('elimina pin y plainPin pero conserva el resto', () => {
        const out = sanitizeUserCatalog([
            { id: 1, nombre: 'Ana', rol: 'ADMIN', pin: PIN_HASH, plainPin: '1234', requirePin: true },
        ]);
        expect(out).toEqual([{ id: 1, nombre: 'Ana', rol: 'ADMIN', requirePin: true }]);
        expect('pin' in out[0]).toBe(false);
        expect('plainPin' in out[0]).toBe(false);
    });

    it('tolera entradas no-array', () => {
        expect(sanitizeUserCatalog(null)).toEqual([]);
        expect(sanitizeUserCatalog(undefined)).toEqual([]);
    });
});

describe('buildUserCatalogDoc', () => {
    it('construye el doc con forma válida y sin rastro de PINs', () => {
        const doc = buildUserCatalogDoc(localUsers(), []);
        expect(doc.v).toBe(USER_CATALOG_DOC_VERSION);
        expect(doc.users).toHaveLength(2);
        expect(doc.users[0]).toEqual({ id: 1, uid: 'uid-ana', nombre: 'Ana', rol: 'ADMIN', requirePin: true });
        expect(doc.deleted).toEqual([]);
        // Ni serializado debe aparecer un PIN.
        expect(JSON.stringify(doc)).not.toContain('pbkdf2');
        expect(JSON.stringify(doc)).not.toContain('"pin"');
    });

    it('incluye tombstones vigentes y poda los vencidos', () => {
        const now = Date.now();
        const doc = buildUserCatalogDoc([], [
            { id: 9, deletedAt: now - 1000 },
            { id: 10, deletedAt: now - USER_TOMBSTONE_TTL_MS - 1000 },
        ]);
        expect(doc.deleted.map(d => d.id)).toEqual([9]);
    });
});

describe('isValidUserCatalogDoc', () => {
    const valid = () => ({ v: 1, users: [{ id: 1, nombre: 'Ana', rol: 'ADMIN', requirePin: true }], deleted: [] });

    it('acepta un doc bien formado', () => {
        expect(isValidUserCatalogDoc(valid())).toBe(true);
    });

    it('rechaza version, users o deleted malformados', () => {
        expect(isValidUserCatalogDoc({ ...valid(), v: 2 })).toBe(false);
        expect(isValidUserCatalogDoc({ ...valid(), users: 'x' })).toBe(false);
        expect(isValidUserCatalogDoc({ ...valid(), deleted: {} })).toBe(false);
        expect(isValidUserCatalogDoc(null)).toBe(false);
    });

    it('SEC-002: rechaza docs que incluyan pin o plainPin', () => {
        const withPin = { ...valid(), users: [{ id: 1, nombre: 'Ana', rol: 'ADMIN', pin: 'hash' }] };
        expect(isValidUserCatalogDoc(withPin)).toBe(false);
        const withPlain = { ...valid(), users: [{ id: 1, nombre: 'Ana', rol: 'ADMIN', plainPin: '1234' }] };
        expect(isValidUserCatalogDoc(withPlain)).toBe(false);
    });
});

describe('mergeUserCatalog', () => {
    it('preserva el PIN local al renombrar (match por uid)', () => {
        const doc = { v: 1, users: [{ id: 1, uid: 'uid-ana', nombre: 'Ana María', rol: 'CAJERO', requirePin: true }], deleted: [] };
        const merged = mergeUserCatalog(localUsers(), doc);
        const ana = merged.find(u => u.uid === 'uid-ana');
        expect(ana.id).toBe(1);
        expect(ana.nombre).toBe('Ana María');
        expect(ana.rol).toBe('CAJERO');
        expect(ana.pin).toBe(PIN_HASH); // el PIN local sobrevive al renombrado
        // Beto no venía en el remoto y no está borrado: se conserva.
        expect(merged.find(u => u.uid === 'uid-beto')?.pin).toBe(PIN_HASH);
    });

    it('agrega usuarios remotos nuevos como pinPendiente sin PIN', () => {
        const doc = { v: 1, users: [{ id: 5, uid: 'uid-carla', nombre: 'Carla', rol: 'CAJERO', requirePin: true }], deleted: [] };
        const merged = mergeUserCatalog(localUsers(), doc);
        const carla = merged.find(u => u.uid === 'uid-carla');
        expect(carla).toMatchObject({ id: 5, nombre: 'Carla', rol: 'CAJERO', pin: null, pinPendiente: true });
    });

    it('aplica tombstones: el borrado remoto elimina al usuario local', () => {
        const doc = { v: 1, users: [{ id: 1, nombre: 'Ana', rol: 'ADMIN', requirePin: true }], deleted: [{ id: 2, deletedAt: Date.now() }] };
        const merged = mergeUserCatalog(localUsers(), doc);
        expect(merged.find(u => u.id === 2)).toBeUndefined();
        expect(merged.find(u => u.id === 1)).toBeDefined();
    });

    it('un tombstone gana aunque el usuario siga en users (no resucita)', () => {
        const doc = {
            v: 1,
            users: [{ id: 2, nombre: 'Beto', rol: 'CAJERO', requirePin: true }],
            deleted: [{ id: 2, deletedAt: Date.now() }],
        };
        const merged = mergeUserCatalog(localUsers(), doc);
        expect(merged.find(u => u.id === 2)).toBeUndefined();
    });

    it('reasigna id ante colisión real (mismo id numérico, distinto uid)', () => {
        const doc = { v: 1, users: [{ id: 1, uid: 'uid-zoe', nombre: 'Zoe', rol: 'CAJERO', requirePin: true }], deleted: [] };
        const merged = mergeUserCatalog(localUsers(), doc);
        // Ana (id 1, con PIN) se conserva intacta…
        const ana = merged.find(u => u.uid === 'uid-ana');
        expect(ana.id).toBe(1);
        expect(ana.pin).toBe(PIN_HASH);
        // …y Zoe entra con un id nuevo libre, pendiente de PIN.
        const zoe = merged.find(u => u.uid === 'uid-zoe');
        expect(zoe.id).not.toBe(1);
        expect(zoe.pin).toBeNull();
        expect(zoe.pinPendiente).toBe(true);
        // Sin ids duplicados.
        const ids = merged.map(u => u.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('legacy sin uid: mismo id + mismo nombre fusiona; distinto nombre colisiona', () => {
        const legacyLocal = [
            { id: 1, nombre: 'Ana', rol: 'ADMIN', pin: PIN_HASH, requirePin: true },
        ];
        // Mismo nombre → mismo usuario.
        const same = mergeUserCatalog(legacyLocal, { v: 1, users: [{ id: 1, nombre: 'Ana', rol: 'CAJERO', requirePin: true }], deleted: [] });
        expect(same.find(u => u.id === 1)).toMatchObject({ nombre: 'Ana', rol: 'CAJERO', pin: PIN_HASH });
        // Distinto nombre → colisión: el local se conserva y el remoto toma id nuevo.
        const clash = mergeUserCatalog(legacyLocal, { v: 1, users: [{ id: 1, nombre: 'Zoe', rol: 'CAJERO', requirePin: true }], deleted: [] });
        expect(clash.find(u => u.id === 1)).toMatchObject({ nombre: 'Ana', pin: PIN_HASH });
        const zoe = clash.find(u => u.nombre === 'Zoe');
        expect(zoe.id).not.toBe(1);
        expect(zoe.pinPendiente).toBe(true);
    });

    it('legacy sin uid con mismo nombre+rol que un local con uid: no duplica (adopta el local)', () => {
        const localWithUid = [
            { id: 1, uid: 'uid-admin', nombre: 'Administrador', rol: 'ADMIN', pin: PIN_HASH, requirePin: true },
            { id: 2, uid: 'uid-cajero', nombre: 'Cajero', rol: 'CAJERO', pin: PIN_HASH, requirePin: true },
        ];
        const legacyRemote = { v: 1, users: [
            { id: 1, nombre: 'Administrador', rol: 'ADMIN', requirePin: true },
            { id: 2, nombre: 'Cajero', rol: 'CAJERO', requirePin: true },
        ], deleted: [] };
        const merged = mergeUserCatalog(localWithUid, legacyRemote);
        expect(merged).toHaveLength(2);
        expect(merged.find(u => u.uid === 'uid-admin')).toMatchObject({ id: 1, pin: PIN_HASH });
        expect(merged.find(u => u.uid === 'uid-cajero')).toMatchObject({ id: 2, pin: PIN_HASH });
        // Un segundo merge con el resultado tampoco agrega copias.
        expect(mergeUserCatalog(merged, legacyRemote)).toHaveLength(2);
    });

    it('tolera doc vacío o ausente', () => {
        expect(mergeUserCatalog(localUsers(), null)).toHaveLength(2);
        expect(mergeUserCatalog(localUsers(), {})).toHaveLength(2);
        expect(mergeUserCatalog(null, { v: 1, users: [], deleted: [] })).toEqual([]);
    });
});

describe('tombstones en localStorage', () => {
    it('add/read/write son idempotentes y por negocio', () => {
        addUserTombstone(7);
        addUserTombstone(7);
        expect(readUserTombstones()).toHaveLength(1);
        expect(readUserTombstones()[0].id).toBe(7);
        writeUserTombstones([]);
        expect(readUserTombstones()).toEqual([]);
    });

    it('pruneUserTombstones elimina los vencidos', () => {
        const now = Date.now();
        const pruned = pruneUserTombstones([
            { id: 1, deletedAt: now - 1000 },
            { id: 2, deletedAt: now - USER_TOMBSTONE_TTL_MS - 1 },
        ], now);
        expect(pruned.map(t => t.id)).toEqual([1]);
    });
});

describe('allowlist del supervisor', () => {
    it('bodega_users_catalog_v1 está allowlisted', () => {
        expect(isSupervisorSyncKey('bodega_users_catalog_v1')).toBe(true);
    });

    it('validateSupervisorSyncDocument acepta el doc válido', () => {
        const doc = { v: 1, users: [{ id: 1, nombre: 'Ana', rol: 'ADMIN', requirePin: true }], deleted: [] };
        expect(validateSupervisorSyncDocument('bodega_users_catalog_v1', doc)).toEqual({ valid: true, error: null });
    });

    it('validateSupervisorSyncDocument rechaza doc con PIN (SEC-002)', () => {
        const doc = { v: 1, users: [{ id: 1, nombre: 'Ana', rol: 'ADMIN', pin: 'hash-secreto' }], deleted: [] };
        const res = validateSupervisorSyncDocument('bodega_users_catalog_v1', doc);
        expect(res.valid).toBe(false);
    });

    it('validateSupervisorSyncDocument rechaza doc malformado', () => {
        const res = validateSupervisorSyncDocument('bodega_users_catalog_v1', { v: 1, users: 'no-array' });
        expect(res.valid).toBe(false);
    });
});
