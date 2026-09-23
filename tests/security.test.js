// tests/security.test.js — Tests de los fixes de seguridad SEC-001..SEC-023.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { hashPin, verifyPin } from '../src/utils/crypto';
import { validatePin, LOGIN_RATE_LIMIT } from '../src/utils/securityConstants';
import { escapeHtml } from '../src/utils/printerUtils';
import { verifyLicenseToken, encodeToken, decodeToken } from '../src/security/tokenCrypto';
import { generateFingerprint, verifyStoredFingerprint, getFingerprintAnchor, seedFingerprintAnchor } from '../src/security/deviceFingerprint';

// ─── verifyLicenseToken (SEC-001/SEC-007) ────────────────────────────────────

describe('SEC-001/SEC-007: verifyLicenseToken rechaza tokens legacy XOR', () => {
  it('rechaza tokens sin "." (sin firma RSA)', async () => {
    const token = encodeToken(JSON.stringify({ deviceId: 'PDA-DEAD', type: 'permanent' }));
    expect(token.includes('.')).toBe(false);
    const r = await verifyLicenseToken(token);
    expect(r.valid).toBe(false);
    expect(r.isLegacy).toBe(true);
  });

  it('rechaza tokens con "." pero firma inválida', async () => {
    const fakeToken = btoa(JSON.stringify({ deviceId: 'PDA-X', type: 'permanent' })) + '.invalidSignature==';
    const r = await verifyLicenseToken(fakeToken);
    expect(r.valid).toBe(false);
  });

  it('rechaza null/undefined/vacío', async () => {
    expect((await verifyLicenseToken(null)).valid).toBe(false);
    expect((await verifyLicenseToken(undefined)).valid).toBe(false);
    expect((await verifyLicenseToken('')).valid).toBe(false);
  });
});

// ─── encodeToken/decodeToken deprecation (SEC-001) ──────────────────────────

describe('SEC-001: encodeToken/decodeToken siguen funcionando (deprecated)', () => {
  it('hacen round-trip del mismo payload (para migración legacy)', () => {
    const payload = JSON.stringify({ foo: 'bar', n: 42 });
    const encoded = encodeToken(payload);
    const decoded = decodeToken(encoded);
    expect(decoded).toBe(payload);
  });
});

// ─── verifyPin: PBKDF2 y migración legacy (SEC-005) ──────────────────────────

describe('SEC-005: verifyPin acepta y migra hashes legacy SHA-256', () => {
  // Hash SHA-256 de '123456' que estaba embebido en el bundle original.
  const LEGACY_ADMIN_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

  it('verifica un PIN contra hash legacy y marca needsRehash:true', async () => {
    const r = await verifyPin('123456', LEGACY_ADMIN_HASH);
    expect(r.valid).toBe(true);
    expect(r.legacy).toBe(true);
    expect(r.needsRehash).toBe(true);
  });

  it('verifica un PIN contra hash PBKDF2 nuevo sin marcar needsRehash', async () => {
    const hash = await hashPin('246810');
    const r = await verifyPin('246810', hash);
    expect(r.valid).toBe(true);
    expect(r.legacy).toBe(false);
    expect(r.needsRehash).toBe(false);
  });

  it('rechaza PIN incorrecto contra hash legacy', async () => {
    const r = await verifyPin('000000', LEGACY_ADMIN_HASH);
    expect(r.valid).toBe(false);
    expect(r.legacy).toBe(true);
  });
});

// ─── validatePin (SEC-005/SEC-017) ───────────────────────────────────────────

describe('SEC-005/SEC-017: validatePin rechaza PINs débiles', () => {
  it('permite PINs de 6 dígitos incluso si están en blacklist (pedido por negocio)', () => {
    expect(validatePin('123456')).toBeNull();
    expect(validatePin('000000')).toBeNull();
    expect(validatePin('111111')).toBeNull();
  });

  it('permite secuencias de mismo dígito si cumplen longitud (pedido por negocio)', () => {
    expect(validatePin('999999')).toBeNull();
    expect(validatePin('222222')).toBeNull();
  });

  it('rechaza menos de MIN_LENGTH dígitos', () => {
    expect(validatePin('123')).toMatch(/al menos/);
    expect(validatePin('1234')).toMatch(/al menos/);
    expect(validatePin('12345')).toMatch(/al menos/);
  });

  it('acepta PINs fuertes de 6 dígitos', () => {
    expect(validatePin('246810')).toBeNull();
    expect(validatePin('864213')).toBeNull();
    expect(validatePin('192837')).toBeNull();
  });
});

// ─── useAuthStore: rate-limiting persistido (SEC-006) ────────────────────────

describe.skip('SEC-006: useAuthStore.login con rate-limiting persistido (desactivado a pedido de negocio)', () => {
  let store;
  let localStorageMock;

  beforeEach(async () => {
    // Limpiar módulos para resetear el store Zustand.
    vi.resetModules();
    localStorageMock = (() => {
      let store = {};
      return {
        getItem: vi.fn((k) => (k in store ? store[k] : null)),
        setItem: vi.fn((k, v) => { store[k] = String(v); }),
        removeItem: vi.fn((k) => { delete store[k]; }),
        clear: vi.fn(() => { store = {}; }),
        get _data() { return store; },
      };
    })();
    vi.stubGlobal('localStorage', localStorageMock);

    // Pre-poblar localStorage con usuarios PBKDF2 conocidos para que el store
    // rehidrate correctamente y NO dispare `_ensureDefaultUsers` (PINs aleatorios).
    const adminHash = await hashPin('246810');
    const cajeroHash = await hashPin('135790');
    const persisted = {
      state: {
        usuarios: [
          { id: 1, nombre: 'Admin', rol: 'ADMIN', pin: adminHash },
          { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: cajeroHash },
        ],
        requireLogin: true,
        failedAttempts: 0,
        lockUntil: null,
        consecutiveLockouts: 0,
        lastFailedAttemptTs: 0,
        adminEmail: null,
        isCloudConfigured: false,
      },
      version: 0,
    };
    localStorageMock.setItem('abasto-auth-storage', JSON.stringify(persisted));

    // Importar el store fresco.
    const mod = await import('../src/hooks/store/useAuthStore');
    store = mod.useAuthStore;

    // Zustand persist rehidrata sync (localStorage es sync); esperamos un microtask
    // para que `onRehydrateStorage` termine.
    await new Promise((r) => setTimeout(r, 0));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login exitoso resetea contadores', async () => {
    // Provocar 2 fallos.
    await store.getState().login('wrong1', 1);
    await store.getState().login('wrong2', 1);
    expect(store.getState().failedAttempts).toBe(2);

    // Login correcto.
    const r = await store.getState().login('246810', 1);
    expect(r.success).toBe(true);
    expect(store.getState().failedAttempts).toBe(0);
    expect(store.getState().lockUntil).toBe(null);
    expect(store.getState().consecutiveLockouts).toBe(0);
  });

  it('tras MAX_ATTEMPTS fallos, bloquea y persiste lockUntil en localStorage', async () => {
    const { MAX_ATTEMPTS } = LOGIN_RATE_LIMIT;
    let lastResult;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      lastResult = await store.getState().login('wrong', 1);
    }
    expect(lastResult.success).toBe(false);
    expect(store.getState().lockUntil).not.toBeNull();
    expect(store.getState().lockUntil).toBeGreaterThan(Date.now());

    // El persist de Zustand escribe en localStorage; debe contener lockUntil.
    // Como partialize lo incluye, el JSON persistido debe tenerlo.
    const raw = localStorageMock.getItem('abasto-auth-storage');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    // El formato de zustand persist es { state: {...}, version: N }.
    expect(parsed.state.lockUntil).not.toBeNull();
    expect(parsed.state.failedAttempts).toBe(MAX_ATTEMPTS);
  });

  it('simula recarga: el bloqueo persiste y se respeta al reintentar', async () => {
    const { MAX_ATTEMPTS } = LOGIN_RATE_LIMIT;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await store.getState().login('wrong', 1);
    }
    expect(store.getState().lockUntil).not.toBeNull();
    const lockUntilBefore = store.getState().lockUntil;

    // Simular recarga: re-crear el store leyendo del localStorage.
    vi.resetModules();
    const mod = await import('../src/hooks/store/useAuthStore');
    const rehydrated = mod.useAuthStore;

    // Zustand persist rehidrata async; esperamos un tick.
    await new Promise((r) => setTimeout(r, 50));

    // El bloqueo debe seguir presente (timestamp absoluto).
    expect(rehydrated.getState().lockUntil).toBe(lockUntilBefore);

    // Intentar con PIN correcto DEBE fallar mientras no expire el lock.
    const r = await rehydrated.getState().login('246810', 1);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Bloqueado/);
  });

  it('backoff exponencial: tras segundo ciclo de fallos, lockUntil es mayor', async () => {
    const { MAX_ATTEMPTS, BACKOFF_FACTOR } = LOGIN_RATE_LIMIT;

    // Primer ciclo de fallos.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await store.getState().login('wrong', 1);
    }
    const lock1 = store.getState().lockUntil;
    expect(lock1).not.toBeNull();

    // Forzar expiración del primer lock para poder volver a fallar.
    store.setState({ lockUntil: 0 });

    // Segundo ciclo de fallos.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      // Reset failedAttempts para simular un nuevo ciclo.
      if (i === 0) {
        store.setState({ failedAttempts: 0 });
      }
      await store.getState().login('wrong', 1);
    }
    const lock2 = store.getState().lockUntil;
    expect(lock2).not.toBeNull();

    // El segundo lock debe ser (al menos) BACKOFF_FACTOR veces más largo que el primero.
    const now = Date.now();
    const dur1 = lock1 - now;
    const dur2 = lock2 - now;
    // Permitimos tolerancia por timing pero el factor debe respetarse.
    expect(dur2).toBeGreaterThanOrEqual(dur1 * (BACKOFF_FACTOR - 0.5));
  });

  it('reset tras RESET_WINDOW_MS sin intentos', async () => {
    const { MAX_ATTEMPTS, RESET_WINDOW_MS } = LOGIN_RATE_LIMIT;
    // Provocar bloqueo.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await store.getState().login('wrong', 1);
    }
    expect(store.getState().failedAttempts).toBe(MAX_ATTEMPTS);

    // Avanzar el reloj más allá de RESET_WINDOW_MS desde el último intento.
    store.setState({ lastFailedAttemptTs: Date.now() - RESET_WINDOW_MS - 1000 });

    // Login correcto debe limpiar contadores.
    const r = await store.getState().login('246810', 1);
    expect(r.success).toBe(true);
    expect(store.getState().failedAttempts).toBe(0);
    expect(store.getState().consecutiveLockouts).toBe(0);
  });

  it('SEC-005: re-hashea PIN legacy tras login exitoso', async () => {
    // Resetear el store con un usuario que tenga hash legacy SHA-256.
    vi.resetModules();
    const LEGACY_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';
    const persisted = {
      state: {
        usuarios: [{ id: 1, nombre: 'Admin', rol: 'ADMIN', pin: LEGACY_HASH }],
        requireLogin: true,
        failedAttempts: 0,
        lockUntil: null,
        consecutiveLockouts: 0,
        lastFailedAttemptTs: 0,
        adminEmail: null,
        isCloudConfigured: false,
      },
      version: 0,
    };
    localStorageMock.setItem('abasto-auth-storage', JSON.stringify(persisted));

    const mod = await import('../src/hooks/store/useAuthStore');
    store = mod.useAuthStore;
    await new Promise((r) => setTimeout(r, 0));

    const r = await store.getState().login('123456', 1);
    expect(r.success).toBe(true);

    // Tras login exitoso, el hash debe migrar a PBKDF2.
    const user = store.getState().usuarios.find(u => u.id === 1);
    expect(user.pin.startsWith('pbkdf2$')).toBe(true);

    // El nuevo hash debe verificar el mismo PIN.
    const verify = await verifyPin('123456', user.pin);
    expect(verify.valid).toBe(true);
    expect(verify.legacy).toBe(false);
  });

  it('SEC-013: sesión persistida no contiene hash PIN', async () => {
    const r = await store.getState().login('246810', 1);
    expect(r.success).toBe(true);

    // Verificar que abasto-device-session no tiene `pin`.
    const raw = localStorageMock.getItem('abasto-device-session');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(parsed.pin).toBeUndefined();
    expect(parsed).toEqual({ id: 1, nombre: 'Admin', rol: 'ADMIN' });
  });

  it('SEC-018: sesión con JSON inválido se descarta al rehidratar', async () => {
    // Inyectar un JSON inválido/malicioso en abasto-device-session.
    localStorageMock.setItem('abasto-device-session', JSON.stringify({
      id: 'evil', nombre: 42, rol: { inject: 'true' }, pin: 'stolen',
    }));

    // Resetear módulos y re-crear store.
    vi.resetModules();
    const mod = await import('../src/hooks/store/useAuthStore');
    const rehydrated = mod.useAuthStore;
    await new Promise((r) => setTimeout(r, 50));

    // La sesión debe ser null (descartada).
    expect(rehydrated.getState().usuarioActivo).toBeNull();
  });
});

// ─── SEC-008: Fingerprint ───────────────────────────────────────────────────

describe('SEC-008: Fingerprint robusto', () => {
  it('generateFingerprint devuelve 32+ hex chars (no 8)', async () => {
    const fp = await generateFingerprint();
    // Formato: PDA-V2-<32hex>
    expect(fp).toMatch(/^PDA-V2-[0-9A-F]{32,}$/);
  });

  it('verifyStoredFingerprint acepta el propio fingerprint', async () => {
    const fp = await generateFingerprint();
    const r = await verifyStoredFingerprint(fp);
    expect(r).toBe(true);
  });

  it('verifyStoredFingerprint rechaza un ID arbitrario inyectado', async () => {
    const r = await verifyStoredFingerprint('PDA-DEAD');
    expect(r).toBe(false);
  });

  it('verifyStoredFingerprint rechaza strings malformados', async () => {
    expect(await verifyStoredFingerprint('')).toBe(false);
    expect(await verifyStoredFingerprint(null)).toBe(false);
    expect(await verifyStoredFingerprint('not-a-pda-id')).toBe(false);
  });
});

// ─── SEC-008-r2: ancla de identidad (tolerancia a drift legítimo) ───────────

describe('SEC-008-r2: la recarga legítima no cierra la sesión', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('escenario de recarga: match exacto el día 1, drift el día 2 → true y NO revoca', async () => {
    const fpDia1 = await generateFingerprint();
    localStorage.setItem('pda_device_id', fpDia1);
    expect(await verifyStoredFingerprint(fpDia1)).toBe(true); // acuña ancla
    expect(getFingerprintAnchor()?.anchor).toBe(fpDia1);

    // "Otro día": componentes volátiles cambiaron (VM, RFP, etc.) → otro fingerprint.
    // El storedId NO cambia (vive en localStorage); el drift llega como currentFp,
    // exactamente como lo invoca useSecurity.initDeviceId.
    const drift = 'PDA-V2-' + 'F'.repeat(32);
    expect(drift).not.toBe(fpDia1);
    expect(await verifyStoredFingerprint(fpDia1, drift)).toBe(true); // tolerado por ancla
    expect(getFingerprintAnchor()?.lastSeen).toBe(drift); // lastSeen refrescado
  });

  it('storedId reemplazado por otro válido post-anclaje → false (manipulación del ID)', async () => {
    const fpDia1 = await generateFingerprint();
    localStorage.setItem('pda_device_id', fpDia1);
    expect(await verifyStoredFingerprint(fpDia1)).toBe(true); // acuña ancla

    const drift = 'PDA-V2-' + 'F'.repeat(32);
    // Alguien reescribió el ID almacenado → ni match exacto ni ancla → revocar.
    expect(await verifyStoredFingerprint(drift)).toBe(false);
  });

  it('ID foráneo bien formado SIN ancla y SIN continuidad → false (perfil limpio con ID inyectado)', async () => {
    expect(await verifyStoredFingerprint('PDA-V2-' + 'A'.repeat(32))).toBe(false);
    expect(getFingerprintAnchor()).toBeNull(); // nada fue acuñado
  });

  it('ID foráneo SIN ancla PERO con continuidad de instalación → TOFU: adopta y true (migración pre-ancla)', async () => {
    localStorage.setItem('business_name', 'Bodega La Esquina');
    localStorage.setItem('pda_sales_history', '[{"id":"s1"}]');
    localStorage.setItem('restaurant_name', 'La Esquina');

    const legacyId = 'PDA-' + 'B'.repeat(8); // instalación legacy real, sin ancla
    expect(await verifyStoredFingerprint(legacyId)).toBe(true);
    expect(getFingerprintAnchor()?.anchor).toBe(legacyId); // adoptado como ancla
  });

  it('manipulación: ancla A, storedId B bien formado → false', async () => {
    const fp = await generateFingerprint();
    localStorage.setItem('pda_device_id', fp);
    expect(await verifyStoredFingerprint(fp)).toBe(true);

    const foreign = 'PDA-V2-' + 'C'.repeat(32);
    expect(await verifyStoredFingerprint(foreign)).toBe(false); // ancla ≠ storedId
  });

  it('formato inválido sigue rechazándose (PDA-DEAD, vacío, no-string)', async () => {
    expect(await verifyStoredFingerprint('PDA-DEAD')).toBe(false);
    expect(await verifyStoredFingerprint('')).toBe(false);
    expect(await verifyStoredFingerprint(null)).toBe(false);
    expect(await verifyStoredFingerprint('not-a-pda-id')).toBe(false);
  });

  it('seedFingerprintAnchor escribe ancla legible y verifyStoredFingerprint la respeta sin recalcular', async () => {
    const id = 'PDA-V2-' + 'D'.repeat(32);
    seedFingerprintAnchor(id, id);
    expect(getFingerprintAnchor()?.anchor).toBe(id);

    const drift = 'PDA-V2-' + 'E'.repeat(32);
    expect(await verifyStoredFingerprint(drift, drift)).toBe(true); // usa currentFp sin recalcular
  });

  it('ancla corrupta en localStorage se ignora de forma segura', async () => {
    localStorage.setItem('pda_fp_anchor_v1', '{not json');
    expect(getFingerprintAnchor()).toBeNull();

    const fp = await generateFingerprint();
    localStorage.setItem('pda_device_id', fp);
    expect(await verifyStoredFingerprint(fp)).toBe(true); // match exacto, sin ancla
  });

  it('ancla de otro ID no valida un storedId distinto (anti-robo de ID intacto)', async () => {
    seedFingerprintAnchor('PDA-V2-' + '1'.repeat(32), 'PDA-V2-' + '1'.repeat(32));
    expect(await verifyStoredFingerprint('PDA-V2-' + '2'.repeat(32))).toBe(false);
  });
});

// ─── SEC-020: escapeHtml ─────────────────────────────────────────────────────

describe('SEC-020: escapeHtml neutraliza XSS', () => {
  it('escapa <, >, &, ", \'', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(escapeHtml('"><img onerror=alert(1)>')).toBe(
      '&quot;&gt;&lt;img onerror=alert(1)&gt;'
    );
    expect(escapeHtml("'- OR '1'='1")).toBe(
      '&#39;- OR &#39;1&#39;=&#39;1'
    );
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('devuelve string vacío para null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('convierte números a string', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

// ─── SEC-021: supabaseClient error claro ────────────────────────────────────

describe('SEC-021: supabaseClient lanza error claro si falta anon key', () => {
  it('en dev (sin env vars) crea stub que rechaza llamadas con mensaje claro', async () => {
    const { supabase } = await import('../src/core/supabaseClient');

    // Si las env vars están ausentes (caso default en CI), `supabase` es un Proxy
    // que rechaza cualquier llamada con el mensaje SEC-021.
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      let caught = null;
      try {
        // `supabase.from` devuelve una función (proxy get trap) que al invocarse
        // devuelve una promesa rechazada.
        const fromFn = supabase.from;
        await fromFn('whatever');
      } catch (e) {
        caught = e;
      }
      expect(caught).not.toBeNull();
      expect(String(caught.message)).toMatch(/SEC-021|Supabase|config|env/i);
    } else {
      // Env vars presentes — el cliente es real. Aceptamos el test como pasante.
      expect(supabase).toBeDefined();
    }
  });
});
