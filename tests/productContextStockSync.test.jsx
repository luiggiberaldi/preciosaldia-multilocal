/**
 * tests/productContextStockSync.test.jsx — SYNC-INMEDIATO (v2.2.1).
 *
 * Cubre el flujo real de los botones +/- de la tarjeta de producto:
 *  - el stock se actualiza localmente con aritmética canónica (granel/entero);
 *  - se guarda en storageService (que encola el push con debounce);
 *  - se empuja a la nube AL MOMENTO con flushCloudSync (sin esperar 3s);
 *  - se confirma con un aviso al usuario.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { flushSpy, pushCloudSpy, setItemSpy, toastSpy, shadowRestoreSpy } = vi.hoisted(() => ({
    flushSpy: vi.fn(),
    pushCloudSpy: vi.fn().mockResolvedValue({ ok: true }),
    setItemSpy: vi.fn().mockResolvedValue(undefined),
    toastSpy: vi.fn(),
    shadowRestoreSpy: vi.fn().mockResolvedValue(null),
}));

const seeded = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: async (key, def) => (seeded.has(key) ? seeded.get(key) : def),
        setItem: setItemSpy,
        removeItem: vi.fn(),
    },
    default: { getItem: async (k, d) => (seeded.has(k) ? seeded.get(k) : d), setItem: setItemSpy },
}));
vi.mock('../src/utils/shadowBackupService', () => ({
    shadowBackupService: { saveShadow: vi.fn(), restoreShadow: shadowRestoreSpy },
    default: { saveShadow: vi.fn(), restoreShadow: shadowRestoreSpy },
}));
vi.mock('../src/hooks/useCloudSync', () => ({
    pushLocalSync: vi.fn(),
    pushCloudSync: pushCloudSpy,
    flushCloudSync: flushSpy,
    queueCloudSync: vi.fn(),
}));
vi.mock('../src/components/Toast', () => ({
    showToast: toastSpy,
    ToastProvider: ({ children }) => children,
}));
vi.mock('../src/context/RateContext', () => ({
    useRateContext: () => ({
        copEnabled: false,
        tasaCop: 0,
        rates: { bcv: { price: 1 } },
        setStreetRate: vi.fn(),
    }),
}));

import { ProductProvider, useProductContext } from '../src/context/ProductContext';

let root;
let container;
let ctx;

function Harness() {
    ctx = useProductContext();
    return null;
}

const waitFor = async (check, label) => {
    for (let i = 0; i < 200; i++) {
        if (check()) return;
        await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    }
    throw new Error(`no se cumplió: ${label}`);
};

beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    seeded.clear();
    setItemSpy.mockClear();
    toastSpy.mockClear();
    shadowRestoreSpy.mockClear();
    flushSpy.mockReset();
    flushSpy.mockResolvedValue({ ok: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
});

const mountWithProducts = async (products) => {
    seeded.set('bodega_products_v1', products);
    await act(async () => { root.render(createElement(ProductProvider, null, createElement(Harness))); });
    await waitFor(() => ctx?.products?.length > 0, 'carga de productos');
};

describe('ProductContext: ajuste de stock con push inmediato', () => {
    it('empuja a la nube al momento y confirma con un aviso', async () => {
        await mountWithProducts([{ id: 'p1', name: 'Harina', priceUsd: 1, stock: 10 }]);
        flushSpy.mockClear();

        await act(async () => { ctx.adjustStock('p1', 1); });

        // Push inmediato con el catálogo ya actualizado.
        expect(flushSpy).toHaveBeenCalledTimes(1);
        const [key, value] = flushSpy.mock.calls[0];
        expect(key).toBe('bodega_products_v1');
        expect(value.find((p) => p.id === 'p1').stock).toBe(11);

        // El guardado local sigue existiendo (encola la red de reintento).
        expect(setItemSpy).toHaveBeenCalledWith('bodega_products_v1', expect.any(Array));

        await waitFor(() => toastSpy.mock.calls.length > 0, 'aviso de confirmación');
        const [mensaje, tipo] = toastSpy.mock.calls[0];
        expect(mensaje).toContain('Harina');
        expect(mensaje).toContain('+1');
        expect(mensaje).toContain('11');
        expect(mensaje).toContain('subido a la nube');
        expect(tipo).toBe('success');
    });

    it('resta y avisa si la sincronización no pudo subir el cambio', async () => {
        await mountWithProducts([{ id: 'p1', name: 'Harina', priceUsd: 1, stock: 5 }]);
        flushSpy.mockReset();
        flushSpy.mockResolvedValue({ ok: false, error: 'sin red' });
        toastSpy.mockClear();

        await act(async () => { ctx.adjustStock('p1', -1); });

        await waitFor(() => toastSpy.mock.calls.length > 0, 'aviso de error');
        const [mensaje, tipo] = toastSpy.mock.calls[0];
        expect(mensaje).toContain('4');
        expect(mensaje).toContain('se reintentará');
        expect(tipo).toBe('error');
    });

    it('no baja de cero sin allow_negative_stock y no empuja si el producto no existe', async () => {
        localStorage.removeItem('allow_negative_stock');
        await mountWithProducts([{ id: 'p1', name: 'Harina', priceUsd: 1, stock: 0 }]);
        flushSpy.mockClear();

        await act(async () => { ctx.adjustStock('p1', -1); });
        expect(flushSpy.mock.calls[0][1].find((p) => p.id === 'p1').stock).toBe(0);

        flushSpy.mockClear();
        await act(async () => { ctx.adjustStock('no-existe', 1); });
        expect(flushSpy).not.toHaveBeenCalled();
    });
});
