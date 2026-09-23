import { storageService } from './storageService.js';
import { logEvent } from '../services/auditService.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { divR, sumR, round2, round3 } from './dinero.js';
import { isGranelProduct, adjustStockValue } from './granel.js'; // GRANEL-001
import { withLock } from './withLock.js';
import { deepFreeze } from './deepFreeze.js';
import { applyCustomerMovementsWithinLock } from '../services/customerWalletService.js';
import { CUSTOMER_LEDGER_KEY, CUSTOMER_MOVEMENT_TYPES } from './customerLedger.js';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

function legacyReversalMovements(sale) {
    const fiadoAmountUsd = round2(sale.fiadoUsd || (sale.tipo === 'VENTA_FIADA' ? sale.totalUsd : 0) || 0);
    const favorUsed = sumR((sale.payments?.filter(p => p.methodId === 'saldo_favor') || []).map(p => p.amountUsd));
    const changeCredited = round2(sale.vueltoParaMonedero || 0);
    const isCobroDeuda = sale.tipo === 'COBRO_DEUDA';
    const amount = isCobroDeuda ? round2(sale.totalUsd || 0) : 0;
    const movements = [];

    if (isCobroDeuda && amount > 0) {
        movements.push({
            type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
            direction: 'DEBIT',
            amountUsd: amount,
            sourceType: 'REVERSAL',
            sourceId: `legacy-reversal:${sale.id}:cobro`,
            sourceSaleId: sale.id,
            reason: 'Reversión de abono histórico',
        });
        return movements;
    }

    // Reverse in opposite order to restore the balance before a mixed sale.
    if (changeCredited > 0) movements.push({
        type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
        direction: 'DEBIT',
        amountUsd: changeCredited,
        sourceType: 'REVERSAL',
        sourceId: `legacy-reversal:${sale.id}:vuelto`,
        sourceSaleId: sale.id,
        reason: 'Reversión de vuelto acreditado histórico',
    });
    if (fiadoAmountUsd > 0) movements.push({
        type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
        direction: 'CREDIT',
        amountUsd: fiadoAmountUsd,
        sourceType: 'REVERSAL',
        sourceId: `legacy-reversal:${sale.id}:fiado`,
        sourceSaleId: sale.id,
        reason: 'Reversión de venta fiada histórica',
    });
    if (favorUsed > 0) movements.push({
        type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
        direction: 'CREDIT',
        amountUsd: favorUsed,
        sourceType: 'REVERSAL',
        sourceId: `legacy-reversal:${sale.id}:favor`,
        sourceSaleId: sale.id,
        reason: 'Reversión de saldo a favor usado histórico',
    });
    return movements;
}

export async function processVoidSale(sale, currentSales, currentProducts) {
    if (!sale) throw new Error('Sale object is required to void.');
    if (sale.status === 'ANULADA') throw new Error('Esta venta ya fue anulada.');

    return withLock('pos_write_lock', async () => {
        const freshSales = await storageService.getItem(SALES_KEY, []);
        const freshSale = freshSales.find(s => s.id === sale.id);
        if (!freshSale || freshSale.status === 'ANULADA') throw new Error('Esta venta ya fue anulada.');

        const updatedSales = freshSales.map(s => s.id === sale.id ? { ...s, status: 'ANULADA' } : s);

        const freshProducts = await storageService.getItem(PRODUCTS_KEY, currentProducts || []);
        let updatedProducts = freshProducts;
        if (freshSale.items?.length > 0) {
            updatedProducts = freshProducts.map(p => {
                const itemsInSale = freshSale.items.filter(i => (i._originalId || i.id) === p.id);
                if (itemsInSale.length === 0) return p;
                // GRANEL-001: la suma a restaurar se acumula a 3 decimales para no
                // perder el tercer decimal del peso vendido (0.125 kg → 0.13 con sumR).
                const totalToRestore = itemsInSale.reduce((sum, item) => {
                    if (item.isWeight) return round3(sum + item.qty);
                    if (item._mode === 'unit') return round3(sum + divR(item.qty, item._unitsPerPackage || 1));
                    return round3(sum + item.qty);
                }, 0);
                // GRANEL-001: granel restaura hasta 3 decimales sin drift;
                // el resto permanece entero estricto.
                return { ...p, stock: adjustStockValue(p.stock || 0, totalToRestore, isGranelProduct(p)) };
            });
        }

        const savedCustomers = await storageService.getItem(CUSTOMERS_KEY, []);
        let updatedCustomers = savedCustomers;
        const savedLedger = await storageService.getItem(CUSTOMER_LEDGER_KEY, []);
        let ledgerMovements = savedLedger.filter(m => m.customerId === freshSale.customerId
            && (m.sourceSaleId === freshSale.id || m.sourceId?.startsWith(`${freshSale.id}:`))
            && m.type !== CUSTOMER_MOVEMENT_TYPES.REVERSAL);

        // New sales use their exact ledger movements. Historical sales are mapped
        // conservatively only when no source-linked movements exist.
        let reversalMovements = ledgerMovements.length > 0
            ? ledgerMovements.slice().reverse().map(original => ({
                type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
                direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
                amountUsd: original.amountUsd,
                sourceType: 'REVERSAL',
                sourceId: `reversal:${original.id}`,
                sourceSaleId: freshSale.id,
                reversalOf: original.id,
                reason: `Anulación de ${original.reason || original.type}`,
            }))
            : legacyReversalMovements(freshSale);

        // Cashea is a separate counterparty and remains outside the customer ledger.
        const casheaVentaUsd = freshSale.tipo === 'VENTA_CASHEA' ? round2(freshSale.casheaUsd || 0) : 0;
        const casheaRemesaUsd = freshSale.tipo === 'COBRO_CASHEA' ? round2(freshSale.totalUsd || 0) : 0;

        if (freshSale.customerId && reversalMovements.length > 0) {
            const walletResult = await applyCustomerMovementsWithinLock({
                customerId: freshSale.customerId,
                customers: savedCustomers,
                user: useAuthStore.getState().usuarioActivo,
                movements: reversalMovements,
            });
            updatedCustomers = walletResult.updatedCustomers;
        }

        if (freshSale.customerId && (casheaVentaUsd > 0 || casheaRemesaUsd > 0)) {
            updatedCustomers = updatedCustomers.map(customer => {
                if (customer.id !== freshSale.customerId) return customer;
                return {
                    ...customer,
                    casheaDeuda: Math.max(0, round2(
                        (customer.casheaDeuda || 0) - casheaVentaUsd + casheaRemesaUsd
                    )),
                };
            });
        }

        await storageService.setItem(SALES_KEY, updatedSales);
        await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
        await storageService.setItem(PRODUCTS_KEY, updatedProducts);

        deepFreeze(updatedProducts);
        deepFreeze(updatedCustomers);

        const user = useAuthStore.getState().usuarioActivo;
        const tipDonadaUsd = round2(freshSale.tipDonated?.amountUsd || 0);
        logEvent('VENTA', 'VENTA_ANULADA',
            `Venta #${freshSale.saleNumber || '?'} anulada - $${round2(freshSale.totalUsd || 0)}`
            + (tipDonadaUsd > 0
                ? ` - ATENCION: incluia propina donada de $${tipDonadaUsd}. Verifica el efectivo en caja.`
                : ''),
            user,
            { saleId: freshSale.id, tipo: freshSale.tipo, totalUsd: freshSale.totalUsd, tipDonatedUsd: tipDonadaUsd }
        );

        return { updatedSales, updatedProducts, updatedCustomers };
    });
}
