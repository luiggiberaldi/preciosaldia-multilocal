import React, { useState, useEffect, useRef } from 'react';
import { X, Percent, DollarSign, Calculator } from 'lucide-react';
import { formatCop, formatBs } from '../../utils/calculatorUtils';
import { round2, mulR } from '../../utils/dinero';

export default function DiscountModal({
    currentDiscount,
    onApply,
    onClose,
    cartSubtotalUsd,
    effectiveRate,
    tasaCop,
    copEnabled,
    copPrimary
}) {
    const [type, setType] = useState(currentDiscount?.type || 'percentage');
    const [value, setValue] = useState(currentDiscount?.value ? currentDiscount.value.toString() : '');
    const inputRef = useRef(null);

    useEffect(() => {
        // Auto focus input on mount for fast typing
        // Small delay ensures modal transition is done
        const id = setTimeout(() => inputRef.current?.focus(), 150);
        return () => clearTimeout(id);
    }, []);

    const numValue = parseFloat(value) || 0;

    // Calculate real preview
    let discountAmountUsd = 0;
    if (type === 'percentage') {
        // FIN-016-pattern: mulR + round2 para preview consistente con FinancialEngine.
        discountAmountUsd = mulR(cartSubtotalUsd, round2(numValue / 100));
    } else {
        discountAmountUsd = round2(numValue);
    }

    // Prevent exceeding subtotal
    if (discountAmountUsd > cartSubtotalUsd) {
        discountAmountUsd = cartSubtotalUsd;
    }

    const newTotalUsd = round2(cartSubtotalUsd - discountAmountUsd);
    // FIN-016-pattern: mulR para conversión a Bs.
    const newTotalBs = mulR(newTotalUsd, effectiveRate);

    // FIN-031: `formatBs` antes estaba shadowed localmente, pisando el import.
    //   Usamos directamente el import de calculatorUtils (mismo Intl.NumberFormat).

    const handleSubmit = (e) => {
        e.preventDefault();
        onApply({ type, value: numValue });
    };

    const handleClear = () => {
        onApply({ type: 'percentage', value: 0 });
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 w-full max-w-sm mx-4 sm:mx-6 md:mx-auto rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                    <h3 className="font-black text-slate-800 dark:text-white text-lg flex items-center gap-2">
                        <Calculator size={20} className="text-brand" />
                        Descuento
                    </h3>
                    <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors active:scale-95">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-4 sm:p-5 flex flex-col gap-5">
                    
                    {/* Toggle Type */}
                    <div className="flex bg-slate-100 dark:bg-slate-950 p-1.5 rounded-2xl shadow-inner">
                        <button
                            type="button"
                            onClick={() => { setType('percentage'); setValue(''); inputRef.current?.focus(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${type === 'percentage' ? 'bg-white dark:bg-slate-900 shadow-sm text-brand-dark dark:text-brand scale-100 ring-1 ring-slate-900/5 dark:ring-white/10' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 scale-95 hover:scale-100'}`}
                        >
                            <Percent size={16} /> Porcentaje
                        </button>
                        <button
                            type="button"
                            onClick={() => { setType('fixed'); setValue(''); inputRef.current?.focus(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${type === 'fixed' ? 'bg-white dark:bg-slate-900 shadow-sm text-emerald-600 dark:text-emerald-400 scale-100 ring-1 ring-slate-900/5 dark:ring-white/10' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 scale-95 hover:scale-100'}`}
                        >
                            <DollarSign size={16} /> Monto (USD)
                        </button>
                    </div>

                    {/* Input Area */}
                    <div>
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                                {type === 'percentage' ? (
                                    <Percent size={20} className="text-slate-400 group-focus-within:text-brand transition-colors" />
                                ) : (
                                    <DollarSign size={20} className="text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                                )}
                            </div>
                            <input
                                ref={inputRef}
                                type="number"
                                inputMode="decimal"
                                step="any"
                                min="0"
                                value={value}
                                onChange={(e) => {
                                    // Limite heurístico
                                    let val = e.target.value;
                                    if (type === 'percentage' && parseFloat(val) > 100) val = '100';
                                    setValue(val);
                                }}
                                className="w-full bg-white dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-2xl font-black text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:outline-none focus:ring-4 focus:ring-brand/20 focus:border-brand transition-all text-center"
                                placeholder={type === 'percentage' ? "0%" : "0.00"}
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Preview Area */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 font-medium">Subtotal:</span>
                            <span className="text-slate-700 dark:text-slate-300 font-bold">
                                {copEnabled && copPrimary && tasaCop > 0
                                    ? `${formatCop(cartSubtotalUsd * tasaCop)} COP · $${cartSubtotalUsd.toFixed(2)}`
                                    : copEnabled && tasaCop > 0
                                    ? `$${cartSubtotalUsd.toFixed(2)} · ${formatCop(cartSubtotalUsd * tasaCop)} COP`
                                    : `$${cartSubtotalUsd.toFixed(2)}`}
                            </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-red-500 font-medium tracking-tight">Descuento aplicado:</span>
                            <span className="text-red-500 font-black">
                                -{copEnabled && copPrimary && tasaCop > 0
                                    ? `${formatCop(discountAmountUsd * tasaCop)} COP / $${discountAmountUsd.toFixed(2)}`
                                    : copEnabled && tasaCop > 0
                                    ? `$${discountAmountUsd.toFixed(2)} / ${formatCop(discountAmountUsd * tasaCop)} COP`
                                    : `$${discountAmountUsd.toFixed(2)}`}
                            </span>
                        </div>
                        <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-end">
                            <span className="text-sm font-bold text-slate-600 dark:text-slate-400">Total Final:</span>
                            <div className="text-right">
                                {copEnabled && copPrimary && tasaCop > 0 ? (
                                    <>
                                        <span className="text-xl font-black text-amber-600 dark:text-amber-400 leading-none block">
                                            {formatCop(newTotalUsd * tasaCop)} COP
                                        </span>
                                        <span className="text-xs font-bold text-slate-400 block">${newTotalUsd.toFixed(2)}</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 leading-none block">
                                            ${newTotalUsd.toFixed(2)}
                                        </span>
                                        {copEnabled && tasaCop > 0 && (
                                            <span className="text-[10px] font-bold text-slate-400 block">{formatCop(newTotalUsd * tasaCop)} COP</span>
                                        )}
                                    </>
                                )}
                                <span className="text-xs font-bold text-slate-400">Bs {formatBs(newTotalBs)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClear}
                            className="py-3.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl active:scale-95 transition-all outline-none"
                        >
                            Quitar
                        </button>
                        <button
                            type="submit"
                            className="py-3.5 bg-brand hover:bg-brand-dark text-white font-bold rounded-xl active:scale-95 transition-all outline-none shadow-lg shadow-primary/30"
                        >
                            Aplicar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
