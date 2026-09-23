import React from 'react';
import { CheckCircle, Wallet, Send, X, Printer } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { printThermalTicket } from '../../utils/ticketGenerator';
import CasheaIcon from '../CasheaIcon';

export default function ReceiptModal({ receipt, onClose, onShareWhatsApp, currentRate, copPrimary }) {
    if (!receipt) return null;

    const receiptCurrencyMode = localStorage.getItem('receipt_currency_mode') || 'bs';

    return (
        <div className="fixed inset-0 z-[60] bg-slate-900/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-sm sm:rounded-[2rem] rounded-t-[2rem] shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden relative flex flex-col max-h-[95vh] sm:max-h-[90vh]">

                {/* Botón X cerrar — siempre visible */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-30 w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 rounded-full flex items-center justify-center transition-all active:scale-90"
                    title="Cerrar"
                >
                    <X size={18} />
                </button>

                {/* Contenido scrollable */}
                <div className="flex-1 overflow-y-auto overscroll-contain">
                    {/* Bordes serrados efecto ticket */}
                    <div className="h-4 bg-white shrink-0" style={{ backgroundImage: 'radial-gradient(circle at 10px 0, transparent 10px, white 10px)', backgroundSize: '20px 20px' }}></div>

                    <div className="p-6 sm:p-8 pt-8 sm:pt-10 text-center bg-white border-b-2 border-dashed border-slate-200">
                        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 relative">
                            <CheckCircle size={36} className="text-emerald-500 relative z-10" />
                            <div className="absolute inset-0 bg-emerald-400 rounded-full animate-ping opacity-20"></div>
                        </div>
                        <h3 className="text-2xl font-black text-slate-800 tracking-tight mb-1">
                            {receipt.tipo === 'AVANCE_EFECTIVO' ? 'Comprobante de Avance' : `Orden #${(receipt.id.substring(0, 6)).toUpperCase()}`}
                        </h3>
                        {receipt.customerName && <p className="text-sm font-bold text-slate-500 mb-0 uppercase tracking-tight">{receipt.customerName}</p>}
                        {receipt.customerDocument && (
                            <p className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">
                                C.I/RIF: {receipt.customerDocument}
                            </p>
                        )}
                        {(() => {
                            if (receipt.tipo === 'AVANCE_EFECTIVO') {
                                return (
                                    <p className="text-4xl font-black text-brand mb-2 tracking-tighter">
                                        {receipt.currency === 'BS' ? `Bs ${formatBs(receipt.totalCobrado)}` : `$${receipt.totalCobrado.toFixed(2)} USD`}
                                    </p>
                                );
                            }
                            const isCop = receipt.copEnabled && receipt.tasaCop > 0;
                            
                            if (receiptCurrencyMode === 'usd') {
                                return <p className="text-4xl font-black text-slate-900 mb-2 tracking-tighter">${receipt.totalUsd.toFixed(2)} USD</p>;
                            }
                            if (receiptCurrencyMode === 'bs') {
                                return <p className="text-4xl font-black text-brand mb-2 tracking-tighter">Bs {formatBs(receipt.totalBs)}</p>;
                            }
                            
                            // mixto
                            return isCop ? (
                                copPrimary ? (
                                    <>
                                        <p className="text-4xl font-black text-amber-600 dark:text-amber-400 mb-1 tracking-tighter">{formatCop(receipt.totalCop || (receipt.totalUsd * receipt.tasaCop))} COP</p>
                                        <p className="text-lg font-bold text-slate-500 mb-2">${receipt.totalUsd.toFixed(2)} USD · {formatBs(receipt.totalBs)} Bs</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-4xl font-black text-slate-900 mb-1 tracking-tighter">${receipt.totalUsd.toFixed(2)}</p>
                                        <p className="text-lg font-bold text-slate-500 mb-2">{formatCop(receipt.totalCop || (receipt.totalUsd * receipt.tasaCop))} COP · {formatBs(receipt.totalBs)} Bs</p>
                                    </>
                                )
                            ) : (
                                <>
                                    <p className="text-4xl font-black text-slate-900 mb-1 tracking-tighter">${receipt.totalUsd.toFixed(2)}</p>
                                    <p className="text-lg font-bold text-slate-500 mb-2">{formatBs(receipt.totalBs)} Bs</p>
                                </>
                            );
                        })()}

                        <div className="inline-flex items-center flex-wrap justify-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-xs font-bold text-slate-600 dark:text-slate-350 mt-2">
                            {receipt.payments && receipt.payments.filter(p => p.methodId !== 'cashea' && !p.isCashea).map((p, i, arr) => (
                                <span key={p.id} className="flex items-center gap-1">
                                    <Wallet size={12} /> {p.methodLabel} {i < arr.length - 1 ? ' • ' : ''}
                                </span>
                            ))}
                            {receipt.casheaUsd > 0 && (
                                <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400 font-extrabold ml-1">
                                    <CasheaIcon size={12} /> Cashea
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="bg-slate-50 px-6 sm:px-8 py-6">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                            {receipt.tipo === 'AVANCE_EFECTIVO' ? 'Detalle del Avance' : 'Detalle de Consumo'}
                        </p>
                        <div className="space-y-3">
                            {receipt.tipo === 'AVANCE_EFECTIVO' ? (
                                <div className="space-y-3 text-sm">
                                    <div className="flex justify-between items-center border-b border-slate-200/50 pb-2">
                                        <span className="font-bold text-slate-600 dark:text-slate-400">Efectivo Entregado:</span>
                                        <strong className="font-black text-slate-850 dark:text-slate-200">
                                            {receipt.currency === 'BS' ? `${formatBs(receipt.montoEfectivo)} Bs` : `$${receipt.montoEfectivo.toFixed(2)}`}
                                        </strong>
                                    </div>
                                    <div className="flex justify-between items-center border-b border-slate-200/50 pb-2">
                                        <span className="font-bold text-slate-600 dark:text-slate-400">Comisión ({receipt.comisionPct}%):</span>
                                        <strong className="font-black text-emerald-600 dark:text-emerald-450">
                                            {receipt.currency === 'BS' ? `+${formatBs(receipt.montoComision)} Bs` : `+$${receipt.montoComision.toFixed(2)}`}
                                        </strong>
                                    </div>
                                    <div className="flex justify-between items-center pt-1">
                                        <span className="font-bold text-slate-700 dark:text-slate-300">Total a Cobrar:</span>
                                        <strong className="text-base font-black text-brand">
                                            {receipt.currency === 'BS' ? `${formatBs(receipt.totalCobrado)} Bs` : `$${receipt.totalCobrado.toFixed(2)}`}
                                        </strong>
                                    </div>
                                </div>
                            ) : (
                                receipt.items.map((item, i) => {
                                const isCop = receipt.copEnabled && receipt.tasaCop > 0;
                                const isBsReceipt = (receipt.payments || []).some(p => p.currency === 'BS' || p.methodId?.includes('_bs') || p.methodId === 'pago_movil');
                                const isDualBs = item.pricingMode === 'dual_usd' && parseFloat(item.priceBsUsdRef) > 0 && isBsReceipt;
                                const itemPriceUsd = isDualBs ? parseFloat(item.priceBsUsdRef) : item.priceUsd;
                                const priceBs = itemPriceUsd * (receipt.rate || 0);
                                const totalBs = itemPriceUsd * item.qty * (receipt.rate || 0);

                                if (item.isCashAdvance) {
                                    return (
                                        <div key={i} className="bg-amber-500/5 dark:bg-amber-500/10 border border-dashed border-amber-500/20 p-3 rounded-2xl space-y-1.5 text-xs text-left">
                                            <div className="flex justify-between items-center text-slate-500">
                                                <span className="font-bold text-slate-700 block leading-tight">{item.name}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-slate-650 dark:text-slate-400">
                                                <span>Efectivo Entregado:</span>
                                                <strong className="font-bold text-slate-800 dark:text-white">
                                                    {item.currency === 'BS' ? `${formatBs(item.montoEfectivo)} Bs` : `$${item.montoEfectivo.toFixed(2)}`}
                                                </strong>
                                            </div>
                                            <div className="flex justify-between items-center text-slate-650 dark:text-slate-400">
                                                <span>Comisión Recargo ({item.comisionPct}%):</span>
                                                <strong className="font-black text-emerald-600 dark:text-emerald-400">
                                                    {item.currency === 'BS' ? `+${formatBs(item.montoComision)} Bs` : `+$${item.montoComision.toFixed(2)}`}
                                                </strong>
                                            </div>
                                            <div className="flex justify-between items-center border-t border-slate-200/50 dark:border-slate-800/50 pt-1.5 text-sm">
                                                <span className="font-bold text-slate-700 dark:text-slate-350">Total Cobrado:</span>
                                                <strong className="text-sm font-black text-brand">
                                                    {item.currency === 'BS' ? `${formatBs(item.montoEfectivo + item.montoComision)} Bs` : `$${(item.montoEfectivo + item.montoComision).toFixed(2)}`}
                                                </strong>
                                            </div>
                                        </div>
                                    );
                                }

                                if (receiptCurrencyMode === 'usd') {
                                    return (
                                        <div key={i} className="flex justify-between items-start text-sm border-b border-slate-200/50 pb-2 last:border-0 last:pb-0">
                                            <div className="flex-1 pr-4">
                                                <span className="font-bold text-slate-700 block leading-tight">{item.name}</span>
                                                <span className="text-xs text-slate-400">{item.isWeight ? `${item.qty.toFixed(3)} Kg` : `${item.qty} u`} × ${itemPriceUsd.toFixed(2)}</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-black text-slate-900">${(itemPriceUsd * item.qty).toFixed(2)}</span>
                                            </div>
                                        </div>
                                    );
                                }

                                if (receiptCurrencyMode === 'bs') {
                                    return (
                                        <div key={i} className="flex justify-between items-start text-sm border-b border-slate-200/50 pb-2 last:border-0 last:pb-0">
                                            <div className="flex-1 pr-4">
                                                <span className="font-bold text-slate-700 block leading-tight">{item.name}</span>
                                                <span className="text-xs text-slate-400">{item.isWeight ? `${item.qty.toFixed(3)} Kg` : `${item.qty} u`} × Bs {formatBs(priceBs)}</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-black text-brand">Bs {formatBs(totalBs)}</span>
                                            </div>
                                        </div>
                                    );
                                }

                                // mixto
                                return (
                                    <div key={i} className="flex justify-between items-start text-sm border-b border-slate-200/50 pb-2 last:border-0 last:pb-0">
                                        <div className="flex-1 pr-4">
                                            <span className="font-bold text-slate-700 block leading-tight">{item.name}</span>
                                            {isCop ? (
                                                copPrimary ? (
                                                    <>
                                                        <span className="text-xs text-slate-400">{item.isWeight ? `${item.qty.toFixed(3)} Kg` : `${item.qty} u`} × {formatCop(item.priceCop || Math.round(itemPriceUsd * receipt.tasaCop))} COP</span>
                                                        <span className="text-xs text-slate-400 block">
                                                            <span className="text-emerald-600">${itemPriceUsd.toFixed(2)} USD</span> · <span className="text-brand">{formatBs(priceBs)} Bs</span> c/u
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="text-xs text-slate-400">{item.isWeight ? `${item.qty.toFixed(3)} Kg` : `${item.qty} u`} × ${itemPriceUsd.toFixed(2)}</span>
                                                        <span className="text-xs text-slate-400 block">
                                                            <span className="text-amber-600">{formatCop(item.priceCop || Math.round(itemPriceUsd * receipt.tasaCop))} COP</span> · <span className="text-brand">{formatBs(priceBs)} Bs</span> c/u
                                                        </span>
                                                    </>
                                                )
                                            ) : (
                                                <span className="text-xs text-slate-400">{item.isWeight ? `${item.qty.toFixed(3)} Kg` : `${item.qty} u`} × ${itemPriceUsd.toFixed(2)}</span>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            {isCop ? (
                                                copPrimary ? (
                                                    <>
                                                        <span className="font-black text-amber-600 dark:text-amber-400 block">{formatCop((item.priceCop || Math.round(itemPriceUsd * receipt.tasaCop)) * item.qty)} COP</span>
                                                        <span className="text-xs text-emerald-600">${(itemPriceUsd * item.qty).toFixed(2)}</span>
                                                        <span className="text-xs text-brand block">{formatBs(totalBs)} Bs</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="font-black text-slate-900 block">${(itemPriceUsd * item.qty).toFixed(2)}</span>
                                                        <span className="text-xs text-amber-600">{formatCop((item.priceCop || Math.round(itemPriceUsd * receipt.tasaCop)) * item.qty)} COP</span>
                                                        <span className="text-xs text-brand block">{formatBs(totalBs)} Bs</span>
                                                    </>
                                                )
                                            ) : (
                                                <>
                                                    <span className="font-black text-slate-900 block">${(itemPriceUsd * item.qty).toFixed(2)}</span>
                                                    <span className="text-xs text-brand block">{formatBs(totalBs)} Bs</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            }))}
                        </div>

                        {receipt.payments && receipt.payments.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-slate-200 text-sm">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Pagos Recibidos</p>
                                {receipt.payments.filter(p => p.methodId !== 'cashea' && !p.isCashea).map(p => (
                                    <div key={p.id} className="flex justify-between text-slate-600 mb-1">
                                        <span>{p.methodLabel}:</span>
                                        <span className="font-bold">{p.amountInputCurrency === 'USD' ? '$' : p.amountInputCurrency === 'COP' ? 'COP' : 'Bs'} {p.amountInput}</span>
                                    </div>
                                ))}

                                {receipt.casheaUsd > 0 && (
                                    <div className="flex justify-between text-purple-600 dark:text-purple-400 font-black mt-2 pt-2 border-t border-slate-200 bg-purple-50 dark:bg-purple-950/20 -mx-4 px-4 py-2 rounded-lg">
                                        <span className="flex items-center gap-1.5">
                                            <CasheaIcon size={12} /> Financiado (Cashea):
                                        </span>
                                        <span>
                                            {receiptCurrencyMode === 'usd'
                                                ? `$${receipt.casheaUsd.toFixed(2)} USD`
                                                : receiptCurrencyMode === 'bs'
                                                ? `Bs ${formatBs(receipt.casheaUsd * receipt.rate)}`
                                                : `$${receipt.casheaUsd.toFixed(2)} USD / Bs ${formatBs(receipt.casheaUsd * receipt.rate)}`
                                            }
                                        </span>
                                    </div>
                                )}

                                {(receipt.changeUsd > 0 || receipt.changeBs > 0) && (
                                    <div className="flex justify-between text-emerald-600 font-bold mt-2 pt-2 border-t border-slate-200">
                                        <span>Vuelto entregado:</span>
                                        <span>
                                            {receiptCurrencyMode === 'usd'
                                                ? `$${receipt.changeUsd.toFixed(2)}`
                                                : receiptCurrencyMode === 'bs'
                                                ? `Bs ${formatBs(receipt.changeBs)}`
                                                : receipt.copEnabled && receipt.tasaCop > 0
                                                ? copPrimary
                                                    ? `${formatCop(receipt.changeUsd * receipt.tasaCop)} COP / $${receipt.changeUsd.toFixed(2)} / ${formatBs(receipt.changeBs)} Bs`
                                                    : `$${receipt.changeUsd.toFixed(2)} / ${formatCop(receipt.changeUsd * receipt.tasaCop)} COP / ${formatBs(receipt.changeBs)} Bs`
                                                : `$${receipt.changeUsd.toFixed(2)} / ${formatBs(receipt.changeBs)}`
                                            }
                                        </span>
                                    </div>
                                )}

                                {/* TIP-007: constancia de la propina donada. */}
                                {receipt.tipDonated && receipt.tipDonated.amountUsd > 0 && (
                                    <div className="flex justify-between text-emerald-700 font-bold mt-2 pt-2 border-t border-slate-200">
                                        <span>Cambio dejado en caja:</span>
                                        <span>
                                            {receipt.tipDonated.currency === 'BS'
                                                ? `Bs ${formatBs(receipt.tipDonated.amountBs)}`
                                                : `$${receipt.tipDonated.amountUsd.toFixed(2)}`
                                            }
                                        </span>
                                    </div>
                                )}

                                {receipt.fiadoUsd > 0 && (
                                    <div className="flex justify-between text-amber-600 font-bold mt-2 pt-2 border-t border-slate-200">
                                        <span>Pendiente (Fiado):</span>
                                        <span>
                                            {receiptCurrencyMode === 'usd'
                                                ? `$${receipt.fiadoUsd.toFixed(2)}`
                                                : receiptCurrencyMode === 'bs'
                                                ? `Bs ${formatBs(receipt.fiadoUsd * (currentRate || receipt.rate))}`
                                                : receipt.copEnabled && receipt.tasaCop > 0
                                                ? copPrimary
                                                    ? `${formatCop(receipt.fiadoUsd * receipt.tasaCop)} COP / $${receipt.fiadoUsd.toFixed(2)} / ${formatBs(receipt.fiadoUsd * (currentRate || receipt.rate))} Bs`
                                                    : `$${receipt.fiadoUsd.toFixed(2)} / ${formatCop(receipt.fiadoUsd * receipt.tasaCop)} COP / ${formatBs(receipt.fiadoUsd * (currentRate || receipt.rate))} Bs`
                                                : `$${receipt.fiadoUsd.toFixed(2)} / ${formatBs(receipt.fiadoUsd * (currentRate || receipt.rate))}`
                                            }
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* AVISO-CARTERA (H2): un fiado a un cliente con saldo a favor
                            consume el favor antes de crear deuda (la cartera es neta).
                            Sin esta nota, el cliente ve un fiado que «no aumentó» su
                            deuda y el cajero no puede explicarlo. Va FUERA del bloque
                            de pagos porque una venta 100% fiada no registra pagos. */}
                        {(() => {
                            const ws = receipt.walletSnapshot;
                            const fiado = Number(receipt.fiadoUsd) || 0;
                            if (!ws || !(ws.favorAntes > 0.001) || !(fiado > 0.001)) return null;
                            const consumido = Math.min(ws.favorAntes, fiado);
                            const cubiertoTotalmente = consumido >= fiado - 0.001;
                            return (
                                <div className="mt-4 pt-4 border-t border-slate-200 text-sm">
                                    <div className="flex justify-between text-sky-700 dark:text-sky-400 font-bold">
                                        <span className="flex items-center gap-1.5"><Wallet size={14} /> Saldo a favor aplicado:</span>
                                        <span>${consumido.toFixed(2)}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 text-left leading-snug">
                                        {cubiertoTotalmente
                                            ? 'Este fiado se cubrió con el saldo a favor del cliente: la deuda no aumentó.'
                                            : `Los primeros $${consumido.toFixed(2)} del fiado se cubrieron con su saldo a favor; el resto ($${(fiado - consumido).toFixed(2)}) quedó como deuda.`}
                                    </p>
                                </div>
                            );
                        })()}

                        <div className="mt-6 flex flex-col items-center gap-1">
                            <p className="text-center text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                                Tasa BCV Aplicada: {formatBs(receipt.rate)} Bs/$
                            </p>
                            {receipt.tasaCop > 0 && (
                                <p className="text-center text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                                    Tasa COP Aplicada: {receipt.tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP/$
                                </p>
                            )}
                            <p className="text-center text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                                {new Date(receipt.timestamp).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Botones de acción — diseño premium */}
                <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 flex gap-2 relative z-20 shrink-0 border-t border-slate-100 dark:border-slate-800">
                    {/* Imprimir */}
                    <button 
                        onClick={() => printThermalTicket(receipt, currentRate || receipt.rate)}
                        className="flex-1 py-3.5 px-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold rounded-2xl transition-all text-xs sm:text-sm flex items-center justify-center gap-1.5 focus:outline-none active:scale-[0.97]"
                    >
                        <Printer size={15} strokeWidth={2.5} /> Imprimir
                    </button>

                    {/* WhatsApp */}
                    <button 
                        onClick={() => onShareWhatsApp(receipt)}
                        className="flex-1 py-3.5 px-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-bold rounded-2xl transition-all text-xs sm:text-sm flex items-center justify-center gap-1.5 focus:outline-none active:scale-[0.97]"
                    >
                        <Send size={15} strokeWidth={2.5} /> WhatsApp
                    </button>

                    {/* Nueva Venta — Primary CTA */}
                    <button 
                        onClick={onClose}
                        className="flex-[1.2] py-3.5 px-2 bg-brand text-white font-extrabold rounded-2xl hover:bg-brand-dark transition-all shadow-md shadow-brand/20 text-xs sm:text-sm flex items-center justify-center gap-1.5 focus:outline-none active:scale-[0.97]"
                    >
                        Nueva Venta
                    </button>
                </div>
            </div>
        </div>
    );
}
