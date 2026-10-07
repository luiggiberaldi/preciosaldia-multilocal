// tests/auditoriaPostPlan.test.js — Fixes de la auditoría general post-plan
// (2026-10-01). Los hallazgos 1–4 de la auditoría eran implementables:
//  1. B-17: el guard del último método contaba virtuales (saldo a favor) —
//     se extrajo el predicado puro `canDeactivatePaymentMethod`.
//  2. B-13a: `SYNC_PUSH_ERROR_EVENT` no tenía UI — SyncStatus lo consume
//     (componente; sin testing-library no se monta aquí; se verifica el
//     contrato del evento en tests/fase6.test.js).
//  3. B-18: `disableClose` en CasheaRemittanceModal / TransactionModal /
//     GastosInternosModal (componentes; verificación manual/visual).
//  4. Monitoreo legacy de licencias desactivado en Pro.

import { describe, it, expect, vi } from 'vitest';
import { canDeactivatePaymentMethod } from '../src/components/Settings/PaymentMethodsManager';
import { useLicenseMonitoring } from '../src/hooks/useLicenseMonitoring';

describe('Auditoría — guard B-17 excluye virtuales', () => {
    const real = (id, enabled = true) => ({ id, isEnabled: enabled });
    const virtual = (id, enabled = true) => ({ id, isEnabled: enabled, isVirtual: true });

    it('no permite desactivar el último método REAL aunque quede un virtual activo', () => {
        const methods = [real('efectivo_bs'), virtual('saldo_favor')];
        expect(canDeactivatePaymentMethod(methods, 'efectivo_bs')).toBe(false);
    });

    it('permite desactivar cuando queda otro método real activo', () => {
        const methods = [real('efectivo_bs'), real('efectivo_usd'), virtual('saldo_favor')];
        expect(canDeactivatePaymentMethod(methods, 'efectivo_bs')).toBe(true);
    });

    it('activar un método desactivado siempre se permite', () => {
        const methods = [real('efectivo_bs', false), virtual('saldo_favor')];
        expect(canDeactivatePaymentMethod(methods, 'efectivo_bs')).toBe(true);
    });

    it('con cero métodos reales activos, no se puede desactivar nada real', () => {
        const methods = [real('efectivo_bs', false), virtual('saldo_favor')];
        // intentar "desactivar" el ya-desactivado = activarlo → permitido
        expect(canDeactivatePaymentMethod(methods, 'efectivo_bs')).toBe(true);
    });

    it('un virtual activo no sirve de respaldo para desactivar el único real', () => {
        const methods = [real('efectivo_usd', false), real('pago_movil'), virtual('saldo_favor')];
        expect(canDeactivatePaymentMethod(methods, 'pago_movil')).toBe(false);
    });
});

describe('Auditoría — monitoreo legacy de licencias desactivado', () => {
    it('useLicenseMonitoring es un no-op que no toca la red', () => {
        // Si intentara heartbeats/RPCs, fallaría sin mocks de supabase.
        expect(() => useLicenseMonitoring({ deviceId: 'x', isPremium: true })).not.toThrow();
        expect(useLicenseMonitoring({})).toBeUndefined();
    });

    it('el archivo ya no referencia product_id de Lite ni RPCs legacy', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const here = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(join(here, '../src/hooks/useLicenseMonitoring.js'), 'utf8');
        expect(src).not.toContain('const PRODUCT_ID');
        expect(src).not.toContain('supabase');
        expect(src).not.toContain('auto_register_device');
        expect(src).not.toContain('heartbeat_device');
        expect(src).not.toContain('get_license_status');
    });
});
