/**
 * bootNegocios.test.js — Migración automática sin pérdida (Fase 1).
 *
 * Simula una instalación legacy (claves sin prefijo en IndexedDB y
 * localStorage) y verifica que bootNegocios():
 *  - crea el registro con "Mi negocio" (neg-1),
 *  - MUEVE (no copia) cada clave de datos a nb_neg-1:<clave>,
 *  - mueve las claves de auth al namespace,
 *  - deja intactas las claves globales,
 *  - no re-migra si el registro ya existe.
 *
 * localforage se mockea con un Map en memoria (jsdom no tiene IndexedDB).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const memStore = new Map();

vi.mock('localforage', () => ({
    default: {
        config: vi.fn(),
        createInstance: vi.fn(() => ({
            getItem: async (k) => (memStore.has(k) ? memStore.get(k) : null),
            setItem: async (k, v) => { memStore.set(k, v); return v; },
            removeItem: async (k) => { memStore.delete(k); },
            keys: async () => [...memStore.keys()],
            clear: async () => { memStore.clear(); },
        })),
        getItem: async (k) => (memStore.has(k) ? memStore.get(k) : null),
        setItem: async (k, v) => { memStore.set(k, v); return v; },
        removeItem: async (k) => { memStore.delete(k); },
        keys: async () => [...memStore.keys()],
        clear: async () => { memStore.clear(); },
    },
}));

const { bootNegocios } = await import('../src/utils/bootNegocios');
const { setNegocioActivoId } = await import('../src/utils/negocioContext');

beforeEach(() => {
    memStore.clear();
    localStorage.clear();
    setNegocioActivoId(null);
    vi.resetModules();
});

function seedLegacy() {
    // Datos legacy: claves sin prefijo.
    memStore.set('bodega_products_v1', [{ id: 1, nombre: 'Arroz' }]);
    memStore.set('bodega_sales_v1', [{ id: 9, total: 100 }]);
    memStore.set('monitor_rates_v12', { bcv: 100 }); // global: no se mueve
    localStorage.setItem('abasto-auth-storage', JSON.stringify({ state: { usuarios: [{ id: 1 }] } }));
    localStorage.setItem('abasto-device-session', JSON.stringify({ id: 1, nombre: 'Admin', rol: 'ADMIN' }));
    localStorage.setItem('business_name', 'Bodega Legacy');
    localStorage.setItem('business_rif', 'J-00000000-0');
}

describe('migración automática (primer arranque)', () => {
    it('mueve claves de datos a nb_neg-1: sin copiar y sin perder', async () => {
        seedLegacy();
        const res = await bootNegocios();

        expect(res.migrated).toBe(true);
        expect(res.negocioActivoId).toBe('neg-1');
        // Movidas: destino existe…
        expect(memStore.get('nb_neg-1:bodega_products_v1')).toEqual([{ id: 1, nombre: 'Arroz' }]);
        expect(memStore.get('nb_neg-1:bodega_sales_v1')).toEqual([{ id: 9, total: 100 }]);
        // …y origen borrado (mover, no copiar).
        expect(memStore.has('bodega_products_v1')).toBe(false);
        expect(memStore.has('bodega_sales_v1')).toBe(false);
        // Globales intactas.
        expect(memStore.get('monitor_rates_v12')).toEqual({ bcv: 100 });
    });

    it('mueve las claves de auth al namespace del negocio', async () => {
        seedLegacy();
        await bootNegocios();
        expect(localStorage.getItem('nb_neg-1:abasto-auth-storage')).toContain('"usuarios"');
        expect(localStorage.getItem('nb_neg-1:abasto-device-session')).toContain('"Admin"');
        expect(localStorage.getItem('abasto-auth-storage')).toBeNull();
        expect(localStorage.getItem('abasto-device-session')).toBeNull();
    });

    it('crea el registro con "Mi negocio" heredando los datos fiscales', async () => {
        seedLegacy();
        await bootNegocios();
        const reg = JSON.parse(localStorage.getItem('pda-negocios-registry'));
        expect(reg.state.negocios).toHaveLength(1);
        expect(reg.state.negocios[0].id).toBe('neg-1');
        expect(reg.state.negocios[0].nombre).toBe('Bodega Legacy');
        expect(reg.state.negocios[0].rif).toBe('J-00000000-0');
        expect(reg.state.negocioActivoId).toBe('neg-1');
        // Espejo fiscal sincronizado.
        expect(localStorage.getItem('business_name')).toBe('Bodega Legacy');
    });

    it('no re-migra si el registro ya existe', async () => {
        seedLegacy();
        await bootNegocios();
        // Segunda corrida: datos ya namespaced + registro existente.
        const res = await bootNegocios();
        expect(res.migrated).toBe(false);
        expect(memStore.get('nb_neg-1:bodega_products_v1')).toEqual([{ id: 1, nombre: 'Arroz' }]);
    });
});
