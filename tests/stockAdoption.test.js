/**
 * stockAdoption.test.js — Equipo nuevo adopta el stock de la nube como base.
 *
 * Sin la base de recibido, el stock adoptado se republicaba como actividad
 * propia y los demás equipos lo volvían a aplicar (eco).
 */
import { describe, expect, it } from 'vitest';
import {
    applyStockMapDelta,
    buildOwnStockMap,
    accumulateReceivedStock,
    stockBaseAfterAdoption,
} from '../src/utils/syncDelta.js';

const products = (stock) => [{ id: 'p', stock }];

describe('adopción del stock de la nube', () => {
    it('la base de recibido deja el stock propio en cero tras adoptar', () => {
        const adopted = products(8);
        const own = buildOwnStockMap(adopted, stockBaseAfterAdoption(adopted));
        expect(own).toEqual({ p: 0 });
    });

    it('sin la base, el stock adoptado se republica como actividad propia (eco)', () => {
        const own = buildOwnStockMap(products(8), {});
        expect(own).toEqual({ p: 8 });
    });

    it('tras vender, el stock propio solo cuenta lo vendido desde la adopción', () => {
        const adopted = products(8);
        const received = stockBaseAfterAdoption(adopted);
        adopted[0].stock -= 2; // vende 2 en este equipo
        expect(buildOwnStockMap(adopted, received)).toEqual({ p: -2 });
    });

    it('un delta remoto aplicado no altera el stock propio', () => {
        const adopted = products(8);
        let received = stockBaseAfterAdoption(adopted);
        // Otro equipo vende 1: el delta se suma al stock local y al recibido.
        const { products: merged, deltas } = applyStockMapDelta(adopted, { p: 7 }, { p: 8 });
        received = accumulateReceivedStock(received, deltas);
        expect(merged[0].stock).toBe(7);
        expect(buildOwnStockMap(merged, received)).toEqual({ p: 0 });
    });

    it('dos equipos: el adoptado no se duplica al vender después', () => {
        // A vendió 2 antes de que B exista. B adopta 8 y publica 0 (su propio stock).
        const A = { products: products(8), lastRemote: {}, received: {} };
        const B = { products: products(8), received: stockBaseAfterAdoption(products(8)), lastRemote: {} };

        // A ve el mapa propio de B (0) y lo siembra; B ve el de A (0 propio) y lo siembra.
        A.lastRemote.B = buildOwnStockMap(B.products, B.received);
        B.lastRemote.A = buildOwnStockMap(A.products, A.received);

        // B vende 1.
        B.products[0].stock -= 1;
        const ownB = buildOwnStockMap(B.products, B.received);
        expect(ownB).toEqual({ p: -1 });

        // A recibe el delta de B: 8 → 7 (correcto), sin contar de nuevo las ventas previas.
        const res = applyStockMapDelta(A.products, ownB, A.lastRemote.B);
        expect(res.products[0].stock).toBe(7);
    });
});
