import { useCallback, useRef } from 'react';

const getLocalISODate = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const fmt = (n) => new Intl.NumberFormat('es-CO').format(Math.round(n));

/**
 * Hook de notificaciones 2.0 — datos reales, mensajes útiles.
 */
export function useNotifications() {
    const permissionRef = useRef(
        typeof window !== 'undefined' && 'Notification' in window
            ? Notification.permission
            : 'denied'
    );

    const requestPermission = useCallback(async () => {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') {
            permissionRef.current = 'granted';
            return true;
        }
        const result = await Notification.requestPermission();
        permissionRef.current = result;
        return result === 'granted';
    }, []);

    const send = useCallback((title, body, tag) => {
        if (permissionRef.current !== 'granted' && Notification.permission !== 'granted') return;
        try {
            new Notification(title, {
                body,
                icon: '/apple-touch-icon.png',
                badge: '/apple-touch-icon.png',
                tag,
                vibrate: [100, 50, 100],
            });
        } catch (e) {
            // HOOK-031: antes catch silencioso. Loguear en dev para detectar
            // configuraciones con solo-ServiceWorker o permisos revocados.
            if (import.meta.env?.DEV) {
                console.warn('[useNotifications] send falló (probable SW-only env):', e);
            }
        }
    }, []);

    // ── 1. Stock bajo / agotado ──────────────────────────────────────────────
    const notifyLowStock = useCallback((products) => {
        const agotados = products.filter(p => (parseFloat(p.stock) || 0) <= 0);
        const bajos = products.filter(p => {
            const stock = parseFloat(p.stock) || 0;
            const threshold = parseFloat(p.lowStockAlert) || 5;
            return stock > 0 && stock <= threshold;
        });

        // Agotados primero
        if (agotados.length === 1) {
            const p = agotados[0];
            send(
                '🚨 Producto Agotado',
                `${p.name} — sin stock. Considera reponer antes de la próxima venta.`,
                `agotado-${p.id}`
            );
        } else if (agotados.length > 1) {
            send(
                `🚨 ${agotados.length} Productos Agotados`,
                agotados.slice(0, 3).map(p => p.name).join(', ') + (agotados.length > 3 ? ` y ${agotados.length - 3} más` : ''),
                'agotado-batch'
            );
        }

        // Stock bajo (pero no cero)
        if (bajos.length === 1) {
            const p = bajos[0];
            const unidad = p.unit === 'kg' ? 'kg' : p.unit === 'litro' ? 'lt' : (p.stock === 1 ? 'unidad' : 'unidades');
            send(
                '⚠️ Stock Bajo',
                `${p.name} — quedan ${parseFloat(p.stock).toFixed(p.unit === 'kg' || p.unit === 'litro' ? 2 : 0)} ${unidad}`,
                `low-stock-${p.id}`
            );
        } else if (bajos.length > 1) {
            send(
                `⚠️ ${bajos.length} Productos con Stock Bajo`,
                bajos.slice(0, 3).map(p => {
                    const u = p.unit === 'kg' ? 'kg' : p.unit === 'litro' ? 'lt' : 'u';
                    return `${p.name} (${parseFloat(p.stock).toFixed(0)}${u})`;
                }).join(', ') + (bajos.length > 3 ? ` y ${bajos.length - 3} más` : ''),
                'low-stock-batch'
            );
        }
    }, [send]);

    // ── 2. Venta completada ──────────────────────────────────────────────────
    const notifySaleComplete = useCallback((sale) => {
        if (!sale) return;

        const { saleNumber, totalUsd, totalBs, payments = [], tipo } = sale;
        if (tipo === 'VENTA_FIADA') {
            const cliente = sale.customerName || 'cliente';
            send(
                `📋 Venta Fiada #${saleNumber}`,
                `$${totalUsd?.toFixed(2)} a ${cliente} — quedó pendiente de cobro`,
                `sale-${saleNumber}`
            );
            return;
        }

        // Resumir métodos de pago
        const metodosUsados = payments.map(p => {
            if (p.currency === 'USD') return `$${p.amountUsd?.toFixed(2)}`;
            if (p.currency === 'BS') return `Bs ${fmt(p.amountBs || p.amountUsd * (sale.effectiveRate || 1))}`;
            if (p.currency === 'COP') return `${fmt(p.amountCop || 0)} COP`;
            return p.methodLabel || '';
        }).filter(Boolean);

        const metodosStr = metodosUsados.length > 0 ? ` · ${metodosUsados.join(' + ')}` : '';

        send(
            `✅ Venta #${saleNumber} — $${totalUsd?.toFixed(2)}`,
            `Bs ${fmt(totalBs)}${metodosStr}`,
            `sale-${saleNumber}`
        );
    }, [send]);

    // ── 3. Cierre de caja (7pm+) con resumen real ────────────────────────────
    const notifyCierrePendiente = useCallback(({ salesCount, totalUsd, totalBs, totalDeudas, deudasCount } = {}) => {
        if (!salesCount || salesCount === 0) return;

        const now = new Date();
        if (now.getHours() < 19) return;

        const todayStr = getLocalISODate(now);
        if (localStorage.getItem('cierre_notified_date') === todayStr) return;
        localStorage.setItem('cierre_notified_date', todayStr);

        const deudaLine = totalDeudas > 0
            ? ` · $${totalDeudas.toFixed(2)} en ${deudasCount || ''} fiada${(deudasCount || 1) !== 1 ? 's' : ''}`
            : '';

        send(
            `💰 Cierre de Caja — ${salesCount} venta${salesCount !== 1 ? 's' : ''}`,
            `$${totalUsd?.toFixed(2)} · Bs ${fmt(totalBs)}${deudaLine}`,
            'cierre-pendiente'
        );
    }, [send]);

    return {
        requestPermission,
        notifyLowStock,
        notifySaleComplete,
        notifyCierrePendiente,
    };
}
