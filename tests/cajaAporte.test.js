/**
 * cajaAporte.test.js — Aporte de efectivo a la caja y alerta de efectivo bajo.
 *
 * Cubren: el cajero no puede registrar aportes, la validación de montos y
 * motivo, que el aporte suma al efectivo esperado (no a ingresos) y que la
 * alerta se dispara solo bajo el umbral configurado.
 */
import { describe, it, expect } from 'vitest';
import { canRegistrarAporteCaja, ROL_CAJERO, ROL_ADMINISTRADOR, ROL_DUENO } from '../src/utils/roles';
import { buildAporteCajaRecord, evaluarAlertaEfectivo, APORTE_CAJA_TIPO } from '../src/utils/cajaAporte';
import { FinancialEngine } from '../src/core/FinancialEngine';

describe('canRegistrarAporteCaja', () => {
    it('bloquea al cajero', () => {
        expect(canRegistrarAporteCaja({ rol: ROL_CAJERO })).toBe(false);
    });

    it('permite al administrador y al dueño', () => {
        expect(canRegistrarAporteCaja({ rol: ROL_ADMINISTRADOR })).toBe(true);
        expect(canRegistrarAporteCaja({ rol: ROL_DUENO })).toBe(true);
    });

    it('sin sesión mantiene el acceso legacy (modo sin login)', () => {
        expect(canRegistrarAporteCaja(null)).toBe(true);
    });
});

describe('buildAporteCajaRecord', () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const usuario = { id: 'u1', nombre: 'Ana' };

    it('construye un registro APORTE_CAJA con montos redondeados', () => {
        const rec = buildAporteCajaRecord({ aporteUsd: '20.456', aporteBs: '1000', aporteCop: 0, motivo: ' billetes ', usuario, now });
        expect(rec.tipo).toBe(APORTE_CAJA_TIPO);
        expect(rec.aporteUsd).toBe(20.46);
        expect(rec.aporteBs).toBe(1000);
        expect(rec.motivo).toBe('billetes');
        expect(rec.registradoPorId).toBe('u1');
        expect(rec.cajaCerrada).toBe(false);
    });

    it('rechaza un aporte en cero', () => {
        expect(() => buildAporteCajaRecord({ aporteUsd: 0, aporteBs: '', motivo: 'x', now })).toThrow(/mayor a cero/);
    });

    it('rechaza montos negativos', () => {
        expect(() => buildAporteCajaRecord({ aporteUsd: -5, aporteBs: 100, motivo: 'x', now })).toThrow(/negativos/);
    });

    it('exige un motivo', () => {
        expect(() => buildAporteCajaRecord({ aporteUsd: 5, motivo: '   ', now })).toThrow(/motivo/);
    });
});

describe('aporte en el arqueo (FinancialEngine)', () => {
    it('suma el aporte a los buckets de efectivo y no lo cuenta como ingreso', () => {
        const aporte = buildAporteCajaRecord({ aporteUsd: 30, aporteBs: 500, motivo: 'cambio', now: new Date() });
        const bd = FinancialEngine.calculatePaymentBreakdown([aporte]);
        expect(bd['efectivo_usd'].total).toBe(30);
        expect(bd['efectivo_bs'].total).toBe(500);
        expect(Object.keys(bd)).toEqual(['efectivo_usd', 'efectivo_bs']);
    });

    it('un aporte anulado no suma efectivo', () => {
        const aporte = { ...buildAporteCajaRecord({ aporteUsd: 30, motivo: 'x', now: new Date() }), status: 'ANULADA' };
        const bd = FinancialEngine.calculatePaymentBreakdown([aporte]);
        expect(bd['efectivo_usd']).toBeUndefined();
    });
});

describe('evaluarAlertaEfectivo', () => {
    it('sin umbral configurado no alerta', () => {
        expect(evaluarAlertaEfectivo({ usd: 0, bs: 0 }, { usd: 0, bs: 0 }).bajo).toBe(false);
    });

    it('alerta cuando el efectivo esperado baja del umbral', () => {
        const r = evaluarAlertaEfectivo({ usd: 5, bs: 2000 }, { usd: 10, bs: 0 });
        expect(r).toEqual({ bajo: true, usd: true, bs: false });
    });

    it('no alerta cuando el efectivo cubre el umbral', () => {
        expect(evaluarAlertaEfectivo({ usd: 50, bs: 2000 }, { usd: 10, bs: 1000 }).bajo).toBe(false);
    });
});
