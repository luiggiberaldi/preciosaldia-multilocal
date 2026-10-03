/**
 * PayrollReceiptModal.jsx — Recibo de pago de nómina (v1).
 *
 * Props: { liquidacion, empleado, periodo, onClose }
 * Muestra el resumen del recibo y botones Imprimir / Compartir usando
 * src/utils/payrollReceiptGenerator.js:
 *   printPayrollReceipt({liquidacion, empleado, periodo})
 *   sharePayrollReceipt({liquidacion, empleado, periodo})
 */
import React, { useState } from 'react';
import { Printer, Share2, Loader2, Receipt } from 'lucide-react';
import { Modal } from '../Modal';
import { showToast } from '../Toast';
import { formatUsd } from '../../utils/calculatorUtils';
import { printPayrollReceipt, sharePayrollReceipt } from '../../utils/payrollReceiptGenerator';

const FREC_LABEL = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' };

const fmtFechaHora = (ts) => {
    try {
        return new Date(ts).toLocaleString('es-VE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return ''; }
};

const fmtFecha = (iso) => {
    try {
        return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return ''; }
};

function Row({ label, value, strong }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-dashed border-slate-200 dark:border-slate-700 last:border-0">
            <span className="text-[11px] font-bold text-slate-400">{label}</span>
            <span className={`text-sm ${strong ? 'font-black text-slate-900 dark:text-white' : 'font-bold text-slate-600 dark:text-slate-300'}`}>
                {value}
            </span>
        </div>
    );
}

export default function PayrollReceiptModal({ liquidacion, empleado, periodo, onClose }) {
    const [busy, setBusy] = useState(null); // 'print' | 'share' | null

    if (!liquidacion) return null;

    const run = async (kind) => {
        setBusy(kind);
        try {
            if (kind === 'print') {
                await printPayrollReceipt({ liquidacion, empleado, periodo });
                showToast('Enviando a imprimir…', 'info');
            } else {
                await sharePayrollReceipt({ liquidacion, empleado, periodo });
            }
        } catch (err) {
            showToast(err?.message || (kind === 'print' ? 'No se pudo imprimir' : 'No se pudo compartir'), 'error');
        } finally {
            setBusy(null);
        }
    };

    const metodo = liquidacion.payments?.[0]?.metodo || liquidacion.payments?.[0]?.method || 'Efectivo';

    return (
        <Modal isOpen onClose={onClose} title="Recibo de pago" size="max-w-md">
            <div className="bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
                <div className="text-center mb-4">
                    <div className="w-11 h-11 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-2">
                        <Receipt size={20} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Recibo de pago — Nómina</p>
                    <p className="font-black text-slate-800 dark:text-white">{liquidacion.folio || liquidacion.id}</p>
                    <p className="text-[11px] font-semibold text-slate-400">{fmtFechaHora(liquidacion.createdAt)}</p>
                </div>

                <Row label="Empleado" value={empleado?.nombre || '—'} strong />
                {empleado?.cedula && <Row label="Cédula" value={empleado.cedula} />}
                <Row
                    label="Período"
                    value={`${FREC_LABEL[periodo?.frecuencia] || periodo?.frecuencia || ''} ${periodo?.key || liquidacion.periodoKey || ''}`.trim() || '—'}
                />
                {(periodo?.inicioISO || periodo?.finISO) && (
                    <Row label="Rango" value={`${periodo.inicioISO ? fmtFecha(periodo.inicioISO) : ''} → ${periodo.finISO ? fmtFecha(periodo.finISO) : ''}`} />
                )}
                <Row
                    label="Sueldo del período"
                    value={liquidacion.salarioOriginal
                        ? `${liquidacion.salarioOriginal.moneda === 'Bs' ? 'Bs' : '$'}${formatUsd(liquidacion.salarioOriginal.monto)}`
                        : `$${formatUsd(liquidacion.salarioUsd)}`}
                />
                <Row label="Consumos aplicados" value={`${liquidacion.consumptionIds?.length ?? 0} · $${formatUsd(liquidacion.totalConsumosUsd)}`} />
                <Row label="Neto pagado (USD)" value={`$${formatUsd(liquidacion.netoUsd)}`} strong />
                {Number(liquidacion.netoBs) > 0 && (
                    <Row label="Neto pagado (Bs)" value={`Bs ${formatUsd(liquidacion.netoBs)}`} />
                )}
                {Number(liquidacion.tasaBcvLiquidacion) > 0 && (
                    <Row label="Tasa BCV usada" value={formatUsd(liquidacion.tasaBcvLiquidacion)} />
                )}
                <Row label="Método de pago" value={metodo} />

                <div className="grid grid-cols-2 gap-6 mt-6 mb-2">
                    <div className="text-center">
                        <div className="border-t border-slate-300 dark:border-slate-600 pt-1.5">
                            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Recibido</p>
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="border-t border-slate-300 dark:border-slate-600 pt-1.5">
                            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Entregado</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex gap-2 mt-4">
                <button
                    onClick={() => run('print')}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-3xl text-sm font-extrabold bg-slate-900 dark:bg-white text-white dark:text-slate-900 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                    {busy === 'print' ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                    Imprimir
                </button>
                <button
                    onClick={() => run('share')}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-3xl text-sm font-extrabold bg-brand text-white shadow-md active:scale-[0.98] transition-all disabled:opacity-50"
                >
                    {busy === 'share' ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                    Compartir
                </button>
            </div>
        </Modal>
    );
}
