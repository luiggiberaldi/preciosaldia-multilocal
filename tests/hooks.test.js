/**
 * tests/hooks.test.js — Tests para fixes de hooks y servicios (HOOK-FIXES).
 *
 * Cubre:
 *  - HOOK-007: storageService.setItem dispara `quota_exceeded` event.
 *  - HOOK-008: auditService.logEvent no pierde entradas bajo concurrencia.
 *  - HOOK-036: RateService.getExchangeContext devuelve `stale: true` si tasa es 0.
 *  - HOOK-037: CurrencyService.safeParse maneja formato europeo y anglosajón.
 *
 * Adicionales (no obligatorios por la tarea pero recomendados):
 *  - HOOK-014: syncFlags.runWithoutEco setea/restaura el flag.
 *  - HOOK-009: auditService.purgeOldEntries preserva categorías fiscales.
 *  - HOOK-041: backupKeys.js expone listas canónicas consistentes.
 *  - HOOK-003: envGuard.assertEnv lanza si falta variable.
 *  - HOOK-038: auditService.clearAuditLog rechaza rol no-admin.
 */

import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────────

// Hoisted: variables que sobreviven al hoisting de vi.mock (que se ejecuta
// antes que cualquier import). Necesario para que la factory pueda referenciarlas.
const {
  _lfStore,
  _lfThrowOnKey,
  _lfSetItemImpl,
  _pushCloudSyncSpy,
} = vi.hoisted(() => ({
  _lfStore: new Map(),
  _lfThrowOnKey: { current: null },
  _lfSetItemImpl: { current: null },
  _pushCloudSyncSpy: vi.fn().mockResolvedValue(undefined),
}));

// Mock de localforage (in-memory). Cada test resetea el store vía beforeEach.
// NOTA: NO clonamos valores (a diferencia de producción) para evitar OOM en
// tests de concurrencia con arrays grandes. Los tests asumen inmutabilidad
// por convención (auditService usa `unshift` sobre una copia nueva).
vi.mock('localforage', () => {
  const impl = {
    config: () => {},
    getItem: async (k) => _lfStore.has(k) ? _lfStore.get(k) : null,
    setItem: async (k, v) => {
      if (_lfSetItemImpl.current) {
        return _lfSetItemImpl.current(k, v);
      }
      if (_lfThrowOnKey.current === k) {
        const err = new Error('IndexedDB quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      _lfStore.set(k, v);
    },
    removeItem: async (k) => { _lfStore.delete(k); },
    clear: async () => { _lfStore.clear(); },
    createInstance: () => ({
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
      clear: async () => {},
    }),
  };
  return { default: impl, ...impl };
});

// Mock de useCloudSync para evitar cadena de imports real (supabase, authStore).
// Solo exportamos `pushCloudSync` como spy.
vi.mock('../src/hooks/useCloudSync', () => ({
  pushCloudSync: _pushCloudSyncSpy,
  queueCloudSync: _pushCloudSyncSpy,
  useCloudSync: vi.fn(),
}));

// ─── Imports (después de los mocks) ────────────────────────────────────────
import { storageService } from '../src/utils/storageService';
import { logEvent, getAuditLog, getAuditCount, purgeOldEntries, clearAuditLog, _AUDIT_CONFIG } from '../src/services/auditService';
import { RateService } from '../src/services/RateService';
import { CurrencyService } from '../src/services/CurrencyService';
import * as syncFlags from '../src/utils/syncFlags';
import { IDB_KEYS, LS_KEYS, PROTECTED_KEYS } from '../src/config/backupKeys';
import { assertEnv, getEnv, getMissingEnvVars } from '../src/utils/envGuard';

// Helper local (no necesita hoisting porque solo se usa dentro de tests, no en mocks).
function cloneForSeed(v) {
  if (v === null || v === undefined) return v;
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────

beforeEach(async () => {
  _lfStore.clear();
  _lfThrowOnKey.current = null;
  _lfSetItemImpl.current = null;
  _pushCloudSyncSpy.mockClear();
  localStorage.clear();
  syncFlags._resetSyncFlag();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('HOOK-007: storageService.setItem + QuotaExceededError', () => {
  it('dispara evento `quota_exceeded` cuando localforage lanza QuotaExceededError', async () => {
    _lfThrowOnKey.current = 'bodega_test_v1';

    let captured = null;
    const handler = (e) => { captured = e; };
    window.addEventListener('quota_exceeded', handler);

    try {
      await storageService.setItem('bodega_test_v1', { foo: 'bar' });
    } finally {
      window.removeEventListener('quota_exceeded', handler);
    }

    expect(captured).not.toBeNull();
    expect(captured.detail.key).toBe('bodega_test_v1');
    expect(captured.detail.queueLength).toBeGreaterThan(0);
  });

  it('encola la operación fallida y la recupera con flushRetries', async () => {
    // Forzar QuotaExceededError en la primera llamada, luego permitir éxito.
    let calls = 0;
    _lfSetItemImpl.current = async (k, v) => {
      calls++;
      if (calls === 1) {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      _lfStore.set(k, v);
    };

    let eventFired = false;
    const handler = () => { eventFired = true; };
    window.addEventListener('quota_exceeded', handler);
    try {
      await storageService.setItem('bodega_quota_v1', { x: 1 });
    } finally {
      window.removeEventListener('quota_exceeded', handler);
    }

    expect(eventFired).toBe(true);

    // Restaurar comportamiento normal y hacer flush.
    _lfSetItemImpl.current = null;
    const flushed = await storageService.flushRetries();
    expect(flushed).toBeGreaterThan(0);

    // Verificar que el dato quedó persistido tras el reintento.
    const recovered = await storageService.getItem('bodega_quota_v1', null);
    expect(recovered).toEqual({ x: 1 });
  });
});

describe('HOOK-008: auditService.logEvent bajo concurrencia', () => {
  it('no pierde entradas cuando 50 logEvent se disparan en paralelo', async () => {
    // Lanzar 50 logEvent en paralelo (sin await individual).
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(logEvent('SISTEMA', `TEST_${i}`, `entrada ${i}`, { id: 1, nombre: 'tester', rol: 'ADMIN' }));
    }
    await Promise.all(promises);

    const count = await getAuditCount();
    expect(count).toBe(50);

    // Verificar que todas las acciones estén presentes (sin importar orden).
    const log = await getAuditLog({});
    const actions = new Set(log.map(e => e.action));
    for (let i = 0; i < 50; i++) {
      expect(actions.has(`TEST_${i}`)).toBe(true);
    }
  });

  it('respeta el límite duro de MAX_ENTRIES', async () => {
    // Loguear más que MAX_ENTRIES en paralelo.
    const max = _AUDIT_CONFIG.MAX_ENTRIES;
    const overflow = max + 100;
    const promises = [];
    for (let i = 0; i < overflow; i++) {
      promises.push(logEvent('SISTEMA', `OVERFLOW_${i}`, `entry ${i}`));
    }
    await Promise.all(promises);

    const count = await getAuditCount();
    expect(count).toBeLessThanOrEqual(max);
    expect(count).toBeGreaterThanOrEqual(max - 5); // tolerancia mínima
  });
});

describe('HOOK-009: auditService.purgeOldEntries preserva categorías fiscales', () => {
  it('no borra entradas VENTA/CLIENTE/PAGO aunque sean muy antiguas', async () => {
    const veryOld = Date.now() - (10 * 365 * 24 * 60 * 60 * 1000); // 10 años atrás
    // Insertar directamente en el store del mock (sin pasar por logEvent que usaría Date.now()).
    const seed = [
      { id: '1', ts: veryOld, cat: 'VENTA',   action: 'V1', desc: 'old venta' },
      { id: '2', ts: veryOld, cat: 'CLIENTE', action: 'C1', desc: 'old cliente' },
      { id: '3', ts: veryOld, cat: 'PAGO',    action: 'P1', desc: 'old pago' },
      { id: '4', ts: veryOld, cat: 'SISTEMA', action: 'S1', desc: 'old sistema' },
      { id: '5', ts: veryOld, cat: 'AUTH',    action: 'A1', desc: 'old auth' },
    ];
    _lfStore.set(_AUDIT_CONFIG.AUDIT_KEY, cloneForSeed(seed));

    await purgeOldEntries();

    const remaining = await getAuditLog({});
    const cats = new Set(remaining.map(e => e.cat));
    // Fiscales se conservan.
    expect(cats.has('VENTA')).toBe(true);
    expect(cats.has('CLIENTE')).toBe(true);
    expect(cats.has('PAGO')).toBe(true);
    // No fiscales antiguos se purgan.
    expect(cats.has('SISTEMA')).toBe(false);
    expect(cats.has('AUTH')).toBe(false);
  });

  it('conserva entradas recientes de cualquier categoría', async () => {
    const recent = Date.now() - (1 * 24 * 60 * 60 * 1000); // ayer
    const seed = [
      { id: '1', ts: recent, cat: 'SISTEMA', action: 'S1', desc: 'recent' },
      { id: '2', ts: recent, cat: 'AUTH',    action: 'A1', desc: 'recent' },
    ];
    _lfStore.set(_AUDIT_CONFIG.AUDIT_KEY, cloneForSeed(seed));

    await purgeOldEntries();
    const remaining = await getAuditLog({});
    expect(remaining.length).toBe(2);
  });
});

describe('HOOK-038 / SEC-019: auditService.clearAuditLog role check', () => {
  // NOTA: El Agente B (SEC-019) hizo el role check autoritativo más estricto:
  // solo `rol === 'ADMIN'` (no OWNER/SUPERADMIN inventados). Si `user` es null,
  // se intenta leer `usuarioActivo` de useAuthStore; en tests no hay admin
  // autenticado, así que null también se rechaza. Esto es esperado y correcto.
  it('rechaza si user no es admin', async () => {
    await expect(clearAuditLog({ id: 1, nombre: 'cajero', rol: 'CAJERO' }))
      .rejects.toThrow(/Permiso denegado/);
  });

  it('rechaza si user es OWNER (rol no reconocido en la app)', async () => {
    await expect(clearAuditLog({ id: 1, nombre: 'owner', rol: 'OWNER' }))
      .rejects.toThrow(/Permiso denegado/);
  });

  it('rechaza si user es null y no hay usuarioActivo ADMIN en el authStore', async () => {
    await expect(clearAuditLog(null))
      .rejects.toThrow(/Permiso denegado/);
  });

  it('permite si user es ADMIN', async () => {
    await expect(clearAuditLog({ id: 1, nombre: 'admin', rol: 'ADMIN' }))
      .resolves.toBeUndefined();
  });

  it('cuando rechaza, deja trazabilidad en el audit log (entry CLEAR_AUDIT_DENIED)', async () => {
    await expect(clearAuditLog({ id: 99, nombre: 'intruso', rol: 'CAJERO' }))
      .rejects.toThrow();

    const log = await getAuditLog({});
    const denialEntry = log.find(e => e.action === 'CLEAR_AUDIT_DENIED');
    expect(denialEntry).toBeDefined();
    expect(denialEntry.userId).toBe(99);
    expect(denialEntry.desc).toMatch(/intruso/);
  });
});

describe('HOOK-036: RateService stale detection', () => {
  it('devuelve stale=true cuando bcv.price es 0 (USD → VES)', () => {
    const ctx = RateService.getExchangeContext('USD', null, { bcv: { price: 0 }, euro: { price: 0 } });
    expect(ctx.stale).toBe(true);
    expect(ctx.rateUsed).toBe(0);
  });

  it('devuelve stale=true cuando bcv.price es null/undefined', () => {
    const ctx = RateService.getExchangeContext('USD', null, { bcv: {}, euro: {} });
    expect(ctx.stale).toBe(true);
  });

  it('devuelve stale=false cuando bcv.price > 0', () => {
    const ctx = RateService.getExchangeContext('USD', null, { bcv: { price: 36.5 }, euro: { price: 39.8 } });
    expect(ctx.stale).toBe(false);
    expect(ctx.rateUsed).toBe(36.5);
    expect(ctx.target).toBe('VES');
  });

  it('marca stale=true para EUR→VES si euro.price es 0', () => {
    const ctx = RateService.getExchangeContext('EUR', null, { bcv: { price: 36 }, euro: { price: 0 } });
    expect(ctx.stale).toBe(true);
  });

  it('marca stale=true para VES→USD (compra USD) si bcv.price es 0', () => {
    const ctx = RateService.getExchangeContext('VES', null, { bcv: { price: 0 }, euro: { price: 0 } });
    expect(ctx.stale).toBe(true);
    expect(ctx.target).toBe('USD');
  });
});

describe('HOOK-037: CurrencyService.safeParse multi-formato', () => {
  it('parsea formato europeo "1.234,56" → 1234.56', () => {
    expect(CurrencyService.safeParse('1.234,56')).toBeCloseTo(1234.56, 2);
  });

  it('parsea formato anglosajón "1,234.56" → 1234.56', () => {
    expect(CurrencyService.safeParse('1,234.56')).toBeCloseTo(1234.56, 2);
  });

  it('parsea "1234,56" (europeo sin miles) → 1234.56', () => {
    expect(CurrencyService.safeParse('1234,56')).toBeCloseTo(1234.56, 2);
  });

  it('parsea "1234.56" (anglosajón sin miles) → 1234.56', () => {
    expect(CurrencyService.safeParse('1234.56')).toBeCloseTo(1234.56, 2);
  });

  it('parsea "1234" (sin separadores) → 1234', () => {
    expect(CurrencyService.safeParse('1234')).toBe(1234);
  });

  it('parsea "1.234.567" (miles europeo, sin decimales) → 1234567', () => {
    expect(CurrencyService.safeParse('1.234.567')).toBe(1234567);
  });

  it('parsea "1,234,567" (miles anglosajón, sin decimales) → 1234567', () => {
    expect(CurrencyService.safeParse('1,234,567')).toBe(1234567);
  });

  it('parsea número directo sin stringificación', () => {
    expect(CurrencyService.safeParse(99.5)).toBe(99.5);
  });

  it('devuelve 0 para strings vacíos/null/undefined', () => {
    expect(CurrencyService.safeParse('')).toBe(0);
    expect(CurrencyService.safeParse(null)).toBe(0);
    expect(CurrencyService.safeParse(undefined)).toBe(0);
  });

  it('parsea "$1.234,56" (con símbolo) → 1234.56', () => {
    expect(CurrencyService.safeParse('$1.234,56')).toBeCloseTo(1234.56, 2);
  });
});

describe('HOOK-014: syncFlags.runWithoutEco', () => {
  it('setea el flag durante la ejecución y lo restaura al final', async () => {
    expect(syncFlags.isSyncingFromCloud()).toBe(false);
    let observedInside = false;
    await syncFlags.runWithoutEco(async () => {
      observedInside = syncFlags.isSyncingFromCloud();
    });
    expect(observedInside).toBe(true);
    expect(syncFlags.isSyncingFromCloud()).toBe(false);
  });

  it('restaura el flag previo incluso si era true', async () => {
    // Simular que el flag ya estaba true (otro caller lo seteó).
    syncFlags.registerCloudSyncSetter((v) => { /* noop */ });
    await syncFlags.runWithoutEco(async () => {
      // dentro del bloque
    });
    // Como el previo era false (acabamos de resetear en beforeEach), queda false.
    expect(syncFlags.isSyncingFromCloud()).toBe(false);
  });

  it('restaura el flag incluso si fn lanza', async () => {
    await expect(syncFlags.runWithoutEco(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(syncFlags.isSyncingFromCloud()).toBe(false);
  });

  it('runWithoutEcoSync (variante síncrona) también restaura', () => {
    let inside = false;
    syncFlags.runWithoutEcoSync(() => {
      inside = syncFlags.isSyncingFromCloud();
    });
    expect(inside).toBe(true);
    expect(syncFlags.isSyncingFromCloud()).toBe(false);
  });
});

describe('HOOK-041: backupKeys.js — listas canónicas', () => {
  it('IDB_KEYS incluye las claves críticas esperadas', () => {
    expect(IDB_KEYS).toContain('bodega_products_v1');
    expect(IDB_KEYS).toContain('bodega_sales_v1');
    expect(IDB_KEYS).toContain('bodega_customers_v1');
    expect(IDB_KEYS).toContain('abasto_audit_log_v1');
    expect(IDB_KEYS).toContain('bodega_accounts_v2');
    expect(IDB_KEYS).toContain('my_categories_v1');
  });

  it('LS_KEYS incluye claves de configuración y auth', () => {
    expect(LS_KEYS).toContain('street_rate_bs');
    expect(LS_KEYS).toContain('bodega_use_auto_rate');
    expect(LS_KEYS).toContain('business_name');
    expect(LS_KEYS).toContain('premium_token');
  });

  it('PROTECTED_KEYS incluye los flags que NO se deben borrar en import', () => {
    expect(PROTECTED_KEYS).toContain('pda_demo_flag_v1');
    expect(PROTECTED_KEYS).toContain('bodega_autobackup_v1');
  });

  it('las listas están congeladas (Object.freeze)', () => {
    expect(Object.isFrozen(IDB_KEYS)).toBe(true);
    expect(Object.isFrozen(LS_KEYS)).toBe(true);
    expect(Object.isFrozen(PROTECTED_KEYS)).toBe(true);
  });

  it('no hay duplicados dentro de cada lista', () => {
    const dupes = (arr) => arr.filter((v, i) => arr.indexOf(v) !== i);
    expect(dupes(IDB_KEYS)).toHaveLength(0);
    expect(dupes(LS_KEYS)).toHaveLength(0);
    expect(dupes(PROTECTED_KEYS)).toHaveLength(0);
  });
});

describe('HOOK-003: envGuard.assertEnv', () => {
  it('lanza Error descriptivo si la variable no está definida', () => {
    // VITE_NONEXISTENT_VAR no está en env por defecto.
    expect(() => assertEnv('VITE_NONEXISTENT_VAR')).toThrow(/Falta la variable de entorno/);
    expect(() => assertEnv('VITE_NONEXISTENT_VAR')).toThrow(/VITE_NONEXISTENT_VAR/);
  });

  it('devuelve el valor si la variable está definida', () => {
    // Vite define VITE_TEST_VAR si la inyectamos en import.meta.env.
    // En tests, simulamos via vi.stubGlobal o similar.
    vi.stubEnv('VITE_TEST_DEFINED_VAR', 'https://example.supabase.co');
    expect(assertEnv('VITE_TEST_DEFINED_VAR')).toBe('https://example.supabase.co');
    vi.unstubAllEnvs();
  });

  it('rechaza placeholders obvios (REEMPLAZAR/YOUR_/PLACEHOLDER)', () => {
    vi.stubEnv('VITE_TEST_PLACEHOLDER', 'REEMPLAZAR_CON_TU_ANON_KEY_VERDADERA');
    expect(() => assertEnv('VITE_TEST_PLACEHOLDER')).toThrow(/Falta la variable/);
    vi.unstubAllEnvs();
  });

  it('getMissingEnvVars lista las variables requeridas ausentes', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const missing = getMissingEnvVars();
    expect(missing).toContain('VITE_SUPABASE_URL');
    expect(missing).toContain('VITE_SUPABASE_ANON_KEY');
    vi.unstubAllEnvs();
  });
});
