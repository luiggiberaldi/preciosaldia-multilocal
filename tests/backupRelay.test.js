/**
 * tests/backupRelay.test.js — Relay de respaldos vía Estación Maestra (RLS-RELAY).
 *
 * Cubre:
 *  - relayUploadBackup / relayFetchBackup: feliz, error HTTP, red caída.
 *  - isRlsBlockedError: 42501 y variantes de mensaje; no confunde 401/403.
 *  - describeCloudError(42501).hint menciona el relay como acción.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { relayUploadBackup, relayFetchBackup, getEstacionApiUrl } from '../src/utils/backupRelay';
import { describeCloudError, isRlsBlockedError } from '../src/utils/cloudError';

const BASE = 'https://estacion.example';

// Fijar la URL base ANTES de importar el cliente (env se lee por llamada,
// pero el valor por defecto apunta a producción).
beforeAll(() => {
    import.meta.env.VITE_ESTACION_API_URL = BASE;
});

describe('getEstacionApiUrl', () => {
    it('usa el valor configurado en VITE_ESTACION_API_URL', () => {
        expect(getEstacionApiUrl()).toBe(BASE);
    });
});

describe('getEstacionApiUrl — guardarraíl de entorno (E2E-AUDIT H-infra)', () => {
    const ENV = import.meta.env;
    const URL_ENV_KEY = 'VITE_ESTACION_API_URL';

    afterEach(() => {
        // Los demás tests de este archivo exigen el BASE configurado.
        ENV[URL_ENV_KEY] = BASE;
    });

    it('SIN env en un build de producción apunta a producción', () => {
        delete ENV[URL_ENV_KEY];
        ENV.PROD = true;
        expect(getEstacionApiUrl()).toBe('https://estacion-2026.vercel.app');
    });

    it('SIN env fuera de producción devuelve "" y el relay se salta (nunca toca producción)', () => {
        delete ENV[URL_ENV_KEY];
        ENV.PROD = false;
        expect(getEstacionApiUrl()).toBe('');
    });

    it('el flag PROD no puede falsear un env configurado', () => {
        ENV[URL_ENV_KEY] = 'https://staging.example';
        ENV.PROD = false;
        expect(getEstacionApiUrl()).toBe('https://staging.example');
    });

    it('relayUploadBackup con URL vacía NO llama a fetch', async () => {
        delete ENV[URL_ENV_KEY];
        ENV.PROD = false;
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        try {
            const res = await relayUploadBackup('PDA-TEST', { hola: 1 });
            expect(res.skipped).toBe(true);
            expect(res.ok).toBe(false);
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('relayUploadBackup', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('feliz: POST con deviceId + backup_data y ok', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, deviceId: 'PDA-TEST' }),
        });
        const res = await relayUploadBackup('PDA-TEST', { compressed: true, data: 'abc' });
        expect(res.ok).toBe(true);
        expect(res.relayed).toBe(true);
        expect(fetch).toHaveBeenCalledWith(
            `${BASE}/api/backup/relay`,
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'x-backup-secret': expect.any(String) }),
            })
        );
        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.deviceId).toBe('PDA-TEST');
        expect(body.backup_data.compressed).toBe(true);
    });

    it('error HTTP del relay se propaga sin lanzar', async () => {
        fetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'boom interno' }),
        });
        const res = await relayUploadBackup('PDA-TEST', {});
        expect(res.ok).toBe(false);
        expect(res.error).toBe('boom interno');
    });

    it('red caída (fetch lanza) devuelve ok=false con el error', async () => {
        fetch.mockRejectedValue(new TypeError('Failed to fetch'));
        const res = await relayUploadBackup('PDA-TEST', {});
        expect(res.ok).toBe(false);
        expect(res.error).toBeInstanceOf(TypeError);
    });
});

describe('relayFetchBackup', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('feliz: devuelve backup_data y updated_at', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, deviceId: 'PDA-TEST', backup_data: { compressed: true }, updated_at: '2026-09-09T00:00:00Z' }),
        });
        const res = await relayFetchBackup('PDA-TEST');
        expect(res.ok).toBe(true);
        expect(res.backupData).toEqual({ compressed: true });
        expect(res.updatedAt).toBe('2026-09-09T00:00:00Z');
        expect(fetch).toHaveBeenCalledWith(
            `${BASE}/api/backup/relay?deviceId=PDA-TEST`,
            expect.objectContaining({ headers: expect.objectContaining({ 'x-backup-secret': expect.any(String) }) })
        );
    });

    it('404 lógico del relay → backupData null (nube vacía)', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, deviceId: 'PDA-TEST', backup_data: null, updated_at: null }),
        });
        const res = await relayFetchBackup('PDA-TEST');
        expect(res.ok).toBe(true);
        expect(res.backupData).toBeNull();
    });

    it('red caída devuelve ok=false sin lanzar', async () => {
        fetch.mockRejectedValue(new TypeError('Failed to fetch'));
        const res = await relayFetchBackup('PDA-URL');
        expect(res.ok).toBe(false);
        expect(res.backupData).toBeNull();
    });
});

describe('isRlsBlockedError', () => {
    it('detecta 42501 por code', () => {
        expect(isRlsBlockedError({ code: '42501', message: 'x' })).toBe(true);
    });

    it('detecta RLS por mensaje sin code', () => {
        expect(isRlsBlockedError(new Error('violates row-level security policy'))).toBe(true);
    });

    it('no confunde 401/403 (credenciales) con RLS', () => {
        expect(isRlsBlockedError({ status: 401, message: 'JWT expired' })).toBe(false);
        expect(isRlsBlockedError({ status: 403, message: 'Forbidden' })).toBe(false);
    });

    it('null/string no relacionadas devuelven false', () => {
        expect(isRlsBlockedError(null)).toBe(false);
        expect(isRlsBlockedError('otro error')).toBe(false);
    });
});

describe('describeCloudError(42501) menciona acción de relay/export', () => {
    it('el hint orienta al usuario cuando RLS bloquea', () => {
        const info = describeCloudError({ code: '42501', message: 'row-level security' });
        expect(info.hint).toMatch(/Exportar Backup|relay/i);
        expect(info.technical).toContain('42501');
    });
});
