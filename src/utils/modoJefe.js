/**
 * modoJefe.js — Motor monetario del Modo Jefe (Fase B).
 *
 * Funciones PURAS sobre registros crudos de `bodega_sales_v1`: sin I/O, sin
 * stores, sin fechas "ahora" implícitas (el día se recibe por parámetro para
 * que sean testeables). Criterios de filtrado = los de `useDashboardMetrics`:
 * fuera `status === 'ANULADA'` y `cajaCerrada === true`.
 *
 * Railes:
 * - R3: todo número pasa por `num()` (NaN/undefined → 0); sin divisiones por cero.
 * - Los umbrales de alerta son constantes exportadas (configurables en Fase C).
 *
 * @module utils/modoJefe
 */
import { sumR } from './dinero';
import { getLocalISODate } from './dateHelpers';

/** R3: número a prueba de NaN. */
export const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

export const TIPOS_VENTA = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA', 'VENTA_COMPLETADA'];
export const TIPOS_COBRO = ['COBRO_DEUDA', 'COBRO_CASHEA'];
export const TIPOS_EGRESO = ['PAGO_PROVEEDOR', 'GASTO_INTERNO'];

/** Umbrales de alerta (Fase C: configurables por negocio). */
export const UMBRAL_DESCUENTO_PCT = 0.15;
export const UMBRAL_DESCUENTO_USD = 5;

const SET_VENTA = new Set(TIPOS_VENTA);
const SET_COBRO = new Set(TIPOS_COBRO);
const SET_EGRESO = new Set(TIPOS_EGRESO);

const _asArray = (v) => (Array.isArray(v) ? v : []);

/** Fecha local YYYY-MM-DD de un registro (igual criterio que supervisionData). */
export function fechaLocal(s, today) {
    if (s && s.timestamp) {
        const d = new Date(s.timestamp);
        if (!Number.isNaN(d.getTime())) return getLocalISODate(d);
    }
    return today;
}

/** Registro válido para cómputos (no anulado, caja no cerrada). */
export function esMovimientoValido(s) {
    return !!s && s.status !== 'ANULADA' && s.cajaCerrada !== true;
}

function _esVenta(s) {
    return esMovimientoValido(s) && SET_VENTA.has(s.tipo);
}

/**
 * Desglose de los pagos de una venta por moneda.
 * Si la venta no trae `payments[]` (registros viejos), el total cae en USD.
 * @returns {{ USD:number, BS:number, COP:number }} (montos en su moneda)
 */
export function desglosePorMoneda(sale) {
    const out = { USD: 0, BS: 0, COP: 0 };
    const payments = _asArray(sale?.payments);
    if (payments.length === 0) {
        out.USD = num(sale?.totalUsd);
        return out;
    }
    for (const p of payments) {
        if (!p) continue;
        const cur = String(p.currency || 'USD').toUpperCase();
        if (cur === 'BS') out.BS = sumR(out.BS, num(p.amountBs));
        else if (cur === 'COP') out.COP = sumR(out.COP, num(p.amountCop));
        else out.USD = sumR(out.USD, num(p.amountUsd));
    }
    return out;
}

/** Etiqueta del método de pago principal de una venta. */
export function metodoPrincipal(sale) {
    const payments = _asArray(sale?.payments);
    const p = payments.find((x) => x && num(x.amountUsd) > 0) || payments[0];
    if (!p) return 'Contado';
    return String(p.methodLabel || p.methodId || 'Otro');
}

/**
 * Plata de hoy: recaudación, tickets, ticket promedio, desglose por moneda y
 * por método de pago, descuentos y anuladas.
 */
export function resumenPlataHoy(sales, today) {
    const porMoneda = { USD: 0, BS: 0, COP: 0 };
    const porMetodo = new Map();
    let totalUsd = 0;
    let count = 0;
    let descuentoUsd = 0;
    let descuentoCount = 0;
    let anuladasCount = 0;
    let anuladasUsd = 0;
    const porHora = new Map();

    for (const s of _asArray(sales)) {
        if (!s) continue;
        const dia = fechaLocal(s, today);
        if (dia !== today) continue;

        if (s.status === 'ANULADA') {
            anuladasCount += 1;
            anuladasUsd = sumR(anuladasUsd, num(s.totalUsd));
            continue;
        }
        if (!esMovimientoValido(s) || !SET_VENTA.has(s.tipo)) continue;

        const t = num(s.totalUsd);
        totalUsd = sumR(totalUsd, t);
        count += 1;

        const mon = desglosePorMoneda(s);
        porMoneda.USD = sumR(porMoneda.USD, mon.USD);
        porMoneda.BS = sumR(porMoneda.BS, mon.BS);
        porMoneda.COP = sumR(porMoneda.COP, mon.COP);

        const metodo = metodoPrincipal(s);
        const prev = porMetodo.get(metodo) || { label: metodo, totalUsd: 0, count: 0 };
        prev.totalUsd = sumR(prev.totalUsd, t);
        prev.count += 1;
        porMetodo.set(metodo, prev);

        const d = num(s.discountAmountUsd);
        if (d > 0) {
            descuentoUsd = sumR(descuentoUsd, d);
            descuentoCount += 1;
        }

        if (s.timestamp) {
            const h = new Date(s.timestamp).getHours();
            if (Number.isFinite(h)) {
                porHora.set(h, sumR(porHora.get(h) || 0, t));
            }
        }
    }

    let mejorHora = null;
    for (const [h, t] of porHora) {
        if (!mejorHora || t > mejorHora.totalUsd) mejorHora = { hora: h, totalUsd: t };
    }

    return {
        totalUsd,
        count,
        ticketPromedio: count > 0 ? totalUsd / count : 0,
        porMoneda,
        porMetodo: [...porMetodo.values()].sort((a, b) => b.totalUsd - a.totalUsd),
        descuentos: { totalUsd: descuentoUsd, count: descuentoCount },
        anuladas: { count: anuladasCount, totalUsd: anuladasUsd },
        mejorHora,
    };
}

/**
 * Fiados en movimiento: otorgados hoy (VENTA_FIADA + porción Cashea de
 * VENTA_CASHEA) vs cobrados hoy (COBRO_DEUDA + COBRO_CASHEA).
 * M-14 (2026-10-01): antes la VENTA_CASHEA no sumaba a otorgado pero la
 * remesa sí sumaba a cobrado — asimétrico.
 */
export function fiadosHoy(sales, today) {
    let otorgadoUsd = 0;
    let otorgadoCount = 0;
    let cobradoUsd = 0;
    let cobradoCount = 0;

    for (const s of _asArray(sales)) {
        if (!esMovimientoValido(s)) continue;
        if (fechaLocal(s, today) !== today) continue;
        if (s.tipo === 'VENTA_FIADA') {
            otorgadoUsd = sumR(otorgadoUsd, num(s.fiadoUsd ?? s.totalUsd));
            otorgadoCount += 1;
        } else if (s.tipo === 'VENTA_CASHEA') {
            // Solo la porción financiada por Cashea es crédito otorgado; la
            // inicial ya entró a caja.
            const cashea = num(s.casheaUsd);
            if (cashea > 0) {
                otorgadoUsd = sumR(otorgadoUsd, cashea);
                otorgadoCount += 1;
            }
        } else if (SET_COBRO.has(s.tipo)) {
            cobradoUsd = sumR(cobradoUsd, Math.abs(num(s.totalUsd)));
            cobradoCount += 1;
        }
    }
    return {
        otorgadoUsd,
        otorgadoCount,
        cobradoUsd,
        cobradoCount,
        netoUsd: sumR(otorgadoUsd, -cobradoUsd),
    };
}

/**
 * Movimiento de caja de hoy (USD canónico).
 * esperado = apertura + ventas cobradas + cobros − egresos.
 * Nota: la venta fiada no trae caja (se resta su porción a crédito).
 * Simplificación documentada: el vuelto ya está neto en `totalUsd`.
 */
export function movimientoCajaHoy(sales, today) {
    let aperturaUsd = 0;
    let ventasCobradasUsd = 0;
    let cobrosUsd = 0;
    let egresosUsd = 0;

    for (const s of _asArray(sales)) {
        if (!esMovimientoValido(s)) continue;
        if (fechaLocal(s, today) !== today) continue;

        if (s.tipo === 'APERTURA_CAJA') {
            aperturaUsd = sumR(aperturaUsd, num(s.totalUsd));
        } else if (SET_VENTA.has(s.tipo)) {
            ventasCobradasUsd = sumR(ventasCobradasUsd, num(s.totalUsd) - num(s.fiadoUsd));
        } else if (SET_COBRO.has(s.tipo)) {
            cobrosUsd = sumR(cobrosUsd, Math.abs(num(s.totalUsd)));
        } else if (SET_EGRESO.has(s.tipo) && s.afectaCaja !== false) {
            egresosUsd = sumR(egresosUsd, Math.abs(num(s.totalUsd)));
        }
    }

    const ingresosUsd = sumR(ventasCobradasUsd, cobrosUsd);
    return {
        aperturaUsd,
        ventasCobradasUsd,
        cobrosUsd,
        ingresosUsd,
        egresosUsd,
        esperadoUsd: sumR(sumR(aperturaUsd, ingresosUsd), -egresosUsd),
    };
}

/**
 * Feed en vivo: últimas ventas ordenadas por hora descendente.
 */
export function feedVentas(sales, limit = 10) {
    return _asArray(sales)
        .filter(_esVenta)
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
        .slice(0, Math.max(0, limit))
        .map((s) => {
            const d = s.timestamp ? new Date(s.timestamp) : null;
            const hh = d && !Number.isNaN(d.getTime())
                ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                : '--:--';
            return {
                id: s.id || `${s.timestamp}-${s.totalUsd}`,
                hora: hh,
                totalUsd: num(s.totalUsd),
                metodo: metodoPrincipal(s),
                cliente: s.customerName || 'Consumidor Final',
                tipo: s.tipo,
                fiado: s.tipo === 'VENTA_FIADA',
            };
        });
}

/** Resumen compacto de un día (para comparativas). */
export function resumenDia(sales, dateStr) {
    let totalUsd = 0;
    let count = 0;
    for (const s of _asArray(sales)) {
        if (!_esVenta(s)) continue;
        if (fechaLocal(s, dateStr) !== dateStr) continue;
        totalUsd = sumR(totalUsd, num(s.totalUsd));
        count += 1;
    }
    return { totalUsd, count };
}

/**
 * Combina resúmenes de `resumenPlataHoy` de varias sedes (consolidado).
 */
export function combinarPlata(resumenes) {
    const acc = {
        totalUsd: 0,
        count: 0,
        porMoneda: { USD: 0, BS: 0, COP: 0 },
        porMetodo: new Map(),
        descuentos: { totalUsd: 0, count: 0 },
        anuladas: { count: 0, totalUsd: 0 },
    };
    for (const r of resumenes) {
        if (!r) continue;
        acc.totalUsd = sumR(acc.totalUsd, num(r.totalUsd));
        acc.count += num(r.count);
        for (const k of ['USD', 'BS', 'COP']) {
            acc.porMoneda[k] = sumR(acc.porMoneda[k], num(r.porMoneda?.[k]));
        }
        for (const m of r.porMetodo || []) {
            const prev = acc.porMetodo.get(m.label) || { label: m.label, totalUsd: 0, count: 0 };
            prev.totalUsd = sumR(prev.totalUsd, num(m.totalUsd));
            prev.count += num(m.count);
            acc.porMetodo.set(m.label, prev);
        }
        acc.descuentos.totalUsd = sumR(acc.descuentos.totalUsd, num(r.descuentos?.totalUsd));
        acc.descuentos.count += num(r.descuentos?.count);
        acc.anuladas.count += num(r.anuladas?.count);
        acc.anuladas.totalUsd = sumR(acc.anuladas.totalUsd, num(r.anuladas?.totalUsd));
    }
    return {
        ...acc,
        ticketPromedio: acc.count > 0 ? acc.totalUsd / acc.count : 0,
        porMetodo: [...acc.porMetodo.values()].sort((a, b) => b.totalUsd - a.totalUsd),
    };
}

/**
 * Alertas de jefe para el día.
 * - anuladas: toda anulada de hoy es alerta alta.
 * - descuento: ticket con descuento ≥15% o ≥$5 → alerta media.
 * - sinApertura: hay ventas pero no se registró APERTURA_CAJA → alerta baja.
 */
export function alertasJefe(sales, today) {
    const alertas = [];
    let anuladasCount = 0;
    let anuladasUsd = 0;
    let hayVentas = false;
    let hayApertura = false;

    for (const s of _asArray(sales)) {
        if (!s || fechaLocal(s, today) !== today) continue;

        if (s.status === 'ANULADA') {
            anuladasCount += 1;
            anuladasUsd = sumR(anuladasUsd, num(s.totalUsd));
            continue;
        }
        if (!esMovimientoValido(s)) continue;
        if (s.tipo === 'APERTURA_CAJA') {
            hayApertura = true;
            continue;
        }
        if (!SET_VENTA.has(s.tipo)) continue;
        hayVentas = true;

        const d = num(s.discountAmountUsd);
        const sub = num(s.cartSubtotalUsd);
        const pct = sub > 0 ? d / sub : 0;
        if (d >= UMBRAL_DESCUENTO_USD || pct >= UMBRAL_DESCUENTO_PCT) {
            alertas.push({
                tipo: 'descuento',
                severidad: 'media',
                titulo: 'Descuento alto en un ticket',
                detalle: `$${d.toFixed(2)} de descuento (${(pct * 100).toFixed(0)}%) · ${s.customerName || 'Consumidor Final'} · ticket $${num(s.totalUsd).toFixed(2)}`,
                ref: s.id,
            });
        }
    }

    if (anuladasCount > 0) {
        alertas.unshift({
            tipo: 'anuladas',
            severidad: 'alta',
            titulo: `${anuladasCount} venta${anuladasCount === 1 ? '' : 's'} anulada${anuladasCount === 1 ? '' : 's'} hoy`,
            detalle: `Monto anulado: $${anuladasUsd.toFixed(2)} — revisar motivo`,
        });
    }
    if (hayVentas && !hayApertura) {
        alertas.push({
            tipo: 'sinApertura',
            severidad: 'baja',
            titulo: 'Caja sin apertura registrada',
            detalle: 'Hay ventas de hoy pero no se registró la apertura de caja',
        });
    }
    return alertas;
}
