import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { round2, divR, mulR, subR, sumR } from '../utils/dinero';
import { FINANCIAL_EPSILON } from '../utils/securityConstants';
import { CurrencyService } from '../services/CurrencyService';
import { FinancialEngine } from '../core/FinancialEngine';
import { isTicketRepriced, repriceDeltaUsd } from '../utils/reprice.js';

/**
 * Hook de cálculos de checkout con soporte para Doble Precio dinámico.
 */
export function useCheckoutCalculations({
    paymentMethods,
    effectiveRate,
    tasaCop,
    copEnabled = false,
    cartTotalUsd: baseCartTotalUsd,
    cartTotalBs: baseCartTotalBs,
    triggerHaptic,
    onConfirmSale,
    cart = [],
    discountData = null,
    saldoFavorDisponible = 0,
    selectedCustomerId = '',
}) {
    const [barValues, setBarValues] = useState({});
    const [changeUsdGiven, setChangeUsdGiven] = useState('');
    const [changeBsGiven, setChangeBsGiven] = useState('');
    // TIP: propina donada ("cliente deja el cambio"). Paridad con CheckoutModalPOS.
    const [isTipDonated, setIsTipDonated] = useState(false);
    const [tipAmountUsd, setTipAmountUsd] = useState('');
    const [isChangeCredited, setIsChangeCredited] = useState(false);
    const [tipConfirmPending, setTipConfirmPending] = useState(false);
    const [paymentWarning, setPaymentWarning] = useState(null);
    const pendingConfirmRef = useRef(null);

    // -- Cashea Hook Integration --
    const [casheaActive, setCasheaActive] = useState(false);
    const [casheaPercent, setCasheaPercent] = useState(60);

    // El crédito aplicado pertenece al cliente seleccionado; nunca se arrastra a otro.
    useEffect(() => {
        setBarValues(prev => ({ ...prev, saldo_favor: '' }));
        setIsChangeCredited(false);
    }, [selectedCustomerId]);

    const safeRate = effectiveRate > 0 ? effectiveRate : 0;
    const safeTasaCop = tasaCop > 0 ? tasaCop : 0;

    // Detectar si el usuario está realizando un pago en Bolívares (o usando método BS)
    const isBsPaymentActive = useMemo(() => {
        if (!cart || cart.length === 0) return false;
        const hasDualItem = cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0); // eslint-disable-line no-restricted-syntax -- deuda preexistente: referencia de precio ya normalizada
        if (!hasDualItem) return false;
        const bsMethods = paymentMethods.filter(m => m.currency === 'BS');
        return bsMethods.some(m => CurrencyService.safeParse(barValues[m.id]) > 0);
    }, [cart, paymentMethods, barValues]);

    // Recalcular totales de carrito dinámicamente si el pago es en Bolívares
    const cartTotals = useMemo(() => {
        if (!cart || cart.length === 0 || !cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0)) { // eslint-disable-line no-restricted-syntax -- deuda preexistente
            return { totalUsd: baseCartTotalUsd, totalBs: baseCartTotalBs };
        }
        return FinancialEngine.buildCartTotals(cart, discountData, safeRate, safeTasaCop, isBsPaymentActive);
    }, [cart, discountData, safeRate, safeTasaCop, isBsPaymentActive, baseCartTotalUsd, baseCartTotalBs]);

    const cartTotalUsd = cartTotals.totalUsd;

    // ── AVISO-REPRECIO: señal del re-precio por Doble Precio ───────────────
    // Si la cesta tiene ítems dual_usd y entra un pago en Bs, el total pasa a
    // ser el del precio de referencia. La UI avisa para que el cajero no lo lea
    // como un cálculo roto (la matemática es correcta por diseño).
    const repricedActive = isTicketRepriced({
        isBsPaymentActive,
        baseTotalUsd: baseCartTotalUsd,
        newTotalUsd: cartTotals.totalUsd,
    });
    const repricedDeltaUsd = repriceDeltaUsd(baseCartTotalUsd, cartTotals.totalUsd);
    const cartTotalBs = cartTotals.totalBs;

    const casheaEnabled = localStorage.getItem('cashea_enabled') === 'true';
    const casheaMinAmount = parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0; // eslint-disable-line no-restricted-syntax -- config local, no cálculo financiero
    const casheaMeetsMinimum = casheaMinAmount <= 0 || cartTotalUsd >= casheaMinAmount;

    // FIN-009 / FIN-033: detectar tasa inválida y exponer flag para que la UI bloquee.
    const rateError = !effectiveRate || effectiveRate <= 0
        ? 'Tasa BCV no configurada. Configúrala antes de cobrar.'
        : null;
    const copRateError = copEnabled && (tasaCop == null || tasaCop <= 0)
        ? 'Tasa COP no configurada. Configúrala antes de aceptar pagos en pesos.'
        : null;

    const totalPaidUsd = useMemo(() => {
        return sumR(paymentMethods.map(m => {
            const val = CurrencyService.safeParse(barValues[m.id]);
            if (m.currency === 'USD' || m.currency === 'INTERNAL_CREDIT') return round2(val);
            if (m.currency === 'COP') return safeTasaCop > 0 ? divR(val, safeTasaCop) : 0;
            return safeRate > 0 ? divR(val, safeRate) : 0;
        }));
    }, [barValues, paymentMethods, effectiveRate, tasaCop, safeRate, safeTasaCop]);

    const totalPaidBs = useMemo(() => {
        return sumR(paymentMethods.map(m => {
            const val = CurrencyService.safeParse(barValues[m.id]);
            if (m.currency === 'BS') return round2(val);
            if (m.currency === 'INTERNAL_CREDIT') return 0;
            if (m.currency === 'COP') return safeTasaCop > 0 && safeRate > 0
                ? mulR(divR(val, safeTasaCop), safeRate)
                : 0;
            return safeRate > 0 ? mulR(val, safeRate) : 0;
        }));
    }, [barValues, paymentMethods, effectiveRate, tasaCop, safeRate, safeTasaCop]);

    // Monto que Cashea cubre (virtual, se agrega como pago al confirmar)
    const casheaAmountUsd = useMemo(() => {
        if (!casheaActive) return 0;
        return round2(mulR(cartTotalUsd, (100 - casheaPercent) / 100));
    }, [casheaActive, casheaPercent, cartTotalUsd]);

    const totalPaidWithCasheaUsd = round2(totalPaidUsd + casheaAmountUsd);

    const remainingUsd = Math.max(0, subR(cartTotalUsd, totalPaidWithCasheaUsd));
    const remainingBs = Math.max(0, subR(cartTotalBs, totalPaidBs + mulR(casheaAmountUsd, safeRate)));
    const changeUsd = Math.max(0, subR(totalPaidWithCasheaUsd, cartTotalUsd));
    const changeBs = Math.max(0, subR(totalPaidBs + mulR(casheaAmountUsd, safeRate), cartTotalBs));
    // FIN-023: umbral centralizado en securityConstants
    const isPaid = remainingUsd < FINANCIAL_EPSILON.PAYMENT_ZERO;

    const PAYMENT_TOLERANCE = 0.01;
    const casheaConfirmReady = !casheaActive || isPaid || totalPaidUsd >= round2(cartTotalUsd - casheaAmountUsd) - PAYMENT_TOLERANCE;

    const handleBarChange = useCallback((methodId, value) => {
        let v = value.replace(',', '.');
        if (!/^[0-9.]*$/.test(v)) return;
        const dots = v.match(/\./g);
        if (dots && dots.length > 1) return;

        const method = paymentMethods.find(m => m.id === methodId);
        if (method?.currency === 'INTERNAL_CREDIT' && v !== '') {
            const requested = Number(v);
            const current = CurrencyService.safeParse(barValues[methodId]);
            const otherPaid = subR(totalPaidWithCasheaUsd, current);
            const maxAplicable = Math.min(
                Math.max(0, Number(saldoFavorDisponible) || 0),
                Math.max(0, subR(cartTotalUsd, otherPaid))
            );
            v = String(round2(Math.min(Math.max(0, requested), maxAplicable)));
        }
        setBarValues(prev => ({ ...prev, [methodId]: v }));
    }, [paymentMethods, barValues, totalPaidWithCasheaUsd, cartTotalUsd, saldoFavorDisponible]);

    const fillBar = useCallback((methodId, currency) => {
        triggerHaptic && triggerHaptic();
        let targetUsd = baseCartTotalUsd;
        let targetBs = baseCartTotalBs;

        if (currency === 'BS' && cart && cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0)) { // eslint-disable-line no-restricted-syntax -- deuda preexistente
            const bsTotals = FinancialEngine.buildCartTotals(cart, discountData, safeRate, safeTasaCop, true);
            targetUsd = bsTotals.totalUsd;
            targetBs = bsTotals.totalBs;
        } else if (currency === 'USD' && cart && cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0)) { // eslint-disable-line no-restricted-syntax -- deuda preexistente
            const usdTotals = FinancialEngine.buildCartTotals(cart, discountData, safeRate, safeTasaCop, false);
            targetUsd = usdTotals.totalUsd;
            targetBs = usdTotals.totalBs;
        }

        let val;
        if (currency === 'USD' || currency === 'INTERNAL_CREDIT') {
            const currentPaidUsd = totalPaidWithCasheaUsd;
            const remUsd = Math.max(0, subR(targetUsd, currentPaidUsd));
            const currentCredit = CurrencyService.safeParse(barValues[methodId]);
            const maxCredit = currency === 'INTERNAL_CREDIT'
                ? Math.min(
                    Math.max(0, (Number(saldoFavorDisponible) || 0) - currentCredit),
                    remUsd,
                )
                : remUsd;
            val = maxCredit > 0 ? String(round2(currentCredit + maxCredit)) : null;
        } else if (currency === 'COP') {
            const currentPaidUsd = totalPaidWithCasheaUsd;
            const remUsd = Math.max(0, subR(targetUsd, currentPaidUsd));
            const copVal = safeTasaCop > 0 ? mulR(remUsd, safeTasaCop) : 0;
            val = remUsd > 0 ? String(round2(copVal)) : null;
        } else {
            // FIN-038: la rama Bs debe descontar Cashea igual que la rama USD,
            // o el botón "Todo" pedirá de más cuando haya remesa Cashea activa.
            const currentPaidBs = sumR([totalPaidBs, mulR(casheaAmountUsd, safeRate)]);
            const remBs = Math.max(0, subR(targetBs, currentPaidBs));
            val = remBs > 0 ? String(round2(remBs)) : null;
        }
        if (val) {
            setBarValues(prev => ({ ...prev, [methodId]: val }));
        }
    }, [baseCartTotalUsd, baseCartTotalBs, cart, discountData, safeRate, safeTasaCop, totalPaidWithCasheaUsd, totalPaidBs, casheaAmountUsd, triggerHaptic, saldoFavorDisponible, barValues]);

    // ── TIP-004 (D7): moneda de la propina según la composición real del efectivo.
    // Mismo criterio que CheckoutModalPOS: se comparan magnitudes en Bs, no el
    // orden de los métodos. Solo efectivo: un pago móvil no da vuelto físico.
    const tipCurrency = useMemo(() => {
        const efectivoBs = paymentMethods
            .filter(m => m.currency === 'BS' && String(m.id).startsWith('efectivo'))
            .reduce((s, m) => sumR(s, CurrencyService.safeParse(barValues[m.id])), 0);
        const efectivoUsdEnBs = mulR(
            paymentMethods
                .filter(m => m.currency === 'USD' && String(m.id).startsWith('efectivo'))
                .reduce((s, m) => sumR(s, CurrencyService.safeParse(barValues[m.id])), 0),
            safeRate
        );
        return efectivoBs > efectivoUsdEnBs ? 'BS' : 'USD';
    }, [paymentMethods, barValues, safeRate]);

    // ── TIP-002 (D6): propinas por encima del umbral exigen doble pulsación.
    const toggleTipDonated = useCallback(() => {
        if (isTipDonated) {
            setIsTipDonated(false);
            setTipAmountUsd('');
            setTipConfirmPending(false);
            return;
        }
        const currentPhysicalUsd = sumR(
            Math.max(0, Number(changeUsdGiven) || 0),
            effectiveRate > 0 ? divR(Math.max(0, Number(changeBsGiven) || 0), effectiveRate) : 0
        );
        const unallocatedRemainder = round2(Math.max(0, subR(changeUsd, currentPhysicalUsd)));
        const targetTip = unallocatedRemainder > 0.001 ? unallocatedRemainder : changeUsd;

        if (targetTip > FINANCIAL_EPSILON.TIP_MAX_AUTO_USD && !tipConfirmPending) {
            setTipConfirmPending(true);
            return;
        }
        setIsChangeCredited(false);
        setTipConfirmPending(false);
        setTipAmountUsd(round2(targetTip).toString());
        setIsTipDonated(true);
        triggerHaptic && triggerHaptic();
    }, [isTipDonated, tipConfirmPending, changeUsd, changeUsdGiven, changeBsGiven, effectiveRate, triggerHaptic]);

    const handleTipAmountChange = useCallback((value) => {
        const cleanValue = String(value).replace(',', '.');
        if (cleanValue !== '' && !/^\d*\.?\d*$/.test(cleanValue)) return;
        const currentPhysicalUsd = sumR(
            Math.max(0, Number(changeUsdGiven) || 0),
            effectiveRate > 0 ? divR(Math.max(0, Number(changeBsGiven) || 0), effectiveRate) : 0
        );
        const maxTip = round2(Math.max(0, subR(changeUsd, currentPhysicalUsd)));
        const amount = Math.min(Math.max(0, Number(cleanValue) || 0), maxTip > 0.001 ? maxTip : changeUsd);
        setTipAmountUsd(cleanValue === '' ? '' : round2(amount).toString());
        setIsTipDonated(amount > FINANCIAL_EPSILON.PAYMENT_ZERO);
        setIsChangeCredited(false);
    }, [changeUsd, changeUsdGiven, changeBsGiven, effectiveRate]);

    // TIP (T-5): apagar la propina si el vuelto desaparece, y caducar cualquier
    // confirmación pendiente cuando el monto cambia. Sin esto el flag sobrevive
    // a una corrección del pago y la propina se re-arma sola.
    useEffect(() => {
        setTipConfirmPending(false);
        if (changeUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setIsTipDonated(false);
            setTipAmountUsd('');
            setIsChangeCredited(false);
        }
    }, [changeUsd]);

    // FASE 3: el pago pertenece al cliente. Al CAMBIAR de cliente (de un cliente
    // REAL A otro cliente REAL) se limpia el estado parcial (montos por método,
    // vuelto asignado, propina en caja, acreditación a billetera) para no mezclar
    // pagos entre clientes ni acreditar el saldo a favor de la persona equivocada.
    // La PRIMERA selección (null/'' → cliente) NO limpia: el cajero normalmente
    // teclea el pago y luego elige al cliente. Tampoco al deseleccionar.
    const prevCustomerIdRef = useRef(selectedCustomerId);
    useEffect(() => {
        const prev = prevCustomerIdRef.current;
        prevCustomerIdRef.current = selectedCustomerId;
        if (!prev || !selectedCustomerId || prev === selectedCustomerId) return;
        setBarValues({});
        setTipConfirmPending(false);
        setIsTipDonated(false);
        setTipAmountUsd('');
        setIsChangeCredited(false);
        setChangeUsdGiven('');
        setChangeBsGiven('');
    }, [selectedCustomerId]);

    // Si se asigna todo el cambio a físico o caja, desactivar automáticamente la acreditación a billetera
    useEffect(() => {
        const cashKeptUsd = round2(Math.min(Math.max(0, Number(tipAmountUsd) || 0), changeUsd));
        const changeToDeliverUsd = round2(Math.max(0, subR(changeUsd, cashKeptUsd)));
        const physicalUsd = sumR(
            Math.max(0, Number(changeUsdGiven) || 0),
            safeRate > 0 ? divR(Math.max(0, Number(changeBsGiven) || 0), safeRate) : 0
        );
        const walletRemainder = round2(Math.max(0, subR(changeToDeliverUsd, physicalUsd)));
        if (isChangeCredited && walletRemainder <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setIsChangeCredited(false);
        }
    }, [isChangeCredited, tipAmountUsd, changeUsd, changeUsdGiven, changeBsGiven, safeRate]);

    // ── Procesamiento final de la venta (sin validaciones) ────────────────────
    const _processPayments = useCallback(() => {
        const payments = paymentMethods
            .filter(m => CurrencyService.safeParse(barValues[m.id]) > 0)
            .map(m => {
                const amount = round2(CurrencyService.safeParse(barValues[m.id]));
                return {
                    id: crypto.randomUUID(),
                    methodId: m.id,
                    methodLabel: m.label,
                    currency: m.currency,
                    amountInput: amount,
                    amountInputCurrency: m.currency,
                    amountUsd: m.currency === 'USD' || m.currency === 'INTERNAL_CREDIT' ? amount
                        : m.currency === 'COP' ? (safeTasaCop > 0 ? divR(amount, safeTasaCop) : 0)
                        : (safeRate > 0 ? divR(amount, safeRate) : 0),
                    amountBs: m.currency === 'BS' ? amount
                        : m.currency === 'INTERNAL_CREDIT' ? 0
                        : m.currency === 'COP' ? (safeTasaCop > 0 && safeRate > 0 ? mulR(divR(amount, safeTasaCop), safeRate) : 0)
                        : (safeRate > 0 ? mulR(amount, safeRate) : 0),
                };
            });

        // Agregar pago virtual de Cashea si está activo
        if (casheaActive && casheaAmountUsd > 0) {
            payments.push({
                id: crypto.randomUUID(),
                methodId: 'cashea',
                methodLabel: 'Cashea',
                currency: 'USD',
                amountInput: casheaAmountUsd,
                amountInputCurrency: 'USD',
                amountUsd: casheaAmountUsd,
                amountBs: mulR(casheaAmountUsd, safeRate),
                isCashea: true,
                casheaPercent: 100 - casheaPercent,
            });
        }

        // FIN-034: `changeUsd` y `changeBs` son el MISMO vuelto expresado en dos monedas.
        // Declarar ambos duplicaba el vuelto en el FinancialEngine.
        const hasExplicitSplit = Boolean(changeUsdGiven) || Boolean(changeBsGiven);
        const cashKeptUsd = round2(Math.min(Math.max(0, Number(tipAmountUsd) || 0), changeUsd));
        const changeToDeliverUsd = round2(Math.max(0, subR(changeUsd, cashKeptUsd)));
        const splitUsd = hasExplicitSplit ? round2(CurrencyService.safeParse(changeUsdGiven)) : changeToDeliverUsd;
        const splitBs  = hasExplicitSplit ? round2(CurrencyService.safeParse(changeBsGiven)) : 0;
        const tipEfectiva = cashKeptUsd > FINANCIAL_EPSILON.PAYMENT_ZERO;
        onConfirmSale(payments, {
            changeUsdGiven: hasExplicitSplit
                ? Math.min(splitUsd, changeToDeliverUsd)
                : (isChangeCredited ? 0 : changeToDeliverUsd),
            changeBsGiven: hasExplicitSplit
                ? Math.min(splitBs, changeToDeliverUsd * safeRate)
                : 0,
            vueltoCredito: isChangeCredited,
            // TIP-001: una sola moneda canónica; amountBs lo recalcula el procesador.
            tipDonated: tipEfectiva
                ? { amountUsd: cashKeptUsd, amountBs: 0, currency: tipCurrency }
                : null,
            changeAllocationExplicit: hasExplicitSplit || tipEfectiva || isChangeCredited,
        });
    }, [barValues, paymentMethods, onConfirmSale, changeUsdGiven, changeBsGiven, changeUsd, changeBs, safeRate, safeTasaCop, casheaActive, casheaAmountUsd, casheaPercent, tipAmountUsd, isChangeCredited, tipCurrency]);


    // ── Detección inteligente de errores de entrada ───────────────────────────
    const _detectWarning = useCallback(() => {
        if (cartTotalUsd <= 0) return null;

        for (const m of paymentMethods) {
            const val = CurrencyService.safeParse(barValues[m.id]);
            if (val === 0) continue;

            // FIN-016: usar divR en vez de val/safeRate o val/safeTasaCop.
            const valUsd = m.currency === 'USD' || m.currency === 'INTERNAL_CREDIT' ? val
                : m.currency === 'COP' ? (safeTasaCop > 0 ? divR(val, safeTasaCop) : 0)
                : (safeRate > 0 ? divR(val, safeRate) : 0);
            const diff = valUsd - cartTotalUsd;

            // Capa 1 — Confusión Bs → USD
            if (m.currency === 'USD' && safeRate > 1) {
                const impliedUsd = safeRate > 0 ? divR(val, safeRate) : 0;
                const ratio = impliedUsd / cartTotalUsd;
                if (ratio >= 0.90 && ratio <= 1.10 && val > cartTotalUsd * 3) {
                    const expectedBs = round2(mulR(cartTotalUsd, safeRate));
                    return {
                        type: 'currency_confusion',
                        title: 'Posible error de moneda',
                        lines: [
                            `Ingresaste $${round2(val)} en el campo de Dólares, pero el total de la venta es $${round2(cartTotalUsd)}.`,
                            `El total en Bolívares es Bs ${expectedBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}. ¿Confundiste el campo?`,
                        ],
                        isRound: false,
                    };
                }
            }

            // Capa 1b — Confusión USD → COP (monto muy bajo en COP)
            if (m.currency === 'COP' && safeTasaCop > 100) {
                const expectedCop = mulR(cartTotalUsd, safeTasaCop);
                // If user entered a value that looks like USD in COP field (e.g., 50 instead of 200,000)
                if (val < expectedCop * 0.05 && val > 0 && val <= cartTotalUsd * 2) {
                    return {
                        type: 'currency_confusion',
                        title: 'Posible error de moneda',
                        lines: [
                            `Ingresaste COP ${val.toLocaleString('es-CO')} pero el total en pesos es ${round2(expectedCop).toLocaleString('es-CO')} COP.`,
                            `¿Ingresaste dólares en el campo de pesos?`,
                        ],
                        isRound: false,
                    };
                }
            }

            // Capa 2 — Umbral proporcional según tamaño de venta
            const threshold = cartTotalUsd <= 10  ? { factor: 4,   minDiff: 15 }
                            : cartTotalUsd <= 50  ? { factor: 3,   minDiff: 30 }
                            : cartTotalUsd <= 200 ? { factor: 2,   minDiff: 50 }
                            :                      { factor: 1.5, minDiff: 100 };

            if (valUsd > cartTotalUsd * threshold.factor && diff > threshold.minDiff) {
                const symbol = m.currency === 'USD' ? '$' : m.currency === 'COP' ? 'COP ' : 'Bs ';
                const isRound = val >= 100 && val % 100 === 0;
                return {
                    type: 'high_amount',
                    title: 'Monto inusualmente alto',
                    lines: [
                        `Ingresaste ${symbol}${val.toLocaleString('es-VE', { minimumFractionDigits: 2 })} para una venta de $${round2(cartTotalUsd)}.`,
                        `¿El cliente realmente pagó esa cantidad?`,
                    ],
                    isRound,
                };
            }
        }
        return null;
    }, [barValues, paymentMethods, cartTotalUsd, safeRate, safeTasaCop]);

    const handleConfirm = useCallback(() => {
        triggerHaptic && triggerHaptic();
        const warning = _detectWarning();
        if (warning) {
            pendingConfirmRef.current = _processPayments;
            setPaymentWarning(warning);
            return;
        }
        _processPayments();
    }, [_detectWarning, _processPayments, triggerHaptic]);

    const confirmWarning = useCallback(() => {
        setPaymentWarning(null);
        pendingConfirmRef.current?.();
        pendingConfirmRef.current = null;
    }, []);

    const dismissWarning = useCallback(() => {
        setPaymentWarning(null);
        pendingConfirmRef.current = null;
    }, []);

    return {
        barValues,
        totalPaidUsd,
        totalPaidBs,
        remainingUsd,
        remainingBs,
        changeUsd,
        changeBs,
        isPaid,
        changeUsdGiven,
        changeBsGiven,
        setChangeUsdGiven,
        setChangeBsGiven,
        handleBarChange,
        fillBar,
        handleConfirm,
        paymentWarning,
        confirmWarning,
        dismissWarning,
        // TIP: propina donada (modo básico).
        isTipDonated,
        tipAmountUsd,
        handleTipAmountChange,
        toggleTipDonated,
        isChangeCredited,
        setIsChangeCredited,
        tipConfirmPending,
        tipCurrency,
        safeRate,
        // A-4: totales recalculados (doble precio + pago en Bs). La UI debe mostrar
        // ESTOS, no los props crudos, o el operador ve un total distinto al que se cobra.
        cartTotalUsd,
        cartTotalBs,
        // AVISO-REPRECIO: el total vigente difiere del base por aplicar el precio dual en Bs.
        repricedActive,
        repricedDeltaUsd,
        safeTasaCop,
        // FIN-009 / FIN-033: exponer errores de tasa para que la UI bloquee el cobro.
        rateError,
        copRateError,
        // Cashea outputs
        casheaActive,
        setCasheaActive,
        casheaPercent,
        setCasheaPercent,
        casheaAmountUsd,
        casheaConfirmReady,
        casheaEnabled,
        casheaMinAmount,
        casheaMeetsMinimum,
    };
}
