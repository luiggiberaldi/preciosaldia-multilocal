/**
 * FinancialEngine.js
 *
 * Centralized, pure-function mathematical engine for POS calculations.
 * ALL financial logic across the app (profits, totals, discounts, breakdowns)
 * MUST route through these functions to guarantee 100% mathematical integrity
 * and shield against UI-side modifications.
 *
 * v2.1 — FIN-FIXES:
 *   - FIN-002: Apertura COP entra al breakdown de efectivo_cop.
 *   - FIN-003: No fallback mágico a tasaCop=1 para ventas legacy (skip + flag).
 *   - FIN-004: VENTA_FIADA usa sale.fiadoUsd y NO hace return; procesa pagos reales.
 *   - FIN-005: Anomalías de vuelto se devuelven en array (no se muta sale).
 *   - FIN-010: buildCartTotals.totalCop usa divR + round2 consistentemente.
 *   - FIN-011: calculateSaleProfit acepta Map<id, product> opcional (4to arg).
 */

import { round2, mulR, divR, subR, sumR } from '../utils/dinero.js';
import { FINANCIAL_EPSILON } from '../utils/securityConstants.js';
import { getGeneratedWalletCredit } from '../utils/customerLedger.js';

// ── Labels de métodos de pago de fábrica (lookup puro, sin async) ──
// Resuelve el nombre legible de un methodId sin necesitar el módulo async.
const FACTORY_LABELS = {
    efectivo_bs:       'Efectivo Bs',
    pago_movil:        'Pago Móvil',
    punto_venta:       'Punto de Venta',
    efectivo_usd:      'Efectivo $',
    efectivo_cop:      'Efectivo COP',
    transferencia_cop: 'Transferencia COP',
    saldo_favor:       'Saldo a Favor',
    fiado:             'Fiado (Por Cobrar)',
    cashea:            'Cashea (Por Cobrar)',
};

function _resolveMethodLabel(methodId) {
    if (!methodId) return 'Método Desconocido';
    if (FACTORY_LABELS[methodId]) return FACTORY_LABELS[methodId];
    if (methodId.startsWith('custom_')) return 'Método Personalizado';
    // Fallback: snake_case → Title Case
    return methodId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// FIN-011: Helpers para construir/consultar Map<id, product> (O(1) lookup).
function _buildProductsMap(products) {
    const map = new Map();
    if (!Array.isArray(products)) return map;
    for (const p of products) {
        if (!p) continue;
        if (p.id != null && !map.has(p.id)) map.set(p.id, p);
        if (p.name != null && !map.has(p.name)) map.set(p.name, p);
    }
    return map;
}

function _lookupProduct(map, item) {
    if (!map || !(map instanceof Map) || !item) return null;
    if (item.id != null && map.has(item.id)) return map.get(item.id);
    if (item._originalId != null && map.has(item._originalId)) return map.get(item._originalId);
    if (item.name != null && map.has(item.name)) return map.get(item.name);
    return null;
}

export class FinancialEngine {

    /**
     * Calculates the true net profit of a single sale.
     * Subtracts the global cart discount and evaluates margin per item.
     *
     * @param {Object} sale - The sale object from database
     * @param {number} bcvRate - The active BCV rate for fallback comparisons
     * @param {Array} products - The global product dictionary to resolve unknown costs
     * @param {Map} [productsMap] - Optional pre-built Map<id|name, product> for O(1) lookup (FIN-011).
     *                              If not provided, the array is indexed on every call (O(n) per item).
     * @returns {number} Net Profit in Bs.
     */
    static calculateSaleProfit(sale, bcvRate, products, productsMap) {
        if (!sale) return 0;
        if (sale.tipo === 'AVANCE_EFECTIVO') {
            const saleRate = sale.rate || bcvRate || 1;
            if (sale.currency === 'BS') {
                return round2(sale.montoComision || 0);
            } else {
                return mulR(sale.montoComision || 0, saleRate);
            }
        }
        if (!sale.items || sale.items.length === 0) return 0;

        const saleRate = sale.rate || bcvRate;
        // FIN-011: usar Map si viene, si no construirlo una sola vez por call.
        const pMap = (productsMap instanceof Map)
            ? productsMap
            : _buildProductsMap(products);

        // Sum the profit of each individual item (Revenue - Cost)
        const itemProfits = sale.items.map(item => {
            if (item.isCashAdvance) {
                if (item.currency === 'BS') {
                    return round2(item.montoComision || 0);
                } else {
                    return mulR(item.montoComision || 0, saleRate);
                }
            }
            let costBs = 0;

            if (item.costUsd) {
                costBs = mulR(item.costUsd, saleRate);
            } else if (item.costBs) {
                costBs = round2(item.costBs);
            } else {
                // Fallback: Resolve cost dynamically — O(1) con Map, O(n) sin él.
                const p = _lookupProduct(pMap, item);
                if (p) {
                    costBs = p.costUsd ? mulR(p.costUsd, saleRate) : round2(p.costBs || 0);
                    if (item.id && typeof item.id === 'string' && item.id.endsWith('_unit')) {
                        costBs = divR(costBs, (p.unitsPerPackage || 1));
                    }
                }
            }

            // Revenue = price * qty * rate (rounded at each step)
            const itemRevenueBs = mulR(mulR(item.priceUsd, item.qty), saleRate);
            const itemCostBs = mulR(costBs, item.qty);
            return subR(itemRevenueBs, itemCostBs);
        });

        const itemsProfit = sumR(itemProfits);

        // Subtract the global cart discount spread (represented in Bs)
        const discountBs = mulR((sale.discountAmountUsd || 0), saleRate);

        return subR(itemsProfit, discountBs);
    }

    /**
     * Aggregates total profit for an array of sales.
     * FIN-011: builds the products Map once for the whole array (was O(K·N·M), now O(N + K·M)).
     */
    static calculateAggregateProfit(salesArray, bcvRate, products) {
        if (!Array.isArray(salesArray) || salesArray.length === 0) return 0;
        const pMap = _buildProductsMap(products);
        const profits = salesArray.map(sale => this.calculateSaleProfit(sale, bcvRate, products, pMap));
        return sumR(profits);
    }

    /**
     * Calculates the breakdown of payments received across multiple sales,
     * deducting the change returned (`changeUsd` or `changeBs`) to find the True Net Receipts.
     *
     * @param {Array} salesArray - Array of sales to aggregate
     * @param {{ withAnomalies?: boolean }} [opts] - If true, returns { breakdown, anomalies } (FIN-005).
     * @returns {Object|{ breakdown: Object, anomalies: Array }}
     */
    static calculatePaymentBreakdown(salesArray, opts = {}) {
        const breakdown = {};
        // FIN-005: Collect anomalies in a side array instead of mutating sale objects.
        const anomalies = [];

        salesArray.forEach(sale => {
            // ── FIA-REPORT-001: una venta ANULADA no aporta ni caja ni cuenta por cobrar.
            // Los reportes ya filtraban antes de llamar, pero el fondo de caja del POS
            // (`SalesView.currentFloat`) no lo hacía: una venta anulada seguía sumando
            // efectivo al cajón. `getGeneratedWalletCredit` ya tenía este guardarraíl.
            if (sale?.status === 'ANULADA') return;

            // ── APERTURA DE CAJA: add opening float to cash buckets (not revenue) ──
            if (sale.tipo === 'APERTURA_CAJA') {
                if (sale.openingUsd > 0) {
                    if (!breakdown['efectivo_usd']) breakdown['efectivo_usd'] = { total: 0, currency: 'USD', label: 'Efectivo $' };
                    breakdown['efectivo_usd'].total = round2(breakdown['efectivo_usd'].total + round2(sale.openingUsd));
                }
                if (sale.openingBs > 0) {
                    if (!breakdown['efectivo_bs']) breakdown['efectivo_bs'] = { total: 0, currency: 'BS', label: 'Efectivo Bs' };
                    breakdown['efectivo_bs'].total = round2(breakdown['efectivo_bs'].total + round2(sale.openingBs));
                }
                // FIN-002: Apertura COP entra al breakdown (antes se ignoraba → "faltante" sistemático).
                if (sale.openingCop > 0) {
                    if (!breakdown['efectivo_cop']) breakdown['efectivo_cop'] = { total: 0, currency: 'COP', label: 'Efectivo COP' };
                    breakdown['efectivo_cop'].total = round2(breakdown['efectivo_cop'].total + round2(sale.openingCop));
                }
                return; // Do NOT count opening as revenue
            }

            if (sale.tipo === 'AVANCE_EFECTIVO') {
                const isBs = sale.currency === 'BS';
                const isUsd = sale.currency === 'USD';
                const isCop = sale.currency === 'COP';
                
                // 1. Registrar salida de efectivo físico del cajón
                const cashMethod = isBs ? 'efectivo_bs' : (isUsd ? 'efectivo_usd' : 'efectivo_cop');
                const cashCurrency = isBs ? 'BS' : (isUsd ? 'USD' : 'COP');
                if (!breakdown[cashMethod]) {
                    breakdown[cashMethod] = { total: 0, currency: cashCurrency, label: _resolveMethodLabel(cashMethod) };
                }
                breakdown[cashMethod].total = round2(breakdown[cashMethod].total - round2(sale.montoEfectivo || 0));

                // 2. Registrar entrada de dinero electrónico cobrado
                const paymentMethod = sale.metodoPago || 'pago_movil';
                let resolvedCurrency = 'BS';
                if (paymentMethod.includes('usd') || paymentMethod.includes('zelle') || paymentMethod.includes('binance')) {
                    resolvedCurrency = 'USD';
                } else if (paymentMethod.includes('cop')) {
                    resolvedCurrency = 'COP';
                }

                if (!breakdown[paymentMethod]) {
                    breakdown[paymentMethod] = { 
                        total: 0, 
                        currency: resolvedCurrency, 
                        label: _resolveMethodLabel(paymentMethod) 
                    };
                }
                breakdown[paymentMethod].total = round2(breakdown[paymentMethod].total + round2(sale.totalCobrado || 0));

                // 3. Registrar la comisión ganada en el breakdown como concepto de avance para auditoría
                if (!breakdown['_comision_avance']) {
                    breakdown['_comision_avance'] = { 
                        total: 0, 
                        currency: 'USD', 
                        label: 'Comisión por Avances',
                        isCommission: true 
                    };
                }
                const saleRate = sale.rate || 1;
                const comisionInUsd = sale.currency === 'BS' ? (sale.montoComision || 0) / saleRate : (sale.montoComision || 0);
                breakdown['_comision_avance'].total = round2(breakdown['_comision_avance'].total + round2(comisionInUsd));

                return; // Ya procesado, no continuar al flujo normal de vuelto y pagos
            }

            // Crédito generado por vuelto acreditado: es una obligación interna con el
            // cliente, no efectivo ni ingreso cobrado. Se reporta aparte del método
            // `saldo_favor` utilizado para que ambas patas de la cartera sean auditables.
            const generatedWalletCredit = getGeneratedWalletCredit(sale);
            if (generatedWalletCredit > FINANCIAL_EPSILON.PAYMENT_ZERO) {
                breakdown['_saldo_favor_generado'] = breakdown['_saldo_favor_generado'] || {
                    total: 0,
                    currency: 'INTERNAL_CREDIT',
                    label: 'Saldo a Favor Generado',
                    isInternalCredit: true,
                    isWalletCredit: true,
                    isCash: false,
                    isRevenue: false,
                    // FIA-REPORT-001 (H7): este bucket suma dos orígenes distintos
                    // (vuelto acreditado de una venta y excedente de un abono). La metadata
                    // los separa sin crear buckets nuevos ni romper el contrato existente.
                    origins: { vueltoMonederoUsd: 0, excedenteAbonoUsd: 0 },
                };
                const walletBucket = breakdown['_saldo_favor_generado'];
                if (!walletBucket.origins) {
                    walletBucket.origins = { vueltoMonederoUsd: 0, excedenteAbonoUsd: 0 };
                }
                const fromMonedero = round2(Math.min(
                    generatedWalletCredit,
                    Math.max(0, Number(sale.vueltoParaMonedero) || 0)
                ));
                walletBucket.origins.vueltoMonederoUsd = round2(walletBucket.origins.vueltoMonederoUsd + fromMonedero);
                walletBucket.origins.excedenteAbonoUsd = round2(
                    walletBucket.origins.excedenteAbonoUsd + round2(subR(generatedWalletCredit, fromMonedero))
                );
                walletBucket.total = round2(walletBucket.total + generatedWalletCredit);
            }

            // Fiado sales: bucket "fiado" tracks the *outstanding debt* generated (fiadoUsd),
            // NOT the total sale (which may have partial real payments).
            // FIN-004: usar sale.fiadoUsd || sale.totalUsd para ventas legacy sin fiadoUsd,
            // y NO hacer `return`: procesar pagos reales abajo.
            if (sale.tipo === 'VENTA_FIADA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { total: 0, currency: 'FIADO', label: 'Fiado (Por Cobrar)' };
                }
                const fiadoAmount = round2(sale.fiadoUsd != null ? sale.fiadoUsd : (sale.totalUsd || 0));
                breakdown['fiado'].total = round2(breakdown['fiado'].total + fiadoAmount);
                // Continuamos abajo para registrar pagos reales (parciales) si los hay.
            }

            // Debt collection reduces the outstanding fiado balance for the period (using USD to prevent exchange rate drift)
            if (sale.tipo === 'COBRO_DEUDA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { total: 0, currency: 'FIADO', label: 'Fiado (Por Cobrar)' };
                }
                breakdown['fiado'].total = round2(breakdown['fiado'].total - round2(sale.totalUsd || 0));
                // Continue execution below to register the actual cash/transfer received
            }

            // La remesa recibida de Cashea reduce la cuenta por cobrar del período.
            // Espeja exactamente el tratamiento de COBRO_DEUDA sobre 'fiado'.
            if (sale.tipo === 'COBRO_CASHEA') {
                if (!breakdown['cashea']) {
                    breakdown['cashea'] = { total: 0, currency: 'FIADO', label: 'Cashea (Por Cobrar)', isReceivable: true };
                }
                breakdown['cashea'].total = round2(breakdown['cashea'].total - round2(sale.totalUsd || 0));
                // Continúa abajo para registrar el dinero realmente recibido.
            }

            if (!sale.payments || sale.payments.length === 0) {
                // ── FIA-REPORT-001 (H9): una venta a crédito SIN pagos no es flujo de caja ──
                // La cuenta por cobrar ya quedó registrada arriba (bucket `fiado`/`cashea`).
                // Antes este bloque legacy sumaba `sale.totalBs` al método por defecto
                // (`efectivo_bs`), contando el fiado COMPLETO como efectivo recibido: inflaba
                // los reportes, el cierre de caja y el fondo de caja del POS.
                if (sale.tipo === 'VENTA_FIADA' || sale.tipo === 'VENTA_CASHEA') {
                    const creditMethod = String(sale.paymentMethod || '').toLowerCase();
                    const isCreditMethod = !creditMethod
                        || creditMethod === 'fiado'
                        || creditMethod === 'cashea'
                        || creditMethod.includes('credito')
                        || creditMethod.includes('crédito');
                    // Sin método de cobro explícito (o con uno de crédito): cero efectivo.
                    if (isCreditMethod) return;

                    // Venta a crédito legacy con un método de cobro explícito: solo la parte
                    // realmente cobrada (total − fiado/cashea) es flujo de caja.
                    const creditUsd = sale.fiadoUsd != null ? sale.fiadoUsd : (sale.casheaUsd || 0);
                    const paidUsd = round2(subR(sale.totalUsd || 0, creditUsd));
                    if (paidUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO) return;
                    const legacyRate = sale.rate
                        || (sale.totalUsd > 0 ? divR(sale.totalBs || 0, sale.totalUsd) : 0)
                        || 1;
                    const isUsdMethod = creditMethod.includes('usd') || creditMethod.includes('zelle') || creditMethod.includes('binance');
                    const isCopMethod = creditMethod.includes('cop');
                    const legacyCurrency = isUsdMethod ? 'USD' : (isCopMethod ? 'COP' : 'BS');
                    const legacyValue = isUsdMethod
                        ? paidUsd
                        : (isCopMethod ? mulR(paidUsd, sale.tasaCop || 0) : mulR(paidUsd, legacyRate));
                    if (!breakdown[creditMethod]) {
                        breakdown[creditMethod] = { total: 0, currency: legacyCurrency, label: _resolveMethodLabel(creditMethod) };
                    }
                    breakdown[creditMethod].total = round2(breakdown[creditMethod].total + legacyValue);
                    return;
                }

                // V1 Legacy Sales & Cobro Deudas
                const method = sale.paymentMethod || 'efectivo_bs';
                let currency = 'BS';
                let valueToSum = round2(sale.totalBs || 0);

                if (method.includes('usd') || method.includes('zelle') || method.includes('binance')) {
                    currency = 'USD';
                    valueToSum = round2(sale.totalUsd || 0);
                } else if (method.includes('cop')) {
                    currency = 'COP';
                    valueToSum = round2(sale.totalCop || 0);
                }

                if (!breakdown[method]) {
                    breakdown[method] = { total: 0, currency: currency, label: _resolveMethodLabel(method) };
                }
                breakdown[method].total = round2(breakdown[method].total + valueToSum);
            } else {
                // Aggregate incoming payments (V2 sales)
                sale.payments.forEach(p => {
                    if (!breakdown[p.methodId]) {
                        // Resolver label robusto: usa methodLabel si existe,
                        // sino consulta FACTORY_LABELS, sino humaniza el methodId.
                        const resolvedLabel = (p.methodLabel && p.methodLabel !== p.methodId)
                            ? p.methodLabel
                            : _resolveMethodLabel(p.methodId);

                        // CASHEA: el financiador remesa a la bodega. El monto financiado
                        // es una CUENTA POR COBRAR, no dinero cobrado. Se marca con
                        // currency 'FIADO' + isReceivable para que ningún consumidor que
                        // filtre por `currency` lo sume como ingreso USD del período.
                        const isCasheaBucket = p.methodId === 'cashea';
                        const isInternalCredit = p.methodId === 'saldo_favor' || p.isInternalCredit || p.currency === 'INTERNAL_CREDIT';
                        breakdown[p.methodId] = {
                            total: 0,
                            currency: isCasheaBucket ? 'FIADO' : (isInternalCredit ? 'INTERNAL_CREDIT' : (p.currency || 'BS')),
                            label: isCasheaBucket ? 'Cashea (Por Cobrar)' : (isInternalCredit ? 'Saldo a Favor Utilizado' : resolvedLabel),
                            ...(isCasheaBucket && { isReceivable: true }),
                            ...(isInternalCredit && { isInternalCredit: true, isCash: false, isRevenue: false }),
                        };
                    }

                    const saleRate = sale.rate || (sale.payments?.[0]?.amountUsd ? divR(sale.payments?.[0]?.amountBs, sale.payments?.[0]?.amountUsd) : 1) || 1;
                    const amountUsd = p.amountUsd !== undefined
                        ? round2(p.amountUsd)
                        : (p.currency === 'USD' ? round2(p.amount) : divR(p.amount, saleRate));
                    const amountBs = p.amountBs !== undefined
                        ? round2(p.amountBs)
                        : (p.currency === 'BS' ? round2(p.amount) : mulR(p.amount, saleRate));

                    if (p.currency === 'INTERNAL_CREDIT' || p.methodId === 'saldo_favor' || p.isInternalCredit) {
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountUsd);
                    } else if (p.currency === 'USD') {
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountUsd);
                    } else if (p.currency === 'COP') {
                        // FIN-003: Ventas legacy sin tasaCop → fallback a `1` subestimaba COP por ~4000x.
                        // Si no hay tasaCop, NO sumamos al bucket COP (mejor ausente que mal).
                        // Registramos la anomalía para auditoría.
                        if (!sale.tasaCop || sale.tasaCop <= 0) {
                            anomalies.push({
                                saleId: sale.id,
                                type: 'TASA_COP_MISSING',
                                message: `Venta ${sale.id || '(sin id)'} con pago COP pero sin tasaCop; COP no contabilizado.`,
                                severity: 'warning'
                            });
                            // Sumamos al bucket en USD para que el pago NO desaparezca del flujo.
                            breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountUsd);
                        } else {
                            const copAmount = mulR(amountUsd, sale.tasaCop);
                            breakdown[p.methodId].total = round2(breakdown[p.methodId].total + copAmount);
                        }
                    } else {
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountBs);
                    }
                });
            }

            // Deduct outgoing change to find True Net Income
            let safeChangeUsd = round2(sale.changeUsd || 0);
            let safeChangeBs = round2(sale.changeBs || 0);

            // ── ANOMALY DETECTION (FIN-005): collect into array, no mutation of sale ──
            const saleRateForAnomaly = sale.rate
                || (sale.payments?.[0]?.amountBs && sale.payments?.[0]?.amountUsd
                    ? divR(sale.payments[0].amountBs, sale.payments[0].amountUsd)
                    : 1);
            const saleTotalUsd = round2(sale.totalUsd || 0);
            const saleTotalBs = round2(sale.totalBs || 0);
            // FIN-005: Umbrales centralizados en securityConstants.
            const isChangeAnomalousUsd =
                safeChangeUsd > FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_USD
                && safeChangeUsd > mulR(saleTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);
            const isChangeAnomalousBs =
                safeChangeBs > mulR(FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_BS_FACTOR, saleRateForAnomaly)
                && safeChangeBs > mulR(saleTotalBs, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);

            if (isChangeAnomalousUsd || isChangeAnomalousBs) {
                anomalies.push({
                    saleId: sale.id,
                    type: 'CHANGE_ANOMALY',
                    severity: 'warning',
                    changeUsd: safeChangeUsd,
                    changeBs: safeChangeBs,
                    totalUsd: saleTotalUsd,
                    totalBs: saleTotalBs,
                    message: `Anomalía de vuelto en venta ${sale.id || '(sin id)'}: changeUsd=${safeChangeUsd}, changeBs=${safeChangeBs}, totalUsd=${saleTotalUsd}`
                });
            }

            // If the sale was completely free/zero, any outgoing change is a glitch
            if (saleTotalUsd === 0 && saleTotalBs === 0) {
                safeChangeUsd = 0;
                safeChangeBs = 0;
            }

            if (safeChangeUsd > 0) {
                if (!breakdown['_vuelto_usd']) breakdown['_vuelto_usd'] = { total: 0, currency: 'USD', label: 'Vuelto En $ Entregado', isChange: true };
                breakdown['_vuelto_usd'].total = round2(breakdown['_vuelto_usd'].total + safeChangeUsd);
            }
            if (safeChangeBs > 0) {
                if (!breakdown['_vuelto_bs']) breakdown['_vuelto_bs'] = { total: 0, currency: 'BS', label: 'Vuelto En Bs Entregado', isChange: true };
                breakdown['_vuelto_bs'].total = round2(breakdown['_vuelto_bs'].total + safeChangeBs);
            }

            // ── TIP-001 / TIP-005: propina donada ("cliente deja el cambio") ──
            // El dinero YA está contado en el bucket de efectivo y no se restó
            // como vuelto, así que el ingreso neto ya lo incluye. Este bucket es
            // SOLO informativo: `isTip: true` obliga a los consumidores a
            // excluirlo de métodos de pago y porcentajes (ver D1).
            // Una propina tiene UNA sola moneda: se crea un único bucket.
            if (sale.tipDonated) {
                const tipIsBs = sale.tipDonated.currency === 'BS';
                const tipTotal = round2(tipIsBs
                    ? (Number(sale.tipDonated.amountBs) || 0)
                    : (Number(sale.tipDonated.amountUsd) || 0));
                if (tipTotal > FINANCIAL_EPSILON.PAYMENT_ZERO) {
                    const tipKey = tipIsBs ? '_propina_bs' : '_propina_usd';
                    if (!breakdown[tipKey]) {
                        breakdown[tipKey] = {
                            total: 0,
                            currency: tipIsBs ? 'BS' : 'USD',
                            label: tipIsBs ? 'Propina Dejada En Bs' : 'Propina Dejada En $',
                            isTip: true,
                        };
                    }
                    breakdown[tipKey].total = round2(breakdown[tipKey].total + tipTotal);
                }
            }

            // Si la venta tiene algún ítem de tipo avance de efectivo, ajustamos el efectivo físico y registramos la comisión.
            if (sale.items && sale.items.length > 0) {
                sale.items.forEach(item => {
                    if (item.isCashAdvance) {
                        const isBs = item.currency === 'BS';
                        const isUsd = item.currency === 'USD';
                        const isCop = item.currency === 'COP';

                        // 1. Restar el efectivo físico entregado del cajón
                        const cashMethod = isBs ? 'efectivo_bs' : (isUsd ? 'efectivo_usd' : 'efectivo_cop');
                        const cashCurrency = isBs ? 'BS' : (isUsd ? 'USD' : 'COP');
                        if (!breakdown[cashMethod]) {
                            breakdown[cashMethod] = { total: 0, currency: cashCurrency, label: _resolveMethodLabel(cashMethod) };
                        }
                        breakdown[cashMethod].total = round2(breakdown[cashMethod].total - round2(item.montoEfectivo || 0));

                        // 2. Registrar la comisión ganada contablemente
                        if (!breakdown['_comision_avance']) {
                            breakdown['_comision_avance'] = { 
                                total: 0, 
                                currency: 'USD', 
                                label: 'Comisión por Avances',
                                isCommission: true 
                            };
                        }
                        const saleRate = sale.rate || 1;
                        const comisionInUsd = item.currency === 'BS' ? (item.montoComision || 0) / saleRate : (item.montoComision || 0);
                        breakdown['_comision_avance'].total = round2(breakdown['_comision_avance'].total + round2(comisionInUsd));
                    }
                });
            }
        });

        // ── FIA-REPORT-001 (H8): peso en Bs de las cuentas por cobrar con la TASA DE CADA
        // VENTA, no con la tasa de hoy. Aditivo: no altera `total` (USD) ni el resto del
        // contrato; los consumidores que lo ignoren siguen viendo el comportamiento previo.
        salesArray.forEach(sale => {
            if (!sale || sale.status === 'ANULADA') return;
            const rate = sale.rate || 0;
            if (!rate) return;
            const addBsAtSaleRate = (key, usd, sign = 1) => {
                if (!breakdown[key]) return;
                breakdown[key].bsAtSaleRate = round2(
                    (breakdown[key].bsAtSaleRate || 0) + sign * mulR(usd, rate)
                );
            };
            if (sale.tipo === 'VENTA_FIADA') {
                addBsAtSaleRate('fiado', round2(sale.fiadoUsd != null ? sale.fiadoUsd : (sale.totalUsd || 0)));
            } else if (sale.tipo === 'COBRO_DEUDA') {
                addBsAtSaleRate('fiado', round2(sale.totalUsd || 0), -1);
            } else if (sale.tipo === 'VENTA_CASHEA') {
                const casheaUsd = round2(sale.casheaUsd != null
                    ? sale.casheaUsd
                    : (sale.payments || [])
                        .filter(p => p.methodId === 'cashea')
                        .reduce((s, p) => s + (p.amountUsd || 0), 0));
                addBsAtSaleRate('cashea', casheaUsd);
            } else if (sale.tipo === 'COBRO_CASHEA') {
                addBsAtSaleRate('cashea', round2(sale.totalUsd || 0), -1);
            }
        });

        // Final pass: round all totals strictly and filter out zeroes
        const finalBreakdown = {};
        Object.keys(breakdown).forEach(k => {
            const roundedTotal = round2(breakdown[k].total);
            // Keep vuelto entries even if they are negative (they represent outgoing cash)
            if (roundedTotal !== 0) {
                finalBreakdown[k] = { ...breakdown[k], total: roundedTotal };
            }
        });

        if (opts.withAnomalies) {
            return { breakdown: finalBreakdown, anomalies };
        }
        return finalBreakdown;
    }

    /**
     * Generates standard Checkout Cart Totals (Gross -> Discount -> Net -> Bs / COP equivalent)
     * Used exclusively BEFORE persisting a sale.
     *
     * @param {Array} cartItems - Array of live cart items
     * @param {Object} discountData - { type: 'percentage'|'fixed', value: number }
     * @param {number} bcvRate - Exchange rate
     * @param {number} copRate - USD to COP Exchange rate
     * @returns {Object} Complete financial summary for the receipt.
     */
    static buildCartTotals(cartItems, discountData, bcvRate, copRate = 0, isBsPayment = false) {
        // Round each line item BEFORE summing to prevent IEEE 754 drift
        const lineItemsUsd = cartItems.map(item => {
            const itemPriceUsd = (isBsPayment && item.pricingMode === 'dual_usd' && item.priceBsUsdRef > 0)
                ? Number(item.priceBsUsdRef)
                : item.priceUsd;
            return mulR(itemPriceUsd, item.qty);
        });
        const subtotalUsd = sumR(lineItemsUsd);

        const lineItemsBs = cartItems.map((item, idx) => {
            if (isBsPayment && item.pricingMode === 'dual_usd' && Number(item.priceBsUsdRef) > 0) {
                return mulR(mulR(item.priceBsUsdRef, item.qty), bcvRate);
            }
            if (item.exactBs != null && !isBsPayment) {
                return mulR(item.exactBs, item.qty);
            }
            return mulR(lineItemsUsd[idx], bcvRate);
        });
        const subtotalBs = sumR(lineItemsBs);

        let discountAmountUsd = 0;
        if (discountData && discountData.value > 0) {
            if (discountData.type === 'percentage') {
                discountAmountUsd = mulR(subtotalUsd, divR(discountData.value, 100));
            } else if (discountData.type === 'fixed') {
                discountAmountUsd = round2(discountData.value);
            }
        }

        if (discountAmountUsd > subtotalUsd) discountAmountUsd = subtotalUsd;

        const totalUsd = round2(Math.max(0, subR(subtotalUsd, discountAmountUsd)));

        const discountAmountBs = mulR(discountAmountUsd, bcvRate);
        const totalBs = round2(Math.max(0, subR(subtotalBs, discountAmountBs)));

        // FIN-010: totalCop unificado — divR para descuento proporcional, round2 consistente.
        // Antes: `Math.round(sumR(...) * (1 - discountAmountUsd / subtotalUsd))` mezclaba
        // raw division + Math.round con el mulR de la rama sin priceCop.
        const allItemsHaveCop = cartItems.every(i => i.priceCop != null && i.priceCop > 0);
        const totalCop = copRate > 0
            ? (allItemsHaveCop
                ? round2(mulR(
                    sumR(cartItems.map(i => mulR(i.priceCop, i.qty))),
                    subR(1, divR(discountAmountUsd, (subtotalUsd || 1)))
                ))
                : mulR(totalUsd, copRate))
            : 0;

        return {
            subtotalUsd,
            subtotalBs,
            discountAmountUsd,
            discountAmountBs,
            totalUsd,
            totalBs,
            totalCop
        };
    }

    /**
     * Calculates the top products by revenue.
     */
    static calculateTopProducts(salesArray) {
        if (!Array.isArray(salesArray)) return [];
        const productMap = {};
        salesArray.forEach(s => {
            s.items?.forEach(item => {
                const key = item.id || item.name;
                if (!productMap[key]) productMap[key] = { name: item.name, qty: 0, revenue: 0 };
                productMap[key].qty += item.qty;
                productMap[key].revenue = round2(productMap[key].revenue + mulR(item.priceUsd, item.qty));
            });
        });
        return Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
    }
}
