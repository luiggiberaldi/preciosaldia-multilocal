import React, { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';

export default function CustomAmountModal({
    onClose,
    onConfirm,
    effectiveRate,
    triggerHaptic
}) {
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('BS');
    const inputRef = useRef(null);

    const copEnabled = localStorage.getItem('cop_enabled') === 'true';
    const tasaCop = parseFloat(localStorage.getItem('tasa_cop')) || 4150;

    useEffect(() => {
        // Auto-focus on mount
        setTimeout(() => inputRef.current?.focus(), 100);
    }, []);

    const handleChange = (e) => {
        let v = e.target.value.replace(',', '.');
        if (!/^[0-9.]*$/.test(v)) return;
        const dots = v.match(/\./g);
        if (dots && dots.length > 1) return;
        setAmount(v);
    };

    const handleConfirm = () => {
        const value = parseFloat(amount);
        if (value > 0) {
            triggerHaptic && triggerHaptic();
            onConfirm(value, currency);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
        }
    };

    const parsedValue = parseFloat(amount) || 0;
    
    let equivUsd = 0;
    if (currency === 'USD') equivUsd = parsedValue;
    else if (currency === 'COP') equivUsd = parsedValue / tasaCop;
    else equivUsd = parsedValue / effectiveRate;

    equivUsd = equivUsd.toFixed(2);
    const isValid = parsedValue > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[24px] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800">
                
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        <h2 className="text-lg font-black text-slate-800 dark:text-white">Monto Libre</h2>
                        <p className="text-xs font-bold text-slate-400">Venta rápida sin inventario</p>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5">
                    <div className="mb-4">
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3 text-center">
                            Moneda e Importe
                        </label>

                        {/* Currency Toggle */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-4">
                            <button
                                onClick={() => { setCurrency('BS'); inputRef.current?.focus(); }}
                                className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${
                                    currency === 'BS' ? 'bg-brand-dark text-white shadow-md' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                            >
                                Bs
                            </button>
                            <button
                                onClick={() => { setCurrency('USD'); inputRef.current?.focus(); }}
                                className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${
                                    currency === 'USD' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                            >
                                USD
                            </button>
                            {copEnabled && (
                                <button
                                    onClick={() => { setCurrency('COP'); inputRef.current?.focus(); }}
                                    className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${
                                        currency === 'COP' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                                >
                                    COP
                                </button>
                            )}
                        </div>

                        <div className="relative">
                            <input
                                ref={inputRef}
                                type="text"
                                inputMode="decimal"
                                value={amount}
                                onChange={handleChange}
                                onKeyDown={handleKeyDown}
                                placeholder="0.00"
                                className="w-full py-4 px-4 pr-16 text-center text-4xl font-black bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-800 rounded-2xl text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all"
                            />
                            <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-sm font-black px-2 py-1 rounded-lg ${
                                currency === 'BS' ? 'text-brand-dark bg-brand-light dark:bg-surface-800/40' :
                                currency === 'USD' ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/40' :
                                'text-amber-600 bg-amber-50 dark:bg-amber-900/40'
                            }`}>
                                {currency === 'BS' ? 'Bs' : currency === 'USD' ? '$' : 'COP'}
                            </span>
                        </div>
                        {parsedValue > 0 && currency !== 'USD' && (
                            <div className="mt-3 text-center animate-in fade-in slide-in-from-top-1">
                                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1.5 rounded-xl border border-emerald-100 dark:border-emerald-800">
                                    ≈ ${equivUsd} USD
                                </span>
                            </div>
                        )}
                        {parsedValue > 0 && currency === 'USD' && (
                            <div className="mt-3 text-center animate-in fade-in slide-in-from-top-1">
                                <span className="text-sm font-bold text-brand-dark dark:text-brand bg-brand-light dark:bg-surface-800/30 px-3 py-1.5 rounded-xl border border-surface-200 dark:border-surface-700">
                                    ≈ {formatBs(parsedValue * effectiveRate)} Bs
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800">
                    <button
                        onClick={handleConfirm}
                        disabled={!isValid}
                        className={`w-full py-4 rounded-xl font-black text-base flex items-center justify-center gap-2 transition-all ${
                            isValid 
                            ? 'bg-brand-dark hover:bg-brand-dark text-white shadow-lg shadow-primary/30 active:scale-[0.98]' 
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        <Check size={20} />
                        Agregar a la Venta
                    </button>
                </div>
            </div>
        </div>
    );
}
