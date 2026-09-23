import React from 'react';
import { CheckCircle, Wallet } from 'lucide-react';

/**
 * PaymentFooter — Footer del modo POS con botón PAGAR.
 */
export default function PaymentFooter({
    modo,
    faltaPorPagar,
    clienteSeleccionado,
    totalPagadoGlobalUSD,
    cambioUSD = 0,
    onProcesar,
    isProcessing = false,
    rateError = false,
    changeAllocationComplete = true,
}) {
    const canPay = modo === 'contado'
        ? faltaPorPagar <= 0.01
        : (clienteSeleccionado && faltaPorPagar <= 0.01) || (clienteSeleccionado);

    // M-2: sin tasa BCV válida no se cobra (paridad con el modo básico).
    const creditOverpayment = modo === 'credito' && cambioUSD > 0.01;
    const disabled = isProcessing || rateError || creditOverpayment || (modo === 'contado'
        ? faltaPorPagar > 0.01 || !changeAllocationComplete
        : !clienteSeleccionado);

    return (
        <div className="px-3 sm:px-5 pt-3 sm:pt-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-4 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-t border-slate-100 dark:border-slate-800 flex justify-end items-center gap-3 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.04)] dark:shadow-[0_-4px_10px_rgba(0,0,0,0.2)]">
            {/* Pagar / Fiar */}
            <button
                type="button"
                onClick={() => onProcesar(false)}
                disabled={disabled}
                aria-disabled={disabled}
                className={`px-4 sm:px-10 py-3.5 min-h-[52px] rounded-xl font-black text-sm sm:text-base flex items-center gap-2 shadow-lg transition-all active:scale-[0.97] flex-1 max-w-none sm:max-w-xs justify-center
                    ${disabled
                        ? 'bg-slate-100 dark:bg-slate-800 !text-slate-500 cursor-not-allowed shadow-none'
                        : modo === 'credito'
                            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/25'
                            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25'
                    }`}
            >
                {isProcessing ? (
                    <><span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> PROCESANDO...</>
                ) : modo === 'credito' ? (
                    creditOverpayment
                        ? <><Wallet size={20} /> PAGO EXCEDE LA VENTA</>
                        : <><Wallet size={20} /> {faltaPorPagar > 0.01
                            ? (totalPagadoGlobalUSD > 0.01 ? 'PROCESAR CON ABONO' : 'FIAR TOTALMENTE')
                            : 'REGISTRAR VENTA'}</>
                ) : (
                    changeAllocationComplete
                        ? <><CheckCircle size={20} /> PAGAR (LISTO)</>
                        : <><Wallet size={20} /> CONFIRMA EL CAMBIO</>
                )}
            </button>
        </div>
    );
}
