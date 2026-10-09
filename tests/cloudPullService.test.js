import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('localforage', () => ({ default: { createInstance: () => ({}) } }));
import {
    runCloudPull, getPendingCloudDocuments, resolveCloudPullFailure, hasPendingCloudKey,
    retainCloudPullFailure, fetchCloudPullPage, publishCloudPullStatus, getCloudPullStatus,
    countPendingByReason,
} from '../src/services/cloudPullService';

const scope = 'local-account';
const cursorKey = 'cursor:' + scope + ':' + JSON.stringify(['a']);
const stamp = '2026-10-08T12:00:00.000Z';
function memoryStore() {
    const data = new Map();
    return { data, keys: async () => [...data.keys()], getItem: async k => data.get(k) ?? null,
        setItem: async (k, v) => { data.set(k, structuredClone(v)); return v; } };
}
function row(index, data = { payload: [] }) {
    return { device_id: 'a', collection: 'store', doc_id: `nb_neg-1:bodega_sales_delta_${String(index).padStart(5, '0')}`,
        updated_at: stamp, data };
}
function pages(rows, capture = []) {
    return vi.fn(async ({ after, since, pageSize }) => {
        capture.push({ after, since });
        const begin = after ? rows.findIndex(r => r.doc_id === after.doc_id) + 1 : 0;
        return rows.slice(begin, begin + pageSize);
    });
}
let store;
beforeEach(() => { store = memoryStore(); localStorage.clear(); });

describe('F2 pull aislado por documento', () => {
    it('tres inválidos no paran los válidos y conservan raw/procedencia por revisión', async () => {
        const rows = [row(1), row(2, { bad: 1 }), row(3), row(4, { bad: 2 }), row(5, { bad: 3 }), row(6)];
        const apply = vi.fn(async r => { if (r.data.bad) throw new Error('Schema inválido'); return true; });
        const result = await runCloudPull({ scope, deviceIds: ['a'], store, fetchPage: pages(rows), apply, classify: () => null });
        expect(result).toMatchObject({ applied: 3, pending: 3, failed: 3, status: 'partial', queryFailed: false });
        const pending = await getPendingCloudDocuments(scope, store);
        expect(pending.map(e => e.row.data)).toEqual([{ bad: 1 }, { bad: 2 }, { bad: 3 }]);
        expect(pending.every(e => e.contentHash && e.attempts === 1 && e.row.device_id === 'a')).toBe(true);
        expect(store.data.get(cursorKey).doc_id).toBe(rows[5].doc_id);
    });

    it('fallido anterior al cursor se reintenta y una revisión corregida conserva raw histórico', async () => {
        const bad = row(1, { bad: true });
        const base = { scope, deviceIds: ['a'], store, classify: () => null };
        await runCloudPull({ ...base, fetchPage: pages([bad]), apply: async () => { throw new Error('invalid'); }, now: 0 });
        const retry = await runCloudPull({ ...base, fetchPage: pages([]), apply: async () => true, now: 10_000 });
        expect(retry).toMatchObject({ applied: 1, pending: 0, status: 'confirmed' });
        const historical = [...store.data.values()].find(e => e.row);
        expect(historical.row.data).toEqual({ bad: true });
        expect(historical.status).toBe('resolved');
        await retainCloudPullFailure(scope, bad, 'invalid-document', store);
        const repaired = { ...bad, updated_at: '2026-10-08T13:00:00.000Z', data: { payload: [] } };
        await resolveCloudPullFailure(scope, repaired, store);
        expect(await getPendingCloudDocuments(scope, store)).toEqual([]);
        expect([...store.data.values()].find(e => e.row).resolution).toBe('superseded-by-confirmed-revision');
    });

    it('2.001+ filas con timestamp empatado paginan sin perder ninguna', async () => {
        const rows = Array.from({ length: 2003 }, (_, i) => row(i));
        const apply = vi.fn(async () => true);
        const fetchPage = pages(rows);
        const result = await runCloudPull({ scope, deviceIds: ['a'], store, fetchPage, apply, classify: () => null });
        expect(result).toMatchObject({ applied: 2003, pending: 0, status: 'confirmed' });
        expect(fetchPage).toHaveBeenCalledTimes(5);
        expect(new Set(apply.mock.calls.map(([r]) => r.doc_id)).size).toBe(2003);
        const capture = [];
        await runCloudPull({ scope, deviceIds: ['a'], store, fetchPage: pages([], capture), apply, classify: () => null });
        expect(capture[0].since).toBe(stamp);
        expect(capture[0].after).toBeNull();
    });

    it('fallo de página conserva checkpoint previo y reporta parcial sin inventar confirmación', async () => {
        const fetchPage = vi.fn().mockResolvedValueOnce([row(1), row(2)]).mockRejectedValueOnce(new Error('network'));
        const result = await runCloudPull({ scope, deviceIds: ['a'], store, pageSize: 2, fetchPage, apply: async () => true, classify: () => null });
        expect(result).toMatchObject({ applied: 2, queryFailed: true, status: 'partial' });
        expect(store.data.get(cursorKey).doc_id).toBe(row(2).doc_id);
    });

    it('cuota del journal no adelanta cursor ni detiene aplicar los otros válidos de la página', async () => {
        store.setItem = async () => { throw new Error('quota'); };
        const apply = vi.fn(async r => { if (r.doc_id === row(1).doc_id) throw new Error('invalid'); return true; });
        const result = await runCloudPull({ scope, deviceIds: ['a'], store, fetchPage: pages([row(1), row(2)]), apply, classify: () => null });
        expect(result).toMatchObject({ applied: 1, queryFailed: true, status: 'partial' });
        expect(store.data.has(cursorKey)).toBe(false);
    });

    it('sede desconocida queda pendiente y claves retiradas se cuentan como skip', async () => {
        const result = await runCloudPull({ scope, deviceIds: ['a'], store, fetchPage: pages([row(1), row(2)]),
            apply: vi.fn(), classify: r => r.doc_id === row(1).doc_id ? 'unknown-business' : 'skip' });
        expect(result).toMatchObject({ pending: 1, skipped: 1, applied: 0, status: 'partial' });
    });

    it('backoff retiene el pendiente, reintento manual lo fuerza y no aplica origen revocado', async () => {
        await retainCloudPullFailure(scope, row(1), 'apply-failed', store, 100);
        const apply = vi.fn(async () => true);
        const base = { scope, deviceIds: ['a'], store, fetchPage: pages([]), apply, classify: () => null, now: 101 };
        expect((await runCloudPull(base)).pending).toBe(1);
        expect(apply).not.toHaveBeenCalled();
        expect((await runCloudPull({ ...base, deviceIds: ['b'], manual: true })).pending).toBe(1);
        expect(apply).not.toHaveBeenCalled();
        expect((await runCloudPull({ ...base, manual: true })).pending).toBe(0);
    });

    it('documento no confirmado bloquea solo su clave/sede y ventas delta bloquean snapshot de ventas', async () => {
        const bad = { ...row(1), doc_id: 'nb_neg-1:bodega_sales_delta_2026-10-08' };
        await retainCloudPullFailure(scope, bad, 'invalid-document', store);
        expect(await hasPendingCloudKey(scope, 'nb_neg-1:bodega_sales_v1', store)).toBe(true);
        expect(await hasPendingCloudKey(scope, 'nb_other:bodega_sales_v1', store)).toBe(false);
        expect(await hasPendingCloudKey(scope, 'nb_neg-1:bodega_products_v1', store)).toBe(false);
        expect(await getPendingCloudDocuments('other-account', store)).toEqual([]);
    });

    it('rechaza paginación repetida/desordenada sin avanzar sobre esa página', async () => {
        const result = await runCloudPull({ scope, deviceIds: ['a'], store, fetchPage: pages([row(2), row(1)]),
            apply: vi.fn(), classify: () => null });
        expect(result).toMatchObject({ status: 'failed', queryFailed: true, applied: 0 });
        expect(store.data.has(cursorKey)).toBe(false);
    });

    it('UI guarda solo conteos, parcial no sobrescribe última confirmación', () => {
        publishCloudPullStatus('a', { status: 'confirmed', applied: 2, confirmedSync: true });
        const last = getCloudPullStatus('a').lastConfirmedAt;
        publishCloudPullStatus('a', { status: 'partial', applied: 3, pending: 2, secret: 'never-export' });
        expect(getCloudPullStatus('a')).toMatchObject({ status: 'partial', pending: 2, lastConfirmedAt: last });
        expect(JSON.stringify(getCloudPullStatus('a'))).not.toContain('never-export');
    });

    it('nuevo origen autorizado no hereda cursor que omitiría su historial', async () => {
        const base = { scope, store, apply: async () => true, classify: () => null };
        await runCloudPull({ ...base, deviceIds: ['a'], fetchPage: pages([row(1)]) });
        const capture = [];
        await runCloudPull({ ...base, deviceIds: ['a', 'b'], fetchPage: pages([], capture) });
        expect(capture[0].since).toBeNull();
    });

    it('fallo durable durante retry de pendiente no se presenta como confirmado', async () => {
        await retainCloudPullFailure(scope, row(1), 'apply-failed', store, 0);
        store.setItem = async () => { throw new Error('quota'); };
        const result = await runCloudPull({ scope, deviceIds: ['a'], store, fetchPage: pages([]),
            apply: async () => { throw new Error('invalid'); }, classify: () => null, manual: true });
        expect(result).toMatchObject({ queryFailed: true, pending: 1, status: 'partial' });
    });

    it('consulta/autorización fallida no aplica raw retenido desde disco', async () => {
        await retainCloudPullFailure(scope, row(1), 'apply-failed', store, 0);
        const apply = vi.fn();
        const result = await runCloudPull({ scope, deviceIds: ['a'], store,
            fetchPage: async () => { throw new Error('access revoked'); }, apply, classify: () => null, manual: true });
        expect(result).toMatchObject({ queryFailed: true, pending: 1, status: 'partial' });
        expect(apply).not.toHaveBeenCalled();
    });

    it('desglosa pendientes por causa sin contar los resueltos ni los omitidos', async () => {
        expect(countPendingByReason([
            { reason: 'unknown-business' }, { reason: 'unknown-business' }, { reason: 'invalid-registry' }, null,
        ])).toEqual({ 'unknown-business': 2, 'invalid-registry': 1 });
        expect(countPendingByReason(undefined)).toEqual({});

        const rows = [row(1), row(2, { bad: true }), row(3)];
        const result = await runCloudPull({ scope, deviceIds: ['a'], store, fetchPage: pages(rows),
            apply: vi.fn(async r => { if (r.data.bad) throw new Error('Schema inválido'); return true; }),
            classify: r => r.doc_id === row(1).doc_id ? 'unknown-business' : null });
        expect(result).toMatchObject({ pending: 2, applied: 1, skipped: 0 });
        expect(result.pendingByReason).toEqual({ 'unknown-business': 1, 'invalid-document': 1 });

        publishCloudPullStatus('a', { ...result, status: result.status });
        expect(getCloudPullStatus('a').pendingByReason).toEqual({ 'unknown-business': 1, 'invalid-document': 1 });
    });

    it('query real usa cuatro columnas de orden y cursor compuesto', async () => {
        const query = {};
        for (const method of ['select', 'in', 'order', 'limit', 'or', 'gte']) query[method] = vi.fn(() => query);
        query.then = resolve => resolve({ data: [], error: null });
        const client = { from: vi.fn(() => query) };
        await fetchCloudPullPage(client, ['a'], { after: row(1) });
        expect(query.order.mock.calls.map(([key]) => key)).toEqual(['updated_at', 'device_id', 'collection', 'doc_id']);
        expect(query.or).toHaveBeenCalledWith(expect.stringContaining('doc_id.gt.'));
        expect(query.limit).toHaveBeenCalledWith(500);
        await fetchCloudPullPage(client, ['a'], { since: stamp });
        expect(query.gte).toHaveBeenCalledWith('updated_at', stamp);
    });
});
