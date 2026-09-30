/**
 * syncDelta.js — Sincronización delta para documentos pesados (QUOTA-001).
 *
 * Problema: `bodega_products_v1` (~3MB con 5.000 productos) se re-subía
 * COMPLETO a sync_documents en cada venta, y el monitor lo recibía entero
 * por Realtime (~180MB/día → revienta los 5GB/mes del tier gratis).
 *
 * Solución: separar lo volátil (stock) de lo estable (catálogo).
 *  - `bodega_stock_v1`: mapa liviano `{ productId: stock }` (~40KB).
 *    Se empuja en cada cambio de inventario.
 *  - `bodega_products_v1`: catálogo completo. Solo se empuja cuando cambia
 *    algo que NO sea stock (precio, nombre, foto, alta/baja).
 *
 * Además `bodega_sales_v1` viaja podado a los últimos SALES_SYNC_DAYS días;
 * al recibir se FUSIONA por id (nunca se reemplaza), igual que el ledger.
 *
 * Todo aquí es puro y testeable; el wiring vive en useCloudSync /
 * useMonitorSync.
 */
import { RETENTION } from './retentionPolicy';

// Campos que cambian en cada venta y NO deben disparar el push del catálogo.
const VOLATILE_PRODUCT_FIELDS = new Set(['stock', 'updatedAt']);

function stripVolatile(product) {
    if (!product || typeof product !== 'object') return product;
    const out = {};
    for (const k of Object.keys(product)) {
        if (!VOLATILE_PRODUCT_FIELDS.has(k)) out[k] = product[k];
    }
    return out;
}

/** djb2 sobre string — suficiente para detección de cambios local. */
export function tinyHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return `h${(h >>> 0).toString(36)}`;
}

/**
 * Hash del catálogo ignorando campos volátiles. Si dos arrays difieren solo
 * en stock/updatedAt, el hash es idéntico.
 */
export function catalogHash(products) {
    if (!Array.isArray(products)) return tinyHash('[]');
    const stripped = products.map((p) => {
        const s = stripVolatile(p);
        // Orden estable de claves para que el hash no baile.
        return JSON.stringify(s, Object.keys(s).sort());
    });
    return tinyHash(`[${stripped.join(',')}]`);
}

/** Mapa liviano de stock: { [productId]: stock }. */
export function buildStockMap(products) {
    const map = {};
    if (!Array.isArray(products)) return map;
    for (const p of products) {
        if (p && p.id != null) map[String(p.id)] = Number(p.stock) || 0;
    }
    return map;
}

/** Aplica un mapa de stock sobre el array de productos (merge, no reemplazo). */
export function applyStockMap(products, stockMap) {
    if (!Array.isArray(products) || !stockMap || typeof stockMap !== 'object') {
        return products;
    }
    let changed = false;
    const out = products.map((p) => {
        if (!p || p.id == null) return p;
        const key = String(p.id);
        if (!Object.prototype.hasOwnProperty.call(stockMap, key)) return p;
        const next = Number(stockMap[key]);
        if (!Number.isFinite(next) || next === (Number(p.stock) || 0)) return p;
        changed = true;
        return { ...p, stock: next };
    });
    return changed ? out : products;
}

/** Validador liviano del mapa de stock para STORE_SCHEMAS. */
export function isValidStockMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).every((v) => Number.isFinite(Number(v)));
}

function saleTime(sale) {
    const raw = sale?.timestamp || sale?.fecha;
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
}

/**
 * Poda las ventas a la ventana de sincronización (defecto: 90 días).
 * Lo que se quita de aquí NO se borra del teléfono: el push envía la
 * ventana y el receptor fusiona por id.
 */
export function pruneSalesForSync(sales, days = RETENTION.SALES_SYNC_DAYS) {
    if (!Array.isArray(sales)) return sales;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return sales.filter((s) => saleTime(s) >= cutoff);
}

/**
 * Fusiona ventas remotas con las locales por id (union aditiva).
 * Por id duplicado gana la más nueva por timestamp. Nunca elimina ventas
 * locales: una ventana podada (90 días) no puede borrar historial.
 */
export function mergeSales(localSales, remoteSales) {
    const local = Array.isArray(localSales) ? localSales : [];
    const remote = Array.isArray(remoteSales) ? remoteSales : [];
    if (remote.length === 0) return local;
    if (local.length === 0) return remote;

    const byId = new Map();
    for (const s of local) {
        if (s && s.id != null) byId.set(String(s.id), s);
    }
    const orphans = local.filter((s) => !s || s.id == null);
    for (const s of remote) {
        if (!s || s.id == null) continue;
        const key = String(s.id);
        const prev = byId.get(key);
        if (!prev || saleTime(s) >= saleTime(prev)) byId.set(key, s);
    }
    return [...orphans, ...byId.values()];
}

/** doc_id físico para una clave base dentro de un negocio. */
export function physicalDocId(negocioId, baseKey) {
    return negocioId ? `nb_${negocioId}:${baseKey}` : baseKey;
}
