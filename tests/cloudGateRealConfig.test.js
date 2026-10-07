// tests/cloudGateRealConfig.test.js — Módulo REAL de supabaseCloud.
//
// F9: valida el formato de persistencia que el CloudGate usa en producción
// (localStorage 'pda_customer_project'), que el cliente real se construye
// sin red, y que clearCustomerProject deja el proxy sin resolver.
// Sin mocks: importa el módulo tal cual lo carga la app.
import { describe, it, expect, beforeEach } from 'vitest';
import {
    hasCustomerProject,
    getCustomerProject,
    setCustomerProject,
    clearCustomerProject,
    ensureCustomerClient,
    supabaseCloud,
} from '../src/config/supabaseCloud';

beforeEach(() => {
    localStorage.clear();
});

describe('F9 — persistencia real del proyecto (módulo sin mock)', () => {
    it('set guarda en localStorage, ensureCustomerClient no toca la red', () => {
        expect(hasCustomerProject()).toBe(false);

        setCustomerProject({ url: 'https://x.supabase.co', key: 'k', code: 'LIC-1' });

        expect(hasCustomerProject()).toBe(true);
        expect(getCustomerProject()).toEqual({
            url: 'https://x.supabase.co',
            key: 'k',
            code: 'LIC-1',
            maxDevices: 6,
            revokedDeviceIds: [],
        });
        expect(JSON.parse(localStorage.getItem('pda_customer_project')).code).toBe('LIC-1');
        // Construir el cliente no hace handshake de red.
        expect(ensureCustomerClient()).toBeTruthy();
    });

    it('"usar otro código": clearCustomerProject deja el proxy sin resolver', async () => {
        setCustomerProject({ url: 'https://x.supabase.co', key: 'k', code: 'LIC-1' });
        await clearCustomerProject();

        expect(hasCustomerProject()).toBe(false);
        expect(getCustomerProject()).toBeNull();
        expect(localStorage.getItem('pda_customer_project')).toBeNull();
        expect(() => supabaseCloud.from('t')).toThrow(/sin resolver/i);
    });
});
