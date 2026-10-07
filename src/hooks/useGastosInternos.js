import { useState, useCallback, useRef } from 'react';
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { subR, sumR, mulR } from '../utils/dinero';
import { isGranelProduct, adjustStockValue } from '../utils/granel'; // GRANEL-001
import { showToast } from '../components/Toast';
import { useAuthStore } from './store/useAuthStore';

const SALES_KEY    = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

export const GASTO_CATEGORIES = [
    { id: 'insumos',      label: 'Insumos',          icon: '📦' },
    { id: 'servicios',    label: 'Servicios',         icon: '💡' },
    { id: 'transporte',   label: 'Transporte',        icon: '🚗' },
    { id: 'personal',     label: 'Personal',          icon: '👤' },
    { id: 'mantenimiento',label: 'Mantenimiento',     icon: '🔧' },
    { id: 'autoconsumo',  label: 'Autoconsumo',       icon: '🏠' },
    { id: 'otros',        label: 'Otros',             icon: '📝' },
];

export function useGastosInternos({ bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog, sales, setSales }) {
    const [isAddGastoOpen, setIsAddGastoOpen] = useState(false);
    // ALTO-3/ALTO-4 (2026-10-01): guardia anti doble-submit / doble-tap.
    // Un ref (no state) para que el segundo tap vea el flag aunque no haya re-render.
    const inFlightRef = useRef(new Set());
    // Estado para deshabilitar botones en el modal mientras se procesa.
    const [isSubmitting, setIsSubmitting] = useState(false);

    // ─── Gasto de caja normal (sin movimiento de inventario) ────────────────
    const registrarGasto = useCallback(async ({ description, category, amountUsd, amountBs, methodId, currency, note }) => {
        // ALTO-3: doble-submit duplicaba el gasto (o el segundo write pisaba al
        // primero por usar el `sales` stale del closure).
        if (inFlightRef.current.has('gasto')) return false;
        inFlightRef.current.add('gasto');
        setIsSubmitting(true);
        try {
            triggerHaptic && triggerHaptic();

            if (!description.trim() || (!amountUsd && !amountBs)) {
                showToast('Descripción y monto requeridos', 'warning');
                return false;
            }

            const totalEnBs  = currency === 'BS'  ? amountBs  : (amountUsd * bcvRate);
            const totalEnUsd = currency === 'USD' ? amountUsd : (bcvRate > 0 ? amountBs / bcvRate : 0);
            const totalEnCop = currency === 'COP' ? amountBs  : (amountUsd * tasaCop);

            const newGasto = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                tipo: 'GASTO_INTERNO',
                cajaCerrada: false,
                afectaCaja: true,
                description: description.trim(),
                category: category,
                note: note?.trim() || '',
                totalBs:  -totalEnBs,
                totalUsd: -totalEnUsd,
                ...(copEnabled && { totalCop: -totalEnCop }),
                paymentMethod: methodId,
                payments: [{
                    methodId:  methodId,
                    amountUsd: currency === 'USD' ? -totalEnUsd : 0,
                    amountBs:  currency === 'BS'  ? -totalEnBs  : 0,
                    ...(copEnabled && { amountCop: currency === 'COP' ? -totalEnCop : 0 }),
                    currency:    currency,
                    methodLabel: 'Gasto Interno'
                }],
                items: [{
                    name:     `Gasto: ${description.trim()}`,
                    qty:      1,
                    priceUsd: -totalEnUsd,
                    costBs:   0
                }]
            };

            // Leer frescos aquí: el `sales` del closure puede estar stale si dos
            // submits se encolan antes del re-render.
            const freshSales = await storageService.getItem(SALES_KEY, []);
            const updatedSales = [newGasto, ...freshSales];
            await storageService.setItem(SALES_KEY, updatedSales);
            setSales(updatedSales);

            showToast('Gasto registrado con éxito', 'success');
            auditLog('CAJA', 'REGISTRO_GASTO', `Gasto registrado: "${description}" - $${totalEnUsd.toFixed(2)}`);
            setIsAddGastoOpen(false);
            return true;
        } finally {
            inFlightRef.current.delete('gasto');
            setIsSubmitting(false);
        }
    }, [sales, setSales, bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog]);

    // ─── Autoconsumo: retiro de mercancía por el dueño ──────────────────────
    /**
     * @param {Object} params
     * @param {string}  params.description   - Descripción editable generada automáticamente
     * @param {Array}   params.items         - [{ id, name, qty, costUsd, priceUsd }]
     * @param {'costo'|'venta'} params.valoracion - Criterio de valoración del retiro
     * @param {string}  params.note          - Nota opcional
     * @param {number}  params.totalUsd      - Total ya calculado externamente
     * @param {number}  params.totalBs       - Total ya calculado externamente
     */
    const registrarAutoconsumo = useCallback(async ({ description, items, valoracion = 'costo', note, totalUsd, totalBs }) => {
        // ALTO-3: el retiro deduce stock; un doble-submit lo deduciría dos veces.
        if (inFlightRef.current.has('autoconsumo')) return false;
        inFlightRef.current.add('autoconsumo');
        setIsSubmitting(true);
        try {
            triggerHaptic && triggerHaptic();

            if (!items || items.length === 0) {
                showToast('Selecciona al menos un producto', 'warning');
                return false;
            }

            const result = await withLock('pos_write_lock', async () => {
            // 1. Leer productos frescos de IndexedDB
            const freshProducts = await storageService.getItem(PRODUCTS_KEY, []);
            const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';

            // 2. Deducir stock — GRANEL-001: granel conserva 3 decimales, resto entero.
            const updatedProducts = freshProducts.map(p => {
                const cartItem = items.find(i => i.id === p.id);
                if (!cartItem) return p;
                const newStock = adjustStockValue(p.stock ?? 0, -cartItem.qty, isGranelProduct(p));
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
            });

            await storageService.setItem(PRODUCTS_KEY, updatedProducts);

            // 3. Crear registro de gasto
            const gasto = {
                id:           crypto.randomUUID(),
                timestamp:    new Date().toISOString(),
                tipo:         'GASTO_INTERNO',
                category:     'autoconsumo',
                isAutoconsumo: true,
                afectaCaja:   false,       // NO afecta el cuadre de caja física
                cajaCerrada:  false,
                valoracion,
                description:  description.trim(),
                note:         note?.trim() || '',
                totalUsd:     -Math.abs(totalUsd),
                totalBs:      -Math.abs(totalBs),
                ...(copEnabled && { totalCop: -(Math.abs(totalUsd) * tasaCop) }),
                paymentMethod: 'autoconsumo',
                payments: [{
                    methodId:    'autoconsumo',
                    amountUsd:   -Math.abs(totalUsd),
                    amountBs:    -Math.abs(totalBs),
                    currency:    'USD',
                    methodLabel: 'Autoconsumo de Inventario'
                }],
                // Guardamos los ítems con su qty para poder revertir el stock al anular
                items: items.map(i => ({
                    id:       i.id,
                    name:     i.name,
                    qty:      i.qty,
                    costUsd:  i.costUsd  || 0,
                    priceUsd: i.priceUsd || 0,
                })),
            };

            // 4. Guardar en sales (leer frescos aquí para no pisar otros writes)
            const freshSales = await storageService.getItem(SALES_KEY, []);
            const updatedSales = [gasto, ...freshSales];
            await storageService.setItem(SALES_KEY, updatedSales);

            return { gasto, updatedSales };
        });

        if (result) {
            setSales(result.updatedSales);
            showToast('Retiro de inventario registrado', 'success');
            auditLog('CAJA', 'AUTOCONSUMO', `Retiro de ${items.length} producto(s) - $${Math.abs(totalUsd).toFixed(2)}`);
            setIsAddGastoOpen(false);
            return true;
        }

        showToast('Error al registrar el retiro', 'error');
        return false;
        } finally {
            inFlightRef.current.delete('autoconsumo');
            setIsSubmitting(false);
        }
    }, [sales, setSales, bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog]);

    // ─── Anulación (con reversión de stock si es autoconsumo) ───────────────
    const anularGasto = useCallback(async (gastoId) => {
        // ALTO-4: doble-tap en "Sí, Anular" devolvía el stock dos veces.
        const voidKey = `void:${gastoId}`;
        if (inFlightRef.current.has(voidKey)) return false;
        inFlightRef.current.add(voidKey);
        setIsSubmitting(true);
        try {
        triggerHaptic && triggerHaptic();

        // Guard de seguridad: Cajeros no pueden borrar/anular gastos
        const authState = useAuthStore.getState();
        if (authState?.requireLogin && authState?.usuarioActivo?.rol === 'CAJERO') {
            showToast('Los cajeros no tienen permiso para anular gastos', 'warning');
            return false;
        }

        // Leer fresco: el `sales` del closure puede no reflejar una anulación
        // que ya se procesó (doble-tap antes del re-render).
        const freshSales = await storageService.getItem(SALES_KEY, []);
        const targetGasto = freshSales.find(s => s.id === gastoId);
        if (!targetGasto) return false;
        // ALTO-4: idempotente — un gasto ya anulado no devuelve stock otra vez.
        if (targetGasto.status === 'ANULADA') return false;

        // Si es autoconsumo, devolver el stock
        if (targetGasto.isAutoconsumo && Array.isArray(targetGasto.items)) {
            await withLock('pos_write_lock', async () => {
                const freshProducts = await storageService.getItem(PRODUCTS_KEY, []);
                const restored = freshProducts.map(p => {
                    const item = targetGasto.items.find(i => i.id === p.id);
                    if (!item) return p;
                    // GRANEL-001: restauración sin drift, 3 decimales solo para granel.
                    return { ...p, stock: adjustStockValue(p.stock ?? 0, item.qty, isGranelProduct(p)) };
                });
                await storageService.setItem(PRODUCTS_KEY, restored);
            });
        }

        const updatedSales = freshSales.map(s => {
            if (s.id === gastoId) {
                return { ...s, status: 'ANULADA', voidedAt: new Date().toISOString() };
            }
            return s;
        });

        await storageService.setItem(SALES_KEY, updatedSales);
        setSales(updatedSales);

        const label = targetGasto.isAutoconsumo ? 'Autoconsumo anulado y stock devuelto' : 'Gasto anulado con éxito';
        showToast(label, 'success');
        auditLog('CAJA', 'ANULAR_GASTO', `Gasto anulado: "${targetGasto.description}"`);
        return true;
        } finally {
            inFlightRef.current.delete(voidKey);
            setIsSubmitting(false);
        }
    }, [sales, setSales, triggerHaptic, auditLog]);

    return {
        isAddGastoOpen,
        setIsAddGastoOpen,
        isSubmitting,
        registrarGasto,
        registrarAutoconsumo,
        anularGasto,
        categories: GASTO_CATEGORIES
    };
}
