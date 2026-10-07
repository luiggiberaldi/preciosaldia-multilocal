import React from 'react';
import { Tag } from 'lucide-react';
import { formatUsd } from '../../utils/calculatorUtils';

/**
 * RepriceNotice — AVISO-REPRECIO (PLAN-AVISO-REPRECIO-BS.md, Trabajo 1 · Fase 1).
 *
 * Banner informativo y NO bloqueante que explica el re-precio por Doble Precio:
 * cuando entra un pago en Bs, el ticket pasa a cobrarse al precio de referencia
 * del producto. Sin este aviso el total "colapsa" en silencio ($22,00 → $1,20) y
 * el cajero cree que el cálculo se rompió.
 *
 * Contrato: NO calcula nada financiero. Recibe la señal ya derivada
 * (`isTicketRepriced`, en utils/reprice.js) y los dos totales para mostrarlos.
 */
export default function RepriceNotice({ repricedActive = false, totalUsd = 0, baseTotalUsd = 0 }) {
    if (!repricedActive) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="mx-3 mt-2 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 flex items-start gap-2"
        >
            <Tag size={14} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300 leading-snug">
                Precio en Bs aplicado — este ticket usa el precio de referencia dual:
                {' '}${formatUsd(totalUsd)} <span className="font-black">(antes ${formatUsd(baseTotalUsd)})</span>
            </p>
        </div>
    );
}
