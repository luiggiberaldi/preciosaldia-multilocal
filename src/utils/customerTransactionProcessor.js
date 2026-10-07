import { storageService } from './storageService.js';
import { divR, mulR, round2 } from './dinero.js';
import { withLock } from './withLock.js';
import { deepFreeze } from './deepFreeze.js';
import { CurrencyService } from '../services/CurrencyService.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { applyCustomerMovementsWithinLock } from '../services/customerWalletService.js';
import { CUSTOMER_MOVEMENT_TYPES, normalizeCustomer } from './customerLedger.js';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

export async function processCustomerTransaction({
    transactionAmount,
    currencyMode,
    type,
    customer,
    paymentMethod,
    bcvRate,
    tasaCop,
    copEnabled,
}) {
    const rawAmount = CurrencyService.safeParse(transactionAmount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) return { error: 'Monto inválido' };

    let amountUsd = rawAmount;
    if (currencyMode === 'BS') {
        if (!bcvRate || bcvRate <= 0) return { error: 'Tasa BCV no configurada' };
        amountUsd = divR(rawAmount, bcvRate);
    }
    if (currencyMode === 'COP') {
        if (!tasaCop || tasaCop <= 0) return { error: 'Tasa COP no configurada' };
        amountUsd = divR(rawAmount, tasaCop);
    }

    return withLock('pos_write_lock', async () => {
        const freshCustomers = await storageService.getItem(CUSTOMERS_KEY, []);
        const freshCustomer = freshCustomers.find(c => c.id === customer?.id) || customer;
        if (!freshCustomer) return { error: 'El cliente no existe o fue actualizado.' };
        const effectiveCustomers = freshCustomers.some(c => c.id === freshCustomer.id)
            ? freshCustomers
            : [freshCustomer, ...freshCustomers];
        const normalizedFreshCustomer = normalizeCustomer(freshCustomer);

        const sales = await storageService.getItem(SALES_KEY, []);
        const nextSaleNumber = sales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        const saleId = crypto.randomUUID();
        const totalEnBs = currencyMode === 'BS' ? rawAmount : mulR(amountUsd, bcvRate);
        const totalEnCop = currencyMode === 'COP' ? rawAmount : mulR(amountUsd, tasaCop);
        const isPayment = type === 'ABONO';
        // Un abono mayor que la deuda liquida la deuda y convierte únicamente
        // el sobrante en saldo a favor. Se persiste explícitamente para que
        // ticket, reportes y anulación conozcan la intención sin confundirlo
        // con el vuelto de una venta de productos.
        const saldoFavorGeneradoUsd = isPayment
            ? Math.max(0, round2(amountUsd - (Number(normalizedFreshCustomer.deuda) || 0)))
            : 0;

        const record = isPayment
            ? {
                id: saleId,
                timestamp: new Date().toISOString(),
                tipo: 'COBRO_DEUDA',
                saleNumber: nextSaleNumber,
                rate: bcvRate,
                tasaCop: copEnabled ? tasaCop : 0,
                status: 'COMPLETADA',
                clienteId: freshCustomer.id,
                clienteName: freshCustomer.name,
                totalBs: totalEnBs,
                totalUsd: amountUsd,
                ...(copEnabled && { totalCop: totalEnCop }),
                paymentMethod,
                payments: [{
                    methodId: paymentMethod,
                    amount: currencyMode === 'USD' ? amountUsd : (currencyMode === 'COP' ? totalEnCop : totalEnBs),
                    currency: currencyMode,
                    amountUsd,
                    amountBs: totalEnBs,
                    methodLabel: paymentMethod.replace(/_/g, ' '),
                }],
                // El abono puede dejar saldo a favor, pero este campo histórico
                // representa vuelto de una venta y no debe duplicar el ledger.
                vueltoParaMonedero: 0,
                saldoFavorGeneradoUsd,
                customerId: freshCustomer.id,
                customerName: freshCustomer.name,
                items: [{ name: `Abono de deuda: ${freshCustomer.name}`, qty: 1, priceUsd: amountUsd, costBs: 0 }],
            }
            : {
                id: saleId,
                timestamp: new Date().toISOString(),
                tipo: 'VENTA_FIADA',
                saleNumber: nextSaleNumber,
                rate: bcvRate,
                tasaCop: copEnabled ? tasaCop : 0,
                status: 'COMPLETADA',
                clienteId: freshCustomer.id,
                clienteName: freshCustomer.name,
                totalBs: totalEnBs,
                totalUsd: amountUsd,
                ...(copEnabled && { totalCop: totalEnCop }),
                fiadoUsd: amountUsd,
                vueltoParaMonedero: 0,
                customerId: freshCustomer.id,
                customerName: freshCustomer.name,
                items: [{ name: `Crédito manual: ${freshCustomer.name}`, qty: 1, priceUsd: amountUsd, costBs: 0 }],
            };

        const walletResult = await applyCustomerMovementsWithinLock({
            customerId: freshCustomer.id,
            customers: effectiveCustomers,
            user: useAuthStore.getState().usuarioActivo,
            movements: [{
                type: isPayment ? CUSTOMER_MOVEMENT_TYPES.DEBT_PAYMENT : CUSTOMER_MOVEMENT_TYPES.CREDIT_SALE,
                direction: isPayment ? 'CREDIT' : 'DEBIT',
                amountUsd,
                sourceType: 'SALE',
                sourceId: `${saleId}:cartera`,
                sourceSaleId: saleId,
                paymentMethodId: isPayment ? paymentMethod : null,
                reason: isPayment ? 'Abono de deuda' : 'Crédito manual',
            }],
        });

        await storageService.setItem(SALES_KEY, [record, ...sales]);
        deepFreeze(walletResult.updatedCustomers);
        return {
            updatedCustomer: walletResult.updatedCustomer,
            newCustomers: walletResult.updatedCustomers,
            sale: record,
        };
    });
}
