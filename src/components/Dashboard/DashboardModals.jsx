import React from 'react';
import { UserPlus, Phone, Send, Trash2, Recycle } from 'lucide-react';

export function TicketClientModal({
    ticketPendingSale,
    ticketClientName,
    ticketClientPhone,
    ticketClientDocument,
    setTicketClientName,
    setTicketClientPhone,
    setTicketClientDocument,
    onClose,
    onRegister,
}) {
    if (!ticketPendingSale) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-5">
                    <div className="flex justify-center mb-4">
                        <div className="w-14 h-14 bg-brand-light/30 dark:bg-brand-dark/30 text-brand rounded-full flex items-center justify-center">
                            <UserPlus size={28} />
                        </div>
                    </div>
                    <h3 className="text-lg font-black text-center text-slate-900 dark:text-white mb-1">
                        Registrar Cliente
                    </h3>
                    <p className="text-xs text-center text-slate-400 mb-5">
                        Para enviar el ticket, registra los datos del cliente.
                    </p>

                    <div className="space-y-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Nombre del Cliente *</label>
                            <input
                                type="text"
                                value={ticketClientName}
                                onChange={(e) => setTicketClientName(e.target.value)}
                                placeholder="Ej: María García"
                                autoFocus
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1">
                                Cédula / RIF (Opcional)
                            </label>
                            <input
                                type="text"
                                value={ticketClientDocument}
                                onChange={(e) => setTicketClientDocument(e.target.value.toUpperCase())}
                                placeholder="Ej: V-12345678"
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all uppercase"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1">
                                <Phone size={10} /> Teléfono / WhatsApp
                            </label>
                            <input
                                type="tel"
                                value={ticketClientPhone}
                                onChange={(e) => setTicketClientPhone(e.target.value)}
                                placeholder="Ej: 0414-1234567"
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                            />
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onRegister}
                        disabled={!ticketClientName.trim()}
                        className="flex-1 py-3 bg-brand disabled:bg-slate-300 dark:disabled:bg-slate-700 hover:bg-brand-dark text-white font-bold rounded-xl active:scale-[0.98] transition-all flex justify-center items-center gap-2 shadow-md shadow-brand/20"
                    >
                        <Send size={16} /> Registrar y Enviar
                    </button>
                </div>
            </div>
        </div>
    );
}

export function DeleteHistoryModal({
    isOpen,
    deleteConfirmText,
    setDeleteConfirmText,
    onClose,
    onConfirm,
}) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 text-red-500 rounded-full flex items-center justify-center mb-4">
                        <Trash2 size={32} />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2">¿Estás absolutamente seguro?</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 px-2">
                        Esta acción borrará permanentemente <strong className="text-red-500">TODO el historial de ventas</strong>. (No afectará tu inventario de productos).
                    </p>
                    <div className="w-full bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 mb-6">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Escribe "BORRAR" para confirmar:</p>
                        <input
                            type="text"
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder="BORRAR"
                            className="w-full form-input bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-center font-black text-red-500 uppercase tracking-widest focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all"
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={deleteConfirmText.trim().toUpperCase() !== 'BORRAR'}
                        className="flex-1 py-3.5 bg-red-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold rounded-xl active:scale-[0.98] transition-all flex justify-center items-center gap-2"
                    >
                        <Trash2 size={18} /> Borrar Historial
                    </button>
                </div>
            </div>
        </div>
    );
}

export function RecycleOfferModal({
    recycleOffer,
    onClose,
    onRecycle,
}) {
    if (!recycleOffer) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-5 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="w-14 h-14 bg-brand-light dark:bg-surface-800/30 text-brand rounded-full flex items-center justify-center">
                            <Recycle size={28} />
                        </div>
                    </div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white mb-1">
                        Venta Anulada
                    </h3>
                    <p className="text-xs text-slate-400 mb-2">
                        ¿Quieres reciclar los productos de esta venta y enviarlos a la caja?
                    </p>
                    <div className="text-left bg-slate-50 dark:bg-slate-800 rounded-xl p-3 mt-3 space-y-1">
                        {recycleOffer.items?.slice(0, 5).map((item, i) => (
                            <div key={i} className="flex justify-between text-xs">
                                <span className="text-slate-600 dark:text-slate-300 font-medium">{item.qty}{item.isWeight ? 'kg' : 'u'} {item.name.length > 20 ? item.name.substring(0, 20) + '…' : item.name}</span>
                                <span className="text-slate-400 font-bold">${(item.priceUsd * item.qty).toFixed(2)}</span>
                            </div>
                        ))}
                        {recycleOffer.items?.length > 5 && (
                            <p className="text-[10px] text-slate-400 text-center">+{recycleOffer.items.length - 5} más...</p>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all"
                    >
                        No, gracias
                    </button>
                    <button
                        onClick={onRecycle}
                        className="flex-1 py-3 bg-brand hover:bg-brand-dark text-white font-bold rounded-xl active:scale-[0.98] transition-all flex justify-center items-center gap-2 shadow-md shadow-primary/20"
                    >
                        <Recycle size={16} /> Reciclar
                    </button>
                </div>
            </div>
        </div>
    );
}
