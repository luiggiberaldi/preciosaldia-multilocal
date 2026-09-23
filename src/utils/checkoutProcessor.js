import { storageService } from './storageService.js';
import { applyCustomerMovementsWithinLock } from '../services/customerWalletService.js';
import { CUSTOMER_MOVEMENT_TYPES, normalizeCustomer } from './customerLedger.js';
import { logEvent } from '../services/auditService.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { round2, round0, round3, sumR, subR, divR, mulR } from './dinero.js';
import { isGranelProduct } from './granel.js'; // GRANEL-001
import { withLock } from './withLock.js';          // FIN-007: feature detection + fallback.
import { deepFreeze } from './deepFreeze.js';      // FIN-008: deep freeze (no solo shallow).
import { FINANCIAL_EPSILON } from './securityConstants.js';
import { FinancialEngine } from '../core/FinancialEngine.js';
import { CurrencyService } from '../services/CurrencyService.js';

const SALES_KEY = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

export async function processSaleTransaction({
    cart,
    cartTotalUsd,
    cartTotalBs,
    cartSubtotalUsd,
    payments,
    changeBreakdown,
    selectedCustomerId,
    customers,
    products,
    effectiveRate,
    tasaCop,
    copEnabled,
    discountData,
    useAutoRate
}) {
    if (cart.length === 0) return { success: false, error: 'Carrito vacío' };

    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    // Detectar si el pago recibido es en Bolívares y recalcular cartTotals dinámicamente si hay Doble Precio
    const isBsPayment = payments && payments.some(p => p.currency === 'BS' && CurrencyService.safeParse(p.amountBs) > 0);
    const hasDualItem = cart && cart.some(i => i.pricingMode === 'dual_usd' && CurrencyService.safeParse(i.priceBsUsdRef) > 0);

    let activeCartTotalUsd = cartTotalUsd;
    let activeCartTotalBs = cartTotalBs;

    if (hasDualItem) {
        const computedTotals = FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, copEnabled ? tasaCop : 0, isBsPayment);
        activeCartTotalUsd = computedTotals.totalUsd;
        activeCartTotalBs = computedTotals.totalBs;
    }

    if (isNaN(activeCartTotalUsd) || activeCartTotalUsd < 0 || isNaN(activeCartTotalBs) || activeCartTotalBs < 0) {
        return { success: false, error: 'Integridad matemática comprometida' };
    }
    if (activeCartTotalUsd <= 0.01) {
        return { success: false, error: 'No se pueden generar ventas de $0.00' };
    }
    if (!Array.isArray(payments) || payments.some(p => isNaN(p.amountUsd) || p.amountUsd < 0)) {
        return { success: false, error: 'Datos de pago inválidos' };
    }

    const internalCreditUsd = sumR(payments
        .filter(p => p.methodId === 'saldo_favor' || p.isInternalCredit)
        .map(p => p.amountUsd));
    if (internalCreditUsd > FINANCIAL_EPSILON.PAYMENT_ZERO && !selectedCustomerId) {
        return { success: false, error: 'Se requiere cliente para usar saldo a favor.' };
    }

    // FIN-022: Validación de tasa y consistencia matemática entre USD y Bs.
    if (!effectiveRate || effectiveRate <= 0) {
        return { success: false, error: 'Tasa de cambio BCV inválida (<= 0). Configura la tasa antes de cobrar.' };
    }
    const expectedBs = mulR(activeCartTotalUsd, effectiveRate);
    const bsDrift = Math.abs(subR(activeCartTotalBs, expectedBs));
    if (bsDrift > FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS) {
        return { success: false, error: `Inconsistencia USD/Bs: drift de ${round2(bsDrift)} Bs (tasa ${effectiveRate}).` };
    }

    // ── Aritmética precisa con dinero.js (elimina IEEE 754 drift) ──
    const totalPaidUsd = sumR(payments.map(p => p.amountUsd));
    const remainingUsd = round2(Math.max(0, subR(activeCartTotalUsd, totalPaidUsd)));
    const changeUsd    = round2(Math.max(0, subR(totalPaidUsd, activeCartTotalUsd)));

    // Una venta en modo Crédito solo puede cubrir el total o quedar parcialmente
    // fiada. Un pago superior al total pertenece al flujo Contado: si se aceptara
    // aquí, el excedente podría quedar fuera de changeUsd y no llegar a caja ni a
    // la billetera del cliente. La UI también lo bloquea, pero esta validación es
    // la frontera de integridad para llamadas antiguas o manipuladas.
    if (changeBreakdown?.esCredito === true && changeUsd > FINANCIAL_EPSILON.PAYMENT_ZERO) {
        return {
            success: false,
            error: `En modo crédito el pago excede la venta en $${round2(changeUsd)}. Cambia a Contado para gestionar el vuelto o registra un abono desde Cartera.`,
        };
    }

    // FIN-034: Normalizar el vuelto declarado por la UI.
    // La UI podía enviar el MISMO vuelto duplicado en USD y en Bs (ej: {10, 400} a tasa 40
    // para un vuelto real de $10), y el FinancialEngine sumaba ambos → $20 de vuelto.
    // `changeUsd` (el vuelto real calculated aquí) es el techo absoluto: nunca se entrega más.
    // Se prioriza el tramo en Bs porque es el que el operador escribe explícitamente.
    // NOTA: effectiveRate ya fue validado > 0 arriba (FIN-022), así que divR es seguro.
    const rawChangeUsdGiven = round2(Math.max(0, Number(changeBreakdown?.changeUsdGiven) || 0));
    const rawChangeBsGiven  = round2(Math.max(0, Number(changeBreakdown?.changeBsGiven)  || 0));
    // El monto dejado en caja es una parte del vuelto, no una propina adicional.
    // Se descuenta antes de calcular el vuelto físico para impedir que la suma
    // "caja + entregado + billetera" supere el cambio real.
    const rawTip = changeBreakdown?.tipDonated || null;
    const requestedTipUsd = round2(Math.min(
        Math.max(0, Number(rawTip?.amountUsd) || 0),
        changeUsd
    ));
    const availableForPhysicalChangeUsd = round2(Math.max(0, subR(changeUsd, requestedTipUsd)));
    const bsGivenAsUsd      = round2(divR(rawChangeBsGiven, effectiveRate));
    const givenChangeBsUsd  = Math.min(bsGivenAsUsd, availableForPhysicalChangeUsd);
    const givenChangeBs     = givenChangeBsUsd === bsGivenAsUsd
        ? rawChangeBsGiven
        : round2(mulR(givenChangeBsUsd, effectiveRate));
    const requestedPhysicalUsd = round2(Math.min(
        rawChangeUsdGiven,
        Math.max(0, subR(availableForPhysicalChangeUsd, givenChangeBsUsd))
    ));

    // Si el operador no activa "Acreditar resto", todo lo que no dejó en caja
    // debe salir como vuelto físico. Los campos USD/Bs son un desglose de
    // denominaciones, no una autorización para que desaparezca el remanente.
    // Con billetera activa, en cambio, el remanente se acredita explícitamente.
    const hasExplicitChangeAllocation = changeBreakdown?.changeAllocationExplicit === true;
    const givenChangeUsd = hasExplicitChangeAllocation || changeBreakdown?.vueltoCredito
        ? requestedPhysicalUsd
        : round2(Math.max(0, subR(availableForPhysicalChangeUsd, givenChangeBsUsd)));

    const casheaPayment = payments.find(p => p.methodId === 'cashea');
    const casheaUsd = casheaPayment ? round2(casheaPayment.amountUsd) : 0;

    if (!selectedCustomerId && (remainingUsd > 0.01 || casheaUsd > 0)) {
        return { success: false, error: remainingUsd > 0.01 ? 'Se requiere cliente para ventas fiadas' : 'Se requiere cliente para ventas con Cashea' };
    }

    // FIN-005: Bloquear ventas con anomalía de vuelto (changeUsd > total * 5).
    const changeAnomalyThresholdUsd = mulR(activeCartTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);
    if (changeUsd > FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_USD && changeUsd > changeAnomalyThresholdUsd) {
        return {
            success: false,
            error: `Vuelto anómalo detectado: $${round2(changeUsd)} para una venta de $${round2(activeCartTotalUsd)}. Verifica los montos ingresados.`
        };
    }

    const fiadoAmountUsd = remainingUsd > 0.01 ? remainingUsd : 0;
    const tipoVenta = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA');

    // ── TIP-001 / TIP-003 / TIP-004: propina donada ("cliente deja el cambio") ──
    // `changeUsd` es el techo absoluto: no se puede donar más vuelto del que existe.
    // Se guarda UNA sola moneda canónica: `amountUsd` siempre, `amountBs` solo si
    // la moneda nativa es Bs (y recalculado aquí, sin confiar en el input de la UI).
    // Una VENTA_FIADA no genera sobrepago, así que no admite propina (D4).
    // Una VENTA_CASHEA sí: el vuelto de la cuota inicial es efectivo real (D5).
    const tipUsd = tipoVenta !== 'VENTA_FIADA' ? requestedTipUsd : 0;
    const tipIsBs = rawTip?.currency === 'BS';
    const tipDonated = (rawTip
        && tipUsd > FINANCIAL_EPSILON.PAYMENT_ZERO)
        ? {
            amountUsd: tipUsd,
            amountBs: tipIsBs ? round2(mulR(tipUsd, effectiveRate)) : 0,
            currency: tipIsBs ? 'BS' : 'USD',
        }
        : null;

    // ── Normalizar payments: asegurar currency y methodLabel ──
    // Esto permite que el FinancialEngine calcule el breakdown correctamente
    // sin depender de campos que podían llegar undefined en versiones anteriores.
    const normalizedPayments = payments.map(p => ({
        ...p,
        currency:    p.currency    || 'USD',
        methodLabel: p.methodLabel || p.methodId,
    }));

    const requestedCreditChangeUsd = changeBreakdown?.vueltoCredito && tipoVenta !== 'VENTA_FIADA'
        ? round2(Math.max(0, subR(availableForPhysicalChangeUsd, sumR(requestedPhysicalUsd, givenChangeBsUsd))))
        : 0;

    if (requestedCreditChangeUsd > FINANCIAL_EPSILON.PAYMENT_ZERO && !selectedCustomerId) {
        return { success: false, error: 'Se requiere cliente para acreditar el vuelto.' };
    }

    // Cuando el cajero comenzó una distribución explícita, todos los destinos
    // deben sumar el vuelto completo. Evita que una parte quede sin destino por
    // accidente: caja + físico + billetera siempre debe cuadrar.
    const allocatedChangeUsd = sumR(
        tipUsd,
        givenChangeUsd,
        givenChangeBsUsd,
        requestedCreditChangeUsd
    );
    const unallocatedChangeUsd = round2(Math.max(0, subR(changeUsd, allocatedChangeUsd)));
    if (hasExplicitChangeAllocation && unallocatedChangeUsd > FINANCIAL_EPSILON.PAYMENT_ZERO) {
        return {
            success: false,
            error: `Vuelto sin asignar: $${round2(unallocatedChangeUsd)}. Entrégalo, déjalo en caja o acredita el resto a la billetera.`,
        };
    }

    const sale = {
        id: crypto.randomUUID(),
        tipo: tipoVenta,
        status: 'COMPLETADA',
        items: cart.map(i => ({
            id: i.id,
            name: i.name,
            qty: i.qty,
            priceUsd: i.priceUsd,
            pricingMode: i.pricingMode || null,
            priceBsUsdRef: i.priceBsUsdRef || null,
            priceCop: i.priceCop || null,
            costBs: i.costBs || 0,
            costUsd: i.costUsd || 0,
            isWeight: i.isWeight,
            isCashAdvance: i.isCashAdvance || null,
            montoEfectivo: i.montoEfectivo || null,
            montoComision: i.montoComision || null,
            comisionPct: i.comisionPct || null,
            currency: i.currency || null,
            exactBs: i.exactBs || null
        })),
        cartSubtotalUsd: cartSubtotalUsd,
        discountType:       discountData?.type      || null,
        discountValue:      discountData?.value     || 0,
        discountAmountUsd:  discountData?.amountUsd || 0,
        totalUsd:  activeCartTotalUsd,
        totalBs:   activeCartTotalBs,
        // FIN-010: totalCop ahora alineado con buildCartTotals (divR + round2).
        totalCop:  copEnabled && tasaCop > 0
            ? (cart.every(i => i.priceCop > 0)
                ? round2(mulR(
                    cart.reduce((s, i) => sumR(s, mulR(i.priceCop, i.qty)), 0),
                    subR(1, divR(discountData?.amountUsd || 0, cartSubtotalUsd || 1))
                ))
                : mulR(activeCartTotalUsd, tasaCop))
            : 0,
        payments:  normalizedPayments,          // ← Con currency + methodLabel
        rate:      effectiveRate,
        tasaCop:   copEnabled ? tasaCop : 0,
        copEnabled: copEnabled,
        rateSource: useAutoRate ? 'BCV Auto' : 'Manual',
        timestamp: new Date().toISOString(),
        // FIN-034 + FIN-035: vuelto normalizado (nunca supera el vuelto real).
        // Solo la VENTA_FIADA no puede tener vuelto (no hay sobrepago, hay saldo pendiente).
        // Una VENTA_CASHEA sí puede: el vuelto de la cuota inicial es efectivo real que salió de caja.
        // TIP-002 (D3): propina donada ⟹ vuelto entregado 0, sin excepción.
        // Se fuerza aquí y no solo en la UI: si un modo de checkout manda ambos,
        // el dinero se contaría dos veces (una donado, una entregado).
        // `change*` representa solo el vuelto físico entregado. El monto dejado
        // en caja vive en tipDonated y el monto llevado a billetera en el ledger.
        changeUsd: tipoVenta === 'VENTA_FIADA' ? 0 : givenChangeUsd,
        changeBs:  tipoVenta === 'VENTA_FIADA' ? 0 : givenChangeBs,
        // Crédito interno persistido en USD para reversión exacta.
        vueltoParaMonedero: requestedCreditChangeUsd,
        // Registro canónico de los tres destinos del vuelto. Evita tener que
        // inferir una distribución leyendo campos históricos por separado.
        changeAllocation: tipoVenta === 'VENTA_FIADA' ? null : {
            totalUsd: changeUsd,
            keptInCashUsd: tipUsd,
            deliveredUsd: givenChangeUsd,
            deliveredBs: givenChangeBs,
            creditedUsd: requestedCreditChangeUsd,
        },
        customerId:       selectedCustomerId || null,
        customerName:     selectedCustomer ? selectedCustomer.name : 'Consumidor Final',
        customerDocument: selectedCustomer?.documentId || null,
        customerPhone:    selectedCustomer?.phone      || null,
        fiadoUsd: fiadoAmountUsd,
        casheaUsd: casheaUsd,
        // TIP-001: propina donada, ya normalizada a una sola moneda canónica.
        tipDonated: tipDonated
    };

    // FIN-008: deepFreeze en lugar de Object.freeze (congela items[] y payments[]).
    deepFreeze(sale);

    // FIN-007: withLock reemplaza navigator.locks.request directo (feature detection + fallback).
    const lockResult = await withLock('pos_write_lock', async () => {
        const existingSales = await storageService.getItem(SALES_KEY, []);
        const saleNumber = existingSales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        // FIN-008: deep-freeze el sale persistido final.
        let finalPersistedSale = deepFreeze({ ...sale, saleNumber });

        // Validación financiera dentro del lock y contra el snapshot más fresco,
        // antes de persistir venta o stock.
        let walletSnapshot = null;
        if (selectedCustomerId) {
            const validationCustomers = await storageService.getItem(CUSTOMERS_KEY, customers);
            const validationCustomer = validationCustomers.find(c => c.id === selectedCustomerId);
            if (!validationCustomer) {
                return { success: false, error: 'El cliente no existe o fue actualizado.' };
            }
            const normalizedValidationCustomer = normalizeCustomer(validationCustomer);
            if (internalCreditUsd > (Number(normalizedValidationCustomer.favor) || 0) + FINANCIAL_EPSILON.PAYMENT_ZERO) {
                return { success: false, error: `El saldo a favor disponible es insuficiente. Disponible: $${round2(Number(normalizedValidationCustomer.favor) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` };
            }
            // AVISO-CARTERA: congelar la cartera previa en la venta para que el
            // recibo pueda explicar consumos de saldo a favor (H2: un fiado a un
            // cliente con favor consume el favor y la deuda no aumenta).
            walletSnapshot = {
                favorAntes: round2(Number(normalizedValidationCustomer.favor) || 0),
                deudaAntes: round2(Number(normalizedValidationCustomer.deuda) || 0),
            };
        }

        // AVISO-CARTERA: el snapshot viaja en el documento que se persiste y se
        // devuelve (el recibo lo lee de ahí).
        if (walletSnapshot) {
            finalPersistedSale = deepFreeze({ ...finalPersistedSale, walletSnapshot });
        }

        await storageService.setItem(SALES_KEY, [finalPersistedSale, ...existingSales]);

        // Audit log
        const user = useAuthStore.getState().usuarioActivo;
        const tipo = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA_COMPLETADA');
        logEvent('VENTA', tipo,
            // FIN-036: usar el total dinámico, el mismo que se persiste en la venta.
            `Venta #${saleNumber} - $${round2(activeCartTotalUsd)} - ${cart.length} items - ${selectedCustomer?.name || 'Consumidor Final'}`,
            user,
            { saleId: finalPersistedSale.id, total: activeCartTotalUsd, items: cart.length }
        );

        // ── Deducir stock con precisión ──
        // FIN-027-pattern: re-leer productos fresco aquí para evitar stale state.
        const freshProducts = await storageService.getItem(PRODUCTS_KEY, products);
        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
        let negativeStockUsed = false;
        const negativeItems = [];

        const updatedProducts = freshProducts.map(p => {
            const cartItemsForThisProduct = cart.filter(i => (i._originalId || i.id) === p.id);
            if (cartItemsForThisProduct.length > 0) {
                // GRANEL-001: la suma de cantidades deducidas se acumula a 3 decimales.
                // sumR (round2) convertía 0.125 kg en 0.13 antes de restar → stock erróneo.
                const totalDeducted = cartItemsForThisProduct.reduce((sum, item) => {
                    if (item.isWeight)        return round3(sum + item.qty);
                    if (item._mode === 'unit') return round3(sum + divR(item.qty, item._unitsPerPackage || 1));
                    return round3(sum + item.qty);
                }, 0);

                // GRANEL-001: granel conserva hasta 3 decimales al descontar
                // (subR truncaba a 2, perdiendo el tercer decimal en 0.125 kg).
                // El resto de productos permanece estrictamente entero.
                const newStock = isGranelProduct(p)
                    ? round3((p.stock ?? 0) - totalDeducted)
                    : round0((p.stock ?? 0) - totalDeducted);
                // FIN-014: auditar uso de stock negativo (no mover el flag, solo loguear).
                if (newStock < 0 && allowNeg) {
                    negativeStockUsed = true;
                    negativeItems.push({ productId: p.id, name: p.name, stockBefore: p.stock ?? 0, deducted: totalDeducted, stockAfter: newStock });
                }
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
            }
            return p;
        });

        if (negativeStockUsed) {
            const user = useAuthStore.getState().usuarioActivo;
            logEvent('CONFIG', 'NEGATIVE_STOCK_USED',
                `Venta #${saleNumber} usó stock negativo en ${negativeItems.length} producto(s)`,
                user,
                { saleId: finalPersistedSale.id, items: negativeItems }
            );
        }

        // FIN-008: deep-freeze products antes de retornar.
        await storageService.setItem(PRODUCTS_KEY, updatedProducts);
        deepFreeze(updatedProducts);

        let updatedCustomers = customers;

        if (selectedCustomerId) {
            // Leer cliente fresco dentro del lock y registrar cada impacto como un
            // movimiento independiente, manteniendo snapshot y ledger consistentes.
            const freshCustomers = await storageService.getItem(CUSTOMERS_KEY, customers);
            const freshSelected = freshCustomers.find(c => c.id === selectedCustomerId);
            if (!freshSelected) {
                throw new Error('El cliente no existe o fue actualizado.');
            }

            const movements = [];
            if (internalCreditUsd > FINANCIAL_EPSILON.PAYMENT_ZERO) {
                movements.push({
                    type: CUSTOMER_MOVEMENT_TYPES.CREDIT_USED,
                    direction: 'DEBIT',
                    amountUsd: internalCreditUsd,
                    sourceType: 'SALE',
                    sourceId: `${finalPersistedSale.id}:saldo_favor`,
                    sourceSaleId: finalPersistedSale.id,
                    paymentMethodId: 'saldo_favor',
                    reason: 'Saldo a favor utilizado en venta',
                });
            }
            if (fiadoAmountUsd > FINANCIAL_EPSILON.PAYMENT_ZERO) {
                movements.push({
                    type: CUSTOMER_MOVEMENT_TYPES.CREDIT_SALE,
                    direction: 'DEBIT',
                    amountUsd: fiadoAmountUsd,
                    sourceType: 'SALE',
                    sourceId: `${finalPersistedSale.id}:fiado`,
                    sourceSaleId: finalPersistedSale.id,
                    reason: 'Venta fiada',
                });
            }
            if (requestedCreditChangeUsd > FINANCIAL_EPSILON.PAYMENT_ZERO) {
                movements.push({
                    type: CUSTOMER_MOVEMENT_TYPES.CHANGE_CREDITED,
                    direction: 'CREDIT',
                    amountUsd: requestedCreditChangeUsd,
                    sourceType: 'SALE',
                    sourceId: `${finalPersistedSale.id}:vuelto`,
                    sourceSaleId: finalPersistedSale.id,
                    reason: 'Vuelto acreditado a cartera',
                });
            }

            if (movements.length > 0) {
                const walletResult = await applyCustomerMovementsWithinLock({
                    customerId: freshSelected.id,
                    customers: freshCustomers,
                    user,
                    movements,
                });
                updatedCustomers = walletResult.updatedCustomers;
            } else {
                updatedCustomers = freshCustomers;
            }
            deepFreeze(updatedCustomers);
        }

        return {
            success: true,
            sale: finalPersistedSale,
            updatedProducts,
            updatedCustomers
        };
    });

    return lockResult;
}
