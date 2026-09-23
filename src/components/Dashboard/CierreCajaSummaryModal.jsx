import React from 'react';
import { X, CheckCircle2, Printer, Download, Share2, AlertTriangle, Coins } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';

export default function CierreCajaSummaryModal({
    isOpen,
    onClose,
    summaryData,
    onPrint,
    onDownload,
    onShare,
}) {
    if (!isOpen || !summaryData) return null;

    const {
        sales = [],
        todayTotalUsd = 0,
        todayTotalBs = 0,
        todayItemsSold = 0,
        reconData = {},
        copEnabled = false,
        tasaCop = 0,
    } = summaryData;

    // Diferencias
    const expectedUsd = reconData.expectedUsd || 0;
    const expectedBs = reconData.expectedBs || 0;
    const expectedCop = reconData.expectedCop || 0;

    const declaredUsd = reconData.cashUsd || 0;
    const declaredBs = reconData.cashBs || 0;
    const declaredCop = reconData.cashCop || 0;

    const diffUsd = declaredUsd - expectedUsd;
    const diffBs = declaredBs - expectedBs;
    const diffCop = declaredCop - expectedCop;

    const hasCop = copEnabled && (expectedCop > 0 || declaredCop > 0);
    const fmtCop = (v) => formatCop(v);

    const advances = summaryData?.advances || { count: 0, totalEfectivoBs: 0, totalEfectivoUsd: 0, totalComisionBs: 0, totalComisionUsd: 0 };

    // Determinar color de semáforo
    const isCuadrado = Math.abs(diffUsd) <= 0.50 && Math.abs(diffBs) <= expectedBs * 0.02 && (!hasCop || Math.abs(diffCop) <= expectedCop * 0.02);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 relative overflow-hidden">
                
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                            <CheckCircle2 size={18} />
                        </div>
                        <h3 className="text-base font-black text-slate-800 dark:text-white">Cierre Completado</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Resumen Principal */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vendido USD</span>
                        <strong className="text-lg font-black text-slate-800 dark:text-white mt-0.5 block">${todayTotalUsd.toFixed(2)}</strong>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-2xl p-3 text-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Vendido Bs</span>
                        <strong className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5 block">{formatBs(todayTotalBs)} Bs</strong>
                    </div>
                </div>

                {/* Detalles de Operaciones */}
                <div className="flex justify-between items-center text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800/30 rounded-xl">
                    <span className="font-semibold text-slate-500">Operaciones cerradas:</span>
                    <strong className="font-bold text-slate-700 dark:text-slate-200">{sales.length} transacciones ({todayItemsSold} art.)</strong>
                </div>

                {/* Cuadre de Arqueo Físico */}
                <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Cuadre de Efectivo</span>
                    
                    <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden text-xs">
                        <div className="grid grid-cols-3 gap-0 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-[10px] font-black text-slate-400 uppercase border-b border-slate-100 dark:border-slate-850">
                            <span>Moneda</span>
                            <span className="text-center">Esperado</span>
                            <span className="text-center">Declarado</span>
                        </div>

                        {/* USD Row */}
                        <div className="grid grid-cols-3 gap-0 px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/50">
                            <span className="font-bold text-slate-700 dark:text-slate-200">USD ($)</span>
                            <span className="font-mono text-slate-500 text-center">${expectedUsd.toFixed(2)}</span>
                            <span className="font-mono font-black text-center text-slate-800 dark:text-white">${declaredUsd.toFixed(2)}</span>
                        </div>

                        {/* Bs Row */}
                        <div className="grid grid-cols-3 gap-0 px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/50">
                            <span className="font-bold text-slate-700 dark:text-slate-200">Bs (Bs)</span>
                            <span className="font-mono text-slate-500 text-center">{formatBs(expectedBs)}</span>
                            <span className="font-mono font-black text-center text-slate-800 dark:text-white">{formatBs(declaredBs)}</span>
                        </div>

                        {/* COP Row */}
                        {hasCop && (
                            <div className="grid grid-cols-3 gap-0 px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/50">
                                <span className="font-bold text-amber-600 dark:text-amber-400">COP (Col)</span>
                                <span className="font-mono text-slate-500 text-center">{fmtCop(expectedCop)}</span>
                                <span className="font-mono font-black text-center text-slate-800 dark:text-white">{fmtCop(declaredCop)}</span>
                            </div>
                        )}

                        {/* Diferencia Summary */}
                        <div className="grid grid-cols-3 gap-0 px-3 py-2 bg-slate-100/50 dark:bg-slate-800/30 text-[10px] font-black uppercase text-slate-400 border-t border-slate-100 dark:border-slate-800">
                            <span>Diferencia</span>
                            <span className={`text-center font-mono font-black ${diffUsd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                {diffUsd >= 0 ? '+' : ''}${diffUsd.toFixed(2)}
                            </span>
                            <span className={`text-center font-mono font-black ${diffBs >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                {diffBs >= 0 ? '+' : ''}{formatBs(diffBs)}
                            </span>
                        </div>
                    </div>

                    {/* Semáforo Alert */}
                    <div className={`p-3 rounded-2xl flex items-start gap-2.5 border text-[11px] leading-snug font-medium ${
                        isCuadrado 
                            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-400' 
                            : 'bg-red-50 dark:bg-red-950/20 border-red-200/50 dark:border-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                        <div className="shrink-0 mt-0.5">
                            {isCuadrado ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                        </div>
                        <div>
                            {isCuadrado 
                                ? 'Arqueo de caja cerrado en orden. Las discrepancias de efectivo se encuentran dentro del rango de tolerancia.' 
                                : '¡Alerta de cuadre! Las declaraciones físicas ingresadas no coinciden con los saldos esperados por el sistema.'
                            }
                        </div>
                    </div>

                    {/* Avances de Efectivo Summary */}
                    {advances && advances.count > 0 && (
                        <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/10 p-3 rounded-2xl text-[11px] space-y-1">
                            <div className="flex justify-between items-center text-slate-500 dark:text-slate-400 font-bold uppercase text-[9px] tracking-wider mb-1">
                                <span>Avances de Efectivo</span>
                                <span className="text-amber-600">{advances.count} servicios</span>
                            </div>
                            {advances.totalEfectivoBs > 0 && (
                                <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                                    <span>Efectivo Bs dispensado:</span>
                                    <strong className="text-slate-700 dark:text-slate-350">{formatBs(advances.totalEfectivoBs)} Bs</strong>
                                </div>
                            )}
                            {advances.totalEfectivoUsd > 0 && (
                                <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                                    <span>Efectivo USD dispensado:</span>
                                    <strong className="text-slate-700 dark:text-slate-350">${advances.totalEfectivoUsd.toFixed(2)}</strong>
                                </div>
                            )}
                            <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 pt-1 border-t border-slate-200/50 dark:border-slate-800/50">
                                <span className="font-bold">Comisiones Ganadas:</span>
                                <strong className="font-black">
                                    {advances.totalComisionBs > 0 && `${formatBs(advances.totalComisionBs)} Bs`}
                                    {advances.totalComisionBs > 0 && advances.totalComisionUsd > 0 && ' + '}
                                    {advances.totalComisionUsd > 0 && `$${advances.totalComisionUsd.toFixed(2)}`}
                                </strong>
                            </div>
                        </div>
                    )}
                </div>

                {/* Acciones principales */}
                <div className="space-y-2 pt-2">
                    <button
                        onClick={onPrint}
                        className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs shadow-md shadow-emerald-500/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                        <Printer size={15} /> Imprimir Ticket de Cierre
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={onDownload}
                            className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
                        >
                            <Download size={14} /> Descargar PDF
                        </button>
                        <button
                            onClick={onShare}
                            className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
                        >
                            <Share2 size={14} /> Compartir Reporte
                        </button>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-full py-2.5 text-center text-xs font-black text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors pt-2"
                    >
                        Entendido, Volver al Dashboard
                    </button>
                </div>
            </div>
        </div>
    );
}
