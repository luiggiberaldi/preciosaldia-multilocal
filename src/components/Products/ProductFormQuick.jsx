import React, { useRef, useState } from 'react';
import { Camera, X, AlertTriangle, Package, Tag, Scale, Droplets, ChevronDown, ChevronUp, Barcode, Banknote, CheckCircle, Plus, Search, Link, Sparkles } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import CustomSelect from '../CustomSelect';
import { showToast } from '../Toast';
import PricingModeSelector from './PricingModeSelector';
import { granelUnitLabel } from '../../utils/granel'; // GRANEL-001

const PACKAGING_TYPES = [
    { id: 'suelto', label: 'Suelto', Icon: Tag, desc: 'Unidad individual', color: 'emerald' },
    { id: 'lote', label: 'Bulto', Icon: Package, desc: 'Caja, bulto o paquete', color: 'indigo' },
    { id: 'granel', label: 'Granel', Icon: Scale, desc: 'Por Kg o Litro', color: 'amber' },
];

export default function ProductFormQuick({
    image, setImage,
    name, setName,
    barcode, setBarcode,
    category, setCategory,
    priceUsd, handlePriceUsdChange,
    priceBs, handlePriceBsChange,
    pricingMode, setPricingMode,
    priceBsUsdRef, setPriceBsUsdRef,
    handlePriceCopChange,
    priceCop,
    costUsd, handleCostUsdChange,
    costBs, handleCostBsChange,
    costCop, handleCostCopChange,
    stock, setStock,
    lowStockAlert, setLowStockAlert,

    unitsPerPackage, setUnitsPerPackage,
    sellByUnit, setSellByUnit,
    unitPriceUsd, setUnitPriceUsd,
    unitPriceCop, setUnitPriceCop,

    packagingType, setPackagingType,
    stockInLotes, setStockInLotes,
    granelUnit, setGranelUnit,
    effectiveRate,
    copEnabled,
    copPrimary,
    tasaCop,

    handleImageUpload,
    categories,
    isSearchingImage,
    handleLoadImageFromUrl,
    handleAutoSearchImage,
    imageMatches,
    setImageMatches,
    handleSelectImage
}) {
    const fileInputRef = useRef(null);
    const [showSummary, setShowSummary] = useState(false);
    
    // Categorías en línea
    const { setCategories } = useProductContext();
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");

    const handleAddCategory = () => {
        if (!newCategoryName.trim()) return;
        const catId = newCategoryName.trim().toLowerCase().replace(/\s+/g, '_');
        
        setCategories(prev => {
            if(prev.find(c => c.id === catId)) return prev;
            return [...prev, { id: catId, label: newCategoryName.trim(), icon: '◆', color: 'emerald' }];
        });
        
        setCategory(catId);
        setIsAddingCategory(false);
        setNewCategoryName("");
    };

    const isLote = packagingType === 'lote';
    const isGranel = packagingType === 'granel';
    const parsedUnits = parseInt(unitsPerPackage) || 0;
    const parsedPrice = parseFloat(priceUsd) || 0;
    const parsedCost = parseFloat(costUsd) || 0;

    // Margin for the main product (lote or suelto or granel)
    const mainMarginPct = parsedCost > 0 ? ((parsedPrice - parsedCost) / parsedCost * 100) : null;
    const mainMarginUsd = parsedPrice - parsedCost;

    // Unit margin for lote with sellByUnit
    const effectiveUnitPrice = copEnabled && tasaCop > 0 && unitPriceCop
        ? parseFloat(unitPriceCop) / tasaCop
        : unitPriceUsd
            ? parseFloat(unitPriceUsd)
            : (parsedUnits > 0 ? parsedPrice / parsedUnits : 0);
    const unitCost = parsedUnits > 0 && parsedCost > 0 ? parsedCost / parsedUnits : 0;
    const unitMarginPct = unitCost > 0 ? ((effectiveUnitPrice - unitCost) / unitCost * 100) : null;
    const unitMarginUsd = effectiveUnitPrice - unitCost;

    // Stock equivalence for lote
    const parsedStockLotes = parseInt(stockInLotes) || 0;
    const stockUnitsCalc = parsedStockLotes * (parsedUnits || 1);

    // Alert equivalence
    const parsedAlert = parseInt(lowStockAlert) || 0;
    const alertLotesCalc = parsedUnits > 0 ? (parsedAlert / parsedUnits) : 0;

    // Unit label for granel
    const granelLabel = granelUnit === 'kg' ? 'Kilo' : 'Litro';

    const priceSuffix = isLote ? ' / Bulto' : isGranel ? ` / ${granelLabel}` : '';

    // GRANEL-001: atributos condicionales de tipado numérico.
    const stockStep = isGranel ? 'any' : '1';
    const stockInputMode = isGranel ? 'decimal' : 'numeric';
    const stockPlaceholder = isGranel ? '0.000' : '0';

    return (
        <div className="space-y-4">
            {/* Upload and Smart URL Paste Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 select-none">
                {/* File Upload Zone */}
                <div onClick={() => fileInputRef.current?.click()} className="sm:col-span-5 h-28 bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors relative overflow-hidden">
                    {image ? <img src={image} className="w-full h-full object-cover" alt="Product preview" /> : (
                        <>
                            <Camera size={22} className="text-slate-400 mb-1" />
                            <span className="text-[10px] font-black text-slate-500">Subir foto local</span>
                        </>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                    {image && <button onClick={(e) => { e.stopPropagation(); setImage(''); }} className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full"><X size={12} /></button>}
                </div>

                {/* Web Image Finder & URL Paste Zone */}
                <div 
                    onClick={() => {
                        if (!name || name.trim().length < 3) {
                            showToast('Ingresa el nombre del producto (mín. 3 letras) para buscar automáticamente', 'warning');
                            return;
                        }
                        handleAutoSearchImage(name);
                    }}
                    className={`sm:col-span-7 h-28 border border-slate-200 dark:border-slate-700 rounded-2xl p-2.5 flex flex-col items-center justify-center cursor-pointer hover:border-amber-500 hover:bg-amber-500/5 transition-all relative overflow-hidden group select-none ${isSearchingImage ? 'bg-amber-500/10' : 'bg-slate-50 dark:bg-slate-800'}`}
                >
                    {isSearchingImage ? (
                        <>
                            <div className="animate-spin rounded-full h-5 w-5 border-2 border-amber-600 dark:border-amber-400 border-t-transparent mb-1.5" />
                            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">Buscando foto...</span>
                        </>
                    ) : (
                        <>
                            <Sparkles size={22} className="text-amber-600 dark:text-amber-400 mb-1.5 group-hover:scale-110 transition-transform" />
                            <span className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-wider">Auto-buscar foto</span>
                            <span className="text-[8px] text-slate-500 dark:text-slate-400 mt-1 leading-none text-center">
                                Busca automáticamente la mejor imagen en tu catálogo local y tiendas
                            </span>
                        </>
                    )}
            </div>
        </div>

            {imageMatches && imageMatches.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-150 dark:border-slate-700/50 rounded-2xl p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200 select-none">
                    <div className="flex justify-between items-center px-0.5">
                        <span className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                            <Sparkles size={11} className="animate-pulse" /> Selecciona la foto correcta ({imageMatches.length})
                        </span>
                        <button 
                            type="button" 
                            onClick={() => setImageMatches([])} 
                            className="text-[9px] font-extrabold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors uppercase tracking-wider"
                        >
                            Cerrar
                        </button>
                    </div>
                    <div className="flex gap-2.5 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700 items-stretch">
                        {imageMatches.map((m, idx) => (
                            <div 
                                key={idx}
                                onClick={() => handleSelectImage(m.dataUri)}
                                className="flex-shrink-0 w-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1.5 cursor-pointer hover:border-amber-500 hover:scale-102 active:scale-98 transition-all flex flex-col items-center justify-between gap-1.5 text-center group"
                            >
                                <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-800 flex items-center justify-center relative shrink-0">
                                    <img src={m.dataUri} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" alt={m.title} crossOrigin="anonymous" />
                                </div>
                                <span className="text-[9px] font-bold text-slate-600 dark:text-slate-300 leading-tight uppercase break-words w-full">
                                    {m.title}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="space-y-3">
                {/* Name */}
                <div className="relative">
                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Nombre</label>
                    <input 
                        value={name} 
                        onChange={e => setName(e.target.value)} 
                        autoFocus 
                        placeholder="Ej: Harina PAN 1kg"
                        className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 pr-10 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 capitalize text-sm sm:text-base" 
                    />
                    {name && name.trim().length >= 3 && (
                        <CheckCircle size={18} className="absolute right-3 top-[38px] text-emerald-500 transition-all duration-300" />
                    )}
                </div>

                {/* Barcode */}
                <div>
                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Cód. de Barras (Opcional)</label>
                    <div className="relative">
                        <input value={barcode} onChange={e => setBarcode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} placeholder="Ej: 7591111222233"
                            className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 pl-10 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm sm:text-base" />
                        <Barcode size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                </div>

                {/* Category (full width) */}
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-xs font-bold text-slate-400 ml-1 block uppercase">Categoría</label>
                        <button 
                            onClick={() => setIsAddingCategory(!isAddingCategory)}
                            className="text-[10px] font-bold text-emerald-500 hover:text-emerald-600 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-md transition-colors"
                        >
                            {isAddingCategory ? <X size={12} /> : <Plus size={12} />}
                            {isAddingCategory ? 'Cancelar' : 'Nueva'}
                        </button>
                    </div>
                    {isAddingCategory ? (
                        <div className="flex gap-2 animate-in fade-in slide-in-from-top-1">
                            <input 
                                autoFocus
                                value={newCategoryName}
                                onChange={e => setNewCategoryName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                placeholder="Nombre de categoría..."
                                className="flex-1 bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                            />
                            <button 
                                onClick={handleAddCategory}
                                disabled={!newCategoryName.trim()}
                                className="bg-emerald-500 text-white px-4 rounded-xl font-bold disabled:opacity-50 hover:bg-emerald-600 transition-colors text-sm"
                            >
                                Guardar
                            </button>
                        </div>
                    ) : (
                        <CustomSelect
                            value={category}
                            onChange={setCategory}
                            options={categories.filter(c => c.id !== 'todos').map(c => ({ value: c.id, label: c.label }))}
                        />
                    )}
                </div>

                {/* ─── PACKAGING TYPE CARDS ─── */}
                <div>
                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Tipo de Empaque</label>
                    <div className="grid grid-cols-3 gap-2">
                        {PACKAGING_TYPES.map(pt => {
                            const selected = packagingType === pt.id;
                            const colorMap = {
                                emerald: selected ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : '',
                                indigo: selected ? 'border-brand bg-brand-light dark:bg-surface-800/20' : '',
                                amber: selected ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : '',
                            };
                            const textColor = {
                                emerald: 'text-emerald-700 dark:text-emerald-400',
                                indigo: 'text-brand-dark dark:text-brand',
                                amber: 'text-amber-700 dark:text-amber-400',
                            };
                            return (
                                <button key={pt.id}
                                    type="button"
                                    onClick={() => setPackagingType(pt.id)}
                                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all active:scale-95 ${selected
                                        ? colorMap[pt.color]
                                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                                        }`}>
                                    <pt.Icon size={22} strokeWidth={2} className={selected ? textColor[pt.color] : 'text-slate-400'} />
                                    <span className={`text-[10px] font-black uppercase ${selected ? textColor[pt.color] : 'text-slate-500'}`}>{pt.label}</span>
                                    <span className="text-[8px] text-slate-400 leading-tight text-center">{pt.desc}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ─── GRANEL: Unit selector ─── */}
                {isGranel && (
                    <div className="flex gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        {['kg', 'litro'].map(u => (
                            <button key={u} type="button" onClick={() => setGranelUnit(u)}
                                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 ${granelUnit === u
                                    ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}>
                                {u === 'kg' ? <><Scale size={14} className="inline -mt-0.5" /> Kilogramo</> : <><Droplets size={14} className="inline -mt-0.5" /> Litro</>}
                            </button>
                        ))}
                    </div>
                )}

                {/* ─── CAMPO OPCIONAL: Unidades por Bulto/Caja (para Suelto y Granel) ─── */}
                {!isLote && (
                    <div className="bg-slate-50 dark:bg-slate-800/30 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/50 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                Uds. por Bulto / Caja
                            </label>
                            <span className="text-[9px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">Opcional</span>
                        </div>
                        <input
                            type="number"
                            inputMode="numeric"
                            value={unitsPerPackage}
                            onChange={e => setUnitsPerPackage(e.target.value)}
                            placeholder="Ej: 24  (déjalo vacío si no aplica)"
                            className="w-full bg-white dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 text-sm border border-slate-200/60 dark:border-slate-700/60"
                        />
                        {parsedUnits > 1 && (
                            <p className="text-[10px] text-brand font-bold mt-1.5 ml-1">
                                ✓ En ajuste por lote podrás elegir entre unidades sueltas o bultos de {parsedUnits} uds
                            </p>
                        )}
                        {!parsedUnits || parsedUnits <= 1 ? (
                            <p className="text-[10px] text-slate-400 mt-1.5 ml-1">
                                Complétalo si el producto se maneja en cajas o bultos para activar ajuste por bulto en inventario
                            </p>
                        ) : null}
                    </div>
                )}

                {/* ─── LOTE: Units per package ─── */}
                {isLote && (
                    <div className="bg-brand-light dark:bg-surface-800/10 p-4 rounded-xl border border-surface-200 dark:border-surface-800/30 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                        <div>
                            <label className="text-xs font-bold text-brand-dark dark:text-brand ml-1 mb-1 block uppercase">¿Cuántas unidades trae el bulto?</label>
                            <input type="number" inputMode="numeric" value={unitsPerPackage} onChange={e => setUnitsPerPackage(e.target.value)} placeholder="Ej: 24"
                                className="w-full bg-white dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 text-sm" />
                        </div>

                        {/* Toggle: sell by unit */}
                        {parsedUnits > 1 && (
                            <label className="flex items-center gap-3 cursor-pointer select-none p-2 rounded-lg hover:bg-brand-light/50 dark:hover:bg-surface-800/20 transition-colors">
                                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${sellByUnit ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600'}`}
                                    onClick={() => setSellByUnit(!sellByUnit)}>
                                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${sellByUnit ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                                </div>
                                <div onClick={() => setSellByUnit(!sellByUnit)}>
                                    <span className="text-xs font-bold text-brand-dark dark:text-brand">¿También vender por unidad suelta?</span>
                                    <p className="text-[10px] text-brand/70 dark:text-brand/50 mt-0.5">Permite vender unidades individuales del bulto</p>
                                </div>
                            </label>
                        )}
                    </div>
                )}

                {/* ─── COST SECTION (first) ─── */}
                <div className="bg-slate-50 dark:bg-slate-800/20 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/40">
                    <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-2 ml-1">
                        Costo de Adquisición ({priceSuffix ? priceSuffix.replace(' / ', '') : 'Unidad'})
                    </span>
                    <div className="grid grid-cols-2 gap-3 items-center">
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                                {copEnabled && copPrimary && tasaCop > 0 ? 'COP' : '$'}
                            </span>
                            {copEnabled && copPrimary && tasaCop > 0 ? (
                                <input type="number" inputMode="decimal" value={costCop} onChange={e => handleCostCopChange(e.target.value)} placeholder="4100"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 pl-11 rounded-xl font-bold text-slate-700 dark:text-white outline-none border border-slate-200/60 dark:border-slate-800/40 focus:ring-2 focus:ring-slate-500/40 transition-all text-xs" />
                            ) : (
                                <input type="number" inputMode="decimal" value={costUsd} onChange={e => handleCostUsdChange(e.target.value)} placeholder="1.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 pl-7 rounded-xl font-bold text-slate-700 dark:text-white outline-none border border-slate-200/60 dark:border-slate-800/40 focus:ring-2 focus:ring-slate-500/40 transition-all text-xs" />
                            )}
                        </div>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">Bs</span>
                            <input type="number" inputMode="decimal" value={costBs} onChange={e => handleCostBsChange(e.target.value)} placeholder="0.00"
                                className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-slate-700 dark:text-white outline-none border border-slate-200/60 dark:border-slate-800/40 focus:ring-2 focus:ring-slate-500/40 transition-all text-xs" />
                        </div>
                    </div>
                </div>

                {/* ─── LOTE: Auto unit cost ─── */}
                {isLote && parsedUnits > 1 && parsedCost > 0 && (
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 px-3 py-2 rounded-xl text-[11px]">
                        <span className="text-slate-500 font-medium">Costo por unidad:</span>
                        <span className="font-bold text-slate-700 dark:text-white flex items-center gap-1.5">
                            {copEnabled && copPrimary && tasaCop > 0 ? `${Math.round((parsedCost / parsedUnits) * tasaCop).toLocaleString('es-CO')} COP` : `$${(parsedCost / parsedUnits).toFixed(2)}`}
                            <span className="text-[8px] bg-brand-light dark:bg-surface-800/30 text-brand px-1.5 py-0.5 rounded font-black">AUTO</span>
                        </span>
                    </div>
                )}

                {/* ─── COP INPUT (primero si copEnabled) ─── */}
                {copEnabled && (
                    <div className="relative">
                        <label className="text-[10px] sm:text-xs font-bold text-amber-600 dark:text-amber-400 ml-1 mb-1 block uppercase tracking-wider">
                            Precio de Venta (Pesos COP){priceSuffix}
                        </label>
                        <input
                            type="number"
                            inputMode="decimal"
                            placeholder="Ej: 15000"
                            value={priceCop}
                            onChange={e => handlePriceCopChange(e.target.value)}
                            className="w-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-3.5 pr-10 sm:p-4 sm:pr-10 rounded-xl font-black text-amber-800 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 transition-all text-sm sm:text-base"
                        />
                        <Banknote size={16} className="absolute right-3 top-[38px] sm:top-[42px] text-amber-400" />
                        <p className="text-[10px] text-amber-600/70 dark:text-amber-500/60 mt-1 ml-1">
                            Calcula automáticamente el precio en USD y Bs
                        </p>
                    </div>
                )}

                {/* ─── PRICE SECTION ─── */}
                <div className="bg-emerald-500/5 dark:bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/15 space-y-2.5">
                    <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest block ml-1">
                        Precio de Venta ({priceSuffix ? priceSuffix.replace(' / ', '') : 'Unidad'})
                    </span>
                    <div className="grid grid-cols-2 gap-3 items-center">
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-500">
                                {copEnabled ? 'USD' : '$'}
                            </span>
                            <input type="number" inputMode="decimal" value={priceUsd} onChange={e => handlePriceUsdChange(e.target.value)} placeholder="1.50"
                                className="w-full bg-white dark:bg-slate-900 p-2.5 pl-11 pr-10 rounded-xl font-black text-emerald-800 dark:text-emerald-400 outline-none border border-emerald-100 dark:border-emerald-800/30 focus:ring-2 focus:ring-emerald-500/40 transition-all text-xs" />
                            {parseFloat(priceUsd) > 0 && (
                                <CheckCircle size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 transition-all duration-300" />
                            )}
                        </div>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-brand-dark dark:text-brand">Bs</span>
                            <input type="number" inputMode="decimal" value={priceBs} onChange={e => handlePriceBsChange(e.target.value)} placeholder="0.00"
                                className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 pr-10 rounded-xl font-black text-surface-800 dark:text-brand outline-none border border-surface-200 dark:border-surface-800/30 focus:ring-2 focus:ring-brand/40 transition-all text-xs" />
                            {parseFloat(priceBs) > 0 && (
                                <CheckCircle size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand transition-all duration-300" />
                            )}
                        </div>
                    </div>

                    {/* ─── OPCCIÓN LEGIBLE Y EXPLICATIVA: DOBLE PRECIO ─── */}
                    <div className="pt-2 border-t border-emerald-500/20">
                        <button
                            type="button"
                            onClick={() => {
                                if (pricingMode === 'dual_usd') {
                                    setPricingMode('tasa_dia');
                                    setPriceBsUsdRef('');
                                } else {
                                    setPricingMode('dual_usd');
                                    if (!priceBsUsdRef && priceUsd) setPriceBsUsdRef(priceUsd);
                                }
                            }}
                            className={`w-full flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer text-left ${
                                pricingMode === 'dual_usd'
                                    ? 'bg-emerald-500/15 border-emerald-500/40 ring-1 ring-emerald-500/30'
                                    : 'bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 hover:border-emerald-400/50'
                            }`}
                        >
                            <div className="flex items-center gap-2.5 pr-2">
                                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                    pricingMode === 'dual_usd'
                                        ? 'bg-emerald-500 border-emerald-500 text-white'
                                        : 'border-slate-400 dark:border-slate-600 bg-transparent'
                                }`}>
                                    {pricingMode === 'dual_usd' && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
                                </span>
                                <div>
                                    <span className="text-xs font-black text-slate-800 dark:text-slate-100 block leading-tight">
                                        ¿Deseas cobrar un precio diferente si pagan en Bolívares?
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 block mt-0.5 leading-tight">
                                        Permite fijar un precio en $ para divisas/efectivo y un $ Ref para Pago Móvil / Punto
                                    </span>
                                </div>
                            </div>
                            <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg shrink-0 uppercase tracking-wider ${
                                pricingMode === 'dual_usd'
                                    ? 'bg-emerald-500 text-white shadow-sm'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}>
                                {pricingMode === 'dual_usd' ? 'ACTIVADO' : '+ ACTIVAR'}
                            </span>
                        </button>

                        {pricingMode === 'dual_usd' && (
                            <div className="mt-2.5 bg-white dark:bg-slate-900 p-3 rounded-xl border border-emerald-300 dark:border-emerald-800 space-y-2 animate-in fade-in slide-in-from-top-1 shadow-sm">
                                <div className="flex justify-between items-center flex-wrap gap-1">
                                    <label className="text-[11px] font-black text-emerald-900 dark:text-emerald-200 uppercase tracking-wider">
                                        Precio Ref. en $ para pagos en Bolívares
                                    </label>
                                    {parseFloat(priceBsUsdRef) > 0 && (
                                        <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 rounded-md">
                                            = {(parseFloat(priceBsUsdRef) * effectiveRate).toFixed(2)} Bs
                                        </span>
                                    )}
                                </div>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-emerald-600 dark:text-emerald-400">$</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        value={priceBsUsdRef}
                                        onChange={(e) => setPriceBsUsdRef(e.target.value)}
                                        placeholder={priceUsd || "2.00"}
                                        className="w-full bg-emerald-50/40 dark:bg-slate-950 p-2.5 pl-8 pr-3 rounded-xl font-black text-emerald-900 dark:text-emerald-100 outline-none border border-emerald-300 dark:border-emerald-700 text-xs focus:ring-2 focus:ring-emerald-500 transition-all"
                                    />
                                </div>
                                <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium leading-relaxed bg-emerald-50/80 dark:bg-emerald-950/40 p-2 rounded-lg border border-emerald-200/50 dark:border-emerald-800/40">
                                    💡 <strong>Ejemplo de Cobro:</strong> El cliente pagará <strong>${priceUsd || '0.00'}</strong> si entrega divisas/efectivo $, o <strong>${priceBsUsdRef || priceUsd || '0.00'}</strong> ({((parseFloat(priceBsUsdRef) || parseFloat(priceUsd) || 0) * effectiveRate).toFixed(2)} Bs) si paga por Pago Móvil, Punto o Efectivo Bs.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
                {isLote && sellByUnit && parsedUnits > 1 && (
                    <div className="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-surface-300 dark:border-surface-800/40 space-y-2 animate-in fade-in slide-in-from-top-1">
                        <div className="flex justify-between items-center">
                            <label className="text-[10px] font-bold text-brand-dark dark:text-brand uppercase tracking-wider">Precio por Unidad Suelta</label>
                            {parsedPrice > 0 && parsedUnits > 0 && (
                                <span className="text-[9px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">
                                    Auto: {copEnabled && tasaCop > 0
                                        ? `${Math.round((parsedPrice / parsedUnits) * tasaCop).toLocaleString('es-CO')} COP`
                                        : `$${(parsedPrice / parsedUnits).toFixed(2)}`}
                                </span>
                            )}
                        </div>
                        {copEnabled ? (
                            /* ── COP mode: COP input primary, USD + Bs derived ── */
                            <div className="space-y-2">
                                <div>
                                    <label className="text-[9px] font-bold text-amber-600 ml-0.5 mb-0.5 block">Pesos COP</label>
                                    <input type="number" inputMode="decimal" value={unitPriceCop}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setUnitPriceCop(val);
                                            setUnitPriceUsd(val && parseFloat(val) > 0 && tasaCop > 0
                                                ? (parseFloat(val) / tasaCop).toFixed(4)
                                                : '');
                                        }}
                                        placeholder={parsedPrice > 0 && parsedUnits > 0 && tasaCop > 0
                                            ? Math.round((parsedPrice / parsedUnits) * tasaCop).toString()
                                            : '0'}
                                        className="w-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-3 rounded-xl font-black text-amber-800 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[9px] font-bold text-emerald-500 ml-0.5 mb-0.5 block">USD ($)</label>
                                        <div className="w-full bg-emerald-50/50 dark:bg-slate-900 border border-emerald-100 dark:border-emerald-900/30 p-3 rounded-xl font-black text-emerald-700 dark:text-emerald-400 text-sm">
                                            {effectiveUnitPrice > 0 ? effectiveUnitPrice.toFixed(2) : '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-bold text-brand ml-0.5 mb-0.5 block">Bolívares (Bs)</label>
                                        <div className="w-full bg-brand-light/50 dark:bg-slate-900 border border-surface-200 dark:border-surface-800/30 p-3 rounded-xl font-black text-brand-dark dark:text-brand text-sm flex items-center justify-between">
                                            {effectiveRate > 0 && effectiveUnitPrice > 0
                                                ? (effectiveUnitPrice * effectiveRate).toFixed(2)
                                                : '—'}
                                            <span className="text-[8px] bg-brand-light dark:bg-surface-800/30 text-brand px-1.5 py-0.5 rounded font-black">Bs</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* ── No COP mode: USD input primary, Bs derived ── */
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[9px] font-bold text-emerald-500 ml-0.5 mb-0.5 block">USD ($)</label>
                                    <input type="number" inputMode="decimal" value={unitPriceUsd}
                                        onChange={e => setUnitPriceUsd(e.target.value)}
                                        placeholder={parsedPrice > 0 && parsedUnits > 0 ? (parsedPrice / parsedUnits).toFixed(2) : '0.00'}
                                        className="w-full bg-brand-light/50 dark:bg-slate-900 border border-surface-200 dark:border-surface-700/30 p-3 rounded-xl font-black text-brand-dark dark:text-brand outline-none focus:ring-2 focus:ring-brand/50 text-sm" />
                                </div>
                                <div>
                                    <label className="text-[9px] font-bold text-brand ml-0.5 mb-0.5 block">Bolívares (Bs)</label>
                                    <div className="w-full bg-brand-light/50 dark:bg-slate-900 border border-surface-200 dark:border-surface-800/30 p-3 rounded-xl font-black text-brand-dark dark:text-brand text-sm flex items-center justify-between">
                                        {effectiveRate > 0
                                            ? (effectiveUnitPrice * effectiveRate).toFixed(2)
                                            : '—'}
                                        <span className="text-[8px] bg-brand-light dark:bg-surface-800/30 text-brand px-1.5 py-0.5 rounded font-black">Bs</span>
                                    </div>
                                </div>
                            </div>
                        )}
                        <p className="text-[9px] text-slate-400 italic">Déjalo vacío para usar el precio auto-calculado (lote ÷ unidades)</p>
                    </div>
                )}

                {/* ─── MARGIN PANEL ─── */}
                <div className={`p-3 rounded-xl border space-y-1.5 min-h-[60px] ${mainMarginPct !== null && mainMarginPct < 0
                    ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30'
                    : mainMarginPct !== null && mainMarginPct === 0
                        ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'
                        : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'
                    }`}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Margen de Ganancia</p>
                    {parsedPrice > 0 && parsedCost > 0 ? (
                        <div className="space-y-1.5">
                            {/* Main margin */}
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500 font-medium">{isLote ? 'Margen Bulto:' : isGranel ? `Margen / ${granelLabel}:` : 'Margen / Unidad:'}</span>
                                <span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {mainMarginPct.toFixed(1)}%
                                    <span className="text-xs ml-1.5 opacity-80 font-bold">(${mainMarginUsd.toFixed(2)})</span>
                                </span>
                            </div>

                            {/* Unit margin for lote with sellByUnit */}
                            {isLote && sellByUnit && parsedUnits > 1 && unitMarginPct !== null && (
                                <div className="flex justify-between items-center text-sm border-t border-slate-200/50 dark:border-slate-700/50 pt-1.5">
                                    <span className="text-slate-500 font-medium">Margen Unidad:</span>
                                    <span className={`font-black ${unitMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {unitMarginPct.toFixed(1)}%
                                        <span className="text-xs ml-1.5 opacity-80 font-bold">(${unitMarginUsd.toFixed(2)})</span>
                                    </span>
                                </div>
                            )}

                            {/* Warnings */}
                            {mainMarginPct < 0 && (
                                <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1 mt-1">
                                    <AlertTriangle size={11} /> Estás vendiendo a pérdida
                                </p>
                            )}
                            {mainMarginPct === 0 && (
                                <p className="text-[10px] font-bold text-amber-500 flex items-center gap-1 mt-1">
                                    <AlertTriangle size={11} /> Punto de equilibrio (sin ganancia)
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="text-xs text-slate-400 italic">
                            Ingresa Precio y Costo para calcular tu margen.
                            {parsedPrice > 0 && parsedCost === 0 && (
                                <p className="text-[10px] font-bold text-amber-500 flex items-center gap-1 mt-1 not-italic">
                                    <AlertTriangle size={11} /> Sin costo: no podrás ver tu ganancia real en reportes
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* ─── STOCK & ALERTA SECTION ─── */}
                {isLote ? (
                    <div className="grid grid-cols-3 gap-3 animate-in fade-in duration-200">
                        <div>
                            <label className="text-[10px] font-black text-slate-400 ml-1 mb-1 block uppercase truncate">Bultos / Cajas</label>
                            <input 
                                type="number" 
                                step="any"
                                value={stockInLotes || ''} 
                                onChange={e => {
                                    const lotesVal = e.target.value;
                                    setStockInLotes(lotesVal);
                                    const numLotes = parseFloat(lotesVal) || 0;
                                    const derivedUnits = Math.round(numLotes * parsedUnits);
                                    setStock(lotesVal ? derivedUnits.toString() : '');
                                }} 
                                placeholder="0"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" 
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-400 ml-1 mb-1 block uppercase truncate">Equiv. Unidades</label>
                            <input 
                                type="number" 
                                value={stock || ''} 
                                onChange={e => {
                                    const unitsVal = e.target.value;
                                    setStock(unitsVal);
                                    const numUnits = parseFloat(unitsVal) || 0;
                                    const derivedLotes = parsedUnits > 0 ? parseFloat((numUnits / parsedUnits).toFixed(2)) : 0;
                                    setStockInLotes(unitsVal ? derivedLotes.toString() : '');
                                }} 
                                placeholder="0"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" 
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-amber-500 ml-1 mb-1 block uppercase flex items-center gap-1 truncate">
                                <AlertTriangle size={10} /> Alerta (Uds)
                            </label>
                            <input 
                                type="number" 
                                step="1"
                                inputMode="numeric" 
                                value={lowStockAlert} 
                                onChange={e => setLowStockAlert(e.target.value)} 
                                placeholder="5"
                                className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-3.5 rounded-xl font-bold text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" 
                            />
                            {parsedAlert > 0 && parsedUnits > 0 && (
                                <p className="text-[9px] text-amber-500/80 font-bold mt-1 ml-1 truncate">= {alertLotesCalc.toFixed(1)} bultos</p>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3 animate-in fade-in duration-200">
                        <div>
                            <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Stock{isGranel ? ` (${granelUnitLabel({ unit: granelUnit, packagingType })})` : ''}</label>
                            <input 
                                type="number" 
                                step={stockStep}
                                inputMode={stockInputMode} 
                                value={stock} 
                                onChange={e => setStock(e.target.value)} 
                                placeholder={stockPlaceholder}
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" 
                            />
                            {!isLote && parsedUnits > 1 && (parseInt(stock) || 0) > 0 && (() => {
                                const parsedStock = parseInt(stock) || 0;
                                const bultos = Math.floor(parsedStock / parsedUnits);
                                const sobrante = parsedStock % parsedUnits;
                                let msg = '';
                                if (bultos > 0) {
                                    msg = `= ${bultos} bulto${bultos !== 1 ? 's' : ''}`;
                                    if (sobrante > 0) {
                                        msg += ` y ${sobrante} ud${sobrante !== 1 ? 's' : ''} suelta${sobrante !== 1 ? 's' : ''}`;
                                    } else {
                                        msg += ' exacto' + (bultos !== 1 ? 's' : '');
                                    }
                                } else {
                                    msg = `= ${sobrante} ud${sobrante !== 1 ? 's' : ''} suelta${sobrante !== 1 ? 's' : ''} (menos de 1 bulto)`;
                                }
                                return (
                                    <p className="text-[10px] text-brand font-bold mt-1 ml-1 animate-in fade-in duration-200">
                                        {msg}
                                    </p>
                                );
                            })()}
                        </div>
                        <div>
                            <label className="text-xs font-bold text-amber-500 ml-1 mb-1 block uppercase flex items-center gap-1">
                                <AlertTriangle size={10} /> Alerta mín.
                            </label>
                            <input 
                                type="number" 
                                step={stockStep}
                                inputMode={stockInputMode} 
                                value={lowStockAlert} 
                                onChange={e => setLowStockAlert(e.target.value)} 
                                placeholder={isGranel ? '2.5' : '5'}
                                className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-3.5 rounded-xl font-bold text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" />
                        </div>
                    </div>
                )}

                {/* ─── PRE-SAVE SUMMARY ─── */}
                {name && parsedPrice > 0 && (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                        <button onClick={() => setShowSummary(!showSummary)}
                            type="button"
                            className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                            <span>📋 Resumen antes de guardar</span>
                            {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {showSummary && (
                            <div className="px-3 py-2.5 space-y-1.5 text-xs bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-top-1 duration-150">
                                <div className="flex justify-between"><span className="text-slate-400">Nombre:</span><span className="font-bold text-slate-700 dark:text-white">{name}</span></div>
                                <div className="flex justify-between"><span className="text-slate-400">Categoría:</span><span className="font-bold text-slate-700 dark:text-white">{categories.find(c => c.id === category)?.label || category}</span></div>
                                <div className="flex justify-between"><span className="text-slate-400">Tipo:</span><span className="font-bold text-slate-700 dark:text-white">{PACKAGING_TYPES.find(p => p.id === packagingType)?.label}</span></div>
                                <div className="flex justify-between"><span className="text-slate-400">Precio USD/BS:</span><span className="font-bold text-emerald-600">${parsedPrice.toFixed(2)}{priceSuffix} / {(parsedPrice * effectiveRate).toFixed(2)} Bs</span></div>
                                {copEnabled && tasaCop > 0 && <div className="flex justify-between"><span className="text-amber-500/80">Precio COP:</span><span className="font-bold text-amber-600">{(priceCop && parseFloat(priceCop) > 0 ? Math.round(parseFloat(priceCop)) : Math.round(parsedPrice * tasaCop)).toLocaleString('es-CO')} COP{priceSuffix}</span></div>}
                                {parsedCost > 0 && <div className="flex justify-between"><span className="text-slate-400">Costo:</span><span className="font-bold text-slate-600">${parsedCost.toFixed(2)}{priceSuffix}</span></div>}
                                {mainMarginPct !== null && <div className="flex justify-between"><span className="text-slate-400">Margen:</span><span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{mainMarginPct.toFixed(1)}%</span></div>}
                                {isLote && <div className="flex justify-between"><span className="text-slate-400">Uds/Bulto:</span><span className="font-bold text-brand">{parsedUnits}</span></div>}
                                {isLote && sellByUnit && <div className="flex justify-between"><span className="text-slate-400">Venta suelta:</span><span className="font-bold text-brand">Sí — ${effectiveUnitPrice.toFixed(2)}/ud</span></div>}
                                <div className="flex justify-between"><span className="text-slate-400">Stock:</span><span className="font-bold text-slate-700 dark:text-white">{isLote ? `${parsedStockLotes} bultos (${stockUnitsCalc} uds)` : `${stock || 0}`}</span></div>
                                {barcode && <div className="flex justify-between"><span className="text-slate-400">Código:</span><span className="font-bold text-slate-700 dark:text-white">{barcode}</span></div>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
