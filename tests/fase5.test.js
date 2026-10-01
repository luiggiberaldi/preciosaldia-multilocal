// tests/fase5.test.js — Pruebas focales de Fase 5 (medios, 2026-10-01).
// M-4: tolerancia de drift USD/Bs escalada por nº de líneas.
// M-9: clamp de stock inicial negativo en buildProductPayload.
// M-11: trim del nombre en buildProductPayload.
// M-21: allowlist en applyBackupToStorage (ignora claves fuera del catálogo).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (patrón de tests/checkout.test.js + tests/backupRestore.test.js) ──
const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) =>
            (_memoryStore.has(key) ? _memoryStore.get(key) : defaultValue)),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 't', nombre: 'T', rol: 'ADMIN' } }) },
}));

vi.mock('../src/hooks/useCloudSync', () => ({
    pushCloudSync: vi.fn().mockResolvedValue(undefined),
    queueCloudSync: vi.fn().mockResolvedValue(undefined),
    useCloudSync: vi.fn(),
}));

import { buildProductPayload, clampInitialStock } from '../src/utils/productProcessor.js';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { storageService } from '../src/utils/storageService';
import {
    applyBackupToStorage,
    validateBackupJson,
} from '../src/utils/backupRestoreService';

beforeEach(() => {
    _memoryStore.clear();
    localStorage.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
});

// ════════════════════════════════════════════════════════════════════
// M-9 — Clamp de stock inicial negativo (helper usado por los formularios)
// ════════════════════════════════════════════════════════════════════
describe('M-9: clampInitialStock limita stock negativo', () => {
    it('limita a 0 cuando allow_negative_stock no está activo', () => {
        localStorage.removeItem('allow_negative_stock');
        expect(clampInitialStock(-5)).toBe(0);
    });

    it('limita a 0 cuando allow_negative_stock es "false"', () => {
        localStorage.setItem('allow_negative_stock', 'false');
        expect(clampInitialStock(-2)).toBe(0);
    });

    it('respeta el negativo cuando allow_negative_stock=true', () => {
        localStorage.setItem('allow_negative_stock', 'true');
        expect(clampInitialStock(-5)).toBe(-5);
    });

    it('no toca valores positivos ni cero', () => {
        localStorage.removeItem('allow_negative_stock');
        expect(clampInitialStock(12)).toBe(12);
        expect(clampInitialStock(0)).toBe(0);
    });

    it('buildProductPayload NO limita (el importador Excel conserva negativos a propósito)', () => {
        localStorage.removeItem('allow_negative_stock');
        const p = buildProductPayload(
            { name: 'En Negativo', priceUsd: '10', stock: '-5', packagingType: 'suelto' }, 40);
        expect(p.stock).toBe(-5);
    });
});

// ════════════════════════════════════════════════════════════════════
// M-11 — Trim del nombre
// ════════════════════════════════════════════════════════════════════
describe('M-11: buildProductPayload recorta el nombre', () => {
    it('trim + capitalización sin espacios sobrantes', () => {
        const p = buildProductPayload(
            { name: '   queso blanco  ', priceUsd: '5', stock: '1', packagingType: 'suelto' }, 40);
        expect(p.name).toBe('Queso Blanco');
    });
});

// ════════════════════════════════════════════════════════════════════
// M-21 — Allowlist en applyBackupToStorage
// ════════════════════════════════════════════════════════════════════
describe('M-21: applyBackupToStorage ignora claves fuera del catálogo', () => {
    it('no escribe claves idb/ls desconocidas aunque vengan en el JSON', async () => {
        const backup = {
            version: '2.0',
            data: {
                idb: {
                    bodega_products_v1: [{ id: 'p1', name: 'X' }],
                    pda_sesion_malvada: { token: 'evil' },
                },
                ls: {
                    business_name: 'Bodega Test',
                    evil_ls_key: 'x',
                },
            },
        };
        expect(validateBackupJson(backup)).toBe(true);

        const applied = await applyBackupToStorage(backup, { writeMode: 'storageService' });

        expect(applied.idbKeys).toContain('bodega_products_v1');
        expect(applied.idbKeys).not.toContain('pda_sesion_malvada');
        expect(applied.lsKeys).not.toContain('evil_ls_key');

        const writtenIdbKeys = storageService.setItem.mock.calls.map(c => c[0]);
        expect(writtenIdbKeys).not.toContain('pda_sesion_malvada');
        expect(localStorage.getItem('evil_ls_key')).toBeNull();
        // Las claves legítimas sí se aplican.
        expect(localStorage.getItem('business_name')).toBe('Bodega Test');
        expect(_memoryStore.get('bodega_products_v1')).toHaveLength(1);
    });
});

// ════════════════════════════════════════════════════════════════════
// M-4 — Tolerancia de drift escalada por nº de líneas
// ════════════════════════════════════════════════════════════════════
describe('M-4: tolerancia USD/Bs escala con nº de líneas', () => {
    function manyLineOpts(n, driftBs) {
        const cart = [];
        const products = [];
        for (let i = 0; i < n; i++) {
            cart.push({ id: 'p' + i, name: 'Prod ' + i, qty: 1, priceUsd: 1, costUsd: 0.4, costBs: 0, isWeight: false });
            products.push({ id: 'p' + i, name: 'Prod ' + i, stock: 50, costUsd: 0.4 });
        }
        const totalUsd = n;
        return {
            cart,
            cartTotalUsd: totalUsd,
            cartTotalBs: totalUsd * 40 + driftBs,
            cartSubtotalUsd: totalUsd,
            payments: [{ amountUsd: totalUsd, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };
    }

    it('acepta drift acumulado legítimo en venta de muchas líneas', async () => {
        // 40 líneas × tasa 40 → tolerancia = max(5, 0.005×40×40) = 8.
        // Drift de 7 Bs: con la tolerancia fija de 5 se rechazaba DESPUÉS de cobrar.
        const r = await processSaleTransaction(manyLineOpts(40, 7));
        expect(r.success).toBe(true);
    });

    it('sigue rechazando un drift desproporcionado', async () => {
        const r = await processSaleTransaction(manyLineOpts(40, 50));
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/Inconsistencia/);
    });

    it('mantiene el piso de 5 Bs para ventas pequeñas', async () => {
        // 2 líneas × tasa 40 → max(5, 0.4) = 5. Drift de 6 se rechaza.
        const r = await processSaleTransaction(manyLineOpts(2, 6));
        expect(r.success).toBe(false);
    });
});
