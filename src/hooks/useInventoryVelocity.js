import { useState, useEffect } from 'react';
import { storageService } from '../utils/storageService';

export function useInventoryVelocity(productsTrigger) {
    const [salesVelocityMap, setSalesVelocityMap] = useState({});

    // HOOK-030: Extraer un primitivo estable del trigger para que el `useEffect`
    // no se re-corra por cambios de referencia del objeto/array original.
    // Si el caller pasa un array de productos, usamos su `length` como primitivo
    // (suficiente para detectar "cambió el catálogo" en este contexto). Si pasa
    // un número/string/boolean, lo usamos directamente.
    const productsPrimitive = typeof productsTrigger === 'object' && productsTrigger !== null
        ? (Array.isArray(productsTrigger) ? productsTrigger.length : Object.keys(productsTrigger).length)
        : productsTrigger;

    useEffect(() => {
        const computeVelocity = async () => {
            try {
                const allSales = await storageService.getItem('bodega_sales_v1', []);
                if (!allSales.length) return;

                // Últimos 14 días
                const now = new Date();
                const fourteenDaysAgo = new Date(now);
                fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

                const recentSales = allSales.filter(s =>
                    s.timestamp && new Date(s.timestamp) >= fourteenDaysAgo &&
                    s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.status !== 'ANULADA'
                );

                // Contar ventas por producto
                const velocityMap = {};
                recentSales.forEach(sale => {
                    (sale.items || []).forEach(item => {
                        const key = item.id || item.name;
                        if (!velocityMap[key]) velocityMap[key] = 0;
                        velocityMap[key] += item.qty;
                    });
                });

                // Dividir entre 14 para obtener promedio diario
                Object.keys(velocityMap).forEach(k => {
                    velocityMap[k] = velocityMap[k] / 14;
                });

                setSalesVelocityMap(velocityMap);
            } catch (e) {
                // HOOK-022: no silenciar completamente; loguear en dev.
                console.warn('[useInventoryVelocity] Error computing sales velocity:', e);
            }
        };
        computeVelocity();
        // HOOK-030: dep primitiva — el efecto solo se re-corre cuando cambia el
        // valor numérico/string, no en cada render del caller.
    }, [productsPrimitive]);

    return { salesVelocityMap };
}
