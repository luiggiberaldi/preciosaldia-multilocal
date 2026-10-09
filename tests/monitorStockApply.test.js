import { describe, expect, it } from 'vitest';
import { applyMonitorCatalogDoc, applyMonitorStockDoc } from '../src/utils/monitorStockApply';

const NEG = 'neg-1';
const PRODUCTS = 'nb_neg-1:bodega_products_v1';
const STOCK_DOC = 'nb_neg-1:bodega_stock_v1';
const SOURCE = 'primary-device';

// Almacenamiento en memoria con la misma forma que localforage y localStorage.
const makeLocalforage = () => {
    const data = new Map();
    return {
        data,
        getItem: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
        setItem: async (k, v) => { data.set(k, structuredClone(v)); },
    };
};
const makeStorage = () => {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
    };
};

const setup = async () => {
    const lf = makeLocalforage();
    const ls = makeStorage();
    // Bootstrap: el catálogo del primario llega con stock 10.
    await applyMonitorCatalogDoc({
        localforage: lf,
        docId: PRODUCTS,
        payload: [{ id: 'p1', name: 'Harina', stock: 10 }],
    });
    const applyStock = (map) => applyMonitorStockDoc({
        localforage: lf, storage: ls, docId: STOCK_DOC, negocioId: NEG, sourceDeviceId: SOURCE, payload: map,
    });
    const stock = () => lf.data.get(PRODUCTS)[0].stock;
    return { lf, ls, applyStock, stock };
};

describe('monitor: aplicación de stock y catálogo', () => {
    it('el catálogo actualiza nombres pero conserva el stock local', async () => {
        const lf = makeLocalforage();
        await applyMonitorCatalogDoc({ localforage: lf, docId: PRODUCTS, payload: [{ id: 'p1', name: 'Harina', stock: 8 }] });
        await applyMonitorCatalogDoc({ localforage: lf, docId: PRODUCTS, payload: [{ id: 'p1', name: 'Harina 1kg', stock: 10 }] });
        expect(lf.data.get(PRODUCTS)).toEqual([{ id: 'p1', name: 'Harina 1kg', stock: 8 }]);
    });

    it('cada delta de stock se aplica una sola vez; repetir el mismo mapa no cambia nada', async () => {
        const { applyStock, stock } = await setup();
        await applyStock({ p1: 10 }); // primera vista: solo siembra
        expect(stock()).toBe(10);
        const first = await applyStock({ p1: 8 }); // venta de 2 en el primario
        expect(first.changed).toBe(true);
        expect(stock()).toBe(8);
        const repeat = await applyStock({ p1: 8 });
        expect(repeat.changed).toBe(false);
        expect(stock()).toBe(8);
    });

    it('un catálogo posterior con el stock absoluto del primario no duplica la venta', async () => {
        const { lf, applyStock, stock } = await setup();
        await applyStock({ p1: 10 });
        await applyStock({ p1: 8 });
        // El primario vuelve a publicar su catálogo completo (stock absoluto 8).
        await applyMonitorCatalogDoc({ localforage: lf, docId: PRODUCTS, payload: [{ id: 'p1', name: 'Harina', stock: 8 }] });
        expect(stock()).toBe(8);
    });

    it('sin catálogo local no toca el stock', async () => {
        const lf = makeLocalforage();
        const ls = makeStorage();
        const r = await applyMonitorStockDoc({
            localforage: lf, storage: ls, docId: STOCK_DOC, negocioId: NEG, sourceDeviceId: SOURCE, payload: { p1: 5 },
        });
        expect(r.changed).toBe(false);
        expect(lf.data.has(PRODUCTS)).toBe(false);
    });
});
