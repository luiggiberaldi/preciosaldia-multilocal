import { forwardRef, useState, useEffect, useRef } from 'react';
import { Search, Mic, Package, X, Box } from 'lucide-react';
import { BODEGA_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../config/categories';
import { formatCop, formatUsd, getCop, getUsd } from '../../utils/calculatorUtils';
import { parseMoneyAmount, bsToUsd, qtyFromMoneyAmount, formatStockDisplay } from '../../utils/granel'; // GRANEL-MONEY
import SmartImage from '../SmartImage';

const formatBs = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const SearchBar = forwardRef(function SearchBar({
    searchTerm,
    onSearchChange,
    onKeyDown,
    onPasteBarcode,
    searchResults,
    selectedIndex,
    setSelectedIndex,
    effectiveRate,
    addToCart,
    isRecording,
    isProcessingAudio,
    startRecording,
    stopRecording,
    // Popups
    hierarchyPending,
    setHierarchyPending,
    weightPending,
    setWeightPending,
    // COP
    copEnabled,
    copPrimary,
    tasaCop,
}, ref) {
    return (
        <div className="relative">
            <Search size={20} className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
                ref={ref}
                type="text"
                value={searchTerm}
                onChange={e => onSearchChange(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                    const pastedData = e.clipboardData.getData('Text').trim();
                    if (pastedData) {
                        onPasteBarcode?.(pastedData);
                    }
                }}
                placeholder="Buscar producto..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl sm:rounded-2xl py-3 pl-10 sm:pl-12 pr-14 sm:pr-20 text-slate-800 dark:text-white font-medium outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-inner text-sm sm:text-base transition-all" />

            <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 flex items-center pr-1 gap-0.5">
                {searchTerm && (
                    <button onClick={() => { onSearchChange(''); ref.current?.focus(); }} className="text-slate-400 hover:text-slate-600 p-1.5 transition-colors">
                        <X size={18} />
                    </button>
                )}
                <button
                    onPointerDown={(e) => { e.preventDefault(); startRecording(); }}
                    onPointerUp={(e) => { e.preventDefault(); stopRecording(); }}
                    onPointerLeave={(e) => { if (isRecording) stopRecording(); }}
                    // Prevenir el menú contextual en móvil al mantener presionado
                    onContextMenu={(e) => e.preventDefault()}
                    className={`p-[13px] -m-[7px] rounded-full transition-all flex items-center justify-center select-none ${isRecording
                        ? 'bg-red-100 text-red-500 shadow-inner animate-pulse scale-110'
                        : isProcessingAudio
                            ? 'bg-amber-100 text-amber-500'
                            : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
                        }`}
                    title={isRecording ? "Mantén presionado y habla" : "Mantén presionado para hablar"}
                >
                    {isProcessingAudio ? (
                        <div className="w-[18px] h-[18px] border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <Mic size={18} className={isRecording ? 'animate-bounce' : ''} />
                    )}
                </button>
            </div>

            {/* Search Dropdown */}
            {searchResults.length > 0 && (
                <div className="absolute top-full mt-2 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-20 overflow-hidden">
                    {searchResults.map((p, index) => {
                        const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0;
                        const isOutOfStock = (p.stock ?? 0) === 0;
                        const catInfo = BODEGA_CATEGORIES.find(c => c.id === p.category);
                        const catColor = catInfo ? CATEGORY_COLORS[catInfo.color] : null;
                        const CatIcon = catInfo ? CATEGORY_ICONS[catInfo.id] : null;
                        const isSelected = index === selectedIndex;
                        return (
                            <button
                                key={p.id}
                                onClick={() => addToCart(p)}
                                onMouseEnter={() => setSelectedIndex(index)}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 border-b border-slate-50 dark:border-slate-800/50 last:border-0 transition-all active:scale-[0.98]
                                    ${isSelected
                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-l-4 border-l-emerald-500'
                                        : 'bg-transparent border-l-4 border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                    }
                                    ${isOutOfStock ? 'opacity-50' : ''}`}
                            >
                                <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                    <SmartImage
                                        src={p.image}
                                        product={p}
                                        alt={p.name}
                                        fallbackIcon={
                                            CatIcon
                                                ? <CatIcon size={20} className="text-slate-400" />
                                                : <Package size={16} className="text-slate-400" />
                                        }
                                    />
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                    <p className={`text-sm font-bold truncate leading-tight ${isSelected ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}>
                                        {p.name}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        {catInfo && catInfo.id !== 'otros' && catInfo.id !== 'todos' && catColor && (
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${catColor}`}>
                                                {catInfo.label}
                                            </span>
                                        )}
                                        {p.pricingMode === 'dual_usd' && p.priceBsUsdRef > 0 && (
                                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800/60">
                                                Doble $: ${p.priceUsdt || p.priceUsd} / ${p.priceBsUsdRef} Ref
                                            </span>
                                        )}
                                        <span className={`text-[10px] font-medium flex items-center gap-1
                                            ${isOutOfStock ? 'text-red-500' : isLowStock ? 'text-amber-500' : 'text-slate-400'}`}>
                                            {isLowStock && !isOutOfStock && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
                                            {isOutOfStock ? 'Sin stock' : `Stock: ${p.stock ?? 0}`}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    {copEnabled && copPrimary && tasaCop > 0 ? (
                                        <>
                                            <p className="text-sm font-black text-amber-600 dark:text-amber-400">
                                                {formatCop(getCop(p, tasaCop))} COP
                                            </p>
                                            <p className="text-[10px] font-medium text-slate-400">
                                                ${getUsd(p, tasaCop).toFixed(2)}
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex items-center justify-end gap-1">
                                                <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                                                    ${getUsd(p, tasaCop).toFixed(2)}
                                                </p>
                                                {p.pricingMode === 'dual_usd' && parseFloat(p.priceBsUsdRef) > 0 && (
                                                    <span className="text-[9px] font-black text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-300 px-1 py-0.5 rounded border border-emerald-200/60 leading-none">
                                                        ${formatUsd(p.priceBsUsdRef)} Ref
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[10px] font-medium text-slate-400">
                                                {copEnabled && tasaCop > 0
                                                    ? `${formatCop(getCop(p, tasaCop))} COP`
                                                    : `${formatBs(
                                                        p.pricingMode === 'dual_usd' && parseFloat(p.priceBsUsdRef) > 0
                                                            ? parseFloat(p.priceBsUsdRef) * effectiveRate
                                                            : (p.priceUsdt || p.priceUsd || 0) * effectiveRate
                                                    )} Bs ${p.pricingMode === 'dual_usd' && parseFloat(p.priceBsUsdRef) > 0 ? '(en Bs)' : ''}`
                                                }
                                            </p>
                                        </>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                    <div className="bg-slate-50 dark:bg-slate-950 p-2 text-center border-t border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center justify-center gap-2">
                            Navega con flechas <span className="px-1 bg-slate-200 dark:bg-slate-800 rounded">↓</span><span className="px-1 bg-slate-200 dark:bg-slate-800 rounded">↑</span> y presiona <span className="px-1 bg-slate-200 dark:bg-slate-800 rounded">ENTER ↵</span>
                        </span>
                    </div>
                </div>
            )}

            {/* ─── POPUP JERARQUÍA: Paquete o Unidad ─── */}
            {hierarchyPending && (
                <div className="absolute top-full mt-2 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-2 border-surface-300 dark:border-surface-800 rounded-2xl shadow-2xl shadow-primary/10 overflow-hidden">
                    <div className="p-3 bg-brand-light dark:bg-surface-800/20 border-b border-surface-200 dark:border-surface-800">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-black text-brand-dark dark:text-brand uppercase tracking-wider">¿Cómo lo vendes?</p>
                                <p className="text-[11px] text-brand/70 dark:text-brand/50 font-medium mt-0.5">{hierarchyPending.name}</p>
                            </div>
                            <button onClick={() => setHierarchyPending(null)} className="p-1 text-brand hover:text-brand-dark"><X size={16} /></button>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 p-3">
                        <button onClick={() => addToCart(hierarchyPending, null, 'package')}
                            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-brand-light dark:bg-surface-800/20 border-2 border-surface-300 dark:border-surface-800 hover:border-brand hover:bg-brand-light dark:hover:bg-surface-800/40 transition-all active:scale-95">
                            <Package size={24} className="text-brand-dark dark:text-brand" />
                            <span className="text-xs font-black text-brand-dark dark:text-brand uppercase">Caja/Bulto</span>
                            <span className="text-sm font-black text-brand-dark dark:text-brand">{copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(getCop(hierarchyPending, tasaCop))} COP` : `$${hierarchyPending.priceUsdt?.toFixed(2)}`}</span>
                            <span className="text-[9px] text-slate-400 font-bold">{hierarchyPending.unitsPerPackage} uds</span>
                        </button>
                        <button onClick={() => addToCart(hierarchyPending, null, 'unit')}
                            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all active:scale-95">
                            <Box size={24} className="text-emerald-600 dark:text-emerald-400" />
                            <span className="text-xs font-black text-emerald-700 dark:text-emerald-300 uppercase">Unidad</span>
                            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">{copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(hierarchyPending.unitPriceUsd * tasaCop)} COP` : `$${hierarchyPending.unitPriceUsd?.toFixed(2)}`}</span>
                            <span className="text-[9px] text-slate-400 font-bold">1 ud</span>
                        </button>
                    </div>
                </div>
            )}

            {/* ─── POPUP PESAJE: Kg / Litro ─── */}
            {weightPending && (
                <WeightPopup
                    weightPending={weightPending}
                    setWeightPending={setWeightPending}
                    addToCart={addToCart}
                    effectiveRate={effectiveRate}
                    tasaCop={tasaCop}
                />
            )}
        </div>
    );
});

// ─── SUBCOMPONENTE DE PESAJE CON BORRADO AUTOMÁTICO AL PULSAR CLIC ───
function WeightPopup({ weightPending, setWeightPending, addToCart, effectiveRate = 0, tasaCop = 0 }) {
    const [qty, setQty] = useState('1.00');
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const prevQtyRef = useRef('1.00');

    // GRANEL-MONEY: venta por monto ("dame 3$ de queso", "dame 5000 Bs de jabón")
    const [amountInput, setAmountInput] = useState('');
    const [amountCurrency, setAmountCurrency] = useState('usd'); // 'usd' | 'bs'

    // Reiniciar valores si cambia el producto a pesar
    useEffect(() => {
        setQty('1.00');
        setDraft('');
        setIsEditing(false);
        setAmountInput('');
        prevQtyRef.current = '1.00';
    }, [weightPending?.id]);

    // Al hacer clic o foco: borra el número inmediatamente y muestra el anterior como placeholder tenue
    const handleFocus = () => {
        if (isEditing) return;
        prevQtyRef.current = draft || qty || '1.00';
        setIsEditing(true);
        setDraft('');
    };

    const handleChange = (e) => {
        setDraft(e.target.value);
    };

    const handleBlur = () => {
        setIsEditing(false);
        if (!draft || draft.trim() === '') {
            setQty(prevQtyRef.current);
        } else {
            const parsed = parseFloat(draft.replace(',', '.'));
            if (isNaN(parsed) || parsed <= 0) {
                setQty(prevQtyRef.current);
            } else {
                setQty(parsed.toString());
            }
        }
    };

    const handleStep = (delta) => {
        const current = parseFloat((isEditing ? draft : qty).replace(',', '.')) || parseFloat(prevQtyRef.current) || 1;
        const next = Math.max(0.01, parseFloat((current + delta).toFixed(3)));
        setQty(next.toString());
        setDraft(next.toString());
    };

    const handleSubmit = () => {
        const raw = isEditing ? draft : qty;
        let parsed = parseFloat((raw || '').replace(',', '.'));
        if (isNaN(parsed) || parsed <= 0) {
            parsed = parseFloat(prevQtyRef.current) || 1;
        }
        if (parsed > 0) {
            addToCart(weightPending, parsed);
            setWeightPending(null);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
    };

    const unitLabel = weightPending.unit === 'kg' ? 'kg' : weightPending.unit === 'litro' ? 'lt' : (weightPending.granelUnit || 'kg');

    // ── GRANEL-MONEY: conversión monto → cantidad con preview en vivo ──
    // Mismo precio efectivo que usa addToCart (priceCop tiene prioridad si hay tasa COP).
    const pricePerUnit = (weightPending.priceCop && tasaCop > 0)
        ? weightPending.priceCop / tasaCop
        : (parseFloat(weightPending.priceUsdt) || 0);
    const parsedAmount = parseMoneyAmount(amountInput);
    const amountUsdPreview = (parsedAmount != null && amountCurrency === 'bs')
        ? (effectiveRate > 0 ? bsToUsd(parsedAmount, effectiveRate) : null)
        : parsedAmount;
    const qtyPreview = (amountUsdPreview != null && amountUsdPreview > 0 && pricePerUnit > 0)
        ? qtyFromMoneyAmount(amountUsdPreview, 'usd', pricePerUnit, effectiveRate)
        : null;
    const amountHint = (() => {
        if (parsedAmount == null) return null;
        if (amountCurrency === 'bs' && !(effectiveRate > 0)) return 'Configura la tasa de cambio para vender en Bs';
        if (pricePerUnit <= 0) return 'Este producto no tiene precio unitario válido';
        if (qtyPreview == null) return `El monto no alcanza para 0.001 ${unitLabel}`;
        return `= ${formatStockDisplay(qtyPreview, true)} ${unitLabel} · $${formatUsd(amountUsdPreview)}${amountCurrency === 'bs' ? ` (${formatBs(parsedAmount)} Bs)` : ''}`;
    })();

    const handleAddByAmount = () => {
        if (qtyPreview == null) return;
        addToCart(weightPending, qtyPreview);
        setWeightPending(null);
    };

    return (
        <div className="absolute top-full mt-2 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-2 border-amber-200 dark:border-amber-800 rounded-2xl shadow-2xl shadow-amber-500/10 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-xs font-black text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                            ¿Cuántos {weightPending.unit === 'kg' ? 'kilos' : 'litros'}?
                        </p>
                        <p className="text-[11px] text-amber-500/70 dark:text-amber-400/50 font-medium mt-0.5">
                            {weightPending.name} · ${weightPending.priceUsdt?.toFixed(2)}/{unitLabel}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setWeightPending(null)}
                        className="p-1 text-amber-400 hover:text-amber-600 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>
            <div className="p-3 space-y-3">
                {/* Botones rápidos */}
                <div className="grid grid-cols-4 gap-2">
                    {[0.25, 0.5, 1, 2].map(q => (
                        <button
                            key={q}
                            type="button"
                            onClick={() => { addToCart(weightPending, q); setWeightPending(null); }}
                            className="py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm font-black text-amber-700 dark:text-amber-300 hover:bg-amber-100 active:scale-95 transition-all"
                        >
                            {q} {unitLabel}
                        </button>
                    ))}
                </div>
                {/* GRANEL-MONEY: venta por monto — "dame 3$ de queso" / "dame 5000 Bs" */}
                <div className="rounded-xl bg-amber-50/70 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/60 p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-amber-200 dark:border-amber-700 shrink-0">
                            <button type="button" onClick={() => setAmountCurrency('usd')}
                                className={`px-3 py-2 text-xs font-black transition-colors ${amountCurrency === 'usd' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-slate-700'}`}>
                                $
                            </button>
                            <button type="button" onClick={() => setAmountCurrency('bs')}
                                className={`px-3 py-2 text-xs font-black transition-colors ${amountCurrency === 'bs' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-slate-700'}`}>
                                Bs
                            </button>
                        </div>
                        <div className="flex-1 min-w-0 flex items-center bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 rounded-lg px-2.5">
                            <span className="text-xs font-black text-amber-600 dark:text-amber-400 shrink-0">
                                {amountCurrency === 'bs' ? 'Bs' : '$'}
                            </span>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={amountInput}
                                onChange={(e) => setAmountInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddByAmount(); } }}
                                placeholder={amountCurrency === 'bs' ? 'Ej: 5000' : 'Ej: 3.00'}
                                className="flex-1 min-w-0 bg-transparent text-center py-2 font-bold text-slate-700 dark:text-white outline-none text-sm placeholder:text-slate-400/50"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handleAddByAmount}
                            disabled={!qtyPreview}
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-200 dark:disabled:bg-amber-900/40 disabled:text-amber-400 dark:disabled:text-amber-700 disabled:cursor-not-allowed text-white rounded-lg font-black text-xs active:scale-95 transition-all shrink-0"
                        >
                            Agregar
                        </button>
                    </div>
                    {amountHint && (
                        <p className={`text-[11px] font-bold text-center ${qtyPreview != null ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                            {amountHint}
                        </p>
                    )}
                </div>
                {/* Input manual con borrado al pulsar clic */}
                <div className="flex gap-2 items-center">
                    <div className="flex-1 flex items-center bg-amber-50 dark:bg-slate-800 border border-amber-200 dark:border-amber-700 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-amber-500/50 transition-all">
                        <button
                            type="button"
                            onClick={() => handleStep(-0.1)}
                            className="px-4 py-3 text-amber-600 hover:bg-amber-100/30 active:bg-amber-200/30 transition-colors font-black text-base select-none"
                        >
                            -
                        </button>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={isEditing ? draft : qty}
                            placeholder={prevQtyRef.current || '1.00'}
                            onFocus={handleFocus}
                            onClick={handleFocus}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="flex-1 bg-transparent text-center py-3 font-bold text-slate-700 dark:text-white outline-none text-sm placeholder:text-slate-400/50"
                        />
                        <button
                            type="button"
                            onClick={() => handleStep(0.1)}
                            className="px-4 py-3 text-amber-600 hover:bg-amber-100/30 active:bg-amber-200/30 transition-colors font-black text-base select-none"
                        >
                            +
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        className="px-5 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-sm active:scale-95 transition-all shrink-0 shadow-sm"
                    >
                        Agregar
                    </button>
                </div>
            </div>
        </div>
    );
}

export default SearchBar;


