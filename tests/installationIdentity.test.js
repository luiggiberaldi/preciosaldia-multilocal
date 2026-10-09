import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getOrCreateInstallationId, isInstallationId, verifyInstallationIdentity,
} from '../src/security/installationIdentity';

const ID_KEY = 'pda_device_id';
const ANCHOR_KEY = 'pda_fp_anchor_v1';
const UUID = '12345678-1234-4234-8234-123456789abc';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('F1 identidad persistente de instalación', () => {
    it('perfiles limpios con el mismo navegador reciben IDs distintos', async () => {
        const first = await getOrCreateInstallationId();
        localStorage.clear();
        const second = await getOrCreateInstallationId();
        expect(isInstallationId(first)).toBe(true);
        expect(isInstallationId(second)).toBe(true);
        expect(first).not.toBe(second);
    });

    it('recarga, reinicio del módulo y cambio de sede conservan el ID', async () => {
        const first = await getOrCreateInstallationId();
        localStorage.setItem('pda_active_negocio', 'neg-1');
        expect(await getOrCreateInstallationId()).toBe(first);
        localStorage.setItem('pda_active_negocio', 'neg-fac22061');
        vi.resetModules();
        const reloaded = await import('../src/security/installationIdentity');
        expect(await reloaded.getOrCreateInstallationId()).toBe(first);
        expect(reloaded.verifyInstallationIdentity(first)).toBe(true);
    });

    it('arranques concurrentes acuñan una sola identidad', async () => {
        const random = vi.spyOn(crypto, 'randomUUID');
        const ids = await Promise.all(Array.from({ length: 12 }, () => getOrCreateInstallationId()));
        expect(new Set(ids).size).toBe(1);
        expect(random).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(ID_KEY)).toBe(ids[0]);
    });

    it.each(['PDA-ABCDEF12', 'PDA-V2-' + 'B'.repeat(32)])('conserva legacy %s sin ancla, sin locks y sin entropía', async (id) => {
        localStorage.setItem(ID_KEY, id);
        vi.stubGlobal('crypto', undefined);
        vi.stubGlobal('navigator', {});
        expect(await getOrCreateInstallationId()).toBe(id);
        expect(verifyInstallationIdentity(id)).toBe(true);
        expect(localStorage.getItem(ANCHOR_KEY)).toBeNull();
    });

    it('conserva legacy anclado aunque cambie el fingerprint observado', async () => {
        const id = 'PDA-V2-' + 'C'.repeat(32);
        localStorage.setItem(ID_KEY, id);
        const anchor = JSON.stringify({ anchor: id, lastSeen: 'PDA-V2-' + 'D'.repeat(32) });
        localStorage.setItem(ANCHOR_KEY, anchor);
        expect(await getOrCreateInstallationId()).toBe(id);
        expect(localStorage.getItem(ANCHOR_KEY)).toBe(anchor);
    });

    it('perfil clonado conserva el ID: no rota ni presume detectar clones sin servidor', async () => {
        const id = await getOrCreateInstallationId();
        const clone = new Map([[ID_KEY, localStorage.getItem(ID_KEY)], [ANCHOR_KEY, localStorage.getItem(ANCHOR_KEY)]]);
        vi.stubGlobal('localStorage', { getItem: key => clone.get(key) ?? null, setItem: vi.fn() });
        expect(await getOrCreateInstallationId()).toBe(id);
        expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('usa getRandomValues cuando randomUUID no existe y fija versión/variante UUID', async () => {
        const random = vi.fn(bytes => { bytes.fill(255); return bytes; });
        vi.stubGlobal('crypto', { getRandomValues: random });
        expect(await getOrCreateInstallationId()).toBe('PDA-I-ffffffff-ffff-4fff-bfff-ffffffffffff');
        expect(random).toHaveBeenCalledTimes(1);
    });

    it('sin entropía segura falla, nunca usa Math.random ni fingerprint', async () => {
        vi.stubGlobal('crypto', {});
        const random = vi.spyOn(Math, 'random');
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_ENTROPY_UNAVAILABLE' });
        expect(localStorage.getItem(ID_KEY)).toBeNull();
        expect(random).not.toHaveBeenCalled();
    });

    it('sin Web Locks no acuña un ID nuevo', async () => {
        vi.stubGlobal('navigator', {});
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_LOCK_UNAVAILABLE' });
        expect(localStorage.getItem(ID_KEY)).toBeNull();
    });

    it('storage ausente/bloqueado no devuelve ID efímero', async () => {
        vi.stubGlobal('localStorage', undefined);
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_STORAGE_UNAVAILABLE' });
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_STORAGE_UNAVAILABLE' });
    });

    it('storage lleno falla sin borrar el origen', async () => {
        const remove = vi.fn();
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: remove });
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_STORAGE_UNAVAILABLE' });
        expect(remove).not.toHaveBeenCalled();
    });

    it('escritura no durable falla en readback', async () => {
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_STORAGE_UNAVAILABLE' });
    });

    it('un fallo al persistir ancla conserva el ID escrito y bloquea verificación', async () => {
        const state = new Map();
        vi.stubGlobal('crypto', { randomUUID: () => UUID });
        vi.stubGlobal('localStorage', {
            getItem: key => state.get(key) ?? null,
            setItem: (key, value) => { if (key === ANCHOR_KEY) throw new Error('quota'); state.set(key, value); },
        });
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_STORAGE_UNAVAILABLE' });
        expect(state.get(ID_KEY)).toBe('PDA-I-' + UUID);
        expect(verifyInstallationIdentity(state.get(ID_KEY))).toBe(false);
    });

    it.each(['', 'PDA-DEAD', 'not-an-id'])('ID inválido %s queda intacto para reparación guiada', async id => {
        localStorage.setItem(ID_KEY, id);
        localStorage.setItem('bodega_sales_v1', 'preserve');
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_ID_INVALID' });
        expect(localStorage.getItem(ID_KEY)).toBe(id);
        expect(localStorage.getItem('bodega_sales_v1')).toBe('preserve');
    });

    it('ancla contradictoria bloquea sin sustituir ID/token/datos', async () => {
        const id = 'PDA-V2-' + 'A'.repeat(32);
        localStorage.setItem(ID_KEY, id);
        localStorage.setItem(ANCHOR_KEY, JSON.stringify({ anchor: 'PDA-V2-' + 'B'.repeat(32) }));
        localStorage.setItem('pda_premium_token', 'preserve-token');
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
        expect(verifyInstallationIdentity(id)).toBe(false);
        expect(localStorage.getItem(ID_KEY)).toBe(id);
        expect(localStorage.getItem('pda_premium_token')).toBe('preserve-token');
    });

    it('ancla sin ID evita crear identidad nueva sobre una instalación existente', async () => {
        localStorage.setItem(ANCHOR_KEY, JSON.stringify({ anchor: 'PDA-V2-' + 'A'.repeat(32) }));
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
        expect(localStorage.getItem(ID_KEY)).toBeNull();
    });

    it('ancla corrupta se conserva y bloquea', async () => {
        localStorage.setItem(ID_KEY, 'PDA-V2-' + 'A'.repeat(32));
        localStorage.setItem(ANCHOR_KEY, '{invalid');
        await expect(getOrCreateInstallationId()).rejects.toMatchObject({ code: 'IDENTITY_ANCHOR_INVALID' });
        expect(localStorage.getItem(ANCHOR_KEY)).toBe('{invalid');
    });

    it('cambio del ID durante la sesión invalida verificación sin mutaciones', async () => {
        const id = await getOrCreateInstallationId();
        localStorage.setItem(ID_KEY, 'PDA-V2-' + 'A'.repeat(32));
        expect(verifyInstallationIdentity(id)).toBe(false);
        expect(localStorage.getItem(ID_KEY)).not.toBe(id);
    });
});
