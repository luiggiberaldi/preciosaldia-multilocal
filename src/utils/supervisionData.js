/**
 * supervisionData.js — Lectura cross-negocio de solo lectura (Fase 1.5).
 *
 * La vista Supervisión necesita leer datos de TODOS los negocios sin cambiar
 * el negocio activo. Este módulo lee directamente las claves físicas
 * `nb_<id>:<clave>` desde localforage (IndexedDB `BodegaApp/bodega_app_data`),
 * sin pasar por el router: solo `getItem`, nunca escritura.
 *
 * @module utils/supervisionData
 */
import localforage from 'localforage';
import { NEGOCIO_KEY_PREFIX } from './negocioContext';
import { getLocalISODate } from './dateHelpers';
import { sumR } from './dinero';

// Misma configuración que storageService/appForage (idempotente).
localforage.config({
    name: 'BodegaApp',
    storeName: 'bodega_app_data',
    description: 'Almacenamiento local optimizado para PWA de Bodega',
});

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

const _asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Lee los datos operativos de un negocio (ventas, clientes, productos).
 * Solo lectura: no modifica el negocio activo ni escribe nada.
 *
 * @param {string} negocioId
 * @returns {Promise<{ sales: array, customers: array, products: array }>}
 */
export async function readNegocioData(negocioId) {
    const prefix = `${NEGOCIO_KEY_PREFIX}${negocioId}:`;
    const [sales, customers, products] = await Promise.all([
        localforage.getItem(prefix + SALES_KEY),
        localforage.getItem(prefix + CUSTOMERS_KEY),
        localforage.getItem(prefix + PRODUCTS_KEY),
    ]);
    return {
        sales: _asArray(sales),
        customers: _asArray(customers),
        products: _asArray(products),
    };
}

/** Tipos de movimiento que cuentan como venta (mismo criterio que useDashboardMetrics). */
const VENTA_TIPOS = new Set(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);

function _weekStartStr(today) {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 6);
    return getLocalISODate(d);
}

/**
 * Resumen de ventas por sede: hoy, últimos 7 días, mes en curso y ticket promedio.
 * Usa el mismo criterio de filtrado que `useDashboardMetrics` (excluye
 * anuladas y caja cerrada).
 *
 * @param {array} sales - Ventas crudas del negocio.
 * @param {string} [today] - Fecha local YYYY-MM-DD (default: hoy).
 * @returns {{ todayTotalUsd:number, todayCount:number, weekTotalUsd:number, monthTotalUsd:number, ticketAvgUsd:number }}
 */
export function summarizeSales(sales, today = getLocalISODate()) {
    const monthPrefix = today.slice(0, 7);
    const weekStart = _weekStartStr(today);
    let todayTotalUsd = 0;
    let todayCount = 0;
    let weekTotalUsd = 0;
    let monthTotalUsd = 0;

    for (const s of sales || []) {
        if (!s || s.status === 'ANULADA' || s.cajaCerrada === true) continue;
        if (!VENTA_TIPOS.has(s.tipo)) continue;
        const localDate = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : today;
        const total = Number(s.totalUsd) || 0;
        if (localDate === today) {
            todayTotalUsd = sumR(todayTotalUsd, total);
            todayCount += 1;
        }
        if (localDate >= weekStart && localDate <= today) {
            weekTotalUsd = sumR(weekTotalUsd, total);
        }
        if (localDate.slice(0, 7) === monthPrefix) {
            monthTotalUsd = sumR(monthTotalUsd, total);
        }
    }

    return {
        todayTotalUsd,
        todayCount,
        weekTotalUsd,
        monthTotalUsd,
        ticketAvgUsd: todayCount > 0 ? todayTotalUsd / todayCount : 0,
    };
}
