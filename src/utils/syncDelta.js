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

/**
 * M-6 (2026-10-01): reconcilia un mapa de stock remoto SUMANDO DELTAS en vez
 * de asignar el valor absoluto. El LWW del documento completo perdía los
 * descuentos de ventas concurrentes entre equipos (caja A vendía 2 y caja B
 * vendía 3 del mismo producto: al aplicar el mapa absoluto de B se perdía la
 * venta de A).
 *
 * `lastRemoteMap`: último mapa visto de LA MISMA FUENTE (mismo device_id).
 * El delta por producto (nuevo − anterior) refleja solo la actividad remota
 * entre pushes y se suma al stock local, que ya incluye la actividad propia.
 *
 * Sin mapa previo (primera vez que se ve a esa fuente): se asigna el absoluto
 * (comportamiento anterior, sin regresión) y se siembra el mapa.
 *
 * Retorna { products, nextRemoteMap } — nextRemoteMap se persiste como el
 * "último visto" de esa fuente para el próximo ciclo.
 */
export function applyStockMapDelta(products, stockMap, lastRemoteMap) {
    if (!Array.isArray(products) || !stockMap || typeof stockMap !== 'object') {
        return { products, nextRemoteMap: lastRemoteMap || null, deltas: {} };
    }
    if (!lastRemoteMap || typeof lastRemoteMap !== 'object') {
        // Primera vista de la fuente: solo se siembra el "último visto". El mapa
        // que publica un equipo es stock PROPIO (sin lo recibido de otros); asignarlo
        // pisaría el stock local con un valor incompleto.
        return { products, nextRemoteMap: { ...stockMap }, deltas: {} };
    }
    const deltas = {};
    let changed = false;
    const out = products.map((p) => {
        if (!p || p.id == null) return p;
        const key = String(p.id);
        if (!Object.prototype.hasOwnProperty.call(stockMap, key)) return p;
        if (!Object.prototype.hasOwnProperty.call(lastRemoteMap, key)) return p;
        const delta = Number(stockMap[key]) - Number(lastRemoteMap[key]);
        if (!Number.isFinite(delta) || delta === 0) return p;
        deltas[key] = delta;
        changed = true;
        return { ...p, stock: (Number(p.stock) || 0) + delta };
    });
    return { products: changed ? out : products, nextRemoteMap: { ...stockMap }, deltas };
}

/**
 * Mapa de stock PROPIO a publicar: stock local menos lo recibido de otras fuentes
 * (receivedMap, acumulado por producto). Así el otro equipo solo ve cambios de
 * actividad propia y nunca re-publica deltas ajenos (eco).
 */
export function buildOwnStockMap(products, receivedMap) {
    const map = buildStockMap(products);
    if (!receivedMap || typeof receivedMap !== 'object') return map;
    for (const key of Object.keys(map)) {
        const received = Number(receivedMap[key]);
        if (Number.isFinite(received) && received !== 0) map[key] = map[key] - received;
    }
    return map;
}

// Residuos de punto flotante (p. ej. 1e-11 tras sumar fracciones de granel) se
// tratan como cero para no acumular entradas inútiles.
const RECEIVED_STOCK_EPSILON = 1e-9;

/**
 * Base de "recibido" al adoptar el catálogo de la nube en un equipo nuevo.
 * El stock adoptado ya incluye la actividad de los demás equipos: se marca como
 * recibido para que el stock PROPIO empiece en cero y no se republique como
 * actividad propia (eco). Solo cuenta lo que el equipo vende después.
 */
export function stockBaseAfterAdoption(products) {
    return buildStockMap(products);
}

/** Suma los deltas aplicados de una fuente al acumulado de recibido por producto. */
export function accumulateReceivedStock(receivedMap, deltas) {
    const out = { ...(receivedMap && typeof receivedMap === 'object' ? receivedMap : {}) };
    for (const [key, delta] of Object.entries(deltas || {})) {
        const next = (Number(out[key]) || 0) + Number(delta);
        if (!Number.isFinite(next)) continue;
        if (Math.abs(next) < RECEIVED_STOCK_EPSILON) delete out[key];
        else out[key] = next;
    }
    return out;
}

/**
 * El catálogo remoto trae el stock absoluto del equipo que lo publicó: no debe
 * pisar el stock local. Conserva el stock local por id; los productos sin copia
 * local toman el stock remoto.
 */
export function preserveLocalStock(localProducts, remoteProducts) {
    if (!Array.isArray(remoteProducts) || !Array.isArray(localProducts)) return remoteProducts;
    const localById = new Map();
    for (const p of localProducts) {
        if (p && p.id != null) localById.set(String(p.id), p);
    }
    return remoteProducts.map((p) => {
        if (!p || p.id == null) return p;
        const local = localById.get(String(p.id));
        if (!local || local.stock === undefined) return p;
        return local.stock === p.stock ? p : { ...p, stock: local.stock };
    });
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
 *
 * M-3 (2026-10-01): la anulación es un estado terminal. Si una de las dos
 * versiones está ANULADA (status o voidedAt), gana la anulada aunque su
 * timestamp sea menor: una venta anulada jamás "resucita" por sync.
 */
function isVoidedSale(sale) {
    return sale?.status === 'ANULADA' || sale?.voidedAt != null;
}
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
        if (!prev) {
            byId.set(key, s);
            continue;
        }
        const prevVoid = isVoidedSale(prev);
        const curVoid = isVoidedSale(s);
        if (curVoid && !prevVoid) {
            byId.set(key, s);
            continue;
        }
        if (prevVoid && !curVoid) {
            continue; // la anulación local gana: no resucitar
        }
        if (saleTime(s) >= saleTime(prev)) byId.set(key, s);
    }
    return [...orphans, ...byId.values()];
}

/** doc_id físico para una clave base dentro de un negocio. */
export function physicalDocId(negocioId, baseKey) {
    return negocioId ? `nb_${negocioId}:${baseKey}` : baseKey;
}

/* ─── QUOTA-003: delta diario de ventas (append-only) ──────────────────────
 *
 * Problema: `bodega_sales_v1` se re-subía con la ventana completa de 90 días
 * en cada venta (~16MB por push con 100 ventas/día → 46GB/mes, revienta los
 * 5GB del tier gratis). La poda a 90 días (QUOTA-002) acota la DB pero NO el
 * tráfico: el push seguía siendo O(ventana).
 *
 * Solución: en cada venta solo viaja el DELTA del día
 * (`bodega_sales_delta_YYYY-MM-DD`): los tickets de hoy de este equipo.
 * El receptor fusiona por id con mergeSales (idempotente: los duplicados no
 * hacen daño). La ventana de 90 días se sigue generando pero solo se sube
 * 1 vez al día al cierre (pushSalesWindow) o bajo demanda.
 */

/** Prefijo de las keys de delta diario de ventas. */
export const SALES_DELTA_KEY_PREFIX = 'bodega_sales_delta_';

/** Fecha local YYYY-MM-DD del negocio (sin hora, para partir el delta por día). */
export function salesDayString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Key de delta para un día: `bodega_sales_delta_2026-10-01`. */
export function salesDeltaKeyForDate(dateStr) {
    return `${SALES_DELTA_KEY_PREFIX}${dateStr}`;
}

/** ¿Es esta key un delta diario de ventas? */
export function isSalesDeltaKey(key) {
    return typeof key === 'string'
        && key.startsWith(SALES_DELTA_KEY_PREFIX)
        && /^\d{4}-\d{2}-\d{2}$/.test(key.slice(SALES_DELTA_KEY_PREFIX.length));
}

/** Filtra los tickets cuya fecha de venta cae en el día dado (YYYY-MM-DD local). */
export function filterTicketsForDay(tickets, dateStr) {
    if (!Array.isArray(tickets)) return [];
    return tickets.filter((t) => {
        const ts = saleTime(t);
        if (!ts) return false;
        return salesDayString(new Date(ts)) === dateStr;
    });
}

/**
 * Construye el payload del delta: { date, tickets } con solo los tickets
 * del día. Puro y testeable.
 */
export function buildSalesDeltaPayload(tickets, dateStr) {
    const day = dateStr || salesDayString();
    return { date: day, tickets: filterTicketsForDay(tickets, day) };
}

/**
 * Completa la fecha de un delta legado `{ tickets }` (sin `date`) con la fecha
 * de su clave `bodega_sales_delta_YYYY-MM-DD`. Cualquier otro caso se devuelve
 * sin cambios, así que el validador sigue rechazando lo que no sea un delta.
 */
export function normalizeSalesDeltaPayload(key, payload) {
    if (!isSalesDeltaKey(key)) return payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    if (payload.date !== undefined || !Array.isArray(payload.tickets)) return payload;
    return { ...payload, date: key.slice(SALES_DELTA_KEY_PREFIX.length) };
}

/** Validador del payload del delta para STORE_SCHEMAS / contratos. */
export function isValidSalesDelta(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    if (typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) return false;
    return Array.isArray(payload.tickets);
}

/**
 * Extrae los tickets de un payload de delta ya validado.
 * Acepta tanto el formato nuevo { date, tickets } como un array legacy.
 */
export function salesDeltaTickets(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.tickets)) return payload.tickets;
    return [];
}
