import { round2 } from '../utils/dinero.js';
import {
    calculateSupervisorSalesMetrics,
    normalizeProduct,
} from './supervisorFinancials.js';

export function calculateInventoryMetrics(products = []) {
    const list = (Array.isArray(products) ? products : []).map(normalizeProduct);
    let totalCost = 0;
    let totalRetail = 0;
    let totalQty = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const product of list) {
        totalCost += product.costUsd * product.stock;
        totalRetail += product.priceUsd * product.stock;
        totalQty += product.stock;

        if (product.stock <= 0) outOfStockCount += 1;
        else if (product.stock <= product.lowStockAlert) lowStockCount += 1;
    }

    return {
        totalCost: round2(totalCost),
        totalRetail: round2(totalRetail),
        totalQty,
        lowStockCount,
        outOfStockCount,
        expectedProfit: round2(Math.max(0, totalRetail - totalCost)),
        count: list.length,
    };
}

export function calculateSalesProfit(sales = [], products = [], bcvRate = 1) {
    return calculateSupervisorSalesMetrics(sales, products, bcvRate);
}

export default {
    calculateInventoryMetrics,
    calculateSalesProfit,
};
