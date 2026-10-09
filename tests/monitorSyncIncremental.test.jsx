import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
    docs: [],
    deviceIds: ['dev-a'],
    pulls: [],
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: () => {
            const pull = { gte: null };
            fixture.pulls.push(pull);
            const query = {
                select: () => query,
                in: () => query,
                gte: (column, value) => {
                    if (column === 'updated_at') pull.gte = value;
                    return query;
                },
                then: (resolve) => Promise.resolve({ data: fixture.docs, error: null }).then(resolve),
            };
            return query;
        },
        channel: () => {
            const channel = {
                on: () => channel,
                subscribe: (cb) => {
                    Promise.resolve().then(() => cb?.('SUBSCRIBED'));
                    return channel;
                },
            };
            return channel;
        },
        removeChannel: async () => 'ok',
    },
}));
vi.mock('localforage', () => ({
    default: {
        config: vi.fn(),
        getItem: async () => null,
        setItem: async (_key, value) => value,
    },
}));
vi.mock('../src/utils/syncFlags', () => ({ runWithoutEco: async (fn) => fn() }));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: async () => ({ session: { user: { id: 'owner' } }, error: null }),
}));
vi.mock('../src/services/cloudAccount', () => ({
    getAccountSyncContext: async () => ({ deviceIds: fixture.deviceIds }),
}));

import { useMonitorSync } from '../src/hooks/useMonitorSync';

let root;
let container;
let hook;

function Harness() {
    const res = useMonitorSync('dev-a');
    useEffect(() => {
        hook = res;
    });
    return null;
}

// Espera a que termine el pull (microtareas + timers) dentro de act.
const settle = async () => {
    for (let i = 0; i < 5; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
};

// Documento legacy sin prefijo de negocio: se rechaza sin efectos secundarios.
const doc = (updated_at) => ({
    collection: 'store',
    doc_id: 'legacy-key',
    data: {},
    updated_at,
    device_id: 'dev-a',
});

describe('useMonitorSync pull incremental', () => {
    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        fixture.docs = [];
        fixture.deviceIds = ['dev-a'];
        fixture.pulls = [];
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('primer pull completo; refresh posterior consulta desde el cursor con solape de 5 min', async () => {
        fixture.docs = [doc('2026-10-09T10:00:00.000Z')];
        await act(async () => { root.render(createElement(Harness)); });
        await settle();
        expect(fixture.pulls[0].gte).toBeNull();

        await act(async () => { await hook.triggerRefresh(); });
        await settle();
        expect(fixture.pulls[1].gte).toBe('2026-10-09T09:55:00.000Z');
    });

    it('sin documentos nuevos el cursor no retrocede ni se pierde', async () => {
        fixture.docs = [doc('2026-10-09T10:00:00.000Z')];
        await act(async () => { root.render(createElement(Harness)); });
        await settle();

        fixture.docs = [];
        await act(async () => { await hook.triggerRefresh(); });
        await settle();
        await act(async () => { await hook.triggerRefresh(); });
        await settle();
        expect(fixture.pulls[1].gte).toBe('2026-10-09T09:55:00.000Z');
        expect(fixture.pulls[2].gte).toBe('2026-10-09T09:55:00.000Z');
    });

    it('si cambia el conjunto de equipos vuelve a descargar todo', async () => {
        fixture.docs = [doc('2026-10-09T10:00:00.000Z')];
        await act(async () => { root.render(createElement(Harness)); });
        await settle();

        fixture.deviceIds = ['dev-a', 'dev-b'];
        await act(async () => { await hook.triggerRefresh(); });
        await settle();
        expect(fixture.pulls[1].gte).toBeNull();
    });
});
