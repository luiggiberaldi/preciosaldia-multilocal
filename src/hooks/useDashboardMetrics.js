import { useMemo, useCallback } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { computeReceivablesMovements } from '../utils/receivablesReport';
import { sumR, mulR } from '../utils/dinero';
import { getLocalISODate } from '../utils/dateHelpers';

/**
 * Hook de métricas del Dashboard.
 *
 * FIN-013: weekData ya NO excluye VENTA_FIADA (criterio unificado con todayTotalUsd).
 * FIN-019: totalDeudas y topProducts usan sumR/mulR en vez de reduce/multiplicación raw.
 */
export function useDashboardMetrics(sales, customers, products, bcvRate) {
    const today = getLocalISODate();

    // Memoize sales with pre-calculated local dates to avoid parsing new Date inside nested loops
    const salesWithLocalDate = useMemo(() => {
        return sales.map(s => {
            const localDate = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : today;
            return {
                ...s,
                localDate
            };
        });
    }, [sales, today]);

    const todaySales = useMemo(() =>
        salesWithLocalDate.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            if (s.cajaCerrada === true) return false;
            return s.localDate === today;
        }),
        [salesWithLocalDate, today]
    );

    // Movimientos reales de caja para el cuadre (Ventas + Abonos + Egresos + Apertura)
    const todayCashFlow = useMemo(() =>
        salesWithLocalDate.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA' && s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.tipo !== 'PAGO_PROVEEDOR' && s.tipo !== 'GASTO_INTERNO' && s.tipo !== 'APERTURA_CAJA') return false;
            if ((s.tipo === 'PAGO_PROVEEDOR' || s.tipo === 'GASTO_INTERNO') && s.afectaCaja === false) return false;
            if (s.cajaCerrada === true) return false;
            return s.localDate === today;
        }),
        [salesWithLocalDate, today]
    );

    // Detect if apertura was already registered today
    const todayApertura = useMemo(() => {
        return salesWithLocalDate.find(s => {
            if (s.tipo !== 'APERTURA_CAJA' || s.cajaCerrada) return false;
            return s.localDate === today;
        });
    }, [salesWithLocalDate, today]);

    const todayTotalBs = useMemo(() => sumR(todaySales.map(s => s.totalBs || 0)), [todaySales]);
    const todayTotalUsd = useMemo(() => sumR(todaySales.map(s => s.totalUsd || 0)), [todaySales]);
    const todayTotalCop = useMemo(() => sumR(todaySales.map(s => s.totalCop || 0)), [todaySales]);
    const todayItemsSold = useMemo(() => todaySales.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, i) => is + i.qty, 0) : 0), 0), [todaySales]);

    // Egresos del día (pagos a proveedores + gastos internos)
    const todayExpenses = useMemo(() => {
        return salesWithLocalDate.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'PAGO_PROVEEDOR' && s.tipo !== 'GASTO_INTERNO') return false;
            if ((s.tipo === 'PAGO_PROVEEDOR' || s.tipo === 'GASTO_INTERNO') && s.afectaCaja === false) return false;
            if (s.cajaCerrada === true) return false;
            return s.localDate === today;
        });
    }, [salesWithLocalDate, today]);
    const todayExpensesUsd = useMemo(() => sumR(todayExpenses.map(s => Math.abs(s.totalUsd || 0))), [todayExpenses]);

    // Gastos internos del día (excluyendo proveedores)
    const todayGastos = useMemo(() => {
        return salesWithLocalDate.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'GASTO_INTERNO') return false;
            if (s.cajaCerrada === true) return false;
            return s.localDate === today;
        });
    }, [salesWithLocalDate, today]);
    const todayGastosUsd = useMemo(() => sumR(todayGastos.map(s => Math.abs(s.totalUsd || 0))), [todayGastos]);

    const todayProfit = useMemo(() =>
        FinancialEngine.calculateAggregateProfit(todaySales, bcvRate, products),
        [todaySales, bcvRate, products]
    );

    // Últimas ventas (por defecto todas ordenadas por fecha más reciente, o filtradas por el día seleccionado en la gráfica)
    const getRecentSales = useCallback((selectedChartDate) => {
        const filteredSales = salesWithLocalDate.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
        const sorted = [...filteredSales].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (selectedChartDate) {
            return sorted.filter(s => s.localDate === selectedChartDate);
        }
        return sorted;
    }, [salesWithLocalDate]);

    // Datos últimos 7 días (para gráfica)
    // FIN-013: unificar criterio — INCLUIR VENTA_FIADA como todayTotalUsd hace.
    // Antes weekData excluía VENTA_FIADA mientras todayTotalUsd la incluía →
    // la suma de la gráfica nunca cuadraba con el total del día.
    const weekData = useMemo(() => Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const dateStr = getLocalISODate(d);
        const daySales = salesWithLocalDate.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            return s.localDate === dateStr;
        });

        return { date: dateStr, total: sumR(daySales.map(s => s.totalUsd || 0)), count: daySales.length };
    }), [salesWithLocalDate]);

    // Productos sin stock (stock <= 0)
    const outOfStockProducts = useMemo(() =>
        products.filter(p => (p.stock ?? 0) <= 0)
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0)).slice(0, 6),
        [products]
    );

    // Productos bajo stock (stock > 0 y <= lowStockAlert)
    const lowStockProducts = useMemo(() =>
        products.filter(p => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= (p.lowStockAlert ?? 5))
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0)).slice(0, 6),
        [products]
    );

    // Deudas pendientes totales
    // FIN-019: usar sumR en vez de reduce raw.
    const totalDeudas = useMemo(() => {
        const deudores = customers.filter(c => (c.deuda || 0) > 0.01 || (c.casheaDeuda || 0) > 0.01);
        // Dos contrapartes distintas: los clientes deben `deuda`; Cashea (el
        // financiador) debe `casheaDeuda`. `totalUsd` se conserva como el agregado
        // histórico para no romper consumidores existentes, pero se exponen ambos
        // desglosados para poder mostrarlos por separado.
        const totalClientesUsd = sumR(deudores.map(c => c.deuda || 0));
        const totalCasheaUsd   = sumR(deudores.map(c => c.casheaDeuda || 0));
        const totalUsd = sumR(totalClientesUsd, totalCasheaUsd);
        return {
            count: deudores.length,
            totalUsd,
            totalClientesUsd,
            totalCasheaUsd,
            top5: [...deudores].sort((a, b) => {
                const totalA = sumR(a.deuda || 0, a.casheaDeuda || 0);
                const totalB = sumR(b.deuda || 0, b.casheaDeuda || 0);
                return totalB - totalA;
            }).slice(0, 5)
        };
    }, [customers]);

    // Top productos vendidos (todas las ventas netas — excluye Venta Libre / ítems personalizados)
    // FIN-019: usar mulR + round2 en vez de multiplicación raw.
    const topProducts = useMemo(() => {
        const productSalesMap = {};
        sales.filter(s => s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.tipo !== 'AJUSTE_ENTRADA' && s.tipo !== 'AJUSTE_SALIDA' && s.status !== 'ANULADA').forEach(s => {
            if (s.items) {
                s.items.forEach(item => {
                    const isCustom = item.isCustom || String(item.id || '').startsWith('custom_') || item.name?.toLowerCase()?.trim() === 'venta libre' || item.name?.toLowerCase()?.startsWith('venta libre');
                    if (isCustom) return;
                    if (!productSalesMap[item.name]) productSalesMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                    productSalesMap[item.name].qty += item.qty;
                    productSalesMap[item.name].revenue = sumR(productSalesMap[item.name].revenue, mulR(item.priceUsd, item.qty));
                });
            }
        });
        return Object.values(productSalesMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
    }, [sales]);

    // Payment method breakdown (today)
    const paymentBreakdown = useMemo(() => {
        return FinancialEngine.calculatePaymentBreakdown(todayCashFlow);
    }, [todayCashFlow]);

    // FIA-REPORT-001 (H1/H2): movimientos de cuentas por cobrar del turno. El bucket
    // `fiado` del motor trae el NETO y el motor descarta los buckets en 0, así que la
    // vista no puede depender de él para decidir si hubo movimientos.
    const todayReceivables = useMemo(
        () => computeReceivablesMovements(todayCashFlow),
        [todayCashFlow]
    );

    // Top productos vendidos HOY (para cierre del día — excluye Venta Libre)
    // FIN-019: usar mulR + round2 en vez de multiplicación raw.
    const todayTopProducts = useMemo(() => {
        const todayProductMap = {};
        todaySales.forEach(s => {
            if (s.items) {
                s.items.forEach(item => {
                    const isCustom = item.isCustom || String(item.id || '').startsWith('custom_') || item.name?.toLowerCase()?.trim() === 'venta libre' || item.name?.toLowerCase()?.startsWith('venta libre');
                    if (isCustom) return;
                    if (!todayProductMap[item.name]) todayProductMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                    todayProductMap[item.name].qty += item.qty;
                    todayProductMap[item.name].revenue = sumR(todayProductMap[item.name].revenue, mulR(item.priceUsd, item.qty));
                });
            }
        });
        return Object.values(todayProductMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
    }, [todaySales]);

    // Métricas financieras del inventario en stock
    const inventoryMetrics = useMemo(() => {
        let totalRetailUsd = 0;
        let totalCostUsd = 0;

        products.forEach(p => {
            const qty = p.stock ?? 0;
            if (qty <= 0) return;
            const retailPrice = (p.sellByUnit && p.unitPriceUsd > 0) ? p.unitPriceUsd : (p.priceUsdt || p.priceUsd || 0);
            const actualQty = (p.sellByUnit && p.unitsPerPackage > 1) ? (qty * p.unitsPerPackage) : qty;

            totalRetailUsd += (retailPrice * actualQty);
            const unitCost = p.costUsd || 0;
            totalCostUsd += (unitCost * qty);
        });

        const totalProfitUsd = totalRetailUsd - totalCostUsd;
        const marginPct = totalRetailUsd > 0 ? (totalProfitUsd / totalRetailUsd) * 100 : 0;
        const markupPct = totalCostUsd > 0 ? (totalProfitUsd / totalCostUsd) * 100 : 0;

        return {
            totalRetailUsd,
            totalCostUsd,
            totalProfitUsd,
            marginPct,
            markupPct
        };
    }, [products]);

    return {
        today,
        todaySales,
        todayCashFlow,
        todayApertura,
        todayTotalBs,
        todayTotalUsd,
        todayTotalCop,
        todayItemsSold,
        todayExpenses,
        todayExpensesUsd,
        todayGastos,
        todayGastosUsd,
        todayProfit,
        getRecentSales,
        weekData,
        outOfStockProducts,
        lowStockProducts,
        totalDeudas,
        topProducts,
        paymentBreakdown,
        todayReceivables,
        todayTopProducts,
        inventoryMetrics,
    };
}
