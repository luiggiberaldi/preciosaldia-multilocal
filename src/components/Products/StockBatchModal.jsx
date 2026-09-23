import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Search, TrendingUp, TrendingDown, Check, Package, X, AlertTriangle, Minus, Plus, Boxes, Edit3 } from 'lucide-react';
import { showToast } from '../Toast';
import { CATEGORY_COLORS } from '../../config/categories';
import { storageService } from '../../utils/storageService';
import { isGranelProduct, granelUnitLabel, parseStockInput, adjustStockValue, formatStockDisplay } from '../../utils/granel'; // GRANEL-001

// ─── FILA DEL CATÁLOGO (PICKER LIMPIO CON CHECKMARK) ───
function CatalogRow({ p, isSelected, direction, onToggle }) {
    const stock = p.stock ?? 0;
    const lowAlert = p.lowStockAlert ?? 5;
    const isLow = stock <= lowAlert;
    const unitsPerPkg = (p.unitsPerPackage ?? 1);
    const hasBulk = unitsPerPkg > 1;

    return (
        <div
            onClick={() => onToggle(p.id)}
            className={`flex items-center justify-between gap-3 px-4 py-3 cursor-pointer transition-all border-b border-slate-100 dark:border-slate-800/40 select-none ${
                isSelected
                    ? direction === 'ingreso'
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-l-4 border-l-emerald-500'
                        : 'bg-rose-50/70 dark:bg-rose-950/30 border-l-4 border-l-rose-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
            }`}
        >
            <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold truncate transition-colors ${
                    isSelected ? 'text-slate-900 dark:text-white font-black' : 'text-slate-700 dark:text-slate-200'
                }`}>
                    {p.name}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${
                        isLow
                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-800/80'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200/60 dark:border-slate-700'
                    }`}>
                        Stock: {formatStockDisplay(stock, isGranelProduct(p))}
                    </span>
                    {isGranelProduct(p) && (
                        <span className="text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-lg border border-amber-200/60 dark:border-amber-800/60">
                            A granel ({granelUnitLabel(p)})
                        </span>
                    )}
                    {hasBulk && (
                        <span className="text-[9px] font-bold text-brand bg-brand-light dark:bg-slate-800 dark:text-brand px-2 py-0.5 rounded-lg border border-brand/20">
                            {unitsPerPkg} uds/bulto
                        </span>
                    )}
                    {p.barcode && (
                        <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500">
                            {p.barcode}
                        </span>
                    )}
                </div>
            </div>

            {/* Checkmark animado si está seleccionado, o botón + si no */}
            <div className="shrink-0">
                {isSelected ? (
                    <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-sm transition-transform active:scale-90 ${
                            direction === 'ingreso' ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                        title="Seleccionado (toca para desmarcar)"
                    >
                        <Check size={16} strokeWidth={3} />
                    </div>
                ) : (
                    <div
                        className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:bg-brand-light hover:text-brand hover:border-brand/30 transition-all active:scale-90"
                        title="Toca para seleccionar"
                    >
                        <Plus size={16} strokeWidth={2.5} />
                    </div>
                )}
            </div>
        </div>
    );
}

const QUICK_REASONS = [
    'Merma / Dañado',
    'Vencimiento',
    'Consumo Interno',
    'Devolución',
    'Error de Conteo'
];

// ─── FILA EN AJUSTE (VISTA DE CONTROL DE CANTIDAD) ───
function AdjustRow({ p, qty, direction, adjUnit, tempPkgSize, onSetQty, onSetAdjUnit, onSetTempPkgSize, onRemove }) {
    const [isEditingQty, setIsEditingQty] = useState(false);
    const [draftQty, setDraftQty] = useState('');
    const prevQtyRef = useRef(qty);

    const handleFocusQty = () => {
        if (isEditingQty) return;
        prevQtyRef.current = qty;
        setIsEditingQty(true);
        setDraftQty('');
    };

    const isGranel = isGranelProduct(p);
    const unitLabel = isGranel ? granelUnitLabel(p) : 'ud';

    const handleChangeQty = (e) => {
        const val = e.target.value;
        setDraftQty(val);
        const parsed = parseStockInput(val, isGranel);
        if (parsed !== null && parsed >= 0) {
            onSetQty(p.id, parsed);
        }
    };

    const handleBlurQty = () => {
        setIsEditingQty(false);
        if (draftQty.trim() === '') {
            onSetQty(p.id, prevQtyRef.current);
        } else {
            const parsed = parseStockInput(draftQty, isGranel);
            if (parsed === null || parsed < 0) {
                onSetQty(p.id, prevQtyRef.current);
            } else {
                onSetQty(p.id, parsed);
            }
        }
    };

    const handleKeyDownQty = (e) => {
        if (e.key === 'Enter') {
            e.target.blur();
        }
    };

    const stock = p.stock ?? 0;
    // Usar el tamaño temporal si existe (editado inline), sino el del producto
    const storedUpp = (p.unitsPerPackage ?? 1) > 1 ? (p.unitsPerPackage ?? 1) : 1;
    const unitsPerPkg = tempPkgSize > 1 ? tempPkgSize : storedUpp;
    const hasBulk = unitsPerPkg > 1;

    // Delta y stock nuevo calculados correctamente según la unidad elegida
    // GRANEL-001: aritmética sin drift; granel admite decimales hasta 3 decimales.
    const delta = hasBulk && adjUnit === 'lotes' ? qty * unitsPerPkg : qty;
    const allowNegative = typeof window !== 'undefined' && localStorage.getItem('allow_negative_stock') === 'true';
    const isExcessEgreso = direction === 'egreso' && delta > stock && !allowNegative;
    const newStock = direction === 'ingreso'
        ? adjustStockValue(stock, delta, isGranel)
        : (allowNegative ? adjustStockValue(stock, -delta, isGranel) : Math.max(0, adjustStockValue(stock, -delta, isGranel)));

    // Label del cambio — GRANEL-001: muestra la unidad real para granel (+2.5 kg)
    const deltaLabel = hasBulk && adjUnit === 'lotes'
        ? `${direction === 'ingreso' ? '+' : '-'}${qty} bulto${qty !== 1 ? 's' : ''} de ${unitsPerPkg} uds`
        : isGranel
            ? `${direction === 'ingreso' ? '+' : '-'}${formatStockDisplay(delta, true)} ${unitLabel}`
            : `${direction === 'ingreso' ? '+' : '-'}${delta} ud${delta !== 1 ? 's' : ''}`;

    // Cuantos bultos tiene en inventario ahora
    const currentBultos = hasBulk ? Math.floor(stock / unitsPerPkg) : null;

    const inputVal = tempPkgSize > 0 ? tempPkgSize : (storedUpp > 1 ? storedUpp : '');

    return (
        <div className={`px-4 py-3 border-b transition-colors ${
            isExcessEgreso
                ? 'bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-900/50'
                : 'bg-slate-50/30 dark:bg-slate-900/10 border-slate-100 dark:border-slate-800/40'
        }`}>
            {/* Fila superior: nombre + controles */}
            <div className="flex items-start justify-between gap-3">
                {/* Info del producto */}
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-800 dark:text-slate-200 truncate">{p.name}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] font-black text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60">
                            Stock: {formatStockDisplay(stock, isGranel)}
                        </span>
                        <span className={`text-[11px] font-black flex items-center gap-0.5 ${
                            isExcessEgreso
                                ? 'text-red-600 dark:text-red-400'
                                : direction === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}>
                            → {formatStockDisplay(newStock, isGranel)}
                        </span>
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${
                            direction === 'ingreso'
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800'
                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-800'
                        }`}>
                            ({deltaLabel})
                        </span>
                        {isExcessEgreso && (
                            <span className="text-[9px] font-black text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-950/70 px-1.5 py-0.5 rounded border border-red-300 dark:border-red-800 flex items-center gap-0.5">
                                <AlertTriangle size={9} /> Stock insuficiente
                            </span>
                        )}
                        {currentBultos !== null && (
                            <span className="text-[9px] font-black text-brand bg-brand-light/75 dark:bg-slate-800 dark:text-brand px-2 py-0.5 rounded border border-brand/20">
                                {currentBultos} bulto{currentBultos !== 1 ? 's' : ''} actuales
                            </span>
                        )}
                    </div>
                </div>

                {/* Controles de cantidad */}
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800/70 p-0.5 rounded-full border border-slate-200/50 dark:border-slate-700/50">
                        <button
                            type="button"
                            onClick={() => onSetQty(p.id, adjustStockValue(qty, -1, isGranel))}
                            disabled={qty <= 0}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-red-500 disabled:opacity-30 transition-colors"
                        >
                            <Minus size={12} strokeWidth={3} />
                        </button>
                        <input
                            type="number"
                            min="0"
                            step={isGranel ? 'any' : '1'}
                            inputMode={isGranel ? 'decimal' : 'numeric'}
                            value={isEditingQty ? draftQty : (qty || '')}
                            placeholder={String(prevQtyRef.current || qty || 0)}
                            onFocus={handleFocusQty}
                            onClick={handleFocusQty}
                            onChange={handleChangeQty}
                            onBlur={handleBlurQty}
                            onKeyDown={handleKeyDownQty}
                            className="w-10 h-7 text-center text-xs font-black bg-transparent border-none outline-none focus:ring-2 focus:ring-brand/40 rounded-md text-slate-800 dark:text-white placeholder:text-slate-400/50 dark:placeholder:text-slate-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                            type="button"
                            onClick={() => onSetQty(p.id, adjustStockValue(qty, 1, isGranel))}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-emerald-500 transition-colors"
                        >
                            <Plus size={12} strokeWidth={3} />
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => onRemove(p.id)}
                        className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/20 flex items-center justify-center text-red-500 hover:bg-red-100 transition-colors active:scale-90"
                        title="Quitar de la lista"
                    >
                        <X size={14} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Fila inferior: configurador inline de tamano + toggle Uds/Bultos */}
            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                {/* Input inline de tamano de caja/bulto — siempre visible */}
                <div className="flex items-center gap-1.5">
                    <Edit3 size={11} className="text-slate-500 dark:text-slate-400 shrink-0" />
                    <span className="text-[10px] text-slate-700 dark:text-slate-200 font-extrabold">Uds/bulto:</span>
                    <input
                        type="number"
                        min="1"
                        step="1"
                        value={inputVal}
                        placeholder="—"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            onSetTempPkgSize(p.id, val);
                            if (val > 1 && adjUnit !== 'lotes') {
                                onSetAdjUnit(p.id, 'lotes');
                            }
                            if (val <= 1) {
                                onSetAdjUnit(p.id, 'uds');
                            }
                        }}
                        className="w-12 h-6 text-center text-xs font-black bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 transition-all text-slate-900 dark:text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                </div>

                {/* Toggle Uds / Bultos — solo si tiene tamano valido */}
                {hasBulk && (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onSetAdjUnit(p.id, 'uds')}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all border ${
                                adjUnit === 'uds'
                                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100 shadow-sm'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-slate-500 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            Uds
                        </button>
                        <button
                            type="button"
                            onClick={() => onSetAdjUnit(p.id, 'lotes')}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all border ${
                                adjUnit === 'lotes'
                                    ? 'bg-brand text-white border-brand shadow-sm shadow-brand/20'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-brand hover:text-brand dark:hover:text-brand-light'
                            }`}
                        >
                            Bultos ({unitsPerPkg} uds)
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function StockBatchModal({
    isOpen,
    onClose,
    products,
    categories,
    adjustStock,
    setProducts,
    triggerHaptic,
}) {
    const [direction, setDirection] = useState('ingreso');
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('todos');
    const [adjustments, setAdjustments] = useState({});
    const [adjustmentUnits, setAdjustmentUnits] = useState({});
    const [tempPackageSizes, setTempPackageSizes] = useState({});
    const [note, setNote] = useState('');
    const [activeTab, setActiveTab] = useState('catalog');
    const [isApplying, setIsApplying] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const categoryScrollRef = useRef(null);
    const listRef = useRef(null);

    const allProducts = useMemo(() =>
        (products || []).filter(p => !p.isCombo),
    [products]);

    const getCategoryProductCount = (catId) => {
        if (catId === 'todos') return allProducts.length;
        return allProducts.filter(p => p.category === catId).length;
    };

    const selectedProducts = useMemo(() =>
        allProducts.filter(p => p.id in adjustments)
            .sort((a, b) => a.name.localeCompare(b.name)),
    [allProducts, adjustments]);

    const getEffectiveUpp = useCallback((p) => {
        const temp = tempPackageSizes[p.id] || 0;
        if (temp > 1) return temp;
        const stored = p.unitsPerPackage ?? 1;
        return stored > 1 ? stored : 1;
    }, [tempPackageSizes]);

    const activeAdjustments = useMemo(() =>
        Object.entries(adjustments)
            .filter(([, qty]) => qty > 0)
            .map(([productId, qty]) => {
                const p = allProducts.find(x => x.id === productId);
                const unitsPerPkg = getEffectiveUpp(p);
                const adjUnit = adjustmentUnits[productId] || (unitsPerPkg > 1 ? 'lotes' : 'uds');
                const deltaUnits = (unitsPerPkg > 1 && adjUnit === 'lotes') ? qty * unitsPerPkg : qty;
                return { productId, qty, adjUnit, unitsPerPkg, deltaUnits, p };
            }),
    [adjustments, adjustmentUnits, allProducts, getEffectiveUpp]);

    const totalItems = activeAdjustments.reduce((sum, { deltaUnits }) => sum + deltaUnits, 0);
    // GRANEL-001: ¿hay al menos un producto a granel en el ajuste? (suma decimal posible)
    const hasGranelInAdjust = activeAdjustments.some(({ p }) => isGranelProduct(p));

    const catalogProducts = useMemo(() => {
        const term = search.toLowerCase().trim();
        return allProducts
            .filter(p => {
                const matchesCat = selectedCategory === 'todos' || p.category === selectedCategory;
                const matchesSearch = !term ||
                    p.name.toLowerCase().includes(term) ||
                    (p.barcode && p.barcode.toLowerCase().includes(term));
                return matchesCat && matchesSearch;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [allProducts, search, selectedCategory]);

    const setQty = (productId, val) => {
        const p = allProducts.find(x => x.id === productId);
        const parsed = parseStockInput(val, isGranelProduct(p));
        const num = Math.max(0, parsed ?? 0);
        setAdjustments(prev => ({ ...prev, [productId]: num }));
    };

    const setAdjUnit = useCallback((productId, unit) => {
        setAdjustmentUnits(prev => ({ ...prev, [productId]: unit }));
    }, []);

    const setTempPkgSize = useCallback((productId, size) => {
        setTempPackageSizes(prev => ({ ...prev, [productId]: size }));
    }, []);

    const removeProduct = useCallback((productId) => {
        triggerHaptic && triggerHaptic();
        setAdjustments(prev => {
            const next = { ...prev };
            delete next[productId];
            return next;
        });
    }, [triggerHaptic]);

    const toggleProduct = useCallback((productId) => {
        triggerHaptic && triggerHaptic();
        if (productId in adjustments) {
            setAdjustments(prev => {
                const next = { ...prev };
                delete next[productId];
                return next;
            });
        } else {
            const p = allProducts.find(x => x.id === productId);
            const temp = tempPackageSizes[productId] || 0;
            const stored = p?.unitsPerPackage ?? 1;
            const unitsPerPkg = temp > 1 ? temp : stored > 1 ? stored : 1;
            if (unitsPerPkg > 1) {
                setAdjustmentUnits(prev => ({ ...prev, [productId]: 'lotes' }));
            }
            setAdjustments(prev => ({ ...prev, [productId]: 1 }));
        }
    }, [triggerHaptic, adjustments, allProducts, tempPackageSizes]);

    const needsNote = direction === 'egreso' && !note.trim();

    const handleApply = async () => {
        if (activeAdjustments.length === 0) {
            showToast('Ingresa al menos 1 unidad para aplicar el ajuste', 'error');
            triggerHaptic && triggerHaptic();
            return;
        }
        if (needsNote) {
            showToast('Escribe un motivo para el egreso', 'error');
            triggerHaptic && triggerHaptic();
            return;
        }

        // Guardarraíl 1: Control estricto de stock negativo en egresos
        const allowNegativeStock = typeof window !== 'undefined' && localStorage.getItem('allow_negative_stock') === 'true';
        if (direction === 'egreso' && !allowNegativeStock) {
            const invalidItems = activeAdjustments.filter(({ deltaUnits, p }) => deltaUnits > (p?.stock ?? 0));
            if (invalidItems.length > 0) {
                const names = invalidItems.map(i => i.p?.name || 'Producto').slice(0, 2).join(', ');
                const extra = invalidItems.length > 2 ? ` y ${invalidItems.length - 2} más` : '';
                showToast(`Stock insuficiente en: ${names}${extra}`, 'error');
                triggerHaptic && triggerHaptic();
                return;
            }
        }

        if (!showConfirm) {
            setShowConfirm(true);
            return;
        }
        setIsApplying(true);
        triggerHaptic && triggerHaptic();

        try {
            for (const { productId, deltaUnits } of activeAdjustments) {
                const delta = direction === 'ingreso' ? deltaUnits : -deltaUnits;
                await adjustStock(productId, delta);
            }

            // Guardarraíl 2: Persistir permanentemente los tamaños de empaque editados inline
            const pkgEntries = Object.entries(tempPackageSizes).filter(([, size]) => size > 1);
            if (pkgEntries.length > 0 && setProducts) {
                setProducts(prev => {
                    const updated = prev.map(p => {
                        const newSize = tempPackageSizes[p.id];
                        if (newSize && newSize > 1) return { ...p, unitsPerPackage: newSize };
                        return p;
                    });
                    try {
                        storageService.setItem('bodega_products_v1', updated);
                    } catch (err) {
                        console.error('Error al persistir unidades por bulto en storageService:', err);
                    }
                    return updated;
                });
            }

            showToast(
                `${direction === 'ingreso' ? 'Ingreso' : 'Egreso'} masivo completado con éxito`,
                'success'
            );

            setAdjustments({});
            setAdjustmentUnits({});
            setTempPackageSizes({});
            setNote('');
            setSearch('');
            setSelectedCategory('todos');
            setActiveTab('catalog');
            setShowConfirm(false);
            onClose();
        } catch (e) {
            showToast('Error al aplicar ajuste: ' + e.message, 'error');
        } finally {
            setIsApplying(false);
        }
    };

    const handleClose = () => {
        setAdjustments({});
        setAdjustmentUnits({});
        setTempPackageSizes({});
        setSearch('');
        setNote('');
        setSelectedCategory('todos');
        setActiveTab('catalog');
        setShowConfirm(false);
        onClose();
    };

    const maxStock = useMemo(() =>
        Math.max(1, ...allProducts.map(p => p.stock ?? 0)),
    [allProducts]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="absolute inset-0" onClick={handleClose} />

            <div className="relative bg-white dark:bg-slate-900 w-full max-w-md md:max-w-2xl lg:max-w-3xl rounded-t-3xl sm:rounded-3xl shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 flex flex-col max-h-[92vh] sm:max-h-[85vh]">

                {/* Header */}
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50 rounded-t-3xl shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-brand-light dark:bg-slate-800 text-brand">
                            <Boxes size={16} strokeWidth={2.5} />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tight">
                            {showConfirm ? 'Confirmar Ajuste' : 'Ajuste de Inventario'}
                        </h3>
                    </div>
                    <button onClick={handleClose} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors active:scale-90">
                        <X size={20} />
                    </button>
                </div>

                {showConfirm ? (
                    <div className="p-5 space-y-4 overflow-y-auto flex-1 scrollbar-hide">
                        <div className={`p-4 rounded-2xl border ${
                            direction === 'ingreso'
                                ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200/50 dark:border-emerald-800/30'
                                : 'bg-red-50/50 dark:bg-red-900/10 border-red-200/50 dark:border-red-800/30'
                        }`}>
                            <p className={`text-xs font-black uppercase tracking-widest mb-3.5 ${
                                direction === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                            }`}>
                                {direction === 'ingreso' ? 'Ingreso' : 'Egreso'} masivo - {activeAdjustments.length} prod - {formatStockDisplay(totalItems, hasGranelInAdjust)} uds totales
                            </p>
                            <div className="space-y-2.5 max-h-[42vh] overflow-y-auto scrollbar-hide pr-1">
                                {activeAdjustments.map(({ productId, qty, adjUnit, unitsPerPkg, deltaUnits, p }) => {
                                    const stock = p?.stock ?? 0;
                                    const allowNegative = typeof window !== 'undefined' && localStorage.getItem('allow_negative_stock') === 'true';
                                    const isExcess = direction === 'egreso' && deltaUnits > stock && !allowNegative;
                                    const newStock = direction === 'ingreso'
                                        ? stock + deltaUnits
                                        : (allowNegative ? stock - deltaUnits : Math.max(0, stock - deltaUnits));
                                    const isBulkMode = unitsPerPkg > 1 && adjUnit === 'lotes';
                                    const hasInlineEdit = (tempPackageSizes[productId] || 0) > 1;
                                    const rowIsGranel = isGranelProduct(p);
                                    const rowUnitLabel = rowIsGranel ? granelUnitLabel(p) : 'ud';

                                    return (
                                        <div key={productId} className={`py-2 border-b border-slate-100 dark:border-slate-800/40 ${isExcess ? 'bg-red-50/60 dark:bg-red-950/30 px-2 rounded-xl' : ''}`}>
                                            <div className="flex items-start justify-between gap-3">
                                                <span className="font-bold text-xs text-slate-650 dark:text-slate-300 truncate flex-1">{p?.name || '?'}</span>
                                                <span className="font-black text-xs shrink-0 text-slate-700 dark:text-slate-350">
                                                    {formatStockDisplay(stock, rowIsGranel)} <span className={direction === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-rose-600 dark:text-rose-400 font-black'}>→ {formatStockDisplay(newStock, rowIsGranel)}</span>
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-2 mt-0.5">
                                                <p className={`text-[10px] font-black ${direction === 'ingreso' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                                                    {isBulkMode
                                                        ? `${direction === 'ingreso' ? '+' : '-'}${qty} bulto${qty !== 1 ? 's' : ''} x ${unitsPerPkg} uds = ${direction === 'ingreso' ? '+' : '-'}${deltaUnits} uds`
                                                        : rowIsGranel
                                                            ? `${direction === 'ingreso' ? '+' : '-'}${formatStockDisplay(deltaUnits, true)} ${rowUnitLabel}`
                                                            : `${direction === 'ingreso' ? '+' : '-'}${deltaUnits} ud${deltaUnits !== 1 ? 's' : ''}`
                                                    }
                                                </p>
                                                {isExcess && (
                                                    <span className="text-[9px] font-black text-red-600 dark:text-red-400 flex items-center gap-0.5">
                                                        <AlertTriangle size={10} /> Supera stock disponible ({stock})
                                                    </span>
                                                )}
                                            </div>
                                            {hasInlineEdit && (
                                                <p className="text-[9px] text-brand dark:text-brand-light font-black mt-0.5">
                                                    Tamaño de empaque guardado: {tempPackageSizes[productId]} uds/bulto
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {note.trim() && (
                                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400"><span className="font-bold">Motivo:</span> {note}</p>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowConfirm(false)}
                                className="flex-1 py-3.5 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all text-sm border border-slate-200 dark:border-slate-700"
                            >
                                Volver
                            </button>
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={isApplying}
                                className={`flex-[2] py-3.5 text-white font-bold rounded-xl active:scale-[0.98] transition-all text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
                                    direction === 'ingreso'
                                        ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20'
                                        : 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                                }`}
                            >
                                {isApplying ? 'Aplicando...' : `Confirmar ${direction === 'ingreso' ? 'Ingreso' : 'Egreso'}`}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="p-4 sm:p-5 space-y-3 sm:space-y-4 overflow-y-auto flex-1 scrollbar-hide">
                            {/* Direction Toggle */}
                            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setDirection('ingreso')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-xl transition-all ${
                                        direction === 'ingreso'
                                            ? 'bg-white dark:bg-slate-900 shadow-md text-emerald-600 dark:text-emerald-400 font-black'
                                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-400'
                                    }`}
                                >
                                    <TrendingUp size={16} strokeWidth={2.5} /> Ingreso
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDirection('egreso')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-xl transition-all ${
                                        direction === 'egreso'
                                            ? 'bg-white dark:bg-slate-900 shadow-md text-red-500 font-black'
                                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-400'
                                    }`}
                                >
                                    <TrendingDown size={16} strokeWidth={2.5} /> Egreso
                                </button>
                            </div>

                            {/* Search Bar */}
                            <div className="relative shrink-0">
                                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar producto por nombre o código de barras..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 pl-10 pr-10 text-xs text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 transition-all shadow-sm"
                                />
                                {search && (
                                    <button
                                        type="button"
                                        onClick={() => setSearch('')}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full transition-colors active:scale-90"
                                        title="Limpiar búsqueda"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>

                            {/* Category Filter Chips */}
                            <div className="relative w-full shrink-0">
                                <div
                                    ref={categoryScrollRef}
                                    className="flex gap-1.5 overflow-x-auto py-1 pl-0.5 pr-2 scrollbar-hide scroll-smooth"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setSelectedCategory('todos')}
                                        className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                                            selectedCategory === 'todos'
                                                ? 'bg-brand text-white border-brand shadow-sm font-black'
                                                : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                                        }`}
                                    >
                                        Todos
                                        <span className={`ml-1 text-[9px] ${selectedCategory === 'todos' ? 'opacity-90' : 'text-slate-400'}`}>
                                            - {getCategoryProductCount('todos')}
                                        </span>
                                    </button>

                                    {categories.filter(c => c.id !== 'todos').map(cat => {
                                        const count = getCategoryProductCount(cat.id);
                                        const isActive = selectedCategory === cat.id;
                                        const catColorClass = CATEGORY_COLORS[cat.color] || 'bg-brand text-white border-brand';
                                        return (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setSelectedCategory(cat.id)}
                                                className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                                                    isActive
                                                        ? `${catColorClass} shadow-sm border-transparent font-black`
                                                        : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                                                }`}
                                            >
                                                {cat.label}
                                                <span className={`ml-1 text-[9px] ${isActive ? 'opacity-90' : 'text-slate-400 dark:text-slate-500'}`}>
                                                    - {count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Navigation Tabs */}
                            <div className="flex border-b border-slate-100 dark:border-slate-800 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('catalog')}
                                    className={`flex-1 pb-2.5 text-xs font-bold transition-all border-b-2 text-center ${
                                        activeTab === 'catalog'
                                            ? 'border-brand text-brand font-black'
                                            : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600'
                                    }`}
                                >
                                    Catálogo ({catalogProducts.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('adjusting')}
                                    className={`flex-1 pb-2.5 text-xs font-bold transition-all border-b-2 text-center flex items-center justify-center gap-1.5 ${
                                        activeTab === 'adjusting'
                                            ? 'border-brand text-brand font-black'
                                            : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600'
                                    }`}
                                >
                                    En ajuste
                                    {selectedProducts.length > 0 && (
                                        <span className={`px-1.5 py-0.5 text-[9px] font-black rounded-full ${
                                            direction === 'ingreso'
                                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                                                : 'bg-red-100 dark:bg-red-950 text-red-500'
                                        }`}>
                                            {selectedProducts.length}
                                        </span>
                                    )}
                                </button>
                            </div>

                            {/* Product List */}
                            <div ref={listRef} className="max-h-[50vh] min-h-[26vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col scrollbar-hide">
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {activeTab === 'catalog' ? (
                                        catalogProducts.length === 0 ? (
                                            <div className="py-12 text-center text-xs text-slate-400 font-medium">
                                                <Package size={22} className="mx-auto mb-2 opacity-40" />
                                                Sin productos disponibles
                                            </div>
                                        ) : catalogProducts.map(p => (
                                            <CatalogRow
                                                key={p.id}
                                                p={p}
                                                isSelected={p.id in adjustments}
                                                direction={direction}
                                                onToggle={toggleProduct}
                                            />
                                        ))
                                    ) : (
                                        selectedProducts.length === 0 ? (
                                            <div className="py-12 text-center text-xs text-slate-400 font-medium">
                                                <Boxes size={22} className="mx-auto mb-2 opacity-40 text-slate-300 dark:text-slate-700" />
                                                No has seleccionado productos
                                            </div>
                                        ) : selectedProducts.map(p => {
                                            const effUpp = getEffectiveUpp(p);
                                            const defaultUnit = effUpp > 1 ? 'lotes' : 'uds';
                                            const adjUnit = adjustmentUnits[p.id] || defaultUnit;
                                            const tempPkgSize = tempPackageSizes[p.id] || 0;
                                            return (
                                                <AdjustRow
                                                    key={p.id}
                                                    p={p}
                                                    qty={adjustments[p.id] || 0}
                                                    direction={direction}
                                                    adjUnit={adjUnit}
                                                    tempPkgSize={tempPkgSize}
                                                    onSetQty={setQty}
                                                    onSetAdjUnit={setAdjUnit}
                                                    onSetTempPkgSize={setTempPkgSize}
                                                    onRemove={removeProduct}
                                                />
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Nota y Motivos Rápidos — en pestaña de ajuste con productos */}
                            {activeTab === 'adjusting' && selectedProducts.length > 0 && (
                                <div className="space-y-2 shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-150">
                                    {direction === 'egreso' && (
                                        <div className="space-y-1">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                                Motivo rápido:
                                            </span>
                                            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                                                {QUICK_REASONS.map(reason => (
                                                    <button
                                                        key={reason}
                                                        type="button"
                                                        onClick={() => setNote(reason)}
                                                        className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                                                            note === reason
                                                                ? 'bg-rose-500 text-white border-rose-500 shadow-xs'
                                                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                                                        }`}
                                                    >
                                                        {reason}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={note}
                                            onChange={(e) => setNote(e.target.value)}
                                            placeholder={direction === 'egreso' ? 'Escribe o selecciona un motivo (obligatorio)' : 'Nota / motivo (opcional)'}
                                            className={`w-full bg-slate-50 dark:bg-slate-950 border rounded-2xl py-2.5 px-4 text-xs text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 transition-all ${
                                                direction === 'egreso' && !note.trim() && activeAdjustments.length > 0
                                                    ? 'border-red-300 dark:border-red-800 focus:ring-red-500/30'
                                                    : 'border-slate-200 dark:border-slate-800'
                                            }`}
                                        />
                                        {direction === 'egreso' && !note.trim() && activeAdjustments.length > 0 && (
                                            <p className="text-[10px] text-red-500 dark:text-red-400 font-bold mt-1.5 ml-1 flex items-center gap-1">
                                                <AlertTriangle size={10} /> Motivo requerido para registrar la salida
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 rounded-b-3xl shrink-0">
                            <button
                                type="button"
                                onClick={activeTab === 'catalog' && selectedProducts.length > 0 ? () => setActiveTab('adjusting') : handleApply}
                                disabled={activeAdjustments.length === 0}
                                className={`w-full py-3.5 font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 ${
                                    activeAdjustments.length === 0
                                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200/50 dark:border-slate-700/50'
                                        : direction === 'ingreso'
                                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                                            : 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/25'
                                }`}
                            >
                                {activeAdjustments.length > 0 && <Check size={16} />}
                                {activeAdjustments.length === 0
                                    ? 'Toca productos para seleccionar'
                                    : activeTab === 'catalog'
                                        ? `Configurar cantidades (${selectedProducts.length} producto${selectedProducts.length !== 1 ? 's' : ''}) →`
                                        : `Aplicar ${direction === 'ingreso' ? 'Ingreso' : 'Egreso'} (${totalItems} uds)`
                                }
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
