import { round2 } from '../utils/dinero';
import { isGranelProduct, normalizeStockValue } from '../utils/granel'; // GRANEL-001

const INPUT_UNITS = new Set(['unidades', 'cajas', 'bultos']);
const EGRESS_REASONS = new Set(['merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste']);

export function calculateSupervisorInventoryBatchAdjustment(product = {}, payload = {}, {
    commandId = 'unknown-command',
    timestamp = new Date().toISOString(),
} = {}) {
    const quantityInput = Number(payload.quantityInput);
    const unitsPerPackage = Number(payload.unitsPerPackage);
    const expectedStock = Number(payload.expectedStock);

    const direction = payload.direction;
    const isEgress = direction === 'egreso';
    if (!['ingreso', 'egreso'].includes(direction) || typeof payload.productId !== 'string' || payload.productId.length === 0) {
        throw new Error('Dirección de inventario no permitida');
    }
    if (isEgress && !EGRESS_REASONS.has(payload.reasonCategory)) {
        throw new Error('Categoría de egreso inválida');
    }
    if (!INPUT_UNITS.has(payload.inputUnit)
        || !Number.isFinite(quantityInput) || quantityInput <= 0
        || !Number.isFinite(unitsPerPackage) || unitsPerPackage <= 0
        || !Number.isFinite(expectedStock) || expectedStock < 0
        || typeof payload.reason !== 'string' || payload.reason.trim().length === 0) {
        throw new Error('Payload de ingreso por lote inválido');
    }

    const stockBefore = Number(product.stock || 0);
    if (!Number.isFinite(stockBefore) || stockBefore !== expectedStock) {
        throw new Error(`El stock cambió antes de aplicar: esperado ${expectedStock}, actual ${stockBefore}`);
    }

    // GRANEL-001: granel conserva hasta 3 decimales en el stock resultante;
    // el resto permanece entero estricto.
    const isGranel = isGranelProduct(product);
    const unitsDelta = round2(quantityInput * unitsPerPackage);
    const stockAfter = normalizeStockValue(stockBefore + (isEgress ? -unitsDelta : unitsDelta), isGranel);
    if (stockAfter < 0) throw new Error('Stock insuficiente para el egreso');
    const movement = {
        id: `supervisor-${commandId}`,
        movementId: `supervisor-${commandId}`,
        tipo: isEgress ? 'AJUSTE_SALIDA' : 'AJUSTE_ENTRADA',
        source: 'supervisor',
        status: 'COMPLETADA',
        timestamp,
        productId: product.id,
        productNameSnapshot: product.name,
        direction,
        reasonCategory: isEgress ? payload.reasonCategory : null,
        quantityInput,
        inputUnit: payload.inputUnit,
        unitsPerPackageSnapshot: unitsPerPackage,
        unitsDelta,
        stockBefore,
        stockAfter,
        reason: payload.reason.trim(),
        lotReference: payload.lotReference || null,
        operatorNameSnapshot: 'Supervisor remoto',
        commandId,
    };

    return {
        product: { ...product, stock: stockAfter },
        movement,
        unitsDelta,
        stockBefore,
        stockAfter,
    };
}

export async function applySupervisorInventoryBatchTransaction({
    storage,
    pushSync,
    payload,
    commandId,
    timestamp,
}) {
    const currentProducts = await storage.getItem('bodega_products_v1', []) || [];
    const currentSales = await storage.getItem('bodega_sales_v1', []) || [];
    const product = currentProducts.find(item => String(item.id) === String(payload.productId));
    if (!product) throw new Error('Producto no encontrado');

    const adjustment = calculateSupervisorInventoryBatchAdjustment(product, payload, {
        commandId,
        timestamp,
    });
    const updatedProducts = currentProducts.map(item => item.id === product.id ? adjustment.product : item);
    const updatedSales = [...currentSales, adjustment.movement];

    await storage.setItem('bodega_products_v1', updatedProducts);
    await storage.setItem('bodega_sales_v1', updatedSales);

    try {
        const [productsPush, salesPush] = await Promise.all([
            pushSync('bodega_products_v1', updatedProducts, true),
            pushSync('bodega_sales_v1', updatedSales, true),
        ]);
        if (!productsPush?.ok || !salesPush?.ok) {
            throw new Error(productsPush?.error || salesPush?.error || 'No se pudo confirmar la sincronización del ingreso');
        }
    } catch (error) {
        await storage.setItem('bodega_products_v1', currentProducts);
        await storage.setItem('bodega_sales_v1', currentSales);
        throw error;
    }

    return {
        ...adjustment,
        updatedProducts,
        updatedSales,
    };
}

export default {
    calculateSupervisorInventoryBatchAdjustment,
    applySupervisorInventoryBatchTransaction,
};
