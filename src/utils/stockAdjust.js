import { storageService } from './storageService.js';
import { round0, round3, divR } from './dinero.js';
import { isGranelProduct } from './granel.js';
import { withLock } from './withLock.js';
import { logEvent } from '../services/auditService.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';

const PRODUCTS_KEY = 'bodega_products_v1';

/**
 * Ajuste de stock compartido (ventas, anuls y consumos de nómina).
 *
 * Replica las reglas del descuento inline de `processSaleTransaction`:
 * re-lee productos frescos, respeta `allow_negative_stock`, granel a 3
 * decimales y el resto entero, y audita el uso de stock negativo.
 *
 * @param {Array} items - [{ productId, qty, isWeight?, _mode?, _unitsPerPackage? }]
 * @param {number} signo -1 para deducir (venta/consumo), +1 para devolver (anulación)
 * @param {string} auditLabel - etiqueta para el log de stock negativo (ej 'Consumo de nómina')
 * @returns {Promise<{ok:boolean, updatedProducts:Array, negativeItems:Array}>}
 */
export async function adjustStockForItems(items, signo = -1, auditLabel = 'Ajuste de stock') {
    if (!Array.isArray(items) || items.length === 0) {
        return { ok: true, updatedProducts: null, negativeItems: [] };
    }
    return withLock('pos_write_lock', async () => {
        const freshProducts = await storageService.getItem(PRODUCTS_KEY, []);
        const allowNeg = (() => { try { return localStorage.getItem('allow_negative_stock') === 'true'; } catch { return false; } })();
        let negativeStockUsed = false;
        const negativeItems = [];

        const updatedProducts = freshProducts.map((p) => {
            const itemsForProduct = items.filter((i) => (i.productId || i._originalId || i.id) === p.id);
            if (itemsForProduct.length === 0) return p;
            const totalQty = itemsForProduct.reduce((sum, item) => {
                if (item.isWeight) return round3(sum + item.qty);
                if (item._mode === 'unit') return round3(sum + divR(item.qty, item._unitsPerPackage || 1));
                return round3(sum + item.qty);
            }, 0);
            const newStock = isGranelProduct(p)
                ? round3((p.stock ?? 0) + signo * totalQty)
                : round0((p.stock ?? 0) + signo * totalQty);
            if (newStock < 0 && allowNeg) {
                negativeStockUsed = true;
                negativeItems.push({ productId: p.id, name: p.name, stockBefore: p.stock ?? 0, qty: totalQty, signo, stockAfter: newStock });
            }
            return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
        });

        if (negativeStockUsed) {
            const user = (() => { try { return useAuthStore.getState().usuarioActivo; } catch { return null; } })();
            logEvent('CONFIG', 'NEGATIVE_STOCK_USED',
                `${auditLabel} usó stock negativo en ${negativeItems.length} producto(s)`,
                user, { items: negativeItems });
        }

        await storageService.setItem(PRODUCTS_KEY, updatedProducts);
        return { ok: true, updatedProducts, negativeItems };
    });
}
