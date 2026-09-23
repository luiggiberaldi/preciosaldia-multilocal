import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { showToast } from '../../Toast';
import { useProductContext } from '../../../context/ProductContext';
import { round2, subR, mulR, divR, sumR, calculateChangeRemainder } from '../../../utils/dinero';
import { FinancialEngine } from '../../../core/FinancialEngine';
import { FINANCIAL_EPSILON } from '../../../utils/securityConstants';

// Hooks portados
import { usePaymentState } from './hooks/usePaymentState';
import { usePaymentCalculations } from './hooks/usePaymentCalculations';
import { useClientWallet } from './hooks/useClientWallet';

// Subcomponentes
import PaymentHeader from './components/PaymentHeader';
import CheckoutCustomerPicker from '../CheckoutCustomerPicker';
import PaymentLeftColumn from './components/PaymentLeftColumn';
import PaymentInputs from './components/PaymentInputs';
import PaymentFooter from './components/PaymentFooter';
import ChangeConfirmationModal from './components/ChangeConfirmationModal';
import WalletSection from './components/WalletSection';
import RepriceNotice from '../RepriceNotice';
import { isTicketRepriced } from '../../../utils/reprice.js';

/**
 * CheckoutModalPOS — Modo de cobro profesional (estilo Listo POS, dos columnas).
 */
export default function CheckoutModalPOS({
    onClose,
    cart = [],
    cartSubtotalUsd,
    cartTotalUsd,
    cartTotalBs,
    discountData,
    effectiveRate,
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    paymentMethods,
    onConfirmSale,
    onCreateCustomer,
    triggerHaptic,
    copEnabled = false,
    copPrimary = false,
    tasaCop = 0,
    onUseSaldoFavor,
    currentFloatUsd = 0,
    currentFloatBs = 0,
    onSwitchMode,
    isProcessing = false,
}) {
    const { setCheckoutMode } = useProductContext();

    // Separar métodos por tipo para los inputs
    const metodosActivos = paymentMethods.filter(m => !m.disabled && m.enabled !== false && !m.isInternalCredit && !m.isVirtual);
    const metodosDivisa = metodosActivos.filter(m => m.currency === 'USD');
    const metodosBs = metodosActivos.filter(m => m.currency === 'BS').sort((a, b) => {
        const isCashA = a.label?.toLowerCase().includes('efectivo');
        const isCashB = b.label?.toLowerCase().includes('efectivo');
        if (isCashA && !isCashB) return -1;
        if (!isCashA && isCashB) return 1;
        return 0;
    });
    const metodosCop = copEnabled ? metodosActivos.filter(m => m.currency === 'COP') : [];

    // Re-mapeo: paymentMethods de bodega usan {id, label, currency} pero los hooks
    // de Listo POS esperan {id, nombre, tipo}. Normalizamos aquí.
    const metodosNormalizados = metodosActivos.map(m => ({
        ...m,
        nombre: m.label || m.nombre || m.id,
        tipo: m.currency === 'BS' ? 'BS' : m.currency === 'COP' ? 'COP' : 'DIVISA',
        icono: m.icon || m.icono || 'DollarSign',
    }));
    const metodosDivisaNorm = metodosNormalizados.filter(m => m.tipo === 'DIVISA');
    const metodosBsNorm = metodosNormalizados.filter(m => m.tipo === 'BS').sort((a, b) => {
        const isCashA = a.nombre.toLowerCase().includes('efectivo');
        const isCashB = b.nombre.toLowerCase().includes('efectivo');
        if (isCashA && !isCashB) return -1;
        if (!isCashA && isCashB) return 1;
        return 0;
    });
    const metodosCopNorm = copEnabled ? metodosNormalizados.filter(m => m.tipo === 'COP') : [];

    // ─── STATE ─────────────────────────────────────────────
    const {
        modo, setModo,
        clienteSeleccionado, setClienteSeleccionado,
        pagos, setPagos,
        referencias, setReferencias,
        pagoSaldoFavor, setPagoSaldoFavor,
        activeInputId, setActiveInputId,
        activeInputType, setActiveInputType,
        inputRefs,
        val,
    } = usePaymentState(null, metodosNormalizados, false);

    // Sync external selectedCustomerId con el estado interno
    useEffect(() => {
        if (selectedCustomerId !== undefined) {
            setClienteSeleccionado(selectedCustomerId || '');
        }
    }, [selectedCustomerId]);

    // Propagar cambio de cliente al exterior
    const handleSetCliente = useCallback((id) => {
        if (id !== clienteSeleccionado) {
            setIsChangeCredited(false);
            setIsTipDonated(false);
            setTipConfirmPending(false);
            setTipAmountUsd('');
            setDistVueltoUSD('');
            setDistVueltoBS('');
            setShowMobileChangeDetails(false);
        }
        setClienteSeleccionado(id);
        setSelectedCustomerId(id);
    }, [clienteSeleccionado, setSelectedCustomerId]);

    // Cashea
    const casheaEnabled = localStorage.getItem('cashea_enabled') === 'true';
    const casheaMinAmount = parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0;
    const [casheaActive, setCasheaActive] = useState(false);
    const [casheaPercent, setCasheaPercent] = useState(60);

    // Vuelto distribución
    const [distVueltoUSD, setDistVueltoUSD] = useState('');
    const [distVueltoBS, setDistVueltoBS] = useState('');
    const [isChangeCredited, setIsChangeCredited] = useState(false);
    // TIP: propina donada ("cliente deja el cambio").
    const [isTipDonated, setIsTipDonated] = useState(false);
    // TIP-002 (D6): propinas grandes exigen una segunda pulsación.
    const [tipConfirmPending, setTipConfirmPending] = useState(false);
    // Monto del vuelto que el cliente deja en caja. Puede ser parcial.
    const [tipAmountUsd, setTipAmountUsd] = useState('');
    // En móvil se muestra una sola familia de moneda a la vez para reducir
    // desplazamiento y evitar errores de captura. Los valores no se pierden al
    // cambiar de pestaña.
    const [mobilePaymentCurrency, setMobilePaymentCurrency] = useState('USD');
    const [showMobileChangeDetails, setShowMobileChangeDetails] = useState(false);
    // La distribución se confirma en un segundo paso únicamente cuando existe vuelto.
    const [changeConfirmation, setChangeConfirmation] = useState(null);

    // Detectar si hay pagos ingresados en Bolívares o si un input de Bolívares está seleccionado
    const isBsPaymentActive = useMemo(() => {
        if (!cart || cart.length === 0) return false;
        const hasDualItem = cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0);
        if (!hasDualItem) return false;
        const isBsInputActive = metodosBsNorm.some(m => m.id === activeInputId);
        const hasBsPayment = metodosBsNorm.some(m => val(m.id) > 0);
        return isBsInputActive || hasBsPayment;
    }, [cart, metodosBsNorm, val, activeInputId]);

    // Recalcular totales dinámicos si el pago es en Bolívares
    const dynamicCartTotals = useMemo(() => {
        if (!cart || cart.length === 0 || !cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0)) {
            return { totalUsd: cartTotalUsd, totalBs: cartTotalBs };
        }
        return FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, tasaCop, isBsPaymentActive);
    }, [cart, discountData, effectiveRate, tasaCop, isBsPaymentActive, cartTotalUsd, cartTotalBs]);

    // AVISO-REPRECIO (PLAN-AVISO-REPRECIO-BS · Trabajo 1): el total cambia al
    // aplicar el precio de referencia en Bs de los ítems con Doble Precio.
    const repricedActive = isTicketRepriced({
        isBsPaymentActive,
        baseTotalUsd: cartTotalUsd,
        newTotalUsd: dynamicCartTotals.totalUsd,
    });
    const casheaMeetsMinimum = casheaMinAmount <= 0 || dynamicCartTotals.totalUsd >= casheaMinAmount;

    // M-2: paridad con el modo básico — bloquear el cobro si la tasa BCV es inválida.
    // Sin esto el POS deja armar todo el pago y el rechazo llega recién en el procesador.
    const rateError = !effectiveRate || effectiveRate <= 0;

    // ─── CÁLCULOS ──────────────────────────────────────────
    const {
        totalPagadoUSD,
        totalPagadoBS,
        totalPagadoGlobalUSD,
        faltaPorPagar,
        faltaPorPagarBS,
        cambioUSD,
        montoIGTF,
        totalConIGTF,
        totalConIGTFBS,
        tasaSegura,
        casheaAmountUsd,
    } = usePaymentCalculations({
        totalUSD: dynamicCartTotals.totalUsd,
        totalBS: dynamicCartTotals.totalBs,
        pagos,
        tasa: effectiveRate,
        metodosActivos: metodosNormalizados,
        val,
        pagoSaldoFavor,
        casheaActive,
        casheaPercent,
        copEnabled,
        tasaCop,
    });

    // El resto del vuelto, después de lo dejado en caja, puede entregarse
    // físicamente o acreditarse a la billetera.
    const cashKeptUsd = round2(Math.min(
        Math.max(0, parseFloat(tipAmountUsd) || 0),
        cambioUSD
    ));
    const changeToDeliverUsd = round2(Math.max(0, subR(cambioUSD, cashKeptUsd)));
    const declaredPhysicalUsd = round2(Math.min(
        changeToDeliverUsd,
        Math.max(0, parseFloat(distVueltoUSD) || 0) + divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura)
    ));
    const walletRemainderUsd = round2(Math.max(0, subR(changeToDeliverUsd, declaredPhysicalUsd)));
    const hasPhysicalDistribution = distVueltoUSD !== '' || distVueltoBS !== '';
    const plannedPhysicalUsd = hasPhysicalDistribution
        ? declaredPhysicalUsd
        : (isChangeCredited ? 0 : changeToDeliverUsd);
    const plannedWalletUsd = isChangeCredited ? walletRemainderUsd : 0;
    const unallocatedChangeUsd = round2(Math.max(0, subR(
        changeToDeliverUsd,
        sumR(plannedPhysicalUsd, plannedWalletUsd)
    )));
    const changeDestinationSelected = changeToDeliverUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO
        || hasPhysicalDistribution
        || isChangeCredited;
    const changeAllocationComplete = changeDestinationSelected
        && unallocatedChangeUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO;
    // Referencia dinámica para el cajero: muestra el remanente del mismo vuelto
    // en ambas monedas, sin escribir automáticamente en el otro campo.
    const changeRemainder = calculateChangeRemainder(
        changeToDeliverUsd,
        distVueltoUSD,
        distVueltoBS,
        tasaSegura,
    );
    // Cada moneda solo puede ocupar el espacio que deja la otra. Así nunca se
    // puede declarar $2 + Bs 2.085 cuando el vuelto real es $2,88.
    const maxVueltoUSD = round2(Math.max(0, subR(
        changeToDeliverUsd,
        divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura),
    )));
    const maxVueltoBS = round2(Math.max(0, mulR(
        Math.max(0, subR(changeToDeliverUsd, Math.max(0, parseFloat(distVueltoUSD) || 0))),
        tasaSegura,
    )));

    // Corrige también estados antiguos que pudieran haber quedado sobreasignados
    // por la versión anterior de la interfaz.
    useEffect(() => {
        const currentUsd = Math.max(0, parseFloat(distVueltoUSD) || 0);
        const currentBs = Math.max(0, parseFloat(distVueltoBS) || 0);
        if (currentBs > maxVueltoBS + 0.01) {
            setDistVueltoBS(maxVueltoBS.toString());
        } else if (currentUsd > maxVueltoUSD + 0.01) {
            setDistVueltoUSD(maxVueltoUSD.toString());
        }
    }, [distVueltoUSD, distVueltoBS, maxVueltoUSD, maxVueltoBS]);

    // Si se asigna todo el cambio a físico o caja, desactivar automáticamente la acreditación a billetera
    useEffect(() => {
        if (isChangeCredited && walletRemainderUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setIsChangeCredited(false);
        }
    }, [isChangeCredited, walletRemainderUsd]);

    // Límite máximo para propina / dejar en caja respetando el cambio físico ya asignado
    const declaredPhysicalWithoutTip = round2(
        Math.max(0, parseFloat(distVueltoUSD) || 0) +
        divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura)
    );
    const maxTipUsd = round2(Math.max(0, subR(cambioUSD, declaredPhysicalWithoutTip)));

    const handleTipAmountChange = (valor) => {
        const cleanVal = String(valor).replace(',', '.');
        if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) return;
        const availableMax = maxTipUsd > 0.001 ? maxTipUsd : cambioUSD;
        const amount = Math.min(Math.max(0, parseFloat(cleanVal) || 0), availableMax);
        setTipAmountUsd(cleanVal === '' ? '' : amount.toString());
        setIsTipDonated(amount > FINANCIAL_EPSILON.PAYMENT_ZERO);
        setIsChangeCredited(false);
    };

    const handleVueltoDistChange = (moneda, valor) => {
        let cleanVal = valor.replace(',', '.');
        if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) return;

        const valNum = parseFloat(cleanVal) || 0;
        
        if (moneda === 'usd') {
            const usdMax = round2(Math.min(valNum, maxVueltoUSD));
            if (valNum > maxVueltoUSD) {
                showToast(`Con el monto en Bs actual, solo quedan $${maxVueltoUSD.toFixed(2)} para entregar en dólares.`, 'warning');
            }
            setDistVueltoUSD(cleanVal === '' ? '' : usdMax.toString());
            
            const totalPhysical = sumR(usdMax, divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura));
            if (changeToDeliverUsd - totalPhysical <= 0.009) {
                setIsChangeCredited(false);
            }
        } else {
            const maxBs = maxVueltoBS;
            const bsMax = round2(Math.min(valNum, maxBs));
            if (valNum > maxBs) {
                showToast(`El vuelto total en bolívares es Bs ${Math.round(maxBs).toLocaleString('es-VE')}`, 'warning');
            }
            setDistVueltoBS(cleanVal === '' ? '' : bsMax.toString());
            
            const totalPhysical = sumR(Math.max(0, parseFloat(distVueltoUSD) || 0), divR(bsMax, tasaSegura));
            if (changeToDeliverUsd - totalPhysical <= 0.009) {
                setIsChangeCredited(false);
            }
        }
    };
    const handleCreditChange = () => {
        if (!clienteSeleccionado) {
            showToast('Selecciona un cliente para abonar el vuelto a cuenta', 'warning');
            return;
        }
        if (walletRemainderUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            showToast('No queda vuelto para acreditar: el resto ya está en caja o fue asignado como vuelto físico.', 'warning');
            return;
        }
        // El resto, después de lo dejado en caja y del desglose físico,
        // va a la billetera. Se conservan los campos físicos para permitir
        // combinaciones: caja + vuelto físico + saldo a favor.
        setIsChangeCredited(true);
    };

    // ── TIP-004 (D7): la moneda de la propina se deriva de la composición REAL
    // del efectivo en la gaveta, comparando magnitudes en una misma unidad (Bs).
    // No del orden de los métodos: $1 junto a Bs 5.000 no hace la propina "USD".
    // Solo cuenta EFECTIVO: un pago móvil no puede producir vuelto físico.
    // D8: no hay camino COP para la propina; el fallback es USD.
    const tipCurrency = useMemo(() => {
        const efectivoBs = metodosNormalizados
            .filter(m => m.tipo === 'BS' && String(m.id).startsWith('efectivo'))
            .reduce((s, m) => sumR(s, val(m.id)), 0);
        const efectivoUsdEnBs = mulR(
            metodosNormalizados
                .filter(m => m.tipo === 'DIVISA' && String(m.id).startsWith('efectivo'))
                .reduce((s, m) => sumR(s, val(m.id)), 0),
            tasaSegura
        );
        return efectivoBs > efectivoUsdEnBs ? 'BS' : 'USD';
    }, [metodosNormalizados, val, tasaSegura]);

    // ── TIP-002 (D6): propinas por encima del umbral exigen doble pulsación.
    const toggleTipDonated = () => {
        if (isTipDonated) {
            setIsTipDonated(false);
            setTipAmountUsd('');
            setTipConfirmPending(false);
            return;
        }
        // El monto a asignar a caja es el resto no distribuido físicamente
        const targetTip = maxTipUsd > 0.001 ? maxTipUsd : cambioUSD;

        if (targetTip > FINANCIAL_EPSILON.TIP_MAX_AUTO_USD && !tipConfirmPending) {
            setTipConfirmPending(true);
            showToast(
                `Propina de $${targetTip.toFixed(2)}. Pulsa de nuevo para confirmar.`,
                'warning'
            );
            return;
        }
        
        setIsChangeCredited(false);
        setTipConfirmPending(false);
        setTipAmountUsd(targetTip.toFixed(2));
        setIsTipDonated(true);
        triggerHaptic && triggerHaptic();
    };

    // Limpiar vuelto cuando baja
    useEffect(() => {
        if (cambioUSD <= 0) {
            setDistVueltoUSD('');
            setDistVueltoBS('');
            setTipAmountUsd('');
            setIsTipDonated(false);
            setShowMobileChangeDetails(false);
        }
    }, [cambioUSD]);

    // TIP-005 (T-5): apagar la propina si el vuelto desaparece. Sin esto el flag
    // sobrevive a una corrección del pago y la propina se re-arma sola cuando el
    // vuelto vuelve a subir, sin que el operador la reconfirme.
    useEffect(() => {
        if (cambioUSD <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setIsTipDonated(false);
            setTipAmountUsd('');
            setTipConfirmPending(false);
        }
    }, [cambioUSD]);

    // Si el monto del vuelto cambia, caduca cualquier confirmación pendiente:
    // el operador debe volver a ver la cifra antes de donarla.
    useEffect(() => {
        setTipConfirmPending(false);
    }, [cambioUSD]);

    // Mantener una pestaña válida si la configuración no tiene USD.
    useEffect(() => {
        const available = [
            metodosDivisaNorm.length > 0 && 'USD',
            metodosBsNorm.length > 0 && 'BS',
            metodosCopNorm.length > 0 && 'COP',
        ].filter(Boolean);
        if (available.length > 0 && !available.includes(mobilePaymentCurrency)) {
            setMobilePaymentCurrency(available[0]);
        }
    }, [metodosDivisaNorm.length, metodosBsNorm.length, metodosCopNorm.length, mobilePaymentCurrency]);

    // ─── WALLET ─────────────────────────────────────────────
    const { proyeccion } = useClientWallet(
        clienteSeleccionado, customers, modo, cambioUSD,
        isChangeCredited, distVueltoUSD, distVueltoBS, tasaSegura, cashKeptUsd
    );

    const selectedCustomer = customers.find(c => c.id === clienteSeleccionado);

    // ─── HANDLERS DE INPUT ──────────────────────────────────
    const llenarSaldo = (id, moneda) => {
        const actual = parseFloat(pagos[id] || 0);
        let valorFinal = 0;
        if (moneda === 'USD') {
            const usdTotals = FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, tasaCop, false);
            const remUsd = Math.max(0, subR(usdTotals.totalUsd, totalPagadoGlobalUSD));
            valorFinal = round2(actual + remUsd);
        } else if (moneda === 'BS') {
            const bsTotals = FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, tasaCop, true);
            // FIN-038: descontar también Cashea y el saldo a favor aplicado,
            // que ya cubren parte del total pero no están en totalPagadoBS.
            const cubiertoBs = sumR([
                totalPagadoBS,
                mulR(casheaAmountUsd, tasaSegura),
                mulR(parseFloat(pagoSaldoFavor) || 0, tasaSegura),
            ]);
            const remBs = Math.max(0, subR(bsTotals.totalBs, cubiertoBs));
            valorFinal = round2(actual + remBs);
        } else if (moneda === 'COP' && tasaCop > 0) {
            valorFinal = round2(actual + (faltaPorPagar * tasaCop));
        }
        setPagos(prev => ({ ...prev, [id]: valorFinal }));
    };

    const sumarBillete = (id, monto) => {
        const actual = parseFloat(pagos[id] || 0);
        const nuevo = round2(actual + monto);
        setPagos(prev => ({ ...prev, [id]: nuevo }));
    };

    const handleInputChange = (id, v) => {
        if (v === '' || /^\d*\.?\d*$/.test(v)) {
            setPagos(prev => ({ ...prev, [id]: v }));
        }
    };

    const handleRefChange = (id, v) => setReferencias(prev => ({ ...prev, [id]: v }));

    const handleInputKeyDown = (e, index) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = inputRefs.current[index + 1];
            if (next) next.focus({ preventScroll: true });
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = inputRefs.current[index - 1];
            if (prev) prev.focus({ preventScroll: true });
        }
    };

    // ─── PROCESAR PAGO ──────────────────────────────────────
    const procesarPago = (imprimir = false) => {
        try {
            // Validaciones
            // M-2: la tasa se valida PRIMERO — sin tasa válida nada de lo demás tiene sentido.
            if (rateError) {
                showToast('Tasa BCV inválida. Configúrala antes de cobrar.', 'error');
                return;
            }
            if (modo === 'contado' && faltaPorPagar > 0.01) {
                showToast(`Faltan $${faltaPorPagar.toFixed(2)} por cobrar`, 'error');
                return;
            }
            if (modo === 'credito' && !clienteSeleccionado) {
                showToast('Selecciona un cliente para vender a crédito', 'warning');
                return;
            }
            // En una venta fiada, pagar más que el total no es un abono válido:
            // el excedente no debe desaparecer ni convertirse silenciosamente en deuda.
            // Cambia a Contado para entregar/acreditar el vuelto, o usa Cartera > Abono
            // si la intención era pagar una deuda anterior.
            if (modo === 'credito' && cambioUSD > 0.01) {
                showToast(`El pago excede la venta en $${cambioUSD.toFixed(2)}. Cambia a Contado para gestionar el vuelto.`, 'warning');
                return;
            }
            if (parseFloat(pagoSaldoFavor || 0) > 0 && !clienteSeleccionado) {
                showToast('Selecciona un cliente para usar saldo a favor', 'error');
                return;
            }
            if (casheaActive && !clienteSeleccionado) {
                showToast('Selecciona un cliente para financiar con Cashea', 'warning');
                return;
            }

            // Verificar referencias
            for (const m of metodosNormalizados) {
                if (val(m.id) > 0 && m.requiereRef && (!referencias[m.id] || referencias[m.id].length < 4)) {
                    showToast(`Ingresa la referencia para ${m.nombre}`, 'warning');
                    return;
                }
            }

            // Construir pagos finales en formato que onConfirmSale espera
            const payments = metodosNormalizados
                .filter(m => val(m.id) > 0)
                .map(m => {
                    const amount = round2(val(m.id));
                    const currency = m.tipo === 'BS' ? 'BS' : m.tipo === 'COP' ? 'COP' : 'USD';
                    return {
                        id: crypto.randomUUID(),
                        methodId: m.id,
                        methodLabel: m.nombre,
                        currency,
                        amountInput: amount,
                        amountInputCurrency: currency,
                        amountUsd: currency === 'USD' ? amount
                            : currency === 'COP' ? (tasaCop > 0 ? amount / tasaCop : 0)
                            : (tasaSegura > 0 ? amount / tasaSegura : 0),
                        amountBs: currency === 'BS' ? amount
                            : currency === 'COP' ? (tasaCop > 0 && tasaSegura > 0 ? (amount / tasaCop) * tasaSegura : 0)
                            : (tasaSegura > 0 ? amount * tasaSegura : 0),
                        referencia: referencias[m.id] || '',
                    };
                });

            // Añadir Cashea virtual
            if (casheaActive && casheaAmountUsd > 0) {
                payments.push({
                    id: crypto.randomUUID(),
                    methodId: 'cashea',
                    methodLabel: 'Cashea',
                    currency: 'USD',
                    amountInput: casheaAmountUsd,
                    amountInputCurrency: 'USD',
                    amountUsd: casheaAmountUsd,
                    amountBs: mulR(casheaAmountUsd, tasaSegura),
                    isCashea: true,
                    casheaPercent: 100 - casheaPercent,
                });
            }

            // Añadir saldo a favor
            if (parseFloat(pagoSaldoFavor) > 0) {
                payments.push({
                    id: crypto.randomUUID(),
                    methodId: 'saldo_favor',
                    methodLabel: 'Saldo a Favor',
                    currency: 'USD',
                    amountInput: parseFloat(pagoSaldoFavor),
                    amountInputCurrency: 'USD',
                    amountUsd: parseFloat(pagoSaldoFavor),
                    amountBs: parseFloat(pagoSaldoFavor) * tasaSegura,
                    isSaldoFavor: true,
                });
            }

            const hasExplicitSplit = distVueltoUSD !== '' || distVueltoBS !== '';
            // TIP-002 (D3): propina donada ⟹ no se entrega vuelto. El procesador
            // lo vuelve a forzar, pero se manda coherente desde aquí.
            const tipEfectiva = isTipDonated && cashKeptUsd > FINANCIAL_EPSILON.PAYMENT_ZERO;
            const saleOptions = {
                // FIN-034: si el operador tocó cualquiera de los dos campos de desglose,
                // se respetan tal cual (el vacío vale 0). El botón "Todo" del campo Bs deja
                // distVueltoUSD en '' — leerlo como "no especificado" duplicaba el vuelto.
                changeUsdGiven: hasExplicitSplit
                    ? (parseFloat(distVueltoUSD) || 0)
                    : (isChangeCredited ? 0 : changeToDeliverUsd),
                changeBsGiven: hasExplicitSplit
                    ? (parseFloat(distVueltoBS) || 0)
                    : 0,
                esCredito: modo === 'credito',
                clienteId: clienteSeleccionado || null,
                esCashea: casheaActive,
                vueltoCredito: isChangeCredited,
                // TIP-001: una sola moneda canónica. amountUsd es el monto real;
                // amountBs lo recalcula el procesador si la moneda nativa es Bs.
                tipDonated: tipEfectiva
                    ? { amountUsd: cashKeptUsd, amountBs: tipCurrency === 'BS' ? round2(mulR(cashKeptUsd, tasaSegura)) : 0, currency: tipCurrency }
                    : null,
                changeAllocationExplicit: hasExplicitSplit || tipEfectiva || isChangeCredited,
            };

            // Si hay vuelto, se revisa la distribución en un modal final. No se
            // registra nada hasta que el cajero confirme explícitamente.
            if (cambioUSD > FINANCIAL_EPSILON.PAYMENT_ZERO) {
                setChangeConfirmation({ payments, saleOptions, imprimir });
                return;
            }

            onConfirmSale(payments, saleOptions, imprimir);
            triggerHaptic && triggerHaptic();
        } catch (err) {
            console.error('Error al procesar pago POS:', err);
            showToast('Error al procesar el pago. Revisa la consola.', 'error');
        }
    };

    const deudaCliente = modo === 'credito' ? faltaPorPagar : 0;
    // TIP: si el cliente dona el vuelto, no hay nada que repartir → siempre válido.
    const isVueltoValido = changeToDeliverUsd < 0.001 || (
        parseFloat(distVueltoUSD || 0) + parseFloat(distVueltoBS || 0) / tasaSegura <= changeToDeliverUsd + 0.001
    );

    // Switch rápido al modo básico
    const handleSwitchToBasic = () => {
        setCheckoutMode('basic');
        if (onSwitchMode) onSwitchMode('basic');
    };

    // 🛡️ EFECTO: Si se activa Cashea, forzar el modo de pago a Contado (no se puede vender a crédito de la casa y con Cashea a la vez)
    useEffect(() => {
        if (casheaActive && modo === 'credito') {
            setModo('contado');
        }
    }, [casheaActive, modo, setModo]);

    return (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Modal de pago profesional"
                className="bg-white dark:bg-slate-950 w-full max-w-6xl h-[100dvh] sm:h-auto rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[100dvh] sm:max-h-[95vh] animate-in zoom-in-95 duration-200"
            >
                <PaymentHeader
                    modo={modo}
                    setModo={setModo}
                    onClose={onClose}
                    onSwitchToBasic={handleSwitchToBasic}
                    tasa={effectiveRate}
                    casheaActive={casheaActive}
                />
                <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
                    <PaymentLeftColumn
                        className="order-2 lg:order-1"
                        currentFloatUsd={currentFloatUsd}
                        currentFloatBs={currentFloatBs}
                        totalUSD={dynamicCartTotals.totalUsd}
                        totalBS={dynamicCartTotals.totalBs}
                        discountData={discountData}
                        tasaSegura={tasaSegura}
                        clienteSeleccionado={clienteSeleccionado}
                        setClienteSeleccionado={handleSetCliente}
                        customers={customers}
                        onCreateCustomer={onCreateCustomer}
                        modo={modo}
                        proyeccion={proyeccion}
                        totalPagadoGlobalUSD={totalPagadoGlobalUSD}
                        faltaPorPagar={faltaPorPagar}
                        faltaPorPagarBS={faltaPorPagarBS}
                        cambioUSD={cambioUSD}
                        distVueltoUSD={distVueltoUSD}
                        distVueltoBS={distVueltoBS}
                        handleVueltoDistChange={handleVueltoDistChange}
                        isChangeCredited={isChangeCredited}
                        handleCreditChange={handleCreditChange}
                        setIsChangeCredited={setIsChangeCredited}
                        isTipDonated={isTipDonated}
                        toggleTipDonated={toggleTipDonated}
                        tipAmountUsd={tipAmountUsd}
                        handleTipAmountChange={handleTipAmountChange}
                        cashKeptUsd={cashKeptUsd}
                        changeToDeliverUsd={changeToDeliverUsd}
                        changeDestinationSelected={changeDestinationSelected}
                        walletRemainderUsd={walletRemainderUsd}
                        remainingChangeUsd={changeRemainder.remainingUsd}
                        remainingChangeBs={changeRemainder.remainingBs}
                        maxVueltoUSD={maxVueltoUSD}
                        maxVueltoBS={maxVueltoBS}
                        maxTipUsd={maxTipUsd}
                        showMobileChangeDetails={showMobileChangeDetails}
                        setShowMobileChangeDetails={setShowMobileChangeDetails}
                        tipConfirmPending={tipConfirmPending}
                        tipCurrency={tipCurrency}
                        deudaCliente={deudaCliente}
                        isVueltoValido={isVueltoValido}
                        casheaEnabled={casheaEnabled}
                        casheaMeetsMinimum={casheaMeetsMinimum}
                        casheaActive={casheaActive}
                        setCasheaActive={setCasheaActive}
                        casheaPercent={casheaPercent}
                        setCasheaPercent={setCasheaPercent}
                        casheaAmountUsd={casheaAmountUsd}
                        effectiveRate={effectiveRate}
                    />
                    <div className="order-1 lg:order-2 flex-1 min-h-0 flex flex-col bg-white dark:bg-slate-950 overflow-hidden">
                        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-5 pb-5">
                            {/* Barra compacta de Total a Pagar (solo móvil para evitar duplicidad y scroll) */}
                            <div className="lg:hidden mb-2.5 p-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between shadow-sm">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Total a Pagar</span>
                                    <span className="text-xl font-black leading-tight text-white">${dynamicCartTotals.totalUsd.toFixed(2)}</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-sm font-bold text-emerald-400">Bs {round2(dynamicCartTotals.totalBs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
                                    {discountData?.active && (
                                        <span className="block text-[9px] text-emerald-300 font-bold">
                                            Desc: -{discountData.type === 'percentage' ? `${discountData.value}%` : `$${discountData.amountUsd?.toFixed(2)}`}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <RepriceNotice
                                repricedActive={repricedActive}
                                totalUsd={dynamicCartTotals.totalUsd}
                                baseTotalUsd={cartTotalUsd}
                            />
                            <div className="lg:hidden mb-2.5">
                                <CheckoutCustomerPicker customers={customers} selectedCustomerId={clienteSeleccionado} setSelectedCustomerId={handleSetCliente} effectiveRate={effectiveRate} onCreateCustomer={onCreateCustomer} />
                            </div>
                            <WalletSection cliente={selectedCustomer} totalPagadoUSD={totalPagadoUSD} tasaSegura={tasaSegura} totalConIGTF={dynamicCartTotals.totalUsd} casheaAmountUsd={casheaAmountUsd} pagoSaldoFavor={pagoSaldoFavor} setPagoSaldoFavor={setPagoSaldoFavor} />
                            <div className="lg:hidden mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Moneda del pago">
                                {[
                                    metodosDivisaNorm.length > 0 && { id: 'USD', label: 'Dólares' },
                                    metodosBsNorm.length > 0 && { id: 'BS', label: 'Bolívares' },
                                    metodosCopNorm.length > 0 && { id: 'COP', label: 'COP' },
                                ].filter(Boolean).map(option => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={mobilePaymentCurrency === option.id}
                                        tabIndex={mobilePaymentCurrency === option.id ? 0 : -1}
                                        onClick={() => setMobilePaymentCurrency(option.id)}
                                        className={`min-h-[44px] shrink-0 px-4 rounded-xl text-xs font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${mobilePaymentCurrency === option.id ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300'}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <PaymentInputs metodosDivisa={metodosDivisaNorm} mobileCurrency={mobilePaymentCurrency} metodosBs={metodosBsNorm} metodosCop={metodosCopNorm} pagos={pagos} handleInputChange={handleInputChange} llenarSaldo={llenarSaldo} referencias={referencias} handleRefChange={handleRefChange} inputRefs={inputRefs} handleInputKeyDown={handleInputKeyDown} tasa={tasaSegura} sumarBillete={sumarBillete} isTouch={false} onFocusInput={(id) => { setActiveInputId(id); setActiveInputType('amount'); }} activeInputId={activeInputId} onFocusRef={(id) => { setActiveInputId(id); setActiveInputType('ref'); }} copEnabled={copEnabled} />
                        </div>

                        <div className="hidden lg:block">
                            <PaymentFooter modo={modo} faltaPorPagar={faltaPorPagar} clienteSeleccionado={clienteSeleccionado} totalPagadoGlobalUSD={totalPagadoGlobalUSD} cambioUSD={cambioUSD} onProcesar={procesarPago} isProcessing={isProcessing} rateError={rateError} changeAllocationComplete={changeAllocationComplete} />
                        </div>
                    </div>
                    <div className="order-3 lg:hidden sticky bottom-0 z-20 shrink-0">
                        <PaymentFooter modo={modo} faltaPorPagar={faltaPorPagar} clienteSeleccionado={clienteSeleccionado} totalPagadoGlobalUSD={totalPagadoGlobalUSD} cambioUSD={cambioUSD} onProcesar={procesarPago} isProcessing={isProcessing} rateError={rateError} changeAllocationComplete={changeAllocationComplete} />
                    </div>
                </div>
            </div>

            {changeConfirmation && (
                <ChangeConfirmationModal
                    cambioUSD={cambioUSD}
                    tasaSegura={tasaSegura}
                    distVueltoUSD={distVueltoUSD}
                    distVueltoBS={distVueltoBS}
                    plannedPhysicalUsd={plannedPhysicalUsd}
                    plannedWalletUsd={plannedWalletUsd}
                    plannedCashUsd={cashKeptUsd}
                    unallocatedChangeUsd={unallocatedChangeUsd}
                    changeAllocationComplete={changeAllocationComplete}
                    changeDestinationSelected={changeDestinationSelected}
                    isChangeCredited={isChangeCredited}
                    onCancel={() => setChangeConfirmation(null)}
                    onConfirm={() => {
                        const pending = changeConfirmation;
                        setChangeConfirmation(null);
                        onConfirmSale(pending.payments, pending.saleOptions, pending.imprimir);
                        triggerHaptic && triggerHaptic();
                    }}
                    isProcessing={isProcessing}
                />
            )}
        </div>
    );
}
