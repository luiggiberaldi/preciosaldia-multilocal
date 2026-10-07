import React from 'react';
import {
    DollarSign, Banknote, Smartphone, CreditCard, Wallet, Send, Bitcoin, Zap, Hash
} from 'lucide-react';

const ICON_MAP = { CreditCard, Smartphone, Banknote, Wallet, Send, Bitcoin, DollarSign };

/**
 * Estilos por marca de método de pago.
 */
const getBrandStyles = (name, type) => {
    const n = name.toLowerCase();
    if (n.includes('zelle')) return {
        text: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200',
        iconBg: 'bg-purple-100', activeRing: 'ring-purple-500/20'
    };
    if (n.includes('binance') || n.includes('usdt')) return {
        text: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200',
        iconBg: 'bg-yellow-100', activeRing: 'ring-yellow-500/20'
    };
    if (n.includes('pago móvil') || n.includes('pago movil') || type === 'BS') return {
        text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200',
        iconBg: 'bg-blue-100', activeRing: 'ring-blue-500/20'
    };
    if (n.includes('cop') || type === 'COP') return {
        text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
        iconBg: 'bg-amber-100', activeRing: 'ring-amber-500/20'
    };
    // Default USD
    return {
        text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200',
        iconBg: 'bg-emerald-100', activeRing: 'ring-emerald-500/20'
    };
};

/**
 * InputPago — Input individual por método de pago.
 */
const InputPago = React.memo(React.forwardRef(({
    label, icon: Icon, value, onChange, onAutoFill, moneda, onKeyDown,
    requiereRef, refPago, onChangeRef, tasa, isSelected, onFocus, onFocusRef
}, ref) => {
    const brand = getBrandStyles(label, moneda);
    const isActive = value && parseFloat(value) > 0;
    const showRef = requiereRef && isActive;
    const equivalenciaUSD = moneda === 'BS' && isActive && tasa > 0
        ? (parseFloat(value) / tasa).toFixed(2)
        : null;

    return (
        <div className="relative group">
            <div className="flex justify-between items-center mb-1 ml-0.5">
                <label className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${isActive ? brand.text : 'text-slate-400'}`}>
                    {label}
                </label>
            </div>

            <div className="flex flex-col">
                <div className="relative flex-1">
                    {/* Icono */}
                    <div className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${isActive ? brand.text : 'text-slate-300'}`}>
                        <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
                    </div>

                    {/* Input */}
                    <input
                        ref={ref}
                        type="text"
                        inputMode="decimal"
                        onFocus={onFocus}
                        placeholder="0.00"
                        value={value}
                        onChange={(e) => {
                            let v = e.target.value.replace(',', '.');
                            if (!/^[0-9.]*$/.test(v)) return;
                            const dots = v.match(/\./g);
                            if (dots && dots.length > 1) return;
                            onChange({ target: { value: v } });
                        }}
                        onKeyDown={(e) => {
                            if (e.key === ' ' || e.code === 'Space') {
                                e.preventDefault();
                                if (onAutoFill) onAutoFill();
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                onChange({ target: { value: '' } });
                            }
                            if (onKeyDown) onKeyDown(e);
                        }}
                        className={`w-full h-14 pl-10 pr-20 rounded-xl border-2 outline-none transition-all font-bold text-lg text-slate-800 dark:text-white shadow-sm
                            ${isSelected
                                ? `${brand.border} ${brand.bg} ring-4 ${brand.activeRing}`
                                : isActive
                                    ? `${brand.border} ${brand.bg} ring-1 ${brand.activeRing}`
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 focus:border-slate-400 focus:ring-4 focus:ring-slate-50 dark:focus:ring-slate-800'
                            }`}
                    />

                    {/* Acciones derecha */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                        <button
                            onClick={onAutoFill}
                            className={`p-1.5 rounded-lg transition-all active:scale-90 ${isActive ? 'text-slate-400 hover:text-amber-500 hover:bg-white/60' : 'text-slate-300 hover:text-amber-500 hover:bg-slate-100'}`}
                            title="Llenar saldo restante"
                            tabIndex={-1}
                        >
                            <Zap size={14} fill="currentColor" />
                        </button>
                        <span className={`text-[9px] px-1.5 py-0.5 font-black rounded-lg border flex items-center
                            ${isActive ? `bg-white/60 ${brand.text} ${brand.border}` : 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:border-slate-700'}`}>
                            {moneda === 'BS' ? 'Bs' : moneda === 'COP' ? 'COP' : 'USD'}
                        </span>
                    </div>

                    {/* Equivalencia en USD (solo BS) */}
                    {equivalenciaUSD && (
                        <div className="absolute -bottom-3 right-3 translate-y-full text-[9px] px-2 py-0.5 font-black text-blue-600 bg-white dark:bg-slate-900 rounded-full border-2 border-blue-100 shadow-md z-20 animate-in fade-in">
                            ≈ ${equivalenciaUSD}
                        </div>
                    )}
                </div>

                {/* Input de referencia */}
                {requiereRef && (
                    <div className={`transition-all duration-300 origin-top ${showRef ? 'max-h-16 opacity-100 mt-2' : 'max-h-0 opacity-0 overflow-hidden mt-0'}`}>
                        <div className="relative h-11">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Hash size={13} /></div>
                            <input
                                type="text"
                                className={`w-full h-full pl-8 pr-3 border-2 rounded-xl outline-none font-mono font-bold text-[11px] shadow-sm transition-all
                                    ${isActive ? `${brand.border} bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 focus:ring-2 ${brand.activeRing}` : 'border-slate-200 dark:border-slate-700'}`}
                                placeholder="# Referencia..."
                                value={refPago || ''}
                                onChange={onChangeRef}
                                onFocus={onFocusRef}
                                maxLength={8}
                                tabIndex={showRef ? 0 : -1}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}));

/**
 * PaymentInputs — Panel derecho con los inputs de pago agrupados por moneda.
 * Soporte COP condicional (solo si copEnabled=true).
 */
export default function PaymentInputs({
    metodosDivisa,
    metodosBs,
    metodosCop = [],
    pagos,
    handleInputChange,
    llenarSaldo,
    referencias,
    handleRefChange,
    inputRefs,
    handleInputKeyDown,
    tasa,
    sumarBillete,
    isTouch = false,
    onFocusInput,
    activeInputId,
    onFocusRef,
    copEnabled = false,
    mobileCurrency = null,
}) {
    const renderQuickCash = (id) => (
        <div className="flex flex-wrap gap-1.5 mt-2 px-0.5">
            {[1, 5, 10, 20, 50, 100].map(den => (
                <button
                    key={den}
                    type="button"
                    onClick={() => sumarBillete(id, den)}
                    className="flex-1 min-w-[32px] font-bold rounded-lg border border-slate-100 text-xs py-1.5 bg-white dark:bg-slate-900 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 active:scale-95 transition-all"
                >{den}</button>
            ))}
        </div>
    );

    let globalIndex = 0;

    return (
        <div className={`grid grid-cols-1 ${copEnabled && metodosCop.length > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} ${mobileCurrency ? 'gap-3' : 'gap-4'}`}>
            {/* DIVISAS (USD) */}
            <div className={`${mobileCurrency && mobileCurrency !== 'USD' ? 'hidden lg:flex' : 'flex'} bg-emerald-50/30 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl p-3 sm:p-4 flex-col gap-3 sm:gap-4`}>

                <h3 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2 uppercase tracking-wide border-b border-emerald-100 dark:border-emerald-900/30 pb-2.5">
                    <div className="p-1 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg"><DollarSign size={14} strokeWidth={3} /></div>
                    Divisas ($)
                </h3>
                <div className="space-y-4">
                    {metodosDivisa.map((m) => {
                        const idx = globalIndex++;
                        const Icon = ICON_MAP[m.icono] || DollarSign;
                        const isEfectivo = m.nombre.toLowerCase().includes('efectivo');
                        return (
                            <div key={m.id}>
                                <InputPago
                                    ref={el => inputRefs.current[idx] = el}
                                    label={m.nombre} icon={Icon}
                                    value={pagos[m.id] || ''}
                                    onChange={e => handleInputChange(m.id, e.target.value)}
                                    onAutoFill={() => llenarSaldo(m.id, 'USD')}
                                    moneda="USD"
                                    onKeyDown={e => handleInputKeyDown(e, idx, m.id, 'USD')}
                                    requiereRef={m.requiereRef}
                                    refPago={referencias[m.id]}
                                    onChangeRef={e => handleRefChange(m.id, e.target.value)}
                                    tasa={tasa}
                                    isTouch={isTouch}
                                    onFocus={() => onFocusInput(m.id)}
                                    isSelected={activeInputId === m.id}
                                    onFocusRef={() => onFocusRef(m.id)}
                                />
                                {isEfectivo && renderQuickCash(m.id)}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* BOLÍVARES (BS) */}
            <div className={`${mobileCurrency && mobileCurrency !== 'BS' ? 'hidden lg:flex' : 'flex'} bg-blue-50/30 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl p-4 flex-col gap-4`}>

                <div className="flex items-center justify-between border-b border-blue-100 dark:border-blue-900/30 pb-2.5">
                    <h3 className="text-xs font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2 uppercase tracking-wide">
                        <div className="p-1 bg-blue-100 dark:bg-blue-900/50 rounded-lg"><Banknote size={14} strokeWidth={3} /></div>
                        Bolívares (Bs)
                    </h3>
                    <span className="text-[10px] font-black bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-lg border border-blue-100 dark:border-blue-900/30">
                        {tasa.toFixed(2)} Bs/$
                    </span>
                </div>
                <div className="space-y-4">
                    {metodosBs.map((m) => {
                        const idx = globalIndex++;
                        const Icon = ICON_MAP[m.icono] || Banknote;
                        return (
                            <InputPago
                                key={m.id}
                                ref={el => inputRefs.current[idx] = el}
                                label={m.nombre} icon={Icon}
                                value={pagos[m.id] || ''}
                                onChange={e => handleInputChange(m.id, e.target.value)}
                                onAutoFill={() => llenarSaldo(m.id, 'BS')}
                                moneda="BS"
                                onKeyDown={e => handleInputKeyDown(e, idx, m.id, 'BS')}
                                requiereRef={m.requiereRef}
                                refPago={referencias[m.id]}
                                onChangeRef={e => handleRefChange(m.id, e.target.value)}
                                tasa={tasa}
                                isTouch={isTouch}
                                onFocus={() => onFocusInput(m.id)}
                                isSelected={activeInputId === m.id}
                                onFocusRef={() => onFocusRef(m.id)}
                            />
                        );
                    })}
                </div>
            </div>

            {/* PESOS COLOMBIANOS (COP) — solo si copEnabled */}
            {copEnabled && metodosCop.length > 0 && (
                <div className={`${mobileCurrency && mobileCurrency !== 'COP' ? 'hidden lg:flex' : 'flex'} bg-amber-50/30 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl p-3 sm:p-4 flex-col gap-3 sm:gap-4`}>

                    <h3 className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2 uppercase tracking-wide border-b border-amber-100 dark:border-amber-900/30 pb-2.5">
                        <div className="p-1 bg-amber-100 dark:bg-amber-900/50 rounded-lg"><DollarSign size={14} strokeWidth={3} /></div>
                        COP ($)
                    </h3>
                    <div className="space-y-4">
                        {metodosCop.map((m) => {
                            const idx = globalIndex++;
                            const Icon = ICON_MAP[m.icono] || DollarSign;
                            return (
                                <InputPago
                                    key={m.id}
                                    ref={el => inputRefs.current[idx] = el}
                                    label={m.nombre} icon={Icon}
                                    value={pagos[m.id] || ''}
                                    onChange={e => handleInputChange(m.id, e.target.value)}
                                    onAutoFill={() => llenarSaldo(m.id, 'COP')}
                                    moneda="COP"
                                    onKeyDown={e => handleInputKeyDown(e, idx, m.id, 'COP')}
                                    requiereRef={m.requiereRef}
                                    refPago={referencias[m.id]}
                                    onChangeRef={e => handleRefChange(m.id, e.target.value)}
                                    tasa={tasa}
                                    isTouch={isTouch}
                                    onFocus={() => onFocusInput(m.id)}
                                    isSelected={activeInputId === m.id}
                                    onFocusRef={() => onFocusRef(m.id)}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
