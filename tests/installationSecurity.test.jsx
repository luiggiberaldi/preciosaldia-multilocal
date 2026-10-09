import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, licenseCheck } = vi.hoisted(() => ({ rpc: vi.fn(), licenseCheck: vi.fn() }));
vi.mock('../src/core/supabaseClient', () => ({ supabase: { rpc } }));
vi.mock('../src/security/tokenCrypto', () => ({ verifyLicenseToken: licenseCheck }));
vi.mock('../src/hooks/useLicenseMonitoring', () => ({ useLicenseMonitoring: vi.fn() }));
vi.mock('../src/services/cloudAccount', () => ({ isAccountLinkedLocally: () => false }));
vi.mock('../src/config/supabaseCloud.js', () => ({ getCustomerProject: () => null }));
vi.mock('../src/utils/deviceBackend', () => ({
    isDeviceBackendDown: () => true, markDeviceBackendDown: vi.fn(), markDeviceBackendUp: vi.fn(),
    isBackendMissingError: () => false, noteDeviceBackendSkipped: vi.fn(),
}));
import { SecurityProvider, useSecurity } from '../src/hooks/useSecurity';

let container;
let root;
let child;

function Child() {
    const security = useSecurity();
    child(security.deviceId);
    return React.createElement('p', { 'data-testid': 'device' }, security.deviceId);
}

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    child = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function renderProvider() {
    await act(async () => {
        root.render(React.createElement(React.StrictMode, null,
            React.createElement(SecurityProvider, null, React.createElement(Child))));
        await new Promise(resolve => setTimeout(resolve, 20));
    });
}

describe('F1 integración del arranque', () => {
    it('StrictMode crea un único ID persistido antes de montar los flujos cloud', async () => {
        await renderProvider();
        const id = localStorage.getItem('pda_device_id');
        expect(id).toMatch(/^PDA-I-/);
        expect(container.querySelector('[data-testid="device"]').textContent).toBe(id);
        expect(child.mock.calls.every(([seen]) => seen === id)).toBe(true);
    });

    it('legacy conserva identidad al arrancar sin recalcular fingerprint', async () => {
        const id = 'PDA-V2-' + 'A'.repeat(32);
        localStorage.setItem('pda_device_id', id);
        await renderProvider();
        expect(container.querySelector('[data-testid="device"]').textContent).toBe(id);
        expect(localStorage.getItem('pda_device_id')).toBe(id);
    });

    it('conflicto no monta cloud/app y conserva licencia/datos/ID', async () => {
        const id = 'PDA-V2-' + 'A'.repeat(32);
        localStorage.setItem('pda_device_id', id);
        localStorage.setItem('pda_fp_anchor_v1', JSON.stringify({ anchor: 'PDA-V2-' + 'B'.repeat(32) }));
        localStorage.setItem('pda_premium_token', 'preserve-license');
        localStorage.setItem('bodega_sales_v1', 'preserve-sales');
        localStorage.setItem('pda_pro_activated', 'true');
        await renderProvider();
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        expect(child).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
        expect(licenseCheck).not.toHaveBeenCalled();
        expect(localStorage.getItem('pda_device_id')).toBe(id);
        expect(localStorage.getItem('pda_premium_token')).toBe('preserve-license');
        expect(localStorage.getItem('bodega_sales_v1')).toBe('preserve-sales');
    });

    it('falta de entropía muestra error sin registrar identidad sintética', async () => {
        vi.stubGlobal('crypto', {});
        await renderProvider();
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        expect(child).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
        expect(localStorage.getItem('pda_device_id')).toBeNull();
    });

    it('identidad alterada en sesión retira los flujos cloud sin rotar ni borrar tokens', async () => {
        localStorage.setItem('pda_pro_activated', 'true');
        await renderProvider();
        localStorage.setItem('pda_premium_token', 'preserve-license');
        const foreign = 'PDA-V2-' + 'F'.repeat(32);
        localStorage.setItem('pda_device_id', foreign);
        // El intervalo real se instaló antes de activar fake timers: remonta
        // preservando el ID/ancla original para probar el intervalo simulado.
        const own = JSON.parse(localStorage.getItem('pda_fp_anchor_v1')).anchor;
        localStorage.setItem('pda_device_id', own);
        await act(async () => root.unmount());
        root = createRoot(container);
        vi.useFakeTimers();
        await act(async () => {
            root.render(React.createElement(SecurityProvider, null, React.createElement(Child)));
        });
        localStorage.setItem('pda_device_id', foreign);
        await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000); });
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="device"]')).toBeNull();
        expect(localStorage.getItem('pda_device_id')).toBe(foreign);
        expect(localStorage.getItem('pda_premium_token')).toBe('preserve-license');
    });
});
