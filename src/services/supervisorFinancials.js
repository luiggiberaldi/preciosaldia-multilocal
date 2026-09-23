import { FinancialEngine } from '../core/FinancialEngine.js';
import { divR, round2, sumR } from '../utils/dinero.js';
import { getGeneratedWalletCredit } from '../utils/customerLedger.js';

const SALE_TYPES = Object.freeze(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);
const CASH_FLOW_TYPES = Object.freeze([
    ...SALE_TYPES,
    'COBRO_DEUDA',
    'COBRO_CASHEA',
    'PAGO_PROVEEDOR',
    'GASTO_INTERNO',
    'APERTURA_CAJA',
    'AVANCE_EFECTIVO',
]);

const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const nullableFinite = (value) => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

export const normalizeProduct = (product = {}) => ({
    ...product,
    id: product?.id ?? null,
    name: typeof product?.name === 'string' ? product.name : '',
    stock: finite(product?.stock),
    priceUsd: finite(product?.priceUsd ?? product?.priceUsdt),
    costUsd: finite(product?.costUsd ?? product?.costPrice),
    lowStockAlert: finite(product?.lowStockAlert ?? product?.minStock, 5),
});

export const normalizeSale = (sale = {}) => ({
    ...sale,
    totalUsd: finite(sale?.totalUsd),
    totalBs: finite(sale?.totalBs),
    totalCop: finite(sale?.totalCop),
    changeUsd: finite(sale?.changeUsd),
    changeBs: finite(sale?.changeBs),
    tasaCop: finite(sale?.tasaCop),
    items: Array.isArray(sale?.items)
        ? sale.items.map(item => ({
            ...item,
            qty: finite(item?.qty),
            priceUsd: finite(item?.priceUsd ?? item?.priceUsdt),
            costUsd: finite(item?.costUsd ?? item?.costPrice),
        }))
        : [],
});

export const normalizeReconciliation = (reconData) => {
    if (!reconData || typeof reconData !== 'object') return null;
    return {
        ...reconData,
        expectedUsd: finite(reconData.expectedUsd),
        expectedBs: finite(reconData.expectedBs),
        expectedCop: finite(reconData.expectedCop),
        cashUsd: nullableFinite(reconData.cashUsd ?? reconData.declaredUsd),
        cashBs: nullableFinite(reconData.cashBs ?? reconData.declaredBs),
        cashCop: nullableFinite(reconData.cashCop ?? reconData.declaredCop),
        diffUsd: nullableFinite(reconData.diffUsd),
        diffBs: nullableFinite(reconData.diffBs),
        diffCop: nullableFinite(reconData.diffCop),
    };
};

export const isSale = (sale) => SALE_TYPES.includes(sale?.tipo);

export const isCashFlowMovement = (sale) => {
    if (!CASH_FLOW_TYPES.includes(sale?.tipo)) return false;
    return !(['PAGO_PROVEEDOR', 'GASTO_INTERNO'].includes(sale.tipo) && sale.afectaCaja === false);
};

export const getSaleTypes = () => [...SALE_TYPES];
export const getCashFlowTypes = () => [...CASH_FLOW_TYPES];

export function calculateSupervisorSalesMetrics(sales = [], products = [], bcvRate = 1) {
    const normalizedSales = (Array.isArray(sales) ? sales : []).map(normalizeSale);
    const saleRows = normalizedSales.filter(sale => (isSale(sale) || !sale.tipo) && sale.status !== 'ANULADA');
    const normalizedProducts = (Array.isArray(products) ? products : []).map(normalizeProduct);
    const safeRate = finite(bcvRate, 1) > 0 ? finite(bcvRate, 1) : 1;
    const profitBs = FinancialEngine.calculateAggregateProfit(saleRows, safeRate, normalizedProducts);
    const hasItemPrices = saleRows.some(sale => sale.items.some(item => item.priceUsd > 0));

    // Legacy fixtures may contain only totalUsd and productId. Keep their
    // revenue-minus-cost fallback, while real POS rows use FinancialEngine.
    let profitUsd;
    if (hasItemPrices) {
        profitUsd = divR(profitBs, safeRate);
    } else {
        const productById = new Map(normalizedProducts.map(product => [product.id, product]));
        const costUsd = saleRows.reduce((total, sale) => total + sale.items.reduce((itemsTotal, item) => {
            const product = productById.get(item.productId) || productById.get(item.id);
            return itemsTotal + finite(item.costUsd || product?.costUsd) * finite(item.qty);
        }, 0), 0);
        profitUsd = round2(Math.max(0, sumR(saleRows.map(sale => sale.totalUsd)) - costUsd));
    }

    return {
        revenueUsd: sumR(saleRows.map(sale => sale.totalUsd)),
        revenueBs: sumR(saleRows.map(sale => sale.totalBs)),
        totalCop: sumR(saleRows.map(sale => sale.totalCop)),
        costUsd: round2(Math.max(0, sumR(saleRows.map(sale => sale.totalUsd)) - profitUsd)),
        profitUsd: round2(profitUsd),
        profitBs: round2(profitBs),
        count: saleRows.length,
    };
}

export function calculateSupervisorPaymentBreakdown(sales = [], bcvRate = 1) {
    const breakdown = {};
    const add = (methodId, amountUsd, amountBs, label, currency, flags = {}) => {
        if (!breakdown[methodId]) breakdown[methodId] = { totalUsd: 0, totalBs: 0, count: 0, label, currency, ...flags };
        breakdown[methodId].totalUsd = round2(breakdown[methodId].totalUsd + finite(amountUsd));
        breakdown[methodId].totalBs = round2(breakdown[methodId].totalBs + finite(amountBs));
        breakdown[methodId].count += 1;
    };

    for (const sale of sales) {
        if (sale.tipo === 'APERTURA_CAJA') {
            if (finite(sale.openingUsd) > 0) add('efectivo_usd', sale.openingUsd, 0, 'Efectivo $', 'USD');
            if (finite(sale.openingBs) > 0) add('efectivo_bs', 0, sale.openingBs, 'Efectivo Bs', 'BS');
            if (finite(sale.openingCop) > 0) add('efectivo_cop', 0, 0, 'Efectivo COP', 'COP');
            continue;
        }
        if (sale.tipo === 'VENTA_FIADA') {
            add('fiado', sale.fiadoUsd != null ? sale.fiadoUsd : sale.totalUsd, sale.fiadoUsd != null ? sale.fiadoUsd * (sale.rate || bcvRate || 1) : sale.totalBs, 'Fiado (Por Cobrar)', 'FIADO', { isReceivable: true });
        }
        // Las cobranzas reducen la cuenta por cobrar y, por separado, registran
        // el medio físico/electrónico recibido abajo. Sin este ajuste el reporte
        // del Supervisor mostraba el efectivo correcto pero inflaba el fiado.
        if (sale.tipo === 'COBRO_DEUDA') {
            add('fiado', -finite(sale.totalUsd), -finite(sale.totalBs), 'Fiado (Por Cobrar)', 'FIADO', { isReceivable: true });
        }
        if (sale.tipo === 'COBRO_CASHEA') {
            add('cashea', -finite(sale.totalUsd), -finite(sale.totalBs), 'Cashea (Por Cobrar)', 'FIADO', { isReceivable: true });
        }
        if (Array.isArray(sale.payments) && sale.payments.length > 0) {
            for (const payment of sale.payments) {
                const amountUsd = payment.amountUsd != null
                    ? payment.amountUsd
                    : payment.currency === 'USD'
                        ? payment.amount
                        : divR(payment.amount, sale.rate || bcvRate || 1);
                const amountBs = payment.amountBs != null
                    ? payment.amountBs
                    : payment.currency === 'BS'
                        ? payment.amount
                        : finite(payment.amount) * (sale.rate || bcvRate || 1);
                if (payment.methodId === 'saldo_favor' || payment.isInternalCredit || payment.currency === 'INTERNAL_CREDIT') {
                    add('saldo_favor', amountUsd, 0, 'Saldo a Favor Utilizado', 'INTERNAL_CREDIT', {
                        isInternalCredit: true,
                        isCash: false,
                        isRevenue: false,
                    });
                    continue;
                }
                add(
                    payment.methodId || 'efectivo_bs',
                    amountUsd,
                    amountBs,
                    payment.methodLabel || payment.methodId || 'Efectivo Bs',
                    payment.currency || 'BS',
                );
            }
        } else {
            const methodId = sale.paymentMethod || sale.metodoPago || 'efectivo_bs';
            const isUsd = methodId.includes('usd') || methodId.includes('zelle') || methodId.includes('binance');
            const isCop = methodId.includes('cop');
            add(
                methodId,
                isUsd ? sale.totalUsd : isCop ? 0 : divR(sale.totalBs, sale.rate || bcvRate || 1),
                isUsd ? 0 : isCop ? 0 : sale.totalBs,
                methodId === 'efectivo_bs' ? 'Efectivo Bs' : methodId,
                isUsd ? 'USD' : isCop ? 'COP' : 'BS',
            );
        }

        const generatedWalletCredit = getGeneratedWalletCredit(sale);
        if (generatedWalletCredit > 0) {
            add(
                'saldo_favor_generado',
                generatedWalletCredit,
                0,
                'Saldo a Favor Generado',
                'INTERNAL_CREDIT',
                { isInternalCredit: true, isWalletCredit: true, isCash: false, isRevenue: false },
            );
        }
    }

    return Object.entries(breakdown).sort(([, left], [, right]) => right.totalUsd - left.totalUsd);
}

export function buildSupervisorRegisterCloses(sales = [], products = [], bcvRate = 1) {
    const normalized = (Array.isArray(sales) ? sales : []).map(normalizeSale);
    const explicitCloses = normalized.filter(sale => sale.tipo === 'REGISTRO_CIERRE');
    const groups = new Map();

    const ensureGroup = (cierreId) => {
        const key = String(cierreId);
        if (!groups.has(key)) groups.set(key, { cierreId, sales: [], explicit: null });
        return groups.get(key);
    };

    for (const sale of normalized) {
        if (sale.cierreId != null) {
            const group = ensureGroup(sale.cierreId);
            if (sale.tipo === 'REGISTRO_CIERRE') group.explicit = sale;
            else group.sales.push(sale);
        }
    }
    for (const close of explicitCloses) {
        ensureGroup(close.cierreId).explicit = close;
    }

    return [...groups.values()].map(group => {
        const explicit = group.explicit;
        const transactionRows = group.sales;
        const salesForStats = transactionRows.filter(isSale).filter(sale => sale.status !== 'ANULADA');
        const salesForCashFlow = transactionRows.filter(isCashFlowMovement).filter(sale => sale.status !== 'ANULADA');
        const metrics = calculateSupervisorSalesMetrics(salesForStats, products, bcvRate);
        const canonicalBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);
        const summary = explicit?.summary || {};
        const reconData = normalizeReconciliation(summary.reconData);
        const allRows = explicit ? [...transactionRows] : transactionRows;

        return {
            cierreId: group.cierreId,
            cierreNumber: explicit?.cierreNumber || null,
            timestamp: explicit?.timestamp || new Date(Number(group.cierreId)).toISOString(),
            sales: salesForStats,
            totalUsd: metrics.revenueUsd,
            totalBs: metrics.revenueBs,
            totalCop: metrics.totalCop,
            totalItems: salesForStats.reduce((total, sale) => total + sale.items.reduce((items, item) => items + item.qty, 0), 0),
            profitUsd: metrics.profitUsd,
            costUsd: metrics.costUsd,
            paymentBreakdown: calculateSupervisorPaymentBreakdown(salesForCashFlow, bcvRate),
            canonicalBreakdown,
            cashFlow: allRows,
            apertura: transactionRows.find(sale => sale.tipo === 'APERTURA_CAJA') || null,
            reconData,
            cashier: summary.cashier || { nombre: 'Cajero', rol: 'CAJERO' },
        };
    }).sort((left, right) => Number(right.cierreId) - Number(left.cierreId));
}

export default {
    normalizeProduct,
    normalizeSale,
    normalizeReconciliation,
    calculateSupervisorSalesMetrics,
    buildSupervisorRegisterCloses,
    calculateSupervisorPaymentBreakdown,
    isSale,
    isCashFlowMovement,
};
