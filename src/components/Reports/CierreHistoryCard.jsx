import React, { useState } from 'react';
import { ChevronDown, ChevronUp, LockIcon, Printer, DollarSign, Clock, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { getPaymentLabel, getPaymentIcon, toTitleCase, PAYMENT_ICONS } from '../../config/paymentMethods';
import { generateDailyClosePDF } from '../../utils/dailyCloseGenerator';
import { printerSerial } from '../../services/PrinterSerial';
import { showToast } from '../Toast';

export default function CierreHistoryCard({ cierre, correlativo, bcvRate, products, copEnabled, copPrimary, tasaCop }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);

    const handleThermalPrint = async (e) => {
        e.stopPropagation();
        if (!printerSerial.isSupported()) {
            showToast('Tu navegador no soporta impresoras seriales. Usa Chrome o Edge.', 'error');
            return;
        }
        try {
            if (!printerSerial.isConnected()) {
                const connected = await printerSerial.connect();
                if (!connected) return;
            }
            setIsPrinting(true);
            await printerSerial.printDailyClose(cierre, bcvRate, correlativo);
            showToast('Cierre impreso correctamente', 'success');
        } catch (err) {
            showToast('Error al imprimir: ' + (err.message || 'desconocido'), 'error');
        } finally {
            setIsPrinting(false);
        }
    };

    const dateLabel = new Date(cierre.cierreId).toLocaleString('es-VE', { 
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit' 
    });

    const handleAction = (e, actionType) => {
        e.stopPropagation();
        
        const todayProductMap = {};
        cierre.salesForStats.forEach(s => {
            if (s.items) {
                s.items.forEach(item => {
                    if (!todayProductMap[item.name]) todayProductMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                    todayProductMap[item.name].qty += item.qty;
                    todayProductMap[item.name].revenue += item.priceUsd * item.qty;
                });
            }
        });
        const todayTopProducts = Object.values(todayProductMap).sort((a, b) => b.qty - a.qty).slice(0, 10);

        generateDailyClosePDF({
            sales: cierre.salesForCashFlow.filter(s => s.tipo !== 'APERTURA_CAJA'),
            allSales: cierre.salesForStats,
            bcvRate,
            paymentBreakdown: cierre.paymentBreakdown,
            topProducts: todayTopProducts,
            todayTotalUsd: cierre.totalUsd,
            todayTotalBs: cierre.totalBs,
            todayProfit: 0,
            todayItemsSold: cierre.totalItems,
            reconData: null,
            apertura: cierre.apertura,
            isReprint: true,
            copEnabled,
            tasaCop,
            action: actionType
        });
    };

    const hasApertura = !!cierre.apertura;
    const fondoInicial = hasApertura ? (cierre.apertura.openingUsd || 0) : 0;
    const fondoInicialBs = hasApertura ? (cierre.apertura.openingBs || 0) : 0;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden mb-3 transition-all active:scale-[0.99] cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
            <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <LockIcon size={20} className="text-slate-500" />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            Cierre de Caja
                            {(cierre.cierreNumber != null || correlativo != null) && (
                                <span className="text-[9px] bg-brand-light dark:bg-brand/20 text-brand-dark dark:text-brand px-1.5 py-0.5 rounded font-black">
                                    #{cierre.cierreNumber || correlativo}
                                </span>
                            )}
                            <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded uppercase font-black">{cierre.salesCount} ops</span>
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">{dateLabel}</p>
                    </div>
                </div>
                <div className="text-right flex items-center gap-3">
                    <div>
                        {copEnabled && copPrimary && tasaCop > 0 ? (
                            <>
                                <p className="text-sm font-black text-amber-600 dark:text-amber-400">{formatCop(cierre.totalCop || Math.round(cierre.totalUsd * tasaCop))} COP</p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">${cierre.totalUsd.toFixed(2)}</p>
                            </>
                        ) : (
                            <>
                                <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">${cierre.totalUsd.toFixed(2)}</p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{copEnabled && tasaCop > 0 ? `${formatCop(cierre.totalCop || Math.round(cierre.totalUsd * tasaCop))} COP` : `${formatBs(cierre.totalBs)} Bs`}</p>
                            </>
                        )}
                    </div>
                    {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </div>
            </div>
 
            {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800/50 cursor-auto animate-in fade-in slide-in-from-top-1" onClick={e => e.stopPropagation()}>
                    
                    {hasApertura && (
                        <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50">
                            <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5"><DollarSign size={14}/> Fondo de Apertura</span>
                            {copEnabled && copPrimary && tasaCop > 0 ? (
                                <span className="text-sm font-black text-slate-700 dark:text-slate-300">{formatCop(cierre.apertura?.openingCop || Math.round(fondoInicial * tasaCop))} COP <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-1">(${fondoInicial.toFixed(2)})</span></span>
                            ) : (
                                <span className="text-sm font-black text-slate-700 dark:text-slate-300">${fondoInicial.toFixed(2)} <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-1">({formatBs(fondoInicialBs)} Bs)</span></span>
                            )}
                        </div>
                    )}
 
                    <div className="py-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Desglose de Ingresos</p>
                        {Object.keys(cierre.paymentBreakdown).length === 0 && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Sin movimientos</p>
                        )}
                        {Object.entries(cierre.paymentBreakdown).map(([method, data]) => {
                            const PayIcon = getPaymentIcon(method) || PAYMENT_ICONS[method] || CheckCircle2;
                            const label = toTitleCase(getPaymentLabel(method, data.label));
                            let displayAmount = `${formatBs(data.total)} Bs`;
                            if (data.currency === 'FIADO' || data.currency === 'USD') {
                                displayAmount = `$ ${data.total.toFixed(2)}`;
                            } else if (data.currency === 'COP') {
                                displayAmount = `${data.total.toLocaleString('es-CO')} COP`;
                            }
                            return (
                                <div key={method} className="flex justify-between items-center text-xs">
                                     <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                         <PayIcon size={12} className="text-slate-400" /> {label}
                                     </span>
                                     <span className="font-bold text-slate-700 dark:text-slate-200">{displayAmount}</span>
                                 </div>
                            );
                        })}
                    </div>

                    <div className="pt-3 mt-1 flex gap-2">
                        <button
                            onClick={(e) => handleAction(e, 'print')}
                            className="flex-1 py-2.5 bg-brand-light dark:bg-surface-800/20 text-brand-dark dark:text-brand hover:bg-brand-light font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-95"
                        >
                            <Printer size={16} /> Imprimir
                        </button>
                        <button
                            onClick={(e) => handleAction(e, 'download')}
                            className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-95"
                        >
                            <Printer size={14} /> Descargar PDF
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
