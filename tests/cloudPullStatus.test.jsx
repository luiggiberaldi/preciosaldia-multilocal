import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { retry, read, state } = vi.hoisted(() => ({ retry: vi.fn(), read: vi.fn(), state: { current: null } }));
vi.mock('../src/hooks/useCloudSync', () => ({
    getLastSyncPushError: () => null, SYNC_PUSH_ERROR_EVENT: 'push-error', syncNow: retry,
}));
vi.mock('../src/services/cloudPullService', () => ({
    getCloudPullStatus: read, CLOUD_PULL_STATUS_EVENT: 'pda_cloud_pull_status',
}));
import SyncStatus from '../src/components/SyncStatus';
let root, container;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    state.current = { status: 'partial', applied: 41, pending: 3, lastConfirmedAt: null };
    read.mockImplementation(() => state.current);
    retry.mockReset();
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('muestra conteos en móvil y reintento no borra pendientes ni oculta resultado parcial', async () => {
    retry.mockResolvedValue({ ok: false, partial: true, message: 'Sync parcial: tres pendientes' });
    await act(async () => root.render(React.createElement(SyncStatus)));
    const button = container.querySelector('button[aria-label]');
    expect(button.textContent).toContain('41 aplicados / 3 pendientes');
    await act(async () => button.click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button[aria-label]').textContent).toContain('3 pendientes');
    expect(container.querySelector('[role="status"]').textContent).toContain('Sync parcial');
});
it('panel de causas muestra conteo por causa y su reintento no borra nada', async () => {
    state.current = { status: 'partial', applied: 4, pending: 3, pendingByReason: { 'unknown-business': 2, 'invalid-registry': 1 } };
    retry.mockResolvedValue({ ok: false, partial: true, message: 'Sync parcial: tres pendientes' });
    await act(async () => root.render(React.createElement(SyncStatus)));
    expect(container.textContent).not.toContain('Sede no conocida en este equipo');
    await act(async () => container.querySelector('button[aria-expanded]').click());
    expect(container.textContent).toContain('Sede no conocida en este equipo');
    expect(container.textContent).toContain('Registro de sedes inválido');
    expect(container.textContent).toContain('Se conservan; no se borra nada.');
    const panelButton = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Reintentar ahora'));
    await act(async () => panelButton.click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button[aria-label]').textContent).toContain('3 pendientes');
});
it('confirmación real retira estado parcial mediante evento y conserva el mensaje', async () => {
    retry.mockImplementation(async () => { state.current = { status: 'confirmed', pending: 0 }; return { ok: true, message: 'Sincronizado correctamente' }; });
    await act(async () => root.render(React.createElement(SyncStatus)));
    await act(async () => container.querySelector('button[aria-label]').click());
    expect(container.querySelector('button[aria-label]')).toBeNull();
    expect(container.textContent).toContain('Sincronizado correctamente');
});
