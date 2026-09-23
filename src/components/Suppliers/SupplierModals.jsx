import React, { useState } from 'react';
import { X, Truck, Save, Pencil, FileText, CreditCard, Clock, Phone, Trash2, ArrowUpRight, CheckCircle2, Download } from 'lucide-react';
import { formatUsd, formatBs, formatCop } from '../../utils/calculatorUtils';
import CustomSelect from '../CustomSelect';

export function AddSupplierModal({ onClose, onSave, editingSupplier = null }) {
    const [name, setName] = useState(editingSupplier?.name || '');
    const [documentId, setDocumentId] = useState(editingSupplier?.documentId || '');
    const [phone, setPhone] = useState(editingSupplier?.phone || '');
    const [contactName, setContactName] = useState(editingSupplier?.contactName || '');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        
        const supplierData = {
            id: editingSupplier?.id || crypto.randomUUID(),
            name: name.trim(),
            documentId: documentId.trim(),
            phone: phone.trim(),
            contactName: contactName.trim(),
            deuda: editingSupplier ? editingSupplier.deuda : 0,
            createdAt: editingSupplier?.createdAt || new Date().toISOString()
        };
        onSave(supplierData);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                    <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        {editingSupplier ? <Pencil size={20} className="text-brand" /> : <Truck size={20} className="text-brand" />}
                        {editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                    </h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre de Empresa/Proveedor *</label>
                        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all" placeholder="Ej: Distribuidora Polar" autoFocus />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">RIF / Documento</label>
                        <input type="text" value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all" placeholder="Ej: J-123456789" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Teléfono</label>
                        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all" placeholder="Ej: 0414-1234567" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Persona de Contacto (Opcional)</label>
                        <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all" placeholder="Ej: Juan Pérez" />
                    </div>
                    <button type="submit" disabled={!name.trim()} className="w-full py-3.5 bg-brand-dark hover:bg-brand-dark disabled:bg-brand-dark/50 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 mt-4">
                        <Save size={18} /> {editingSupplier ? 'Guardar Cambios' : 'Guardar Proveedor'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export function AddInvoiceModal({ supplier, bcvRate, tasaCop, copEnabled, onClose, onSave }) {
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [amountUsd, setAmountUsd] = useState('');
    const [dueDate, setDueDate] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!invoiceNumber || !amountUsd || parseFloat(amountUsd) <= 0) return;
        
        const invoiceData = {
            id: crypto.randomUUID(),
            supplierId: supplier.id,
            invoiceNumber: invoiceNumber.trim(),
            date: new Date().toISOString(),
            dueDate: dueDate || null,
            amountUsd: parseFloat(amountUsd),
            amountBs: parseFloat(amountUsd) * bcvRate,
            status: 'PENDIENTE',
            amountPaidUsd: 0,
            type: 'INVOICE'
        };
        onSave(invoiceData);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <FileText size={18} className="text-red-500" /> Cargar Factura
                    </h3>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full"><X size={18} /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <p className="text-xs text-slate-500 -mt-2 mb-2">Registrar deuda con: <strong>{supplier.name}</strong></p>
                    
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nro Control / Factura *</label>
                        <input type="text" required value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 text-sm font-bold dark:bg-slate-950" autoFocus />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Monto Total a Pagar (USD) *</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-black text-slate-400">USD</span>
                            <input type="number" required min="0.01" step="0.01" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 pl-12 text-lg font-black dark:bg-slate-950" />
                        </div>
                        {amountUsd && bcvRate > 0 && <p className="text-[10px] text-slate-500 mt-1 text-right">Equivale a {formatBs(parseFloat(amountUsd) * bcvRate)} Bs</p>}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha Vencimiento (Opcional)</label>
                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 text-sm font-bold dark:bg-slate-950 text-slate-700 dark:text-white" />
                    </div>

                    <button type="submit" disabled={!invoiceNumber || !amountUsd || parseFloat(amountUsd) <= 0} className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-500/50 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 mt-4">
                        Registrar Deuda
                    </button>
                </form>
            </div>
        </div>
    );
}

export function PayInvoiceModal({ supplier, bcvRate, tasaCop, copEnabled, copPrimary, activePaymentMethods = [], onClose, onSave }) {
    const [amount, setAmount] = useState('');
    const [currencyMode, setCurrencyMode] = useState('BS');
    const [paymentMethod, setPaymentMethod] = useState('efectivo_bs');
    const [retiraCaja, setRetiraCaja] = useState(true);

    const handleSave = (e) => {
        e.preventDefault();
        const rawAmt = parseFloat(amount);
        if (!rawAmt || rawAmt <= 0) return;

        let amountUsd = rawAmt;
        if (currencyMode === 'BS' && bcvRate > 0) amountUsd = rawAmt / bcvRate;
        if (currencyMode === 'COP' && tasaCop > 0) amountUsd = rawAmt / tasaCop;
        
        const amountBs = currencyMode === 'BS' ? rawAmt : (amountUsd * bcvRate);
        const amountCop = currencyMode === 'COP' ? rawAmt : (amountUsd * tasaCop);

        onSave({
            amountUsd,
            amountBs,
            amountCop,
            paymentMethod: retiraCaja ? paymentMethod : 'pago_externo',
            currencyMode,
            retiraCaja
        });
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <CreditCard size={18} className="text-emerald-500" /> Pagar a Proveedor
                    </h3>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full"><X size={18} /></button>
                </div>
                <form onSubmit={handleSave} className="p-5 space-y-4">
                    <p className="text-xs text-slate-500 -mt-2 mb-2">Deuda total: <strong>{copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(supplier.deuda * tasaCop)} COP · USD ${formatUsd(supplier.deuda)}` : `USD ${formatUsd(supplier.deuda)}`}{copEnabled && !copPrimary && tasaCop > 0 ? ` · ${formatCop(supplier.deuda * tasaCop)} COP` : ''}</strong></p>
                    
                    {/* Moneda */}
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button type="button" onClick={() => { setCurrencyMode('BS'); setAmount(''); setPaymentMethod('efectivo_bs'); }} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${currencyMode === 'BS' ? 'bg-white shadow text-brand' : 'text-slate-500'}`}>Bs</button>
                        <button type="button" onClick={() => { setCurrencyMode('USD'); setAmount(''); setPaymentMethod('efectivo_usd'); }} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${currencyMode === 'USD' ? 'bg-white shadow text-emerald-500' : 'text-slate-500'}`}>USD</button>
                        {copEnabled && (
                            <button type="button" onClick={() => { setCurrencyMode('COP'); setAmount(''); setPaymentMethod('efectivo_cop'); }} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${currencyMode === 'COP' ? 'bg-white shadow text-amber-500' : 'text-slate-500'}`}>COP</button>
                        )}
                    </div>

                    {/* Input */}
                    <div>
                        <div className="flex items-center w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-brand/50">
                            <span className={`pl-4 text-lg font-black shrink-0 select-none ${currencyMode === 'BS' ? 'text-brand' : currencyMode === 'COP' ? 'text-amber-500' : 'text-emerald-500'}`}>
                                {currencyMode === 'BS' ? 'Bs' : currencyMode === 'COP' ? 'COP' : 'USD'}
                            </span>
                            <input 
                                type="number" 
                                step="0.01" 
                                required 
                                value={amount} 
                                onChange={e => setAmount(e.target.value)} 
                                className="flex-1 bg-transparent border-none outline-none focus:ring-0 px-3 py-3 text-2xl font-black dark:text-white" 
                                autoFocus 
                            />
                        </div>
                        {amount && bcvRate > 0 && (
                            <div className="mt-2 text-right">
                                <p className="text-[10px] text-slate-500">
                                    Equivale a {currencyMode === 'BS' ? `USD ${formatUsd(parseFloat(amount)/bcvRate)}` : currencyMode === 'COP' ? `USD ${formatUsd(parseFloat(amount)/tasaCop)}` : `${formatBs(parseFloat(amount)*bcvRate)} Bs`}
                                </p>
                                {currencyMode !== 'COP' && copEnabled && tasaCop > 0 && (
                                     <p className="text-[10px] text-slate-500">
                                         • {currencyMode === 'BS' ? ((parseFloat(amount)/bcvRate) * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (parseFloat(amount)*tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP
                                     </p>
                                )}
                            </div>
                        )}
                        {supplier.deuda > 0 && (
                            <button type="button" onClick={() => setAmount(currencyMode === 'BS' ? (supplier.deuda * bcvRate).toFixed(2) : currencyMode === 'COP' ? (supplier.deuda * tasaCop).toFixed(2) : supplier.deuda.toFixed(2))} className="mt-2 w-full text-xs font-bold text-emerald-600 bg-emerald-50 py-1.5 rounded border border-emerald-200">
                                Pagar Deuda Completa
                            </button>
                        )}
                    </div>

                    {/* Switch Retirar de Caja */}
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80">
                        <div className="text-left">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">¿Descontar de Caja Chica?</span>
                            <span className="text-[9px] text-slate-400 block leading-tight">
                                {retiraCaja 
                                    ? 'El pago se registrará como egreso en el arqueo diario.' 
                                    : 'Pago con fondos externos. No altera el arqueo de caja.'}
                            </span>
                        </div>
                        <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer select-none shrink-0">
                            <input 
                                type="checkbox" 
                                checked={retiraCaja} 
                                onChange={e => setRetiraCaja(e.target.checked)} 
                                className="sr-only peer" 
                            />
                            <div className="relative w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>

                    {/* Método de pago */}
                    {retiraCaja ? (
                        (() => {
                            const filteredMethods = activePaymentMethods.filter(m => m.currency === currencyMode);
                            return (
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 dark:text-slate-505 uppercase tracking-wider block">Medio de Pago</label>
                                    <CustomSelect
                                        value={filteredMethods.some(m => m.id === paymentMethod) ? paymentMethod : (filteredMethods[0]?.id || '')}
                                        onChange={setPaymentMethod}
                                        options={filteredMethods.map(method => ({
                                            value: method.id,
                                            label: method.label
                                        }))}
                                    />
                                </div>
                            );
                        })()
                    ) : (
                        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 p-3 rounded-xl text-left">
                            <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                ℹ️ Este pago disminuirá el saldo adeudado al proveedor en su estado de cuenta, pero no registrará salidas de efectivo en la caja registradora de hoy.
                            </p>
                        </div>
                    )}

                    <button type="submit" disabled={!amount || parseFloat(amount) <= 0} className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 mt-4">
                        Procesar Pago
                    </button>
                </form>
            </div>
        </div>
    );
}

export function SupplierDetailsSheet({ supplier, isOpen, isAdmin, onClose, onAddInvoice, onPayInvoice, onEdit, onDelete, bcvRate, tasaCop, copEnabled, copPrimary, historyData, triggerHaptic }) {
    if (!isOpen || !supplier) return null;

    return (
        <div className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-3xl max-h-[85vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom" onClick={e => e.stopPropagation()}>
                {/* Close + Drag Handle */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <div className="w-8" />
                    <div className="w-8 h-1 bg-slate-300 dark:bg-slate-700 rounded-full" />
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full transition-colors"><X size={18} /></button>
                </div>

                <div className="px-5 pb-6 space-y-5">
                    {/* Header */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-brand-dark dark:bg-brand-dark/30 flex items-center justify-center shrink-0">
                            <span className="text-2xl font-black text-brand dark:text-brand">
                                {supplier.name.charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">{supplier.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                {supplier.documentId && <p className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{supplier.documentId}</p>}
                            </div>
                            {supplier.contactName && <p className="text-xs text-slate-500 mt-1">Contacto: {supplier.contactName}</p>}
                        </div>
                    </div>

                    {/* Deuda / Saldo */}
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-4 py-3 text-center">
                        <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Total por Pagar</p>
                        <p className={`text-3xl font-black ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                            {copEnabled && copPrimary && tasaCop > 0
                                ? `${formatCop(supplier.deuda * tasaCop)} COP`
                                : `USD ${formatUsd(supplier.deuda)}`}
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-1">
                            {copEnabled && copPrimary && <p className="text-xs font-bold text-red-400/80">USD {formatUsd(supplier.deuda)}</p>}
                            {copEnabled && !copPrimary && tasaCop > 0 && <p className="text-xs font-bold text-red-400/80">{formatCop(supplier.deuda * tasaCop)} COP</p>}
                            {bcvRate > 0 && <p className="text-xs font-bold text-red-400/80">{formatBs(supplier.deuda * bcvRate)} Bs</p>}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={onAddInvoice} className="py-3 bg-red-100 text-red-600 rounded-xl text-xs font-bold active:scale-95 flex flex-col items-center gap-1">
                            <FileText size={18} /> Cargar Factura
                        </button>
                        <button onClick={onPayInvoice} className="py-3 bg-emerald-100 text-emerald-600 rounded-xl text-xs font-bold active:scale-95 flex flex-col items-center gap-1" disabled={supplier.deuda <= 0}>
                            <CreditCard size={18} /> Registrar Pago
                        </button>
                    </div>

                    {/* Historial (Facturas y Pagos) */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Clock size={12} /> Estado de Cuenta
                            </h4>
                            {historyData.length > 0 && (
                                <button
                                    onClick={async () => {
                                        triggerHaptic && triggerHaptic();
                                        const { generateSupplierHistoryPDF } = await import('../../utils/supplierReportGenerator');
                                        generateSupplierHistoryPDF({
                                            supplier,
                                            historyData,
                                            bcvRate,
                                            tasaCop,
                                            copEnabled
                                        });
                                    }}
                                    className="text-[10px] font-bold text-brand-dark dark:text-brand bg-slate-100 dark:bg-slate-800/40 px-2.5 py-1 rounded-lg flex items-center gap-1 active:scale-95 transition-all animate-in fade-in duration-200"
                                >
                                    <Download size={10} /> Reporte PDF
                                </button>
                            )}
                        </div>
                        {historyData.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-4">Sin facturas registradas</p>
                        ) : (
                            <div className="space-y-2">
                                {historyData.map(record => {
                                    const isInvoice = record.type === 'INVOICE';
                                    const dateStr = new Date(record.date || record.timestamp).toLocaleDateString('es-VE');
                                    return (
                                        <div key={record.id} className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-slate-950 rounded-xl">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isInvoice ? 'bg-red-100/50 text-red-500' : 'bg-emerald-100/50 text-emerald-500'}`}>
                                                {isInvoice ? <FileText size={14} /> : <ArrowUpRight size={14} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                                    {isInvoice ? `Factura #${record.invoiceNumber}` : `Abono/Pago`}
                                                </p>
                                                <p className="text-[10px] text-slate-400">{dateStr} {isInvoice && record.dueDate && `• Venc: ${new Date(record.dueDate).toLocaleDateString('es-VE')}`}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className={`text-sm font-black ${isInvoice ? 'text-red-500' : 'text-emerald-500'}`}>
                                                    {copEnabled && copPrimary && tasaCop > 0
                                                        ? <>{isInvoice ? '+' : '-'}{formatCop((isInvoice ? record.amountUsd : Math.abs(record.totalUsd || 0)) * tasaCop)} COP</>
                                                        : <>{isInvoice ? '+' : '-'}USD {formatUsd(isInvoice ? record.amountUsd : Math.abs(record.totalUsd || 0))}</>}
                                                </p>
                                                {copEnabled && copPrimary && (
                                                    <p className={`text-[10px] font-bold ${isInvoice ? 'text-red-400/80' : 'text-emerald-400/80'}`}>
                                                        {isInvoice ? '+' : '-'}USD {formatUsd(isInvoice ? record.amountUsd : Math.abs(record.totalUsd || 0))}
                                                    </p>
                                                )}
                                                {copEnabled && !copPrimary && tasaCop > 0 && (
                                                    <p className={`text-[10px] font-bold ${isInvoice ? 'text-red-400/80' : 'text-emerald-400/80'}`}>
                                                        {isInvoice ? '+' : '-'}{formatCop((isInvoice ? record.amountUsd : Math.abs(record.totalUsd || 0)) * tasaCop)} COP
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Editar / Eliminar */}
                    <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 active:scale-95">
                            <Pencil size={14} /> Editar
                        </button>
                        {isAdmin && (
                            <button onClick={onDelete} className="px-4 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-bold active:scale-95" disabled={supplier.deuda > 0}>
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
