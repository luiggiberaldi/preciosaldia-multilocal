import React, { useState, useMemo } from 'react';
import { X, ChevronRight, DollarSign, Wallet, CheckCircle2, AlertTriangle, TrendingUp, ShoppingBag, Package, ArrowRight, Coins } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { getPaymentLabel, getPaymentIcon, toTitleCase } from '../../config/paymentMethods';
import { round2, subR, mulR } from '../../utils/dinero';
// FIN-028: semáforo de cierre ahora considera las tres monedas con tolerancias explícitas.
import { FINANCIAL_EPSILON } from '../../utils/securityConstants';

const extractAdvancesFromSales = (salesArray) => {
    const list = [];
    salesArray.forEach(s => {
        if (s.status === 'ANULADA') return;
        if (s.tipo === 'AVANCE_EFECTIVO') {
            list.push({
                id: s.id,
                currency: s.currency || 'BS',
                montoEfectivo: s.montoEfectivo || 0,
                montoComision: s.montoComision || 0,
                comisionPct: s.comisionPct || 10,
                totalCobrado: s.totalCobrado || 0,
                timestamp: s.timestamp
            });
        } else if (s.items && s.items.length > 0) {
            s.items.forEach((item, index) => {
                if (item.isCashAdvance) {
                    list.push({
                        id: `${s.id}_adv_${index}`,
                        currency: item.currency || 'BS',
                        montoEfectivo: item.montoEfectivo || 0,
                        montoComision: item.montoComision || 0,
                        comisionPct: item.comisionPct || 10,
                        totalCobrado: item.montoEfectivo + item.montoComision,
                        timestamp: s.timestamp
                    });
                }
            });
        }
    });
    return list;
};

export default function CierreCajaWizard({
    isOpen,
    onClose,
    onConfirm,
    // Data from DashboardView
    todaySales = [],
    todayTotalUsd = 0,
    todayTotalBs = 0,
    todayTotalCop: todayTotalCopProp = 0,
    todayProfit = 0,
    todayItemsSold = 0,
    todayExpensesUsd = 0,
    paymentBreakdown = {},
    todayTopProducts = [],
    bcvRate = 1,
    copEnabled = false,
    copPrimary = false,
    tasaCop = 0,
    todayCashFlow = []
}) {
    const [step, setStep] = useState(1);
    const [actualUsd, setActualUsd] = useState('');
    const [actualBs, setActualBs] = useState('');
    const [actualCop, setActualCop] = useState('');

    const todayAdvances = useMemo(() => {
        return extractAdvancesFromSales(todayCashFlow);
    }, [todayCashFlow]);

    const totalAdvancesEfectivoBs = useMemo(() => {
        return todayAdvances.filter(a => a.currency === 'BS').reduce((sum, a) => sum + (a.montoEfectivo || 0), 0);
    }, [todayAdvances]);

    const totalAdvancesEfectivoUsd = useMemo(() => {
        return todayAdvances.filter(a => a.currency === 'USD').reduce((sum, a) => sum + (a.montoEfectivo || 0), 0);
    }, [todayAdvances]);

    const totalAdvancesComisionBs = useMemo(() => {
        return todayAdvances.filter(a => a.currency === 'BS').reduce((sum, a) => sum + (a.montoComision || 0), 0);
    }, [todayAdvances]);

    const totalAdvancesComisionUsd = useMemo(() => {
        return todayAdvances.filter(a => a.currency === 'USD').reduce((sum, a) => sum + (a.montoComision || 0), 0);
    }, [todayAdvances]);

    if (!isOpen) return null;

    const expectedUsd = round2((paymentBreakdown['efectivo_usd']?.total || 0) - (paymentBreakdown['_vuelto_usd']?.total || 0));
    const expectedBs = round2((paymentBreakdown['efectivo_bs']?.total || 0) - (paymentBreakdown['_vuelto_bs']?.total || 0));
    const expectedCop = paymentBreakdown['efectivo_cop']?.total || 0;

    const declaredUsd = round2(parseFloat(actualUsd) || 0);
    const declaredBs = round2(parseFloat(actualBs) || 0);
    const declaredCop = round2(parseFloat(actualCop) || 0);
    const diffUsd = subR(declaredUsd, expectedUsd);
    const diffBs = subR(declaredBs, expectedBs);
    const diffCop = subR(declaredCop, expectedCop);

    // Check if there were any COP transactions today
    const hasCopTransactions = copEnabled && (
        expectedCop > 0 ||
        Object.keys(paymentBreakdown).some(k => paymentBreakdown[k].currency === 'COP')
    );

    // Total COP del dia (use stored totalCop from sales, fallback to derived)
    const todayTotalCop = todayTotalCopProp > 0 ? todayTotalCopProp : (copEnabled && tasaCop > 0 ? mulR(todayTotalUsd, tasaCop) : 0);

    // Semaforo
    // FIN-028: Antes solo consideraba USD. Ahora combina las tres monedas con
    //   tolerancias explícitas (FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_*).
    //   Regla: si alguna moneda tiene discrepancia significativa → rojo.
    //         si alguna tiene diferencia menor pero todas las demás cuadradas → ámbar.
    //         si todas cuadran dentro de tolerancia → verde.
    const absDiffUsd = Math.abs(diffUsd);
    const absDiffBs = Math.abs(diffBs);
    const absDiffCop = Math.abs(diffCop);
    const hasCopActivity = hasCopTransactions || expectedCop > 0 || declaredCop > 0;

    const usdOk = absDiffUsd <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_USD;
    const bsOk = absDiffBs <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS;
    const copOk = !hasCopActivity || absDiffCop <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_COP;

    const getSemaforo = () => {
        if (usdOk && bsOk && copOk) return { color: 'emerald', label: 'Caja cuadrada', icon: CheckCircle2, bg: 'bg-emerald-500' };
        // Diferencia menor: al menos una moneda excede tolerancia pero todas < 5x tolerancia.
        const usdMinor = absDiffUsd <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_USD * 5;
        const bsMinor = absDiffBs <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS * 5;
        const copMinor = !hasCopActivity || absDiffCop <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_COP * 5;
        if (usdMinor && bsMinor && copMinor) return { color: 'amber', label: 'Diferencia menor', icon: AlertTriangle, bg: 'bg-amber-500' };
        return { color: 'red', label: 'Discrepancia significativa', icon: AlertTriangle, bg: 'bg-red-500' };
    };

    const handleConfirm = () => {
        onConfirm({
            expectedUsd,
            expectedBs,
            expectedCop,
            cashUsd: declaredUsd,
            declaredUsd,
            cashBs: declaredBs,
            declaredBs,
            cashCop: declaredCop,
            declaredCop,
            diffUsd,
            diffBs,
            diffCop
        });
        setStep(1);
        setActualUsd('');
        setActualBs('');
        setActualCop('');
    };

    const handleClose = () => {
        setStep(1);
        setActualUsd('');
        setActualBs('');
        setActualCop('');
        onClose();
    };

    // Excluir entradas negativas del desglose visual: el -fiado aparece cuando un COBRO_DEUDA
    // cancela una VENTA_FIADA de otro turno. El dinero ya aparece en el método de pago real.
    const paymentEntries = Object.entries(paymentBreakdown).filter(([, data]) => data.total > 0);

    // Helper: format COP display
    const fmtCop = (v) => v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Helper: display a USD amount — always USD-primary ($), with COP as secondary
    const copActive = copEnabled && tasaCop > 0;
    const fmtUsdAmt = (usd, { sign = '' } = {}) => {
        return `${sign}$${usd.toFixed(2)}`;
    };
    // Secondary line for COP amount (shown only in COP mode)
    const fmtCopSecondary = (usd, { sign = '' } = {}) =>
        copActive ? `${sign}${formatCop(usd * tasaCop)} COP` : null;
    // Secondary line for USD amount (kept for backward compat, now returns null)
    const fmtUsdSecondary = (usd, { sign = '' } = {}) => null;

    // Helper: determine currency label for payment breakdown display
    const getCurrencyDisplay = (methodId, data) => {
        if (data.currency === 'INTERNAL_CREDIT' || data.isInternalCredit) return `$${data.total.toFixed(2)} crédito interno`;
        if (data.currency === 'COP') return `${fmtCop(data.total)} COP`;
        if (data.currency === 'BS' || methodId.includes('_bs') || methodId === 'pago_movil') return `${formatBs(data.total)} Bs`;
        return fmtUsdAmt(data.total);
    };

    return (
        <div className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-md flex items-end sm:items-center justify-center animate-in fade-in duration-200" onClick={handleClose}>
            <div
                className="bg-white dark:bg-slate-900 w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[92vh] flex flex-col shadow-2xl border-t border-slate-200 dark:border-slate-700 animate-in slide-in-from-bottom duration-300"
                onClick={e => e.stopPropagation()}
            >
                {/* Progress Bar */}
                <div className="px-6 pt-5 pb-3">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-black text-slate-800 dark:text-white">Cierre de Caja</h2>
                        <button onClick={handleClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                    <div className="flex gap-2">
                        {[1, 2, 3].map(s => (
                            <div key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${s <= step ? 'bg-brand' : 'bg-slate-200 dark:bg-slate-700'}`} />
                        ))}
                    </div>
                    <div className="flex justify-between mt-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= 1 ? 'text-brand' : 'text-slate-400'}`}>Resumen</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= 2 ? 'text-brand' : 'text-slate-400'}`}>Conteo</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= 3 ? 'text-brand' : 'text-slate-400'}`}>Resultado</span>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 pb-6">

                    {/* ═══ STEP 1: Resumen del Dia ═══ */}
                    {step === 1 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                            {/* Totales principales */}
                            <div className="bg-gradient-to-br from-brand to-brand-dark rounded-2xl p-5 text-white relative overflow-hidden">
                                <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
                                <p className="text-xs font-bold text-brand-light uppercase tracking-widest mb-1">Ingresos brutos del dia</p>
                                <p className="text-3xl font-black">
                                    {copEnabled && copPrimary && tasaCop > 0
                                        ? `${formatCop(todayTotalCop)} COP`
                                        : fmtUsdAmt(todayTotalUsd)}
                                </p>
                                {copActive && (
                                    copPrimary
                                        ? <p className="text-sm font-bold text-brand-light mt-0.5">{fmtUsdAmt(todayTotalUsd)}</p>
                                        : <p className="text-sm font-bold text-amber-300 mt-0.5">{formatCop(todayTotalCop)} COP</p>
                                )}
                                <p className="text-sm font-bold text-brand-light mt-0.5">{formatBs(todayTotalBs)} Bs</p>
                                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/20">
                                    <div className="flex items-center gap-1.5">
                                        <ShoppingBag size={14} className="text-brand-light" />
                                        <span className="text-sm font-bold">{todaySales.length} {todaySales.length === 1 ? 'venta' : 'ventas'}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <Package size={14} className="text-brand-light" />
                                        <span className="text-sm font-bold">{todayItemsSold} items</span>
                                    </div>
                                </div>
                            </div>

                            {/* Ganancia + Egresos */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 rounded-xl p-3">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <TrendingUp size={14} className="text-emerald-500" />
                                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Ganancia</span>
                                    </div>
                                    <p className={`text-lg font-black ${todayProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                        {copEnabled && copPrimary && tasaCop > 0
                                            ? `${todayProfit >= 0 ? '+' : ''}${formatCop((bcvRate > 0 ? todayProfit / bcvRate : 0) * tasaCop)} COP`
                                            : `${todayProfit >= 0 ? '+' : ''}${fmtUsdAmt(bcvRate > 0 ? todayProfit / bcvRate : 0)}`}
                                    </p>
                                    {copActive && (
                                        copPrimary
                                            ? <p className="text-[11px] font-bold text-emerald-500/70">
                                                {todayProfit >= 0 ? '+' : ''}{fmtUsdAmt(bcvRate > 0 ? todayProfit / bcvRate : 0)}
                                              </p>
                                            : <p className="text-[11px] font-bold text-emerald-500/70">
                                                {todayProfit >= 0 ? '+' : ''}{formatCop((bcvRate > 0 ? todayProfit / bcvRate : 0) * tasaCop)} COP
                                              </p>
                                    )}
                                    <p className="text-[11px] font-bold text-emerald-500/70">{formatBs(todayProfit)} Bs</p>
                                </div>
                                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/30 rounded-xl p-3">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <Package size={14} className="text-orange-500" />
                                        <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase">Egresos</span>
                                    </div>
                                    <p className="text-lg font-black text-orange-600 dark:text-orange-400">
                                        {copEnabled && copPrimary && tasaCop > 0
                                            ? `-${formatCop(todayExpensesUsd * tasaCop)} COP`
                                            : `-${fmtUsdAmt(todayExpensesUsd)}`}
                                    </p>
                                    {copActive && (
                                        copPrimary
                                            ? <p className="text-[11px] font-bold text-orange-500/70">-{fmtUsdAmt(todayExpensesUsd)}</p>
                                            : <p className="text-[11px] font-bold text-orange-500/70">-{formatCop(todayExpensesUsd * tasaCop)} COP</p>
                                    )}
                                    <p className="text-[11px] font-bold text-orange-500/70">-{formatBs(todayExpensesUsd * bcvRate)} Bs</p>
                                </div>
                            </div>

                            {/* Desglose por metodo de pago */}
                            {paymentEntries.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 pl-1">Desglose por metodo</h4>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
                                        {paymentEntries.map(([methodId, data]) => {
                                            const IconComp = getPaymentIcon(methodId);
                                            return (
                                                <div key={methodId} className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-8 h-8 bg-white dark:bg-slate-700 rounded-lg flex items-center justify-center shadow-sm">
                                                            {IconComp ? <IconComp size={16} className="text-slate-600 dark:text-slate-300" /> : <DollarSign size={16} className="text-slate-600 dark:text-slate-300" />}
                                                        </div>
                                                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{toTitleCase(getPaymentLabel(methodId, data.label))}</span>
                                                    </div>
                                                    <span className="text-sm font-black text-slate-800 dark:text-white font-mono">
                                                        {getCurrencyDisplay(methodId, data)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Top productos */}
                            {todayTopProducts.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 pl-1">Mas vendidos hoy</h4>
                                    <div className="space-y-1.5">
                                        {todayTopProducts.slice(0, 5).map((p, i) => (
                                            <div key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2 border border-slate-100 dark:border-slate-700/50">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-5 h-5 bg-brand-light dark:bg-surface-800/30 rounded-md flex items-center justify-center text-[10px] font-black text-brand">{i + 1}</span>
                                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate max-w-[160px]">{p.name}</span>
                                                </div>
                                                <span className="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">{p.qty} uds</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Avances de Efectivo */}
                            {todayAdvances.length > 0 && (
                                <div className="animate-in fade-in slide-in-from-bottom-1">
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 pl-1">Avances de Efectivo</h4>
                                    <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/10 rounded-xl p-4 space-y-2 text-xs">
                                        <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                                            <span>Cantidad de avances:</span>
                                            <strong className="font-bold text-slate-800 dark:text-white">{todayAdvances.length} servicios</strong>
                                        </div>
                                        {totalAdvancesEfectivoBs > 0 && (
                                            <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                                                <span>Efectivo Bs retirado de caja:</span>
                                                <strong className="font-bold text-red-600 dark:text-red-400">-{formatBs(totalAdvancesEfectivoBs)} Bs</strong>
                                            </div>
                                        )}
                                        {totalAdvancesEfectivoUsd > 0 && (
                                            <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                                                <span>Efectivo USD retirado de caja:</span>
                                                <strong className="font-bold text-red-600 dark:text-red-400">-${totalAdvancesEfectivoUsd.toFixed(2)}</strong>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center border-t border-slate-200/50 dark:border-slate-700/50 pt-2 text-sm text-emerald-600 dark:text-emerald-450">
                                            <span className="font-bold">Comisiones Ganadas:</span>
                                            <strong className="font-black">
                                                {totalAdvancesComisionBs > 0 && `${formatBs(totalAdvancesComisionBs)} Bs`}
                                                {totalAdvancesComisionBs > 0 && totalAdvancesComisionUsd > 0 && ' + '}
                                                {totalAdvancesComisionUsd > 0 && `$${totalAdvancesComisionUsd.toFixed(2)}`}
                                                {totalAdvancesComisionBs === 0 && totalAdvancesComisionUsd === 0 && '0'}
                                            </strong>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* CTA */}
                            <button
                                onClick={() => setStep(2)}
                                className="w-full py-4 bg-brand hover:bg-brand-dark text-white font-bold rounded-2xl shadow-lg shadow-primary/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-sm"
                            >
                                Continuar al Conteo <ArrowRight size={18} />
                            </button>
                        </div>
                    )}

                    {/* ═══ STEP 2: Conteo Fisico ═══ */}
                    {step === 2 && (
                        <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center py-2">
                                <div className="w-16 h-16 bg-brand-light dark:bg-surface-800/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                                    <Wallet size={32} className="text-brand" />
                                </div>
                                <h3 className="text-lg font-black text-slate-800 dark:text-white">Conteo Fisico</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed max-w-[280px] mx-auto">
                                    Cuenta el efectivo fisico que tienes en la gaveta en este momento
                                </p>
                            </div>

                            {/* USD Input */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1.5 block">Efectivo en dolares (USD)</label>
                                <div className="relative flex items-center">
                                    <DollarSign size={18} className="absolute left-4 text-slate-400" />
                                    <input
                                        type="number"
                                        step="any"
                                        inputMode="decimal"
                                        value={actualUsd}
                                        onChange={e => setActualUsd(e.target.value)}
                                        placeholder="0.00"
                                        autoFocus
                                        className="w-full bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-700 rounded-2xl py-4 pl-12 pr-4 text-xl text-slate-800 dark:text-white font-black outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-mono"
                                    />
                                </div>
                                <p className="text-[11px] text-slate-400 mt-1.5 pl-1">
                                    Sistema espera: <span className="font-bold text-brand">${expectedUsd.toFixed(2)}</span>
                                </p>
                            </div>

                            {/* Bs Input */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1.5 block">Efectivo en bolivares (Bs)</label>
                                <div className="relative flex items-center">
                                    <span className="absolute left-4 font-bold text-slate-400 text-sm">Bs</span>
                                    <input
                                        type="number"
                                        step="any"
                                        inputMode="decimal"
                                        value={actualBs}
                                        onChange={e => setActualBs(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-700 rounded-2xl py-4 pl-12 pr-4 text-xl text-slate-800 dark:text-white font-black outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-mono"
                                    />
                                </div>
                                <p className="text-[11px] mt-1.5 pl-1">
                                    {
                                        expectedBs < 0
                                            ? <span className="font-bold text-amber-500">⚠ La gaveta usó Bs {formatBs(Math.abs(expectedBs))} extra para dar cambio</span>
                                            : <span className="text-slate-400">Sistema espera: <span className="font-bold text-brand">{formatBs(expectedBs)} Bs</span></span>
                                    }
                                </p>
                            </div>

                            {/* COP Input — only visible if COP transactions exist */}
                            {hasCopTransactions && (
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1.5 block">Efectivo en pesos (COP)</label>
                                    <div className="relative flex items-center">
                                        <Coins size={18} className="absolute left-4 text-amber-500" />
                                        <input
                                            type="number"
                                            step="any"
                                            inputMode="decimal"
                                            value={actualCop}
                                            onChange={e => setActualCop(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-slate-50 dark:bg-slate-950 border-2 border-amber-200 dark:border-amber-800/50 rounded-2xl py-4 pl-12 pr-4 text-xl text-slate-800 dark:text-white font-black outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all font-mono"
                                        />
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-1.5 pl-1">
                                        Sistema espera: <span className="font-bold text-amber-500">{fmtCop(expectedCop)} COP</span>
                                    </p>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setStep(1)} className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
                                    Atras
                                </button>
                                <button
                                    onClick={() => setStep(3)}
                                    className="flex-1 py-3.5 text-sm font-bold text-white bg-brand hover:bg-brand-dark rounded-xl shadow-lg shadow-primary/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                >
                                    Calcular <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP 3: Resultado ═══ */}
                    {step === 3 && (() => {
                        const sem = getSemaforo();
                        const SemIcon = sem.icon;
                        return (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                                {/* Semaforo */}
                                <div className={`${sem.bg} rounded-2xl p-5 text-white text-center relative overflow-hidden`}>
                                    <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
                                    <SemIcon size={40} className="mx-auto mb-2" />
                                    <h3 className="text-xl font-black">{sem.label}</h3>
                                    <p className="text-sm font-medium text-white/80 mt-1">
                                        Diferencia: {diffUsd >= 0 ? '+' : ''}{diffUsd.toFixed(2)} USD
                                    </p>
                                </div>

                                {/* Tabla comparativa */}
                                <div>
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 pl-1">Comparativa</h4>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50 overflow-hidden">
                                        {/* Header */}
                                        <div className="grid grid-cols-3 gap-0 px-4 py-2.5 bg-slate-100 dark:bg-slate-700/50">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase"></span>
                                            <span className="text-[10px] font-bold text-slate-500 uppercase text-center">Esperado</span>
                                            <span className="text-[10px] font-bold text-slate-500 uppercase text-center">Declarado</span>
                                        </div>
                                        {/* USD Row */}
                                        <div className="grid grid-cols-3 gap-0 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
                                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">USD</span>
                                            <span className="text-sm font-mono font-bold text-slate-500 text-center">${expectedUsd.toFixed(2)}</span>
                                            <span className={`text-sm font-mono font-black text-center ${absDiffUsd <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_USD ? 'text-emerald-600' : absDiffUsd > FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_USD * 5 ? 'text-red-500' : 'text-amber-600'}`}>
                                                ${declaredUsd.toFixed(2)}
                                            </span>
                                        </div>
                                        {/* Bs Row */}
                                        <div className={`grid grid-cols-3 gap-0 px-4 py-3 ${hasCopTransactions ? 'border-b border-slate-100 dark:border-slate-700/50' : 'border-b border-slate-100 dark:border-slate-700/50'}`}>
                                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Bs</span>
                                            <span className="text-sm font-mono font-bold text-slate-500 text-center">{formatBs(expectedBs)}</span>
                                            <span className={`text-sm font-mono font-black text-center ${absDiffBs <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS ? 'text-emerald-600' : absDiffBs > FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS * 5 ? 'text-red-500' : 'text-amber-600'}`}>
                                                {formatBs(declaredBs)}
                                            </span>
                                        </div>
                                        {/* COP Row */}
                                        {hasCopTransactions && (
                                            <div className="grid grid-cols-3 gap-0 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
                                                <span className="text-sm font-bold text-amber-600 dark:text-amber-400">COP</span>
                                                <span className="text-sm font-mono font-bold text-slate-500 text-center">{fmtCop(expectedCop)}</span>
                                                <span className={`text-sm font-mono font-black text-center ${absDiffCop <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_COP ? 'text-emerald-600' : absDiffCop > FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_COP * 5 ? 'text-red-500' : 'text-amber-600'}`}>
                                                    {fmtCop(declaredCop)}
                                                </span>
                                            </div>
                                        )}
                                        {/* Diff Row */}
                                        <div className="grid grid-cols-3 gap-0 px-4 py-3 bg-slate-100/50 dark:bg-slate-700/30">
                                            <span className="text-xs font-bold text-slate-500 uppercase">Diferencia</span>
                                            <span className={`text-sm font-mono font-black text-center ${diffUsd >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {diffUsd >= 0 ? '+' : ''}${diffUsd.toFixed(2)}
                                            </span>
                                            <span className={`text-sm font-mono font-black text-center ${diffBs >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {diffBs >= 0 ? '+' : ''}{formatBs(diffBs)}
                                            </span>
                                        </div>
                                        {hasCopTransactions && (
                                            <div className="grid grid-cols-3 gap-0 px-4 py-2 bg-amber-50/50 dark:bg-amber-900/10">
                                                <span className="text-xs font-bold text-amber-500 uppercase">Dif. COP</span>
                                                <span></span>
                                                <span className={`text-sm font-mono font-black text-center ${diffCop >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                    {diffCop >= 0 ? '+' : ''}{fmtCop(diffCop)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => setStep(2)} className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
                                        Revisar
                                    </button>
                                    <button
                                        onClick={handleConfirm}
                                        className={`flex-1 py-3.5 text-sm font-bold text-white ${sem.bg} hover:brightness-110 rounded-xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2`}
                                    >
                                        <CheckCircle2 size={18} /> Confirmar Cierre
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
