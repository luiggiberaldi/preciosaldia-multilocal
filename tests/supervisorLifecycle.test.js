import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scanner = readFileSync('src/components/PairingScanScreen.jsx', 'utf8');
const monitorSync = readFileSync('src/hooks/useMonitorSync.js', 'utf8');
const ownerMonitor = readFileSync('src/views/OwnerMonitorView.jsx', 'utf8');
// NOTA 2026-10-01 (Fase 0): PairingManager.jsx fue eliminado a propósito en
// 2987dd4 ("quitar 'Celular del Supervisor' de Ajustes; era flujo del Lite").
// El test que cubría su polling se retiró con el flujo; no se revive.

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

    it('bloquea acciones remotas cuando el monitor está desconectado', () => {
        expect(ownerMonitor).toContain('remoteActionsAvailable');
        expect(ownerMonitor).toContain('La caja está desconectada');
    });
});
