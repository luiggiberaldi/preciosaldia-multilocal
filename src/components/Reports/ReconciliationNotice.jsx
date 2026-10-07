// FIA-REPORT-001 (H5) — Aviso de descuadre cartera ↔ ledger.
// Se muestra SOLO si hay drift: nunca es ruido permanente. La reparación es
// opcional, exige rol y queda registrada en auditoría (nunca borra movimientos).

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';

export default function ReconciliationNotice({
    reconciliation,
    canRepair = false,
    onRepair = null,
    isRepairing = false,
}) {
    const [expanded, setExpanded] = useState(false);

    if (!reconciliation || reconciliation.ok || reconciliation.drift.length === 0) return null;

    const driftCount = reconciliation.drift.length;
    const driftUsd = reconciliation.totals.driftUsd;

    return (
        <div
            className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 p-4 mb-4"
            role="status"
            aria-live="polite"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
                            Cartera descuadrada con el ledger
                        </p>
                        <p className="text-xs text-amber-700/80 dark:text-amber-500/80 mt-0.5">
                            {driftCount === 1 ? '1 cliente' : `${driftCount} clientes`} · diferencia USD {(driftUsd || 0).toFixed(2)}
                            {' '}· revisado {reconciliation.checkedCount} de {reconciliation.drift.length + reconciliation.checkedCount} clientes
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setExpanded(value => !value)}
                    className="text-amber-600 dark:text-amber-400 shrink-0 p-1"
                    aria-label={expanded ? 'Ocultar detalle' : 'Ver detalle'}
                >
                    {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
            </div>

            {expanded && (
                <div className="mt-3 pt-3 border-t border-amber-200/70 dark:border-amber-900/40 space-y-2">
                    {reconciliation.drift.slice(0, 8).map(item => (
                        <div key={item.customerId} className="flex items-center justify-between text-xs gap-3">
                            <span className="text-amber-800 dark:text-amber-300 truncate">{item.name}</span>
                            <span className="text-amber-800/80 dark:text-amber-400/80 shrink-0">
                                guardado USD {item.customerDeudaUsd.toFixed(2)}
                                {' · '}ledger USD {item.ledgerDeudaUsd.toFixed(2)}
                                <strong className="ml-1.5">
                                    ({item.deltaUsd > 0 ? '+' : '−'}USD {Math.abs(item.deltaUsd).toFixed(2)})
                                </strong>
                            </span>
                        </div>
                    ))}
                    {reconciliation.drift.length > 8 && (
                        <p className="text-[10px] text-amber-700/70 dark:text-amber-500/70">
                            y {reconciliation.drift.length - 8} más…
                        </p>
                    )}
                    {reconciliation.ledgerOrphans.length > 0 && (
                        <p className="text-[10px] text-amber-700/70 dark:text-amber-500/70">
                            {reconciliation.ledgerOrphans.length} movimiento(s) del ledger apuntan a clientes que ya no existen.
                        </p>
                    )}
                    <p className="text-[10px] text-amber-700/70 dark:text-amber-500/70">
                        El ledger es la fuente de detalle (cada movimiento con su saldo).
                        La diferencia suele venir de ediciones manuales o sincronizaciones parciales.
                    </p>

                    {canRepair && onRepair && (
                        <button
                            type="button"
                            onClick={onRepair}
                            disabled={isRepairing}
                            className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 text-white text-xs font-bold py-2.5 disabled:opacity-60"
                        >
                            <ShieldCheck size={14} />
                            {isRepairing ? 'Reconstruyendo…' : `Reconstruir ${driftCount} saldo(s) desde el ledger`}
                        </button>
                    )}
                </div>
            )}

            {!expanded && driftUsd > 0 && (
                <p className="text-[10px] text-amber-700/70 dark:text-amber-500/70 mt-2">
                    Diferencia total: {formatBs(driftUsd)} Bs · toca para ver el detalle por cliente.
                </p>
            )}
        </div>
    );
}
