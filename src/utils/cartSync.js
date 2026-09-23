/**
 * cartSync.js — Re-sincronización viva cesta ↔ inventario (SYNC-CESTA-001).
 *
 * Problema que resuelve:
 *   `addToCart` (SalesView) guarda una COPIA del producto dentro del ítem de
 *   cesta. Editar el producto en inventario (precio USD/COP, doble precio,
 *   costos) NO llegaba a las líneas ya cargadas: el cajero debía eliminar y
 *   re-agregar, y una corrección de precio con la cesta armada no se reflejaba
 *   en el cobro.
 *
 * Solución:
 *   - `deriveCartFields`: ÚNICA fuente de verdad de los campos derivados de una
 *     línea (misma fórmula que usa `addToCart`).
 *   - `resyncCartItems`: función pura que refresca la cesta contra el catálogo
 *     vigente y devuelve `null` cuando NADA cambió — el caller no hace setState,
 *     así que es inmune a loops de render y a StrictMode.
 *
 * Guardarraíles:
 *   - No toca `qty`, `id`, `_mode`, `_unitsPerPackage`, `isWeight`: el modo de
 *     venta ya elegido no se retro-cambia aunque el producto mutó.
 *   - Venta libre (custom) y avances de efectivo se excluyen.
 *   - Producto eliminado del catálogo → `_productMissing: true`; la línea
 *     sobrevive (puede ser una venta en curso).
 *   - Sin dependencias de React.
 */

import { round0 } from './dinero.js';

const CUSTOM_ID_PREFIX = 'custom_';

/** Líneas que no provienen del catálogo (venta libre / avance de efectivo). */
export function isSyntheticCartLine(item) {
    if (!item) return true;
    if (item.isCashAdvance === true) return true;
    return String(item.id || '').startsWith(CUSTOM_ID_PREFIX)
        || String(item._originalId || '').startsWith(CUSTOM_ID_PREFIX);
}

/** Nombre de la línea según el modo de venta (paridad con addToCart). */
export function cartLineName(baseName, mode) {
    return mode === 'unit' ? `${baseName} (Ud.)` : baseName;
}

/**
 * Campos derivados de una línea de cesta a partir del producto del catálogo.
 * MISMA fórmula que `addToCart`; si una cambia, la otra también.
 *
 * @param {object} product        Producto del catálogo (vigente).
 * @param {'package'|'unit'} mode Modo de venta de la línea.
 * @param {number} unitsPerPackage Unidades por empaque de la línea.
 * @param {{tasaCop?: number, effectiveRate?: number}} ctx
 */
export function deriveCartFields(product, mode, unitsPerPackage, ctx = {}) {
    const tasaCop = Number(ctx.tasaCop) || 0;
    const effectiveRate = Number(ctx.effectiveRate) || 0;
    const isUnit = mode === 'unit';
    const perPackage = Number(product?.unitsPerPackage) || 1;

    let priceUsd;
    let priceCop;
    if (isUnit) {
        const unitCop = product.unitPriceCop
            || (product.priceCop ? round0(product.priceCop / perPackage) : null);
        priceCop = unitCop || null;
        priceUsd = (unitCop && tasaCop > 0) ? unitCop / tasaCop : product.unitPriceUsd;
    } else {
        priceCop = product.priceCop || null;
        priceUsd = (product.priceCop && tasaCop > 0)
            ? product.priceCop / tasaCop
            : (parseFloat(product.priceUsdt) || 0); // eslint-disable-line no-restricted-syntax -- paridad exacta con addToCart: el precio del catálogo ya viene normalizado
    }

    const packageCostUsd = product.costUsd || 0;
    const packageCostBs = product.costBs || (product.costUsd ? product.costUsd * effectiveRate : 0);

    return {
        priceUsd,
        priceCop,
        exactBs: product.exactBs || null,
        costUsd: isUnit ? packageCostUsd / perPackage : packageCostUsd,
        costBs: isUnit ? packageCostBs / perPackage : packageCostBs,
        pricingMode: product.pricingMode,
        priceBsUsdRef: product.priceBsUsdRef,
        sellByUnit: product.sellByUnit,
        unitPriceUsd: product.unitPriceUsd,
        unitPriceCop: product.unitPriceCop,
        unitsPerPackage: product.unitsPerPackage,
    };
}

/**
 * Refresca los campos de pricing de cada línea contra el catálogo vigente.
 *
 * @param {Array} cart      Ítems actuales de la cesta.
 * @param {Array} products  Catálogo vigente.
 * @param {{tasaCop?: number, effectiveRate?: number}} ctx
 * @returns {{cart: Array, priceChanges: Array<{name: string, from: number, to: number}>} | null}
 *   `null` si no hubo ningún cambio (el caller NO debe hacer setState).
 */
export function resyncCartItems(cart, products, ctx = {}) {
    if (!Array.isArray(cart) || cart.length === 0) return null;
    // Catálogo vacío = carga en curso o sin datos: no marcar todo como faltante.
    if (!Array.isArray(products) || products.length === 0) return null;

    const byId = new Map(products.map(p => [String(p?.id), p]));
    const priceChanges = [];
    let changed = false;

    const next = cart.map((item) => {
        if (!item || isSyntheticCartLine(item)) return item;

        const product = byId.get(String(item._originalId || item.id));

        if (!product) {
            if (item._productMissing) return item;
            changed = true;
            return { ...item, _productMissing: true };
        }

        const fresh = deriveCartFields(product, item._mode, item._unitsPerPackage, ctx);
        const fieldsChanged = Object.keys(fresh).some(k => !Object.is(item[k], fresh[k]));
        const nextName = cartLineName(product.name, item._mode);
        const nameChanged = typeof product.name === 'string' && item.name !== nextName;

        if (!fieldsChanged && !nameChanged && !item._productMissing) return item;

        if (!Object.is(item.priceUsd, fresh.priceUsd)) {
            priceChanges.push({
                name: product.name,
                from: Number(item.priceUsd) || 0,
                to: Number(fresh.priceUsd) || 0,
            });
        }

        changed = true;
        const updated = { ...item, ...fresh };
        if (nameChanged) updated.name = nextName;
        // El producto volvió al catálogo: la línea deja de estar marcada.
        if (updated._productMissing) delete updated._productMissing;
        return updated;
    });

    return changed ? { cart: next, priceChanges } : null;
}
