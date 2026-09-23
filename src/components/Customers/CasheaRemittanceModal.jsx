import React, { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Registro de la REMESA que Cashea envía a la bodega.
 * NO es un abono del cliente: el cliente ya pagó su cuota inicial.
 */
export default function CasheaRemittanceModal({
    isOpen, customer, onClose, onConfirm, activePaymentMethods = [],
}) {
    const [amount, setAmount] = useState('');
    const [currencyMode, setCurrencyMode] = useState('USD');
    const [paymentMethod, setPaymentMethod] = useState('efectivo_usd');
    const [busy, setBusy] = useState(false);

    if (!isOpen || !customer) return null;

    const pendiente = customer.casheaDeuda || 0;

    // Mismo criterio que TransactionModal: los métodos se filtran por la moneda
    // seleccionada, para no registrar un método en Bs con currencyMode USD.
    const metodosDisponibles = (activePaymentMethods || [])
        .filter(m => m.currency === currencyMode)
        .filter(m => m.id !== 'fiado' && m.id !== 'cashea' && m.id !== 'saldo_favor');

    // Si el método actual no pertenece a la moneda elegida, se usa el primero válido.
    const metodoEfectivo = metodosDisponibles.some(m => m.id === paymentMethod)
        ? paymentMethod
        : (metodosDisponibles[0]?.id || (currencyMode === 'USD' ? 'efectivo_usd' : 'efectivo_bs'));

    const handleConfirm = async () => {
        if (busy) return;
        setBusy(true);
        await onConfirm({ transactionAmount: amount, currencyMode, paymentMethod: metodoEfectivo });
        setBusy(false);
        setAmount('');
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-black text-slate-800 dark:text-white">Registrar remesa de Cashea</h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Cashea le remesa a la bodega el monto que financió a <strong>{customer.name}</strong>.
                    El cliente no debe este dinero.
                </p>

                <div className="bg-purple-50 dark:bg-purple-950/20 rounded-2xl p-3 mb-4 flex justify-between items-center">
                    <span className="text-xs font-bold uppercase text-purple-600 dark:text-purple-400">Pendiente por cobrar</span>
                    <span className="text-lg font-black text-purple-600 dark:text-purple-400">${pendiente.toFixed(2)}</span>
                </div>

                <div className="flex gap-2 mb-3">
                    {['USD', 'BS'].map(m => (
                        <button key={m} type="button" onClick={() => setCurrencyMode(m)}
                            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${currencyMode === m ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                            {m}
                        </button>
                    ))}
                </div>

                <input
                    type="number" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Monto en ${currencyMode}`}
                    className="w-full px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold mb-2 outline-none"
                />

                <button type="button" onClick={() => { setCurrencyMode('USD'); setAmount(String(pendiente.toFixed(2))); }}
                    className="w-full py-2 mb-3 text-xs font-bold text-purple-600 dark:text-purple-400 hover:underline">
                    Remesa completa (${pendiente.toFixed(2)})
                </button>

                <select value={metodoEfectivo} onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold mb-4 outline-none">
                    {(metodosDisponibles.length
                        ? metodosDisponibles
                        : [{ id: metodoEfectivo, label: currencyMode === 'USD' ? 'Efectivo $' : 'Efectivo Bs' }]
                    ).map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                </select>

                <button type="button" onClick={handleConfirm}
                    disabled={busy || !amount || parseFloat(amount) <= 0}
                    className="w-full py-3.5 rounded-xl bg-purple-600 text-white font-bold text-sm disabled:opacity-40 active:scale-95 transition-all">
                    {busy ? 'Registrando…' : 'Registrar remesa'}
                </button>
            </div>
        </div>
    );
}
