import React, { useState, useEffect, useRef } from 'react';
import { Store, Plus, Trash2, Pencil, Search, LayoutGrid, List, Percent, CheckSquare, Boxes, TrendingUp, DollarSign, PieChart, ChevronDown, ChevronUp, AlertTriangle, X, Wrench } from 'lucide-react';
import { CATEGORY_COLORS } from '../../config/categories';
import { useProductContext } from '../../context/ProductContext';
import { formatBs, formatCop } from '../../utils/calculatorUtils';

const ProductsToolbar = ({
    products,
    categories,
    activeCategory,
    searchTerm,
    viewMode,
    selectedIds,
    lowStockCount,
    isCajero,
    categoryScrollRef,
    // Handlers
    handleSetSearchTerm,
    handleSetActiveCategory,
    toggleViewMode,
    setSelectedIds,
    setIsModalOpen,
    setIsBulkPriceOpen,
    setIsDeleteAllModalOpen,
    setIsCategoryManagerOpen,
    setIsStockBatchOpen,
    triggerHaptic,
    onSelectAllToast,
}) => {
    const [showLeftFade, setShowLeftFade] = useState(false);
    const { inventoryFinancials, effectiveRate, copEnabled, tasaCop } = useProductContext();
    const [showFinancials, setShowFinancials] = useState(false);
    const [showToolsMenu, setShowToolsMenu] = useState(false);
    // Posición fixed calculada al abrir: en móviles angostos el ancla `absolute right-0`
    // hacía que el menú de 256px se saliera del viewport por la izquierda.
    const [toolsMenuPos, setToolsMenuPos] = useState(null);
    const toolsMenuRef = useRef(null);

    // Cerrar menú de herramientas al hacer clic fuera
    useEffect(() => {
        if (!showToolsMenu) return;
        const handleClickOutside = (e) => {
            if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target)) {
                setShowToolsMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [showToolsMenu]);

    // El menú es fixed: si la página hace scroll o el viewport cambia, se
    // despegaría del botón → cerrarlo en lugar de quedar flotando huérfano.
    useEffect(() => {
        if (!showToolsMenu) return;
        const close = () => setShowToolsMenu(false);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [showToolsMenu]);

    // Abrir midiendo el botón: el menú se pega debajo y se ajusta (clamp) para
    // no desbordar nunca los bordes izquierdo/derecho del viewport.
    const toggleToolsMenu = () => {
        if (!showToolsMenu) {
            const rect = toolsMenuRef.current?.getBoundingClientRect();
            if (rect) {
                const menuWidth = Math.min(256, window.innerWidth - 16);
                const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
                setToolsMenuPos({ left, top: rect.bottom + 6 });
            }
        }
        setShowToolsMenu(prev => !prev);
    };

    const {
        totalRetailUsd = 0,
        totalCostUsd = 0,
        totalProfitUsd = 0,
        marginPct = 0,
        markupPct = 0
    } = inventoryFinancials || {};

    const handleScroll = (e) => {
        setShowLeftFade(e.target.scrollLeft > 4);
    };

    // Wheel → scroll horizontal en el carril de categorías sin advertencia de evento pasivo
    useEffect(() => {
        const el = categoryScrollRef?.current;
        if (!el) return;
        const handler = (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                el.scrollLeft += e.deltaY;
            }
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [categoryScrollRef]);

    // Helper to get count of products in a category
    const getCategoryProductCount = (catId) => {
        if (catId === 'todos') return products.length;
        return products.filter(p => p.category === catId).length;
    };

    const isAllSelected = products.length > 0 && selectedIds && selectedIds.size === products.length;
    const isLowStockActive = activeCategory === 'bajo-stock';

    return (
        <div className="shrink-0 mb-3 space-y-2.5">
            {/* ═══════════════════════════════════════════════════════════════════
                NIVEL 1: CABECERA MAESTRA (Identidad, Métricas y Acciones)
            ═══════════════════════════════════════════════════════════════════ */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
                {/* LADO IZQUIERDO: Tienda + Título + Conteo + Valoración + Alertas */}
                <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 dark:bg-brand/20 flex items-center justify-center text-brand shrink-0 shadow-2xs">
                        <Store size={18} strokeWidth={2.3} />
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-white tracking-tight">
                            Inventario
                        </h2>
                        <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                            {products.length} uds
                        </span>
                    </div>

                    {/* Chip de Valoración Financiera (Admin) */}
                    {!isCajero && (
                        <button
                            type="button"
                            onClick={() => {
                                setShowFinancials(!showFinancials);
                                triggerHaptic && triggerHaptic();
                            }}
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all border shadow-2xs active:scale-95 ${
                                showFinancials
                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                    : 'bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                            }`}
                            title="Ver desglose de costos, ganancias y márgenes"
                        >
                            <TrendingUp size={12} strokeWidth={2.5} />
                            <span>Valoración: ${totalRetailUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            {showFinancials ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                    )}

                    {/* Chip de Alerta de Bajo Stock (Toggle) */}
                    {lowStockCount > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                handleSetActiveCategory(isLowStockActive ? 'todos' : 'bajo-stock');
                                triggerHaptic && triggerHaptic();
                            }}
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs active:scale-95 border ${
                                isLowStockActive
                                    ? 'bg-amber-500 text-white border-amber-600 shadow-sm font-black'
                                    : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-800/40 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                            }`}
                            title={isLowStockActive ? "Quitar filtro de bajo stock" : "Filtrar productos con stock agotado o por agotarse"}
                        >
                            <AlertTriangle size={12} className={isLowStockActive ? 'text-white shrink-0' : 'text-amber-500 shrink-0'} />
                            <span>{lowStockCount} bajo stock</span>
                            {isLowStockActive && <X size={11} className="ml-0.5 opacity-80" />}
                        </button>
                    )}
                </div>

                {/* LADO DERECHO: Herramientas en Lote + Toggle Vista + Botón Nuevo */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto sm:ml-0">
                    {products.length > 0 && !isCajero && (
                        <div className="relative" ref={toolsMenuRef}>
                            <button
                                type="button"
                                onClick={() => {
                                    toggleToolsMenu();
                                    triggerHaptic && triggerHaptic();
                                }}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 sm:py-2 rounded-xl text-xs font-bold transition-all border shadow-2xs active:scale-95 cursor-pointer ${
                                    showToolsMenu
                                        ? 'bg-slate-200/90 dark:bg-slate-700 text-slate-900 dark:text-white border-slate-300 dark:border-slate-600'
                                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                                title="Herramientas y acciones masivas"
                            >
                                <Wrench size={14} className="text-slate-500 dark:text-slate-400" />
                                <span className="hidden sm:inline">Herramientas</span>
                                <ChevronDown size={13} className={`text-slate-400 transition-transform duration-200 ${showToolsMenu ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Dropdown Menu */}
                            {showToolsMenu && (
                                <div
                                    className="fixed z-50 w-64 max-w-[calc(100vw-1rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-1.5 animate-in fade-in zoom-in-95 duration-150"
                                    style={toolsMenuPos || undefined}
                                >
                                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                        Acciones de Inventario
                                    </div>

                                    {/* Stock Batch */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowToolsMenu(false);
                                            triggerHaptic && triggerHaptic();
                                            setIsStockBatchOpen(true);
                                        }}
                                        className="w-full flex items-start gap-2.5 p-2 rounded-xl text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer group"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                                            <Boxes size={16} strokeWidth={2} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-slate-800 dark:text-white">Ajuste de Stock por Lote</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">Ingreso o egreso masivo de mercancía</p>
                                        </div>
                                    </button>

                                    {/* Bulk Price Adjust */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowToolsMenu(false);
                                            triggerHaptic && triggerHaptic();
                                            setIsBulkPriceOpen(true);
                                        }}
                                        className="w-full flex items-start gap-2.5 p-2 rounded-xl text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer group"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                                            <Percent size={16} strokeWidth={2.2} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-slate-800 dark:text-white">Ajuste Masivo de Precios</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">Subir o bajar precios en % o dólares ($)</p>
                                        </div>
                                    </button>

                                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1 mx-1" />

                                    {/* Delete All (Danger) */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowToolsMenu(false);
                                            triggerHaptic && triggerHaptic();
                                            setIsDeleteAllModalOpen(true);
                                        }}
                                        className="w-full flex items-start gap-2.5 p-2 rounded-xl text-left hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer group"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                                            <Trash2 size={16} strokeWidth={2} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-red-600 dark:text-red-400">Borrar Todo el Inventario</p>
                                            <p className="text-[10px] text-red-500/70 dark:text-red-400/70 leading-tight">Eliminar todos los productos registrados</p>
                                        </div>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Toggle de Vista (Cuadrícula / Lista) */}
                    <button
                        type="button"
                        onClick={toggleViewMode}
                        className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-brand hover:border-brand-light transition-all active:scale-95 shadow-2xs"
                        title={viewMode === 'grid' ? 'Cambiar a vista lista' : 'Cambiar a vista cuadrícula'}
                    >
                        {viewMode === 'grid' ? <List size={15} /> : <LayoutGrid size={15} />}
                    </button>

                    {/* Botón Primario: + Nuevo Producto */}
                    {!isCajero && (
                        <button
                            type="button"
                            onClick={() => { triggerHaptic && triggerHaptic(); setIsModalOpen(true); }}
                            className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl shadow-sm hover:shadow-brand/20 transition-all active:scale-95 font-bold text-xs"
                            title="Agregar nuevo producto al catálogo"
                        >
                            <Plus size={15} strokeWidth={2.5} />
                            <span>Nuevo</span>
                        </button>
                    )}
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════════
                BANNER FINANCIERO DESPLEGABLE (Métricas Bento Grid)
            ═══════════════════════════════════════════════════════════════════ */}
            {showFinancials && !isCajero && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-sm my-2 grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Valor Total (PVP)</span>
                        <p className="text-base sm:text-lg font-outfit font-bold text-slate-800 dark:text-white mt-0.5">
                            ${totalRetailUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        {copEnabled && tasaCop > 0 ? (
                            <p className="text-[9.5px] font-semibold text-slate-400 truncate">{formatCop(totalRetailUsd * tasaCop)} COP · {formatBs(totalRetailUsd * effectiveRate)} Bs</p>
                        ) : (
                            <p className="text-[9.5px] font-semibold text-slate-400 truncate">{formatBs(totalRetailUsd * effectiveRate)} Bs</p>
                        )}
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Inversión (Costo)</span>
                        <p className="text-base sm:text-lg font-outfit font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                            ${totalCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        {copEnabled && tasaCop > 0 ? (
                            <p className="text-[9.5px] font-semibold text-slate-400 truncate">{formatCop(totalCostUsd * tasaCop)} COP · {formatBs(totalCostUsd * effectiveRate)} Bs</p>
                        ) : (
                            <p className="text-[9.5px] font-semibold text-slate-400 truncate">{formatBs(totalCostUsd * effectiveRate)} Bs</p>
                        )}
                    </div>

                    <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-100/80 dark:border-emerald-900/30">
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">Ganancia Proyectada</span>
                        <p className="text-base sm:text-lg font-outfit font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                            +${totalProfitUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        {copEnabled && tasaCop > 0 ? (
                            <p className="text-[9.5px] font-semibold text-emerald-500/80 truncate">+{formatCop(totalProfitUsd * tasaCop)} COP · {formatBs(totalProfitUsd * effectiveRate)} Bs</p>
                        ) : (
                            <p className="text-[9.5px] font-semibold text-emerald-500/80 truncate">+{formatBs(totalProfitUsd * effectiveRate)} Bs</p>
                        )}
                    </div>

                    <div className="bg-cyan-50/60 dark:bg-cyan-950/20 p-2.5 rounded-xl border border-cyan-100/80 dark:border-cyan-900/30">
                        <span className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider block">Margen de Ganancia</span>
                        <p className="text-base sm:text-lg font-outfit font-bold text-cyan-600 dark:text-cyan-400 mt-0.5">
                            {marginPct.toFixed(1)}% <span className="text-xs font-bold text-slate-400">Margen</span>
                        </p>
                        <p className="text-[9.5px] font-semibold text-cyan-500/80 truncate">{markupPct.toFixed(1)}% Markup sobre costo</p>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════
                NIVEL 2: BARRA OPERATIVA (Búsqueda + Selección + Categorías)
            ═══════════════════════════════════════════════════════════════════ */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-0.5 w-full">
                {/* Bloque Búsqueda + Selección */}
                <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                    {/* Buscador con Botón Limpiar */}
                    <div className="relative flex-1 sm:w-60 md:w-68">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Buscar producto..."
                            value={searchTerm}
                            onChange={(e) => handleSetSearchTerm(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-2 pl-9 pr-7 text-xs text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all shadow-2xs placeholder:text-slate-400"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => {
                                    handleSetSearchTerm('');
                                    triggerHaptic && triggerHaptic();
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                title="Limpiar búsqueda"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    {/* Botón Seleccionar Todo / Deseleccionar */}
                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic && triggerHaptic();
                            if (isAllSelected) {
                                setSelectedIds(new Set());
                            } else {
                                setSelectedIds(new Set(products.map(p => p.id)));
                                onSelectAllToast && onSelectAllToast();
                            }
                        }}
                        className={`shrink-0 px-2.5 py-2 rounded-xl text-[11px] font-bold border transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs ${
                            isAllSelected
                                ? 'bg-brand text-white border-brand shadow-xs font-black'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-brand-light hover:text-brand'
                        }`}
                        title={isAllSelected ? "Deseleccionar todos los productos" : "Seleccionar todos los productos visibles para acciones en lote"}
                    >
                        <CheckSquare size={13} strokeWidth={2} />
                        <span className="hidden md:inline">{isAllSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}</span>
                        <span className="md:hidden">{isAllSelected ? 'Ninguno' : 'Todos'}</span>
                    </button>
                </div>

                {/* Divisor Vertical sutil en pantallas medianas/grandes */}
                <div className="hidden sm:block h-6 w-px bg-slate-200/80 dark:bg-slate-800 shrink-0 mx-0.5" />

                {/* Carrusel Horizontal de Categorías */}
                <div className="relative flex-1 min-w-0">
                    <div
                        ref={categoryScrollRef}
                        className="flex items-center gap-1.5 overflow-x-auto py-1 pl-0.5 pr-4 scrollbar-hide scroll-smooth"
                        onScroll={handleScroll}
                    >
                        {/* Pestaña 'Todos' */}
                        <button
                            type="button"
                            onClick={() => {
                                handleSetActiveCategory('todos');
                                triggerHaptic && triggerHaptic();
                            }}
                            className={`shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all border shadow-2xs ${
                                activeCategory === 'todos'
                                    ? 'bg-brand text-white border-brand font-black shadow-xs'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                            }`}
                        >
                            Todos
                            <span className={`ml-1.5 text-[9.5px] ${activeCategory === 'todos' ? 'text-white/85' : 'text-slate-400 dark:text-slate-500'}`}>
                                · {getCategoryProductCount('todos')}
                            </span>
                        </button>

                        {/* Categorías dinámicas */}
                        {categories.map(cat => {
                            const count = getCategoryProductCount(cat.id);
                            const isActive = activeCategory === cat.id;
                            const catColorClass = CATEGORY_COLORS[cat.color] || 'bg-brand text-white border-brand';

                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => {
                                        handleSetActiveCategory(cat.id);
                                        triggerHaptic && triggerHaptic();
                                    }}
                                    className={`shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all border shadow-2xs ${
                                        isActive
                                            ? `${catColorClass} shadow-xs border-transparent font-black`
                                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                                    }`}
                                >
                                    {cat.label}
                                    <span className={`ml-1.5 text-[9.5px] ${isActive ? 'opacity-90' : 'text-slate-400 dark:text-slate-500'}`}>
                                        · {count}
                                    </span>
                                </button>
                            );
                        })}

                        {/* Botón Gestionar Categorías integrado en el carril (elimina el botón flotante desalineado) */}
                        {!isCajero && (
                            <button
                                type="button"
                                onClick={() => {
                                    triggerHaptic && triggerHaptic();
                                    setIsCategoryManagerOpen(true);
                                }}
                                className="shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all flex items-center gap-1 border border-dashed border-slate-300 dark:border-slate-700 active:scale-95 shadow-2xs"
                                title="Editar nombres, colores o crear nuevas categorías"
                            >
                                <Pencil size={11} />
                                <span>Categorías</span>
                            </button>
                        )}

                        {/* Espaciador final para permitir scroll completo */}
                        <div className="shrink-0 w-3 h-px" />
                    </div>

                    {/* Desvanecimiento izquierdo si hay scroll */}
                    {showLeftFade && (
                        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-surface-50 dark:from-surface-950 to-transparent z-10 animate-in fade-in duration-200" />
                    )}

                    {/* Desvanecimiento derecho */}
                    <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-surface-50 dark:from-surface-950 to-transparent z-10" />
                </div>
            </div>
        </div>
    );
};

export default ProductsToolbar;
