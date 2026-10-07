import { useState } from 'react';
import { Calendar, DollarSign, TrendingUp, TrendingDown, ShoppingBag, Package, ChevronDown, ChevronUp, Clock, Send, Ban, Shuffle, Search, X, Recycle, LockIcon, CornerDownLeft, Printer, Lightbulb, Car, User, Wrench, FileText } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { buildPaymentBreakdownRows, toBsEquivalent } from '../../utils/paymentBreakdownView';
import { buildReceivablesView } from '../../utils/receivablesReport';
import { getPaymentLabel, getPaymentMethod, PAYMENT_ICONS, toTitleCase, getPaymentIcon } from '../../config/paymentMethods';
import { generateTicketPDF, printThermalTicket } from '../../utils/ticketGenerator';
import EmptyState from '../EmptyState';
import { BarChart3 } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';

// ── Helper sub-components (moved from ReportsView) ──

function SaleMethodIcon({ iconId }) {
    if (iconId === '_clock') return <Clock size={20} className="text-slate-500" />;
    if (iconId === '_shuffle') return <Shuffle size={20} className="text-slate-500" />;
    const Icon = getPaymentIcon(iconId) || PAYMENT_ICONS[iconId];
    return Icon ? <Icon size={20} className="text-slate-500" /> : <span className="text-xl">$</span>;
}

function StatCard({ icon: Icon, label, value, sub, color }) {
    const colors = {
        emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
        blue: 'bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand',
        indigo: 'bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand',
        amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
        rose: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
    };
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 md:p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${colors[color]}`}>
                <Icon size={16} />
            </div>
            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">{label}</p>
            <p className="text-xl md:text-2xl font-outfit font-semibold text-slate-900 dark:text-white mt-0.5">{value}</p>
            {sub && <p className="text-xs font-bold text-slate-600 dark:text-slate-400 mt-0.5">{sub}</p>}
        </div>
    );
}

const GASTO_META = {
    insumos: { label: 'Insumos', icon: Package, bgIcon: 'bg-blue-100 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400' },
    servicios: { label: 'Servicios', icon: Lightbulb, bgIcon: 'bg-amber-100 dark:bg-amber-900/30 text-amber-500 dark:text-amber-400' },
    transporte: { label: 'Transporte', icon: Car, bgIcon: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400' },
    personal: { label: 'Personal', icon: User, bgIcon: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 dark:text-emerald-400' },
    mantenimiento: { label: 'Mantenimiento', icon: Wrench, bgIcon: 'bg-rose-100 dark:bg-rose-900/30 text-rose-500 dark:text-rose-400' },
    otros: { label: 'Otros', icon: FileText, bgIcon: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' }
};

function TransactionRow({ sale: s, bcvRate, isExpanded, onToggle, onVoidSale, onRecycleSale, copEnabled, copPrimary, tasaCop, onPrintTicket }) {
    const d = new Date(s.timestamp);
    let methodLabel = 'Efectivo';
    let payMethodIconId = 'efectivo_bs';

    if (s.tipo === 'VENTA_FIADA') {
        methodLabel = 'Por Cobrar';
        payMethodIconId = '_clock';
    } else if (s.payments && s.payments.length === 1) {
        methodLabel = toTitleCase(s.payments[0].methodLabel);
        const m = getPaymentMethod(s.payments[0].methodId);
        if (m) payMethodIconId = m.id;
    } else if (s.payments && s.payments.length > 1) {
        methodLabel = 'Pago Mixto';
        payMethodIconId = '_shuffle';
    } else if (s.paymentMethod) {
        const m = getPaymentMethod(s.paymentMethod);
        if (m) {
            methodLabel = toTitleCase(m.label);
            payMethodIconId = m.id;
        }
    }

    const isCanceled = s.status === 'ANULADA';
    const dateLabel = d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });

    const handleShare = (e) => {
        e.stopPropagation();
        const useCop = copEnabled && copPrimary && tasaCop > 0;
        let text = `*COMPROBANTE | PRECIOS AL DIA*\n`;
        text += `Orden: #${s.id.substring(0, 6).toUpperCase()}\n`;
        text += `Fecha: ${d.toLocaleString('es-VE')}\n`;
        text += `================================\n`;
        if (s.items && s.items.length > 0) {
            s.items.forEach(item => {
                const qty = item.isWeight ? `${item.qty.toFixed(3)}Kg` : `${item.qty} Und`;
                if (useCop) {
                    text += `- ${item.name} ${qty} x ${formatCop(item.priceCop || Math.round(item.priceUsd * tasaCop))} COP = *${formatCop((item.priceCop || Math.round(item.priceUsd * tasaCop)) * item.qty)} COP*\n`;
                } else {
                    text += `- ${item.name} ${qty} x $${item.priceUsd.toFixed(2)} = *$${(item.priceUsd * item.qty).toFixed(2)}*\n`;
                }
            });
        }
        if (useCop) {
            text += `\n*TOTAL: ${formatCop((s.totalUsd || 0) * tasaCop)} COP*\n`;
            text += `Ref: $${(s.totalUsd || 0).toFixed(2)}\n`;
        } else {
            text += `\n*TOTAL: $${(s.totalUsd || 0).toFixed(2)}*\n`;
            text += `Ref: ${formatBs(s.totalBs || 0)} Bs\n`;
        }
        const encoded = encodeURIComponent(text);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    };

    const handlePDF = (e) => {
        e.stopPropagation();
        generateTicketPDF(s, bcvRate);
    };

    return (
        <div className={`rounded-xl border transition-all ${isCanceled ? 'bg-red-50/50 border-red-100/50 dark:bg-red-900/10 dark:border-red-900/20' : 'bg-white dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/60'} overflow-hidden`}>
            <div
                className="flex items-center gap-3 p-3 cursor-pointer select-none active:bg-slate-100 dark:active:bg-slate-800"
                onClick={onToggle}
            >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isCanceled ? 'bg-red-100 opacity-50' : 'bg-slate-50 dark:bg-slate-700 shadow-sm'}`}>
                    {isCanceled ? <Ban size={20} className="text-red-400" /> : <SaleMethodIcon iconId={payMethodIconId} />}
                </div>
                <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold flex items-center gap-1.5 truncate ${isCanceled ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                        {s.customerName || 'Consumidor Final'}
                        {s.tipo === 'VENTA_FIADA' && <span className="text-[9px] bg-amber-100 text-amber-600 px-1 rounded uppercase">Fiado</span>}
                        {isCanceled && <span className="text-[9px] bg-red-100 text-red-500 px-1 rounded uppercase">Anulada</span>}
                    </p>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                        <span>{dateLabel}</span> · <span>{d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span> · <span>{methodLabel}</span>
                    </p>
                </div>
                <div className="text-right shrink-0">
                    {copEnabled && copPrimary && tasaCop > 0 ? (
                        <>
                            <p className={`text-sm font-black ${isCanceled ? 'text-slate-400' : 'text-amber-600 dark:text-amber-400'}`}>{formatCop((s.totalUsd || 0) * tasaCop)} COP</p>
                            <p className="text-[10px] font-medium text-slate-400">${(s.totalUsd || 0).toFixed(2)}</p>
                        </>
                    ) : (
                        <>
                            <p className={`text-sm font-black ${isCanceled ? 'text-slate-400' : 'text-slate-800 dark:text-white'}`}>${(s.totalUsd || 0).toFixed(2)}</p>
                            <div className="flex justify-end mt-0.5">
                                {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                            </div>
                        </>
                    )}
                    {copEnabled && copPrimary && tasaCop > 0 && (
                        <div className="flex justify-end mt-0.5">
                            {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                        </div>
                    )}
                </div>
            </div>

            {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700/50 text-sm animate-in fade-in slide-in-from-top-1">
                    {s.items && s.items.length > 0 ? (
                        <div className="space-y-1 mb-3 pt-2">
                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Productos ({s.items.length})</p>
                            {s.items.map((item, i) => (
                                <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'}`}>
                                    <span className="truncate pr-2">
                                        {item.isWeight ? `${item.qty.toFixed(3)}kg` : `${item.qty}u`} {item.name}
                                        {(item.isWeight || item.qty !== 1) && (
                                            <span className="text-[10px] text-slate-400 font-normal ml-1">
                                                ({item.isWeight ? '' : 'c/u '}{copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(item.priceCop || Math.round(item.priceUsd * tasaCop))} COP` : `$${item.priceUsd.toFixed(2)}`})
                                            </span>
                                        )}
                                    </span>
                                    <span className="font-medium">{copEnabled && copPrimary && tasaCop > 0 ? `${formatCop((item.priceCop || Math.round(item.priceUsd * tasaCop)) * item.qty)} COP` : `$${(item.priceUsd * item.qty).toFixed(2)}`}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-slate-400 mb-3 pt-2">Pago de Deudas (Sin productos)</p>
                    )}

                    {s.payments && s.payments.length > 0 && (
                        <div className="space-y-1 mb-3 pt-2 border-t border-dashed border-slate-200 dark:border-slate-700/50">
                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Detalle de Pago</p>
                            {s.payments.map((p, i) => {
                                const pIsCop = p.currency === 'COP';
                                const pIsInternalCredit = p.methodId === 'saldo_favor' || p.currency === 'INTERNAL_CREDIT' || p.isInternalCredit;
                                const isBs = !pIsCop && !pIsInternalCredit && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
                                const val = pIsInternalCredit
                                    ? 'Crédito interno $' + (p.amountUsd || 0).toFixed(2)
                                    : pIsCop
                                    ? 'COP ' + (p.amountInput || (p.amountUsd * (s.tasaCop || tasaCop || 1))).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                    : isBs
                                    ? 'Bs ' + formatBs(p.amountBs || (p.amountUsd * (s.rate || bcvRate)))
                                    : `$${(p.amountUsd || 0).toFixed(2)}`;
                                
                                const isCashea = p.methodId === 'cashea';
                                
                                return (
                                    <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : isCashea ? 'text-purple-650 dark:text-purple-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
                                        <span className="flex items-center gap-1.5">
                                            {isCashea && <CasheaIcon size={12} />}
                                            {p.methodLabel || 'Pago'}
                                        </span>
                                        <span className="font-semibold">{val} {p.methodId !== 'cashea' && p.amountUsd > 0 && <span className="text-[10px] font-normal text-slate-400">(${(p.amountUsd || 0).toFixed(2)})</span>}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="flex justify-between text-[10px] font-medium text-slate-400 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg p-2 mb-3">
                        <div className="flex flex-col gap-0.5">
                            <span>Ref: {formatBs(s.totalBs)} Bs @ {formatBs(s.rate || bcvRate)}</span>
                            {s.tasaCop > 0 && <span>COP: {(s.totalCop || (s.totalUsd * s.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} @ {s.tasaCop}</span>}
                        </div>
                        {['VENTA', 'VENTA_CASHEA'].includes(s.tipo) && s.vueltoParaMonedero > 0 && (
                            <div className={`flex items-center gap-1 self-start mt-0.5 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 font-bold px-1.5 py-0.5 rounded-md border border-cyan-200 dark:border-cyan-800/40 text-[10px] ${isCanceled ? 'line-through opacity-70' : ''}`}>
                                <span>+${s.vueltoParaMonedero.toFixed(2)} saldo a favor acreditado</span>
                            </div>
                        )}
                        {(s.changeUsd > 0 || s.changeBs > 0) && (
                            <div className="flex items-center gap-1 self-start mt-0.5 bg-orange-50 dark:bg-orange-900/20 text-orange-500 dark:text-orange-400 font-bold px-1.5 py-0.5 rounded-md border border-orange-100 dark:border-orange-800/40 text-[10px]">
                                <CornerDownLeft size={10} />
                                <span>Vuelto entregado: {s.changeUsd > 0 ? `$${s.changeUsd.toFixed(2)}` : `Bs ${formatBs(s.changeBs)}`}</span>
                            </div>
                        )}
                        {s.tipDonated && s.tipDonated.amountUsd > 0 && (
                            <div className="flex items-center gap-1 self-start mt-0.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 font-bold px-1.5 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800/40 text-[10px]">
                                <span>Cambio dejado en caja: +${s.tipDonated.amountUsd.toFixed(2)}</span>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                        <button
                            onClick={handleShare}
                            className="flex-1 min-w-[120px] whitespace-nowrap py-2 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 active:scale-95"
                        >
                            <Send size={14} /> Compartir
                        </button>
                        <button
                            onClick={handlePDF}
                            className="py-2 px-3 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand hover:bg-brand-light font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                        >
                            PDF
                        </button>
                        {onPrintTicket && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onPrintTicket(s); }}
                                className="py-2 px-3 bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                                title="Imprimir ticket"
                            >
                                <Printer size={14} />
                                <span>Imprimir</span>
                            </button>
                        )}
                        {!isCanceled && onVoidSale && !s.cajaCerrada && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onVoidSale(s); }}
                                className="py-2 px-3 bg-slate-100 dark:bg-slate-900 text-red-600 dark:text-red-400 hover:bg-red-50 hover:dark:bg-red-900/30 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-800 shadow-sm active:scale-95"
                            >
                                <Ban size={14} /> Anular
                            </button>
                        )}
                        {!isCanceled && s.cajaCerrada && (
                            <div title="Venta protegida por Cierre de Caja" className="py-2 px-3 bg-slate-50 dark:bg-slate-900 text-slate-400 font-bold rounded-lg flex justify-center items-center gap-1.5 text-[10px] uppercase border border-slate-100 dark:border-slate-800 tracking-wider cursor-not-allowed">
                                <LockIcon size={12} /> Cerrada
                            </div>
                        )}
                        {onRecycleSale && s.items && s.items.length > 0 && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onRecycleSale(s); }}
                                className="py-2 px-3 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand hover:bg-brand-light hover:dark:bg-surface-800/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                            >
                                <Recycle size={14} />
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Metrics tab content — summary cards, daily chart, payment breakdown,
 * top products, and transaction list toggle.
 */
export default function ReportsMetricsTab({
    salesForStats,
    salesForCashFlow,
    historySales,
    totalUsd,
    totalBs,
    totalCop,
    totalItems,
    profit,
    paymentBreakdown,
    receivables = null,
    carteraUsd = null,
    topProducts,
    salesByDay,
    maxDayTotal,
    expensesList = [],
    expensesUsd = 0,
    expensesBs = 0,
    bcvRate,
    copEnabled,
    copPrimary,
    tasaCop,
    triggerHaptic,
    expandedSaleId,
    setExpandedSaleId,
    showHistory,
    setShowHistory,
    visibleCount,
    setVisibleCount,
    historySearch,
    setHistorySearch,
    historyFilter,
    setHistoryFilter,
    setVoidSaleTarget,
    setRecycleOffer,
    hideHistory = false,
    onlyHistory = false,
    onPrintTicket,
}) {
    return (
        <>
            {/* Summary Cards — ocultar si onlyHistory */}
            {!onlyHistory && (() => {
                const netProfitUsd = (bcvRate > 0 ? profit / bcvRate : 0) - expensesUsd;
                const netProfitBs = profit - expensesBs;
                return (
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        <StatCard icon={ShoppingBag} label="Ventas" value={salesForStats.length} color="emerald" />
                        <StatCard icon={DollarSign} label="Ingresos" value={copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(totalCop || Math.round(totalUsd * tasaCop))} COP` : `$${totalUsd.toFixed(2)}`} sub={copEnabled && tasaCop > 0 ? (copPrimary ? `$${totalUsd.toFixed(2)} · ${formatBs(totalBs)} Bs` : `${formatCop(totalCop || Math.round(totalUsd * tasaCop))} COP · ${formatBs(totalBs)} Bs`) : `${formatBs(totalBs)} Bs`} color="blue" />
                        <StatCard icon={TrendingDown} label="Egresos" value={copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(expensesUsd * tasaCop)} COP` : `$${expensesUsd.toFixed(2)}`} sub={copEnabled && tasaCop > 0 ? (copPrimary ? `$${expensesUsd.toFixed(2)} · ${formatBs(expensesBs)} Bs` : `${formatCop(expensesUsd * tasaCop)} COP · ${formatBs(expensesBs)} Bs`) : `${formatBs(expensesBs)} Bs`} color="rose" />
                        <StatCard icon={TrendingUp} label="Ganancia Neta" value={copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(netProfitUsd * tasaCop)} COP` : `$${netProfitUsd.toFixed(2)}`} sub={copEnabled && tasaCop > 0 ? (copPrimary ? `$${netProfitUsd.toFixed(2)} · ${formatBs(netProfitBs)} Bs` : `${formatCop(netProfitUsd * tasaCop)} COP · ${formatBs(netProfitBs)} Bs`) : `${formatBs(netProfitBs)} Bs`} color="indigo" />
                        <StatCard icon={Package} label="Artículos" value={totalItems} color="amber" />
                    </div>
                );
            })()}

            {/* Mini bar chart per day */}
            {!onlyHistory && salesByDay.length > 1 && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm mt-4">
                    <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 flex items-center gap-1">
                        <Calendar size={12} /> Ventas por Día
                    </h3>
                    <div className="flex items-end gap-1 h-24">
                        {salesByDay.map((day, i) => {
                            const pct = (day.total / maxDayTotal) * 100;
                            const dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
                            return (
                                <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400">{copEnabled && copPrimary && tasaCop > 0 ? `${Math.round(day.total * tasaCop / 1000)}k` : `$${day.total.toFixed(0)}`}</span>
                                    <div className="w-full flex justify-center">
                                        <div
                                            className="w-full max-w-[24px] rounded-t-md bg-gradient-to-t from-brand to-brand-dark transition-all duration-500"
                                            style={{ height: `${Math.max(pct, 6)}%`, minHeight: '3px' }}
                                        />
                                    </div>
                                    <span className="text-[8px] text-slate-500 dark:text-slate-400 font-medium leading-none">{dayLabel}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Payment Breakdown & Top Products Grid */}
            {!onlyHistory && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Medios de Pago */}
                    {Object.keys(paymentBreakdown).length > 0 && (() => {
                        // FIA-REPORT-001 (H4): el desglose se arma con el núcleo compartido
                        // (src/utils/paymentBreakdownView). El denominador de los % son SOLO
                        // medios de pago reales: el fiado, el crédito interno, la propina y el
                        // vuelto ya no diluyen los porcentajes.
                        const breakdownView = buildPaymentBreakdownRows(paymentBreakdown, { bcvRate, tasaCop });
                        const allEntries = breakdownView.rows.map(row => [row.key, {
                            ...paymentBreakdown[row.key],
                            pct: row.pct,
                            amountBs: row.amountBs,
                            isReceivable: row.isReceivable,
                            hasMovement: row.hasMovement,
                        }]);
                        // Paridad literal con DashboardPaymentBreakdown.jsx: Cashea es una
                        // cuenta por cobrar (Cashea le remesa a la bodega), nunca ingreso USD.
                        // TIP-005 (D1): la propina no es un método de pago. Ver
                        // DashboardPaymentBreakdown.jsx para el razonamiento completo.
                        // H1: la sección de cuentas por cobrar ya NO se deriva del bucket
                        // `fiado` — el motor descarta un neto de 0 y antes la UI filtraba por
                        // signo, así que desaparecía justo cuando había más cobranzas que fiado.
                        // Ahora se arma con `receivables`, que conoce cada movimiento.
                        // Flag de escape (G3): con `reportes_fiado_split=false` la sección vuelve
                        // al comportamiento anterior (sin bloque de cuentas por cobrar) sin redeploy.
                        const fiadoSplitEnabled = typeof localStorage === 'undefined'
                            || localStorage.getItem('reportes_fiado_split') !== 'false';
                        const receivablesView = buildReceivablesView(
                            fiadoSplitEnabled ? receivables : null,
                            { carteraUsd }
                        );
                        const internalCreditMethods = allEntries.filter(([, d]) => d.isInternalCredit || d.currency === 'INTERNAL_CREDIT');
                        const internalCreditUsed = internalCreditMethods.filter(([, d]) => !d.isWalletCredit);
                        const internalCreditGenerated = internalCreditMethods.filter(([, d]) => d.isWalletCredit);
                        const bsMethods    = allEntries.filter(([, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange && !d.isTip);
                        const usdMethods   = allEntries.filter(([method, d]) => d.currency === 'USD' && method !== 'cashea' && !d.isChange && !d.isTip && !d.isInternalCredit);
                        const copMethods   = allEntries.filter(([, d]) => d.currency === 'COP' && !d.isChange && !d.isTip);
                        const vueltoBs     = allEntries.filter(([, d]) => d.isChange && d.currency === 'BS');
                        const vueltoUsd    = allEntries.filter(([, d]) => d.isChange && d.currency === 'USD');
                        const fmtCop = (v) => v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                        const subtotalBs     = bsMethods.reduce((s, [, d]) => s + d.total, 0);
                        const subtotalUsd    = usdMethods.reduce((s, [, d]) => s + d.total, 0);
                        const subtotalCop    = copMethods.reduce((s, [, d]) => s + d.total, 0);
                        const totalVueltoBs  = vueltoBs.reduce((s, [, d]) => s + d.total, 0);
                        const totalVueltoUsd = vueltoUsd.reduce((s, [, d]) => s + d.total, 0);
                        const netoBs  = subtotalBs - totalVueltoBs;
                        const netoUsd = subtotalUsd - totalVueltoUsd;

                        const toBsEquiv = (data) => (Number.isFinite(data?.amountBs)
                            ? data.amountBs
                            : toBsEquivalent(data, { bcvRate, tasaCop }));

                        const grandTotalBsEquiv = breakdownView.denominatorBs;

                        const renderMethod = ([method, data]) => {
                            const label = toTitleCase(getPaymentLabel(method, data.label));
                            const PayIcon = getPaymentIcon(method) || PAYMENT_ICONS[method];
                            const bsEquiv = toBsEquiv(data);
                            const pct = grandTotalBsEquiv > 0 ? (bsEquiv / grandTotalBsEquiv * 100) : 0;

                            let displayAmount = `${formatBs(data.total)} Bs`;
                            if (data.currency === 'FIADO' || data.currency === 'INTERNAL_CREDIT') displayAmount = `USD ${data.total.toFixed(2)}`;
                            else if (data.currency === 'USD') displayAmount = `USD ${data.total.toFixed(2)}`;
                            else if (data.currency === 'COP') displayAmount = `${fmtCop(data.total)} COP`;

                            return (
                                <div key={method}>
                                    <div className="flex justify-between text-sm mb-1.5">
                                        <span className="text-slate-600 dark:text-slate-300 font-medium flex items-center gap-1.5">
                                            {PayIcon && <PayIcon size={14} className="text-slate-400" />}
                                            {label}
                                        </span>
                                        <div className="text-right flex items-center gap-2">
                                            <span className="font-bold text-slate-700 dark:text-white">{displayAmount}</span>
                                            {data.currency !== 'FIADO' && !data.isInternalCredit && <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium w-8 text-right">{pct.toFixed(0)}%</span>}
                                            {data.currency === 'FIADO' && (
                                                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{formatBs(bsEquiv)} Bs</div>
                                            )}
                                        </div>
                                    </div>
                                    {data.currency !== 'FIADO' && !data.isInternalCredit && (
                                        <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-brand via-cyan-400 to-teal-400 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                                        </div>
                                    )}
                                </div>
                            );
                        };

                        const renderVuelto = ([method, data]) => {
                            const bsEquiv = data.currency === 'USD' ? data.total * bcvRate : data.total;
                            const pct = grandTotalBsEquiv > 0 ? (bsEquiv / grandTotalBsEquiv * 100) : 0;
                            const isUsd = data.currency === 'USD';
                            const displayAmount = isUsd ? `USD ${data.total.toFixed(2)}` : `${formatBs(data.total)} Bs`;

                            return (
                                <div key={method}>
                                    <div className="flex justify-between text-sm mb-1.5">
                                        <span className="text-orange-500 dark:text-orange-400 font-medium">{data.label || 'Vuelto entregado'}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-orange-500 dark:text-orange-400">− {displayAmount}</span>
                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium w-8 text-right">{pct.toFixed(0)}%</span>
                                        </div>
                                    </div>
                                    <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-orange-400 to-amber-400 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                                    </div>
                                </div>
                            );
                        };

                        return (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm h-full">
                                <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">
                                    Medios de Pago
                                </h3>

                                {internalCreditMethods.length > 0 && (
                                    <div className="mb-5">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">Crédito interno</span>
                                            <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                                                {internalCreditUsed.length > 0 && `USD ${internalCreditUsed.reduce((s, [,d]) => s + d.total, 0).toFixed(2)} aplicado`}
                                                {internalCreditUsed.length > 0 && internalCreditGenerated.length > 0 && ' · '}
                                                {internalCreditGenerated.length > 0 && `USD ${internalCreditGenerated.reduce((s, [,d]) => s + d.total, 0).toFixed(2)} generado`}
                                            </span>
                                        </div>
                                        <div className="space-y-4">{internalCreditMethods.map(e => renderMethod(e))}</div>
                                    </div>
                                )}

                                {receivablesView.hasMovement && (() => {
                                    const netoRow = receivablesView.rows.find(r => r.key === 'neto');
                                    const netoUsd = netoRow ? netoRow.amountUsd : 0;
                                    return (
                                        <div className="mb-5" data-testid="reporte-cuentas-por-cobrar">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wider">Cuentas por cobrar</span>
                                                <span className={`text-xs font-black ${netoUsd < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                                    {netoUsd < 0 ? '−' : ''}USD {Math.abs(netoUsd).toFixed(2)} neto
                                                </span>
                                            </div>
                                            <div className="space-y-2">
                                                {receivablesView.rows.map(row => (
                                                    <div key={row.key} className="flex items-center justify-between text-sm gap-2">
                                                        <span className={`font-medium truncate ${row.isStock ? 'text-slate-500 dark:text-slate-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                                            {row.label}
                                                            {row.count > 0 && <span className="text-[10px] text-slate-400"> ({row.count})</span>}
                                                            <span className="block text-[9px] text-slate-400 font-normal">{row.hint}</span>
                                                        </span>
                                                        <span className={`font-bold shrink-0 ${row.amountUsd < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-white'}`}>
                                                            {row.amountUsd < 0 ? '−' : ''}USD {Math.abs(row.amountUsd).toFixed(2)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                            {receivablesView.cobranzas.length > 0 && (
                                                <div className="mt-3 pt-3 border-t border-dashed border-amber-200 dark:border-amber-800/40">
                                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Detalle de cobranzas</p>
                                                    <div className="space-y-1.5">
                                                        {receivablesView.cobranzas.slice(0, 5).map(cobranza => (
                                                            <div key={cobranza.saleId || `${cobranza.cliente}-${cobranza.timestamp}`} className="flex items-center justify-between text-xs gap-2">
                                                                <span className="text-slate-500 dark:text-slate-400 truncate">
                                                                    {cobranza.cliente}
                                                                    {cobranza.saleNumber ? ` · #${cobranza.saleNumber}` : ''}
                                                                    {cobranza.methodId ? ` · ${toTitleCase(getPaymentLabel(cobranza.methodId))}` : ''}
                                                                </span>
                                                                <span className="text-slate-600 dark:text-slate-300 font-medium shrink-0">
                                                                    {formatBs(cobranza.montoBs)} Bs
                                                                    {cobranza.saldoFavorGeneradoUsd > 0 && (
                                                                        <span className="text-emerald-500 dark:text-emerald-400"> +USD {cobranza.saldoFavorGeneradoUsd.toFixed(2)} a favor</span>
                                                                    )}
                                                                </span>
                                                            </div>
                                                        ))}
                                                        {receivablesView.cobranzas.length > 5 && (
                                                            <p className="text-[10px] text-slate-400">y {receivablesView.cobranzas.length - 5} más…</p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {(bsMethods.length > 0 || vueltoBs.length > 0) && (
                                    <div className="mb-5">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-[11px] font-bold text-brand uppercase tracking-wider">Bolívares</span>
                                            <span className={`text-xs font-black ${totalVueltoBs > 0 ? 'text-cyan-500 dark:text-cyan-400' : 'text-brand-dark dark:text-brand'}`}>
                                                {totalVueltoBs > 0
                                                    ? `${netoBs < 0 ? '−' : ''}${formatBs(Math.abs(netoBs))} Bs neto`
                                                    : `${formatBs(subtotalBs)} Bs`}
                                            </span>
                                        </div>
                                        <div className="space-y-4">
                                            {bsMethods.map(e => renderMethod(e))}
                                            {vueltoBs.map(e => renderVuelto(e))}
                                        </div>
                                    </div>
                                )}

                                {(usdMethods.length > 0 || vueltoUsd.length > 0) && (
                                    <div className={copMethods.length > 0 ? 'mb-5' : ''}>
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">Dólares</span>
                                            <span className={`text-xs font-black ${totalVueltoUsd > 0 ? 'text-emerald-500 dark:text-emerald-400' : copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                {totalVueltoUsd > 0
                                                    ? (copEnabled && copPrimary && tasaCop > 0
                                                        ? `${netoUsd < 0 ? '−' : ''}${formatCop(Math.abs(netoUsd) * tasaCop)} COP neto`
                                                        : `${netoUsd < 0 ? '−' : ''}USD ${Math.abs(netoUsd).toFixed(2)} neto`)
                                                    : (copEnabled && copPrimary && tasaCop > 0
                                                        ? `${formatCop(subtotalUsd * tasaCop)} COP`
                                                        : `USD ${subtotalUsd.toFixed(2)}`)}
                                            </span>
                                        </div>
                                        <div className="space-y-4">
                                            {usdMethods.map(e => renderMethod(e))}
                                            {vueltoUsd.map(e => renderVuelto(e))}
                                        </div>
                                    </div>
                                )}

                                {copEnabled && copMethods.length > 0 && (
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wider">Pesos Colombianos</span>
                                            <span className="text-xs font-black text-amber-600 dark:text-amber-400">{fmtCop(subtotalCop)} COP</span>
                                        </div>
                                        <div className="space-y-4">{copMethods.map(e => renderMethod(e))}</div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Top Productos */}
                    {topProducts.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm h-full flex flex-col justify-between">
                            <div>
                                <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                                    <TrendingUp size={14} />
                                    Top Productos
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
                                    {topProducts.map((p, i) => (
                                        <div key={`${p.name}-${i}`} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/45 rounded-xl p-2.5 border border-slate-100/50 dark:border-slate-800/50">
                                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
                                                i < 3 ? 'bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                            }`}>{i + 1}</span>
                                            <div className="flex-1 min-w-0 text-left">
                                                <p className="text-xs font-bold text-slate-750 dark:text-slate-200 truncate">{p.name}</p>
                                                <p className="text-[9px] text-slate-400 font-medium">{p.qty} vendidos</p>
                                            </div>
                                            <span className="text-xs font-black text-brand-dark dark:text-brand shrink-0">
                                                {copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(p.revenue * tasaCop)} COP` : `$${p.revenue.toFixed(2)}`}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Transaction List */}
            {!hideHistory && historySales.length > 0 && (() => {
                const searchedSales = historySales.filter(s => {
                    const matchesFilter = historyFilter === 'all'
                        || (historyFilter === 'completed' && s.status !== 'ANULADA')
                        || (historyFilter === 'voided' && s.status === 'ANULADA');
                    if (!matchesFilter) return false;
                    if (!historySearch.trim()) return true;
                    const q = historySearch.toLowerCase();
                    if ((s.customerName || 'consumidor final').toLowerCase().includes(q)) return true;
                    if (s.items && s.items.some(i => i.name.toLowerCase().includes(q))) return true;
                    if (s.id.toLowerCase().includes(q)) return true;
                    return false;
                });
                const completedInList = searchedSales.filter(s => s.status !== 'ANULADA');
                const voidedInList = searchedSales.filter(s => s.status === 'ANULADA');
                const sumUsd = completedInList.reduce((a, s) => a + (s.totalUsd || 0), 0);

                return (
                    <div className="mt-6">
                        {/* Encabezado de sección prominente */}
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-brand-light dark:bg-surface-800/30 rounded-lg flex items-center justify-center">
                                    <Clock size={16} className="text-brand-dark dark:text-brand" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-black text-slate-800 dark:text-white">Historial de Ventas</h2>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">{historySales.length} {historySales.length === 1 ? 'transacción' : 'transacciones'} en este periodo</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {/* Search + Filter Bar */}
                            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                                <div className="relative">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={historySearch}
                                        onChange={e => { setHistorySearch(e.target.value); setVisibleCount(30); }}
                                        placeholder="Buscar por cliente, producto u orden..."
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 pl-9 pr-8 text-xs font-medium text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                                    />
                                    {historySearch && (
                                        <button onClick={() => setHistorySearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {[{ id: 'all', label: 'Todas' }, { id: 'completed', label: 'Completadas' }, { id: 'voided', label: 'Anuladas' }].map(f => (
                                        <button
                                            key={f.id}
                                            onClick={() => { setHistoryFilter(f.id); setVisibleCount(30); }}
                                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${historyFilter === f.id
                                                ? 'bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand shadow-sm'
                                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-700'}`}
                                        >{f.label}</button>
                                    ))}
                                    <div className="flex-1" />
                                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400">{searchedSales.length} resultado{searchedSales.length !== 1 ? 's' : ''}</span>
                                </div>
                            </div>

                            {/* Mini Summary Strip */}
                            {searchedSales.length > 0 && (
                                <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2 text-[10px] font-bold text-slate-600">
                                    <span className="flex items-center gap-1"><DollarSign size={12} className="text-emerald-500" /> {copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(sumUsd * tasaCop)} COP` : `$${sumUsd.toFixed(2)}`}</span>
                                    <span className="w-px h-3 bg-slate-300 dark:bg-slate-700" />
                                    <span>{completedInList.length} venta{completedInList.length !== 1 ? 's' : ''}</span>
                                    {voidedInList.length > 0 && (
                                        <><span className="w-px h-3 bg-slate-300 dark:bg-slate-700" /><span className="text-red-500">{voidedInList.length} anulada{voidedInList.length !== 1 ? 's' : ''}</span></>
                                    )}
                                </div>
                            )}

                            {/* Transaction Rows */}
                            {searchedSales.slice(0, visibleCount).map(s => (
                                <TransactionRow
                                    key={s.id}
                                    sale={s}
                                    bcvRate={bcvRate}
                                    isExpanded={expandedSaleId === s.id}
                                    onToggle={() => setExpandedSaleId(prev => prev === s.id ? null : s.id)}
                                    onVoidSale={setVoidSaleTarget}
                                    onRecycleSale={setRecycleOffer}
                                    copEnabled={copEnabled}
                                    copPrimary={copPrimary}
                                    tasaCop={tasaCop}
                                    onPrintTicket={onPrintTicket}
                                />
                            ))}

                            {searchedSales.length === 0 && (
                                <div className="text-center py-6">
                                    <Search size={24} className="text-slate-300 mx-auto mb-2" />
                                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Sin resultados para esta busqueda</p>
                                </div>
                            )}

                            {visibleCount < searchedSales.length && (
                                <button
                                    onClick={() => setVisibleCount(c => c + 30)}
                                    className="w-full py-3 text-xs font-bold text-brand bg-brand-light dark:bg-surface-800/20 rounded-xl hover:bg-brand-light dark:hover:bg-surface-800/30 transition-colors active:scale-[0.98]"
                                >
                                    Mostrar mas ({searchedSales.length - visibleCount} restantes)
                                </button>
                            )}
                        </div>
                    </div>
                );
            })()}

            {/* Empty state */}
            {salesForStats.length === 0 && salesForCashFlow.length === 0 && (
                <div className="mt-8">
                    <EmptyState
                        icon={BarChart3}
                        title="Sin ventas en este periodo"
                        description="Selecciona otro rango de fechas o usa el boton Personalizado para buscar mas atras."
                    />
                </div>
            )}
        </>
    );
}
