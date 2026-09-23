import React from 'react';
import { ShoppingCart, Plus, Minus, X, CheckCircle, Package, Trash2, DollarSign, Percent, Search, Pause } from 'lucide-react';
import { formatBs, formatCop, getCop, formatUsd } from '../../utils/calculatorUtils';
import { mulR } from '../../utils/dinero';
import SmartImage from '../SmartImage';
import { FinancialEngine } from '../../core/FinancialEngine';
import { showToast } from '../Toast';
import { isGranelProduct, granelUnitLabel, parseCartQuantity, formatStockDisplay } from '../../utils/granel'; // GRANEL-001

export default function CartPanel({
    cart,
    effectiveRate,
    cartSubtotalUsd,
    cartSubtotalBs,
    cartTotalUsd,
    cartTotalBs,
    cartTotalCop,
    cartItemCount,
    discountData,
    onOpenDiscount,
    updateQty,
    removeFromCart,
    onCheckout,
    onClearCart,
    triggerHaptic,
    cartSelectedIndex,
    copEnabled,
    copPrimary,
    tasaCop
}) {
    const [editingQtyId, setEditingQtyId] = React.useState(null);
    const [tempQty, setTempQty] = React.useState('');
    const inputRef = React.useRef(null);

    // Calcular el total en Bolívares para mostrar en la cesta usando la tasa de referencia si hay Doble Precio
    const displayCartTotalBs = React.useMemo(() => {
        if (!cart || cart.length === 0) return 0;
        const hasDualItem = cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0);
        if (hasDualItem) {
            const bsTotals = FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, tasaCop, true);
            return bsTotals.totalBs;
        }
        return cartTotalBs;
    }, [cart, discountData, effectiveRate, tasaCop, cartTotalBs]);

    const handleQtyClick = (item) => {
        triggerHaptic && triggerHaptic();
        setEditingQtyId(item.id);
        setTempQty(''); // Limpia la cifra al pulsar para edición directa
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.select();
            }
        }, 50);
    };

    const submitCustomQty = (item) => {
        setEditingQtyId(null);
        if (!tempQty || tempQty.trim() === '') return; // Si no ingresó nada, conserva la cantidad previa

        const itemIsGranel = isGranelProduct(item);
        const normalizedRaw = String(tempQty).trim().replace(/\s/g, '').replace(',', '.');
        const rawNumber = Number(normalizedRaw);

        if (!Number.isFinite(rawNumber) || rawNumber <= 0) {
            setTempQty('');
            return;
        }

        // GRANEL-001: el editor de cesta NO permite fracciones para unidad/bulto/lote.
        // No redondeamos silenciosamente 0.5 a 1: rechazamos la entrada y conservamos
        // la cantidad previa para que el cajero no cobre una cantidad inesperada.
        if (!itemIsGranel && !Number.isInteger(rawNumber)) {
            showToast('Este producto solo acepta cantidades enteras', 'warning');
            setTempQty('');
            return;
        }

        const parsed = parseCartQuantity(tempQty, itemIsGranel);
        if (parsed === null || parsed <= 0) {
            setTempQty('');
            return;
        }

        const diff = parsed - (Number(item.qty) || 0);
        if (diff !== 0) {
            updateQty(item.id, diff);
        }
        setTempQty('');
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col lg:bg-white lg:dark:bg-slate-900 lg:rounded-2xl lg:sm:rounded-3xl lg:border lg:border-slate-100 lg:dark:border-slate-800 lg:shadow-sm bg-transparent border-0 shadow-none">

            {/* Header */}
            <div className="shrink-0 hidden lg:block px-4 py-4 border-b border-slate-100 dark:border-slate-800 bg-brand dark:bg-brand rounded-t-2xl sm:rounded-t-3xl">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-white flex items-center gap-2">
                        <ShoppingCart size={16} className="opacity-80" />
                        Cesta ({cartItemCount})
                    </span>
                </div>
            </div>

            {/* Cart Items — scrollable area with touch support */}
            <div
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 sm:p-3"
                style={{ WebkitOverflowScrolling: 'touch' }}
            >
                {cart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 p-8 text-center h-full gap-2">
                        <ShoppingCart size={44} strokeWidth={1} className="opacity-30" />
                        <p className="text-sm font-bold text-slate-400">Tu cesta está vacía</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {cart.map((item, idx) => {
                            if (!item) return null;
                            const itemIsGranel = isGranelProduct(item);
                            const itemUnitLabel = itemIsGranel
                                ? (granelUnitLabel(item) === 'UND' ? 'kg' : granelUnitLabel(item))
                                : 'un.';
                            const qtyDisplay = itemIsGranel
                                ? `${formatStockDisplay(item.qty || 0, true)} ${itemUnitLabel}`
                                : String(item.qty ?? 1);
                            const isCustomProduct = (item?.id?.toString() || '').startsWith('custom_') || item?.name === 'Venta Libre';
                            const isCashAdvance = item.isCashAdvance === true;
                            const isEditing = editingQtyId === item.id;
                            const isSelected = cartSelectedIndex === idx;

                            return (
                                <div key={item.id || `cart_item_${idx}`} className={`group rounded-2xl p-2.5 lg:p-2 border flex flex-col gap-1.5 lg:gap-1.5 transition-colors relative ${
                                    isCashAdvance
                                        ? (isSelected
                                            ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-500 ring-2 ring-amber-500/20 dark:border-amber-400 dark:ring-amber-400/20'
                                            : 'bg-amber-50/30 dark:bg-amber-950/10 border-amber-200/50 dark:border-amber-900/40 hover:border-amber-400')
                                        : (isSelected 
                                            ? 'bg-white dark:bg-slate-900 border-emerald-500 ring-2 ring-emerald-500/20 dark:border-emerald-400 dark:ring-emerald-400/20' 
                                            : 'bg-white dark:bg-slate-900 border-slate-200/70 dark:border-slate-800/80 hover:border-emerald-200 dark:hover:border-emerald-800')
                                }`}>
                                    {/* Fila 1: Imagen, Nombre y Precio Unitario */}
                                    <div className="flex items-center gap-2.5 w-full min-w-0">
                                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${
                                            isCashAdvance 
                                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                                                : isCustomProduct 
                                                ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600' 
                                                : 'bg-slate-50 dark:bg-slate-950'
                                        }`}>
                                            {isCashAdvance ? (
                                                <DollarSign size={18} className="animate-pulse" />
                                            ) : (
                                                <SmartImage
                                                    src={item.image}
                                                    product={item}
                                                    alt={item.name}
                                                    className="w-full h-full object-contain mix-blend-multiply dark:mix-blend-normal"
                                                    fallbackIcon={
                                                        isCustomProduct ? (
                                                            <DollarSign size={18} />
                                                        ) : (
                                                            <Package size={15} className="text-slate-300" />
                                                        )
                                                    }
                                                />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-xs font-bold text-slate-800 dark:text-slate-100 leading-tight mb-0.5 ${isCashAdvance ? 'break-words' : 'truncate'}`}>{item.name}</p>
                                            <div className={`flex items-center flex-wrap ${isCashAdvance ? 'gap-1' : 'gap-1'}`}>
                                                {/* SYNC-CESTA-001: el producto salió del catálogo con la línea ya cargada. */}
                                                {!isCashAdvance && item._productMissing && (
                                                    <p
                                                        title="El producto ya no existe en el inventario. La línea conserva los datos con los que se agregó."
                                                        className="text-[10px] font-black text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-1 py-0.2 rounded"
                                                    >
                                                        Producto ya no existe
                                                    </p>
                                                )}
                                                {/* AVISO-REPRECIO: si el cliente paga en Bs, este ítem se cobra a su Ref. */}
                                                {!isCashAdvance && item.pricingMode === 'dual_usd' && parseFloat(item.priceBsUsdRef) > 0 && (
                                                    <p
                                                        title={`Si el cliente paga en Bs, este ticket se cobra a $${formatUsd(item.priceBsUsdRef)} Ref`}
                                                        className="text-[10px] font-black text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1 py-0.2 rounded cursor-help"
                                                    >
                                                        Ref Bs
                                                    </p>
                                                )}
                                                {isCashAdvance ? (
                                                    <>
                                                        <p className="text-[10px] font-black text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1 py-0.2 rounded">
                                                            {item.currency === 'BS' ? `Bs ${formatBs(item.exactBs)}` : `$${formatUsd(item.priceUsd)}`}
                                                        </p>
                                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                                                            {`Comisión: ${item.comisionPct}% (+${item.currency === 'BS' ? formatBs(item.montoComision) + ' Bs' : '$' + formatUsd(item.montoComision)})`}
                                                        </p>
                                                    </>
                                                ) : (
                                                    copEnabled && tasaCop > 0 ? (
                                                        copPrimary ? (
                                                            <>
                                                                <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1 py-0.2 rounded">{formatCop(getCop(item, tasaCop))} COP</p>
                                                                <p className="text-[10px] font-bold text-emerald-600">${formatUsd(item.priceUsd)}</p>
                                                                <p className="text-[10px] font-bold text-brand dark:text-brand">{item.exactBs != null ? formatBs(item.exactBs) : formatBs(mulR(item.priceUsd, effectiveRate))} Bs</p>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <p className="text-[10px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1 py-0.2 rounded">${formatUsd(item.priceUsd)}</p>
                                                                <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{formatCop(getCop(item, tasaCop))} COP</p>
                                                                <p className="text-[10px] font-bold text-brand dark:text-brand">{item.exactBs != null ? formatBs(item.exactBs) : formatBs(mulR(item.priceUsd, effectiveRate))} Bs</p>
                                                            </>
                                                        )
                                                    ) : (
                                                        <>
                                                            <p className="text-[10px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">${formatUsd(item.priceUsd)}</p>
                                                            <p className="text-[10px] font-bold text-brand dark:text-brand">
                                                                {item.pricingMode === 'dual_usd' && parseFloat(item.priceBsUsdRef) > 0
                                                                    ? `${formatBs(mulR(item.priceBsUsdRef, effectiveRate))} Bs`
                                                                    : (item.exactBs != null ? formatBs(item.exactBs) : `${formatBs(mulR(item.priceUsd, effectiveRate))} Bs`)
                                                                }
                                                            </p>
                                                        </>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Fila 2: Subtotal Dual ($ + Bs) si qty > 1, o Badge 1 un. si qty = 1 + Controles */}
                                    <div className="flex items-center justify-between gap-1.5 w-full pt-1.5 border-t border-slate-100 dark:border-slate-800/60">
                                        {itemIsGranel || item.qty > 1 ? (
                                            <div className="flex items-center gap-1 flex-wrap min-w-0">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">SUBTOTAL:</span>
                                                <span className="text-xs font-black text-slate-800 dark:text-white shrink-0">${formatUsd(mulR(item.priceUsd, item.qty))}</span>
                                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 truncate">
                                                    ({formatBs(
                                                        item.pricingMode === 'dual_usd' && parseFloat(item.priceBsUsdRef) > 0
                                                            ? mulR(mulR(item.priceBsUsdRef, item.qty), effectiveRate)
                                                            : (item.exactBs != null ? mulR(item.exactBs, item.qty) : mulR(mulR(item.priceUsd, item.qty), effectiveRate))
                                                    )} Bs)
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1">
                                                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
                                                    {itemIsGranel ? `1 ${itemUnitLabel}` : '1 un.'}
                                                </span>
                                            </div>
                                        )}

                                        <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                            {isCashAdvance ? (
                                                <div className="px-2.5 py-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 rounded-lg text-[11px] font-black select-none border border-amber-200/40">
                                                    Único
                                                </div>
                                            ) : (
                                                <div className="flex items-center bg-slate-50 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200/60 dark:border-slate-700">
                                                    <button 
                                                        type="button"
                                                        aria-label="Quitar uno" 
                                                        onClick={() => updateQty(item.id, itemIsGranel ? -0.1 : -1)} 
                                                        className="w-7 h-7 min-h-[36px] min-w-[36px] lg:min-h-[28px] lg:min-w-[28px] lg:w-7 lg:h-7 flex items-center justify-center text-slate-500 hover:text-red-500 transition-colors rounded-md active:bg-slate-200 dark:active:bg-slate-700"
                                                    >
                                                        <Minus size={14} strokeWidth={2.5} />
                                                    </button>
                                                    
                                                    {isEditing ? (
                                                        <input
                                                            ref={inputRef}
                                                            type="number"
                                                            value={tempQty}
                                                            onChange={e => setTempQty(e.target.value)}
                                                            onFocus={e => e.target.select()}
                                                            onBlur={() => submitCustomQty(item)}
                                                            onKeyDown={e => { if (e.key === 'Enter') submitCustomQty(item) }}
                                                            placeholder={item.qty.toString()}
                                                            className="w-10 h-7 text-center font-black text-slate-700 bg-white dark:bg-slate-900 dark:text-white border border-emerald-500 rounded-md text-xs outline-none"
                                                            step={itemIsGranel ? "0.001" : "1"}
                                                            inputMode={itemIsGranel ? "decimal" : "numeric"}
                                                        />
                                                    ) : (
                                                        <span 
                                                            onClick={() => handleQtyClick(item)} 
                                                            className="w-7 text-center font-black text-slate-800 dark:text-white text-xs cursor-pointer hover:text-emerald-500 transition-colors"
                                                        >
                                                            {qtyDisplay}
                                                        </span>
                                                    )}

                                                    <button 
                                                        type="button"
                                                        aria-label="Agregar uno" 
                                                        onClick={() => updateQty(item.id, itemIsGranel ? 0.1 : 1)} 
                                                        className="w-7 h-7 min-h-[36px] min-w-[36px] lg:min-h-[28px] lg:min-w-[28px] lg:w-7 lg:h-7 flex items-center justify-center text-slate-500 hover:text-emerald-500 transition-colors rounded-md active:bg-slate-200 dark:active:bg-slate-700"
                                                    >
                                                        <Plus size={14} strokeWidth={2.5} />
                                                    </button>
                                                </div>
                                            )}

                                            <button 
                                                type="button"
                                                aria-label="Eliminar del carrito" 
                                                onClick={() => removeFromCart(item.id)} 
                                                className="w-7 h-7 min-w-[36px] min-h-[36px] lg:min-h-[28px] lg:min-w-[28px] lg:w-7 lg:h-7 flex items-center justify-center bg-rose-50 dark:bg-rose-950/30 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors rounded-lg shrink-0"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer — shrink-0, always visible at bottom of flex container */}
            <div className="shrink-0 p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-[calc(1rem+env(safe-area-inset-bottom))] lg:pb-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-b-none lg:rounded-b-2xl lg:sm:rounded-b-3xl space-y-2.5">
                
                {/* Botón de Descuento */}
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); onOpenDiscount(); }}
                    disabled={cart.length === 0}
                    className={`w-full py-2 sm:py-2.5 px-3 sm:px-4 rounded-xl flex items-center justify-between transition-all outline-none focus:ring-2 focus:ring-brand/50 ${discountData?.active ? 'bg-amber-100/80 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                >
                    <div className="flex items-center gap-2">
                        <Percent size={15} className={discountData?.active ? 'text-amber-600 dark:text-amber-500' : ''} />
                        <span className="text-xs font-bold">
                            {discountData?.active ? 'Descuento Aplicado' : 'Añadir Descuento'}
                        </span>
                    </div>
                    {discountData?.active && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] sm:text-xs font-bold bg-amber-200 dark:bg-amber-800/80 px-2 py-0.5 rounded-md">
                                {discountData.type === 'percentage' ? `${discountData.value}%` : 'Fijo'}
                            </span>
                            {copEnabled && tasaCop > 0 && copPrimary ? (
                                <>
                                    <span className="font-black text-amber-600 dark:text-amber-400">{`-${formatCop(discountData.amountUsd * tasaCop)} COP`}</span>
                                    <span className="text-[9px] font-medium text-amber-600/70 dark:text-amber-400/70 ml-1">-${discountData.amountUsd.toFixed(2)}</span>
                                </>
                            ) : (
                                <>
                                    <span className="font-black text-xs">{`-$${discountData.amountUsd.toFixed(2)}`}</span>
                                    {copEnabled && tasaCop > 0 && (
                                        <span className="text-[9px] font-medium text-amber-600/70 dark:text-amber-400/70 ml-1">-{formatCop(discountData.amountUsd * tasaCop)} COP</span>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </button>

                {/* Subtotal simple */}
                <div className="flex justify-between items-center text-xs font-bold text-slate-500 px-1 pt-1">
                    <span>Subtotal</span>
                    <span>
                        {copEnabled && tasaCop > 0
                            ? (copPrimary
                                ? `${formatCop(cartSubtotalUsd * tasaCop)} COP · $${cartSubtotalUsd.toFixed(2)}`
                                : `$${cartSubtotalUsd.toFixed(2)} · ${formatCop(cartSubtotalUsd * tasaCop)} COP`)
                            : `$${cartSubtotalUsd.toFixed(2)}`}
                    </span>
                </div>

                {/* Caja de totales doble columna */}
                <div className="flex rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50/50 dark:bg-slate-950/20">
                    <div className="flex-1 p-3 flex flex-col items-start">
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">TOTAL $</span>
                        <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white leading-none">
                            ${cartTotalUsd.toFixed(2)}
                        </span>
                    </div>
                    <div className="w-px bg-slate-200 dark:bg-slate-850" />
                    <div className="flex-1 p-3 flex flex-col items-end">
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">BOLÍVARES</span>
                        <span className="text-xl sm:text-2xl font-black text-brand dark:text-brand leading-none">
                            {formatBs(displayCartTotalBs)}
                        </span>
                    </div>
                </div>

                {/* Botones de acción */}
                <div className="flex gap-2">
                    <button
                        disabled={cart.length === 0}
                        onClick={onCheckout}
                        className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all"
                    >
                        <CheckCircle size={18} className="opacity-80" />
                        COBRAR
                        <kbd className="bg-white/20 px-1.5 py-0.5 rounded text-[9px] font-mono leading-none">F9</kbd>
                    </button>
                </div>
            </div>
        </div>
    );
}
