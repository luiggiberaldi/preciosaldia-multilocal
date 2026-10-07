/**
 * tests/repriceNotice.test.js — AVISO-REPRECIO (PLAN-AVISO-REPRECIO-BS.md, Trabajo 1).
 *
 * Matriz de la señal que dispara el banner: solo avisa cuando el pago en Bs está
 * activo Y el total cambió por aplicar el precio de referencia dual. Si el Ref
 * coincide con el precio USD, no hay nada que avisar (cero ruido).
 */

import { describe, it, expect } from 'vitest';
import { isTicketRepriced, repriceDeltaUsd } from '../src/utils/reprice.js';

describe('AVISO-REPRECIO · isTicketRepriced', () => {
    it('sin pago en Bs → nunca avisa', () => {
        expect(isTicketRepriced({ isBsPaymentActive: false, baseTotalUsd: 22, newTotalUsd: 1.2 })).toBe(false);
    });

    it('pago en Bs pero total igual → no avisa (Ref == precio USD)', () => {
        expect(isTicketRepriced({ isBsPaymentActive: true, baseTotalUsd: 22, newTotalUsd: 22 })).toBe(false);
    });

    it('escenario del incidente: $22 → $1,20 con pago en Bs → avisa', () => {
        expect(isTicketRepriced({ isBsPaymentActive: true, baseTotalUsd: 22, newTotalUsd: 1.2 })).toBe(true);
    });

    it('diferencias sub-centavo no disparan ruido (redondeo a centavos)', () => {
        expect(isTicketRepriced({ isBsPaymentActive: true, baseTotalUsd: 22, newTotalUsd: 21.996 })).toBe(false);
    });

    it('tolera entradas basura sin romper', () => {
        expect(isTicketRepriced({ isBsPaymentActive: true, baseTotalUsd: undefined, newTotalUsd: NaN })).toBe(false);
        expect(isTicketRepriced()).toBe(false);
    });
});

describe('AVISO-REPRECIO · repriceDeltaUsd', () => {
    it('positivo cuando el precio en Bs es menor al base', () => {
        expect(repriceDeltaUsd(22, 1.2)).toBe(20.8);
    });

    it('negativo cuando el precio en Bs es mayor (Ref por encima del USD)', () => {
        expect(repriceDeltaUsd(10, 12.5)).toBe(-2.5);
    });

    it('cero sin diferencias', () => {
        expect(repriceDeltaUsd(22, 22)).toBe(0);
    });
});
