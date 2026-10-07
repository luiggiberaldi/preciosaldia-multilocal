import React, { useEffect } from 'react';
import { Wallet, Zap } from 'lucide-react';

/**
 * WalletSection — Sección de saldo a favor del cliente.
 * Solo se muestra si el crédito interno puede cubrir una parte pendiente.
 */
export const shouldShowWalletSection = ({ saldoDisponible = 0, faltaSinSaldo = 0, saldoAplicado = 0 }) => (
    Number(saldoDisponible) > 0.01
    && (Number(faltaSinSaldo) > 0.01 || Number(saldoAplicado) > 0.01)
);

export default function WalletSection({
    cliente,
    totalPagadoUSD,
    tasaSegura,
    totalConIGTF,
    casheaAmountUsd = 0,
    pagoSaldoFavor,
    setPagoSaldoFavor,
}) {
    const saldoDisponible = parseFloat(cliente?.favor) || 0;
    // C-2: Cashea también cubre parte del total. Sin descontarlo, faltaSinSaldo
    // queda inflado y el tope del saldo a favor permite fugas de efectivo.
    const pagadoOtros = totalPagadoUSD + (parseFloat(casheaAmountUsd) || 0);
    const faltaSinSaldo = Math.max(0, totalConIGTF - pagadoOtros);
    // C-2 (D1): el saldo a favor solo cubre lo que se debe. NO se convierte en efectivo.
    const maxAplicable = Math.min(saldoDisponible, faltaSinSaldo);
    const saldoAplicado = parseFloat(pagoSaldoFavor) || 0;

    // El saldo a favor solo es una alternativa cuando todavía falta cubrir la
    // venta. Si ya existe sobrepago, mostrarlo induce al cajero a usar un
    // crédito interno sin necesidad. Si ya se aplicó, mantenemos el bloque
    // visible para poder corregir el monto.
    useEffect(() => {
        if (faltaSinSaldo <= 0.01 && saldoAplicado > 0.01) {
            setPagoSaldoFavor('');
        }
    }, [faltaSinSaldo, saldoAplicado, setPagoSaldoFavor]);

    if (!shouldShowWalletSection({ saldoDisponible, faltaSinSaldo, saldoAplicado })) return null;

    const handleUsarTodo = () => {
        const aUsar = maxAplicable;
        setPagoSaldoFavor(aUsar.toFixed(2));
    };

    return (
        <div className="mb-5 p-4 bg-brand-light dark:bg-brand/10 border border-brand/20 dark:border-brand/30 rounded-xl flex flex-col sm:flex-row items-center gap-4 animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3 flex-1">
                <div className="bg-brand/10 dark:bg-brand/20 p-2.5 rounded-full text-brand">
                    <Wallet size={20} />
                </div>
                <div>
                    <h4 className="font-bold text-brand/90 dark:text-brand text-xs uppercase tracking-wide">Saldo a Favor · Método de pago</h4>
                    <div className="text-xl font-black text-brand">${saldoDisponible.toFixed(2)}</div>
                </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand/60 font-bold text-sm">$</span>
                    <input
                        type="number"
                        value={pagoSaldoFavor}
                        onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            // C-2 (D1): el tope es maxAplicable, no saldoDisponible.
                            if (e.target.value === '' || (v >= 0 && v <= maxAplicable)) {
                                setPagoSaldoFavor(e.target.value);
                            }
                        }}
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-2 rounded-lg border-2 border-brand/30 dark:border-brand/40 focus:border-brand outline-none font-bold text-brand/90 dark:text-brand text-right bg-white dark:bg-slate-900"
                    />
                </div>
                <button
                    onClick={handleUsarTodo}
                    type="button"
                    title="Aplicar el máximo saldo a favor permitido"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand/90 text-white font-bold text-xs rounded-lg transition-colors whitespace-nowrap active:scale-95"
                >
                    <Zap size={13} strokeWidth={3} /> Todo
                </button>
            </div>
        </div>
    );
}
