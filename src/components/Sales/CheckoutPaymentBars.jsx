import React, { useEffect, useState } from 'react';
import { Zap, Wallet, DollarSign, Banknote, Coins } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { PAYMENT_ICONS, ICON_COMPONENTS } from '../../config/paymentMethods';

const SECTION_STYLES = {
    USD: {
        bg: 'bg-emerald-50/50 dark:bg-emerald-950/20',
        border: 'border-emerald-100 dark:border-emerald-900/50',
        title: 'text-emerald-800 dark:text-emerald-300',
        titleBg: 'bg-emerald-100 dark:bg-emerald-900/50',
        inputBorder: 'border-emerald-200 dark:border-emerald-800 focus:border-emerald-500 focus:ring-emerald-500/20',
        inputActive: 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
        btnBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-300 hover:bg-emerald-200 active:bg-emerald-300',
    },
    BS: {
        bg: 'bg-brand-light/50 dark:bg-surface-950/20',
        border: 'border-surface-200 dark:border-surface-800/50',
        title: 'text-surface-800 dark:text-brand',
        titleBg: 'bg-brand-light dark:bg-surface-800/50',
        inputBorder: 'border-surface-300 dark:border-surface-700 focus:border-brand focus:ring-brand/20',
        inputActive: 'border-brand dark:border-brand-dark bg-brand-light dark:bg-surface-950/30',
        btnBg: 'bg-brand-light dark:bg-surface-800/40 text-brand-dark dark:text-brand hover:bg-brand-light active:bg-brand-light',
    },
    COP: {
        bg: 'bg-amber-50/50 dark:bg-amber-950/20',
        border: 'border-amber-100 dark:border-amber-900/50',
        title: 'text-amber-800 dark:text-amber-300',
        titleBg: 'bg-amber-100 dark:bg-amber-900/50',
        inputBorder: 'border-amber-200 dark:border-amber-800 focus:border-amber-500 focus:ring-amber-500/20',
        inputActive: 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30',
        btnBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 active:bg-amber-300',
    },
};

function PaymentBar({ method, styles, barValues, effectiveRate, tasaCop, onBarChange, onFillBar, saldoFavorDisponible = 0 }) {
    const val = barValues[method.id] || '';
    const hasValue = parseFloat(val) > 0;
    const equivUsd = method.currency === 'BS' && hasValue
        ? (parseFloat(val) / effectiveRate).toFixed(2)
        : method.currency === 'COP' && hasValue
        ? (parseFloat(val) / tasaCop).toFixed(2)
        : null;

    const MIcon = method.Icon || PAYMENT_ICONS[method.id] || ICON_COMPONENTS[method.icon];

    return (
        <div className="mb-3 last:mb-0">
            <div className="flex items-center gap-2 mb-1 ml-0.5">
                {MIcon ? <MIcon size={16} className={hasValue ? '' : 'text-slate-400'} /> : <span className="text-base">{method.icon}</span>}
                <span className={`text-[11px] font-bold uppercase tracking-wide ${hasValue ? styles.title : 'text-slate-500 dark:text-slate-400'}`}>
                    {method.label}
                </span>
                {method.isInternalCredit && (
                    <span className="ml-auto text-[10px] font-black text-emerald-600 dark:text-emerald-400">
                        Disponible: ${Number(saldoFavorDisponible || 0).toFixed(2)}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <input
                        type="text"
                        inputMode="decimal"
                        value={val}
                        onChange={e => onBarChange(method.id, e.target.value)}
                        placeholder="0.00"
                        className={`w-full py-3 px-4 pr-14 rounded-xl border-2 text-lg font-bold outline-none transition-all ${hasValue
                            ? styles.inputActive
                            : `bg-white dark:bg-slate-900 ${styles.inputBorder}`
                            } text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:ring-4`}
                    />
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black px-2 py-0.5 rounded-md border ${hasValue
                        ? `${styles.titleBg} ${styles.title} ${styles.border}`
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                        }`}>
                        {method.currency === 'USD' ? 'USD' : method.currency === 'COP' ? 'COP' : 'Bs'}
                    </span>
                </div>
                <button
                    onClick={() => onFillBar(method.id, method.currency)}
                    className={`shrink-0 py-2.5 min-h-11 px-3.5 rounded-xl font-black text-xs transition-all active:scale-95 flex items-center gap-1 ${styles.btnBg}`}
                >
                    <Zap size={14} fill="currentColor" /> Total
                </button>
            </div>
            {equivUsd && (
                <p className="text-[11px] font-bold text-brand dark:text-brand mt-1 ml-1">
                    ≈ USD {equivUsd}
                </p>
            )}
        </div>
    );
}

export default function CheckoutPaymentBars({
    paymentMethods,
    barValues,
    effectiveRate,
    tasaCop,
    copEnabled,
    onBarChange,
    onFillBar,
    saldoFavorDisponible = 0,
    showSaldoFavor = true,
}) {
    const methodsInternal = paymentMethods.filter(m => m.currency === 'INTERNAL_CREDIT');
    const methodsUsd = paymentMethods.filter(m => m.currency === 'USD');
    const methodsBs = paymentMethods.filter(m => m.currency === 'BS');
    const methodsCop = paymentMethods.filter(m => m.currency === 'COP');
    const availableCurrencies = [
        methodsUsd.length > 0 && 'USD',
        methodsBs.length > 0 && 'BS',
        copEnabled && methodsCop.length > 0 && 'COP',
    ].filter(Boolean);
    const [mobileCurrency, setMobileCurrency] = useState(availableCurrencies[0] || 'USD');

    useEffect(() => {
        if (availableCurrencies.length > 0 && !availableCurrencies.includes(mobileCurrency)) {
            setMobileCurrency(availableCurrencies[0]);
        }
    }, [mobileCurrency, methodsUsd.length, methodsBs.length, methodsCop.length, copEnabled]);

    const barProps = { barValues, effectiveRate, tasaCop, onBarChange, onFillBar, saldoFavorDisponible };
    const mobileMethods = mobileCurrency === 'USD' ? methodsUsd : mobileCurrency === 'BS' ? methodsBs : methodsCop;
    const mobileStyles = SECTION_STYLES[mobileCurrency] || SECTION_STYLES.USD;
    const mobileTitle = mobileCurrency === 'USD' ? 'Dólares ($)' : mobileCurrency === 'BS' ? 'Bolívares (Bs)' : 'Pesos (COP)';
    const MobileIcon = mobileCurrency === 'USD' ? DollarSign : mobileCurrency === 'BS' ? Banknote : Coins;

    return (
        <>
            {/* Crédito interno: no se mezcla con USD recibido */}
            {methodsInternal.length > 0 && saldoFavorDisponible > 0.01 && showSaldoFavor && (
                <div className="mx-3 mb-3 rounded-2xl border bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50 p-3">
                    <h3 className="text-[11px] font-black uppercase tracking-widest mb-3 flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                        <span className="p-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/50"><Wallet size={14} strokeWidth={2.5} /></span>
                        Crédito interno
                    </h3>
                    {methodsInternal.map(m => <PaymentBar key={m.id} method={m} styles={SECTION_STYLES.USD} {...barProps} />)}
                </div>
            )}

            {/* Vista móvil: una sola moneda expandida a la vez. */}
            <div className="sm:hidden mx-3 mb-3">
                <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Moneda del pago">
                    {availableCurrencies.map(currency => (
                        <button
                            key={currency}
                            type="button"
                            role="tab"
                            aria-selected={mobileCurrency === currency}
                            onClick={() => setMobileCurrency(currency)}
                            className={`min-h-11 shrink-0 px-4 rounded-xl text-xs font-black transition-colors ${mobileCurrency === currency
                                ? 'bg-brand text-white shadow-sm'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300'
                            }`}
                        >
                            {currency === 'USD' ? 'Dólares' : currency === 'BS' ? 'Bolívares' : 'COP'}
                        </button>
                    ))}
                </div>
                {mobileMethods.length > 0 && (
                    <div className={`mt-2 rounded-2xl border ${mobileStyles.bg} ${mobileStyles.border} p-3`}>
                        <h3 className={`text-[11px] font-black uppercase tracking-widest mb-3 flex items-center gap-2 ${mobileStyles.title}`}>
                            <span className={`p-1 rounded-lg ${mobileStyles.titleBg}`}><MobileIcon size={14} strokeWidth={2.5} /></span>
                            {mobileTitle}
                            {mobileCurrency === 'BS' && <span className="ml-auto text-[10px] font-black">Tasa: {formatBs(effectiveRate)}</span>}
                        </h3>
                        {mobileMethods.map(method => (
                            <PaymentBar key={method.id} method={method} styles={mobileStyles} {...barProps} />
                        ))}
                    </div>
                )}
            </div>

            {/* Vista de escritorio/tablet */}
            <div className="hidden sm:block">
            {/* USD Section */}
            {methodsUsd.length > 0 && (
                <div className={`mx-3 mb-3 rounded-2xl border ${SECTION_STYLES.USD.bg} ${SECTION_STYLES.USD.border} p-3`}>
                    <h3 className={`text-[11px] font-black uppercase tracking-widest mb-3 flex items-center gap-2 ${SECTION_STYLES.USD.title}`}>
                        <span className={`p-1 rounded-lg ${SECTION_STYLES.USD.titleBg}`}><DollarSign size={14} strokeWidth={2.5} /></span>
                        Dólares ($)
                    </h3>
                    {methodsUsd.map(m => <PaymentBar key={m.id} method={m} styles={SECTION_STYLES.USD} {...barProps} />)}
                </div>
            )}

            {/* BS Section */}
            {methodsBs.length > 0 && (
                <div className={`mx-3 mb-3 rounded-2xl border ${SECTION_STYLES.BS.bg} ${SECTION_STYLES.BS.border} p-3`}>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${SECTION_STYLES.BS.title}`}>
                            <span className={`p-1 rounded-lg ${SECTION_STYLES.BS.titleBg}`}><Banknote size={14} strokeWidth={2.5} /></span>
                            Bolívares (Bs)
                        </h3>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${SECTION_STYLES.BS.titleBg} ${SECTION_STYLES.BS.title}`}>
                            Tasa: {formatBs(effectiveRate)}
                        </span>
                    </div>
                    {methodsBs.map(m => <PaymentBar key={m.id} method={m} styles={SECTION_STYLES.BS} {...barProps} />)}
                </div>
            )}

            {/* COP Section */}
            {copEnabled && methodsCop.length > 0 && (
                <div className={`mx-3 mb-3 rounded-2xl border ${SECTION_STYLES.COP.bg} ${SECTION_STYLES.COP.border} p-3`}>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${SECTION_STYLES.COP.title}`}>
                            <span className={`p-1 rounded-lg ${SECTION_STYLES.COP.titleBg}`}><Coins size={14} strokeWidth={2.5} /></span>
                            Pesos (COP)
                        </h3>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${SECTION_STYLES.COP.titleBg} ${SECTION_STYLES.COP.title}`}>
                            Tasa: {formatBs(tasaCop)}
                        </span>
                    </div>
                    {methodsCop.map(m => <PaymentBar key={m.id} method={m} styles={SECTION_STYLES.COP} {...barProps} />)}
                </div>
            )}
            </div>
        </>
    );
}
