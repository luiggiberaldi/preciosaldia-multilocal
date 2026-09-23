import { storageService } from './storageService';
import { divR, mulR, round2, subR } from './dinero';
import { withLock } from './withLock';
import { deepFreeze } from './deepFreeze';
import { CurrencyService } from '../services/CurrencyService';

/**
 * Registra una REMESA DE CASHEA hacia la bodega.
 *
 * MODELO: Cashea (el financiador) le paga a la bodega el monto que financió al
 * cliente. NO es un abono del cliente — el cliente ya pagó su cuota inicial en el
 * momento de la venta y no debe nada.
 *
 * Por eso este procesador:
 *   - reduce `casheaDeuda` DIRECTAMENTE, sin pasar por `procesarImpactoCliente`
 *     (esa función maneja el saldo del CLIENTE: deuda/favor, otra contraparte);
 *   - persiste `vueltoParaMonedero: 0` para que anular NO acredite saldo al cliente;
 *   - crea un registro `COBRO_CASHEA` para que el dinero entre al breakdown de pagos.
 *
 * Soporta montos parciales (una remesa puede cubrir solo parte de lo pendiente).
 */
export async function processCasheaRemittance({
    transactionAmount,
    currencyMode,
    customer,
    paymentMethod,
    bcvRate,
    tasaCop,
    copEnabled,
}) {
    const rawAmount = CurrencyService.safeParse(transactionAmount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        return { error: 'Monto inválido' };
    }

    let amountUsd = rawAmount;
    if (currencyMode === 'BS') {
        if (!bcvRate || bcvRate <= 0) return { error: 'Tasa BCV no configurada' };
        amountUsd = divR(rawAmount, bcvRate);
    }
    if (currencyMode === 'COP') {
        if (!tasaCop || tasaCop <= 0) return { error: 'Tasa COP no configurada' };
        amountUsd = divR(rawAmount, tasaCop);
    }

    if (!customer?.id) return { error: 'Cliente inválido' };

    const result = await withLock('pos_write_lock', async () => {
        const customers = await storageService.getItem('bodega_customers_v1', []);
        const actual = customers.find(c => c.id === customer.id);
        if (!actual) return { error: 'Cliente no encontrado' };

        const pendiente = round2(actual.casheaDeuda || 0);
        if (pendiente <= 0.005) {
            return { error: 'Este cliente no tiene remesa Cashea pendiente' };
        }
        if (amountUsd > pendiente + 0.01) {
            return { error: `El monto excede lo pendiente ($${pendiente.toFixed(2)})` };
        }

        // Nunca dejar casheaDeuda negativa aunque el monto exceda por redondeo.
        const aplicado = Math.min(round2(amountUsd), pendiente);

        const updatedCustomer = { ...actual, casheaDeuda: subR(pendiente, aplicado) };
        const newCustomers = customers.map(c => (c.id === customer.id ? updatedCustomer : c));
        await storageService.setItem('bodega_customers_v1', newCustomers);

        const sales = await storageService.getItem('bodega_sales_v1', []);
        const nextSaleNumber = sales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        const totalEnBs  = currencyMode === 'BS'  ? rawAmount : mulR(aplicado, bcvRate);
        const totalEnCop = currencyMode === 'COP' ? rawAmount : mulR(aplicado, tasaCop);

        const remesaRecord = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            tipo: 'COBRO_CASHEA',
            saleNumber: nextSaleNumber,
            rate: bcvRate,
            status: 'COMPLETADA',
            clienteId: customer.id,
            clienteName: customer.name,
            totalBs: totalEnBs,
            totalUsd: aplicado,
            ...(copEnabled && { totalCop: totalEnCop }),
            paymentMethod,
            payments: [{
                methodId: paymentMethod,
                amount: currencyMode === 'USD' ? aplicado : (currencyMode === 'COP' ? totalEnCop : totalEnBs),
                currency: currencyMode,
                amountUsd: aplicado,
                amountBs: totalEnBs,
                methodLabel: paymentMethod.replace('_', ' '),
            }],
            // Cero a propósito: la remesa NO genera saldo a favor del cliente.
            vueltoParaMonedero: 0,
            customerId: customer.id,
            customerName: customer.name,
            items: [{ name: `Remesa Cashea: ${customer.name}`, qty: 1, priceUsd: aplicado, costBs: 0 }],
        };
        sales.unshift(remesaRecord);
        await storageService.setItem('bodega_sales_v1', sales);

        deepFreeze(newCustomers);
        return { updatedCustomer, newCustomers, aplicado };
    });

    return result;
}
