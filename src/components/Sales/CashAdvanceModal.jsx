import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Wallet, ArrowRightLeft } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';

export default function CashAdvanceModal({
    onClose,
    onConfirm,
    effectiveRate,
    paymentMethods = [],
    defaultCommissionPct = 10,
    copEnabled = false,
    tasaCop = 0,
    triggerHaptic
}) {
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('BS');
    const [commissionPct, setCommissionPct] = useState(defaultCommissionPct.toString());
    const inputRef = useRef(null);

    useEffect(() => {
        // Auto-focus on amount input
        setTimeout(() => inputRef.current?.focus(), 150);
    }, [paymentMethods]);

    const handleAmountChange = (e) => {
        let v = e.target.value.replace(',', '.');
        if (!/^[0-9.]*$/.test(v)) return;
        const dots = v.match(/\./g);
        if (dots && dots.length > 1) return;
        setAmount(v);
    };

    const handlePctChange = (e) => {
        let v = e.target.value;
        if (!/^[0-9]*$/.test(v)) return;
        setCommissionPct(v);
    };

    const parsedAmount = parseFloat(amount) || 0;
    const parsedPct = parseFloat(commissionPct) || 0;
    const calculatedCommission = parseFloat(((parsedAmount * parsedPct) / 100).toFixed(2));
    const totalToCharge = parseFloat((parsedAmount + calculatedCommission).toFixed(2));

    const isValid = parsedAmount > 0 && parsedPct >= 0;

    const handleConfirmClick = () => {
        if (!isValid) return;
        triggerHaptic?.();
        onConfirm({
            montoEfectivo: parsedAmount,
            currency,
            comisionPct: parsedPct,
            montoComision: calculatedCommission,
            totalCobrado: totalToCharge
        });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirmClick();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800">
                
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
                            <ArrowRightLeft size={18} />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-slate-800 dark:text-white">Avance de Efectivo</h2>
                            <p className="text-[10px] font-bold text-slate-400">Venta de efectivo con porcentaje de comisión</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">

                    {/* Amount Input */}
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1">
                            Monto a entregar al cliente
                        </label>
                        <div className="relative">
                            <input
                                ref={inputRef}
                                type="text"
                                inputMode="decimal"
                                value={amount}
                                onChange={handleAmountChange}
                                onKeyDown={handleKeyDown}
                                placeholder="0.00"
                                className="w-full py-3.5 px-4 text-center text-3xl font-black bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-800 rounded-2xl text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-850 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
                            />
                            <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-sm font-black px-2.5 py-1 rounded-lg ${
                                currency === 'BS' ? 'text-brand bg-brand-light dark:bg-surface-800/40' : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/40'
                            }`}>
                                {currency === 'BS' ? 'Bs' : '$'}
                            </span>
                        </div>
                    </div>

                    {/* Commission % Input */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1">
                                Comisión (%)
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={commissionPct}
                                    onChange={handlePctChange}
                                    onKeyDown={handleKeyDown}
                                    placeholder="10"
                                    className="w-full py-2.5 px-3 text-center text-lg font-bold bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-800 rounded-xl text-slate-800 dark:text-white outline-none focus:border-brand transition-all"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1">
                                Recargo Calculado
                            </label>
                            <div className="w-full py-2.5 px-3 text-center text-lg font-black bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/40 rounded-xl text-amber-600 dark:text-amber-400 font-mono">
                                {currency === 'BS' ? `${formatBs(calculatedCommission)} Bs` : `$${calculatedCommission.toFixed(2)}`}
                            </div>
                        </div>
                    </div>



                    {/* Transaction breakdown summary card */}
                    {parsedAmount > 0 && (
                        <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/15 p-3 rounded-2xl space-y-2 text-xs animate-in fade-in slide-in-from-top-1">
                            <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                                <span>Entregarás en Efectivo:</span>
                                <strong className="font-bold text-slate-800 dark:text-white">
                                    {currency === 'BS' ? `${formatBs(parsedAmount)} Bs` : `$${parsedAmount.toFixed(2)}`}
                                </strong>
                            </div>
                            <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                                <span>Comisión ganada ({parsedPct}%):</span>
                                <strong className="font-black text-emerald-600 dark:text-emerald-400">
                                    {currency === 'BS' ? `+${formatBs(calculatedCommission)} Bs` : `+$${calculatedCommission.toFixed(2)}`}
                                </strong>
                            </div>
                            <div className="flex justify-between items-center border-t border-slate-200/50 dark:border-slate-800/50 pt-2 text-sm">
                                <span className="font-bold text-slate-700 dark:text-slate-350">Cobrarás al cliente:</span>
                                <strong className="text-lg font-black text-brand">
                                    {currency === 'BS' ? `${formatBs(totalToCharge)} Bs` : `$${totalToCharge.toFixed(2)}`}
                                </strong>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3 text-center text-xs font-black text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 hover:bg-slate-50 rounded-xl transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirmClick}
                        disabled={!isValid}
                        className={`flex-1 py-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all ${
                            isValid 
                            ? 'bg-brand text-white shadow-lg shadow-brand/20 active:scale-[0.98]' 
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        <Check size={14} />
                        Confirmar Avance
                    </button>
                </div>
            </div>
        </div>
    );
}
