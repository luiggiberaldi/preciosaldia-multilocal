import { useState } from 'react';
import { X, Clock, User, FileText, Trash2, ArrowRightCircle, Eye, EyeOff } from 'lucide-react';

export default function HoldsModal({ tickets = [], onRecuperar, onEliminar, onClose, effectiveRate = 0 }) {
    const [expandedId, setExpandedId] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const toggleExpand = (id) => {
        setExpandedId(expandedId === id ? null : id);
    };

    const handleDeleteClick = (id) => {
        setConfirmDeleteId(id);
    };

    const handleConfirmDelete = (id) => {
        onEliminar(id);
        setConfirmDeleteId(null);
    };

    const handleCancelDelete = () => {
        setConfirmDeleteId(null);
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-slate-100 dark:border-slate-800">
                
                {/* Header */}
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                    <h2 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <Clock className="text-amber-500" size={20} /> Ventas en Espera
                    </h2>
                    <button 
                        onClick={onClose} 
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-white dark:bg-slate-900">
                    {tickets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 dark:text-slate-600">
                            <Clock size={40} className="mb-2 opacity-60" />
                            <p className="font-bold text-sm">No hay ventas en espera actualmente</p>
                        </div>
                    ) : (
                        tickets.map((t) => {
                            const isExpanded = expandedId === t.id;
                            const isConfirmingDelete = confirmDeleteId === t.id;
                            
                            // Calculate totals
                            const totalUsd = t.items.reduce((sum, item) => sum + (item.qty * item.priceUsd), 0);
                            const rateUsed = t.tasaSnapshot || effectiveRate || 0;
                            const totalBs = totalUsd * rateUsed;

                            // Formatter
                            const formatBsVal = (val) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);

                            return (
                                <div 
                                    key={t.id} 
                                    className="bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-800/80 overflow-hidden transition-all shadow-sm"
                                >
                                    {isConfirmingDelete ? (
                                        /* Delete Confirmation Screen (PISU UX Standard: custom confirmations) */
                                        <div className="p-4 bg-red-50/50 dark:bg-red-950/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
                                            <div>
                                                <p className="text-xs font-black text-red-600 dark:text-red-400 uppercase tracking-wider">¿Descartar esta venta?</p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Se eliminarán permanentemente estos productos en espera.</p>
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <button
                                                    onClick={handleCancelDelete}
                                                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-lg transition-all"
                                                >
                                                    Cancelar
                                                </button>
                                                <button
                                                    onClick={() => handleConfirmDelete(t.id)}
                                                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
                                                >
                                                    Sí, eliminar
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Regular Ticket Header */
                                        <div className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                                    <span className="text-[9px] font-bold bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-md border border-amber-200/50 dark:border-amber-900/30 flex items-center gap-1">
                                                        <Clock size={9} /> 
                                                        {new Date(t.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                    </span>
                                                    {t.cliente && (
                                                        <span className="text-[9px] font-bold bg-brand-light dark:bg-brand/10 text-brand-dark dark:text-brand px-1.5 py-0.5 rounded-md border border-brand/20 flex items-center gap-1">
                                                            <User size={9} /> {t.cliente.nombre}
                                                        </span>
                                                    )}
                                                </div>

                                                {t.nota && (
                                                    <div className="flex items-start gap-1 mb-2">
                                                        <FileText size={12} className="text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                                                        <p className="text-xs text-slate-600 dark:text-slate-300 font-medium italic">"{t.nota}"</p>
                                                    </div>
                                                )}

                                                <div className="flex items-baseline gap-1.5 mt-1">
                                                    <span className="font-extrabold text-base text-slate-800 dark:text-white">${totalUsd.toFixed(2)}</span>
                                                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">/</span>
                                                    <span className="font-bold text-xs text-brand">Bs {formatBsVal(totalBs)}</span>
                                                    <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold ml-1">(Tasa: {rateUsed.toFixed(2)})</span>
                                                </div>
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                                                <button
                                                    onClick={() => toggleExpand(t.id)}
                                                    className={`p-2 rounded-xl border text-xs font-bold flex items-center gap-1 transition-all ${
                                                        isExpanded 
                                                            ? 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300' 
                                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/80 text-slate-500 dark:text-slate-400 hover:border-brand/30 hover:text-brand-dark dark:hover:text-brand'
                                                    }`}
                                                >
                                                    {isExpanded ? <EyeOff size={14} /> : <Eye size={14} />}
                                                    <span>{isExpanded ? 'Ocultar' : 'Ver'}</span>
                                                </button>

                                                <button
                                                    onClick={() => handleDeleteClick(t.id)}
                                                    className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl transition-all border border-transparent hover:border-red-100 dark:hover:border-red-900/30"
                                                    title="Descartar"
                                                >
                                                    <Trash2 size={15} />
                                                </button>

                                                <button
                                                    onClick={() => onRecuperar(t.id)}
                                                    className="px-3.5 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl font-black text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                                                >
                                                    CARGAR <ArrowRightCircle size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Expanded Detail Panel */}
                                    {isExpanded && !isConfirmingDelete && (
                                        <div className="bg-white dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-800/80 p-4 animate-in slide-in-from-top-1 duration-150">
                                            <div className="overflow-x-auto -mx-2 px-2">
                                                <table className="w-full min-w-[360px] text-left text-xs">
                                                    <thead>
                                                        <tr className="text-slate-400 dark:text-slate-500 font-bold border-b border-slate-100 dark:border-slate-800 pb-2">
                                                            <th className="pb-2 font-black">CANT</th>
                                                            <th className="pb-2 font-black">PRODUCTO</th>
                                                            <th className="pb-2 text-right font-black">P. UNIT ($)</th>
                                                            <th className="pb-2 text-right font-black">TOTAL ($)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                                                        {t.items.map((item, idx) => (
                                                            <tr key={idx} className="text-slate-700 dark:text-slate-300">
                                                                <td className="py-2.5 font-bold font-mono text-slate-800 dark:text-white">
                                                                    {item.qty} {item.isWeight ? 'kg/lt' : 'ud'}
                                                                </td>
                                                                <td className="py-2.5 font-semibold text-slate-800 dark:text-white pr-2">
                                                                    {item.name}
                                                                </td>
                                                                <td className="py-2.5 text-right font-medium">
                                                                    ${item.priceUsd.toFixed(2)}
                                                                </td>
                                                                <td className="py-2.5 text-right font-extrabold text-slate-800 dark:text-white">
                                                                    ${(item.qty * item.priceUsd).toFixed(2)}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
