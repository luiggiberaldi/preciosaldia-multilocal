import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPin, verifyPin } from '../src/utils/crypto';
import {
    DUENO_PIN_KEY,
    isMasterPinSetup,
    setMasterPin,
} from '../src/utils/duenoAuth';
import { NEGOCIOS_REGISTRY_KEY } from '../src/utils/negocioContext';

const initialPinEvent = vi.fn();

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.__INITIAL_PINS__;
    initialPinEvent.mockClear();
    window.addEventListener('initial-pins-ready', (event) => {
        initialPinEvent(event.detail);
    }, { once: true });
    vi.resetModules();
});

describe('inicialización de instalación nueva', () => {
    it('crea solo un negocio y dos usuarios; sus PINs y el maestro son ceros', async () => {
        const { bootNegocios } = await import('../src/utils/bootNegocios');
        await bootNegocios();
        const { useNegociosStore } = await import('../src/hooks/store/useNegociosStore');
        await useNegociosStore.persist.rehydrate();

        const { useAuthStore, ensureInitialUsers } = await import('../src/hooks/store/useAuthStore');
        await useAuthStore.persist.rehydrate();
        await Promise.all([ensureInitialUsers(), ensureInitialUsers()]);

        const registry = JSON.parse(localStorage.getItem(NEGOCIOS_REGISTRY_KEY));
        expect(registry.state.negocios).toHaveLength(1);
        expect(registry.state.negocios[0]).toMatchObject({ id: 'neg-1', nombre: 'Mi negocio' });
        expect(registry.state.negocioActivoId).toBe('neg-1');

        const users = useAuthStore.getState().usuarios;
        expect(users).toHaveLength(2);
        expect(users.map(({ rol }) => rol)).toEqual(['ADMIN', 'CAJERO']);

        for (const user of users) {
            const pin = user.rol === 'CAJERO' ? '0000' : '000000';
            expect((await verifyPin(pin, user.pin)).valid).toBe(true);
        }

        expect(isMasterPinSetup()).toBe(true);
        const masterPin = localStorage.getItem(DUENO_PIN_KEY);
        expect((await verifyPin('000000', masterPin)).valid).toBe(true);
        expect(initialPinEvent).toHaveBeenCalledTimes(1);
        expect(initialPinEvent).toHaveBeenCalledWith([
            { id: 'dueno', nombre: 'Dueño', rol: 'DUENO', pin: '000000' },
            { id: 1, nombre: 'Administrador', rol: 'ADMIN', pin: '000000' },
            { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: '0000' },
        ]);
    });

    it('no reemplaza usuarios ni PIN maestro preexistentes', async () => {
        const savedHash = await hashPin('864213');
        localStorage.setItem('abasto-auth-storage', JSON.stringify({
            state: {
                usuarios: [{ id: 7, nombre: 'Admin guardado', rol: 'ADMIN', pin: savedHash }],
                requireLogin: true,
            },
            version: 0,
        }));
        expect((await setMasterPin('975310')).ok).toBe(true);
        const savedMasterHash = localStorage.getItem(DUENO_PIN_KEY);
        const existingBusinesses = [
            { id: 'neg-1', nombre: 'Primera sede' },
            { id: 'neg-2', nombre: 'Segunda sede' },
        ];
        localStorage.setItem(NEGOCIOS_REGISTRY_KEY, JSON.stringify({
            state: { negocios: existingBusinesses, negocioActivoId: 'neg-2' },
            version: 0,
        }));
        const { bootNegocios } = await import('../src/utils/bootNegocios');
        expect((await bootNegocios()).migrated).toBe(false);

        const { useAuthStore, ensureInitialUsers } = await import('../src/hooks/store/useAuthStore');
        const { useNegociosStore } = await import('../src/hooks/store/useNegociosStore');
        await useNegociosStore.persist.rehydrate();
        expect(useNegociosStore.getState().negocios).toEqual(existingBusinesses);
        await useAuthStore.persist.rehydrate();
        await ensureInitialUsers();

        expect(useAuthStore.getState().usuarios).toHaveLength(1);
        expect(useAuthStore.getState().usuarios[0]).toMatchObject({ id: 7, nombre: 'Admin guardado' });
        expect(localStorage.getItem(DUENO_PIN_KEY)).toBe(savedMasterHash);
        expect(localStorage.getItem(NEGOCIOS_REGISTRY_KEY)).toContain('Segunda sede');
        expect((await verifyPin('864213', useAuthStore.getState().usuarios[0].pin)).valid).toBe(true);
        expect(initialPinEvent).not.toHaveBeenCalled();
    });
});
