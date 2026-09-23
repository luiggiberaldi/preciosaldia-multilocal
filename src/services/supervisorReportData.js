import { round2, mulR, divR } from '../utils/dinero.js';
import { getDateRange, getLocalISODate } from '../utils/dateHelpers.js';

const SALE_TYPES = new Set(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);
const EXPENSE_TYPES = new Set(['GASTO_INTERNO', 'PAGO_PROVEEDOR']);
const INVENTORY_TYPES = new Set(['AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'INVENTORY_MOVEMENT']);
const CASH_METHODS = Object.freeze({
    efectivo_usd: 'USD',
    efectivo_bs: 'BS',
    efectivo_cop: 'COP',
});

const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const isValidRecord = (record) => record && typeof record === 'object' && record.status !== 'ANULADA';

export const shouldShowSupervisorCop = (copEnabled) => copEnabled === true;

function amountFromPayment(payment = {}, currency, sale = {}, bcvRate = 1) {
    if (currency === 'USD') {
        if (payment.amountUsd != null) return finite(payment.amountUsd);
        return payment.currency === 'USD' ? finite(payment.amount) : divR(finite(payment.amount), sale.rate || bcvRate || 1);
    }
    if (currency === 'BS') {
        if (payment.amountBs != null) return finite(payment.amountBs);
        return payment.currency === 'BS' ? finite(payment.amount) : mulR(finite(payment.amount), sale.rate || bcvRate || 1);
    }
    if (payment.amountCop != null) return finite(payment.amountCop);
    return payment.currency === 'COP' ? finite(payment.amount) : 0;
}

function addCash(target, currency, amount) {
    if (!Object.prototype.hasOwnProperty.call(target, currency)) return;
    target[currency] = round2(target[currency] + finite(amount));
}

function addLegacyCash(target, record, methodId) {
    const currency = CASH_METHODS[methodId];
    if (!currency) return;
    if (currency === 'USD') addCash(target, currency, record.totalUsd);
    if (currency === 'BS') addCash(target, currency, record.totalBs);
    if (currency === 'COP') addCash(target, currency, record.totalCop);
}

function addChange(target, record) {
    addCash(target, 'USD', -Math.abs(finite(record.changeUsd)));
    addCash(target, 'BS', -Math.abs(finite(record.changeBs)));
    addCash(target, 'COP', -Math.abs(finite(record.changeCop)));
}

function addAdvanceOutflow(target, record) {
    const advances = [];
    if (record.tipo === 'AVANCE_EFECTIVO') advances.push(record);
    for (const item of Array.isArray(record.items) ? record.items : []) {
        if (item?.isCashAdvance) advances.push(item);
    }

    for (const advance of advances) {
        const currency = advance.currency === 'USD' ? 'USD' : advance.currency === 'COP' ? 'COP' : 'BS';
        addCash(target, currency, -Math.abs(finite(advance.montoEfectivo)));
    }
}

export function filterSupervisorRecords(records = [], {
    range = 'all',
    from = '',
    to = '',
    cierreId = 'all',
    now,
} = {}) {
    const bounds = range === 'custom'
        ? { from, to }
        : range === 'all'
            ? null
            : getDateRange(range, now);

    return (Array.isArray(records) ? records : []).filter(record => {
        if (cierreId !== 'all' && String(record?.cierreId) !== String(cierreId)) return false;
        if (!bounds) return true;
        if (!record?.timestamp) return false;
        const date = getLocalISODate(new Date(record.timestamp));
        return date >= bounds.from && date <= bounds.to;
    });
}

export function buildSupervisorCloseCashSummary(close = {}, fallbackCash = {}) {
    const reconciliation = close?.reconData || {};
    const openingRecord = close?.apertura || {};
    const fallbackExpected = fallbackCash.expected || {};
    const fallbackOpening = fallbackCash.opening || {};

    return {
        ...fallbackCash,
        expected: {
            USD: finite(reconciliation.expectedUsd ?? fallbackExpected.USD ?? close?.totalUsd),
            BS: finite(reconciliation.expectedBs ?? fallbackExpected.BS ?? close?.totalBs),
            COP: finite(reconciliation.expectedCop ?? fallbackExpected.COP ?? close?.totalCop),
        },
        opening: {
            USD: finite(openingRecord.openingUsd ?? fallbackOpening.USD),
            BS: finite(openingRecord.openingBs ?? fallbackOpening.BS),
            COP: finite(openingRecord.openingCop ?? fallbackOpening.COP),
        },
        reconciliation: {
            declared: {
                USD: reconciliation.cashUsd,
                BS: reconciliation.cashBs,
                COP: reconciliation.cashCop,
            },
            difference: {
                USD: reconciliation.diffUsd,
                BS: reconciliation.diffBs,
                COP: reconciliation.diffCop,
            },
        },
    };
}

export function calculateSupervisorCashSummary(records = [], bcvRate = 1) {
    const expected = { USD: 0, BS: 0, COP: 0 };
    const opening = { USD: 0, BS: 0, COP: 0 };
    const changeGiven = { USD: 0, BS: 0, COP: 0 };
    const tipsLeft = { USD: 0, BS: 0, COP: 0 };
    const cashFlow = { USD: 0, BS: 0, COP: 0 };
    let cashMovementCount = 0;

    for (const record of Array.isArray(records) ? records : []) {
        if (!isValidRecord(record)) continue;

        if (record.tipo === 'APERTURA_CAJA') {
            opening.USD = round2(opening.USD + finite(record.openingUsd));
            opening.BS = round2(opening.BS + finite(record.openingBs));
            opening.COP = round2(opening.COP + finite(record.openingCop));
            addCash(cashFlow, 'USD', record.openingUsd);
            addCash(cashFlow, 'BS', record.openingBs);
            addCash(cashFlow, 'COP', record.openingCop);
            cashMovementCount += 1;
            continue;
        }

        let touchedCash = false;
        if (Array.isArray(record.payments) && record.payments.length > 0) {
            for (const payment of record.payments) {
                const currency = CASH_METHODS[payment?.methodId];
                if (!currency) continue;
                addCash(cashFlow, currency, amountFromPayment(payment, currency, record, bcvRate));
                touchedCash = true;
            }
        } else {
            const methodId = record.paymentMethod || record.metodoPago;
            if (CASH_METHODS[methodId]) {
                addLegacyCash(cashFlow, record, methodId);
                touchedCash = true;
            }
        }

        const beforeChange = { ...cashFlow };
        addChange(cashFlow, record);
        for (const currency of Object.keys(changeGiven)) {
            const changeValue = beforeChange[currency] - cashFlow[currency];
            if (changeValue > 0) changeGiven[currency] = round2(changeGiven[currency] + changeValue);
        }

        const tip = record.tipDonated;
        if (tip && tip.currency) {
            const currency = tip.currency === 'USD' ? 'USD' : tip.currency === 'COP' ? 'COP' : 'BS';
            const amount = currency === 'USD'
                ? tip.amountUsd
                : currency === 'COP'
                    ? tip.amountCop
                    : tip.amountBs;
            addCash(tipsLeft, currency, Math.abs(finite(amount)));
        }

        addAdvanceOutflow(cashFlow, record);
        if (touchedCash || record.tipo === 'GASTO_INTERNO' || record.tipo === 'PAGO_PROVEEDOR' || record.tipo === 'AVANCE_EFECTIVO') {
            cashMovementCount += 1;
        }
    }

    for (const currency of Object.keys(expected)) {
        expected[currency] = round2(cashFlow[currency]);
    }

    return {
        expected,
        opening,
        cashFlow,
        changeGiven,
        tipsLeft,
        cashMovementCount,
        bcvRate: finite(bcvRate),
    };
}

export function normalizeSupervisorInventoryMovement(record = {}, itemOverride = null) {
    if (!INVENTORY_TYPES.has(record.tipo) && record.direction == null) return null;
    const hasItems = Array.isArray(record.items) && record.items.length > 0;
    const item = itemOverride || (hasItems ? record.items[0] : {});
    const direction = record.direction || (record.tipo === 'AJUSTE_SALIDA' ? 'egreso' : 'ingreso');
    const itemUnitsDelta = item.unitsDelta ?? item.deltaUnits ?? item.qty;
    const unitsDelta = Math.abs(finite(itemOverride ? itemUnitsDelta : record.unitsDelta ?? record.deltaUnits ?? itemUnitsDelta));
    const productId = String(record.productId || item.productId || item._originalId || item.id || '');
    const baseMovementId = String(record.movementId || record.id || `${record.timestamp || 'unknown'}-movement`);

    return {
        movementId: itemOverride && hasItems && record.items.length > 1
            ? `${baseMovementId}-${productId || 'product'}`
            : baseMovementId,
        productId,
        productName: String(record.productNameSnapshot || record.productName || item.name || 'Producto sin nombre'),
        direction: direction === 'egreso' ? 'egreso' : 'ingreso',
        quantityInput: finite(item.quantityInput ?? (itemOverride ? item.qty : record.quantityInput ?? record.quantity) ?? unitsDelta),
        inputUnit: item.inputUnit || record.inputUnit || (record.adjUnit === 'lotes' ? 'bultos' : 'unidades'),
        unitsPerPackage: finite(item.unitsPerPackageSnapshot ?? item.unitsPerPackage ?? record.unitsPerPackageSnapshot ?? record.unitsPerPackage, 1),
        unitsDelta,
        stockBefore: item.stockBefore == null
            ? (record.stockBefore == null ? null : finite(record.stockBefore))
            : finite(item.stockBefore),
        stockAfter: item.stockAfter == null
            ? (record.stockAfter == null ? null : finite(record.stockAfter))
            : finite(item.stockAfter),
        reason: String(item.reason || record.reason || record.motivo || record.note || 'Sin motivo registrado'),
        lotReference: item.lotReference || record.lotReference || record.lote || null,
        supplierName: item.supplierName || record.supplierName || record.proveedor || null,
        invoiceReference: item.invoiceReference || record.invoiceReference || record.factura || null,
        reversalOfMovementId: item.reversalOfMovementId || record.reversalOfMovementId || record.reversesMovementId || null,
        operatorName: record.operatorNameSnapshot || record.operatorName || record.userName || null,
        timestamp: record.timestamp || null,
        source: record.source || 'legacy',
        status: record.status || 'applied',
        isIncomplete: !productId || unitsDelta <= 0 || !record.timestamp,
    };
}

export function buildSupervisorInventoryMovements(records = []) {
    return (Array.isArray(records) ? records : [])
        .filter(isValidRecord)
        .flatMap(record => {
            const items = Array.isArray(record.items) && record.items.length > 0 ? record.items : [null];
            return items.map(item => normalizeSupervisorInventoryMovement(record, item));
        })
        .filter(Boolean)
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
}

export function filterSupervisorInventoryMovements(movements = [], {
    direction = 'todos',
    search = '',
    status = 'todos',
    includeIncomplete = true,
} = {}) {
    const query = String(search).trim().toLowerCase();
    return (Array.isArray(movements) ? movements : []).filter(movement => {
        if (direction !== 'todos' && movement.direction !== direction) return false;
        if (status !== 'todos' && movement.status !== status) return false;
        if (!includeIncomplete && movement.isIncomplete) return false;
        if (!query) return true;
        return [movement.productName, movement.productId, movement.reason, movement.lotReference, movement.supplierName]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(query));
    });
}

export function buildSupervisorProductReport(records = []) {
    const products = new Map();
    for (const record of Array.isArray(records) ? records : []) {
        if (!isValidRecord(record) || !SALE_TYPES.has(record.tipo)) continue;
        for (const item of Array.isArray(record.items) ? record.items : []) {
            const productId = String(item._originalId || item.productId || item.id || item.name || 'unknown');
            if (!products.has(productId)) {
                products.set(productId, {
                    productId,
                    productName: item.name || 'Producto sin nombre',
                    quantity: 0,
                    revenueUsd: 0,
                    revenueBs: 0,
                    revenueCop: 0,
                    salesCount: 0,
                });
            }
            const row = products.get(productId);
            const quantity = finite(item.qty ?? item.quantity ?? item.cantidad);
            row.quantity = round2(row.quantity + quantity);
            row.revenueUsd = round2(row.revenueUsd + finite(item.priceUsd) * quantity);
            row.revenueBs = round2(row.revenueBs + finite(item.priceBs) * quantity);
            row.revenueCop = round2(row.revenueCop + finite(item.priceCop) * quantity);
            row.salesCount += 1;
        }
    }
    return [...products.values()].sort((left, right) => right.quantity - left.quantity || right.revenueUsd - left.revenueUsd);
}

export function buildSupervisorExpenseReport(records = []) {
    return (Array.isArray(records) ? records : [])
        .filter(record => isValidRecord(record) && EXPENSE_TYPES.has(record.tipo))
        .map(record => ({
            id: String(record.id || `${record.timestamp || 'unknown'}-${record.description || 'expense'}`),
            type: record.tipo,
            category: record.tipo === 'PAGO_PROVEEDOR' ? 'proveedor' : (record.category || 'otros'),
            description: record.description || record.note || 'Gasto sin descripción',
            totalUsd: Math.abs(finite(record.totalUsd)),
            totalBs: Math.abs(finite(record.totalBs)),
            totalCop: Math.abs(finite(record.totalCop)),
            affectsCash: record.afectaCaja !== false,
            isAutoconsumo: record.isAutoconsumo === true || record.category === 'autoconsumo',
            timestamp: record.timestamp || null,
            status: record.status || 'applied',
        }))
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
}

export default {
    calculateSupervisorCashSummary,
    filterSupervisorRecords,
    normalizeSupervisorInventoryMovement,
    buildSupervisorInventoryMovements,
    filterSupervisorInventoryMovements,
    buildSupervisorProductReport,
    buildSupervisorExpenseReport,
    buildSupervisorCloseCashSummary,
    shouldShowSupervisorCop,
};
