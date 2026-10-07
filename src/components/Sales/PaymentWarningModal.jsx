import { AlertTriangle, ArrowLeftRight, X } from 'lucide-react';

/**
 * Modal de advertencia de pago — reemplaza window.confirm
 * warning: { type: 'currency_confusion' | 'high_amount', title, lines: string[], isRound }
 */
export default function PaymentWarningModal({ warning, onConfirm, onCancel }) {
    if (!warning) return null;

    const isCurrencyError = warning.type === 'currency_confusion';

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">

                {/* Header */}
                <div className={`px-5 pt-5 pb-4 flex items-start gap-3 ${isCurrencyError ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-orange-50 dark:bg-orange-950/30'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isCurrencyError ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-orange-100 dark:bg-orange-900/40'}`}>
                        {isCurrencyError
                            ? <ArrowLeftRight size={20} className="text-amber-500" />
                            : <AlertTriangle size={20} className="text-orange-500" />
                        }
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className={`text-sm font-black ${isCurrencyError ? 'text-amber-700 dark:text-amber-300' : 'text-orange-700 dark:text-orange-300'}`}>
                            {warning.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {isCurrencyError ? 'Posible confusión de moneda' : 'Verificación de monto'}
                        </p>
                    </div>
                </div>

                {/* Body */}
                <div className="px-5 py-4 space-y-2">
                    {warning.lines.map((line, i) => (
                        <p key={i} className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                            {line}
                        </p>
                    ))}
                    {warning.isRound && (
                        <div className="mt-2 p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                💡 El monto ingresado es un número redondo — verifica que no hayas agregado ceros de más.
                            </p>
                        </div>
                    )}
                </div>

                {/* Botones */}
                <div className="px-5 pb-5 flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                        Corregir monto
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold text-white transition-colors ${isCurrencyError ? 'bg-amber-500 hover:bg-amber-600' : 'bg-orange-500 hover:bg-orange-600'}`}
                    >
                        Sí, confirmar
                    </button>
                </div>
            </div>
        </div>
    );
}
