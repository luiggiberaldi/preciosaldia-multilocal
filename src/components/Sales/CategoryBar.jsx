import { useState, useEffect, useRef } from 'react';
import { Package, Calculator, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Clock, HelpCircle, Trash2, X, DollarSign, Grid } from 'lucide-react';
import { BODEGA_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../config/categories';
import { formatCop, formatBs, formatUsd, getCop, getUsd } from '../../utils/calculatorUtils';
import SmartImage from '../SmartImage';

const PAGE_SIZE = 30;

export default function CategoryBar({
    selectedCategory,
    setSelectedCategory,
    filteredByCategory,
    addToCart,
    triggerHaptic,
    searchTerm = '',
    onOpenCustomAmount,
    products = [],
    copEnabled,
    copPrimary,
    tasaCop,
    effectiveRate,
    categories = [],
    // Nuevos props:
    onClearCart,
    onHoldCart,
    pendingCartsCount,
    onRestoreHold,
    pendingCarts = [],
    onOpenHelp,
    onOpenHolds,
    cart = [],
    allowCashAdvance = false,
    onOpenCashAdvance,
}) {
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const categoryScrollRef = useRef(null);
    const [showNoteInput, setShowNoteInput] = useState(false);
    const [holdNote, setHoldNote] = useState('');
    const [imgErrorMap, setImgErrorMap] = useState({});

    // PC / Desktop optimization states
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    const checkScrollState = () => {
        const el = categoryScrollRef.current;
        if (!el) return;
        setCanScrollLeft(el.scrollLeft > 4);
        setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };

    const handleConfirmHold = () => {
        if (onHoldCart) {
            onHoldCart(holdNote);
        }
        setHoldNote('');
        setShowNoteInput(false);
    };

    // Reset pagination when category changes
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [selectedCategory]);

    // Wheel → scroll horizontal sin advertencia de evento pasivo + scroll checks
    useEffect(() => {
        const el = categoryScrollRef.current;
        if (!el) return;

        checkScrollState();
        const handler = (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                el.scrollLeft += e.deltaY;
                checkScrollState();
            }
        };
        el.addEventListener('wheel', handler, { passive: false });
        el.addEventListener('scroll', checkScrollState);
        window.addEventListener('resize', checkScrollState);

        return () => {
            el.removeEventListener('wheel', handler);
            el.removeEventListener('scroll', checkScrollState);
            window.removeEventListener('resize', checkScrollState);
        };
    }, []);

    const scrollByAmount = (amount) => {
        if (categoryScrollRef.current) {
            categoryScrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
            setTimeout(checkScrollState, 250);
        }
    };

    const visibleProducts = filteredByCategory.slice(0, visibleCount);
    const hasMore = filteredByCategory.length > visibleCount;
    const allowNegativeStock = localStorage.getItem('allow_negative_stock') === 'true';

    // Fallback to static config if no categories passed from context
    const categoryList = categories && categories.length > 0 ? categories : BODEGA_CATEGORIES;

    // Filter categories that have at least one product
    const activeCategories = categoryList.filter(cat => cat.id === 'todos' || products.some(p => p.category === cat.id));

    return (
        <div className={`relative ${searchTerm.length === 0 ? 'lg:flex-1 lg:overflow-hidden lg:flex lg:flex-col lg:min-h-0' : ''}`}>
            
            {/* Category Chips Container (Optimized for PC: Smooth scroll buttons & optional multiline wrap) */}
            <div className="relative mb-1.5 shrink-0 flex items-center gap-1">
                
                {/* Scroll Left Button (PC Only) */}
                {canScrollLeft && !isExpanded && (
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); scrollByAmount(-260); }}
                        className="hidden md:flex shrink-0 items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-600 dark:text-slate-300 hover:text-brand hover:border-brand transition-all active:scale-95 z-10"
                        title="Desplazar a la izquierda"
                    >
                        <ChevronLeft size={16} />
                    </button>
                )}

                <div
                    ref={categoryScrollRef}
                    className={`flex-1 flex gap-1 ${
                        isExpanded
                            ? 'flex-wrap py-1.5 px-0.5 max-h-48 overflow-y-auto'
                            : 'overflow-x-auto py-1.5 px-0.5 scrollbar-hide flex-nowrap'
                    }`}
                >
                    {/* Monto Libre Button */}
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); onOpenCustomAmount && onOpenCustomAmount(); }}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-xs font-black transition-all active:scale-95 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand border border-surface-300 dark:border-surface-700 hover:bg-brand-light shadow-sm"
                    >
                        <Calculator size={14} />
                        Monto Libre
                    </button>

                    {/* Avance Efectivo Button */}
                    {allowCashAdvance && (
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); onOpenCashAdvance && onOpenCashAdvance(); }}
                            className="shrink-0 flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-xs font-black transition-all active:scale-95 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40 hover:bg-amber-100/50 shadow-sm"
                        >
                            <DollarSign size={14} />
                            Avance Efectivo
                        </button>
                    )}

                    {/* Divider */}
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 my-auto mx-0.5 rounded-full shrink-0" />

                    {/* Show categories with products */}
                    {activeCategories.map(cat => {
                        const isActive = selectedCategory === cat.id;
                        const count = products.filter(p => cat.id === 'todos' ? true : p.category === cat.id).length;
                        const catColorClass = CATEGORY_COLORS[cat.color] || 'bg-emerald-500 text-white';

                        return (
                            <button
                                key={cat.id}
                                onClick={() => { triggerHaptic && triggerHaptic(); setSelectedCategory(isActive && cat.id !== 'todos' ? 'todos' : cat.id); }}
                                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-xs font-bold transition-all active:scale-95 border ${
                                    isActive
                                        ? `${catColorClass} shadow-sm border-transparent`
                                        : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-brand hover:text-brand'
                                }`}
                            >
                                {cat.label}
                                <span className={`text-[10px] ${isActive ? 'opacity-90' : 'text-slate-400 dark:text-slate-500'}`}>
                                    · {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Scroll Right Button (PC Only) */}
                {canScrollRight && !isExpanded && (
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); scrollByAmount(260); }}
                        className="hidden md:flex shrink-0 items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-600 dark:text-slate-300 hover:text-brand hover:border-brand transition-all active:scale-95 z-10"
                        title="Desplazar a la derecha"
                    >
                        <ChevronRight size={16} />
                    </button>
                )}

                {/* PC Expand / Wrap Toggle Button */}
                {activeCategories.length > 5 && (
                    <button
                        onClick={() => { setIsExpanded(!isExpanded); triggerHaptic && triggerHaptic(); }}
                        className="hidden md:flex shrink-0 items-center gap-1 px-2.5 py-2 min-h-[40px] rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95 shadow-sm"
                        title={isExpanded ? "Vista carrusel" : "Mostrar todas las categorías"}
                    >
                        {isExpanded ? <ChevronUp size={14} /> : <Grid size={14} />}
                        <span>{isExpanded ? "Plegar" : "Ver todas"}</span>
                    </button>
                )}
            </div>

            {/* ── BARRA DE ACCIONES RÁPIDAS (Listo POS 2026 Style) ── */}
            <div className="shrink-0 flex items-center justify-between gap-2 mb-2 relative flex-wrap sm:flex-nowrap">
                {/* Izquierda: acciones de venta */}
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); onOpenHelp && onOpenHelp(); }}
                        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-wide hover:bg-blue-100 transition-all active:scale-95"
                    >
                        <HelpCircle size={11} /> AYUDA (?)
                    </button>

                    {/* Botón para abrir la lista de tickets en espera */}
                    {pendingCartsCount > 0 && (
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); onOpenHolds && onOpenHolds(); }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-brand/20 bg-brand-light dark:bg-brand/10 text-brand-dark dark:text-brand text-[10px] font-black uppercase tracking-wide hover:bg-brand/20 transition-all active:scale-95 animate-pulse"
                        >
                            <Clock size={11} className="text-brand" /> EN ESPERA ({pendingCartsCount})
                        </button>
                    )}

                    {/* Botón para estacionar la venta actual (con input en línea) */}
                    {cart.length > 0 && (
                        <div className="relative flex items-center">
                            {showNoteInput ? (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-full shadow-sm animate-in slide-in-from-left duration-150">
                                    <input
                                        type="text"
                                        placeholder="Nombre o Nota (ej: Mesa 3)"
                                        value={holdNote}
                                        onChange={(e) => setHoldNote(e.target.value)}
                                        className="bg-transparent text-xs font-bold text-amber-900 dark:text-amber-300 outline-none placeholder:text-amber-700/50 dark:placeholder:text-amber-500/40 w-60 sm:w-80 px-1 py-0.5"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleConfirmHold();
                                            if (e.key === 'Escape') { setShowNoteInput(false); setHoldNote(''); }
                                        }}
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleConfirmHold}
                                        className="px-3.5 py-1 bg-amber-500 hover:bg-amber-600 text-[10px] font-black text-white rounded-full transition-all active:scale-95 shadow-sm shadow-amber-500/10 shrink-0"
                                    >
                                        Listo
                                    </button>
                                    <button
                                        onClick={() => { setShowNoteInput(false); setHoldNote(''); }}
                                        className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all shrink-0"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => { triggerHaptic && triggerHaptic(); setShowNoteInput(true); }}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 text-[10px] font-black uppercase tracking-wide hover:bg-amber-100 transition-all active:scale-95"
                                    title="Estacionar venta en espera (Atajo: F7)"
                                >
                                    <Clock size={11} /> Estacionar <span className="bg-amber-100 dark:bg-amber-950 text-amber-700 px-1 rounded text-[8px] font-black ml-0.5">F7</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Derecha: Vaciar cesta */}
                <button
                    onClick={onClearCart}
                    className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors"
                >
                    <Trash2 size={12} /> VACIAR CESTA <span className="bg-slate-100 dark:bg-slate-800 text-slate-400 px-1 rounded text-[8px] font-black">F4</span>
                </button>
            </div>

            {/* Product Grid */}
            {searchTerm.length === 0 && (
                <div className="flex-1 overflow-y-auto min-h-0 pb-2">
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                        {visibleProducts.map(p => {
                            const isOut = (p.stock ?? 0) <= 0;
                            const isDisabled = isOut && !allowNegativeStock;
                            const CatIcon = CATEGORY_ICONS[p.category] || Package;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => { triggerHaptic && triggerHaptic(); addToCart(p); }}
                                    disabled={isDisabled}
                                    className={`group relative flex flex-col justify-between p-3 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md transition-all text-left active:scale-[0.98] ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                >
                                    {/* Stock Badge flotante en la esquina superior derecha de la tarjeta (Pill) */}
                                    <span className={`absolute top-2.5 right-2.5 text-[9px] font-extrabold px-2 py-0.5 rounded-full z-20 border shadow-2xs ${
                                        isOut
                                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200'
                                            : 'bg-emerald-100/90 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-200/60'
                                    }`}>
                                        {isOut ? 'AGOTADO' : `${p.isWeight ? (p.stock ?? 0).toFixed(2) : (p.stock ?? 0)} ${p.isWeight ? 'KG' : 'UNDS'}`}
                                    </span>

                                    {/* Contenedor de la Imagen con padding superior para no tapar la pill de stock */}
                                    <div className="w-full aspect-square bg-transparent flex items-center justify-center overflow-hidden pt-3 pb-1 mb-1 relative group-hover:scale-[1.03] transition-transform">
                                        <SmartImage
                                            src={p.image}
                                            product={p}
                                            alt={p.name}
                                            className="w-full h-full object-contain"
                                            fallbackIcon={<CatIcon size={26} className="text-slate-300 dark:text-slate-700" />}
                                        />
                                    </div>

                                    {/* Nombre: izquierda, 2 líneas */}
                                    <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 mt-1 mb-2 min-h-[2.4em]">{p.name}</p>

                                    {/* Sección de precios */}
                                    <div className="mt-auto">
                                        {/* Precio USD: grande con badge si es dual */}
                                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                            <p className="text-base font-black text-slate-900 dark:text-white leading-none">
                                                ${getUsd(p, tasaCop).toFixed(2)}
                                            </p>
                                            {p.pricingMode === 'dual_usd' && parseFloat(p.priceBsUsdRef) > 0 && (
                                                <span className="text-[9px] font-black text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-300 px-1.5 py-0.5 rounded-md border border-emerald-200/60 leading-none">
                                                    ${formatUsd(p.priceBsUsdRef)} Ref
                                                </span>
                                            )}
                                        </div>

                                        {/* Precio Bs: pequeño, color teal / brand */}
                                        <p className="text-[11px] font-bold text-teal-600 dark:text-teal-400 leading-none mt-0.5">
                                            Bs {formatBs(
                                                p.pricingMode === 'dual_usd' && parseFloat(p.priceBsUsdRef) > 0
                                                    ? parseFloat(p.priceBsUsdRef) * (effectiveRate || 0)
                                                    : getUsd(p, tasaCop) * (effectiveRate || 0)
                                            )}
                                            {p.pricingMode === 'dual_usd' && parseFloat(p.priceBsUsdRef) > 0 && (
                                                <span className="text-[9px] text-slate-400 font-medium ml-0.5">(en Bs)</span>
                                            )}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    {/* Botón "Cargar Más" */}
                    {visibleCount < filteredByCategory.length && (
                        <div className="mt-4 flex justify-center">
                            <button
                                onClick={() => setVisibleCount(prev => prev + 20)}
                                className="flex items-center gap-1.5 px-5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:border-brand hover:text-brand-dark transition-all active:scale-95 shadow-sm"
                            >
                                <ChevronDown size={14} />
                                Cargar Mas ({filteredByCategory.length - visibleCount} restantes)
                            </button>
                        </div>
                    )}

                    {filteredByCategory.length === 0 && (
                        <div className="text-center py-10">
                            <Package size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                            <p className="text-xs text-slate-400 font-medium">Sin productos en esta categoria</p>
                        </div>
                    )}

                    {/* ── FOOTER DE ATAJOS DE TECLADO ── */}
                    <div className="shrink-0 mt-4 flex items-center justify-center gap-3 flex-wrap py-2 border-t border-slate-100 dark:border-slate-800/60">
                        {[
                            { key: 'F2', label: 'BUSCAR' },
                            { key: '*', label: 'CICLAR UNIDAD' },
                            { key: 'ENTER', label: 'AGREGAR' },
                            { key: 'F9', label: 'COBRAR' },
                        ].map(({ key, label }) => (
                            <span key={key} className="flex items-center gap-1 text-[9px] font-bold text-slate-400">
                                <kbd className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-500 dark:text-slate-300 shadow-sm">{key}</kbd>
                                {label}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
