import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    PAIRING_STATES,
    canMonitorRead,
    canTransitionPairing,
} from '../src/services/supervisorContracts';

const pairingScreen = readFileSync('src/components/PairingScanScreen.jsx', 'utf8');

describe('Supervisor pairing contract', () => {
    it('solo permite lectura remota cuando el pairing está paired', () => {
        expect(canMonitorRead(PAIRING_STATES.PENDING)).toBe(false);
        expect(canMonitorRead(PAIRING_STATES.EXPIRED)).toBe(false);
        expect(canMonitorRead(PAIRING_STATES.REVOKED)).toBe(false);
        expect(canMonitorRead(PAIRING_STATES.PAIRED)).toBe(true);
    });

    it('permite completar o revocar un pairing pendiente', () => {
        expect(canTransitionPairing(PAIRING_STATES.PENDING, PAIRING_STATES.PAIRED)).toBe(true);
        expect(canTransitionPairing(PAIRING_STATES.PENDING, PAIRING_STATES.REVOKED)).toBe(true);
        expect(canTransitionPairing(PAIRING_STATES.PENDING, PAIRING_STATES.PENDING)).toBe(true);
    });

    it('no permite reactivar directamente un pairing ya vinculado', () => {
        expect(canTransitionPairing(PAIRING_STATES.PAIRED, PAIRING_STATES.PENDING)).toBe(false);
        expect(canTransitionPairing(PAIRING_STATES.PAIRED, PAIRING_STATES.EXPIRED)).toBe(false);
    });

    it('usa la longitud del token nuevo también para habilitar el botón manual', () => {
        expect(pairingScreen).toContain('const PAIRING_TOKEN_LENGTH = 24;');
        expect(pairingScreen).toContain('disabled={loading || manualCode.length !== PAIRING_TOKEN_LENGTH}');
        expect(pairingScreen).not.toContain('disabled={loading || manualCode.length !== 6}');
    });
});
