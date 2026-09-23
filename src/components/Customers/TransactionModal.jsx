import React from 'react';
import { X, ArrowDownRight, ArrowUpRight, CheckCircle2, Save } from 'lucide-react';
import { procesarImpactoCliente } from '../../utils/financialLogic';
import { formatUsd, formatBs, formatCop } from '../../utils/calculatorUtils';
import CustomSelect from '../CustomSelect';
import { getPaymentIcon } from '../../config/paymentMethods';

export default function TransactionModal({
    transactionModal,
    setTransactionModal,
    transactionAmount,
    setTransactionAmount,
    currencyMode,
    setCurrencyMode,
    paymentMethod,
    setPaymentMethod,
    activePaymentMethods,
    bcvRate,
    tasaCop,
    copEnabled,
    copPrimary,
    handleTransaction
}) {
    if (!transactionModal.isOpen || !transactionModal.customer) return null;

    // Calcular preview del saldo resultante en tiempo real
    const rawAmt = parseFloat(transactionAmount) || 0;
    let amtUsd = rawAmt;
    if (currencyMode === 'BS' && bcvRate > 0) amtUsd = rawAmt / bcvRate;
    if (currencyMode === 'COP' && tasaCop > 0) amtUsd = rawAmt / tasaCop;
    const currentCustomer = transactionModal.customer;

    let previewCustomer = null;
    if (rawAmt > 0) {
        const opts = transactionModal.type === 'ABONO'
            ? { costoTotal: 0, pagoReal: amtUsd, vueltoParaMonedero: amtUsd }
            : { esCredito: true, deudaGenerada: amtUsd };
        previewCustomer = procesarImpactoCliente(currentCustomer, opts);
    }

    // Saldo actual legible
    const saldoActualUsd = (currentCustomer.favor || 0) - (currentCustomer.deuda || 0);
    const saldoPreviewUsd = previewCustomer ? (previewCustomer.favor || 0) - (previewCustomer.deuda || 0) : saldoActualUsd;
    const excedenteAbonoUsd = transactionModal.type === 'ABONO'
        ? Math.max(0, amtUsd - (Number(currentCustomer.deuda) || 0))
        : 0;

    const formatSaldo = (val) => {
        const isCopP = copEnabled && copPrimary && tasaCop > 0;
        if (val > 0.001) return { text: isCopP ? `+${formatCop(val * tasaCop)} COP` : `+$${formatUsd(val)}`, label: 'a favor', color: isCopP ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/30' };
        if (val < -0.001) return { text: isCopP ? `-${formatCop(Math.abs(val) * tasaCop)} COP` : `-$${formatUsd(Math.abs(val))}`, label: 'debe', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/30' };
        return { text: isCopP ? '0 COP' : '$0.00', label: 'al dia', color: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' };
    };

    const saldoActual = formatSaldo(saldoActualUsd);
    const saldoPreview = formatSaldo(saldoPreviewUsd);

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="text-xl font-black text-slate-800 dark:text-white">Ajustar Cuenta</h3>
                    <button onClick={() => setTransactionModal({ isOpen: false, type: null, customer: null })} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Cliente + Saldo Actual */}
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            <strong className="text-slate-900 dark:text-white">{currentCustomer.name}</strong>
                        </p>
                        <span className={`text-sm font-black ${saldoActual.color}`}>{saldoActual.text} <span className="text-[10px] font-bold opacity-70">({saldoActual.label})</span></span>
                    </div>

                    {/* Tipo de operacion */}
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button
                            type="button"
                            onClick={() => { setTransactionModal(m => ({ ...m, type: 'CREDITO' })); setTransactionAmount(''); }}
                            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${transactionModal.type === 'CREDITO' ? 'bg-white dark:bg-slate-900 shadow-sm text-red-500' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <ArrowDownRight size={16} /> Agregar Deuda
                        </button>
                        <button
                            type="button"
                            onClick={() => { setTransactionModal(m => ({ ...m, type: 'ABONO' })); setTransactionAmount(''); }}
                            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${transactionModal.type === 'ABONO' ? 'bg-white dark:bg-slate-900 shadow-sm text-emerald-500' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <ArrowUpRight size={16} /> Recibir Abono
                        </button>
                    </div>

                    {/* Moneda */}
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button
                            type="button"
                            onClick={() => { setCurrencyMode('USD'); setTransactionAmount(''); setPaymentMethod('efectivo_usd'); }}
                            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${currencyMode === 'USD' ? 'bg-white dark:bg-slate-900 shadow-sm text-emerald-500' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            USD
                        </button>
                        <button
                            type="button"
                            onClick={() => { setCurrencyMode('BS'); setTransactionAmount(''); setPaymentMethod('efectivo_bs'); }}
                            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${currencyMode === 'BS' ? 'bg-white dark:bg-slate-900 shadow-sm text-brand' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            Bs
                        </button>
                        {copEnabled && (
                            <button
                                type="button"
                                onClick={() => { setCurrencyMode('COP'); setTransactionAmount(''); setPaymentMethod('efectivo_cop'); }}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${currencyMode === 'COP' ? 'bg-white dark:bg-slate-900 shadow-sm text-amber-500' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                COP
                            </button>
                        )}
                    </div>

                    {/* Input de monto */}
                    <div>
                        <div className="relative">
                            <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg ${currencyMode === 'BS' ? 'text-brand' : 'text-emerald-500'}`}>
                                {currencyMode === 'BS' ? 'Bs' : '$'}
                            </span>
                            <input
                                type="number"
                                value={transactionAmount}
                                onChange={(e) => setTransactionAmount(e.target.value)}
                                placeholder="0.00"
                                className={`w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-4 ${currencyMode === 'BS' ? 'pl-12' : 'pl-10'} text-2xl font-black text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all`}
                                autoFocus
                            />
                        </div>
                        {/* Boton Pagar Total — solo cuando hay deuda y es ABONO */}
                        {transactionModal.type === 'ABONO' && (currentCustomer.deuda || 0) > 0.01 && (
                            <button
                                type="button"
                                onClick={() => {
                                    const deudaUsd = currentCustomer.deuda;
                                    if (currencyMode === 'BS' && bcvRate > 0) {
                                        setTransactionAmount((deudaUsd * bcvRate).toFixed(2));
                                    } else if (currencyMode === 'COP' && tasaCop > 0) {
                                        setTransactionAmount((deudaUsd * tasaCop).toFixed(2));
                                    } else {
                                        setTransactionAmount(deudaUsd.toFixed(2));
                                    }
                                }}
                                className="mt-2 w-full py-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                                <CheckCircle2 size={14} />
                                Pagar Total: {currencyMode === 'BS' && bcvRate > 0
                                    ? `Bs ${formatBs(currentCustomer.deuda * bcvRate)}`
                                    : currencyMode === 'COP' && tasaCop > 0
                                    ? `${formatBs(currentCustomer.deuda * tasaCop)} COP`
                                    : `USD ${formatUsd(currentCustomer.deuda)}`
                                }
                            </button>
                        )}
                        {/* Conversion info */}
                        {currencyMode === 'BS' && transactionAmount && bcvRate > 0 && (
                            <div className="bg-brand-light/50 dark:bg-surface-800/10 border border-surface-200 dark:border-surface-800/30 rounded-lg p-2 mt-3 flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">Equivale a:</span>
                                <span className="text-sm font-black text-brand-dark dark:text-brand">
                                    ${(parseFloat(transactionAmount) / bcvRate).toFixed(2)} USD
                                </span>
                            </div>
                        )}
                        {currencyMode === 'USD' && transactionAmount && bcvRate > 0 && (
                            <div className="bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-lg p-2 mt-3 flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">Equivale a:</span>
                                <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                                    {formatBs(parseFloat(transactionAmount) * bcvRate)} Bs
                                    {copEnabled && tasaCop > 0 && ` · ${formatCop(parseFloat(transactionAmount) * tasaCop)} COP`}
                                </span>
                            </div>
                        )}
                        {currencyMode === 'COP' && transactionAmount && tasaCop > 0 && (
                            <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-lg p-2 mt-3 flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-500">Equivale a:</span>
                                    <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                                        ${(parseFloat(transactionAmount) / tasaCop).toFixed(2)} USD
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-500">Ref local:</span>
                                    <span className="text-xs font-black text-brand-dark dark:text-brand">
                                        {formatBs((parseFloat(transactionAmount) / tasaCop) * bcvRate)} Bs
                                    </span>
                                </div>
                            </div>
                        )}
                        <p className="text-[10px] font-medium text-slate-400 mt-2 text-center flex items-center justify-center gap-2">
                            <span>Tasa BCV: {formatBs(bcvRate)} Bs/$</span>
                            {copEnabled && <span>• Tasa COP: {formatBs(tasaCop)} COP/$</span>}
                        </p>
                        {excedenteAbonoUsd > 0.01 && (
                            <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800/30 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-center text-[11px] font-bold text-amber-700 dark:text-amber-300">
                                El abono supera la deuda actual. Se aplican <strong>${formatUsd(amtUsd - excedenteAbonoUsd)}</strong> a la deuda y el sobrante de <strong>${formatUsd(excedenteAbonoUsd)}</strong> quedará como saldo a favor del cliente.
                            </div>
                        )}
                    </div>

                    {/* Metodo de pago (solo para abonos) */}
                    {transactionModal.type === 'ABONO' && (() => {
                        const filteredMethods = activePaymentMethods.filter(m => m.currency === currencyMode);
                        return (
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Metodo de Pago</label>
                            <CustomSelect
                                value={filteredMethods.some(m => m.id === paymentMethod) ? paymentMethod : (filteredMethods[0]?.id || '')}
                                onChange={setPaymentMethod}
                                openUp={true}
                                options={filteredMethods.map(method => {
                                    const IconComponent = getPaymentIcon(method.id);
                                    let iconColor = "text-slate-500 dark:text-slate-400";
                                    
                                    if (method.id.includes('bs')) iconColor = "text-emerald-600 dark:text-emerald-400";
                                    else if (method.id.includes('usd') || method.id.includes('zelle')) iconColor = "text-emerald-500 dark:text-emerald-400";
                                    else if (method.id.includes('cop')) iconColor = "text-amber-500 dark:text-amber-400";
                                    else if (method.id.includes('punto')) iconColor = "text-blue-500 dark:text-blue-400";
                                    else if (method.id.includes('movil')) iconColor = "text-purple-500 dark:text-purple-400";

                                    return {
                                        value: method.id,
                                        label: method.label,
                                        icon: IconComponent ? <IconComponent size={15} className={iconColor} /> : null
                                    };
                                })}
                            />
                        </div>
                        );
                    })()}

                    {/* PREVIEW del saldo resultante */}
                    {rawAmt > 0 && previewCustomer && (
                        <div className={`border rounded-xl p-3 ${saldoPreview.bg} transition-all`}>
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Cuenta despues de esta operacion</p>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400 line-through">{saldoActual.text}</span>
                                    <span className="text-slate-300 dark:text-slate-600">→</span>
                                </div>
                                <span className={`text-lg font-black ${saldoPreview.color}`}>
                                    {saldoPreview.text}
                                </span>
                            </div>
                            {bcvRate > 0 && (
                                <p className="text-[10px] font-bold text-slate-400 mt-1 text-right">
                                    {copEnabled && copPrimary && tasaCop > 0
                                        ? <>{saldoPreviewUsd >= 0 ? '+' : '-'}${formatUsd(Math.abs(saldoPreviewUsd))} · {formatBs(Math.abs(saldoPreviewUsd) * bcvRate)} Bs</>
                                        : <>{saldoPreviewUsd >= 0 ? '+' : '-'}{formatBs(Math.abs(saldoPreviewUsd) * bcvRate)} Bs
                                    {copEnabled && tasaCop > 0 && ` · ${formatCop(Math.abs(saldoPreviewUsd) * tasaCop)} COP`}</>}
                                </p>
                            )}
                        </div>
                    )}

                </div>

                <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 rounded-b-3xl">
                    <button
                        onClick={handleTransaction}
                        disabled={!transactionAmount || parseFloat(transactionAmount) <= 0}
                        className={`w-full py-3.5 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 ${transactionModal.type === 'ABONO'
                            ? 'bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50'
                            : 'bg-red-500 hover:bg-red-600 disabled:bg-red-500/50'
                            }`}
                    >
                        <Save size={18} />
                        {transactionModal.type === 'ABONO'
                            ? `Abonar ${currencyMode === 'BS' ? 'Bs' : currencyMode === 'COP' ? 'COP' : '$'}${transactionAmount || '0.00'}`
                            : `Cargar Deuda ${currencyMode === 'BS' ? 'Bs' : currencyMode === 'COP' ? 'COP' : '$'}${transactionAmount || '0.00'}`
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
