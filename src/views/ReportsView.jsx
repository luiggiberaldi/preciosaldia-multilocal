import { useState, useEffect, useMemo } from 'react';
// v1.2.0: useReveal hook para animaciones reveal-on-scroll (design system "Precios al Día")
import { useReveal } from '../hooks/useReveal';
import { BarChart3, Download, LockIcon, Recycle, TrendingDown } from 'lucide-react';
import { storageService } from '../utils/storageService';
import { formatBs } from '../utils/calculatorUtils';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import ConfirmModal from '../components/ConfirmModal';
import { getLocalISODate, getDateRange } from '../utils/dateHelpers';
import { calculateReportsData, groupSalesByCierreId } from '../utils/reportsProcessor';
import { processVoidSale } from '../utils/voidSaleProcessor';
import { CUSTOMER_LEDGER_KEY, rebuildCustomersFromLedger } from '../utils/customerLedger';
import { reconcileCustomersWithLedger } from '../utils/pocketReconciliation';
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import ReconciliationNotice from '../components/Reports/ReconciliationNotice';
import { useReportExport } from '../hooks/useReportExport';
import ReportsMetricsTab from '../components/Reports/ReportsMetricsTab';
import ReportsHistoryTab from '../components/Reports/ReportsHistoryTab';
import ReportsExpensesTab from '../components/Reports/ReportsExpensesTab';
import { printThermalTicket } from '../utils/ticketGenerator';

const SALES_KEY = 'bodega_sales_v1';

const RANGE_OPTIONS = [
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: 'week', label: 'Esta Semana' },
    { id: 'month', label: 'Este Mes' },
    { id: 'lastMonth', label: 'Mes Anterior' },
    { id: 'custom', label: 'Personalizado' },
];

export default function ReportsView({ rates, triggerHaptic, onNavigate, isActive }) {
    // v1.2.0: reveal-on-scroll para header, tabs, y secciones principales.
    const revealRef = useReveal();
    const { products, setProducts, effectiveRate: bcvRate, copEnabled, copPrimary, tasaCop } = useProductContext();
    const { loadCart } = useCart();
    const [allSales, setAllSales] = useState([]);
    // FIA-REPORT-001: la cartera de clientes permite mostrar «Cartera al cierre»
    // (stock acumulado) sin confundirla con el flujo del período.
    const [customers, setCustomers] = useState([]);
    // FIA-REPORT-001 (H5): el ledger de movimientos es la tercera fuente de verdad.
    const [ledger, setLedger] = useState([]);
    const [isRepairingLedger, setIsRepairingLedger] = useState(false);
    const [activeTab, setActiveTab] = useState('metrics');
    const [selectedRange, setSelectedRange] = useState('week');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [showHistory, setShowHistory] = useState(false);
    const [expandedSaleId, setExpandedSaleId] = useState(null);
    const [visibleCount, setVisibleCount] = useState(30);
    const [historySearch, setHistorySearch] = useState('');
    const [historyFilter, setHistoryFilter] = useState('all'); // all, completed, voided
    const [voidSaleTarget, setVoidSaleTarget] = useState(null);
    const [recycleOffer, setRecycleOffer] = useState(null);

    const { handleExportPDF } = useReportExport({ triggerHaptic });

    // ── Void Sale Handler ──
    const confirmVoidSale = async () => {
        const sale = voidSaleTarget;
        if (!sale) return;
        setVoidSaleTarget(null);
        try {
            const { updatedSales, updatedProducts } = await processVoidSale(sale, allSales, products);
            setProducts(updatedProducts);
            setAllSales(updatedSales);
            setRecycleOffer(sale);
        } catch (error) {
            console.error('Error anulando venta:', error);
        }
    };

    useEffect(() => {
        if (isActive === false) return; // Si es explicitamente false, abortamos
        let mounted = true;
        const load = async () => {
            const [saved, savedCustomers, savedLedger] = await Promise.all([
                storageService.getItem(SALES_KEY, []),
                storageService.getItem('bodega_customers_v1', []),
                storageService.getItem(CUSTOMER_LEDGER_KEY, []),
            ]);
            if (mounted) {
                setAllSales(saved);
                setCustomers(Array.isArray(savedCustomers) ? savedCustomers : []);
                setLedger(Array.isArray(savedLedger) ? savedLedger : []);
                setIsLoading(false);
            }
        };
        load();
        return () => { mounted = false; };
    }, [isActive]);

    const { from, to } = useMemo(() => {
        if (selectedRange === 'custom') {
            return {
                from: customFrom || getLocalISODate(new Date()),
                to: customTo || getLocalISODate(new Date()),
            };
        }
        return getDateRange(selectedRange);
    }, [selectedRange, customFrom, customTo]);

    const {
        salesForStats,
        salesForCashFlow,
        historySales,
        totalUsd,
        totalBs,
        totalCop,
        totalItems,
        profit,
        paymentBreakdown,
        receivables,
        receivablePayments,
        carteraUsd,
        topProducts,
        salesByDay,
        expensesList,
        expensesUsd,
        expensesBs
    } = useMemo(
        () => calculateReportsData(allSales, from, to, bcvRate, products, customers),
        [allSales, from, to, bcvRate, products, customers]
    );

    const groupedClosings = useMemo(() => {
        if (activeTab === 'history') {
            return groupSalesByCierreId(allSales, from, to);
        }
        return [];
    }, [allSales, from, to, activeTab]);

    const maxDayTotal = Math.max(...salesByDay.map(d => d.total), 1);

    // ── FIA-REPORT-001 (H5): la cartera guardada vs el ledger de movimientos ──
    const reconciliation = useMemo(
        () => reconcileCustomersWithLedger(customers, ledger),
        [customers, ledger]
    );
    // El botón de reparación está apagado por defecto: es una escritura sobre
    // cartera, así que exige (1) activarlo en Configuración y (2) rol no-cajero.
    const canRepairLedger = useMemo(() => {
        if (typeof localStorage === 'undefined') return false;
        if (localStorage.getItem('reportes_reparacion_ledger') !== 'true') return false;
        const rol = useAuthStore.getState().usuarioActivo?.rol;
        return rol !== 'CAJERO';
    }, []);

    const handleRepairLedger = async () => {
        setIsRepairingLedger(true);
        try {
            // Solo reescribe el snapshot de cada cliente con el último saldo del
            // ledger. NO borra ni modifica movimientos.
            const rebuilt = rebuildCustomersFromLedger(customers, ledger);
            await storageService.setItem('bodega_customers_v1', rebuilt);
            setCustomers(rebuilt);
            logEvent(
                'CONFIG',
                'LEDGER_RECONCILED',
                `Cartera reconstruida desde el ledger (${reconciliation.drift.length} clientes)`,
                useAuthStore.getState().usuarioActivo
            );
        } catch (error) {
            console.error('Error reconstruyendo cartera desde el ledger:', error);
        } finally {
            setIsRepairingLedger(false);
        }
    };

    const onExportPDF = () => {
        handleExportPDF({
            salesForCashFlow,
            salesForStats,
            bcvRate,
            paymentBreakdown,
            topProducts,
            totalUsd,
            totalBs,
            profit,
            totalItems,
        });
    };

    const handlePrintTicket = (sale) => {
        triggerHaptic && triggerHaptic();
        printThermalTicket(sale, bcvRate);
    };

    if (isLoading) {
        return (
            <div className="flex-1 p-3 sm:p-4 md:p-6 space-y-4">
                <div className="skeleton h-10 w-32" />
                <div className="flex gap-2">
                    <div className="skeleton h-9 w-20" />
                    <div className="skeleton h-9 w-24" />
                    <div className="skeleton h-9 w-20" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="skeleton h-24" />
                    <div className="skeleton h-24" />
                    <div className="skeleton h-24" />
                    <div className="skeleton h-24" />
                </div>
                <div className="skeleton h-40" />
            </div>
        );
    }

    return (
        // v1.2.0: revealRef en contenedor raíz + bg-surface-50 (warm cream).
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-4 md:space-y-5 pb-32">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h2 className="display text-2xl md:text-3xl text-slate-800 dark:text-white flex items-center gap-2">
                    <div className="bg-brand text-white p-1.5 md:p-2 rounded-xl shadow-primary-tone">
                        <BarChart3 size={20} aria-hidden="true" />
                    </div>
                    Reportes
                </h2>
                <button
                    onClick={onExportPDF}
                    disabled={salesForStats.length === 0 && salesForCashFlow.length === 0}
                    className="flex items-center gap-2 px-4 py-2.5 min-h-[48px] bg-brand hover:bg-brand-dark disabled:bg-slate-300 dark:disabled:bg-surface-700 text-white font-bold rounded-xl text-sm shadow-primary-tone active:scale-95 transition-all"
                >
                    <Download size={16} aria-hidden="true" /> Descargar PDF
                </button>
            </div>

            {/* Tab Selector — 4 tabs */}
            <div className="flex bg-slate-200 dark:bg-surface-800 p-1 rounded-xl gap-1">
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setActiveTab('metrics'); }}
                    className={`flex-1 py-2.5 min-h-[40px] text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${activeTab === 'metrics' ? 'bg-white dark:bg-surface-900 text-brand-dark dark:text-brand shadow-tone-sm' : 'text-slate-600 hover:text-slate-800 dark:text-surface-400'}`}
                >
                    <BarChart3 size={14} aria-hidden="true"/> Métricas
                </button>
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setActiveTab('sales_history'); }}
                    className={`flex-1 py-2.5 min-h-[40px] text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${activeTab === 'sales_history' ? 'bg-white dark:bg-surface-900 text-brand-dark dark:text-brand shadow-tone-sm' : 'text-slate-600 hover:text-slate-800 dark:text-surface-400'}`}
                >
                    <Download size={14} aria-hidden="true"/> Ventas
                </button>
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setActiveTab('expenses'); }}
                    className={`flex-1 py-2.5 min-h-[40px] text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${activeTab === 'expenses' ? 'bg-white dark:bg-surface-900 text-brand-dark dark:text-brand shadow-tone-sm' : 'text-slate-600 hover:text-slate-800 dark:text-surface-400'}`}
                >
                    <TrendingDown size={14} aria-hidden="true"/> Gastos
                </button>
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setActiveTab('history'); }}
                    className={`flex-1 py-2.5 min-h-[40px] text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${activeTab === 'history' ? 'bg-white dark:bg-surface-900 text-brand-dark dark:text-brand shadow-tone-sm' : 'text-slate-600 hover:text-slate-800 dark:text-surface-400'}`}
                >
                    <LockIcon size={14} aria-hidden="true"/> Cierres
                </button>
            </div>

            {/* Range Selector */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                {RANGE_OPTIONS.map(opt => (
                    <button
                        key={opt.id}
                        onClick={() => { triggerHaptic && triggerHaptic(); setSelectedRange(opt.id); }}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-sm font-bold whitespace-nowrap transition-colors active:scale-95 ${
                            selectedRange === opt.id
                                ? 'bg-brand text-white shadow-primary-tone'
                                : 'bg-white dark:bg-surface-900 text-slate-700 dark:text-surface-400 border border-slate-300 dark:border-surface-800'
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* Custom Date Range */}
            {/* v1.2.0: surface tokens + border-surface-300 (warm border). */}
            {selectedRange === 'custom' && (
                <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-surface-900 rounded-2xl p-4 border border-slate-200 dark:border-surface-800">
                    <div className="flex-1">
                        <label className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase mb-1 block">Desde</label>
                        <input
                            type="date"
                            value={customFrom}
                            onChange={e => setCustomFrom(e.target.value)}
                            className="input w-full bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl text-sm font-bold text-surface-700 dark:text-white focus:ring-2 focus:ring-brand/30"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase mb-1 block">Hasta</label>
                        <input
                            type="date"
                            value={customTo}
                            onChange={e => setCustomTo(e.target.value)}
                            className="input w-full bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl text-sm font-bold text-surface-700 dark:text-white focus:ring-2 focus:ring-brand/30"
                        />
                    </div>
                </div>
            )}

            <ReconciliationNotice
                reconciliation={reconciliation}
                canRepair={canRepairLedger}
                onRepair={handleRepairLedger}
                isRepairing={isRepairingLedger}
            />

            {activeTab === 'metrics' && (
                <ReportsMetricsTab
                    salesForStats={salesForStats}
                    salesForCashFlow={salesForCashFlow}
                    historySales={historySales}
                    totalUsd={totalUsd}
                    totalBs={totalBs}
                    totalCop={totalCop}
                    totalItems={totalItems}
                    profit={profit}
                    paymentBreakdown={paymentBreakdown}
                    receivables={receivables}
                    receivablePayments={receivablePayments}
                    carteraUsd={carteraUsd}
                    topProducts={topProducts}
                    salesByDay={salesByDay}
                    maxDayTotal={maxDayTotal}
                    expensesList={expensesList}
                    expensesUsd={expensesUsd}
                    expensesBs={expensesBs}
                    bcvRate={bcvRate}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                    triggerHaptic={triggerHaptic}
                    expandedSaleId={expandedSaleId}
                    setExpandedSaleId={setExpandedSaleId}
                    showHistory={false}
                    setShowHistory={setShowHistory}
                    visibleCount={visibleCount}
                    setVisibleCount={setVisibleCount}
                    historySearch={historySearch}
                    setHistorySearch={setHistorySearch}
                    historyFilter={historyFilter}
                    setHistoryFilter={setHistoryFilter}
                    setVoidSaleTarget={setVoidSaleTarget}
                    setRecycleOffer={setRecycleOffer}
                    hideHistory={true}
                    onPrintTicket={handlePrintTicket}
                />
            )}

            {activeTab === 'sales_history' && (
                <ReportsMetricsTab
                    salesForStats={salesForStats}
                    salesForCashFlow={salesForCashFlow}
                    historySales={historySales}
                    totalUsd={totalUsd}
                    totalBs={totalBs}
                    totalCop={totalCop}
                    totalItems={totalItems}
                    profit={profit}
                    paymentBreakdown={paymentBreakdown}
                    receivables={receivables}
                    receivablePayments={receivablePayments}
                    carteraUsd={carteraUsd}
                    topProducts={topProducts}
                    salesByDay={salesByDay}
                    maxDayTotal={maxDayTotal}
                    expensesList={expensesList}
                    expensesUsd={expensesUsd}
                    expensesBs={expensesBs}
                    bcvRate={bcvRate}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                    triggerHaptic={triggerHaptic}
                    expandedSaleId={expandedSaleId}
                    setExpandedSaleId={setExpandedSaleId}
                    showHistory={true}
                    setShowHistory={setShowHistory}
                    visibleCount={visibleCount}
                    setVisibleCount={setVisibleCount}
                    historySearch={historySearch}
                    setHistorySearch={setHistorySearch}
                    historyFilter={historyFilter}
                    setHistoryFilter={setHistoryFilter}
                    setVoidSaleTarget={setVoidSaleTarget}
                    setRecycleOffer={setRecycleOffer}
                    hideHistory={false}
                    onlyHistory={true}
                    onPrintTicket={handlePrintTicket}
                />
            )}

            {activeTab === 'expenses' && (
                <ReportsExpensesTab
                    expensesList={expensesList}
                    expensesUsd={expensesUsd}
                    expensesBs={expensesBs}
                    bcvRate={bcvRate}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                />
            )}

            {activeTab === 'history' && (
                <ReportsHistoryTab
                    groupedClosings={groupedClosings}
                    bcvRate={bcvRate}
                    products={products}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                />
            )}

            {/* Recycle Offer Modal */}
            {recycleOffer && (
                // v1.2.0: surface tokens + accent en botón Reciclar (text-accent / bg-accent).
                <div className="fixed inset-0 z-[100] bg-surface-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
                    onClick={() => setRecycleOffer(null)}>
                    <div className="bg-surface dark:bg-surface-900 w-full sm:max-w-xs sm:rounded-2xl rounded-t-[2rem] p-5 shadow-tone-lg animate-in slide-in-from-bottom-4 duration-200"
                        onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-center gap-2 mb-4">
                            <div className="w-12 h-12 bg-brand-light dark:bg-surface-800/30 rounded-full flex items-center justify-center text-accent">
                                <Recycle size={28} aria-hidden="true" />
                            </div>
                            <h3 className="text-sm font-black text-surface-700 dark:text-white">Venta Anulada</h3>
                            <p className="text-[11px] text-surface-500 dark:text-surface-400 text-center">Puedes reciclar los productos de esta venta al carrito actual.</p>
                        </div>
                        <div className="flex gap-2">
                            {/* v1.2.0: touch targets ≥ 48px */}
                            <button
                                onClick={() => setRecycleOffer(null)}
                                className="flex-1 py-2.5 min-h-[48px] flex items-center justify-center text-xs font-bold text-surface-500 bg-surface-100 dark:bg-surface-800 rounded-xl transition-all active:scale-95"
                            >Cerrar</button>
                            <button
                                onClick={() => {
                                    loadCart(recycleOffer.items);
                                    setRecycleOffer(null);
                                    if (onNavigate) onNavigate('ventas');
                                }}
                                className="flex-1 py-2.5 min-h-[48px] flex items-center justify-center text-xs font-bold text-white bg-brand-dark rounded-xl shadow-primary-tone transition-all active:scale-95 gap-1.5"
                            ><Recycle size={16} aria-hidden="true" /> Reciclar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Void Modal */}
            <ConfirmModal
                isOpen={!!voidSaleTarget}
                onClose={() => setVoidSaleTarget(null)}
                onConfirm={confirmVoidSale}
                title={`Anular venta #${voidSaleTarget?.id?.substring(0, 6).toUpperCase() || ''}`}
                message={'Esta accion:\n- Marcara la venta como ANULADA\n- Devolvera el stock a la bodega\n- Revertira deudas o saldos a favor\n\nEsta accion no se puede deshacer.'}
                confirmText="Si, anular"
            />
        </div>
    );
}
