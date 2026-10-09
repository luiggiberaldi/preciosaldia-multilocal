import { describe, expect, it, beforeEach } from 'vitest';
import {
    buildStockMovements,
    enqueueStockMovements,
    flushStockMovements,
    readStockOutbox,
    STOCK_OUTBOX_KEY,
    STOCK_BATCH_SIZE,
} from '../src/utils/stockLedger.js';

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
    };
}

const base = { negocioId: 'neg-1', deviceId: 'PDA-V2-A' };

let storage;
beforeEach(() => {
    storage = memoryStorage();
});

describe('buildStockMovements', () => {
    it('genera movement_id determinista por negocio, origen y producto', () => {
        const a = buildStockMovements({
            ...base, reason: 'SALE', sourceRef: 'sale:S1',
            changes: [{ productId: 'p1', delta: -2 }],
        });
        const b = buildStockMovements({
            ...base, reason: 'SALE', sourceRef: 'sale:S1',
            changes: [{ productId: 'p1', delta: -2 }],
        });
        expect(a[0].movement_id).toBe('neg-1:sale:S1:p1');
        expect(a[0].movement_id).toBe(b[0].movement_id);
    });

    it('omite deltas en cero o no finitos', () => {
        const out = buildStockMovements({
            ...base, reason: 'ADJUST', sourceRef: 'adjust:x',
            changes: [
                { productId: 'p1', delta: 0 },
                { productId: 'p2', delta: NaN },
                { productId: 'p3', delta: 1 },
            ],
        });
        expect(out.map((m) => m.product_id)).toEqual(['p3']);
    });

    it('redondea el delta a 3 decimales (granel)', () => {
        const [m] = buildStockMovements({
            ...base, reason: 'SALE', sourceRef: 'sale:S2',
            changes: [{ productId: 'g', delta: -0.1249999 }],
        });
        expect(m.delta).toBe(-0.125);
    });

    it('rechaza un reason desconocido', () => {
        expect(() => buildStockMovements({
            ...base, reason: 'RECEIPT', sourceRef: 'r:1', changes: [{ productId: 'p', delta: 1 }],
        })).toThrow(/reason inválido/);
    });

    it('exige negocio, dispositivo y origen', () => {
        expect(() => buildStockMovements({
            negocioId: '', deviceId: 'd', reason: 'SALE', sourceRef: 's', changes: [],
        })).toThrow();
    });
});

describe('cola durable', () => {
    it('no duplica ids ya pendientes al reencolar', () => {
        const mv = buildStockMovements({
            ...base, reason: 'SALE', sourceRef: 'sale:S3',
            changes: [{ productId: 'p1', delta: -1 }],
        });
        expect(enqueueStockMovements(mv, storage)).toBe(1);
        expect(enqueueStockMovements(mv, storage)).toBe(0);
        expect(readStockOutbox(storage)).toHaveLength(1);
    });

    it('persiste en localStorage bajo la clave del ledger', () => {
        const mv = buildStockMovements({
            ...base, reason: 'VOID', sourceRef: 'void:S4',
            changes: [{ productId: 'p1', delta: 3 }],
        });
        enqueueStockMovements(mv, storage);
        expect(JSON.parse(storage.getItem(STOCK_OUTBOX_KEY))[0].movement_id).toBe('neg-1:void:S4:p1');
    });
});

describe('flushStockMovements', () => {
    it('envía en lotes y vacía la cola cuando el servidor confirma', async () => {
        const total = STOCK_BATCH_SIZE + 25;
        const changes = Array.from({ length: total }, (_, i) => ({ productId: `p${i}`, delta: -1 }));
        enqueueStockMovements(buildStockMovements({
            ...base, reason: 'SALE', sourceRef: 'sale:big', changes,
        }), storage);

        const calls = [];
        const rpc = async (name, params) => {
            calls.push({ name, size: params.p_movements.length });
            return { error: null };
        };
        const res = await flushStockMovements({ rpc, storage });

        expect(res).toEqual({ ok: true, sent: total, pending: 0 });
        expect(calls.map((c) => c.name)).toEqual(['apply_stock_movements', 'apply_stock_movements']);
        expect(calls.map((c) => c.size)).toEqual([STOCK_BATCH_SIZE, 25]);
        expect(readStockOutbox(storage)).toHaveLength(0);
    });

    it('si un lote falla, conserva los movimientos no confirmados', async () => {
        const changes = Array.from({ length: STOCK_BATCH_SIZE + 10 }, (_, i) => ({ productId: `q${i}`, delta: 1 }));
        enqueueStockMovements(buildStockMovements({
            ...base, reason: 'ADJUST', sourceRef: 'adjust:big', changes,
        }), storage);

        let n = 0;
        const rpc = async () => {
            n++;
            return n === 1 ? { error: null } : { error: { message: 'red caída' } };
        };
        const res = await flushStockMovements({ rpc, storage });

        expect(res.ok).toBe(false);
        expect(res.sent).toBe(STOCK_BATCH_SIZE);
        expect(res.pending).toBe(10);
        expect(readStockOutbox(storage)).toHaveLength(10);
    });

    it('un error del rpc (excepción) no pierde nada', async () => {
        enqueueStockMovements(buildStockMovements({
            ...base, reason: 'SALE', sourceRef: 'sale:S5', changes: [{ productId: 'p', delta: -1 }],
        }), storage);
        const res = await flushStockMovements({
            rpc: async () => { throw new Error('sin sesión'); },
            storage,
        });
        expect(res.ok).toBe(false);
        expect(res.error).toBe('sin sesión');
        expect(readStockOutbox(storage)).toHaveLength(1);
    });

    it('reenviar tras un fallo es seguro: mismos ids, el servidor los ignora', async () => {
        const mv = buildStockMovements({
            ...base, reason: 'SALE', sourceRef: 'sale:S6', changes: [{ productId: 'p', delta: -2 }],
        });
        enqueueStockMovements(mv, storage);
        const seen = [];
        await flushStockMovements({
            rpc: async (_n, p) => { seen.push(...p.p_movements.map((m) => m.movement_id)); return { error: { message: 'timeout' } }; },
            storage,
        });
        await flushStockMovements({
            rpc: async (_n, p) => { seen.push(...p.p_movements.map((m) => m.movement_id)); return { error: null }; },
            storage,
        });
        expect(seen).toEqual(['neg-1:sale:S6:p', 'neg-1:sale:S6:p']);
        expect(readStockOutbox(storage)).toHaveLength(0);
    });

    it('sin pendientes no llama al servidor', async () => {
        let called = false;
        const res = await flushStockMovements({ rpc: async () => { called = true; return { error: null }; }, storage });
        expect(res).toEqual({ ok: true, sent: 0, pending: 0 });
        expect(called).toBe(false);
    });
});
