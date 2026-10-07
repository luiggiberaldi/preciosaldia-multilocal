import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Percent, Check, AlertTriangle, RotateCcw, ArrowRight, ShieldCheck, CheckSquare } from 'lucide-react';
import { logEvent } from '../../services/auditService';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { storageService } from '../../utils/storageService';
import { round2 } from '../../utils/dinero';
import { formatUsd, formatBs, formatCop } from '../../utils/calculatorUtils';
import CustomSelect from '../CustomSelect';

export default function BulkPriceAdjustModal({
    isOpen,
    onClose,
    products,
    setProducts,
    categories,
    activeCategory,
    effectiveRate,
    triggerHaptic,
    showToast,
    copEnabled,
    copPrimary,
    tasaCop,
    selectedIds = new Set(),
    onClearSelection,
}) {
    const [direction, setDirection] = useState('up'); // 'up' | 'down'
    const [percent, setPercent] = useState(10);
    const [draftPercent, setDraftPercent] = useState('10');
    const [isEditingPercent, setIsEditingPercent] = useState(false);

    // Selección de ámbito: si hay seleccionados, sugerir 'selected', sino categoría activa o 'todos'
    const initialCategory = useMemo(() => {
        if (selectedIds && selectedIds.size > 0) return 'selected';
        if (activeCategory && activeCategory !== 'todos' && activeCategory !== 'bajo-stock') return activeCategory;
        return 'todos';
    }, [selectedIds, activeCategory]);

    const [selectedCategory, setSelectedCategory] = useState(initialCategory);
    const [showConfirm, setShowConfirm] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [undoSnapshot, setUndoSnapshot] = useState(null);
    const [isUndoing, setIsUndoing] = useState(false);

    const timeoutRefs = useRef([]);

    // Cargar snapshot previo si existe al abrir el modal
    useEffect(() => {
        if (isOpen) {
            setSelectedCategory(initialCategory);
            setShowConfirm(false);
            setIsApplying(false);
            setShowSuccess(false);
            storageService.getItem('last_bulk_price_snapshot', null).then(snap => {
                if (snap && snap.timestamp) {
                    // Solo considerar válido si fue en las últimas 2 horas
                    const ageMs = Date.now() - new Date(snap.timestamp).getTime();
                    if (ageMs < 2 * 60 * 60 * 1000) {
                        setUndoSnapshot(snap);
                    } else {
                        setUndoSnapshot(null);
                    }
                } else {
                    setUndoSnapshot(null);
                }
            });
        }
        return () => timeoutRefs.current.forEach(id => clearTimeout(id));
    }, [isOpen, initialCategory]);

    // Opciones del dropdown "Aplicar a"
    const categoryOptions = useMemo(() => {
        const opts = [];
        if (selectedIds && selectedIds.size > 0) {
            opts.push({
                value: 'selected',
                label: `✓ Productos seleccionados (${selectedIds.size})`
            });
        }
        opts.push({
            value: 'todos',
            label: `Todos los productos (${(products || []).length})`
        });
        (categories || [])
            .filter(c => c.id !== 'todos')
            .forEach(cat => {
                const count = (products || []).filter(p => p.category === cat.id).length;
                if (count > 0) {
                    opts.push({ value: cat.id, label: `${cat.label} (${count})` });
                }
            });
        return opts;
    }, [products, categories, selectedIds]);

    const effectivePercent = direction === 'up' ? percent : -percent;
    const multiplier = 1 + effectivePercent / 100;

    // Productos afectados por el ajuste
    const affectedProducts = useMemo(() => {
        if (!products || products.length === 0) return [];
        if (selectedCategory === 'selected') {
            return products.filter(p => selectedIds.has(p.id));
        }
        if (selectedCategory === 'todos') {
            return products;
        }
        return products.filter(p => p.category === selectedCategory);
    }, [products, selectedCategory, selectedIds]);

    // Detección de productos que quedarán por debajo del costo (venta a pérdida)
    const belowCostProducts = useMemo(() => {
        if (direction === 'up') return [];
        return affectedProducts.filter(p => {
            const cost = p.costUsd || (p.costBs && effectiveRate > 0 ? p.costBs / effectiveRate : 0);
            if (cost <= 0) return false;
            const basePrice = p.priceUsdt ?? p.priceUsd ?? 0;
            const newPrice = Math.max(0.01, round2(basePrice * multiplier));
            return newPrice < cost;
        });
    }, [affectedProducts, direction, multiplier, effectiveRate]);

    // Vista previa estable y determinista (primeros 3 productos fijos sin parpadeo aleatorio)
    const previewSamples = useMemo(() => {
        return affectedProducts.slice(0, 3).map(p => {
            const oldPriceUsd = p.priceUsdt ?? p.priceUsd ?? 0;
            const newPriceUsd = Math.max(0.01, round2(oldPriceUsd * multiplier));
            const oldPriceBs = oldPriceUsd * (effectiveRate || 0);
            const newPriceBs = newPriceUsd * (effectiveRate || 0);
            const oldPriceCop = p.priceCop || (tasaCop > 0 ? Math.round(oldPriceUsd * tasaCop) : null);
            const newPriceCop = oldPriceCop ? Math.max(100, Math.round(oldPriceCop * multiplier)) : null;

            const costUsd = p.costUsd || (p.costBs && effectiveRate > 0 ? p.costBs / effectiveRate : 0);
            const isBelowCost = costUsd > 0 && newPriceUsd < costUsd;

            return {
                id: p.id,
                name: p.name,
                oldPriceUsd,
                newPriceUsd,
                oldPriceBs,
                newPriceBs,
                oldPriceCop,
                newPriceCop,
                isBelowCost,
                costUsd
            };
        });
    }, [affectedProducts, multiplier, effectiveRate, tasaCop]);

    if (!isOpen) return null;

    // Manejo fluido de tipeo en input de porcentaje
    const handlePercentChange = (e) => {
        const val = e.target.value;
        setDraftPercent(val);
        const parsed = parseFloat(val.replace(',', '.'));
        if (!isNaN(parsed) && parsed >= 0) {
            const max = direction === 'down' ? 90 : 200;
            setPercent(Math.min(parsed, max));
        }
    };

    const handlePercentBlur = () => {
        setIsEditingPercent(false);
        const parsed = parseFloat(draftPercent.replace(',', '.'));
        if (isNaN(parsed) || parsed <= 0) {
            setPercent(10);
            setDraftPercent('10');
        } else {
            const max = direction === 'down' ? 90 : 200;
            const clamped = Math.min(Math.max(1, parsed), max);
            setPercent(clamped);
            setDraftPercent(String(clamped));
        }
    };

    const handleSelectPreset = (presetVal) => {
        setPercent(presetVal);
        setDraftPercent(String(presetVal));
        triggerHaptic && triggerHaptic();
    };

    // Aplicar ajuste masivo con guardado inmediato y snapshot de reversión
    const handleApply = async () => {
        if (affectedProducts.length === 0) return;
        triggerHaptic && triggerHaptic();
        setIsApplying(true);

        try {
            // 1. Crear Snapshot de reversión antes de modificar
            const snapshot = {
                timestamp: new Date().toISOString(),
                direction,
                percent,
                affectedCount: affectedProducts.length,
                category: selectedCategory,
                products: (products || []).map(p => ({
                    id: p.id,
                    priceUsdt: p.priceUsdt,
                    priceUsd: p.priceUsd,
                    priceCop: p.priceCop,
                    priceBsUsdRef: p.priceBsUsdRef,
                    unitPriceUsd: p.unitPriceUsd,
                    unitPriceCop: p.unitPriceCop,
                }))
            };
            await storageService.setItem('last_bulk_price_snapshot', snapshot);
            setUndoSnapshot(snapshot);

            // 2. Mapear nuevos precios sincronizando TODAS las monedas
            const targetIds = new Set(affectedProducts.map(p => p.id));
            const updatedProducts = (products || []).map(p => {
                if (!targetIds.has(p.id)) return p;

                const oldPriceUsd = p.priceUsdt ?? p.priceUsd ?? 0;
                // Si el precio base era 0, respetarlo para no inflar artículos en $0
                const newPriceUsd = oldPriceUsd > 0 ? Math.max(0.01, round2(oldPriceUsd * multiplier)) : 0;

                const updated = {
                    ...p,
                    priceUsdt: newPriceUsd,
                    priceUsd: newPriceUsd,
                };

                // Escalar priceCop en enteros
                if (p.priceCop && p.priceCop > 0) {
                    updated.priceCop = Math.max(100, Math.round(p.priceCop * multiplier));
                }

                // Escalar precio de referencia Bs (Doble Precio dual_usd)
                if (p.priceBsUsdRef && p.priceBsUsdRef > 0) {
                    updated.priceBsUsdRef = Math.max(0.01, round2(p.priceBsUsdRef * multiplier));
                }

                // Escalar precio unitario suelto en USD
                if (p.unitPriceUsd && p.unitPriceUsd > 0) {
                    updated.unitPriceUsd = Math.max(0.01, round2(p.unitPriceUsd * multiplier));
                }

                // Escalar precio unitario suelto en COP
                if (p.unitPriceCop && p.unitPriceCop > 0) {
                    updated.unitPriceCop = Math.max(50, Math.round(p.unitPriceCop * multiplier));
                }

                return updated;
            });

            // 3. Persistencia Inmediata en storageService
            await storageService.setItem('bodega_products_v1', updatedProducts);
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
            setProducts(updatedProducts);

            // 4. Limpiar selección si se aplicó a seleccionados
            if (selectedCategory === 'selected' && onClearSelection) {
                onClearSelection();
            }

            // 5. Auditoría
            const user = useAuthStore.getState().usuarioActivo;
            const label = direction === 'up' ? `+${percent}%` : `-${percent}%`;
            logEvent(
                'INVENTARIO',
                'AJUSTE_MASIVO_PRECIOS',
                `Ajuste masivo de precios ${label} aplicado a ${affectedProducts.length} producto(s) [Ámbito: ${selectedCategory}]`,
                user
            );

            setIsApplying(false);
            setShowSuccess(true);
            showToast && showToast(`Precios ajustados ${label} en ${affectedProducts.length} productos`, 'success');

            timeoutRefs.current.push(setTimeout(() => {
                setShowSuccess(false);
                handleClose();
            }, 1100));
        } catch (err) {
            console.error('Error aplicando ajuste masivo:', err);
            showToast && showToast('Error al actualizar precios: ' + err.message, 'error');
            setIsApplying(false);
        }
    };

    // Reversión rápida del último ajuste masivo (Undo)
    const handleUndo = async () => {
        if (!undoSnapshot || !undoSnapshot.products) return;
        triggerHaptic && triggerHaptic();
        setIsUndoing(true);

        try {
            const snapshotMap = new Map(undoSnapshot.products.map(p => [p.id, p]));
            const restoredProducts = (products || []).map(p => {
                const snap = snapshotMap.get(p.id);
                if (!snap) return p;
                return {
                    ...p,
                    priceUsdt: snap.priceUsdt,
                    priceUsd: snap.priceUsd,
                    priceCop: snap.priceCop,
                    priceBsUsdRef: snap.priceBsUsdRef,
                    unitPriceUsd: snap.unitPriceUsd,
                    unitPriceCop: snap.unitPriceCop,
                };
            });

            await storageService.setItem('bodega_products_v1', restoredProducts);
            await storageService.removeItem('last_bulk_price_snapshot');
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
            setProducts(restoredProducts);
            setUndoSnapshot(null);

            const user = useAuthStore.getState().usuarioActivo;
            logEvent(
                'INVENTARIO',
                'REVERSION_AJUSTE_MASIVO',
                `Revertido ajuste masivo previo de ${undoSnapshot.affectedCount} productos`,
                user
            );

            showToast && showToast('Precios restaurados a su estado anterior', 'success');
            handleClose();
        } catch (err) {
            console.error('Error al revertir ajuste:', err);
            showToast && showToast('Error al revertir: ' + err.message, 'error');
        } finally {
            setIsUndoing(false);
        }
    };

    const handleClose = () => {
        setDirection('up');
        setPercent(10);
        setDraftPercent('10');
        setShowConfirm(false);
        setIsApplying(false);
        setShowSuccess(false);
        onClose();
    };

    const isUp = direction === 'up';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleClose} />

            {/* Modal Container */}
            <div
                className="relative bg-white dark:bg-slate-900 w-full max-w-md rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isUp ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'} transition-colors duration-300`}>
                            <Percent size={16} className={`${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'} transition-colors duration-300`} />
                        </div>
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight leading-tight">
                                {showConfirm ? 'Confirmar Ajuste Masivo' : 'Ajuste Masivo de Precios'}
                            </h3>
                            <p className="text-[10px] font-bold text-slate-400">
                                {showConfirm ? 'Verifica el impacto antes de aplicar' : 'Actualiza precios por porcentaje'}
                            </p>
                        </div>
                    </div>
                    <button onClick={handleClose} className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-500 hover:text-red-500 transition-colors">
                        <X size={16} strokeWidth={3} />
                    </button>
                </div>

                {/* Body scrollable */}
                <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">

                    {/* Overlay de Éxito */}
                    {showSuccess && (
                        <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 z-20 flex flex-col items-center justify-center animate-in fade-in duration-300 p-6 text-center">
                            <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-4 animate-in zoom-in duration-300">
                                <Check size={40} className="text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                            </div>
                            <p className="text-xl font-black text-slate-800 dark:text-white">Precios Actualizados</p>
                            <p className="text-xs font-bold text-slate-400 mt-1">
                                {direction === 'up' ? `+${percent}%` : `-${percent}%`} aplicado con éxito a {affectedProducts.length} productos
                            </p>
                        </div>
                    )}

                    {/* Banner de Deshacer (Undo) si existe snapshot reciente */}
                    {undoSnapshot && !showConfirm && (
                        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-3 flex items-center justify-between gap-3 animate-in fade-in">
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-black text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                                    <RotateCcw size={13} className="shrink-0 text-amber-600" />
                                    Último ajuste: {undoSnapshot.direction === 'up' ? `+${undoSnapshot.percent}%` : `-${undoSnapshot.percent}%`} ({undoSnapshot.affectedCount} prod.)
                                </p>
                                <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 mt-0.5 truncate">
                                    Puedes revertir todos los productos a sus precios originales.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleUndo}
                                disabled={isUndoing}
                                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black shrink-0 active:scale-95 transition-all flex items-center gap-1 shadow-sm"
                            >
                                {isUndoing ? 'Revirtiendo...' : 'Deshacer'}
                            </button>
                        </div>
                    )}

                    {/* VISTA 1: CONFIGURADOR PRINCIPAL */}
                    {!showConfirm ? (
                        <>
                            {/* Direction Toggle */}
                            <div>
                                <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 block">Tipo de Ajuste</label>
                                <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800/60 p-1.5 rounded-2xl">
                                    <button
                                        type="button"
                                        onClick={() => { setDirection('up'); triggerHaptic && triggerHaptic(); }}
                                        className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black transition-all duration-300 ${
                                            isUp
                                                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25'
                                                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                        }`}
                                    >
                                        <TrendingUp size={16} strokeWidth={2.5} /> Subir Precios
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setDirection('down'); triggerHaptic && triggerHaptic(); }}
                                        className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black transition-all duration-300 ${
                                            !isUp
                                                ? 'bg-red-500 text-white shadow-md shadow-red-500/25'
                                                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                        }`}
                                    >
                                        <TrendingDown size={16} strokeWidth={2.5} /> Bajar Precios
                                    </button>
                                </div>
                            </div>

                            {/* Percentage Section */}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Porcentaje</label>
                                    <span className="text-[10px] font-bold text-slate-400">
                                        Rango: 1% a {direction === 'down' ? '90%' : '200%'}
                                    </span>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="flex-1 relative">
                                        <input
                                            type="range"
                                            min={1}
                                            max={direction === 'down' ? 90 : 100}
                                            value={percent > 100 ? 100 : percent}
                                            onChange={e => {
                                                const val = parseFloat(e.target.value);
                                                setPercent(val);
                                                setDraftPercent(String(val));
                                            }}
                                            className="w-full h-2 rounded-full appearance-none cursor-pointer"
                                            style={{
                                                background: `linear-gradient(to right, ${isUp ? '#10b981' : '#ef4444'} 0%, ${isUp ? '#10b981' : '#ef4444'} ${(Math.min(percent, direction === 'down' ? 90 : 100) / (direction === 'down' ? 90 : 100)) * 100}%, #e2e8f0 ${(Math.min(percent, direction === 'down' ? 90 : 100) / (direction === 'down' ? 90 : 100)) * 100}%, #e2e8f0 100%)`,
                                            }}
                                        />
                                    </div>

                                    {/* Input de porcentaje con Draft State fluido */}
                                    <div className="relative shrink-0">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={isEditingPercent ? draftPercent : `${percent}`}
                                            onFocus={(e) => {
                                                setIsEditingPercent(true);
                                                e.target.select();
                                            }}
                                            onChange={handlePercentChange}
                                            onBlur={handlePercentBlur}
                                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                                            className={`w-20 text-center bg-white dark:bg-slate-800 border-2 rounded-2xl py-2 pr-5 text-base font-black outline-none transition-colors duration-300 ${
                                                isUp
                                                    ? 'border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 focus:border-emerald-500'
                                                    : 'border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 focus:border-red-500'
                                            }`}
                                        />
                                        <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-black pointer-events-none ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>%</span>
                                    </div>
                                </div>

                                {/* Preset Chips */}
                                <div className="flex gap-1.5 mt-2.5 flex-wrap">
                                    {[5, 10, 15, 20, 30, 50].map(p => (
                                        <button
                                            key={p}
                                            type="button"
                                            onClick={() => handleSelectPreset(p)}
                                            className={`flex-1 min-w-[45px] py-1.5 rounded-xl text-[11px] font-black transition-all active:scale-95 border ${
                                                percent === p
                                                    ? (isUp
                                                        ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                                                        : 'bg-red-500 text-white border-red-500 shadow-sm')
                                                    : 'bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100'
                                            }`}
                                        >
                                            {p}%
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Category Filter */}
                            <div>
                                <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 block">Aplicar a</label>
                                <CustomSelect
                                    value={selectedCategory}
                                    onChange={setSelectedCategory}
                                    options={categoryOptions}
                                />
                            </div>

                            {/* Alerta de Pérdida si hay productos bajo costo */}
                            {belowCostProducts.length > 0 && (
                                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 rounded-2xl p-3 flex items-start gap-2.5 animate-in slide-in-from-top-1">
                                    <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
                                    <div className="text-xs">
                                        <p className="font-black text-red-700 dark:text-red-400">
                                            Riesgo de margen: {belowCostProducts.length} producto(s) quedarán por debajo del costo
                                        </p>
                                        <p className="text-[10px] text-red-600/80 dark:text-red-400/80 mt-0.5">
                                            Ej: {belowCostProducts.slice(0, 2).map(p => p.name).join(', ')}
                                            {belowCostProducts.length > 2 ? ` y ${belowCostProducts.length - 2} más` : ''}.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Vista Previa Determinista */}
                            {affectedProducts.length > 0 && (
                                <div className={`rounded-2xl p-4 border transition-colors duration-300 ${
                                    isUp
                                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40'
                                        : 'bg-red-50/50 dark:bg-red-950/20 border-red-100 dark:border-red-900/40'
                                }`}>
                                    <div className="flex justify-between items-center mb-3">
                                        <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                            Vista Previa ({affectedProducts.length} productos)
                                        </p>
                                        <span className="text-[10px] font-bold text-slate-400">
                                            Tasa: {effectiveRate} Bs
                                        </span>
                                    </div>

                                    <div className="space-y-2">
                                        {previewSamples.map((s) => (
                                            <div key={s.id} className="flex items-center justify-between bg-white dark:bg-slate-800/90 rounded-xl px-3 py-2 border border-slate-100 dark:border-slate-700/60 shadow-xs">
                                                <div className="min-w-0 mr-2 flex-1">
                                                    <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{s.name}</p>
                                                    {s.isBelowCost && (
                                                        <span className="inline-flex items-center text-[9px] font-black text-red-600 bg-red-100 dark:bg-red-950 px-1.5 py-0.2 rounded mt-0.5">
                                                            Bajo costo (${formatUsd(s.costUsd)})
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0 text-right">
                                                    <div className="flex flex-col items-end">
                                                        <span className="text-[10px] text-slate-400 line-through leading-tight">
                                                            ${formatUsd(s.oldPriceUsd)}
                                                        </span>
                                                        <span className="text-[9px] text-slate-400 font-medium">
                                                            {formatBs(s.oldPriceBs)} Bs
                                                        </span>
                                                    </div>

                                                    <ArrowRight size={11} className="text-slate-400 mx-0.5" />

                                                    <div className="flex flex-col items-end">
                                                        <span className={`text-xs font-black leading-tight ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                            ${formatUsd(s.newPriceUsd)}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-brand dark:text-brand-light">
                                                            {formatBs(s.newPriceBs)} Bs
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {affectedProducts.length > 3 && (
                                        <p className="text-[10px] text-slate-400 font-bold text-center mt-2.5">
                                            ...y {affectedProducts.length - 3} producto{affectedProducts.length - 3 !== 1 ? 's' : ''} más
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Warning for large adjustments */}
                            {percent >= 30 && (
                                <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-3 py-2">
                                    <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium leading-tight">
                                        Ajuste superior al 30%. Revisa la vista previa antes de continuar.
                                    </p>
                                </div>
                            )}

                            {affectedProducts.length === 0 && (
                                <div className="text-center py-6">
                                    <p className="text-sm text-slate-400 font-medium">No hay productos en esta categoría o selección</p>
                                </div>
                            )}
                        </>
                    ) : (
                        /* VISTA 2: CONFIRMACIÓN PREVIA (DOBLE TOQUE) */
                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150 py-2">
                            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-center">
                                <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center mx-auto mb-2 text-amber-600 dark:text-amber-400">
                                    <ShieldCheck size={24} />
                                </div>
                                <h4 className="text-base font-black text-slate-900 dark:text-white">
                                    ¿Confirmas aplicar {isUp ? `+${percent}%` : `-${percent}%`}?
                                </h4>
                                <p className="text-xs font-bold text-slate-600 dark:text-slate-300 mt-1">
                                    Se modificarán los precios de <strong>{affectedProducts.length} producto(s)</strong> en:
                                    <span className="block mt-0.5 font-black text-brand">
                                        {selectedCategory === 'selected'
                                            ? 'Productos seleccionados con checkbox'
                                            : selectedCategory === 'todos'
                                                ? 'Todo el catálogo de inventario'
                                                : `Categoría: ${selectedCategory}`}
                                    </span>
                                </p>
                            </div>

                            {/* Resumen de impacto multimoneda */}
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700 text-xs space-y-1.5">
                                <div className="flex items-center justify-between font-bold text-slate-600 dark:text-slate-300">
                                    <span>Precios USD ($):</span>
                                    <span className="font-black text-slate-800 dark:text-white">Actualizados a 2 decimales</span>
                                </div>
                                <div className="flex items-center justify-between font-bold text-slate-600 dark:text-slate-300">
                                    <span>Tasa BCV de Referencia:</span>
                                    <span className="font-black text-brand">{effectiveRate} Bs / USD</span>
                                </div>
                                {copEnabled && (
                                    <div className="flex items-center justify-between font-bold text-slate-600 dark:text-slate-300">
                                        <span>Pesos COP (si aplica):</span>
                                        <span className="font-black text-amber-600">Escalados en enteros</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between font-bold text-slate-600 dark:text-slate-300">
                                    <span>Copia de seguridad (Undo):</span>
                                    <span className="font-black text-emerald-600 dark:text-emerald-400">Guardada automáticamente</span>
                                </div>
                            </div>

                            {/* Alerta si hay productos bajo costo */}
                            {belowCostProducts.length > 0 && (
                                <div className="p-3 bg-red-100/70 dark:bg-red-950/50 border border-red-300 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600" />
                                    <div>
                                        <strong className="block">¡Atención! Venta bajo costo</strong>
                                        <span>{belowCostProducts.length} producto(s) quedarán vendiéndose por debajo de su costo de adquisición.</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex gap-3 rounded-b-[2rem] shrink-0">
                    {!showConfirm ? (
                        <>
                            <button
                                type="button"
                                onClick={handleClose}
                                className="flex-1 py-3.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-black rounded-xl active:scale-[0.98] transition-all text-xs sm:text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (affectedProducts.length === 0) return;
                                    triggerHaptic && triggerHaptic();
                                    setShowConfirm(true);
                                }}
                                disabled={affectedProducts.length === 0 || isApplying}
                                className={`flex-1 py-3.5 text-white font-black rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg text-xs sm:text-sm ${
                                    isUp
                                        ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25'
                                        : 'bg-red-500 hover:bg-red-600 shadow-red-500/25'
                                }`}
                            >
                                {isUp ? <TrendingUp size={16} strokeWidth={2.5} /> : <TrendingDown size={16} strokeWidth={2.5} />}
                                Aplicar {isUp ? '+' : '-'}{percent}% ({affectedProducts.length})
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => setShowConfirm(false)}
                                disabled={isApplying}
                                className="flex-1 py-3.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-black rounded-xl active:scale-[0.98] transition-all text-xs sm:text-sm"
                            >
                                Volver
                            </button>
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={isApplying}
                                className={`flex-1 py-3.5 text-white font-black rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40 shadow-lg text-xs sm:text-sm ${
                                    isUp
                                        ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25'
                                        : 'bg-red-500 hover:bg-red-600 shadow-red-500/25'
                                }`}
                            >
                                {isApplying ? (
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <Check size={16} strokeWidth={3} />
                                        Confirmar y Aplicar
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Custom slider thumb styles */}
            <style>{`
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    background: white;
                    border: 3px solid ${isUp ? '#10b981' : '#ef4444'};
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                    transition: border-color 0.3s;
                }
                input[type="range"]::-moz-range-thumb {
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    background: white;
                    border: 3px solid ${isUp ? '#10b981' : '#ef4444'};
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                    transition: border-color 0.3s;
                }
            `}</style>
        </div>
    );
}
