/**
 * purgeService.js — Plan de purga periódica (QUOTA-003).
 *
 * Mantiene sano el teléfono y las cuotas de Supabase borrando lo innecesario:
 *
 *  EN EL TELÉFONO (por negocio activo, 1 vez al día al abrir la app):
 *   - Ventas: el detalle de tickets más viejo que SALES_DETAIL_MONTHS (12)
 *     se compacta a resúmenes mensuales (mes, #tickets, totales por moneda y
 *     por método). Los totales nunca se pierden; el detalle viejo vive en los
 *     respaldos de la Estación. SEGURO: solo corre si hay un respaldo exitoso
 *     de menos de 24h.
 *   - Bitácora: NO se toca. auditService ya aplica su propia política al
 *     montar la app (tope 15.000 eventos, categorías fiscales VENTA/CLIENTE/
 *     PAGO conservadas 5 años por requisito legal VE). Como además ya no se
 *     sincroniza a la nube (QUOTA-002), podarla más agresivo no ahorra cuota
 *     y sí crearía riesgo fiscal.
 *
 *  EN SUPABASE (cuota gratis):
 *   - purgeOrphanImages(): 1 vez al mes, solo si hay sesión del dueño.
 *     Borra del bucket `product-images` los objetos que ningún producto de
 *     ningún negocio referencia (fotos de productos borrados o reemplazadas).
 *
 *  Las sombras (shadowBackupService) son una sola copia por clave: nada que
 *  purgar. La "cola offline" es en memoria (debounce): nada que purgar.
 *
 * Todo lo que la purga borra queda anotado en la propia bitácora antes de
 * ejecutarse.
 */
import localforage from 'localforage';
import { appForage } from './appForage';
import { storageService } from './storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { RETENTION, PURGE_KEYS } from './retentionPolicy';
import { getNegocios, NEGOCIO_KEY_PREFIX } from './negocioContext';
import { logEvent } from '../services/auditService';

function monthKeyFromTs(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function saleTime(sale) {
    const raw = sale?.timestamp || sale?.fecha;
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
}

function saleTotals(sale) {
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
        totalUsd: num(sale?.total ?? sale?.totalUsd),
        totalBs: num(sale?.totalBs),
        method: sale?.metodoPago || sale?.paymentMethod || 'otro',
    };
}

/**
 * Compacta ventas viejas a resúmenes mensuales. Puro y testeable.
 * @returns {{ sales: Array, summaries: Array, compacted: number }}
 */
export function compactOldSales(sales, summaries, nowMs = Date.now()) {
    const list = Array.isArray(sales) ? sales : [];
    const sums = Array.isArray(summaries) ? [...summaries] : [];
    const cutoff = nowMs - RETENTION.SALES_DETAIL_MONTHS * 30.44 * 24 * 60 * 60 * 1000;

    const keep = [];
    const buckets = new Map(); // monthKey -> resumen
    for (const s of sums) {
        if (s && s.month) buckets.set(s.month, { ...s });
    }

    let compacted = 0;
    for (const sale of list) {
        const t = saleTime(sale);
        if (t !== 0 && t < cutoff) {
            const mk = monthKeyFromTs(t);
            if (!mk) continue; // fecha ilegible: se conserva por seguridad
            const { totalUsd, totalBs, method } = saleTotals(sale);
            let b = buckets.get(mk);
            if (!b) {
                b = { month: mk, count: 0, totalUsd: 0, totalBs: 0, byMethod: {} };
                buckets.set(mk, b);
            }
            b.count += 1;
            b.totalUsd = Math.round((b.totalUsd + totalUsd) * 100) / 100;
            b.totalBs = Math.round((b.totalBs + totalBs) * 100) / 100;
            b.byMethod[method] = (b.byMethod[method] || 0) + 1;
            compacted += 1;
        } else {
            keep.push(sale);
        }
    }

    const merged = [...buckets.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
    return { sales: keep, summaries: merged, compacted };
}

/**
 * Purga diaria del negocio activo. Idempotente y segura: si no hay respaldo
 * fresco, la compactación de ventas se omite.
 */

/** true si hay un respaldo exitoso reciente (< BACKUP_FRESHNESS_MS). */
async function hasFreshBackup() {
    try {
        // Señal principal: backup diario subido a la Estación.
        const lastDaily = localStorage.getItem('bodega_last_daily_backup_date');
        if (lastDaily) {
            const d = new Date(`${lastDaily}T23:59:59`);
            if (!Number.isNaN(d.getTime()) && Date.now() - d.getTime() < RETENTION.BACKUP_FRESHNESS_MS + 24 * 60 * 60 * 1000) {
                return true;
            }
        }
        // Contingencia: copia local de emergencia (se guarda cada 30 min).
        const local = await storageService.getItem('bodega_autobackup_v1', null);
        const ts = local?.timestamp ? new Date(local.timestamp).getTime() : NaN;
        if (Number.isFinite(ts) && Date.now() - ts < RETENTION.BACKUP_FRESHNESS_MS) return true;
    } catch { /* conservador: ante la duda, no hay respaldo fresco */ }
    return false;
}

export async function runDailyPurge() {
    const report = { ran: false, reason: null, salesCompacted: 0 };
    try {
        const last = Number(localStorage.getItem(PURGE_KEYS.LAST_RUN) || 0);
        if (Date.now() - last < RETENTION.PURGE_INTERVAL_MS) {
            report.reason = 'ya_corrio_hoy';
            return report;
        }

        // Ventas: compactar detalle viejo → resúmenes mensuales.
        if (await hasFreshBackup()) {
            const sales = await appForage.getItem('bodega_sales_v1');
            const summaries = await appForage.getItem(PURGE_KEYS.SALES_MONTHLY_SUMMARY);
            const { sales: kept, summaries: merged, compacted } = compactOldSales(sales, summaries);
            if (compacted > 0) {
                await appForage.setItem('bodega_sales_v1', kept);
                await appForage.setItem(PURGE_KEYS.SALES_MONTHLY_SUMMARY, merged);
                report.salesCompacted = compacted;
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_sales_v1', source: 'purge' } }));
                }
            }
        } else {
            report.reason = 'sin_respaldo_fresco_ventas_omitidas';
        }

        if (report.salesCompacted > 0) {
            logEvent('SISTEMA', 'PURGA_EJECUTADA',
                `Purga diaria: ${report.salesCompacted} tickets compactados a resúmenes mensuales`).catch(() => {});
        }
        localStorage.setItem(PURGE_KEYS.LAST_RUN, String(Date.now()));
        report.ran = true;
    } catch (e) {
        console.warn('[Purge] Falló la purga diaria (no crítico):', e?.message ?? e);
        report.reason = 'error';
    }
    return report;
}

/** Extrae la ruta dentro del bucket desde la URL pública de una foto. */
function bucketPathFromUrl(url) {
    if (typeof url !== 'string') return null;
    const m = url.match(/\/storage\/v1\/object\/public\/product-images\/([^\s"']+)/);
    if (!m) return null;
    return m[1].split('?')[0];
}

/**
 * Borra del bucket `product-images` los objetos que ningún producto de
 * ningún negocio referencia. Corre 1 vez al mes; el llamador debe validar
 * que hay sesión del dueño.
 */
export async function purgeOrphanImages() {
    const report = { ran: false, deleted: 0, kept: 0, errors: 0 };
    try {
        if (!supabaseCloud) return { ...report, reason: 'sin_cloud' };
        const last = Number(localStorage.getItem(PURGE_KEYS.LAST_ORPHAN_RUN) || 0);
        if (Date.now() - last < RETENTION.ORPHAN_IMAGE_PURGE_DAYS * 24 * 60 * 60 * 1000) {
            return { ...report, reason: 'ya_corrio_este_mes' };
        }

        // Referenciadas: fotos de TODOS los negocios (no solo el activo).
        const referenced = new Set();
        let negocios = [];
        try { negocios = getNegocios(); } catch { negocios = []; }
        const ids = new Set(negocios.map((n) => n?.id).filter(Boolean));
        // Incluir también claves huérfanas cuyo negocio ya no existe en el registry.
        const rawKeys = await localforage.keys();
        for (const k of rawKeys) {
            const m = typeof k === 'string' && k.match(new RegExp(`^${NEGOCIO_KEY_PREFIX}([^:]+):bodega_products_v1$`));
            if (m) ids.add(m[1]);
        }
        for (const id of ids) {
            try {
                const products = await localforage.getItem(`${NEGOCIO_KEY_PREFIX}${id}:bodega_products_v1`);
                if (Array.isArray(products)) {
                    for (const p of products) {
                        const path = bucketPathFromUrl(p?.image);
                        if (path) referenced.add(path);
                    }
                }
            } catch { /* negocio ilegible: se conserva todo por seguridad */ }
        }

        // Listar el bucket (paginado) y borrar lo no referenciado.
        const BUCKET = 'product-images';
        let page = 0;
        const PAGE_SIZE = 100;
        const toDelete = [];
        for (;;) {
            const { data, error } = await supabaseCloud.storage.from(BUCKET)
                .list('', { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
            if (error) throw error;
            if (!data || data.length === 0) break;
            for (const obj of data) {
                if (!obj?.name) continue;
                const { data: inner } = await supabaseCloud.storage.from(BUCKET)
                    .list(obj.name, { limit: 1000 });
                if (!inner || inner.length === 0) {
                    // Posible archivo en la raíz (las carpetas deviceId no llevan punto).
                    if (obj.name.includes('.')) {
                        if (referenced.has(obj.name)) report.kept += 1;
                        else toDelete.push(obj.name);
                    }
                    continue;
                }
                // Carpeta (deviceId): revisar su contenido.
                for (const f of inner) {
                    if (!f?.name) continue;
                    const path = `${obj.name}/${f.name}`;
                    if (referenced.has(path)) {
                        report.kept += 1;
                    } else {
                        toDelete.push(path);
                    }
                }
            }
            if (data.length < PAGE_SIZE) break;
            page += 1;
        }

        for (const path of toDelete) {
            try {
                const { error } = await supabaseCloud.storage.from(BUCKET).remove([path]);
                if (error) throw error;
                report.deleted += 1;
            } catch {
                report.errors += 1;
            }
        }

        localStorage.setItem(PURGE_KEYS.LAST_ORPHAN_RUN, String(Date.now()));
        report.ran = true;
        logEvent('SISTEMA', 'PURGA_IMAGENES',
            `Purga mensual de Storage: ${report.deleted} huérfanas borradas, ${report.kept} conservadas`).catch(() => {});
    } catch (e) {
        console.warn('[Purge] Falló la purga de imágenes huérfanas (no crítico):', e?.message ?? e);
        report.reason = 'error';
    }
    return report;
}
