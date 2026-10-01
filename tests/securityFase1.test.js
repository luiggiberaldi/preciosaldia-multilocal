import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Fase 1 (2026-10-01) — guardrails de seguridad. Si alguno falla, se reabrió
// una vía de toma de control de la app.

const emergencyModal = readFileSync('src/components/security/EmergencyPinResetModal.jsx', 'utf8');
const usersManager = readFileSync('src/components/Settings/UsersManager.jsx', 'utf8');
const authStore = readFileSync('src/hooks/store/useAuthStore.js', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');

describe('Fase 1: sin claves hardcodeadas', () => {
    it('CRÍTICO-1: no existe clave de fábrica en el código', () => {
        expect(emergencyModal).not.toContain('24457713');
        expect(authStore).not.toContain('24457713');
        expect(usersManager).not.toContain('24457713');
    });

    it('CRÍTICO-1: sin clave personalizada el flujo queda deshabilitado', () => {
        expect(emergencyModal).toContain('isDisabled');
        expect(emergencyModal).toContain('deshabilitada');
    });

    it('CRÍTICO-1: los intentos de emergencia tienen rate-limit', () => {
        expect(emergencyModal).toContain('LOGIN_RATE_LIMIT');
        expect(emergencyModal).toContain('pda_emergency_rl');
    });
});

describe('Fase 1: el flujo de emergencia no toca al dueño', () => {
    it('CRÍTICO-5: el modal excluye al dueño de la lista', () => {
        expect(emergencyModal).toContain("filter(u => u.id !== 'dueno')");
    });

    it('CRÍTICO-5: el store rechaza reset del PIN maestro por emergencia', () => {
        expect(authStore).toContain("if (userId === 'dueno')");
        expect(authStore).toContain('PIN_MAESTRO_RESET_BLOQUEADO');
    });

    it('CRÍTICO-5: configurar la clave exige sesión de dueño + PIN maestro', () => {
        expect(usersManager).toContain('getDuenoSession()');
        expect(usersManager).toContain('isDuenoSession');
        expect(usersManager).toContain('verifyMasterPin(masterPinCheck)');
    });
});

describe('Fase 1: usuarios iniciales seguros', () => {
    it('ALTO-2: PINs iniciales aleatorios y con PIN obligatorio', () => {
        expect(authStore).toContain('_generateRandomPin()');
        expect(authStore).not.toContain("const adminPin = '000000'");
        expect(authStore).toContain("requirePin: true");
    });

    it('ALTO-2: los PINs iniciales se muestran una sola vez', () => {
        expect(app).toContain('InitialPinsModal');
        expect(app).toContain('pda_initial_pins_shown');
        expect(app).toContain('initial-pins-ready');
    });

    it('M-2: unlock() del dueño usa result.ok (verifyMasterPin retorna {ok})', () => {
        // El sitio exacto: `const result = await verifyMasterPin(...)` en unlock().
        const idx = authStore.indexOf('const result = await verifyMasterPin');
        expect(idx).toBeGreaterThan(-1);
        const sitio = authStore.slice(idx, idx + 200);
        expect(sitio).toContain('if (result.ok)');
        expect(sitio).not.toContain('if (result.valid)');
    });

    it('M-24: cambiarPin y agregarUsuario son async reales', () => {
        expect(authStore).toContain('cambiarPin: async (userId, nuevoPin)');
        expect(authStore).toContain('agregarUsuario: async (nombre, rol, pin)');
    });
});
