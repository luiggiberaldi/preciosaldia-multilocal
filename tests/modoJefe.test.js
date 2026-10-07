/**
 * modoJefe.test.js — Arneses del motor monetario del Modo Jefe (Fase B).
 *
 * Fixtures que cubren: contado, multi-método, fiada, anulada, cobro de deuda,
 * gasto interno (con/sin afectaCaja), apertura de caja, descuento alto,
 * cashea, pago en COP, venta de ayer, venta de hace 7 días y caja cerrada.
 */
import { describe, it, expect } from 'vitest';
import {
    num,
    fechaLocal,
    desglosePorMoneda,
    metodoPrincipal,
    resumenPlataHoy,
    fiadosHoy,
    movimientoCajaHoy,
    feedVentas,
    resumenDia,
    combinarPlata,
    alertasJefe,
} from '../src/utils/modoJefe';

const HOY = '2026-09-29';
const ts = (dia, h, m) => `${dia}T${h}:${m}:00.000-04:00`;

const V1 = { id: 'v1', tipo: 'VENTA', timestamp: ts(HOY, '09', '15'), totalUsd: 20, customerName: 'Cliente A', payments: [{ currency: 'USD', amountUsd: 20, methodLabel: 'Efectivo', methodId: 'efectivo' }] };
const V2 = { id: 'v2', tipo: 'VENTA', timestamp: ts(HOY, '10', '30'), totalUsd: 25, cartSubtotalUsd: 27, discountAmountUsd: 2, customerName: 'Cliente B', payments: [{ currency: 'USD', amountUsd: 10, methodLabel: 'Efectivo', methodId: 'efectivo' }, { currency: 'BS', amountBs: 500, amountUsd: 0, methodLabel: 'Pago móvil', methodId: 'pago_movil' }] };
const V3 = { id: 'v3', tipo: 'VENTA_FIADA', timestamp: ts(HOY, '11', '00'), totalUsd: 30, fiadoUsd: 30, customerName: 'Deudor' };
const V4 = { id: 'v4', tipo: 'VENTA', status: 'ANULADA', timestamp: ts(HOY, '11', '30'), totalUsd: 15, customerName: 'Anulado' };
const C1 = { id: 'c1', tipo: 'COBRO_DEUDA', timestamp: ts(HOY, '12', '00'), totalUsd: 10 };
const G1 = { id: 'g1', tipo: 'GASTO_INTERNO', timestamp: ts(HOY, '12', '30'), totalUsd: -5, afectaCaja: true };
const G2 = { id: 'g2', tipo: 'GASTO_INTERNO', timestamp: ts(HOY, '12', '45'), totalUsd: -3, afectaCaja: false };
const A1 = { id: 'a1', tipo: 'APERTURA_CAJA', timestamp: ts(HOY, '08', '00'), totalUsd: 100 };
const V5 = { id: 'v5', tipo: 'VENTA', timestamp: ts(HOY, '13', '00'), totalUsd: 32, cartSubtotalUsd: 40, discountAmountUsd: 8, customerName: 'Cliente C' };
const V6 = { id: 'v6', tipo: 'VENTA_CASHEA', timestamp: ts(HOY, '14', '00'), totalUsd: 50, customerName: 'Cliente D', payments: [{ currency: 'USD', amountUsd: 50, methodLabel: 'Cashea', methodId: 'cashea' }] };
const V7 = { id: 'v7', tipo: 'VENTA', timestamp: ts(HOY, '15', '00'), totalUsd: 5, customerName: 'Cliente E', payments: [{ currency: 'COP', amountCop: 20000, amountUsd: 0, methodLabel: 'Efectivo', methodId: 'efectivo' }] };
const AYER = { id: 'ayer', tipo: 'VENTA', timestamp: ts('2026-09-28', '10', '00'), totalUsd: 40 };
const SEM = { id: 'sem', tipo: 'VENTA', timestamp: ts('2026-09-22', '10', '00'), totalUsd: 60 };
const CERRADA = { id: 'cerr', tipo: 'VENTA', timestamp: ts(HOY, '16', '00'), totalUsd: 99, cajaCerrada: true };

const SALES = [V1, V2, V3, V4, C1, G1, G2, A1, V5, V6, V7, AYER, SEM, CERRADA];

describe('num (riel R3)', () => {
    it('NaN/undefined/null → 0', () => {
        expect(num(NaN)).toBe(0);
        expect(num(undefined)).toBe(0);
        expect(num(null)).toBe(0);
        expect(num('abc')).toBe(0);
        expect(num(12.5)).toBe(12.5);
        expect(num('7')).toBe(7);
    });
});

describe('fechaLocal', () => {
    it('respeta la fecha local del timestamp', () => {
        expect(fechaLocal(V1, HOY)).toBe(HOY);
        expect(fechaLocal(AYER, HOY)).toBe('2026-09-28');
    });
    it('timestamp inválido o ausente → cae al día dado', () => {
        expect(fechaLocal({ timestamp: 'no-fecha' }, HOY)).toBe(HOY);
        expect(fechaLocal({}, HOY)).toBe(HOY);
    });
});

describe('desglosePorMoneda', () => {
    it('separa USD / Bs / COP de los payments', () => {
        expect(desglosePorMoneda(V2)).toEqual({ USD: 10, BS: 500, COP: 0 });
        expect(desglosePorMoneda(V7)).toEqual({ USD: 0, BS: 0, COP: 20000 });
    });
    it('sin payments → el total cae en USD', () => {
        expect(desglosePorMoneda(V3)).toEqual({ USD: 30, BS: 0, COP: 0 });
    });
});

describe('metodoPrincipal', () => {
    it('usa el methodLabel del primer pago con monto', () => {
        expect(metodoPrincipal(V1)).toBe('Efectivo');
        expect(metodoPrincipal(V6)).toBe('Cashea');
    });
    it('sin payments → Contado', () => {
        expect(metodoPrincipal(V3)).toBe('Contado');
    });
});

describe('resumenPlataHoy', () => {
    const r = resumenPlataHoy(SALES, HOY);

    it('total y conteo excluyen anulada, otro día y caja cerrada', () => {
        // 20+25+30+32+50+5 = 162, 6 tickets
        expect(r.totalUsd).toBe(162);
        expect(r.count).toBe(6);
        expect(r.ticketPromedio).toBe(27);
    });

    it('desglose por moneda', () => {
        // USD: 20 + 10 + 30(fiadas sin payments) + 32 + 50 = 142
        expect(r.porMoneda).toEqual({ USD: 142, BS: 500, COP: 20000 });
    });

    it('desglose por método (método principal por venta)', () => {
        const metodos = Object.fromEntries(r.porMetodo.map((m) => [m.label, m]));
        expect(metodos['Efectivo'].totalUsd).toBe(20 + 25 + 5);
        expect(metodos['Efectivo'].count).toBe(3);
        expect(metodos['Contado'].totalUsd).toBe(30 + 32);
        expect(metodos['Cashea'].totalUsd).toBe(50);
        // ordenado desc
        expect(r.porMetodo[0].totalUsd).toBeGreaterThanOrEqual(r.porMetodo[1].totalUsd);
    });

    it('descuentos y anuladas', () => {
        expect(r.descuentos).toEqual({ totalUsd: 10, count: 2 });
        expect(r.anuladas).toEqual({ count: 1, totalUsd: 15 });
    });

    it('mejor hora del día', () => {
        expect(r.mejorHora).toEqual({ hora: 14, totalUsd: 50 });
    });

    it('sin ventas → ceros, sin división por cero', () => {
        const vacio = resumenPlataHoy([], HOY);
        expect(vacio.totalUsd).toBe(0);
        expect(vacio.ticketPromedio).toBe(0);
        expect(vacio.mejorHora).toBeNull();
    });
});

describe('fiadosHoy', () => {
    it('otorgados vs cobrados', () => {
        const f = fiadosHoy(SALES, HOY);
        expect(f.otorgadoUsd).toBe(30);
        expect(f.otorgadoCount).toBe(1);
        expect(f.cobradoUsd).toBe(10);
        expect(f.cobradoCount).toBe(1);
        expect(f.netoUsd).toBe(20);
    });
});

describe('movimientoCajaHoy', () => {
    it('apertura + cobradas + cobros − egresos (afectaCaja=false fuera)', () => {
        const c = movimientoCajaHoy(SALES, HOY);
        expect(c.aperturaUsd).toBe(100);
        // cobradas: 20+25+(30-30)+32+50+5 = 132 (la fiada no trae caja)
        expect(c.ventasCobradasUsd).toBe(132);
        expect(c.cobrosUsd).toBe(10);
        expect(c.egresosUsd).toBe(5);
        expect(c.ingresosUsd).toBe(142);
        expect(c.esperadoUsd).toBe(237);
    });
});

describe('feedVentas', () => {
    it('orden descendente, solo ventas, con límite', () => {
        const feed = feedVentas(SALES, 3);
        expect(feed.map((v) => v.id)).toEqual(['v7', 'v6', 'v5']);
        expect(feed[0]).toMatchObject({ hora: '15:00', totalUsd: 5, cliente: 'Cliente E' });
    });
    it('marca fiados', () => {
        const feed = feedVentas(SALES, 10);
        expect(feed.find((v) => v.id === 'v3').fiado).toBe(true);
        expect(feed.find((v) => v.id === 'v1').fiado).toBe(false);
    });
});

describe('resumenDia', () => {
    it('ayer y hace 7 días', () => {
        expect(resumenDia(SALES, '2026-09-28')).toEqual({ totalUsd: 40, count: 1 });
        expect(resumenDia(SALES, '2026-09-22')).toEqual({ totalUsd: 60, count: 1 });
        expect(resumenDia(SALES, '2026-01-01')).toEqual({ totalUsd: 0, count: 0 });
    });
});

describe('combinarPlata', () => {
    it('suma resúmenes de varias sedes', () => {
        const r1 = resumenPlataHoy([V1, V2], HOY);
        const r2 = resumenPlataHoy([V6], HOY);
        const c = combinarPlata([r1, r2]);
        expect(c.totalUsd).toBe(20 + 25 + 50);
        expect(c.count).toBe(3);
        expect(c.porMoneda).toEqual({ USD: 20 + 10 + 50, BS: 500, COP: 0 });
        expect(c.descuentos).toEqual({ totalUsd: 2, count: 1 });
        expect(c.ticketPromedio).toBe((20 + 25 + 50) / 3);
    });
    it('tolera resúmenes nulos', () => {
        expect(combinarPlata([null, undefined]).totalUsd).toBe(0);
    });
});

describe('alertasJefe', () => {
    it('anulada (alta) primero, descuento alto (media) después', () => {
        const a = alertasJefe(SALES, HOY);
        expect(a).toHaveLength(2);
        expect(a[0].tipo).toBe('anuladas');
        expect(a[0].severidad).toBe('alta');
        expect(a[1].tipo).toBe('descuento');
        expect(a[1].severidad).toBe('media');
    });
    it('descuento bajo el umbral no alerta', () => {
        // V2: $2 y 7.4% → bajo ambos umbrales
        const a = alertasJefe([V1, V2, A1], HOY);
        expect(a).toHaveLength(0);
    });
    it('ventas sin apertura → alerta baja', () => {
        const a = alertasJefe([V1], HOY);
        expect(a).toHaveLength(1);
        expect(a[0].tipo).toBe('sinApertura');
        expect(a[0].severidad).toBe('baja');
    });
});
