/**
 * duenoAuth.test.js — Tests del PIN maestro global del dueño (Fase 1.5).
 *
 * Cubren: setup inicial, creación/verificación del PIN, bloqueo por intentos
 * fallidos, y la sesión global (forma válida, persistencia, limpieza).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    DUENO_PIN_KEY,
    DUENO_SESSION_KEY,
    DUENO_LOCK_KEY,
    isMasterPinSetup,
    setMasterPin,
    verifyMasterPin,
    getDuenoSession,
    setDuenoSession,
    clearDuenoSession,
} from '../src/utils/duenoAuth';
import { isGlobalKey, routeStorageKey, setNegocioActivoId } from '../src/utils/negocioContext';

beforeEach(() => {
    localStorage.clear();
    setNegocioActivoId(null);
});

describe('claves globales del dueño', () => {
    it('las 3 claves son globales y el router no las namespacing', () => {
        setNegocioActivoId('neg-x1');
        for (const key of [DUENO_PIN_KEY, DUENO_SESSION_KEY, DUENO_LOCK_KEY]) {
            expect(isGlobalKey(key)).toBe(true);
            expect(routeStorageKey(key)).toBe(key);
        }
    });
});

describe('isMasterPinSetup / setMasterPin', () => {
    it('empieza sin PIN maestro', () => {
        expect(isMasterPinSetup()).toBe(false);
    });

    it('crea el PIN maestro y queda configurado', async () => {
        const res = await setMasterPin('246810');
        expect(res.ok).toBe(true);
        expect(isMasterPinSetup()).toBe(true);
        expect(localStorage.getItem(DUENO_PIN_KEY)).toMatch(/^pbkdf2\$/);
    });

    it('rechaza PINs de 4 dígitos y acepta PINs de 6', async () => {
        const shortPin = await setMasterPin('1234');
        expect(shortPin.ok).toBe(false);
        expect(shortPin.error).toMatch(/6 dígitos/);
        expect(isMasterPinSetup()).toBe(false);

        const validPin = await setMasterPin('246810');
        expect(validPin.ok).toBe(true);
        expect(isMasterPinSetup()).toBe(true);
    });

    it('rechaza PINs inválidos (muy corto)', async () => {
        const res = await setMasterPin('123');
        expect(res.ok).toBe(false);
        expect(res.error).toBeTruthy();
        expect(isMasterPinSetup()).toBe(false);
    });
});

describe('verifyMasterPin', () => {
    it('rechaza un PIN maestro de 4 dígitos aunque coincida con el hash', async () => {
        await setMasterPin('135724');
        const res = await verifyMasterPin('1357');
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/PIN incorrecto/);
    });

    it('acepta el PIN correcto', async () => {
        await setMasterPin('135724');
        const res = await verifyMasterPin('135724');
        expect(res.ok).toBe(true);
    });

    it('rechaza el PIN incorrecto', async () => {
        await setMasterPin('135724');
        const res = await verifyMasterPin('000000');
        expect(res.ok).toBe(false);
        expect(res.error).toBeTruthy();
    });

    it('bloquea tras MAX_ATTEMPTS intentos fallidos y libera tras el lock', async () => {
        await setMasterPin('135724');
        let last = null;
        for (let i = 0; i < 5; i++) {
            last = await verifyMasterPin('000000');
        }
        expect(last.ok).toBe(false);
        expect(last.locked).toBe(true);
        // Aun con el PIN correcto, sigue bloqueado.
        const stillLocked = await verifyMasterPin('135724');
        expect(stillLocked.ok).toBe(false);
        expect(stillLocked.locked).toBe(true);
    });

    it('un intento correcto limpia los intentos fallidos acumulados', async () => {
        await setMasterPin('135724');
        await verifyMasterPin('000000');
        await verifyMasterPin('000000');
        const ok = await verifyMasterPin('135724');
        expect(ok.ok).toBe(true);
        expect(localStorage.getItem(DUENO_LOCK_KEY)).toBeNull();
    });
});

describe('sesión global del dueño', () => {
    it('no hay sesión al inicio', () => {
        expect(getDuenoSession()).toBeNull();
    });

    it('set/get devuelven la forma canónica del dueño', () => {
        setDuenoSession();
        const s = getDuenoSession();
        expect(s).toMatchObject({ id: 'dueno', nombre: 'Dueño', rol: 'DUENO', global: true });
    });

    it('clear elimina la sesión', () => {
        setDuenoSession();
        clearDuenoSession();
        expect(getDuenoSession()).toBeNull();
    });

    it('ignora sesiones corruptas o con forma inválida', () => {
        localStorage.setItem(DUENO_SESSION_KEY, '{"id":1,"rol":"ADMIN"}');
        expect(getDuenoSession()).toBeNull();
        localStorage.setItem(DUENO_SESSION_KEY, 'no-json');
        expect(getDuenoSession()).toBeNull();
    });
});
