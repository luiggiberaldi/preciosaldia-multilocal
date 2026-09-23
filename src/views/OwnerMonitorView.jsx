import React, { useState, useEffect, useMemo } from 'react';
import { useProductContext } from '../context/ProductContext';
import { useMonitorSync } from '../hooks/useMonitorSync';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { 
    TrendingUp, Package, Coins, Users, LogOut, Download,
    RefreshCw, Wifi, WifiOff, Clock, FileText, DollarSign,
    Wallet, CreditCard, Smartphone, Banknote, ArrowDownRight,
    ShieldCheck, Hash, AlertTriangle, Search, X, ChevronLeft, ChevronRight,
    Plus, Pencil, Trash2
} from 'lucide-react';
import { formatBs, formatCop } from '../utils/calculatorUtils';
import { getLocalISODate, getDateRange } from '../utils/dateHelpers';
import { toTitleCase } from '../config/paymentMethods';
import SupervisorRateModal from '../components/Monitor/SupervisorRateModal';
import RemoteProductFormModal from '../components/Monitor/RemoteProductFormModal';
import SupervisorInventoryBatchModal from '../components/Monitor/SupervisorInventoryBatchModal';
import RemoteUsersManager from '../components/Monitor/RemoteUsersManager';
import SupervisorSelect from '../components/Monitor/SupervisorSelect';
import {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_INCOME_ENABLED,
} from '../config/supervisorPolicy';
import { calculateInventoryMetrics, calculateSalesProfit } from '../services/supervisorMetrics';
import { buildSupervisorRegisterCloses, calculateSupervisorPaymentBreakdown } from '../services/supervisorFinancials';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { SUPERVISOR_SYNC_STATES } from '../services/supervisorSyncService';
import { sendSupervisorCommand } from '../services/supervisorCommandService';
import {
    calculateSupervisorCashSummary,
    buildSupervisorExpenseReport,
    buildSupervisorInventoryMovements,
    filterSupervisorInventoryMovements,
    buildSupervisorProductReport,
    buildSupervisorCloseCashSummary,
    filterSupervisorRecords,
    shouldShowSupervisorCop,
} from '../services/supervisorReportData';

// Helper: icon por método de pago
const PAYMENT_METHOD_ICONS = {
    efectivo_bs: Banknote,
    pago_movil: Smartphone,
    punto_venta: CreditCard,
    efectivo_usd: DollarSign,
    efectivo_cop: Coins,
    transferencia_cop: CreditCard,
    fiado: Clock,
    cashea: Clock,
};

function getMethodIcon(methodId) {
    return PAYMENT_METHOD_ICONS[methodId] || Wallet;
}

export default function OwnerMonitorView({ theme, toggleTheme, triggerHaptic, rates }) {
    const pairedDeviceId = localStorage.getItem('pda_paired_device_id');
    const { products, effectiveRate: bcvRate, copEnabled, tasaCop } = useProductContext();
    const {
        isConnected,
        lastSync,
        loading: syncLoading,
        syncState,
        syncError,
        triggerRefresh,
    } = useMonitorSync(pairedDeviceId);
    const remoteActionsAvailable = Boolean(isConnected && pairedDeviceId);

    const [sales, setSales] = useState([]);
    const [activeCashier, setActiveCashier] = useState({ nombre: 'Ninguno', rol: '' });
    const [loadingData, setLoadingData] = useState(true);
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
    const [viewTab, setViewTab] = useState('activo'); // 'activo' o 'cierres'
    const [selectedCierreId, setSelectedCierreId] = useState(null);
    const [searchTermInventario, setSearchTermInventario] = useState('');
    const [filterStockInventario, setFilterStockInventario] = useState('todos'); // 'todos', 'bajo', 'agotado'
    const [showRateModal, setShowRateModal] = useState(false);
    const [showProductFormModal, setShowProductFormModal] = useState(false);
    const [productToEditRemote, setProductToEditRemote] = useState(null);
    const [inventoryBatchProduct, setInventoryBatchProduct] = useState(null);
    const [cierresDateRange, setCierresDateRange] = useState('all'); // 'all', 'today', 'yesterday', 'week', 'month'
    const [shiftActionConfirmModal, setShiftActionConfirmModal] = useState(null); // 'close' | 'reopen' | null
    const [sendingShiftAction, setSendingShiftAction] = useState(false);
    const [reportsDateRange, setReportsDateRange] = useState('all');
    const [reportsFrom, setReportsFrom] = useState(getLocalISODate());
    const [reportsTo, setReportsTo] = useState(getLocalISODate());
    const [reportsCierreId, setReportsCierreId] = useState('all');
    const [reportsProductId, setReportsProductId] = useState('all');
    const [inventoryMovementFilter, setInventoryMovementFilter] = useState('todos');
    const [inventoryMovementSearch, setInventoryMovementSearch] = useState('');

    const filteredProducts = useMemo(() => {
        if (!products) return [];
        return products.filter(p => {
            const matchesSearch = (p.name || '').toLowerCase().includes(searchTermInventario.toLowerCase()) || 
                                 (p.barcode && p.barcode.includes(searchTermInventario));
            
            if (!matchesSearch) return false;
            
            if (filterStockInventario === 'bajo') {
                return p.stock > 0 && p.stock <= (p.minStock || 5);
            }
            if (filterStockInventario === 'agotado') {
                return p.stock <= 0;
            }
            return true;
        });
    }, [products, searchTermInventario, filterStockInventario]);

    const [currentPageInventario, setCurrentPageInventario] = useState(1);
    const ITEMS_PER_PAGE_INVENTARIO = 15;

    useEffect(() => {
        setCurrentPageInventario(1);
    }, [searchTermInventario, filterStockInventario]);

    const totalPagesInventario = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE_INVENTARIO);

    const paginatedProducts = useMemo(() => {
        const start = (currentPageInventario - 1) * ITEMS_PER_PAGE_INVENTARIO;
        return filteredProducts.slice(start, start + ITEMS_PER_PAGE_INVENTARIO);
    }, [filteredProducts, currentPageInventario]);

    const inventoryMetrics = useMemo(() => calculateInventoryMetrics(products), [products]);
    const shouldShowCop = shouldShowSupervisorCop(copEnabled);
    const allProductSales = useMemo(() => buildSupervisorProductReport(sales), [sales]);
    const reportProductOptions = useMemo(() => {
        const byId = new Map();
        for (const product of products || []) {
            if (product?.id == null) continue;
            byId.set(String(product.id), product.name || 'Producto sin nombre');
        }
        for (const sale of allProductSales) {
            if (!byId.has(String(sale.productId))) byId.set(String(sale.productId), sale.productName);
        }
        return [
            { value: 'all', label: 'Todos los productos' },
            ...[...byId.entries()]
                .sort((left, right) => left[1].localeCompare(right[1], 'es'))
                .map(([value, label]) => ({ value, label })),
        ];
    }, [products, allProductSales]);
    const reportRecords = useMemo(() => filterSupervisorRecords(sales, {
        range: reportsDateRange,
        from: reportsFrom,
        to: reportsTo,
        cierreId: reportsCierreId,
    }), [sales, reportsDateRange, reportsFrom, reportsTo, reportsCierreId]);
    const supervisorReportData = useMemo(() => ({
        cash: calculateSupervisorCashSummary(reportRecords, bcvRate),
        inventoryMovements: buildSupervisorInventoryMovements(reportRecords),
        productsSold: buildSupervisorProductReport(reportRecords),
        expenses: buildSupervisorExpenseReport(reportRecords),
    }), [reportRecords, bcvRate]);
    const visibleProductSales = useMemo(() => (
        reportsProductId === 'all'
            ? supervisorReportData.productsSold
            : supervisorReportData.productsSold.filter(product => String(product.productId) === String(reportsProductId))
    ), [reportsProductId, supervisorReportData.productsSold]);
    const selectedProductName = reportProductOptions.find(option => option.value === reportsProductId)?.label || 'Producto seleccionado';
    const visibleInventoryMovements = useMemo(() => filterSupervisorInventoryMovements(
        supervisorReportData.inventoryMovements,
        { direction: inventoryMovementFilter, search: inventoryMovementSearch }
    ), [supervisorReportData.inventoryMovements, inventoryMovementFilter, inventoryMovementSearch]);

    const today = getLocalISODate();

    // 1. Cargar datos locales (que son actualizados por useMonitorSync)
    const loadLocalData = async () => {
        try {
            const [savedSales, savedAuth] = await Promise.all([
                storageService.getItem('bodega_sales_v1', []),
                storageService.getItem('abasto-auth-storage', null)
            ]);

            setSales(savedSales);
            
            if (savedAuth && savedAuth.state && savedAuth.state.usuarioActivo) {
                setActiveCashier({
                    nombre: savedAuth.state.usuarioActivo.nombre || 'Cajero',
                    rol: savedAuth.state.usuarioActivo.rol || 'CAJERO'
                });
            } else {
                setActiveCashier({ nombre: 'Ninguno', rol: '' });
            }
        } catch (e) {
            console.error('[OwnerMonitorView] Error cargando datos locales:', e);
        } finally {
            setLoadingData(false);
        }
    };

    useEffect(() => {
        loadLocalData();

        // Escuchar actualizaciones del almacenamiento causadas por la sincronización en tiempo real
        const handleUpdate = () => {
            loadLocalData();
        };

        window.addEventListener('app_storage_update', handleUpdate);
        window.addEventListener('storage', handleUpdate);
        return () => {
            window.removeEventListener('app_storage_update', handleUpdate);
            window.removeEventListener('storage', handleUpdate);
        };
    }, []);

    // ── TURNO ACTIVO ──
    
    // Apertura de caja del turno activo
    const activeShiftApertura = useMemo(() => {
        const aperturas = sales.filter(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
        if (aperturas.length === 0) return null;
        return aperturas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    }, [sales]);

    // Filtrar ventas del turno activo (cajaCerrada !== true)
    const activeShiftSales = useMemo(() => {
        return sales.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            if (s.cajaCerrada) return false;
            
            // Restringir a transacciones posteriores a la última apertura activa si existe
            if (activeShiftApertura) {
                return new Date(s.timestamp) >= new Date(activeShiftApertura.timestamp);
            }
            return true;
        });
    }, [sales, activeShiftApertura]);

    // Métricas del turno activo
    const activeShiftMetrics = useMemo(() => {
        const metrics = calculateSalesProfit(activeShiftSales, products, bcvRate);
        return {
            totalUsd: metrics.revenueUsd,
            totalBs: metrics.revenueBs,
            profitUsd: metrics.profitUsd,
            count: metrics.count,
        };
    }, [activeShiftSales, products, bcvRate]);

    // El desglose del monitor usa el mismo contrato de pagos que la caja.
    const activeShiftPaymentBreakdown = useMemo(() => {
        const activeFlow = sales.filter(sale => {
            if (sale.status === 'ANULADA' || sale.cajaCerrada) return false;
            return !activeShiftApertura || new Date(sale.timestamp) >= new Date(activeShiftApertura.timestamp);
        });
        return calculateSupervisorPaymentBreakdown(activeFlow, bcvRate);
    }, [sales, activeShiftApertura, bcvRate]);

    // Ticket promedio del turno activo
    const activeShiftAvgTicket = useMemo(() => {
        if (activeShiftSales.length === 0) return 0;
        return activeShiftMetrics.totalUsd / activeShiftSales.length;
    }, [activeShiftMetrics.totalUsd, activeShiftSales.length]);


    // ── HISTORIAL DE CIERRES DE CAJA ──

    // El monitor consume el mismo normalizador y FinancialEngine que la caja.
    const registerCloses = useMemo(
        () => buildSupervisorRegisterCloses(sales, products, bcvRate),
        [sales, products, bcvRate]
    );

    const selectedReportClose = useMemo(() => {
        if (reportsCierreId === 'all') return null;
        return registerCloses.find(close => String(close.cierreId) === String(reportsCierreId)) || null;
    }, [registerCloses, reportsCierreId]);

    // Filtro de cierres por rango de fechas
    const filteredRegisterCloses = useMemo(() => {
        if (cierresDateRange === 'all') return registerCloses;
        const { from, to } = getDateRange(cierresDateRange);
        return registerCloses.filter(c => {
            const d = getLocalISODate(new Date(Number(c.cierreId)));
            return d >= from && d <= to;
        });
    }, [registerCloses, cierresDateRange]);

    // Establecer primer cierre por defecto si cambia la lista
    useEffect(() => {
        if (filteredRegisterCloses.length > 0) {
            const exists = filteredRegisterCloses.some(c => c.cierreId === selectedCierreId);
            if (!exists) {
                setSelectedCierreId(filteredRegisterCloses[0].cierreId);
            }
        } else {
            setSelectedCierreId(null);
        }
    }, [filteredRegisterCloses, selectedCierreId]);

    // Emite Broadcast para cierre o reapertura remota de turno
    const handleSendShiftActionRemote = async (action) => {
        if (!remoteActionsAvailable) {
            showToast('La caja está desconectada; no se puede enviar la orden', 'warning');
            return;
        }
        if (!SUPERVISOR_REMOTE_MUTATIONS_ENABLED) {
            showToast('Las mutaciones remotas están temporalmente deshabilitadas por seguridad', 'warning');
            return;
        }

        if (!supabaseCloud || !pairedDeviceId) {
            showToast('Dispositivo no vinculado a la nube', 'error');
            return;
        }
        const shiftId = action === 'close'
            ? (activeShiftApertura?.shiftId || activeShiftApertura?.id)
            : selectedCierreId;
        if (shiftId == null || String(shiftId).length === 0) {
            showToast(
                action === 'close' ? 'No hay un turno activo para cerrar' : 'Selecciona un cierre para reabrir',
                'error'
            );
            return;
        }
        const cierreId = action === 'close' ? String(Date.now()) : String(selectedCierreId);
        setSendingShiftAction(true);
        try {
            const result = await sendSupervisorCommand({
                type: action === 'close' ? 'supervisor.shift.close' : 'supervisor.shift.reopen',
                targetDeviceId: pairedDeviceId,
                payload: {
                    shiftId: String(shiftId),
                    cierreId,
                },
            });
            if (!result.ok) {
                showToast(result.error, result.status === 'disabled' ? 'warning' : 'error');
                return;
            }
            const ack = await result.ackPromise;
            if (!ack?.ok) {
                showToast(ack?.error || 'La caja no confirmó la acción de turno', 'error');
                return;
            }
            showToast(
                action === 'close'
                    ? '🔒 Cierre confirmado en la caja'
                    : '🔓 Reapertura confirmada en la caja',
                'success'
            );
            setShiftActionConfirmModal(null);
        } catch (e) {
            console.error('[OwnerMonitorView] Error al enviar supervisor_shift_action:', e);
            showToast('Error al enviar la solicitud', 'error');
        } finally {
            setSendingShiftAction(false);
        }
    };


    const reportRangeLabels = {
        all: 'Todos los movimientos',
        today: 'Hoy',
        yesterday: 'Ayer',
        week: 'Esta semana',
        month: 'Este mes',
        lastMonth: 'Mes anterior',
        custom: 'Personalizado',
    };

    const handleDownloadSupervisorReport = async (reportType) => {
        try {
            const { generateSupervisorReportPDF } = await import('../utils/supervisorReportGenerator');
            const closeCash = reportType === 'close' && selectedReportClose
                ? buildSupervisorCloseCashSummary(selectedReportClose, supervisorReportData.cash)
                : supervisorReportData.cash;

            await generateSupervisorReportPDF({
                reportType,
                rangeLabel: reportRangeLabels[reportsDateRange] || reportsDateRange,
                cierreId: reportsCierreId,
                records: reportRecords,
                cash: closeCash,
                productsSold: visibleProductSales,
                expenses: supervisorReportData.expenses,
                inventoryMovements: supervisorReportData.inventoryMovements,
                copEnabled: shouldShowCop,
                businessName: localStorage.getItem('business_name') || 'Mi Negocio',
            });
            showToast('PDF del Supervisor descargado', 'success');
        } catch (error) {
            console.error('[OwnerMonitorView] Error generando PDF de Supervisor:', error);
            showToast('No se pudo generar el PDF', 'error');
        }
    };

    // ── COMPONENTES GENERALES ──

    // Productos Críticos (Stock <= 0)
    const criticalProducts = useMemo(() => {
        return products
            .filter(p => p.stock <= 0)
            .slice(0, 10);
    }, [products]);

    // Desvincular Monitor
    const handleDisconnect = async () => {
        triggerHaptic?.();
        
        try {
            if (supabaseCloud && pairedDeviceId) {
                const { session, error: sessionError } = await ensureSupervisorSession();
                if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del monitor');
                const { error } = await supabaseCloud.rpc('unpair_monitor', { p_device_id: pairedDeviceId });
                if (error) throw error;
            }
        } catch (err) {
            console.warn('[OwnerMonitorView] Error al llamar unpair RPC:', err);
        }

        localStorage.removeItem('pda_paired_device_id');
        localStorage.removeItem('pda_pairing_mode');
        localStorage.removeItem('monitor_last_sync');
        localStorage.removeItem('business_name');
        localStorage.removeItem('business_rif');
        
        try {
            const { default: localforage } = await import('localforage');
            localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            await localforage.clear();
        } catch (e) {
            console.warn(e);
        }

        showToast('Dispositivo desvinculado con éxito', 'success');
        setTimeout(() => window.location.reload(), 1000);
    };

    // Formateadores
    const formatTime = (isoString) => {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
            return '';
        }
    };

    // Determinar si la caja está actualmente inactiva (sin turno abierto)
    const isShiftActive = activeShiftApertura !== null || activeShiftSales.length > 0;

    return (
        <div data-testid="supervisor-panel" className="min-h-screen w-full min-w-0 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-sans pb-12 transition-colors duration-300 overflow-x-hidden">
            {/* Header del Monitor */}
            <header
                data-testid="supervisor-header"
                style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}
                className="sticky top-0 z-50 flex flex-col items-stretch justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 pb-2.5 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 sm:flex-row sm:items-center sm:px-4 sm:py-3"
            >
                <div className="flex min-w-0 w-full items-center gap-2.5 sm:flex-1 sm:gap-3">
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-2xl shadow-lg shadow-emerald-500/20 sm:h-10 sm:w-10">
                        <img
                            src="/pwa-192x192.png"
                            alt=""
                            aria-hidden="true"
                            className="h-full w-full object-cover"
                        />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-sm sm:text-base font-black leading-tight text-slate-800 dark:text-white truncate">Panel de Supervisión</h1>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium truncate">Monitoreo en vivo • {localStorage.getItem('business_name') || 'Mi Negocio'}</p>
                    </div>
                </div>

                <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:w-auto sm:gap-3 sm:pl-3">
                    {/* Status Badge */}
                    <div data-testid="supervisor-connection-status" className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-sm transition-colors duration-300 ${
                        isConnected 
                            ? 'bg-emerald-50 border border-emerald-200/50 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-800/30 dark:text-emerald-400' 
                            : 'bg-rose-50 border border-rose-200/50 text-rose-600 dark:bg-rose-950/20 dark:border-rose-800/30 dark:text-rose-400 animate-pulse'
                    }`}>
                        {isConnected ? (
                            <>
                                <Wifi size={12} className="shrink-0" />
                                <span>{syncState === SUPERVISOR_SYNC_STATES.CONNECTED ? 'En Vivo' : 'Sincronizando'}</span>
                            </>
                        ) : (
                            <>
                                <WifiOff size={12} className="shrink-0" />
                                <span>Desconectado</span>
                            </>
                        )}
                    </div>

                    <button 
                        onClick={async () => { 
                            triggerHaptic?.();                            const result = await triggerRefresh();
                            if (result?.ok) {
                                showToast?.('Datos actualizados', 'success');
                            } else {
                                showToast?.(result?.error || 'No se pudieron actualizar los datos', 'error');
                            }
                        }}
                        disabled={syncLoading}
                        className="min-h-11 min-w-11 p-2.5 rounded-2xl text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-emerald-400 transition-colors disabled:opacity-50"
                        title="Actualizar Datos"
                    >
                        <RefreshCw size={16} className={syncLoading ? "animate-spin text-emerald-500" : ""} />
                    </button>

                    <button 
                        onClick={() => { triggerHaptic?.(); setShowRateModal(true); }}
                        disabled={!remoteActionsAvailable}

                        className="min-h-11 flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-2 py-2 text-[10px] font-bold text-emerald-700 shadow-sm transition-all hover:bg-emerald-100 active:scale-95 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300 sm:flex-none sm:px-3 sm:text-xs"
                        title="Ajustar Tasa Remota"
                    >
                        <TrendingUp size={14} />
                        <span className="hidden sm:inline">Ajustar Tasa</span><span className="sm:hidden">Tasa</span>
                    </button>

                    <button 
                        onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(true); }}
                        className="min-h-11 min-w-11 p-2.5 rounded-2xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-rose-400 transition-colors"
                        title="Desvincular Dispositivo"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </header>

            {/* Banner Offline */}
            {!isConnected && lastSync && (
                <div className="mx-4 mt-4 p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl flex gap-3 items-center text-amber-800 dark:text-amber-400 shadow-sm animate-fade-in">
                    <Clock size={18} className="shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">
                        Sin conexión a internet. Mostrando últimos datos sincronizados el {lastSync.toLocaleDateString()} a las {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </p>
                </div>
            )}

            {syncError && (
                <div className="mx-4 mt-4 p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 rounded-2xl flex gap-3 items-center text-rose-800 dark:text-rose-400 shadow-sm animate-fade-in">
                    <AlertTriangle size={18} className="shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">
                        {syncState === SUPERVISOR_SYNC_STATES.DEGRADED && lastSync
                            ? `Conexión degradada. Mostrando los últimos datos confirmados. ${syncError}`
                            : syncError}
                    </p>
                </div>
            )}

            {/* Contenido Principal */}
            <main data-testid="supervisor-main" className="max-w-7xl mx-auto w-full min-w-0 px-3 sm:px-4 mt-4 sm:mt-6 space-y-5 sm:space-y-6">
                {/* Selector de Pestañas */}
                <div data-testid="supervisor-tabs" className="flex bg-slate-200/60 dark:bg-slate-900/60 p-1 rounded-2xl w-full max-w-full sm:max-w-2xl shadow-sm overflow-x-auto overscroll-x-contain scrollbar-hide">
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('activo'); }}
                        className={`shrink-0 min-h-11 flex-1 py-2 px-3 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                            viewTab === 'activo' 
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        Turno Activo
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('cierres'); }}
                        className={`shrink-0 min-h-11 flex-1 py-2 px-3 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                            viewTab === 'cierres' 
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        Cierres
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('inventario'); }}
                        className={`shrink-0 min-h-11 flex-1 py-2 px-3 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                            viewTab === 'inventario' 
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        Inventario
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('reportes'); }}
                        className={`shrink-0 min-h-11 flex-1 py-2 px-3 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                            viewTab === 'reportes'
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        Reportes
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('cajeros'); }}
                        className={`shrink-0 min-h-11 flex-1 py-2 px-3 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                            viewTab === 'cajeros' 
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        Cajeros
                    </button>
                </div>

                {/* ── SECCIÓN 1: TURNO ACTIVO ── */}
                {viewTab === 'activo' && (
                    <div className="space-y-6">
                        {/* Barra de Estado de Turno y Acciones Remotas */}
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${isShiftActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                                <div>
                                    <span className="text-xs font-black text-slate-800 dark:text-white block">
                                        {isShiftActive ? 'Turno Activo en Caja' : 'Caja Inactiva / Sin Turno Abierto'}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-medium block">
                                        Cajero: {activeCashier.nombre} {activeShiftApertura?.timestamp ? `• Abierto a las ${formatTime(activeShiftApertura.timestamp)}` : ''}
                                    </span>
                                </div>
                            </div>

                            {isShiftActive ? (
                                <button
                                    onClick={() => { triggerHaptic?.(); setShiftActionConfirmModal('close'); }}
                                    className="w-full sm:w-auto min-h-11 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:hover:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <Clock size={14} />
                                    <span>Cerrar Turno Remotamente</span>
                                </button>
                            ) : (
                                <button
                                    onClick={() => { triggerHaptic?.(); setShiftActionConfirmModal('reopen'); }}
                                    className="w-full sm:w-auto min-h-11 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <RefreshCw size={14} />
                                    <span>Reabrir Último Turno Remotamente</span>
                                </button>
                            )}
                        </div>

                        {/* Fila 1: Tarjetas de Métricas de Turno Activo */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Ventas Turno USD */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Vendido Turno (USD)</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                        <DollarSign size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-slate-800 dark:text-white tabular-nums block break-words leading-none">
                                        ${activeShiftMetrics.totalUsd.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Ventas Turno Bs */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Vendido Turno (Bs)</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                        <Coins size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums block break-words leading-none">
                                        {formatBs(activeShiftMetrics.totalBs)} Bs
                                    </span>
                                    <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                        Tasa: {bcvRate ? `${bcvRate.toFixed(2)} Bs/$` : 'N/D'}
                                    </span>
                                </div>
                            </div>

                            {/* Margen Estimado Turno */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Ganancia Turno</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-blue-50 dark:bg-blue-950/20 rounded-xl flex items-center justify-center text-blue-500 shrink-0">
                                        <TrendingUp size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums block break-words leading-none">
                                        ${activeShiftMetrics.profitUsd.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Cajero Activo */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Cajero de Turno</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex items-center justify-center text-slate-450 shrink-0">
                                        <Users size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="text-sm sm:text-base lg:text-lg font-black text-slate-800 dark:text-white block truncate leading-none">
                                        {isShiftActive ? activeCashier.nombre : 'Ninguno'}
                                    </span>
                                    <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                        {activeShiftMetrics.count} {activeShiftMetrics.count === 1 ? 'venta' : 'ventas'} en curso
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Si la caja no está activa */}
                        {!isShiftActive ? (
                            <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-4 max-w-lg mx-auto flex flex-col items-center">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-450 rounded-full">
                                    <Clock size={42} />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Caja Cerrada / Turno Inactivo</h4>
                                    <p className="text-xs text-slate-400 leading-relaxed px-4">
                                        No hay un turno de caja activo en este momento. Abre la caja en el dispositivo del punto de venta para comenzar a registrar movimientos en vivo.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Desglose Diario por Método de Pago */}
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
                                    <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800/80">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                                                <Wallet size={18} className="text-violet-500" />
                                                Ingresos del Turno Activo
                                            </h3>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl">
                                                En Curso
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-5 sm:p-6">
                                        {/* Apertura de caja */}
                                        <div className="mb-5 p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/50 rounded-2xl">
                                            <div className="flex items-center gap-2 mb-3">
                                                <div className="w-7 h-7 bg-amber-100 dark:bg-amber-950/30 rounded-lg flex items-center justify-center">
                                                    <ArrowDownRight size={14} className="text-amber-600 dark:text-amber-400" />
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Fondo de Apertura de Turno</span>
                                            </div>
                                            {activeShiftApertura ? (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                                                    <div className="space-y-0.5">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">USD Inicial</span>
                                                        <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">${(activeShiftApertura.openingUsd || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Bs Inicial</span>
                                                        <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">{formatBs(activeShiftApertura.openingBs || 0)} Bs</span>
                                                    </div>
                                                    {shouldShowCop && activeShiftApertura.openingCop > 0 && (
                                                        <div className="space-y-0.5">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase block">COP Inicial</span>
                                                            <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">{(activeShiftApertura.openingCop || 0).toLocaleString()} COP</span>
                                                        </div>
                                                    )}
                                                    <div className="space-y-0.5 col-span-2 sm:col-span-3">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Hora de apertura</span>
                                                        <span className="text-xs font-bold text-slate-500">{formatTime(activeShiftApertura.timestamp)}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-slate-400 font-bold">Caja iniciada sin fondo declarado.</p>
                                            )}
                                        </div>

                                        {/* Tabla desglose */}
                                        {activeShiftPaymentBreakdown.length === 0 ? (
                                            <div className="py-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                                <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
                                                <p className="text-xs font-black">Sin transacciones registradas</p>
                                                <p className="text-[10px] text-slate-450 mt-1">El desglose por método de pago aparecerá aquí.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2.5">
                                                {activeShiftPaymentBreakdown
                                                    .filter(([methodId]) => copEnabled || !methodId.toLowerCase().includes('cop'))
                                                    .map(([methodId, data]) => {
                                                    const IconComp = getMethodIcon(methodId);
                                                    const pct = activeShiftMetrics.totalUsd > 0 
                                                        ? Math.round((data.totalUsd / activeShiftMetrics.totalUsd) * 100) 
                                                        : 0;

                                                    return (
                                                        <div key={methodId} className="flex items-center gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-800/40 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                            <div className="w-9 h-9 bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0 shadow-sm">
                                                                <IconComp size={16} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{data.label}</span>
                                                                    <span className="font-outfit text-xs font-black text-slate-800 dark:text-white tabular-nums shrink-0">${data.totalUsd.toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2 mt-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[9px] font-bold text-slate-400">{data.count} {data.count === 1 ? 'transacción' : 'transacciones'}</span>
                                                                        <span className="text-[9px] font-black text-violet-500 bg-violet-50 dark:bg-violet-950/20 dark:text-violet-400 px-1.5 py-0.5 rounded-md">{pct}%</span>
                                                                    </div>
                                                                    <span className="font-outfit text-[10px] font-bold text-slate-400 tabular-nums">{formatBs(data.totalBs)} Bs</span>
                                                                </div>
                                                                <div className="mt-1.5 h-1 bg-slate-200/60 dark:bg-slate-800 rounded-full overflow-hidden">
                                                                    <div 
                                                                        className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500" 
                                                                        style={{ width: `${Math.max(2, pct)}%` }} 
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {/* Resumen total */}
                                                <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between px-1">
                                                    <div className="flex items-center gap-2">
                                                        <Hash size={14} className="text-slate-400" />
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                            Total Acumulado ({activeShiftMetrics.count} {activeShiftMetrics.count === 1 ? 'venta' : 'ventas'})
                                                        </span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="font-outfit text-sm font-black text-slate-850 dark:text-white tabular-nums">${activeShiftMetrics.totalUsd.toFixed(2)}</span>
                                                        <span className="font-outfit text-[10px] font-bold text-slate-400 ml-2">{formatBs(activeShiftMetrics.totalBs)} Bs</span>
                                                    </div>
                                                </div>

                                                {/* Ticket promedio */}
                                                <div className="flex items-center justify-between px-1 mt-1">
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ticket Promedio</span>
                                                    <span className="font-outfit text-xs font-black text-blue-650 dark:text-blue-400 tabular-nums">${activeShiftAvgTicket.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Dashboard de Columnas */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Columna Izquierda: Listado de Ventas en Vivo */}
                                    <div className="lg:col-span-2 space-y-4">
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-6 shadow-sm min-w-0 overflow-hidden">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                                <FileText size={18} className="text-slate-400" />
                                                Ventas del Turno en Tiempo Real
                                            </h3>
                                            
                                            {loadingData || syncLoading ? (
                                                <div className="py-8 flex justify-center text-slate-400 gap-2 items-center">
                                                    <RefreshCw className="animate-spin" size={18} />
                                                    <span className="text-xs font-bold">Cargando transacciones...</span>
                                                </div>
                                            ) : activeShiftSales.length === 0 ? (
                                                <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                                    <Clock size={36} className="mx-auto text-slate-350 dark:text-slate-700 mb-2" />
                                                    <p className="text-xs font-black">No se han registrado ventas en este turno</p>
                                                    <p className="text-[10px] text-slate-400 mt-1">Las ventas de la caja activa aparecerán aquí al instante.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                                                    {activeShiftSales.slice().reverse().map(sale => (
                                                        <div 
                                                            key={sale.id}
                                                            className="p-4 border border-slate-100 dark:border-slate-800/80 hover:border-slate-200 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 flex justify-between items-start transition-colors"
                                                        >
                                                            <div className="space-y-1 min-w-0 flex-1 pr-3">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                                                                        #{sale.id.slice(-4).toUpperCase()}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                </div>
                                                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 mt-1.5 truncate">
                                                                    {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                </p>
                                                                <div className="flex gap-2 items-center mt-1">
                                                                    <span className="text-[10px] font-black text-slate-400 uppercase">{sale.metodoPago || sale.paymentMethod || 'Efectivo'}</span>
                                                                    {sale.clientName && (
                                                                        <span className="text-[10px] text-slate-400 font-bold">• {sale.clientName}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="text-right space-y-0.5 shrink-0">
                                                                <span className="font-outfit text-sm font-black text-slate-800 dark:text-white block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                <span className="font-outfit text-[10px] font-bold text-slate-400 block">{formatBs(sale.totalBs || 0)} Bs</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Columna Derecha: Stock Crítico */}
                                    <div className="space-y-6">
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-6 shadow-sm min-w-0 overflow-hidden">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                                <Package size={18} className="text-rose-500" />
                                                Stock Crítico (Agotados)
                                            </h3>

                                            {criticalProducts.length === 0 ? (
                                                <div className="py-6 text-center text-slate-400">
                                                    <p className="text-xs font-black text-emerald-600">¡Todo en orden!</p>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">No hay productos sin inventario.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3">
                                                    {criticalProducts.map(prod => (
                                                        <div key={prod.id} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                            <div className="min-w-0 pr-2">
                                                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block truncate">{prod.name}</span>
                                                                <span className="font-outfit text-[10px] text-slate-400">Precio: ${prod.price?.toFixed(2)}</span>
                                                            </div>
                                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/20 text-rose-600 shrink-0">
                                                                Agotado
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SECCIÓN 2: CIERRES DE CAJA (HISTORIAL + DETALLE ARQUEO) ── */}
                {viewTab === 'cierres' && (
                    <div className="space-y-4">
                        {/* Selector de Rango de Fechas para Cierres */}
                        <div className="flex bg-slate-200/60 dark:bg-slate-900/60 p-1 rounded-2xl w-full max-w-lg shadow-sm overflow-x-auto">
                            {[
                                { id: 'all', label: 'Todos' },
                                { id: 'today', label: 'Hoy' },
                                { id: 'yesterday', label: 'Ayer' },
                                { id: 'week', label: 'Esta Semana' },
                                { id: 'month', label: 'Este Mes' }
                            ].map(range => (
                                <button
                                    key={range.id}
                                    onClick={() => { triggerHaptic?.(); setCierresDateRange(range.id); }}
                                    className={`flex-1 py-1.5 px-3 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                                        cierresDateRange === range.id
                                            ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm'
                                            : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                                    }`}
                                >
                                    {range.label}
                                </button>
                            ))}
                        </div>

                        {filteredRegisterCloses.length === 0 ? (
                            <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-4 max-w-lg mx-auto flex flex-col items-center">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-450 rounded-full">
                                    <ShieldCheck size={42} />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-white">
                                        {cierresDateRange === 'all' ? 'Sin cierres registrados' : 'Sin cierres en este período'}
                                    </h4>
                                    <p className="text-xs text-slate-400 leading-relaxed px-4">
                                        {cierresDateRange === 'all' 
                                            ? 'Cuando el cajero complete un cierre de caja en el dispositivo principal, aparecerá el arqueo detallado aquí.' 
                                            : 'No se encontraron registros de cierre para la fecha seleccionada. Intenta cambiar el filtro.'}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Selector / Lista de Cierres */}
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-sm h-fit space-y-4">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Historial de Cierres ({filteredRegisterCloses.length})</span>
                                    <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                                        {filteredRegisterCloses.map(c => {
                                            const dateObj = new Date(c.cierreId);
                                            const isSelected = selectedCierreId === c.cierreId || (!selectedCierreId && filteredRegisterCloses[0].cierreId === c.cierreId);
                                            return (
                                                <button
                                                    key={c.cierreId}
                                                    onClick={() => setSelectedCierreId(c.cierreId)}
                                                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                                                        isSelected 
                                                            ? 'bg-emerald-500/10 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400' 
                                                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 border-slate-200/65 dark:border-slate-800/60 text-slate-600 dark:text-slate-300'
                                                    }`}
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <span className="text-xs font-black block truncate">
                                                            Cierre #{c.cierreNumber || String(c.cierreId).slice(-4)}
                                                        </span>
                                                        <span className="text-[9px] text-slate-400 font-bold block mt-0.5">
                                                            {dateObj.toLocaleDateString()} • {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <span className="font-outfit text-xs font-black tabular-nums shrink-0">${c.totalUsd.toFixed(2)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Zona de Resumen del Cierre Seleccionado */}
                                <div className="lg:col-span-2 space-y-6">
                                    {(() => {
                                        const activeC = registerCloses.find(c => c.cierreId === selectedCierreId) || registerCloses[0];
                                        if (!activeC) return null;

                                        const expectedUsd = activeC.reconData?.expectedUsd ?? activeC.totalUsd;
                                        // Declarados
                                        const declaredUsd = activeC.reconData?.cashUsd ?? null;
                                        const declaredBs = activeC.reconData?.cashBs ?? null;
                                        const declaredCop = activeC.reconData?.cashCop ?? null;
                                        const hasDeclaredCop = declaredCop !== null;
                                        
                                        const diffUsd = declaredUsd !== null ? declaredUsd - expectedUsd : null;
                                        const isCuadrado = declaredUsd === null || Math.abs(diffUsd) <= 0.50;

                                        return (
                                            <div className="space-y-6 animate-fade-in">
                                                {/* Resumen Principal */}
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Total USD</span>
                                                        <strong className="font-outfit text-base sm:text-lg font-black text-slate-800 dark:text-white block mt-1">${activeC.totalUsd.toFixed(2)}</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Total Bs</span>
                                                        <strong className="font-outfit text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 block mt-1">{formatBs(activeC.totalBs)} Bs</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Cajero</span>
                                                        <strong className="text-xs font-black text-slate-700 dark:text-slate-200 block truncate mt-1">{activeC.cashier?.nombre || 'Cajero'}</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Arqueo Físico</span>
                                                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md inline-block mt-1 ${
                                                            declaredUsd === null 
                                                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' 
                                                                : isCuadrado 
                                                                    ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' 
                                                                    : 'bg-amber-100 dark:bg-amber-955/30 text-amber-700 dark:text-amber-400 animate-pulse'
                                                        }`}>
                                                            {declaredUsd === null ? 'Sin Declarar' : isCuadrado ? 'Cuadrado' : 'Diferencia'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Arqueo Detallado de Efectivo */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm min-w-0 overflow-hidden">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Cuadre de Efectivo</h3>
                                                    
                                                    {declaredUsd === null ? (
                                                        <div className="py-6 px-4 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl text-center">
                                                            <AlertTriangle size={24} className="text-amber-500 mx-auto mb-1.5" />
                                                            <p className="text-xs font-black text-amber-800 dark:text-amber-400">Cierre simplificado sin arqueo</p>
                                                            <p className="text-[10px] text-slate-500 mt-0.5">El cajero completó el cierre de caja sin declarar el saldo físico.</p>
                                                        </div>
                                                    ) : (
                                                        <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden text-xs">
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 py-2 bg-slate-50 dark:bg-slate-850/50 text-[10px] font-black text-slate-400 uppercase border-b border-slate-150 dark:border-slate-800">
                                                                <span>Moneda</span>
                                                                <span className="text-center">Esperado</span>
                                                                <span className="text-center">Declarado</span>
                                                                <span className="text-right">Diferencia</span>
                                                            </div>

                                                            {/* USD Row */}
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 py-3 border-b border-slate-100 dark:border-slate-800 items-center">
                                                                <span className="font-bold text-slate-700 dark:text-slate-200">Dólares ($)</span>
                                                                <span className="font-outfit font-mono text-slate-400 text-center">${expectedUsd.toFixed(2)}</span>
                                                                <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">${declaredUsd.toFixed(2)}</span>
                                                                <span className={`font-outfit font-mono font-black text-right ${
                                                                    diffUsd === 0 ? 'text-slate-400' : diffUsd > 0 ? 'text-emerald-600' : 'text-rose-600'
                                                                }`}>
                                                                    {diffUsd > 0 ? '+' : ''}{diffUsd.toFixed(2)}
                                                                </span>
                                                            </div>

                                                            {/* Bs Row */}
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 py-3 border-b border-slate-100 dark:border-slate-800 items-center">
                                                                <span className="font-bold text-slate-700 dark:text-slate-200">Bolívares (Bs)</span>
                                                                <span className="font-outfit font-mono text-slate-400 text-center">{formatBs(activeC.reconData?.expectedBs || 0)}</span>
                                                                <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">{formatBs(declaredBs)}</span>
                                                                <span className={`font-outfit font-mono font-black text-right ${
                                                                    (declaredBs - (activeC.reconData?.expectedBs || 0)) === 0 
                                                                        ? 'text-slate-400' 
                                                                        : (declaredBs - (activeC.reconData?.expectedBs || 0)) > 0 
                                                                            ? 'text-emerald-600' 
                                                                            : 'text-rose-600'
                                                                }`}>
                                                                    {(declaredBs - (activeC.reconData?.expectedBs || 0)) > 0 ? '+' : ''}
                                                                    {formatBs(declaredBs - (activeC.reconData?.expectedBs || 0))}
                                                                </span>
                                                            </div>

                                                            {/* COP Row si aplica */}
                                                            {shouldShowCop && activeC.reconData?.expectedCop > 0 && (
                                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 py-3 items-center">
                                                                    <span className="font-bold text-slate-700 dark:text-slate-200">Pesos (COP)</span>
                                                                    <span className="font-outfit font-mono text-slate-400 text-center">{(activeC.reconData.expectedCop).toLocaleString()}</span>
                                                                    <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">{hasDeclaredCop ? formatCop(declaredCop) : 'Sin declarar'}</span>
                                                                    <span className={`font-outfit font-mono font-black text-right ${
                                                                        (declaredCop - activeC.reconData.expectedCop) === 0 
                                                                            ? 'text-slate-400' 
                                                                            : (declaredCop - activeC.reconData.expectedCop) > 0 
                                                                                ? 'text-emerald-600' 
                                                                                : 'text-rose-600'
                                                                    }`}>
                                                                        {(declaredCop - activeC.reconData.expectedCop) > 0 ? '+' : ''}
                                                                        {hasDeclaredCop ? formatCop(declaredCop - activeC.reconData.expectedCop) : '—'}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Desglose de Métodos de Pago */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm min-w-0 overflow-hidden">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Desglose de Ingresos</h3>
                                                    <div className="space-y-2.5">
                                                        {activeC.paymentBreakdown
                                                            .filter(([methodId]) => copEnabled || !methodId.toLowerCase().includes('cop'))
                                                            .map(([methodId, data]) => {
                                                            const IconComp = getMethodIcon(methodId);
                                                            const pct = activeC.totalUsd > 0 ? Math.round((data.totalUsd / activeC.totalUsd) * 100) : 0;
                                                            return (
                                                                <div key={methodId} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 rounded-2xl">
                                                                    <div className="w-8 h-8 bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                                                                        <IconComp size={14} />
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center justify-between text-xs">
                                                                            <span className="font-black text-slate-700 dark:text-slate-200">{data.label}</span>
                                                                            <span className="font-outfit font-black text-slate-800 dark:text-white">${data.totalUsd.toFixed(2)}</span>
                                                                        </div>
                                                                        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                                                                            <span>{data.count} tx • {pct}%</span>
                                                                            <span className="font-outfit">{formatBs(data.totalBs)} Bs</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Ventas del Cierre */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-6 shadow-sm min-w-0 overflow-hidden">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Ventas Cerradas en este Turno</h3>
                                                    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                                                        {activeC.sales.slice().reverse().map(sale => (
                                                            <div key={sale.id} className="p-3.5 border border-slate-100 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 flex justify-between items-center text-xs">
                                                                    <div className="min-w-0 flex-1 pr-2">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/40">
                                                                                #{sale.id.slice(-4).toUpperCase()}
                                                                            </span>
                                                                            <span className="text-[9px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                        </div>
                                                                        <p className="font-black text-slate-700 dark:text-slate-250 truncate mt-1">
                                                                            {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                        </p>
                                                                    </div>
                                                                    <div className="text-right shrink-0">
                                                                        <span className="font-outfit font-black text-slate-850 dark:text-white block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                        <span className="font-outfit text-[9px] text-slate-400 block">{formatBs(sale.totalBs || 0)} Bs</span>
                                                                    </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SECCIÓN 3: INVENTARIO EN TIEMPO REAL ── */}
                {viewTab === 'inventario' && (
                    <div className="space-y-6 animate-fade-in">
                        {/* Fila de Resumen de Inventario */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Total Productos */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Total Artículos</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        {inventoryMetrics.count}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">{inventoryMetrics.totalQty} unds</span>
                                </div>
                            </div>

                            {/* Valorización Costo */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Valor Inventario (Costo)</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        ${inventoryMetrics.totalCost.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Valorización Venta */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Valor Estimado (Venta)</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        ${inventoryMetrics.totalRetail.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Ganancia Potencial */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Ganancia en Stock</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums leading-none">
                                        ${inventoryMetrics.expectedProfit.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Barra de Filtro y Búsqueda */}
                        <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
                            {/* Input de Búsqueda */}
                            <div className="relative flex-1">
                                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-450">
                                    <Search size={14} />
                                </span>
                                <input
                                    type="text"
                                    placeholder="Buscar producto por nombre o código..."
                                    value={searchTermInventario}
                                    onChange={(e) => setSearchTermInventario(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 text-xs rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500/70 transition-colors"
                                />
                                {searchTermInventario && (
                                    <button 
                                        onClick={() => setSearchTermInventario('')}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-650"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>

                            {/* Botón Crear Producto Remoto */}
                            <button
                                onClick={() => {
                                    triggerHaptic?.();
                                    setProductToEditRemote(null);
                                    setShowProductFormModal(true);
                                }}
                                className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-2xl shadow-md transition-all shrink-0 active:scale-95"
                            >
                                <Plus size={16} />
                                <span>Nuevo Producto</span>
                            </button>

                            {/* Filtro de Segmentación de Stock */}
                            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-850 self-start md:self-auto shrink-0 shadow-inner">
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('todos'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all ${
                                        filterStockInventario === 'todos'
                                            ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                                            : 'text-slate-450 hover:text-slate-650 dark:hover:text-slate-350'
                                    }`}
                                >
                                    Todos ({inventoryMetrics.count})
                                </button>
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('bajo'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all flex items-center gap-1 ${
                                        filterStockInventario === 'bajo'
                                            ? 'bg-amber-500 text-white shadow-sm'
                                            : 'text-amber-600 dark:text-amber-400 hover:text-amber-700'
                                    }`}
                                >
                                    Bajo Stock ({inventoryMetrics.lowStockCount})
                                </button>
                                <button
                                    onClick={() => { triggerHaptic?.(); setFilterStockInventario('agotado'); }}
                                    className={`px-3 py-1.5 text-[10px] sm:text-xs font-black rounded-xl transition-all flex items-center gap-1 ${
                                        filterStockInventario === 'agotado'
                                            ? 'bg-rose-500 text-white shadow-sm'
                                            : 'text-rose-600 dark:text-rose-400 hover:text-rose-700'
                                    }`}
                                >
                                    Agotados ({inventoryMetrics.outOfStockCount})
                                </button>
                            </div>
                        </div>

                        {/* Listado de Productos */}
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
                            {filteredProducts.length === 0 ? (
                                <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 rounded-full">
                                        <Package size={36} />
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-black text-slate-700 dark:text-slate-200">No se encontraron productos</p>
                                        <p className="text-[10px] text-slate-450">Intenta buscando con otro término o cambiando los filtros.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                                    {paginatedProducts.map((p) => {
                                        const stock = p.stock || 0;
                                        const minStock = p.minStock || 5;
                                        const isAgotado = stock <= 0;
                                        const isBajo = !isAgotado && stock <= minStock;
                                        const profitUsd = Math.max(0, p.priceUsd - (p.costPrice || 0));
                                        const profitPct = p.priceUsd > 0 ? Math.round((profitUsd / p.priceUsd) * 100) : 0;

                                        return (
                                            <div key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors">
                                                {/* Izquierda: Info de Producto */}
                                                <div className="flex-1 min-w-0 pr-2">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="text-xs font-black text-slate-800 dark:text-white uppercase leading-tight truncate">{p.name}</h4>
                                                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                            isAgotado 
                                                                ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400' 
                                                                : isBajo 
                                                                    ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400' 
                                                                    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
                                                        }`}>
                                                            {isAgotado ? 'Agotado' : isBajo ? 'Bajo Stock' : 'Disponible'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 font-medium">
                                                        {p.barcode && (
                                                            <span className="flex items-center gap-1">
                                                                <Hash size={10} /> {p.barcode}
                                                            </span>
                                                        )}
                                                        <span>Categoría: {toTitleCase(p.category || 'Varios')}</span>
                                                    </div>
                                                </div>

                                                {/* Derecha: Valores y Stock */}
                                                <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0">
                                                    {/* Costo, Venta, Margen */}
                                                    <div className="grid grid-cols-3 gap-4 text-right">
                                                        {/* Costo */}
                                                        <div>
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block">Costo</span>
                                                            <span className="font-outfit text-xs font-black text-slate-500 tabular-nums">${(p.costPrice || 0).toFixed(2)}</span>
                                                        </div>
                                                        {/* Venta */}
                                                        <div>
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block">Venta (USD/Bs)</span>
                                                            <span className="font-outfit text-xs font-black text-slate-800 dark:text-white tabular-nums block">${p.priceUsd.toFixed(2)}</span>
                                                            <span className="font-outfit text-[8px] text-slate-400 block tabular-nums leading-none mt-0.5">{bcvRate ? `${formatBs(p.priceUsd * bcvRate)} Bs` : 'N/D'}</span>
                                                        </div>
                                                        {/* Ganancia */}
                                                        <div>
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block">Ganancia</span>
                                                            <span className="font-outfit text-xs font-black text-blue-600 dark:text-blue-400 tabular-nums block">${profitUsd.toFixed(2)}</span>
                                                            <span className="text-[8px] text-slate-400 block font-medium leading-none mt-0.5">{profitPct}%</span>
                                                        </div>
                                                    </div>

                                                    {/* Stock */}
                                                    <div className={`w-20 text-center py-2 px-2.5 rounded-2xl border ${
                                                        isAgotado 
                                                            ? 'bg-rose-50/50 border-rose-150/70 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-455' 
                                                            : isBajo 
                                                                ? 'bg-amber-50/50 border-amber-150/70 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-455' 
                                                                : 'bg-slate-50 border-slate-150/70 text-slate-700 dark:bg-slate-850/60 dark:border-slate-800 dark:text-slate-300'
                                                    }`}>
                                                        <span className="text-[8px] uppercase font-black block leading-none mb-0.5">Stock</span>
                                                        <span className="font-outfit text-xs sm:text-sm font-black tabular-nums leading-none">
                                                            {p.isWeight ? `${stock.toFixed(3)} Kg` : `${stock} u`}
                                                        </span>
                                                    </div>

                                                    {/* Acciones Remotas */}
                                                    <div className="flex items-center gap-1">
                                                        {(SUPERVISOR_REMOTE_MUTATIONS_ENABLED || SUPERVISOR_REMOTE_INCOME_ENABLED) && (
                                                            <button
                                                                onClick={() => {
                                                                    if (!remoteActionsAvailable) {
                                                                        showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                                        return;
                                                                    }
                                                                    triggerHaptic?.();
                                                                    setInventoryBatchProduct(p);
                                                                }}
                                                                className="rounded-xl p-2 text-emerald-500 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                                                title="Ajustar stock remotamente"
                                                            >
                                                                <Plus size={15} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                if (!remoteActionsAvailable) {
                                                                    showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                                    return;
                                                                }
                                                                triggerHaptic?.();
                                                                setProductToEditRemote(p);
                                                                setShowProductFormModal(true);
                                                            }}
                                                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-blue-600 rounded-xl transition-colors"
                                                            title="Editar Producto Remotamente"
                                                        >
                                                            <Pencil size={15} />
                                                        </button>
                                                        <button
                                                            onClick={async () => {
                                                                if (!remoteActionsAvailable) {
                                                                    showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                                    return;
                                                                }
                                                                if (!window.confirm(`¿Eliminar remotamente "${p.name}" de la caja?`)) return;
                                                                if (!SUPERVISOR_REMOTE_MUTATIONS_ENABLED) {
                                                                    showToast?.('Las mutaciones remotas están temporalmente deshabilitadas por seguridad', 'warning');
                                                                    return;
                                                                }
                                                                triggerHaptic?.();
                                                                try {
                                                                    const result = await sendSupervisorCommand({
                                                                        type: 'supervisor.product.delete',
                                                                        targetDeviceId: pairedDeviceId,
                                                                        payload: { productId: p.id },
                                                                    });
                                                                    if (!result.ok) {
                                                                        showToast?.(result.error, result.status === 'disabled' ? 'warning' : 'error');
                                                                        return;
                                                                    }
                                                                    const ack = await result.ackPromise;
                                                                    if (!ack?.ok) {
                                                                        showToast?.(ack?.error || 'La caja no confirmó la eliminación', 'error');
                                                                        return;
                                                                    }
                                                                    showToast?.(`Producto "${p.name}" eliminado en caja`, 'success');
                                                                } catch (e) {
                                                                    showToast?.('Error al eliminar producto', 'error');
                                                                }
                                                            }}
                                                            className="p-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-400 hover:text-rose-600 rounded-xl transition-colors"
                                                            title="Eliminar Producto Remotamente"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Controles de Paginación */}
                        {totalPagesInventario > 1 && (
                            <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-4 py-3 sm:px-6 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm mt-4">
                                <button
                                    onClick={() => {
                                        if (currentPageInventario > 1) {
                                            triggerHaptic?.();
                                            setCurrentPageInventario(prev => prev - 1);
                                        }
                                    }}
                                    disabled={currentPageInventario === 1}
                                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150"
                                >
                                    <ChevronLeft size={16} />
                                </button>

                                <span className="text-xs font-black text-slate-500 dark:text-slate-400">
                                    Página {currentPageInventario} de {totalPagesInventario}
                                    <span className="text-[10px] text-slate-450 font-medium ml-2">
                                        ({filteredProducts.length} productos)
                                    </span>
                                </span>

                                <button
                                    onClick={() => {
                                        if (currentPageInventario < totalPagesInventario) {
                                            triggerHaptic?.();
                                            setCurrentPageInventario(prev => prev + 1);
                                        }
                                    }}
                                    disabled={currentPageInventario === totalPagesInventario}
                                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SECCIÓN 4: REPORTES DEL SUPERVISOR (SOLO LECTURA) ── */}
                {viewTab === 'reportes' && (
                    <div data-testid="supervisor-reports" className="space-y-5 sm:space-y-6 animate-fade-in min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div>
                                <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-white">Reportes del Supervisor</h2>
                                <p className="text-[10px] sm:text-xs text-slate-400 font-medium">Información sincronizada de la caja · Solo lectura</p>
                            </div>
                            <span className="self-start px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {supervisorReportData.cash.cashMovementCount} movimientos de caja
                            </span>
                        </div>

                        <div data-testid="supervisor-report-filters" className="bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-3">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <SupervisorSelect
                                    label="Período"
                                    ariaLabel="Filtrar reportes por período"
                                    value={reportsDateRange}
                                    onChange={setReportsDateRange}
                                    testId="supervisor-report-period-select"
                                    options={[
                                        { value: 'all', label: 'Todos los movimientos' },
                                        { value: 'today', label: 'Hoy' },
                                        { value: 'yesterday', label: 'Ayer' },
                                        { value: 'week', label: 'Esta semana' },
                                        { value: 'month', label: 'Este mes' },
                                        { value: 'lastMonth', label: 'Mes anterior' },
                                        { value: 'custom', label: 'Fechas específicas' },
                                    ]}
                                />
                                <SupervisorSelect
                                    label="Cierre / turno"
                                    ariaLabel="Filtrar reportes por cierre o turno"
                                    value={reportsCierreId}
                                    onChange={setReportsCierreId}
                                    testId="supervisor-report-close-select"
                                    options={[
                                        { value: 'all', label: 'Todos los cierres' },
                                        ...registerCloses.map(close => ({
                                            value: String(close.cierreId),
                                            label: `Cierre #${close.cierreNumber || String(close.cierreId).slice(-4)}`,
                                        })),
                                    ]}
                                />
                                <SupervisorSelect
                                    label="Producto vendido"
                                    ariaLabel="Elegir producto para consultar sus ventas"
                                    value={reportsProductId}
                                    onChange={setReportsProductId}
                                    testId="supervisor-report-product-select"
                                    options={reportProductOptions}
                                />
                            </div>
                            {reportsDateRange === 'custom' && (
                                <div className="grid grid-cols-1 gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900/30 dark:bg-blue-950/20 sm:grid-cols-2">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Desde
                                        <input
                                            type="date"
                                            aria-label="Fecha inicial del reporte"
                                            value={reportsFrom}
                                            onChange={(event) => setReportsFrom(event.target.value)}
                                            className="mt-1.5 min-h-11 w-full rounded-2xl border border-blue-100 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 dark:border-blue-900/40 dark:bg-slate-900 dark:text-white"
                                        />
                                    </label>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Hasta
                                        <input
                                            type="date"
                                            aria-label="Fecha final del reporte"
                                            value={reportsTo}
                                            onChange={(event) => setReportsTo(event.target.value)}
                                            className="mt-1.5 min-h-11 w-full rounded-2xl border border-blue-100 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 dark:border-blue-900/40 dark:bg-slate-900 dark:text-white"
                                        />
                                    </label>
                                </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <button onClick={() => handleDownloadSupervisorReport('close')} className="min-h-11 px-3 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black flex items-center justify-center gap-2 transition-colors">
                                    <Download size={14} /> PDF Cierre
                                </button>
                                <button onClick={() => handleDownloadSupervisorReport('products')} className="min-h-11 px-3 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black flex items-center justify-center gap-2 transition-colors">
                                    <Download size={14} /> PDF Ventas
                                </button>
                                <button onClick={() => handleDownloadSupervisorReport('expenses')} className="min-h-11 px-3 py-2 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black flex items-center justify-center gap-2 transition-colors">
                                    <Download size={14} /> PDF Gastos
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Efectivo esperado USD</span>
                                <strong className="block mt-2 text-xl font-outfit font-black text-slate-800 dark:text-white tabular-nums break-words">
                                    ${supervisorReportData.cash.expected.USD.toFixed(2)}
                                </strong>
                                <span className="text-[10px] text-slate-400 block mt-1">Apertura: ${supervisorReportData.cash.opening.USD.toFixed(2)}</span>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Efectivo esperado Bs</span>
                                <strong className="block mt-2 text-xl font-outfit font-black text-emerald-600 dark:text-emerald-400 tabular-nums break-words">
                                    {formatBs(supervisorReportData.cash.expected.BS)} Bs
                                </strong>
                                <span className="text-[10px] text-slate-400 block mt-1">Apertura: {formatBs(supervisorReportData.cash.opening.BS)} Bs</span>
                            </div>
                            {shouldShowCop && (
                                <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm min-w-0">
                                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Efectivo esperado COP</span>
                                    <strong className="block mt-2 text-xl font-outfit font-black text-amber-600 dark:text-amber-400 tabular-nums break-words">
                                        {formatCop(supervisorReportData.cash.expected.COP)} COP
                                    </strong>
                                    <span className="text-[10px] text-slate-400 block mt-1">Sin duplicar cambios dejados</span>
                                </div>
                            )}
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Cambios dejados</span>
                                <div className="mt-2 space-y-1 text-xs font-outfit font-black tabular-nums">
                                    <span className="block text-slate-800 dark:text-white">${supervisorReportData.cash.tipsLeft.USD.toFixed(2)}</span>
                                    <span className="block text-emerald-600 dark:text-emerald-400">{formatBs(supervisorReportData.cash.tipsLeft.BS)} Bs</span>
                                    {shouldShowCop && <span className="block text-amber-600 dark:text-amber-400">{formatCop(supervisorReportData.cash.tipsLeft.COP)} COP</span>}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm min-w-0 overflow-hidden">
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white">Ventas por producto</h3>
                                        <p className="mt-1 text-[10px] text-slate-400">Elige un producto arriba para consultar cuánto vendió.</p>
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400">{visibleProductSales.length} productos</span>
                                </div>
                                {visibleProductSales.length === 0 ? (
                                    <p className="py-8 text-center text-xs text-slate-400">Sin ventas para el producto o período seleccionado.</p>
                                ) : (
                                    <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                                        {visibleProductSales.slice(0, 10).map(product => (
                                            <div key={product.productId} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/60 min-w-0">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-black text-slate-700 dark:text-slate-200 break-words">{product.productName}</p>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">{product.salesCount} ventas · ${product.revenueUsd.toFixed(2)} · {formatBs(product.revenueBs)} Bs</p>
                                                </div>
                                                <span className="shrink-0 text-xs font-outfit font-black text-emerald-600 dark:text-emerald-400">{product.quantity} uds</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {reportsProductId !== 'all' && (
                                <div data-testid="supervisor-product-sales-summary" className="bg-blue-600 rounded-3xl p-4 sm:p-5 shadow-sm min-w-0 text-white">
                                    <span className="text-[9px] font-black uppercase tracking-wider text-blue-100">Resumen del producto</span>
                                    <h3 className="mt-2 text-base font-black break-words">{selectedProductName}</h3>
                                    <div className="mt-4 grid grid-cols-3 gap-2">
                                        <div className="rounded-2xl bg-white/10 p-3">
                                            <span className="block text-[9px] font-bold text-blue-100">Unidades</span>
                                            <strong className="mt-1 block text-lg font-black">{visibleProductSales[0]?.quantity || 0}</strong>
                                        </div>
                                        <div className="rounded-2xl bg-white/10 p-3">
                                            <span className="block text-[9px] font-bold text-blue-100">Ventas</span>
                                            <strong className="mt-1 block text-lg font-black">{visibleProductSales[0]?.salesCount || 0}</strong>
                                        </div>
                                        <div className="rounded-2xl bg-white/10 p-3">
                                            <span className="block text-[9px] font-bold text-blue-100">Total USD</span>
                                            <strong className="mt-1 block text-lg font-black">${(visibleProductSales[0]?.revenueUsd || 0).toFixed(2)}</strong>
                                        </div>
                                    </div>
                                    <p className="mt-3 text-[10px] font-semibold text-blue-100">Período aplicado: {reportsDateRange === 'custom' ? `${reportsFrom} al ${reportsTo}` : reportRangeLabels[reportsDateRange]}</p>
                                </div>
                            )}

                            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm min-w-0 overflow-hidden">
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white">Gastos y egresos</h3>
                                    <span className="text-[10px] font-bold text-slate-400">{supervisorReportData.expenses.length} movimientos</span>
                                </div>
                                {supervisorReportData.expenses.length === 0 ? (
                                    <p className="py-8 text-center text-xs text-slate-400">Sin gastos registrados.</p>
                                ) : (
                                    <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                                        {supervisorReportData.expenses.slice(0, 10).map(expense => (
                                            <div key={expense.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/60 min-w-0">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-black text-slate-700 dark:text-slate-200 break-words">{expense.description}</p>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">{toTitleCase(expense.category)} · {expense.affectsCash ? 'Afecta caja' : 'No afecta caja'}</p>
                                                </div>
                                                <span className={`shrink-0 text-xs font-outfit font-black ${expense.isAutoconsumo ? 'text-violet-600 dark:text-violet-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    -${expense.totalUsd.toFixed(2)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm min-w-0 overflow-hidden">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                                <div>
                                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white">Movimientos de inventario</h3>
                                    <p className="text-[10px] text-slate-400 mt-1">Entradas y salidas detectadas en los datos sincronizados.</p>
                                </div>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                    <input
                                        type="search"
                                        aria-label="Buscar movimiento de inventario"
                                        placeholder="Buscar producto, lote o proveedor"
                                        value={inventoryMovementSearch}
                                        onChange={(event) => setInventoryMovementSearch(event.target.value)}
                                        className="min-h-9 w-full sm:w-52 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 text-[10px] font-bold text-slate-700 dark:text-white outline-none focus:border-emerald-500"
                                    />
                                    <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200/60 dark:border-slate-800">
                                        {[
                                            ['todos', 'Todos'],
                                            ['ingreso', 'Entradas'],
                                            ['egreso', 'Salidas'],
                                        ].map(([value, label]) => (
                                            <button
                                                key={value}
                                                type="button"
                                                onClick={() => setInventoryMovementFilter(value)}
                                                className={`min-h-9 px-2.5 text-[9px] font-black rounded-lg transition-colors ${
                                                    inventoryMovementFilter === value
                                                        ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                                                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">{visibleInventoryMovements.length} movimientos</span>
                                </div>
                            </div>
                            {visibleInventoryMovements.length === 0 ? (

                                <div className="py-8 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                    <Package size={24} className="mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                                    <p className="text-xs font-black text-slate-500 dark:text-slate-400">Sin movimientos de lotes sincronizados</p>
                                    <p className="text-[10px] text-slate-400 mt-1">Los movimientos aparecerán cuando la caja los registre.</p>
                                </div>
                            ) : (
                                <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                                    {visibleInventoryMovements.slice(0, 20).map(movement => (
                                        <div key={movement.movementId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/60">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg ${movement.direction === 'ingreso' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400'}`}>
                                                        {movement.direction}
                                                    </span>
                                                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 break-words">{movement.productName}</span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-1 break-words">{movement.reason} · {movement.inputUnit} · {movement.operatorName || 'Usuario no informado'}</p>
                                                <p className="text-[10px] text-slate-400 mt-1 break-words">
                                                    Stock: {movement.stockBefore == null ? '—' : movement.stockBefore} → {movement.stockAfter == null ? '—' : movement.stockAfter}
                                                    {movement.unitsPerPackage > 1 ? ` · ${movement.unitsPerPackage} uds/${movement.inputUnit === 'bultos' ? 'bulto' : 'caja'}` : ''}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                    {movement.lotReference && <span className="text-[9px] text-slate-500 dark:text-slate-400">Lote: {movement.lotReference}</span>}
                                                    {movement.supplierName && <span className="text-[9px] text-slate-500 dark:text-slate-400">Proveedor: {movement.supplierName}</span>}
                                                    {movement.invoiceReference && <span className="text-[9px] text-slate-500 dark:text-slate-400">Factura: {movement.invoiceReference}</span>}
                                                    {movement.isIncomplete && <span className="text-[9px] font-black text-amber-600 dark:text-amber-400">Datos incompletos</span>}
                                                </div>
                                            </div>
                                            <span className="shrink-0 self-start sm:self-center text-xs font-outfit font-black text-slate-700 dark:text-slate-200">{movement.unitsDelta} uds</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── SECCIÓN 5: CAJEROS Y USUARIOS ── */}
                {viewTab === 'cajeros' && (
                    <RemoteUsersManager targetDeviceId={pairedDeviceId} />
                )}
            </main>

            {/* Modal Ajustar Tasa Remota */}
            <SupervisorRateModal
                isOpen={showRateModal}
                onClose={() => setShowRateModal(false)}
                targetDeviceId={pairedDeviceId}
                currentRateMode={localStorage.getItem('bodega_rate_mode')}
                currentCustomRate={localStorage.getItem('bodega_custom_rate')}
                rates={rates}
                remoteAvailable={remoteActionsAvailable}
            />

            {/* Modal Ajuste de stock por lote del Supervisor */}
            <SupervisorInventoryBatchModal
                isOpen={Boolean(inventoryBatchProduct)}
                onClose={() => setInventoryBatchProduct(null)}
                product={inventoryBatchProduct}
                targetDeviceId={pairedDeviceId}
                remoteAvailable={remoteActionsAvailable}
            />

            {/* Modal Editar / Crear Producto Remoto */}
            <RemoteProductFormModal
                isOpen={showProductFormModal}
                onClose={() => {
                    setShowProductFormModal(false);
                    setProductToEditRemote(null);
                }}
                targetDeviceId={pairedDeviceId}
                productToEdit={productToEditRemote}
                remoteAvailable={remoteActionsAvailable}
            />

            {/* Modal de Confirmación de Desvinculación */}
            {showDisconnectConfirm && (
                <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-5 animate-scale-in">
                        <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 rounded-2xl flex items-center justify-center text-rose-500 mx-auto">
                            <LogOut size={22} />
                        </div>
                        <div className="space-y-1.5 text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">Desvincular Supervisor</h4>
                            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                                ¿Estás seguro de que deseas desvincular este dispositivo? Se perderá el acceso en tiempo real a las transacciones de esta caja.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(false); }}
                                className="flex-1 py-3 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { 
                                    setShowDisconnectConfirm(false);
                                    handleDisconnect();
                                }}
                                className="flex-1 py-3 px-4 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-500/20 transition-colors"
                            >
                                Desvincular
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Confirmación Cierre / Reapertura Remota de Turno */}
            {shiftActionConfirmModal && (
                <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full shadow-2xl space-y-5 animate-scale-in">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto ${
                            shiftActionConfirmModal === 'close' 
                                ? 'bg-rose-50 dark:bg-rose-950/20 text-rose-500' 
                                : 'bg-amber-50 dark:bg-amber-950/20 text-amber-500'
                        }`}>
                            {shiftActionConfirmModal === 'close' ? <Clock size={22} /> : <RefreshCw size={22} />}
                        </div>
                        <div className="space-y-1.5 text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">
                                {shiftActionConfirmModal === 'close' ? 'Cerrar Turno Remotamente' : 'Reabrir Último Turno'}
                            </h4>
                            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                                {shiftActionConfirmModal === 'close'
                                    ? 'Esta acción marcará las ventas actuales como cerradas en la caja principal y registrará un cierre remoto.'
                                    : 'Esta acción deshará el último cierre registrado y reactivará el turno anterior en la caja principal.'}
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { triggerHaptic?.(); setShiftActionConfirmModal(null); }}
                                disabled={sendingShiftAction}
                                className="flex-1 py-3 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => handleSendShiftActionRemote(shiftActionConfirmModal)}
                                disabled={sendingShiftAction}
                                className={`flex-1 py-3 px-4 font-black text-xs rounded-2xl shadow-lg transition-colors flex items-center justify-center gap-2 text-white ${
                                    shiftActionConfirmModal === 'close'
                                        ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20'
                                        : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'
                                } disabled:opacity-50`}
                            >
                                {sendingShiftAction ? <RefreshCw className="animate-spin" size={14} /> : (shiftActionConfirmModal === 'close' ? 'Confirmar Cierre' : 'Confirmar Reapertura')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
