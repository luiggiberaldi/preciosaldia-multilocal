import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Users, Receipt, ArrowLeftRight, AlertTriangle, Smartphone, Lock, LayoutGrid, HandCoins, CheckCircle, Wallet, Zap, ChevronDown } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { mulR, divR, subR, round2, calculateChangeRemainder } from '../../utils/dinero';
import { computeRealisticSplit, stepSplitDown, stepSplitUp } from '../../utils/changeSplit';
import { FINANCIAL_EPSILON } from '../../utils/securityConstants';
import { useCheckoutCalculations } from '../../hooks/useCheckoutCalculations';
import CheckoutPaymentBars from './CheckoutPaymentBars';
import CheckoutCustomerPicker from './CheckoutCustomerPicker';
import PaymentWarningModal from './PaymentWarningModal';
import ChangeConfirmationModal from './CheckoutModalPOS/components/ChangeConfirmationModal';
import { MobileChangeAllocation, PaymentStatusSummary } from './MobileCheckout';
import RepriceNotice from './RepriceNotice';

/**
 * CheckoutModal — Zona de Cobro con Barras de Pago (Estilo Listo POS)
 */
export default function CheckoutModal({
    onClose,
    cart = [],
    cartSubtotalUsd,
    cartSubtotalBs,
    cartTotalUsd: baseCartTotalUsd,
    cartTotalBs: baseCartTotalBs,
    cartTotalCop,
    discountData,
    effectiveRate,
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    paymentMethods,
    onConfirmSale,
    triggerHaptic,
    onCreateCustomer,
    copEnabled,
    copPrimary,
    tasaCop,
    currentFloatUsd = 0,
    currentFloatBs = 0,
    isProcessing = false
}) {
    const [confirmFiar, setConfirmFiar] = useState(false);
    const [changeConfirmation, setChangeConfirmation] = useState(null);
    const changeSummaryRef = React.useRef({ changeUsd: 0 });
    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    // El hook construye los pagos y valida advertencias. Cuando existe vuelto,
    // interceptamos el registro para pedir una última confirmación de destinos.
    const handleCalculatedSale = useCallback((payments, saleOptions) => {
        if (changeSummaryRef.current.changeUsd > FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setChangeConfirmation({ payments, saleOptions });
            return;
        }
        onConfirmSale(payments, saleOptions);
    }, [onConfirmSale]);

    const {
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
        // TIP: propina donada.
        isTipDonated,
        tipAmountUsd,
        handleTipAmountChange,
        toggleTipDonated,
        tipConfirmPending,
        tipCurrency,
        isChangeCredited,
        setIsChangeCredited,
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
        rateError,
        copRateError,
        safeRate,
        safeTasaCop,
        cartTotalUsd,
        cartTotalBs,
        repricedActive,
    } = useCheckoutCalculations({
        paymentMethods,
        effectiveRate,
        tasaCop,
        copEnabled,
        cartTotalUsd: baseCartTotalUsd,
        cartTotalBs: baseCartTotalBs,
        triggerHaptic,
        onConfirmSale: handleCalculatedSale,
        cart,
        discountData,
        saldoFavorDisponible: selectedCustomer?.favor || 0,
        selectedCustomerId,
    });

    const CASHEA_LEVEL_MAP = { 1: 60, 2: 50, 3: 40, 4: 30, 5: 20, 6: 10 };
    const cashKeptUsd = round2(Math.min(Math.max(0, Number(tipAmountUsd) || 0), changeUsd));
    const changeToDeliverUsd = round2(Math.max(0, subR(changeUsd, cashKeptUsd)));
    const declaredPhysicalUsd = round2(Math.min(
        changeToDeliverUsd,
        Math.max(0, Number(changeUsdGiven) || 0) + divR(Math.max(0, Number(changeBsGiven) || 0), safeRate)
    ));
    const walletRemainderUsd = round2(Math.max(0, subR(changeToDeliverUsd, declaredPhysicalUsd)));
    const hasPhysicalDistribution = changeUsdGiven !== '' || changeBsGiven !== '';
    const plannedPhysicalUsd = hasPhysicalDistribution
        ? declaredPhysicalUsd
        : (isChangeCredited ? 0 : changeToDeliverUsd);
    const plannedWalletUsd = isChangeCredited ? walletRemainderUsd : 0;
    const plannedCashUsd = cashKeptUsd;
    const unallocatedChangeUsd = round2(Math.max(0, subR(
        changeToDeliverUsd,
        plannedPhysicalUsd + plannedWalletUsd
    )));
    const changeDestinationSelected = changeToDeliverUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO
        || hasPhysicalDistribution
        || isChangeCredited;
    const changeAllocationComplete = changeDestinationSelected && unallocatedChangeUsd <= 0.01;

    // ── FASE 2: vuelto progresivo (fila inline + bottom sheet) ──────────
    const [showChangeSheet, setShowChangeSheet] = useState(false);
    // FASE 3: "Más opciones" — Cashea vive colapsado para no ensuciar cada venta.
    const [showMoreOptions, setShowMoreOptions] = useState(false);
    // El desglose legacy solo aparece cuando el flujo de propina necesita
    // confirmación en el footer (auto-confirm del hook) o hay parcial en caja.
    // "Personalizar" abre exclusivamente el bottom sheet (que contiene el
    // mismo desglose) para no apilar dos sistemas de vuelto en pantalla.
    const showAdvancedChangeResolved = tipConfirmPending || Number(tipAmountUsd) > 0;
    // ── VUELTO-REALISTA: propuesta de desglose billetes USD + resto en Bs ──
    // Reemplaza al viejo "Entregar todo" (que registraba changeUsdGiven = vuelto
    // completo, físicamente imposible: el USD circulante es solo billetes).
    // VUELTO-REALISTA Fase 3: preferencias por tienda (Configuración → Ventas →
    // Desglose del Cambio). Leídas por render: el modal es efímero, el coste es
    // trivial y evita estado desincronizado si la config cambia con el modal abierto.
    // Guardarraíles del parseo: NaN/negativos caen al default (un paso de
    // redondeo negativo desplazaría dinero del cliente hacia la tienda).
    const _billRaw = parseFloat(localStorage.getItem('checkout_smallest_usd_bill'));
    const storeBillPref = Number.isFinite(_billRaw) && _billRaw > 0 ? _billRaw : 1;
    const _stepRaw = parseFloat(localStorage.getItem('checkout_bs_round_step'));
    const storeRoundStep = Number.isFinite(_stepRaw) && _stepRaw >= 0 ? _stepRaw : 0;
    const storeRoundMode = localStorage.getItem('checkout_bs_round_mode') === 'floor' ? 'floor' : 'ceil';

    const realisticSplit = useMemo(
        () => computeRealisticSplit({
            changeUsd: changeToDeliverUsd,
            rate: safeRate,
            smallestUsdBill: storeBillPref,
            bsRoundStep: storeRoundStep,
            bsRoundMode: storeRoundMode,
            floatUsd: currentFloatUsd > 0 ? currentFloatUsd : Infinity,
        }),
        // eslint-disable-next-line react-hooks/preserve-manual-memoization -- dependencias son derivados inmutables por render
        [changeToDeliverUsd, safeRate, currentFloatUsd, storeBillPref, storeRoundStep, storeRoundMode],
    );

    const deliverRealisticChange = () => {
        triggerHaptic && triggerHaptic();
        // VUELTO-REALISTA-fix: aplica el split PREVISUALIZADO (si el cajero ajustó
        // con ±) o la propuesta original. Único punto donde el desglose se
        // compromete a los campos de la venta.
        const s = steppedSplit || realisticSplit;
        setChangeUsdGiven(s.usdPart > 0 ? s.usdPart.toFixed(2) : '');
        setChangeBsGiven(s.bsPart > 0 ? s.bsPart.toFixed(2) : '');
        setSteppedSplit(null);
    };

    // "Todo en dólares": opción explícita (en Personalizar) para el único caso
    // ejecutable: vuelto entero. La fracción de dólar no circula como moneda.
    const deliverAllUsdChange = () => {
        triggerHaptic && triggerHaptic();
        setChangeUsdGiven(changeToDeliverUsd.toFixed(2));
        setChangeBsGiven('');
    };

    const tipToggle = () => {
        if (!isTipDonated) {
            handleTipAmountChange(changeToDeliverUsd.toFixed(2));
        } else {
            handleTipAmountChange('');
        }
        toggleTipDonated();
    };
    const changeProgressState = (() => {
        if (changeAllocationComplete) return 'complete';
        if (hasPhysicalDistribution || isTipDonated) return 'partial';
        return 'pending';
    })();
    changeSummaryRef.current = { changeUsd };
    // El mismo vuelto puede repartirse entre USD y Bs. Mostramos el remanente
    // convertido en ambas monedas sin rellenar automáticamente el otro campo.
    const changeRemainder = calculateChangeRemainder(
        changeToDeliverUsd,
        changeUsdGiven,
        changeBsGiven,
        safeRate,
    );
    const maxChangeUsdGiven = round2(Math.max(0, subR(
        changeToDeliverUsd,
        divR(Math.max(0, Number(changeBsGiven) || 0), safeRate),
    )));
    const maxChangeBsGiven = round2(Math.max(0, mulR(
        Math.max(0, subR(changeToDeliverUsd, Math.max(0, Number(changeUsdGiven) || 0))),
        safeRate,
    )));

    // Normaliza cualquier combinación antigua que haya quedado por encima del
    // vuelto real. Se conserva primero el monto en Bs y se ajusta el USD restante.
    useEffect(() => {
        const currentUsd = Math.max(0, Number(changeUsdGiven) || 0);
        const currentBs = Math.max(0, Number(changeBsGiven) || 0);
        if (currentBs > maxChangeBsGiven + 0.01) {
            setChangeBsGiven(maxChangeBsGiven.toString());
        } else if (currentUsd > maxChangeUsdGiven + 0.01) {
            setChangeUsdGiven(maxChangeUsdGiven.toString());
        }
    }, [changeUsdGiven, changeBsGiven, maxChangeUsdGiven, maxChangeBsGiven]);

    // ── Steppers ± (Fase 2): ajustar la parte USD un billete cuando en caja no
    // está el billete que la propuesta asume (ej. sin $1). Recalculan los Bs al
    // instante. SOLO PREVISUALIZAN (steppedSplit): no tocan los campos de la
    // venta hasta pulsar "Entregar así" — un toque de ± no debe completar la
    // asignación ni desbloquear el CTA (fix: antes escribían directo en
    // changeUsdGiven/changeBsGiven y "CONFIRMA EL CAMBIO" se soltaba solo).
    // (Va DESPUÉS de changeProgressState: TDZ — el E2E lo detectó.)
    const splitEditable = changeProgressState === 'pending';
    const [steppedSplit, setSteppedSplit] = useState(null);
    // El preview es efímero: se descarta si el vuelto desaparece (pagos
    // editados) o la asignación ya no está pendiente (sheet, propina, entregado).
    useEffect(() => {
        if (!isPaid || changeToDeliverUsd <= 0.009 || changeProgressState !== 'pending') {
            setSteppedSplit(null);
        }
    }, [isPaid, changeToDeliverUsd, changeProgressState]);
    // Split activo en la fila: el previsualizado (±) o la propuesta original.
    const activeSteppedSplit = steppedSplit || realisticSplit;
    const canStepDown = splitEditable && activeSteppedSplit.usdPart > 0;
    const steppedUpPreview = stepSplitUp({ changeUsd: changeToDeliverUsd, split: activeSteppedSplit, rate: safeRate, smallestUsdBill: storeBillPref, bsRoundStep: storeRoundStep, bsRoundMode: storeRoundMode });
    const canStepUp = splitEditable
        && steppedUpPreview.usdPart > activeSteppedSplit.usdPart
        && steppedUpPreview.remainderUsd <= 0.005;
    const stepDown = () => {
        triggerHaptic && triggerHaptic();
        const next = stepSplitDown({ changeUsd: changeToDeliverUsd, split: activeSteppedSplit, rate: safeRate, smallestUsdBill: storeBillPref, bsRoundStep: storeRoundStep, bsRoundMode: storeRoundMode });
        setSteppedSplit(next);
    };
    const stepUp = () => {
        triggerHaptic && triggerHaptic();
        setSteppedSplit(steppedUpPreview);
    };

    useEffect(() => {
        if (casheaEnabled && selectedCustomer) {
            if (selectedCustomer.casheaLevel && CASHEA_LEVEL_MAP[selectedCustomer.casheaLevel] !== undefined) {
                if (casheaMeetsMinimum) {
                    // M-1: NO autoactivar Cashea. Seleccionar un cliente con nivel Cashea
                    // no significa que la venta sea financiada — el operador decide.
                    // Solo se pre-carga el porcentaje que le corresponde a su nivel.
                    // (El modo POS ya se comporta así; esto alinea ambos modos.)
                    setCasheaPercent(CASHEA_LEVEL_MAP[selectedCustomer.casheaLevel]);
                }
            } else {
                setCasheaActive(false);
            }
        } else {
            setCasheaActive(false);
        }
    }, [selectedCustomerId, selectedCustomer, casheaEnabled, casheaMeetsMinimum, setCasheaActive, setCasheaPercent]);



    return (
        <div className="fixed inset-0 z-50 bg-white dark:bg-slate-950 flex flex-col overflow-hidden">

            {/* --- HEADER --- */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <button onClick={onClose} aria-label="Cerrar" className="p-3 -m-1.5 rounded-xl text-slate-500 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <X size={22} />
                </button>
                <h2 className="text-base font-black text-slate-800 dark:text-white tracking-wide">COBRAR</h2>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 rounded-lg">
                        {formatBs(effectiveRate)} Bs/$
                    </span>
                </div>
            </div>

            {/* --- BARRA DE ESTADO ÚNICA (Fase 1): el único lugar con Total→Pagado→Resta/Vuelto --- */}
            <PaymentStatusSummary
                cartTotalUsd={cartTotalUsd}
                cartTotalBs={cartTotalBs}
                totalPaidUsd={totalPaidUsd}
                totalPaidBs={totalPaidBs}
                isPaid={isPaid}
                remainingUsd={remainingUsd}
                remainingBs={remainingBs}
                changeUsd={changeUsd}
                changeBs={changeBs}
                discountData={discountData}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
            />

            {/* AVISO-REPRECIO (PLAN-AVISO-REPRECIO-BS · Trabajo 1): explica por qué el
                total cambia al entrar un pago en Bs (precio de referencia dual). */}
            <RepriceNotice
                repricedActive={repricedActive}
                totalUsd={cartTotalUsd}
                baseTotalUsd={baseCartTotalUsd}
            />

            {/* --- SCROLLABLE BODY --- */}
            <div className="flex-1 overflow-y-auto overscroll-contain pb-28">

                {/* En móvil el cliente se elige antes de mostrar los medios de pago. */}
                <div className="sm:hidden px-3 pt-3">
                    <CheckoutCustomerPicker
                        customers={customers}
                        selectedCustomerId={selectedCustomerId}
                        setSelectedCustomerId={setSelectedCustomerId}
                        effectiveRate={effectiveRate}
                        onCreateCustomer={onCreateCustomer}
                    />
                </div>

                {/* -- PAYMENT BARS -- */}
                <CheckoutPaymentBars
                    paymentMethods={paymentMethods}
                    barValues={barValues}
                    effectiveRate={effectiveRate}
                    tasaCop={tasaCop}
                    copEnabled={copEnabled}
                    onBarChange={handleBarChange}
                    onFillBar={fillBar}
                    saldoFavorDisponible={selectedCustomer?.favor || 0}
                    showSaldoFavor={remainingUsd > 0.01 || Number(barValues.saldo_favor) > 0.01}
                />

                {/* FASE 3: CASHEA PANEL — secundario, colapsado por defecto */}
                {casheaEnabled && (
                    <div className="px-3 py-2">
                        <button
                            type="button"
                            onClick={() => setShowMoreOptions(o => !o)}
                            aria-expanded={showMoreOptions}
                            className="w-full min-h-[44px] px-3 flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 active:scale-[0.99] transition-all"
                        >
                            <LayoutGrid size={16} className="text-purple-500 shrink-0" />
                            <span className="text-xs font-black">Más opciones</span>
                            {casheaActive && (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">Cashea activo</span>
                            )}
                            {!casheaActive && selectedCustomer?.casheaLevel && (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">Nivel {selectedCustomer.casheaLevel}</span>
                            )}
                            <ChevronDown size={16} className={`ml-auto transition-transform ${showMoreOptions ? 'rotate-180' : ''}`} />
                        </button>
                        {showMoreOptions && (
                        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 mt-2">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <CasheaIcon size={20} />
                                    <span className="text-sm font-bold text-slate-800 dark:text-white">Cashea</span>
                                    {selectedCustomer?.casheaLevel && (
                                        <span className="text-[10px] font-black bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                                            Nivel {selectedCustomer.casheaLevel}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => {
                                        if (!selectedCustomerId) {
                                            triggerHaptic && triggerHaptic();
                                            return;
                                        }
                                        if (!casheaMeetsMinimum) {
                                            return;
                                        }
                                        triggerHaptic && triggerHaptic();
                                        setCasheaActive(!casheaActive);
                                    }}
                                    disabled={!selectedCustomerId || !casheaMeetsMinimum}
                                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        casheaActive ? 'bg-purple-600' : 'bg-slate-200 dark:bg-slate-800'
                                    } ${(!selectedCustomerId || !casheaMeetsMinimum) ? 'opacity-40 cursor-not-allowed' : ''}`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                            casheaActive ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>

                            {/* Informational hints when not active / cannot activate */}
                            {!selectedCustomerId && (
                                <p className="text-[10px] text-slate-400 font-bold">
                                    * Selecciona un cliente para habilitar Cashea.
                                </p>
                            )}
                            {selectedCustomerId && !casheaMeetsMinimum && (
                                <p className="text-[10px] text-amber-500 font-bold">
                                    * Compra mínima de ${casheaMinAmount.toFixed(2)} requerida para Cashea (Total actual: ${cartTotalUsd.toFixed(2)}).
                                </p>
                            )}

                            {/* Active Cashea Breakdown */}
                            {casheaActive && (
                                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                                    <div>
                                        <span className="block text-[10px] font-black text-purple-700 dark:text-purple-400 uppercase tracking-wider mb-1.5">
                                            Cuota Inicial (%)
                                        </span>
                                        <div className="grid grid-cols-6 gap-1">
                                            {[60, 50, 40, 30, 20, 10].map(pct => (
                                                <button
                                                    key={pct}
                                                    onClick={() => {
                                                        triggerHaptic && triggerHaptic();
                                                        setCasheaPercent(pct);
                                                    }}
                                                    className={`py-1.5 text-xs font-black rounded-lg transition-all ${
                                                        casheaPercent === pct
                                                            ? 'bg-purple-600 text-white shadow-md'
                                                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                    }`}
                                                >
                                                    {pct}%
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Breakdown */}
                                    <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 rounded-lg p-2.5 space-y-1.5">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-slate-500 dark:text-slate-400">Total Venta:</span>
                                            <span className="font-black text-slate-800 dark:text-white">${cartTotalUsd.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-slate-500 dark:text-slate-400">Cuota Inicial ({casheaPercent}%):</span>
                                            <span className="font-black text-purple-700 dark:text-purple-400">
                                                ${round2(mulR(cartTotalUsd, casheaPercent / 100)).toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-slate-500 dark:text-slate-400">Financiado (a cobrar por app):</span>
                                            <span className="font-black text-purple-700 dark:text-purple-400">
                                                ${casheaAmountUsd.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        )}
                    </div>
                )}

                {/* -- CLIENTE -- */}
                <div className="hidden sm:block">
                <CheckoutCustomerPicker
                    customers={customers}
                    selectedCustomerId={selectedCustomerId}
                    setSelectedCustomerId={setSelectedCustomerId}
                    effectiveRate={effectiveRate}
                    onCreateCustomer={onCreateCustomer}
                />
                </div>

                {/* A-2: el botón "Usar Saldo a Favor" fue eliminado. Llamaba a onUseSaldoFavor,
                    un prop que SalesView nunca pasó (no está en sharedProps), así que fallaba
                    en silencio; y su condición leía `deuda` en vez de `favor`.
                    El modo POS sí tiene la funcionalidad (WalletSection) si hay que reimplementarla. */}
            </div>

            {/* --- COMPACT STICKY FOOTER --- */}
            <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_10px_rgba(0,0,0,0.03)]">
                
                {/* -- COMPACT VUELTO / RESTANTE -- */}
                <div className={`px-4 py-2 border-b border-slate-100 dark:border-slate-800 transition-all ${isPaid
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/20'
                    : 'bg-orange-50/70 dark:bg-orange-950/20'
                    }`}>
                    
                    <div className="flex items-center justify-between">
                        <div className="flex items-baseline gap-2">
                            <span className={`text-[10px] font-black uppercase tracking-wider ${isPaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-400'}`}>
                                {isPaid ? 'Vuelto:' : 'Resta:'}
                            </span>
                            {copEnabled && tasaCop > 0 ? (
                                copPrimary ? (
                                    <span className={`text-lg font-black ${isPaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-400'}`}>
                                        {formatCop((isPaid ? changeUsd : remainingUsd) * tasaCop)} COP
                                    </span>
                                ) : (
                                    <span className={`text-lg font-black ${isPaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-400'}`}>
                                        ${isPaid ? changeUsd.toFixed(2) : remainingUsd.toFixed(2)}
                                    </span>
                                )
                            ) : (
                                <span className={`text-lg font-black ${isPaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-400'}`}>
                                    ${isPaid ? changeUsd.toFixed(2) : remainingUsd.toFixed(2)}
                                </span>
                            )}
                        </div>
                        
                        <div className="text-right">
                            {copEnabled && tasaCop > 0 ? (
                                copPrimary ? (
                                    <span className={`text-xs font-bold ${isPaid ? 'text-emerald-700' : 'text-orange-700'}`}>
                                        ${isPaid ? changeUsd.toFixed(2) : remainingUsd.toFixed(2)} · Bs {formatBs(isPaid ? changeBs : remainingBs)}
                                    </span>
                                ) : (
                                    <span className={`text-xs font-bold ${isPaid ? 'text-emerald-700' : 'text-orange-700'}`}>
                                        {formatCop((isPaid ? changeUsd : remainingUsd) * tasaCop)} COP · Bs {formatBs(isPaid ? changeBs : remainingBs)}
                                    </span>
                                )
                            ) : (
                                <span className={`text-xs font-bold ${isPaid ? 'text-emerald-700' : 'text-orange-700'}`}>
                                    Bs {formatBs(isPaid ? changeBs : remainingBs)}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* FASE 2: fila progresiva — oculta mientras el desglose legacy esté visible (exclusión mutua). */}
                    {!showAdvancedChangeResolved && (
                    <MobileChangeAllocation
                        mode="inline"
                        state={changeProgressState}
                        changeUsd={changeUsd}
                        changeBs={changeBs}
                        changeRemainder={changeRemainder}
                        realisticSplit={activeSteppedSplit}
                        onStepDown={stepDown}
                        onStepUp={stepUp}
                        canStepDown={canStepDown}
                        canStepUp={canStepUp}
                        isTipDonated={isTipDonated}
                        cashKeptUsd={cashKeptUsd}
                        isChangeCredited={isChangeCredited}
                        changeUsdGiven={changeUsdGiven}
                        changeBsGiven={changeBsGiven}
                        onDeliverAll={deliverRealisticChange}
                        onOpenSheet={() => setShowChangeSheet(true)}
                    />
                    )}

                    {/* DESGLOSE AVANZADO (legacy): solo cuando el operador eligió personalizar */}
                    {showAdvancedChangeResolved && isPaid && changeUsd > 0.009 && (
                        <div className="mt-1.5 pt-1.5 border-t border-emerald-200/50 dark:border-emerald-800/30 flex flex-col gap-1">
                            {/* TIP: el cliente deja el cambio. Paridad con el modo POS. */}
                            <button
                                type="button"
                                onClick={toggleTipDonated}
                                title={isTipDonated ? 'Vuelto asignado a caja como ingreso/propina (pulsa para cancelar)' : 'Dejar el vuelto en caja como ingreso o propina para el negocio'}
                                className={`w-full py-2 px-2.5 rounded-lg font-black text-[10px] flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] ${
                                    isTipDonated
                                        ? 'bg-emerald-600 text-white shadow shadow-emerald-500/30'
                                        : tipConfirmPending
                                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-2 border-amber-400 animate-pulse'
                                            : 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                }`}
                            >
                                <HandCoins size={13} className="shrink-0" />
                                <span className="truncate">
                                    {isTipDonated
                                        ? `En caja: $${cashKeptUsd.toFixed(2)}`
                                        : tipConfirmPending
                                            ? `Confirmar: donar $${changeUsd.toFixed(2)}`
                                            : 'Cliente deja el cambio (Donar a Caja)'}
                                </span>
                                {isTipDonated && <CheckCircle size={12} className="text-white shrink-0" />}
                            </button>

                            <button
                                type="button"
                                disabled={!selectedCustomerId || (!isChangeCredited && walletRemainderUsd <= 0.01)}
                                onClick={() => {
                                    if (!selectedCustomerId) {
                                        triggerHaptic && triggerHaptic();
                                        return;
                                    }
                                                    setIsChangeCredited(current => !current);
                                }}
                                className={`w-full py-2 px-2.5 rounded-lg font-black text-[10px] flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] ${
                                    isChangeCredited
                                        ? 'bg-brand text-white shadow shadow-brand/30'
                                        : 'bg-white dark:bg-slate-800 text-brand-dark dark:text-brand border border-brand/30 dark:border-brand/70'
                                } ${(!selectedCustomerId || walletRemainderUsd <= 0.01) ? 'opacity-40 cursor-not-allowed' : ''}`}
                            >
                                <Wallet size={13} className="shrink-0" />
                                {isChangeCredited ? `Billetera $${walletRemainderUsd.toFixed(2)}` : `Acreditar $${walletRemainderUsd.toFixed(2)}`}
                            </button>

                            {!isChangeCredited && walletRemainderUsd > 0.01 && selectedCustomerId && (
                                <p className="w-full mt-1 text-center text-[9px] font-bold text-brand/80 dark:text-brand">
                                    El saldo se acredita únicamente al pulsar el botón y confirmar la venta.
                                </p>
                            )}

                            {isTipDonated && (
                                <div className="mt-2 pt-2 border-t border-emerald-200/50 dark:border-emerald-800/30">
                                    <div className="flex items-center justify-between gap-1 mb-1.5">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
                                            Parte del vuelto que queda en caja
                                        </label>
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 whitespace-nowrap">
                                            Máx: ${changeUsd.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="relative group">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-600 dark:text-emerald-400 pointer-events-none select-none">
                                            $
                                        </span>
                                        <input
                                            type="number"
                                            min="0"
                                            max={changeUsd}
                                            step="0.01"
                                            value={tipAmountUsd}
                                            onChange={e => handleTipAmountChange(e.target.value)}
                                            onFocus={e => e.target.select()}
                                            placeholder="0.00"
                                            className="w-full h-11 py-2 pl-7 pr-16 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleTipAmountChange(changeUsd.toString())}
                                            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm shadow-emerald-600/20 active:scale-95 transition-all"
                                            title="Asignar todo el vuelto a caja"
                                        >
                                            <Zap size={11} className="fill-current" />
                                            <span>Todo</span>
                                        </button>
                                    </div>
                                    <p className="mt-1 text-[9px] text-slate-500 dark:text-slate-400">
                                        El resto se entrega como cambio o se acredita a la billetera.
                                    </p>
                                </div>
                            )}

                            <>
                            <div className="grid grid-cols-2 gap-2.5">
                                <div className="min-w-0">
                                    <div className="flex items-center justify-between gap-1 mb-1.5 min-h-[22px]">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400 whitespace-nowrap shrink-0">Cambio en $</span>
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 whitespace-nowrap shrink-0">Queda ${changeRemainder.remainingUsd.toFixed(2)}</span>
                                    </div>
                                    <div className="relative group">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-600 dark:text-emerald-400 pointer-events-none select-none">
                                            $
                                        </span>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            placeholder="0.00"
                                            value={changeUsdGiven}
                                            onChange={e => {
                                                const v = e.target.value;
                                                const usd = Math.min(Math.max(0, parseFloat(v) || 0), maxChangeUsdGiven);
                                                setChangeUsdGiven(v === '' ? '' : usd.toString());
                                            }}
                                            className="w-full h-11 py-2 pl-7 pr-16 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => { setChangeUsdGiven(maxChangeUsdGiven.toFixed(2)); }}
                                            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm shadow-emerald-600/20 active:scale-95 transition-all"
                                            title="Asignar todo el vuelto restante en USD"
                                        >
                                            <Zap size={11} className="fill-current" />
                                            <span>Todo</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="min-w-0">
                                    <div className="flex items-center justify-between gap-1 mb-1.5 min-h-[22px]">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-800 dark:text-blue-400 whitespace-nowrap shrink-0">Cambio en Bs</span>
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-blue-100/70 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 whitespace-nowrap shrink-0">Queda Bs {formatBs(changeRemainder.remainingBs)}</span>
                                    </div>
                                    <div className="relative group">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-blue-600 dark:text-blue-400 pointer-events-none select-none">
                                            Bs
                                        </span>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            placeholder="0"
                                            value={changeBsGiven}
                                            onChange={e => {
                                                const v = e.target.value;
                                                const bs = Math.min(Math.max(0, parseFloat(v) || 0), maxChangeBsGiven);
                                                setChangeBsGiven(v === '' ? '' : bs.toString());
                                            }}
                                            className="w-full h-11 py-2 pl-8 pr-16 rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => { setChangeBsGiven(maxChangeBsGiven.toFixed(2)); }}
                                            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg text-[10px] font-black bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm shadow-blue-600/20 active:scale-95 transition-all"
                                            title="Asignar todo el vuelto restante en Bolívares"
                                        >
                                            <Zap size={11} className="fill-current" />
                                            <span>Todo</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {/* Estado del vuelto: ya lo comunica la barra superior y el CTA deshabilitado. */}

                            {/* FLOAT WARNINGS */}
                            {(parseFloat(changeUsdGiven) > currentFloatUsd + 0.05 || parseFloat(changeBsGiven) > currentFloatBs + 1) && (
                                <div className="p-1 rounded bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 flex items-start gap-1">
                                    <AlertTriangle size={10} className="text-orange-500 shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <p className="text-[9px] font-bold text-orange-600 dark:text-orange-400 leading-tight">
                                            Excede fondo de caja.
                                        </p>
                                    </div>
                                </div>
                            )}
                            </>
                        </div>
                    )}
                </div>

                {/* --- BOTON CTA --- */}
                <div className="px-4 py-3">
                    <button
                        onClick={() => {
                            if (casheaActive) {
                                triggerHaptic && triggerHaptic();
                                setConfirmFiar(true);
                            } else if (!isPaid && selectedCustomerId && remainingUsd > 0.01) {
                                triggerHaptic && triggerHaptic();
                                setConfirmFiar(true);
                            } else {
                                handleConfirm();
                            }
                        }}
                        disabled={isProcessing || rateError || (copEnabled && copRateError) || (!isPaid && casheaActive) || (!selectedCustomerId && remainingUsd > 0.01) || (isPaid && !changeAllocationComplete)}
                        className={`w-full py-4 text-white font-black text-base rounded-2xl shadow-lg transition-all tracking-wide flex items-center justify-center gap-2 ${
                            isProcessing || rateError || (copEnabled && copRateError)
                                ? 'bg-slate-300 dark:bg-slate-800 !text-slate-500 cursor-not-allowed shadow-none'                                    : isPaid
                                        ? !changeAllocationComplete
                                            ? 'bg-slate-300 dark:bg-slate-800 !text-slate-500 shadow-none cursor-not-allowed'
                                            : casheaActive
                                                ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/25 active:scale-[0.98]'
                                                : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25 active:scale-[0.98]'
                                    : selectedCustomerId
                                        ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/25 active:scale-[0.98]'
                                        : 'bg-slate-300 dark:bg-slate-800 !text-slate-500 shadow-none cursor-not-allowed'
                        }`}
                    >
                        {isProcessing ? (
                            <><span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> PROCESANDO...</>
                        ) : rateError || (copEnabled && copRateError) ? (
                            <><AlertTriangle size={18} /> ERROR DE TASA</>
                        ) : isPaid ? (
                            !changeAllocationComplete ? (
                                <><AlertTriangle size={18} className="shrink-0" /> CONFIRMA EL CAMBIO</>
                            ) : casheaActive ? (
                                <><Receipt size={18} /> CONFIRMAR VENTA CASHEA</>
                            ) : (
                                <><Receipt size={18} /> CONFIRMAR VENTA</>
                            )
                        ) : casheaActive ? (
                            <><Smartphone size={18} /> COMPLETAR CUOTA INICIAL</>
                        ) : selectedCustomerId ? (
                            <><Users size={18} /> FIAR RESTANTE ({copEnabled && tasaCop > 0 ? (copPrimary ? `${formatCop(remainingUsd * tasaCop)} COP / $${remainingUsd.toFixed(2)}` : `$${remainingUsd.toFixed(2)} / ${formatCop(remainingUsd * tasaCop)} COP`) : `$${remainingUsd.toFixed(2)}`})</>
                        ) : (
                            <><Receipt size={18} /> INGRESA LOS PAGOS</>
                        )}
                    </button>
                </div>
            </div>
            {/* FASE 2: bottom sheet de asignación del vuelto */}
            <MobileChangeAllocation
                mode="sheet"
                open={showChangeSheet}
                onClose={() => setShowChangeSheet(false)}
                changeUsd={changeUsd}
                changeBs={changeBs}
                changeRemainder={changeRemainder}
                isTipDonated={isTipDonated}
                tipAmountUsd={tipAmountUsd}
                handleTipAmountChange={handleTipAmountChange}
                cashKeptUsd={cashKeptUsd}
                onToggleTip={tipToggle}
                changeUsdGiven={changeUsdGiven}
                changeBsGiven={changeBsGiven}
                setChangeUsdGiven={setChangeUsdGiven}
                setChangeBsGiven={setChangeBsGiven}
                maxChangeUsdGiven={maxChangeUsdGiven}
                maxChangeBsGiven={maxChangeBsGiven}
                isChangeCredited={isChangeCredited}
                setIsChangeCredited={setIsChangeCredited}
                hasCustomer={!!selectedCustomerId}
                currentFloatUsd={currentFloatUsd}
                currentFloatBs={currentFloatBs}
            />
            {confirmFiar && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setConfirmFiar(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-sm sm:max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-4 mb-5">
                            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                                casheaActive ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-amber-100 dark:bg-amber-900/30'
                            }`}>
                                {casheaActive ? (
                                    <CasheaIcon size={24} className="sm:w-7 sm:h-7" />
                                ) : (
                                    <AlertTriangle size={24} className="text-amber-600 sm:w-7 sm:h-7" />
                                )}
                            </div>
                            <div>
                                <h3 className="text-lg sm:text-xl font-black text-slate-800 dark:text-white">
                                    {casheaActive ? 'Confirmar Financiamiento Cashea' : 'Confirmar Fiado'}
                                </h3>
                                <p className="text-xs sm:text-sm text-slate-400 mt-0.5">Revisa los detalles antes de continuar</p>
                            </div>
                        </div>

                        <div className={`border rounded-2xl p-4 sm:p-5 mb-5 ${
                            casheaActive
                                ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800/30'
                                : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'
                        }`}>
                            <div className="text-center mb-3">
                                <p className={`text-[11px] sm:text-xs font-bold uppercase tracking-widest mb-1 ${
                                    casheaActive ? 'text-purple-500' : 'text-amber-500'
                                }`}>
                                    {casheaActive ? 'Monto a financiar con Cashea' : 'Monto a fiar'}
                                </p>
                                <p className={`text-3xl sm:text-4xl font-black ${
                                    casheaActive
                                        ? 'text-purple-600 dark:text-purple-400'
                                        : (copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-amber-600')
                                }`}>
                                    {casheaActive
                                        ? `$${casheaAmountUsd.toFixed(2)}`
                                        : (copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(remainingUsd * tasaCop)} COP` : `$${remainingUsd.toFixed(2)}`)
                                    }
                                </p>
                                <p className={`text-sm sm:text-base font-bold mt-0.5 ${
                                    casheaActive ? 'text-purple-500/70' : 'text-amber-500/70'
                                }`}>
                                    {casheaActive
                                        ? `${formatBs(casheaAmountUsd * safeRate)} Bs`
                                        : (copEnabled && tasaCop > 0 ? (copPrimary ? `$${remainingUsd.toFixed(2)} · ${formatBs(remainingBs)} Bs` : `${formatCop(remainingUsd * tasaCop)} COP · ${formatBs(remainingBs)} Bs`) : `${formatBs(remainingBs)} Bs`)
                                    }
                                </p>
                            </div>
                            <div className={`border-t pt-3 space-y-2 ${
                                casheaActive ? 'border-purple-200/50 dark:border-purple-800/20' : 'border-amber-200/50 dark:border-amber-800/20'
                            }`}>
                                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                                    {casheaActive ? (
                                        <>
                                            Se registrará como deuda de Cashea a nombre de <span className="font-black text-slate-800 dark:text-white">{selectedCustomer?.name}</span>.
                                        </>
                                    ) : (
                                        <>
                                            Se registrará como deuda a nombre de <span className="font-black text-slate-800 dark:text-white">{selectedCustomer?.name}</span>.
                                        </>
                                    )}
                                </p>
                                {casheaActive ? (
                                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                        El cliente abona la cuota inicial de <span className="font-bold text-purple-600 dark:text-purple-400">${round2(cartTotalUsd - casheaAmountUsd).toFixed(2)}</span> en caja. El restante queda financiado.
                                    </p>
                                ) : (
                                    <>
                                        {totalPaidUsd > 0.01 && (
                                            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                                El cliente abona <span className="font-bold text-emerald-600">{copEnabled && tasaCop > 0 ? (copPrimary ? `${formatCop(totalPaidUsd * tasaCop)} COP / $${totalPaidUsd.toFixed(2)}` : `$${totalPaidUsd.toFixed(2)} / ${formatCop(totalPaidUsd * tasaCop)} COP`) : `$${totalPaidUsd.toFixed(2)}`}</span> ahora y el restante queda pendiente.
                                            </p>
                                        )}
                                        {totalPaidUsd <= 0.01 && (
                                            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                                El monto total de la venta quedará como deuda del cliente.
                                            </p>
                                        )}
                                    </>
                                )}
                                {selectedCustomer && !casheaActive && (selectedCustomer.deuda || 0) > 0.01 && (
                                    <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 rounded-lg p-2.5 mt-2">
                                        <p className="text-[11px] sm:text-xs font-bold text-red-600 dark:text-red-400">
                                            Este cliente ya tiene una deuda de {copEnabled && tasaCop > 0 ? (copPrimary ? `${formatCop((selectedCustomer.deuda || 0) * tasaCop)} COP ($${(selectedCustomer.deuda || 0).toFixed(2)})` : `$${(selectedCustomer.deuda || 0).toFixed(2)} (${formatCop((selectedCustomer.deuda || 0) * tasaCop)} COP)`) : `$${(selectedCustomer.deuda || 0).toFixed(2)}`}. La deuda total pasará a ser {copEnabled && tasaCop > 0 ? (copPrimary ? `${formatCop(((selectedCustomer.deuda || 0) + remainingUsd) * tasaCop)} COP ($${((selectedCustomer.deuda || 0) + remainingUsd).toFixed(2)})` : `$${((selectedCustomer.deuda || 0) + remainingUsd).toFixed(2)} (${formatCop(((selectedCustomer.deuda || 0) + remainingUsd) * tasaCop)} COP)`) : `$${((selectedCustomer.deuda || 0) + remainingUsd).toFixed(2)}`}.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setConfirmFiar(false)}
                                className="flex-1 py-3.5 sm:py-4 font-bold text-sm sm:text-base text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { setConfirmFiar(false); handleConfirm(); }}
                                disabled={isProcessing}
                                className={`flex-1 py-3.5 sm:py-4 font-black text-sm sm:text-base text-white rounded-xl shadow-lg active:scale-95 transition-all ${
                                    isProcessing
                                        ? 'bg-slate-400 dark:bg-slate-700 cursor-not-allowed shadow-none'
                                        : casheaActive
                                            ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/25'
                                            : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/25'
                                }`}
                            >
                                {isProcessing ? 'Procesando...' : casheaActive ? 'Confirmar Cashea' : 'Confirmar fiado'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {changeConfirmation && (
                <ChangeConfirmationModal
                    cambioUSD={changeUsd}
                    tasaSegura={safeRate}
                    distVueltoUSD={changeUsdGiven}
                    distVueltoBS={changeBsGiven}
                    plannedPhysicalUsd={plannedPhysicalUsd}
                    plannedWalletUsd={plannedWalletUsd}
                    plannedCashUsd={plannedCashUsd}
                    unallocatedChangeUsd={unallocatedChangeUsd}
                    changeAllocationComplete={changeAllocationComplete}
                    changeDestinationSelected={changeDestinationSelected}
                    isChangeCredited={isChangeCredited}
                    realisticSplit={realisticSplit}
                    onDeliverAllUsd={deliverAllUsdChange}
                    onCancel={() => setChangeConfirmation(null)}
                    onConfirm={() => {
                        const pending = changeConfirmation;
                        setChangeConfirmation(null);
                        onConfirmSale(pending.payments, pending.saleOptions);
                        triggerHaptic && triggerHaptic();
                    }}
                    isProcessing={isProcessing}
                />
            )}

            <PaymentWarningModal
                warning={paymentWarning}
                onConfirm={confirmWarning}
                onCancel={dismissWarning}
            />

        </div>
    );
}
