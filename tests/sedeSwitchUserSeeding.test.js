import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeUserCatalog } from '../src/utils/userCatalog';
import { DUENO_PIN_KEY } from '../src/utils/duenoAuth';
import { NEGOCIOS_REGISTRY_KEY } from '../src/utils/negocioContext';

const initialPinEvent = vi.fn();
const onInitialPins = (event) => {
    initialPinEvent(event.detail);
};

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.__INITIAL_PINS__;
    initialPinEvent.mockClear();
    window.addEventListener('initial-pins-ready', onInitialPins);
    vi.resetModules();
});

afterEach(() => {
    window.removeEventListener('initial-pins-ready', onInitialPins);
});

describe('cambio de sede: siembra de usuarios', () => {
    it('una sede adicional vacía no siembra usuarios por defecto ni PIN maestro', async () => {
        localStorage.setItem(NEGOCIOS_REGISTRY_KEY, JSON.stringify({
            state: {
                negocios: [
                    { id: 'neg-1', nombre: 'Primera sede' },
                    { id: 'neg-2', nombre: 'Segunda sede' },
                ],
                negocioActivoId: 'neg-2',
            },
            version: 0,
        }));
        const { bootNegocios } = await import('../src/utils/bootNegocios');
        await bootNegocios();
        const { useNegociosStore } = await import('../src/hooks/store/useNegociosStore');
        await useNegociosStore.persist.rehydrate();
        const { useAuthStore, ensureInitialUsers } = await import('../src/hooks/store/useAuthStore');
        await useAuthStore.persist.rehydrate();
        await Promise.all([ensureInitialUsers(), ensureInitialUsers()]);

        expect(useAuthStore.getState().usuarios).toEqual([]);
        expect(localStorage.getItem(DUENO_PIN_KEY)).toBeNull();
        expect(initialPinEvent).not.toHaveBeenCalled();
    });

    it('crear y activar otra sede no vuelve a sembrar ni duplica la lista global de usuarios', async () => {
        localStorage.setItem(NEGOCIOS_REGISTRY_KEY, JSON.stringify({
            state: { negocios: [{ id: 'neg-1', nombre: 'Bodega' }], negocioActivoId: 'neg-1' },
            version: 0,
        }));
        const { bootNegocios } = await import('../src/utils/bootNegocios');
        await bootNegocios();
        const { setNegocioActivoId } = await import('../src/utils/negocioContext');
        const { useNegociosStore } = await import('../src/hooks/store/useNegociosStore');
        await useNegociosStore.persist.rehydrate();
        const { useAuthStore, ensureInitialUsers } = await import('../src/hooks/store/useAuthStore');
        await useAuthStore.persist.rehydrate();
        // Primera sede: siembra normal (2 usuarios).
        await ensureInitialUsers();
        const antes = useAuthStore.getState().usuarios.map((u) => u.uid);
        expect(antes).toHaveLength(2);

        const res = useNegociosStore.getState().crearNegocio({ nombre: 'Cosméticos' });
        expect(res.ok).toBe(true);
        useNegociosStore.setState({ negocioActivoId: res.id });
        setNegocioActivoId(res.id);
        await useAuthStore.persist.rehydrate();
        await ensureInitialUsers();
        await ensureInitialUsers();

        const despues = useAuthStore.getState().usuarios.map((u) => u.uid);
        expect(despues).toEqual(antes);
        expect(initialPinEvent).toHaveBeenCalledTimes(1);
    });

    it('el roster de la nube con nombres distintos no se fusiona con defaults locales (duplica)', () => {
        const localDefaults = [
            { id: 1, uid: 'uid-local-admin', nombre: 'Administrador', rol: 'ADMIN', requirePin: true },
            { id: 2, uid: 'uid-local-cajero', nombre: 'Cajero', rol: 'CAJERO', requirePin: true },
        ];
        const remoteDoc = {
            users: [
                { id: 1, uid: 'uid-remote-admin', nombre: 'Juan', rol: 'ADMIN', requirePin: true },
                { id: 2, uid: 'uid-remote-cajero', nombre: 'Ana', rol: 'CAJERO', requirePin: true },
            ],
        };
        // Sin siembra local el resultado es exactamente el roster remoto.
        expect(mergeUserCatalog([], remoteDoc).length).toBe(2);
        // Con defaults locales el merge deja 4: no deduplica por nombre distinto.
        expect(mergeUserCatalog(localDefaults, remoteDoc).length).toBe(4);
    });
});
