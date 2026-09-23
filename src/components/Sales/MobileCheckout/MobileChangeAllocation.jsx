import React from 'react';
import { HandCoins, CheckCircle, Wallet, AlertTriangle, X, Scissors, Minus, Plus } from 'lucide-react';
import { formatBs } from '../../../utils/calculatorUtils';

/**
 * MobileChangeAllocation — Fase 2 (vuelto progresivo) + VUELTO-REALISTA.
 *
 * Dos superficies a partir de la MISMA lógica financiera (cero duplicación):
 *
 * 1. mode="inline" — fila progresiva del footer del CheckoutModal:
 *    - state="pending":  "Vuelto $X → $Y en billetes + Bs Z · [Entregar así]"
 *                        (1 pulsación con el desglose REAL: el USD circulante
 *                        es solo billetes, la fracción sale en Bs) + "Personalizar".
 *    - state="partial":  "Falta $X · [Continuar asignando]" → abre el sheet.
 *    - state="complete": "✓ Vuelto asignado · [Editar]" → abre el sheet.
 *
 * 2. mode="sheet"  — bottom sheet con el desglose completo: parcial en caja
 *    (propina), cambio físico $/Bs con límites cruzados, acreditar a billetera
 *    (solo con pulsación explícita), estado vivo y aviso de fondo de caja.
 *
 * Guardarraíles: el componente NO calcula nada financiero. Recibe de
 * CheckoutModal los valores ya validados por useCheckoutCalculations
 * (FIN-034: mismo vuelto expresado en $ y Bs sin doble conteo).
 * El desglose propuesto llega en `realisticSplit` (utils/changeSplit.js).
 */
export default function MobileChangeAllocation({
    mode = 'inline',
    open = false,
    onClose,
    state = 'pending',
    changeUsd = 0,
    changeBs = 0,
    changeRemainder = { remainingUsd: 0, remainingBs: 0 },
    // Desglose realista propuesto (computeRealisticSplit); opcional.
    realisticSplit = null,
    // Steppers ± (VUELTO-REALISTA Fase 2): ajustar la parte USD un billete cuando
    // la propuesta no es entregable (falta un billete). Recalculan los Bs al
    // instante. Opcionales; si no llegan, los controles no se muestran.
    onStepDown,
    onStepUp,
    canStepDown = false,
    canStepUp = false,
    // Acciones (definidas en CheckoutModal con la lógica existente)
    onDeliverAll,
    onOpenSheet,
    onToggleTip,
    // Parcial en caja (propina)
    isTipDonated,
    tipAmountUsd,
    handleTipAmountChange,
    cashKeptUsd = 0,
    // Cambio físico
    changeUsdGiven,
    changeBsGiven,
    setChangeUsdGiven,
    setChangeBsGiven,
    maxChangeUsdGiven = 0,
    maxChangeBsGiven = 0,
    // Billetera
    isChangeCredited,
    setIsChangeCredited,
    hasCustomer = false,
    // Fondo de caja
    currentFloatUsd = 0,
    currentFloatBs = 0,
}) {
    // ────────────────────────────────────────────────────────────────────
    // MODO INLINE: fila progresiva del footer
    // ────────────────────────────────────────────────────────────────────
    if (mode === 'inline') {
        if (changeUsd <= 0.009) return null;

        if (state === 'pending') {
            // Propuesta realista visible ANTES de pulsar: el cajero sabe exactamente
            // qué se va a registrar. Sin split (tasa ausente) cae al texto simple.
            const hasProposal = realisticSplit
                && (realisticSplit.usdPart > 0 || realisticSplit.bsPart > 0)
                && realisticSplit.remainderUsd <= 0.005;
            const proposalParts = hasProposal
                ? [
                    realisticSplit.usdPart > 0 ? `$${realisticSplit.usdPart.toFixed(2)}` : null,
                    realisticSplit.bsPart > 0 ? `Bs ${formatBs(realisticSplit.bsPart)}` : null,
                ].filter(Boolean)
                : [];
            return (
                <div className="px-4 pt-2 pb-1">
                    {/* Layout en 2 filas (VUELTO-REALISTA-responsivo-2): la propuesta
                        vive en su propia fila entre los steppers (sin competir por
                        ancho: a 320px tiene ~240px reales, sin truncate) y el botón
                        pasa a fila completa debajo — target táctil más grande y cero
                        overflow/scrollbar fantasma en 320-430px. */}
                    {hasProposal ? (
                        <>
                            <div className="flex items-center gap-2">
                                {canStepDown && (
                                    <button
                                        type="button"
                                        onClick={onStepDown}
                                        aria-label="Restar un billete de dólar al cambio y entregar más en bolívares"
                                        className="shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 active:scale-90 transition-transform"
                                    >
                                        <Minus size={14} strokeWidth={3} />
                                    </button>
                                )}
                                <span
                                    className={`flex-1 min-w-0 text-sm font-black text-slate-700 dark:text-slate-200 truncate text-center ${!canStepDown && !canStepUp ? 'text-left' : ''}`}
                                    title={`→ ${proposalParts.join(' + ')}`}
                                >
                                    → {proposalParts.join(' + ')}
                                </span>
                                {canStepUp && (
                                    <button
                                        type="button"
                                        onClick={onStepUp}
                                        aria-label="Sumar un billete de dólar al cambio y entregar menos en bolívares"
                                        className="shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 active:scale-90 transition-transform"
                                    >
                                        <Plus size={14} strokeWidth={3} />
                                    </button>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={onDeliverAll}
                                className="mt-2 w-full min-h-11 px-3 rounded-xl font-black text-sm bg-emerald-700 text-white shadow-md shadow-emerald-700/25 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                            >
                                <HandCoins size={15} className="shrink-0" />
                                Entregar así
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="flex items-baseline gap-1.5 min-w-0">
                                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 shrink-0">Vuelto</span>
                                <span className="text-lg font-black text-emerald-700 dark:text-emerald-400 leading-none">
                                    ${changeUsd.toFixed(2)}
                                </span>
                                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 truncate min-w-0">
                                    · Bs {formatBs(changeBs)}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={onDeliverAll}
                                className="mt-2 w-full min-h-11 px-3 rounded-xl font-black text-sm bg-emerald-700 text-white shadow-md shadow-emerald-700/25 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                            >
                                <HandCoins size={15} className="shrink-0" />
                                Entregar en Bs
                            </button>
                        </>
                    )}
                    {/* Opción secundaria (VUELTO-REALISTA-UX): botón real de tono neutro,
                        con copy que parte de la situación que lo origina (el cliente pide
                        otro destino) y subtítulo que enseña los destinos en palabras de
                        gente — sin jerga de "billetera/caja parcial". */}
                    <button
                        type="button"
                        onClick={onOpenSheet}
                        className="mt-2 w-full text-left rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white/60 dark:bg-slate-900/60 hover:border-slate-400 dark:hover:border-slate-500 active:scale-[0.99] transition-all pl-2.5 pr-3 py-2 flex items-center gap-2 min-h-[46px]"
                    >
                        <span className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                            <Scissors size={13} className="text-slate-500 dark:text-slate-400" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-black text-slate-700 dark:text-slate-200 leading-tight">
                                ¿El cliente lo quiere de otra forma?
                            </span>
                            <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 leading-tight truncate">
                                Darlo en Bs, acreditarlo a su cuenta o dejarlo en caja
                            </span>
                        </span>
                    </button>
                    <div aria-live="polite" className="sr-only">
                        Vuelto de {changeUsd.toFixed(2)} dólares pendiente.
                        {hasProposal
                            ? ` Propuesta: ${realisticSplit.usdPart.toFixed(2)} dólares en billetes y ${realisticSplit.bsPart} bolívares. Pulsa Entregar así para asignarlo.`
                            : ' Pulsa Entregar en Bs para asignarlo completo en bolívares.'}
                    </div>
                </div>
            );
        }

        if (state === 'partial') {
            return (
                <div className="px-4 pt-2 pb-1">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">Falta</span>
                            <span className="text-base font-black text-amber-700 dark:text-amber-400 leading-none">
                                ${changeRemainder.remainingUsd.toFixed(2)}
                            </span>
                            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400/80 whitespace-nowrap">· Bs {formatBs(changeRemainder.remainingBs)}</span>
                        </div>
                        <button
                            type="button"
                            onClick={onOpenSheet}
                            className="ml-auto shrink-0 min-h-[40px] px-3 rounded-xl font-black text-xs bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 active:scale-[0.97] transition-all flex items-center gap-1.5"
                        >
                            Continuar asignando
                        </button>
                    </div>
                    <div aria-live="polite" className="sr-only">
                        Falta por asignar {changeRemainder.remainingUsd.toFixed(2)} dólares del vuelto.
                    </div>
                </div>
            );
        }

        // state === 'complete'
        return (
            <div className="px-4 pt-2 pb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    <CheckCircle size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="text-xs font-black text-emerald-700 dark:text-emerald-300 truncate">
                        {isTipDonated && !changeUsdGiven && !changeBsGiven
                            ? `En caja: $${cashKeptUsd.toFixed(2)}`
                            : isChangeCredited
                                ? `Billetera: $${Math.max(0, changeUsd - changeRemainder.remainingUsd - cashKeptUsd).toFixed(2)}`
                                : `Vuelto asignado: $${(changeUsd - changeRemainder.remainingUsd).toFixed(2)}`}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onOpenSheet}                            className="ml-auto shrink-0 min-h-11 px-3 rounded-xl font-black text-[11px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 active:scale-[0.97] transition-all"
                >
                    Editar
                </button>
            </div>
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // MODO SHEET: bottom sheet con el desglose completo
    // ────────────────────────────────────────────────────────────────────
    if (mode !== 'sheet' || !open) return null;

    const exceedsFloat = Number(changeUsdGiven) > currentFloatUsd + 0.05 || Number(changeBsGiven) > currentFloatBs + 1;
    const sheetIncomplete = changeRemainder.remainingUsd > 0.005 && !isChangeCredited;

    return (
        <div
            className="fixed inset-0 z-[90] flex flex-col justify-end bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-950 w-full rounded-t-3xl shadow-2xl max-h-[88vh] overflow-y-auto animate-in slide-in-from-bottom-full duration-300 pb-[max(1rem,env(safe-area-inset-bottom))]"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Asignación del vuelto"
            >
                {/* Agarre + encabezado */}
                <div className="shrink-0 sticky top-0 bg-white dark:bg-slate-950 z-10">
                    <div className="flex justify-center pt-3 pb-1 cursor-pointer" onClick={onClose}>
                        <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full" />
                    </div>
                    <div className="px-4 pb-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                        <div>
                            <h3 className="text-base font-black text-slate-800 dark:text-white">Asignar vuelto</h3>
                            <p className="text-[11px] text-slate-400 font-bold">Total del vuelto: ${changeUsd.toFixed(2)} · Bs {formatBs(changeBs)}</p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            aria-label="Cerrar"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="px-4 py-3 space-y-3">
                    {/* 1) Parcial en caja (propina) — paridad con POS */}
                    <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-2xl p-3">
                        <InlineTipToggle
                            isTipDonated={isTipDonated}
                            cashKeptUsd={cashKeptUsd}
                            onToggle={onToggleTip}
                        />

                        {isTipDonated && (
                            <div className="mt-2.5">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400">Parcial en caja</span>
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60">
                                        Máx: ${changeUsd.toFixed(2)}
                                    </span>
                                </div>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-600 dark:text-emerald-400 pointer-events-none select-none">$</span>
                                    <input
                                        type="number"
                                        min="0"
                                        max={changeUsd}
                                        step="0.01"
                                        value={tipAmountUsd}
                                        onChange={e => handleTipAmountChange(e.target.value)}
                                        onFocus={e => e.target.select()}
                                        placeholder="0.00"
                                        aria-label="Monto del vuelto que queda en caja"
                                        className="w-full h-11 py-2 pl-7 pr-16 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleTipAmountChange(changeUsd.toString())}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center rounded-lg text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm active:scale-95 transition-all"
                                    >
                                        Todo
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 2) Cambio físico: $ y Bs con límites cruzados */}
                    <div className="grid grid-cols-2 gap-2.5">
                        <div className="min-w-0">
                            <div className="flex items-center justify-between gap-1 mb-1.5 min-h-[22px]">
                                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400 whitespace-nowrap">Cambio en $</span>
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 whitespace-nowrap">
                                    Queda ${changeRemainder.remainingUsd.toFixed(2)}
                                </span>
                            </div>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-600 dark:text-emerald-400 pointer-events-none select-none">$</span>
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
                                    aria-label="Cambio a entregar en dólares"
                                    className="w-full h-11 py-2 pl-7 pr-16 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => setChangeUsdGiven(maxChangeUsdGiven.toFixed(2))}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center rounded-lg text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm active:scale-95 transition-all"
                                >
                                    Todo
                                </button>
                            </div>
                        </div>

                        <div className="min-w-0">
                            <div className="flex items-center justify-between gap-1 mb-1.5 min-h-[22px]">
                                <span className="text-[10px] font-black uppercase tracking-wider text-blue-800 dark:text-blue-400 whitespace-nowrap">Cambio en Bs</span>
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-blue-100/70 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 whitespace-nowrap">
                                    Queda Bs {formatBs(changeRemainder.remainingBs)}
                                </span>
                            </div>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-blue-600 dark:text-blue-400 pointer-events-none select-none">Bs</span>
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
                                    aria-label="Cambio a entregar en bolívares"
                                    className="w-full h-11 py-2 pl-8 pr-16 rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => setChangeBsGiven(maxChangeBsGiven.toFixed(2))}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center rounded-lg text-[10px] font-black bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95 transition-all"
                                >
                                    Todo
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 3) Acreditar a billetera (explícito) */}
                    <button
                        type="button"
                        disabled={!hasCustomer}
                        onClick={() => setIsChangeCredited(!isChangeCredited)}
                        className={`w-full min-h-[44px] px-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                            isChangeCredited
                                ? 'bg-brand text-white shadow shadow-brand/30'
                                : 'bg-white dark:bg-slate-800 text-brand-dark dark:text-brand border border-brand/30 dark:border-brand/70'
                        } ${!hasCustomer ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        <Wallet size={15} className="shrink-0" />
                        {isChangeCredited ? 'Acreditado a billetera' : 'Acreditar resto a billetera'}
                        {!hasCustomer && <span className="text-[9px] font-bold opacity-70">(requiere cliente)</span>}
                    </button>

                    {/* 4) Estado vivo */}
                    <div
                        role="status"
                        aria-live="polite"
                        className={`px-3 py-2.5 rounded-xl border ${
                            changeRemainder.remainingUsd > 0.001
                                ? 'bg-red-50 dark:bg-red-950/25 border-red-300 dark:border-red-800/60'
                                : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                        }`}
                    >
                        <div className="flex items-start gap-2.5">
                            <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                                changeRemainder.remainingUsd > 0.001
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            }`}>
                                {changeRemainder.remainingUsd > 0.001 ? <AlertTriangle size={14} strokeWidth={2.5} /> : <CheckCircle size={14} strokeWidth={2.5} />}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className={`text-[11px] font-black uppercase tracking-wide leading-tight ${
                                    changeRemainder.remainingUsd > 0.001 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'
                                }`}>
                                    {isChangeCredited ? 'Se acreditará a billetera' : changeRemainder.remainingUsd > 0.001 ? 'Vuelto pendiente' : 'Vuelto asignado'}
                                </p>
                                <div className={`mt-1 grid grid-cols-2 divide-x ${changeRemainder.remainingUsd > 0.001 ? 'divide-red-200 dark:divide-red-800/60' : 'divide-emerald-200 dark:divide-emerald-800/40'}`}>
                                    <div className="min-w-0 pr-3">
                                        <span className="block text-[9px] font-black uppercase tracking-wide text-slate-400">Dólares</span>
                                        <strong className={`block mt-0.5 text-xl leading-none font-black ${changeRemainder.remainingUsd > 0.001 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                                            ${changeRemainder.remainingUsd.toFixed(2)}
                                        </strong>
                                    </div>
                                    <div className="min-w-0 pl-3">
                                        <span className="block text-[9px] font-black uppercase tracking-wide text-slate-400">Bolívares</span>
                                        <strong className={`block mt-0.5 text-sm leading-tight font-black break-words ${changeRemainder.remainingUsd > 0.001 ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
                                            Bs {formatBs(changeRemainder.remainingBs)}
                                        </strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 5) Aviso de fondo de caja */}
                    {exceedsFloat && (
                        <div className="p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 flex items-start gap-1.5">
                            <AlertTriangle size={12} className="text-orange-500 shrink-0 mt-0.5" />
                            <p className="text-[10px] font-bold text-orange-700 dark:text-orange-400 leading-tight">
                                El cambio declarado excede el fondo de caja disponible.
                            </p>
                        </div>
                    )}

                    {/* CTA del sheet */}
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={sheetIncomplete}
                        className={`w-full min-h-[48px] rounded-2xl font-black text-sm transition-all active:scale-[0.98] ${
                            sheetIncomplete
                                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                : 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                        }`}
                    >
                        {sheetIncomplete
                            ? `Falta $${changeRemainder.remainingUsd.toFixed(2)} por asignar`
                            : 'Listo'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Sub-bloque: toggle de propina del sheet (recibe onToggle del modal)
function InlineTipToggle({ isTipDonated, cashKeptUsd, onToggle }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`w-full min-h-[44px] px-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                isTipDonated
                    ? 'bg-emerald-600 text-white shadow shadow-emerald-500/30'
                    : 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
            }`}
        >
            <HandCoins size={15} className="shrink-0" />
            <span className="truncate">
                {isTipDonated ? `En caja: $${cashKeptUsd.toFixed(2)}` : 'El cliente deja el vuelto (en caja)'}
            </span>
            {isTipDonated && <CheckCircle size={14} className="text-white shrink-0" />}
        </button>
    );
}
