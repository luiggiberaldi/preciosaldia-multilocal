/**
 * payrollService.test.js — Verifica la lógica de nómina con almacenamiento en memoria.
 *
 * Cubre: neto = sueldo − consumos aplicados, tope del % del sueldo, anulación de
 * consumos, bloqueo de neto negativo, doble liquidación, permisos por rol y la
 * apertura de un período secuenciado tras liquidar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ store: new Map(), session: null, requireLogin: true }));

vi.mock('../src/utils/appForage.js', () => ({
    appForage: {
        getItem: async (k, d = null) => (db.store.has(k) ? db.store.get(k) : d),
        setItem: async (k, v) => { db.store.set(k, v); return v; },
        keys: async () => [...db.store.keys()],
    },
}));
vi.mock('../src/utils/storageService.js', () => ({
    storageService: {
        getItem: async (k, d = null) => (db.store.has(k) ? db.store.get(k) : d),
        setItem: async (k, v) => { db.store.set(k, v); return v; },
    },
}));
vi.mock('../src/hooks/store/useAuthStore.js', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: db.session, requireLogin: db.requireLogin }) },
}));
vi.mock('../src/services/auditService.js', () => ({ logEvent: async () => {} }));
vi.mock('../src/utils/stockAdjust.js', () => ({ adjustStockForItems: async () => {} }));
vi.mock('../src/hooks/useCloudSync.js', () => ({
    pushCloudSync: async () => ({ ok: true }),
    pushPayrollDoc: async () => ({ ok: true }),
}));
vi.mock('../src/utils/negocioContext.js', () => ({ getNegocioActivoId: () => 'neg-1' }));

import {
    registerConsumo, anularConsumo, getResumen, liquidar,
    EMPLOYEES_KEY, PRODUCTS_KEY, SALES_KEY,
} from '../src/services/payrollService';
import { periodKeyFor, periodBounds, basePeriodKey, consumoExcedeLimite, toUsd } from '../src/utils/payroll';

const OWNER = { id: 'o1', nombre: 'Dueño', rol: 'DUENO' };
const ADMIN = { id: 'a1', nombre: 'Admin', rol: 'ADMIN' };
const CAJERO = { id: 'c1', nombre: 'Cajero', rol: 'CAJERO' };

function seed() {
    db.store.clear();
    db.store.set(EMPLOYEES_KEY, [
        { id: 'e1', nombre: 'Ana', salarioMonto: 100, salarioMoneda: 'USD', frecuenciaPago: 'mensual', activo: true, limiteConsumoPorc: 50 },
    ]);
    db.store.set(PRODUCTS_KEY, [{ id: 'p1', name: 'Pan', priceUsd: 2, stock: 100 }]);
    db.store.set(SALES_KEY, []);
}

beforeEach(() => {
    seed();
    db.session = OWNER;
    db.requireLogin = true;
});

describe('neto del empleado', () => {
    it('neto = sueldo − consumos aplicados; la liquidación usa esa cifra en USD y Bs', async () => {
        await registerConsumo({ employeeId: 'e1', items: [{ productId: 'p1', qty: 3 }], tasaBcv: 36 });

        const r = await getResumen('e1', 36);
        expect(r.totalConsumosUsd).toBe(6);
        expect(r.netoUsd).toBe(94);

        const { liquidacion } = await liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 });
        expect(liquidacion.netoUsd).toBe(94);
        expect(liquidacion.netoBs).toBe(3384);
        expect(liquidacion.status).toBe('PAID');
    });

    it('la liquidación crea un egreso de caja negativo por el neto', async () => {
        await registerConsumo({ employeeId: 'e1', items: [{ productId: 'p1', qty: 3 }], tasaBcv: 36 });
        await liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 });

        const gasto = db.store.get(SALES_KEY).find((s) => s.tipo === 'GASTO_INTERNO');
        expect(gasto).toBeDefined();
        expect(gasto.totalUsd).toBe(-94);
        expect(gasto.afectaCaja).toBe(true);
    });

    it('anular un consumo devuelve el neto', async () => {
        const consumo = await registerConsumo({ employeeId: 'e1', items: [{ productId: 'p1', qty: 3 }], tasaBcv: 36 });
        await anularConsumo(consumo.id, 'error de captura');

        const r = await getResumen('e1', 36);
        expect(r.totalConsumosUsd).toBe(0);
        expect(r.netoUsd).toBe(100);
    });
});

describe('límite de consumo (% del sueldo)', () => {
    it('rechaza un consumo que supera el tope sin override', async () => {
        // Tope = 50% de 100 USD = 50 USD. 26 × 2 = 52 USD supera el tope.
        await expect(registerConsumo({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 26 }], tasaBcv: 36,
        })).rejects.toMatchObject({ code: 'PAYROLL_LIMITE_EXCEDIDO' });
    });

    it('justo en el tope no excede (comparación estricta)', () => {
        expect(consumoExcedeLimite(100, 0, 50, 50)).toBe(false);
        expect(consumoExcedeLimite(100, 0, 50.01, 50)).toBe(true);
    });
});

describe('liquidación', () => {
    it('no liquida si el neto es negativo', async () => {
        // Override permite pasar el tope: 60 × 2 = 120 USD > sueldo 100 → neto −20.
        await registerConsumo({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 60 }], tasaBcv: 36, overrideLimite: true,
        });
        await expect(liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 }))
            .rejects.toMatchObject({ code: 'PAYROLL_NETO_NEGATIVO' });
    });

    it('no permite liquidar dos veces el mismo período', async () => {
        await liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 });
        await expect(liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 }))
            .rejects.toMatchObject({ code: 'PAYROLL_YA_LIQUIDADO' });
    });

    it('un consumo posterior a la liquidación abre un período nuevo y se liquida aparte', async () => {
        await registerConsumo({ employeeId: 'e1', items: [{ productId: 'p1', qty: 3 }], tasaBcv: 36 });
        const primera = await liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 });
        expect(primera.liquidacion.netoUsd).toBe(94);

        await registerConsumo({ employeeId: 'e1', items: [{ productId: 'p1', qty: 5 }], tasaBcv: 36 });
        const segunda = await liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 });
        expect(segunda.liquidacion.netoUsd).toBe(90);
        expect(segunda.liquidacion.periodoKey).not.toBe(primera.liquidacion.periodoKey);
    });

    it('liquidar sin consumos previos no bloquea un consumo posterior del mismo mes', async () => {
        const primera = await liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 });
        expect(primera.liquidacion.netoUsd).toBe(100);

        await registerConsumo({ employeeId: 'e1', items: [{ productId: 'p1', qty: 3 }], tasaBcv: 36 });
        const segunda = await liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 });
        expect(segunda.liquidacion.netoUsd).toBe(94);
        expect(segunda.liquidacion.periodoKey).not.toBe(primera.liquidacion.periodoKey);
    });
});

describe('permisos por rol', () => {
    it('el cajero no puede registrar consumos', async () => {
        db.session = CAJERO;
        await expect(registerConsumo({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 1 }], tasaBcv: 36,
        })).rejects.toMatchObject({ code: 'PAYROLL_DUENO_ADMIN_ONLY' });
    });

    it('el administrador sí puede registrar consumos pero no liquidar', async () => {
        db.session = ADMIN;
        await expect(registerConsumo({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 1 }], tasaBcv: 36,
        })).resolves.toMatchObject({ status: 'APPLIED' });
        await expect(liquidar({ employeeId: 'e1', metodoPago: 'efectivo', tasaBcv: 36 }))
            .rejects.toMatchObject({ code: 'PAYROLL_OWNER_ONLY' });
    });
});

describe('funciones puras de período y conversión', () => {
    it('periodKeyFor: semanal ISO, quincenal y mensual', () => {
        const d = new Date('2026-10-09T12:00:00Z');
        expect(periodKeyFor(d, 'semanal')).toBe('2026-W41');
        expect(periodKeyFor(d, 'quincenal')).toBe('2026-10-Q1');
        expect(periodKeyFor(d, 'mensual')).toBe('2026-10');
    });

    it('periodBounds: la quincena 2 termina el día 1 del mes siguiente', () => {
        const b = periodBounds('2026-10-Q2');
        expect(b.inicioISO).toBe('2026-10-16T04:00:00.000Z');
        expect(b.finISO).toBe('2026-11-01T04:00:00.000Z');
    });

    it('basePeriodKey: quita solo el sufijo de reapertura, no el mes de la clave mensual', () => {
        expect(basePeriodKey('2026-10')).toBe('2026-10');
        expect(basePeriodKey('2026-10-2')).toBe('2026-10');
        expect(basePeriodKey('2026-W40')).toBe('2026-W40');
        expect(basePeriodKey('2026-W40-2')).toBe('2026-W40');
        expect(basePeriodKey('2026-10-Q1')).toBe('2026-10-Q1');
        expect(basePeriodKey('2026-10-Q1-2')).toBe('2026-10-Q1');
    });

    it('toUsd convierte Bs con la tasa y devuelve 0 sin tasa válida', () => {
        expect(toUsd(3600, 'Bs', 36)).toBe(100);
        expect(toUsd(3600, 'Bs', 0)).toBe(0);
    });
});
