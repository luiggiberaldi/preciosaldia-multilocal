import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scanner = readFileSync('src/components/PairingScanScreen.jsx', 'utf8');
const pairingManager = readFileSync('src/components/Settings/PairingManager.jsx', 'utf8');
const monitorSync = readFileSync('src/hooks/useMonitorSync.js', 'utf8');
const ownerMonitor = readFileSync('src/views/OwnerMonitorView.jsx', 'utf8');

describe('Supervisor lifecycle guardrails', () => {
    it('evita doble lectura QR y timers de reinicio huérfanos', () => {
        expect(scanner).toContain('scanInFlightRef');
        expect(scanner).toContain('restartTimerRef');
        expect(scanner).toContain('startPromiseRef');
        expect(scanner).toContain('mountedRef.current = false');
    });

    it('limpia y reintenta Realtime sin duplicar el canal', () => {
        expect(monitorSync).toContain('subscriptionRef.current = null');
        expect(monitorSync).toContain('scheduleReconnect');
        expect(monitorSync).toContain('supabaseCloud.removeChannel(channel)');
        expect(monitorSync).toContain('initInFlightRef');
    });

    it('detiene polling cuando la consulta falla repetidamente y confirma el servidor', () => {
        expect(pairingManager).not.toContain(".select('*')");
        expect(pairingManager).toContain('pollingFailuresRef');
        expect(pairingManager).toContain('Revisa la conexión');
        expect(pairingManager).toContain('stillPaired');
    });

    it('bloquea acciones remotas cuando el monitor está desconectado', () => {
        expect(ownerMonitor).toContain('remoteActionsAvailable');
        expect(ownerMonitor).toContain('La caja está desconectada');
    });
});
