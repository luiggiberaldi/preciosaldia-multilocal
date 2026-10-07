// tests/fase6.test.js — Tests de la Fase 6 del fixeo general (hallazgos bajos).
//
// Cubre: B-5 (vuelto todo en Bs), B-6 (avance USD no dividido),
//        B-7 (COP sin tasa → 0), B-11 (capitalización Unicode),
//        B-12 (anuladas fuera del breakdown), B-13 (errores de push no
//        silenciosos), B-16 (trim + límite nombre/RIF).
// No cubiertos por tests unitarios (UI/manual): B-1, B-4, B-8 (ver
// tests/withLock.test.js), B-9, B-14, B-15, B-17, B-18, B-19.
// B-2/B-3: decisiones pendientes (arquitectura / server-side).

import { describe, it, expect } from 'vitest';
import {
    advancePriceUsdt,
    copToUsd,
    bsOnlyChange,
    paymentMethodToBs,
    isVoidedSale,
    cleanBusinessData,
    titleCaseUnicode,
} from '../src/utils/fase6Money';
import { calculateSupervisorPaymentBreakdown } from '../src/services/supervisorFinancials';
import {
    recordSyncPushError,
    getLastSyncPushError,
    SYNC_PUSH_ERROR_EVENT,
} from '../src/hooks/useCloudSync';

// ── B-6: avance de efectivo ────────────────────────────────────────────────
describe('B-6 — avancePriceUsdt', () => {
    it('avance en Bs se divide entre la tasa', () => {
        expect(advancePriceUsdt(520, 'BS', 52)).toBeCloseTo(10, 6);
    });

    it('avance en USD NO se divide (antes quedaba subvaluado)', () => {
        expect(advancePriceUsdt(100, 'USD', 52)).toBe(100);
    });

    it('tasa inválida no rompe (usa 1)', () => {
        expect(advancePriceUsdt(520, 'BS', 0)).toBe(520);
    });

    it('monto no numérico → 0', () => {
        expect(advancePriceUsdt('abc', 'USD', 52)).toBe(0);
    });
});

// ── B-7: COP sin tasa ──────────────────────────────────────────────────────
describe('B-7 — copToUsd / paymentMethodToBs', () => {
    it('COP con tasa válida convierte normal', () => {
        expect(copToUsd(4100, 4100)).toBeCloseTo(1, 6);
    });

    it('COP sin tasa válida aporta 0 (no cae al divisor de Bs)', () => {
        expect(copToUsd(4100, 0)).toBe(0);
        expect(copToUsd(4100, -5)).toBe(0);
        expect(copToUsd(4100, null)).toBe(0);
    });

    it('paymentMethodToBs: COP sin tasa → 0 en Bs también', () => {
        expect(paymentMethodToBs({ tipo: 'COP', monto: 4100 }, 52, 0)).toBe(0);
        // 4100 COP a tasa 4100 = 1 USD = 52 Bs
        expect(paymentMethodToBs({ tipo: 'COP', monto: 4100 }, 52, 4100)).toBeCloseTo(52, 4);
        expect(paymentMethodToBs({ tipo: 'BS', monto: 100 }, 52, 0)).toBe(100);
        expect(paymentMethodToBs({ tipo: 'DIVISA', monto: 10 }, 52, 0)).toBeCloseTo(520, 4);
    });
});

// ── B-5: vuelto todo en Bs ─────────────────────────────────────────────────
describe('B-5 — bsOnlyChange', () => {
    it('convierte todo el vuelto a Bs con redondeo', () => {
        expect(bsOnlyChange(2.5, 52)).toBe(130);
        expect(bsOnlyChange(0.33, 52)).toBe(17.16);
    });

    it('vuelto 0 → 0 Bs', () => {
        expect(bsOnlyChange(0, 52)).toBe(0);
    });
});

// ── B-11: capitalización Unicode ───────────────────────────────────────────
describe('B-11 — titleCaseUnicode', () => {
    it('capitaliza la ñ (\\w ASCII la dejaba minúscula)', () => {
        expect(titleCaseUnicode('ñandú')).toBe('Ñandú');
    });

    it('capitaliza palabras con acentos', () => {
        expect(titleCaseUnicode('café molido premium')).toBe('Café Molido Premium');
    });

    it('hace trim y conserva el resto igual que antes (ASCII)', () => {
        expect(titleCaseUnicode('  harina pan  ')).toBe('Harina Pan');
        expect(titleCaseUnicode('ARROZ')).toBe('ARROZ');
    });
});

// ── B-12: anuladas fuera del breakdown ──────────────────────────────────────
describe('B-12 — isVoidedSale + calculateSupervisorPaymentBreakdown', () => {
    it('detecta anuladas por status y por voidedAt', () => {
        expect(isVoidedSale({ status: 'ANULADA' })).toBe(true);
        expect(isVoidedSale({ voidedAt: '2026-10-01T00:00:00Z' })).toBe(true);
        expect(isVoidedSale({ status: 'COMPLETADA' })).toBe(false);
        expect(isVoidedSale(null)).toBe(false);
    });

    it('una venta ANULADA no suma al breakdown aunque el llamador no filtre', () => {
        const sales = [
            { tipo: 'VENTA', status: 'ANULADA', payments: [{ methodId: 'efectivo_bs', amountUsd: 100, amountBs: 5200, currency: 'BS', methodLabel: 'Efectivo Bs' }] },
            { tipo: 'VENTA', status: 'COMPLETADA', payments: [{ methodId: 'efectivo_bs', amountUsd: 10, amountBs: 520, currency: 'BS', methodLabel: 'Efectivo Bs' }] },
        ];
        // Retorna entries ordenados: [[methodId, datos], ...]
        const b = Object.fromEntries(calculateSupervisorPaymentBreakdown(sales, 52));
        expect(b.efectivo_bs.totalUsd).toBe(10);
        expect(b.efectivo_bs.count).toBe(1);
    });
});

// ── B-13: errores de push no silenciosos ────────────────────────────────────
describe('B-13 — recordSyncPushError', () => {
    it('registra el último error y lo expone', () => {
        const entry = recordSyncPushError('bodega_sales_v1', 'NetworkError');
        expect(entry.key).toBe('bodega_sales_v1');
        expect(entry.error).toContain('NetworkError');
        expect(entry.at).toBeTruthy();
        expect(getLastSyncPushError()).toEqual(entry);
    });

    it('emite el evento pda_sync_push_error en window', () => {
        let received = null;
        const handler = (e) => { received = e.detail; };
        window.addEventListener(SYNC_PUSH_ERROR_EVENT, handler);
        recordSyncPushError('bodega_stock_v1', 'timeout');
        window.removeEventListener(SYNC_PUSH_ERROR_EVENT, handler);
        expect(received).not.toBeNull();
        expect(received.key).toBe('bodega_stock_v1');
    });
});

// ── B-16: trim + límite nombre/RIF ─────────────────────────────────────────
describe('B-16 — cleanBusinessData', () => {
    it('trim + límite de 60 para el nombre', () => {
        const { name } = cleanBusinessData('  Mi Bodega  ', 'j-123');
        expect(name).toBe('Mi Bodega');
        expect(cleanBusinessData('x'.repeat(100), '').name).toHaveLength(60);
    });

    it('RIF en mayúsculas, sin espacios, límite 20', () => {
        const { rif } = cleanBusinessData('', '  j-12345678-9  ');
        expect(rif).toBe('J-12345678-9');
        expect(cleanBusinessData('', 'y'.repeat(50)).rif).toHaveLength(20);
    });

    it('nulos → strings vacíos', () => {
        expect(cleanBusinessData(null, undefined)).toEqual({ name: '', rif: '' });
    });
});
