import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    isDeviceBackendDown,
    markDeviceBackendDown,
    markDeviceBackendUp,
    isBackendMissingError,
    noteDeviceBackendSkipped,
    resetDeviceBackendCache,
    DEVICE_BACKEND_RETRY_MS,
} from '../src/utils/deviceBackend.js';

const LS_KEY = 'pda_device_backend_down_v1';

beforeEach(() => {
    localStorage.clear();
    resetDeviceBackendCache();
    vi.restoreAllMocks();
});

describe('isBackendMissingError', () => {
    it('detecta códigos PGRST2xx (objeto no existe en schema cache)', () => {
        expect(isBackendMissingError({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
        expect(isBackendMissingError({ code: 'PGRST205', message: 'table not found' })).toBe(true);
    });
    it('detecta status 404 numérico', () => {
        expect(isBackendMissingError({ status: 404, message: 'Not Found' })).toBe(true);
    });
    it('detecta mensajes de no-existencia', () => {
        expect(isBackendMissingError({ message: 'relation "licenses" does not exist' })).toBe(true);
        expect(isBackendMissingError({ message: 'Could not find the table backup_requests' })).toBe(true);
    });
    it('NO marca errores de red, auth ni servidor', () => {
        expect(isBackendMissingError({ message: 'Failed to fetch' })).toBe(false);
        expect(isBackendMissingError({ code: 'PGRST301', message: 'JWT expired' })).toBe(false);
        expect(isBackendMissingError({ status: 401, message: 'Unauthorized' })).toBe(false);
        expect(isBackendMissingError({ status: 500, message: 'Internal error' })).toBe(false);
    });
    it('valores nulos/no-objeto → false', () => {
        expect(isBackendMissingError(null)).toBe(false);
        expect(isBackendMissingError(undefined)).toBe(false);
        expect(isBackendMissingError('404')).toBe(false);
    });
});

describe('estado caído (memoria + localStorage)', () => {
    it('empieza desconocido → false', () => {
        expect(isDeviceBackendDown()).toBe(false);
    });
    it('markDeviceBackendDown persiste en localStorage', () => {
        markDeviceBackendDown();
        expect(isDeviceBackendDown()).toBe(true);
        expect(localStorage.getItem(LS_KEY)).toBeTruthy();
        // Sobrevive "reinicio" (caché en memoria limpio, LS intacto)
        resetDeviceBackendCache();
        expect(isDeviceBackendDown()).toBe(true);
    });
    it('markDeviceBackendUp limpia memoria y localStorage', () => {
        markDeviceBackendDown();
        markDeviceBackendUp();
        expect(isDeviceBackendDown()).toBe(false);
        expect(localStorage.getItem(LS_KEY)).toBeNull();
    });
    it('el marcador expira tras el TTL (se vuelve a intentar)', () => {
        localStorage.setItem(LS_KEY, String(Date.now() - DEVICE_BACKEND_RETRY_MS - 1000));
        expect(isDeviceBackendDown()).toBe(false);
        // marcador vencido se elimina
        expect(localStorage.getItem(LS_KEY)).toBeNull();
    });
    it('marcador con valor inválido se ignora', () => {
        localStorage.setItem(LS_KEY, 'basura');
        expect(isDeviceBackendDown()).toBe(false);
    });
});

describe('noteDeviceBackendSkipped', () => {
    it('loguea una sola vez por sesión', () => {
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        noteDeviceBackendSkipped('test');
        noteDeviceBackendSkipped('test');
        noteDeviceBackendSkipped('otro');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toContain('Backend de dispositivos no configurado');
    });
});
