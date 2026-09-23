import { FinancialEngine } from '../core/FinancialEngine';
import { getLocalISODate } from './dateHelpers';
import { mulR, sumR, round2 } from './dinero';
import { computeCarteraUsd, computeReceivablesMovements } from './receivablesReport';

// FIA-REPORT-001 (H1/H2/H3): el reporte ahora expone las cuentas por cobrar como
// movimientos (fiado otorgado / cobranzas / neto) más la cartera acumulada, en vez
// de dejar que la UI interprete el bucket `fiado` del motor. Los campos nuevos son
// aditivos: ningún consumidor existente cambia de forma.
//
// @param {Array} [customers] - Cartera de clientes, solo para «Cartera al cierre».
export function calculateReportsData(allSales, from, to, bcvRate, products, customers = []) {
    // Ventas de Mercancía (para Totales, Profit, Top Productos)
    const salesForStats = allSales.filter(s => {
        if (s.status === 'ANULADA' || (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA')) return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    // Flujo de Dinero (para Desglose de Pagos, incluye pagos de deudas y avances de efectivo)
    const salesForCashFlow = allSales.filter(s => {
        if (s.status === 'ANULADA') return false;
        if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA' && s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'COBRO_CASHEA' && s.tipo !== 'PAGO_PROVEEDOR' && s.tipo !== 'GASTO_INTERNO' && s.tipo !== 'AVANCE_EFECTIVO') return false;
        if (s.tipo === 'PAGO_PROVEEDOR' && s.afectaCaja === false) return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    const historySales = allSales.filter(s => {
        if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    const totalUsd = sumR(salesForStats.map(sale => sale.totalUsd || 0));
    const totalBs = sumR(salesForStats.map(sale => sale.totalBs || 0));
    const totalCop = sumR(salesForStats.map(sale => sale.totalCop || 0));
    const totalItems = salesForStats.reduce((s, sale) => s + (sale.items ? sale.items.reduce((is, i) => is + i.qty, 0) : 0), 0);
    
    // Sumar ganancias de ventas + comisiones por avances de efectivo
    const profitFromSales = FinancialEngine.calculateAggregateProfit(salesForStats, bcvRate, products);
    const advancesInPeriod = allSales.filter(s => {
        if (s.status === 'ANULADA' || s.tipo !== 'AVANCE_EFECTIVO') return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });
    const profitFromAdvances = advancesInPeriod.reduce((sum, a) => {
        const rate = a.rate || bcvRate || 1;
        const commBs = a.currency === 'BS' ? (a.montoComision || 0) : mulR(a.montoComision || 0, rate);
        return sum + commBs;
    }, 0);
    const profit = round2(profitFromSales + profitFromAdvances);
    
    // Desglose de Medios de Pago y Top Productos
    const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);
    const topProducts = FinancialEngine.calculateTopProducts(salesForStats);
    
    // Agrupar ventas por día
    const map = {};
    salesForStats.forEach(s => {
        const day = getLocalISODate(new Date(s.timestamp));
        if (!map[day]) map[day] = { date: day, total: 0, count: 0 };
        map[day].total = round2(map[day].total + (s.totalUsd || 0));
        map[day].count++;
    });
    const salesByDay = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));

    // Calcular egresos y gastos en el periodo
    const expensesList = allSales.filter(s => {
        if (s.status === 'ANULADA' || (s.tipo !== 'PAGO_PROVEEDOR' && s.tipo !== 'GASTO_INTERNO')) return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    const expensesUsd = sumR(expensesList.filter(s => s.afectaCaja !== false).map(s => Math.abs(s.totalUsd || 0)));
    const expensesBs = sumR(expensesList.filter(s => s.afectaCaja !== false).map(s => Math.abs(s.totalBs || 0)));

    // Cuentas por cobrar del período (movimientos) y cartera acumulada (stock).
    const receivables = computeReceivablesMovements(salesForCashFlow, { from, to });
    const receivablePayments = receivables.cobranzas;
    const carteraUsd = Array.isArray(customers) && customers.length > 0
        ? computeCarteraUsd(customers)
        : null;

    return {
        salesForStats,
        salesForCashFlow,
        historySales,
        receivables,
        receivablePayments,
        carteraUsd,
        totalUsd,
        totalBs,
        totalCop,
        totalItems,
        profit,
        paymentBreakdown,
        topProducts,
        salesByDay,
        expensesList,
        expensesUsd,
        expensesBs
    };
}

export function groupSalesByCierreId(allSales, from, to) {
    // 1. Encontrar ventas/aperturas que caen en el rango y tienen cierreId
    const entitiesInDateRange = allSales.filter(s => {
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to && s.cierreId;
    });

    // 2. Agrupar por cierreId
    const cMap = {};
    entitiesInDateRange.forEach(entity => {
        const cId = entity.cierreId;
        if (!cMap[cId]) {
            cMap[cId] = {
                cierreId: cId,
                timestamp: cId,
                apertura: null,
                sales: [],
            };
        }
        if (entity.tipo === 'APERTURA_CAJA') {
            cMap[cId].apertura = entity;
        } else {
            cMap[cId].sales.push(entity);
        }
    });

    // 3. Calcular resumen y ordenar desc
    const result = Object.values(cMap)
        .filter(c => c.sales.length > 0)
        .map(c => {
            const dateObj = new Date(c.cierreId);

            // Filtrar para métricas generales (stats) y flujo de caja (cashflow)
            const salesForStats = c.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            const salesForCashFlow = c.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA' || s.tipo === 'COBRO_DEUDA' || s.tipo === 'COBRO_CASHEA' || s.tipo === 'PAGO_PROVEEDOR' || s.tipo === 'GASTO_INTERNO' || s.tipo === 'AVANCE_EFECTIVO');

            const totalUsd = sumR(salesForStats.map(s => s.totalUsd || 0));
            const totalBs = sumR(salesForStats.map(s => s.totalBs || 0));
            const totalCop = sumR(salesForStats.map(s => s.totalCop || 0));
            const totalItems = salesForStats.reduce((acc, s) => acc + (s.items ? s.items.reduce((is, it) => is + it.qty, 0) : 0), 0);
            
            // Reconstruir desglose de pago de esta caja
            const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);

            return {
                ...c,
                dateObj,
                salesForStats,
                salesForCashFlow,
                totalUsd,
                totalBs,
                totalCop,
                totalItems,
                paymentBreakdown,
            };
        })
        .sort((a, b) => String(b.cierreId).localeCompare(String(a.cierreId)));

    return result;
}
