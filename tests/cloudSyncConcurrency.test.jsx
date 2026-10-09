import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
    data: new Map(), writes: [], rows: [], accessGate: null, writeGate: null, readGate: null,
    errors: 0, authorized: true, unavailableAttempts: 0, accessChecks: 0, users: [{ id: 'user-a', nombre: 'A', rol: 'ADMIN' }],
}));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {
    from: () => {
        const query = { select: () => query, in: () => query, eq: () => query,
            order: () => query, limit: () => query,
            then: resolve => Promise.resolve({ data: [], error: null }).then(resolve),
            upsert: async document => {
                fixture.writes.push(structuredClone(document));
                if (fixture.writeGate) { const gate = fixture.writeGate; fixture.writeGate = null; await gate.promise; }
                if (fixture.errors > 0) { fixture.errors--; return { error: new Error('temporary network failure') }; }
                return { data: null, error: null };
            } };
        return query;
    },
    // Realtime: el hook encadena channel().on().subscribe() y luego removeChannel().
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
    removeChannel: async () => 'ok',
} }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(),
    getItem: async key => {
        const value = fixture.data.get(key) ?? null;
        if (fixture.readGate) { const gate = fixture.readGate; fixture.readGate = null; await gate.promise; }
        return value;
    },
    setItem: async (key, value) => { fixture.data.set(key, value); return value; },
    keys: async () => [...fixture.data.keys()],
} }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({
    usuarios: [], aplicarCatalogoRemoto: users => { fixture.users = users; },
}) } }));
vi.mock('../src/services/supervisorAuth', () => ({ ensureSupervisorSession: async () => ({ session: { user: { id: 'owner' } } }) }));
vi.mock('../src/utils/deviceIdentity', () => ({ ensureDeviceSessionRegistered: async () => ({ ok: true }) }));
vi.mock('../src/services/cloudAccount', () => ({
    isAccountLinkedLocally: () => true,
    reportDevicesToDirectory: async () => {},
    validateCurrentDeviceSyncAccess: async () => {
        fixture.accessChecks++;
        if (fixture.accessGate) { const gate = fixture.accessGate; fixture.accessGate = null; await gate.promise; }
        if (fixture.unavailableAttempts > 0) {
            fixture.unavailableAttempts--;
            return { ok: false, error: 'Failed to fetch' };
        }
        if (!fixture.authorized) return { ok: false, error: 'membership revoked' };
        return { ok: true, context: { userId: 'owner', deviceIds: ['device', 'other-device'], ownDeviceId: 'device' } };
    },
}));
vi.mock('../src/services/cloudPullService', () => ({
    cloudPullScope: () => 'scope', hasPendingCloudKey: async () => false,
    getCloudPullStatus: () => null, publishCloudPullStatus: vi.fn(),
    fetchCloudPullPage: async () => [], retainCloudPullFailure: vi.fn(), resolveCloudPullFailure: vi.fn(),
    runCloudPull: async options => {
        for (const row of fixture.rows.splice(0)) await options.apply(row);
        return { applied: 0, pending: 0, queryFailed: false, status: 'confirmed' };
    },
}));
import { useCloudSync, isCloudSyncActiveNow, pushCloudSync, queueCloudSync, syncNow } from '../src/hooks/useCloudSync';
import { setNegocioActivoId, setKnownBusinessIds } from '../src/utils/negocioContext';

let root, container;
function Harness() { useCloudSync('device'); return null; }
const waitFor = async check => {
    for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); }
    throw new Error('fixture did not settle');
};
beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear(); localStorage.setItem('pda_device_id', 'device');
    setNegocioActivoId('neg-a'); setKnownBusinessIds(['neg-a', 'neg-b']);
    fixture.data.clear(); fixture.writes.length = 0; fixture.rows.length = 0;
    fixture.accessGate = fixture.writeGate = fixture.readGate = null;
    fixture.errors = 0; fixture.authorized = true; fixture.unavailableAttempts = 0; fixture.accessChecks = 0;
    fixture.users = [{ id: 'user-a', nombre: 'A', rol: 'ADMIN' }];
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => { root.render(createElement(Harness)); });
    await waitFor(isCloudSyncActiveNow);
    // Wait for the initial serialized cycle, not just the active flag.
    await syncNow(); fixture.writes.length = 0;
});
afterEach(async () => {
    fixture.accessGate?.resolve(); fixture.writeGate?.resolve(); fixture.readGate?.resolve();
    await act(async () => { root.unmount(); }); container.remove();
    setNegocioActivoId(null); vi.useRealTimers();
});

describe('cloud sync concurrency invariants', () => {
    it('retries a paused membership check on browser online and only resumes push after authorization succeeds', async () => {
        await act(async () => { root.unmount(); });
        root = createRoot(container);
        fixture.unavailableAttempts = 1;
        const checksBeforeRemount = fixture.accessChecks;
        await act(async () => root.render(createElement(Harness)));
        await waitFor(() => fixture.accessChecks > checksBeforeRemount && fixture.unavailableAttempts === 0);
        expect(isCloudSyncActiveNow()).toBe(false);

        const before = fixture.writes.length;
        const blocked = pushCloudSync('bodega_payment_methods_v1', ['blocked-before-auth']);
        await expect(blocked).resolves.toMatchObject({ ok: false });
        expect(fixture.writes).toHaveLength(before);

        const checksBeforeOnline = fixture.accessChecks;
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => fixture.accessChecks > checksBeforeOnline);
        expect(fixture.writes).toHaveLength(before);
        const resumed = await pushCloudSync('bodega_payment_methods_v1', ['after-auth']);
        expect(resumed.ok).toBe(true);
        expect(fixture.writes).toHaveLength(before + 1);
        expect(fixture.writes.at(-1).data.payload).toEqual(['after-auth']);
    });

    it('captures the business before authorization awaits', async () => {
        const gate = deferred(); fixture.accessGate = gate;
        const write = pushCloudSync('bodega_payment_methods_v1', ['from-a']);
        await waitFor(() => fixture.accessGate === null);
        setNegocioActivoId('neg-b'); gate.resolve();
        expect((await write).ok).toBe(true);
        expect(fixture.writes.map(row => row.doc_id)).toEqual(['nb_neg-a:bodega_payment_methods_v1']);
    });
    it('keeps debounce slots separate for the same key in two businesses', async () => {
        vi.useFakeTimers();
        queueCloudSync('bodega_payment_methods_v1', ['from-a']);
        setNegocioActivoId('neg-b');
        queueCloudSync('bodega_payment_methods_v1', ['from-b']);
        await vi.advanceTimersByTimeAsync(350);
        expect(fixture.writes.map(row => [row.doc_id, row.data.payload])).toEqual([
            ['nb_neg-a:bodega_payment_methods_v1', ['from-a']], ['nb_neg-b:bodega_payment_methods_v1', ['from-b']],
        ]);
    });
    it('does not send the newer revision before the older request has settled', async () => {
        const gate = deferred(); fixture.writeGate = gate;
        const first = pushCloudSync('bodega_payment_methods_v1', ['old']);
        await waitFor(() => fixture.writes.length === 1);
        const second = pushCloudSync('bodega_payment_methods_v1', ['new']);
        await new Promise(r => setTimeout(r, 30));
        const inFlight = fixture.writes.length;
        gate.resolve(); await Promise.all([first, second]);
        expect(inFlight).toBe(1);
        expect(fixture.writes.map(row => row.data.payload)).toEqual([['old'], ['new']]);
    });
    it('freezes the payload at invocation, including nested items', async () => {
        const gate = deferred(); fixture.accessGate = gate;
        const value = [{ id: 'p1', nested: { price: 3 } }];
        const write = pushCloudSync('bodega_payment_methods_v1', value);
        await waitFor(() => fixture.accessGate === null);
        value[0].nested.price = 999; value.push({ id: 'later' }); gate.resolve(); await write;
        expect(fixture.writes[0].data.payload).toEqual([{ id: 'p1', nested: { price: 3 } }]);
    });
    it('retries the old revision before sending the newer revision', async () => {
        const gate = deferred(); fixture.writeGate = gate; fixture.errors = 1;
        const old = pushCloudSync('bodega_payment_methods_v1', ['old']);
        await waitFor(() => fixture.writes.length === 1);
        const next = pushCloudSync('bodega_payment_methods_v1', ['new']);
        setNegocioActivoId('neg-b'); gate.resolve();
        expect((await old).ok).toBe(true); expect((await next).ok).toBe(true);
        expect(fixture.writes.map(row => row.data.payload)).toEqual([['old'], ['old'], ['new']]);
        expect(fixture.writes.every(row => row.doc_id === 'nb_neg-a:bodega_payment_methods_v1')).toBe(true);
    });
    it('does not ACK a response after installation identity changed', async () => {
        const gate = deferred(); fixture.writeGate = gate;
        const write = pushCloudSync('bodega_payment_methods_v1', ['old']);
        await waitFor(() => fixture.writes.length === 1);
        localStorage.setItem('pda_device_id', 'another-device'); gate.resolve();
        expect((await write).ok).toBe(false);
        expect(fixture.writes).toHaveLength(1);
        expect(localStorage.getItem('bodega_last_confirmed_push_hash_nb_neg-a:bodega_payment_methods_v1')).toBeNull();
    });
    it('revocation after waiting in the queue fails closed', async () => {
        const gate = deferred(); fixture.writeGate = gate;
        const old = pushCloudSync('bodega_payment_methods_v1', ['old']);
        await waitFor(() => fixture.writes.length === 1);
        const next = pushCloudSync('bodega_payment_methods_v1', ['new']);
        fixture.authorized = false; gate.resolve(); await old;
        expect((await next).ok).toBe(false);
        expect(fixture.writes).toHaveLength(1);
    });
    it('pins a remote sales read and write to its physical business during an await', async () => {
        fixture.data.set('nb_neg-a:bodega_sales_v1', [{ id: 'local-a' }]);
        fixture.data.set('nb_neg-b:bodega_sales_v1', [{ id: 'local-b' }]);
        fixture.rows.push({ device_id: 'other', collection: 'store', doc_id: 'nb_neg-a:bodega_sales_delta_2026-10-08',
            data: { schemaVersion: 1, updatedAt: '2026-10-08T10:00:00Z', payload: { date: '2026-10-08', tickets: [{ id: 'remote-a' }] } } });
        const gate = deferred(); fixture.readGate = gate;
        const cycle = syncNow();
        await waitFor(() => fixture.readGate === null);
        setNegocioActivoId('neg-b'); gate.resolve(); await cycle;
        expect(fixture.data.get('nb_neg-a:bodega_sales_v1').map(s => s.id)).toEqual(['local-a', 'remote-a']);
        expect(fixture.data.get('nb_neg-b:bodega_sales_v1')).toEqual([{ id: 'local-b' }]);
    });
    it('keeps stock and catalog in the same captured business', async () => {
        const gate = deferred(); fixture.accessGate = gate;
        const write = pushCloudSync('bodega_products_v1', [{ id: 'p', stock: 9, name: 'from-a' }]);
        await waitFor(() => fixture.accessGate === null); setNegocioActivoId('neg-b'); gate.resolve();
        expect((await write).ok).toBe(true);
        expect(fixture.writes.map(row => row.doc_id)).toEqual(['nb_neg-a:bodega_stock_v1', 'nb_neg-a:bodega_products_v1']);
    });
    it('does not apply another business user catalog to the active auth store', async () => {
        fixture.rows.push({ device_id: 'other', collection: 'store', doc_id: 'nb_neg-b:bodega_users_catalog_v1',
            data: { schemaVersion: 1, updatedAt: '2026-10-08T10:00:00Z', payload: { v: 1, users: [{ id: 'user-b', nombre: 'B', rol: 'ADMIN' }] } } });
        expect((await syncNow()).ok).toBe(false);
        expect(fixture.users).toEqual([{ id: 'user-a', nombre: 'A', rol: 'ADMIN' }]);
    });
    it('keeps the Bodega and Cosméticos stock namespaces isolated during a cross-business pull', async () => {
        setKnownBusinessIds(['neg-1', 'neg-fac22061']);
        fixture.data.set('nb_neg-1:bodega_products_v1', [{ id: 'bodega-product', stock: 4 }]);
        fixture.data.set('nb_neg-fac22061:bodega_products_v1', [{ id: 'cosmetics-product', stock: 12 }]);
        fixture.data.set('nb_neg-1:bodega_sales_v1', [{ id: 'bodega-old-sale' }]);
        fixture.data.set('nb_neg-fac22061:bodega_sales_v1', [{ id: 'cosmetics-stable-sale' }]);
        fixture.data.set('nb_neg-1:bodega_customers_v1', []);
        fixture.data.set('nb_neg-1:bodega_customer_ledger_v1', []);
        fixture.data.set('nb_neg-1:bodega_accounts_v2', []);
        setNegocioActivoId('neg-fac22061');
        fixture.rows.push(
            { device_id: 'other-device', collection: 'store', doc_id: 'nb_neg-1:bodega_stock_v1',
                data: { schemaVersion: 1, updatedAt: '2026-10-08T11:00:00Z', payload: { 'bodega-product': 3 } } },
            { device_id: 'other-device', collection: 'store', doc_id: 'nb_neg-1:bodega_sales_delta_2026-10-08',
                data: { schemaVersion: 1, updatedAt: '2026-10-08T11:01:00Z', payload: { date: '2026-10-08', tickets: [{ id: 'bodega-new-sale', timestamp: '2026-10-08T11:00:00Z' }] } } },
        );

        const result = await syncNow();

        expect(result.ok).toBe(true);
        // Primera vista de other-device: solo se siembra el último visto, no se asigna
        // su stock. El mapa publicado es stock propio de la fuente, así que asignarlo
        // pisaría el stock local (ver applyStockMapDelta). El stock local se conserva.
        expect(fixture.data.get('nb_neg-1:bodega_products_v1')).toEqual([{ id: 'bodega-product', stock: 4 }]);
        expect(fixture.data.get('nb_neg-1:bodega_sales_v1').map(sale => sale.id).sort()).toEqual(['bodega-new-sale', 'bodega-old-sale']);
        expect(fixture.data.get('nb_neg-fac22061:bodega_products_v1')).toEqual([{ id: 'cosmetics-product', stock: 12 }]);
        expect(fixture.data.get('nb_neg-fac22061:bodega_sales_v1')).toEqual([{ id: 'cosmetics-stable-sale' }]);
        expect(fixture.writes.every(row => row.doc_id.startsWith('nb_neg-fac22061:'))).toBe(true);
    });
});
