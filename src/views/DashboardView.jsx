// v1.2.0: Rebrand al design system "Precios al Día" — shadow-tone-sm en cards, font-display en totales, text-accent para Bs (BCV-derived), reveal-on-scroll.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { processVoidSale } from '../utils/voidSaleProcessor';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { BarChart3, TrendingUp, Package, AlertTriangle, ShoppingCart, Store, Users, Settings, Wallet, LogOut } from 'lucide-react';
import { formatBs, formatCop } from '../utils/calculatorUtils';
import DashboardStats from '../components/Dashboard/DashboardStats';
import DashboardPaymentBreakdown from '../components/Dashboard/DashboardPaymentBreakdown';
import SalesHistory from '../components/Dashboard/SalesHistory';
import SalesChart from '../components/Dashboard/SalesChart';
import ConfirmModal from '../components/ConfirmModal';
import CierreCajaWizard from '../components/Dashboard/CierreCajaWizard';
import CierreCajaSummaryModal from '../components/Dashboard/CierreCajaSummaryModal';
import { generateTicketPDF, printThermalTicket } from '../utils/ticketGenerator';
import { shareSaleWhatsApp } from '../utils/dashboardActions';
import { generateDailyClosePDF } from '../utils/dailyCloseGenerator';
import { useNotifications } from '../hooks/useNotifications';
import SyncStatus from '../components/SyncStatus';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { useSecurity } from '../hooks/useSecurity';
import { useAudit } from '../hooks/useAudit';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { getLocalISODate } from '../utils/dateHelpers';
import Skeleton from '../components/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDashboardMetrics } from '../hooks/useDashboardMetrics';
import { TicketClientModal, DeleteHistoryModal, RecycleOfferModal } from '../components/Dashboard/DashboardModals';
import { useReveal } from '../hooks/useReveal';
import MonitorView from './MonitorView';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { useGastosInternos } from '../hooks/useGastosInternos';
import GastosInternosModal from '../components/GastosInternos/GastosInternosModal';

const SALES_KEY = 'bodega_sales_v1';

// Helper para extraer todos los avances (tanto tipo AVANCE_EFECTIVO como los embebidos en VENTA)
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

export default function DashboardView({ rates, triggerHaptic, onNavigate, theme, toggleTheme, isActive, isDemo, demoTimeLeft }) {
    const { notifyCierrePendiente, requestPermission } = useNotifications();
    const { deviceId } = useSecurity();
    const isAdmin = true;
    const isCajero = useAuthStore(s => s.requireLogin && s.usuarioActivo?.rol === 'CAJERO');
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);
    const { log: auditLog } = useAudit();
    const { products, setProducts, isLoadingProducts, effectiveRate: bcvRate, copEnabled, copPrimary, tasaCop } = useProductContext();
    const { loadCart } = useCart();

    // Data loading
    const { sales, setSales, customers, setCustomers, isLoadingLocal, refreshData } = useDashboardData(isActive, requestPermission);
    const isLoading = isLoadingProducts || isLoadingLocal;

    // UI state
    const [showMonitor, setShowMonitor] = useState(false);
    const { isOnline } = useOfflineQueue();
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [voidSaleTarget, setVoidSaleTarget] = useState(null);
    const [isCashReconOpen, setIsCashReconOpen] = useState(false);
    const [ticketPendingSale, setTicketPendingSale] = useState(null);
    const [ticketClientName, setTicketClientName] = useState('');
    const [ticketClientPhone, setTicketClientPhone] = useState('');
    const [ticketClientDocument, setTicketClientDocument] = useState('');
    const [recycleOffer, setRecycleOffer] = useState(null);
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedChartDate, setSelectedChartDate] = useState(null);
    const [showTopDeudas, setShowTopDeudas] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);

    // Escuchar el scroll del contenedor <main> (idéntico a donde juancho)
    useEffect(() => {
        const mainEl = document.querySelector('main');
        const handleScroll = () => {
            if (mainEl) {
                setIsScrolled(mainEl.scrollTop > 10);
            }
        };
        if (mainEl) {
            mainEl.addEventListener('scroll', handleScroll);
        }
        return () => {
            if (mainEl) {
                mainEl.removeEventListener('scroll', handleScroll);
            }
        };
    }, []);
    const [showCierreSummary, setShowCierreSummary] = useState(false);
    const [cierreSummaryData, setCierreSummaryData] = useState(null);
    const touchStartY = useRef(0);
    const scrollRef = useRef(null);
    // v1.2.0: reveal-on-scroll para cards de stats y secciones principales.
    const revealRef = useReveal();
    // Combina scrollRef (pull-to-refresh) + revealRef (IntersectionObserver) en un solo nodo.
    const setRootRef = (node) => {
        scrollRef.current = node;
        revealRef.current = node;
    };

    // Reloj digital y fecha en tiempo real
    const [currentTime, setCurrentTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const timeString = currentTime.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateString = currentTime.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
    const formattedDate = dateString.charAt(0).toUpperCase() + dateString.slice(1);

    // Metrics
    const {
        today, todaySales, todayCashFlow, todayApertura,
        todayTotalBs, todayTotalUsd, todayTotalCop, todayItemsSold,
        todayExpenses, todayExpensesUsd, todayGastos, todayGastosUsd, todayProfit,
        getRecentSales, weekData, outOfStockProducts, lowStockProducts,
        totalDeudas, topProducts, paymentBreakdown, todayTopProducts, inventoryMetrics,
        todayReceivables,
    } = useDashboardMetrics(sales, customers, products, bcvRate);

    // Gastos Internos
    const {
        isAddGastoOpen,
        setIsAddGastoOpen,
        registrarGasto,
        registrarAutoconsumo,
        anularGasto
    } = useGastosInternos({
        bcvRate,
        tasaCop,
        copEnabled,
        triggerHaptic,
        auditLog,
        sales,
        setSales
    });

    const recentSales = useMemo(() => getRecentSales(selectedChartDate), [getRecentSales, selectedChartDate]);

    // Notificar cierre de caja pendiente (>7pm con ventas o cobros sin cerrar)
    useEffect(() => {
        if (todayCashFlow.length > 0) {
            const ventasHoy = todayCashFlow.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            const deudasHoy = todayCashFlow.filter(s => s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA');
            notifyCierrePendiente({
                salesCount: ventasHoy.length || todayCashFlow.length,
                totalUsd: todayTotalUsd,
                totalBs: todayTotalBs,
                totalDeudas,
                deudasCount: deudasHoy.length,
            });
        }
    }, [todayCashFlow.length, notifyCierrePendiente, todayTotalUsd, todayTotalBs, totalDeudas]);

    // ── Funciones de Historial Avanzado ──
    const handleVoidSale = async (sale) => {
        setVoidSaleTarget(sale);
    };

    const confirmVoidSale = async () => {
        const sale = voidSaleTarget;
        if (!sale) return;
        setVoidSaleTarget(null);

        try {
            const { updatedSales, updatedProducts, updatedCustomers } = await processVoidSale(sale, sales, products);
            setSales(updatedSales);
            setProducts(updatedProducts);
            setCustomers(updatedCustomers);
            showToast('Venta anulada con éxito', 'success');
            setRecycleOffer(sale);
        } catch (error) {
            console.error('Error anulando venta:', error);
            showToast('Hubo un problema anulando la venta', 'error');
        }
    };

    const handleShareWhatsApp = (sale) => {
        const saleCustomer = sale.customerId ? customers.find(c => c.id === sale.customerId) : null;
        shareSaleWhatsApp(sale, saleCustomer, bcvRate);
    };

    const handleDownloadPDF = (sale) => {
        triggerHaptic();
        generateTicketPDF(sale, bcvRate);
    };

    const handlePrintTicket = (sale) => {
        triggerHaptic();
        printThermalTicket(sale, bcvRate);
    };

    // ── Registrar cliente para ticket ──
    const handleRegisterClientForTicket = async () => {
        if (!ticketClientName.trim() || !ticketPendingSale) return;

        const newCustomer = {
            id: crypto.randomUUID(),
            name: ticketClientName.trim(),
            documentId: ticketClientDocument.trim() || '',
            phone: ticketClientPhone.trim() || '',
            deuda: 0,
            favor: 0,
            createdAt: new Date().toISOString(),
        };

        const updatedCustomers = [...customers, newCustomer];
        setCustomers(updatedCustomers);
        await storageService.setItem('bodega_customers_v1', updatedCustomers);

        const updatedSale = {
            ...ticketPendingSale,
            customerId: newCustomer.id,
            customerName: newCustomer.name,
            customerPhone: newCustomer.phone,
        };
        const updatedSales = sales.map(s => s.id === updatedSale.id ? updatedSale : s);
        setSales(updatedSales);
        await storageService.setItem(SALES_KEY, updatedSales);

        setTicketPendingSale(null);
        setTicketClientName('');
        setTicketClientPhone('');
        setTicketClientDocument('');
        handleShareWhatsApp(updatedSale);
    };

    // Handler: Cierre de Caja
    const handleDailyClose = () => {
        triggerHaptic && triggerHaptic();
        if (todayCashFlow.length === 0 && todaySales.length === 0) {
            showToast('No hay movimientos hoy para cerrar caja', 'error');
            return;
        }
        setIsCashReconOpen(true);
    };

    const handleConfirmCashRecon = async (reconData) => {
        let summaryObj = null;
        const activeUser = useAuthStore.getState().usuarioActivo;

        if (todayCashFlow.length > 0 || todaySales.length > 0) {
            const allTodayForReport = sales.filter(s => {
                const saleLocalDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : getLocalISODate(new Date());
                return saleLocalDay === today && !s.cajaCerrada && s.tipo !== 'APERTURA_CAJA';
            });
            const salesForPDF = todayCashFlow.filter(s => s.tipo !== 'APERTURA_CAJA');

            const todayAdvances = extractAdvancesFromSales(todayCashFlow);
            const totalAdvancesEfectivoBs = todayAdvances.filter(a => a.currency === 'BS').reduce((sum, a) => sum + (a.montoEfectivo || 0), 0);
            const totalAdvancesEfectivoUsd = todayAdvances.filter(a => a.currency === 'USD').reduce((sum, a) => sum + (a.montoEfectivo || 0), 0);
            const totalAdvancesComisionBs = todayAdvances.filter(a => a.currency === 'BS').reduce((sum, a) => sum + (a.montoComision || 0), 0);
            const totalAdvancesComisionUsd = todayAdvances.filter(a => a.currency === 'USD').reduce((sum, a) => sum + (a.montoComision || 0), 0);

            summaryObj = {
                sales: salesForPDF,
                allSales: allTodayForReport,
                bcvRate,
                paymentBreakdown,
                topProducts: todayTopProducts,
                todayTotalUsd,
                todayTotalBs,
                todayProfit,
                todayItemsSold,
                reconData,
                apertura: todayApertura,
                // FIA-CIERRE-001: la cartera al cierre (stock) no se puede derivar de
                // las ventas del día; se pasa desde las métricas de clientes.
                carteraUsd: totalDeudas?.totalUsd ?? null,
                copEnabled,
                tasaCop,
                advances: {
                    count: todayAdvances.length,
                    totalEfectivoBs: totalAdvancesEfectivoBs,
                    totalEfectivoUsd: totalAdvancesEfectivoUsd,
                    totalComisionBs: totalAdvancesComisionBs,
                    totalComisionUsd: totalAdvancesComisionUsd
                }
            };
            setCierreSummaryData(summaryObj);
        }

        const currentCierreId = new Date().getTime();
        const existingCloses = sales.filter(s => s.tipo === 'REGISTRO_CIERRE');
        const cierreNumber = existingCloses.reduce((mx, s) => Math.max(mx, s.cierreNumber || 0), 0) + 1;
        const validTiposParaCerrar = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA', 'COBRO_DEUDA', 'COBRO_CASHEA', 'PAGO_PROVEEDOR', 'GASTO_INTERNO', 'APERTURA_CAJA', 'AVANCE_EFECTIVO'];
        
        // Registrar el cierre formalmente en el log de transacciones para sincronización con el supervisor
        let registroCierre = null;
        if (summaryObj) {
            const todayAdvances = extractAdvancesFromSales(todayCashFlow);
            const totalAdvancesEfectivoBs = todayAdvances.filter(a => a.currency === 'BS').reduce((sum, a) => sum + (a.montoEfectivo || 0), 0);
            const totalAdvancesEfectivoUsd = todayAdvances.filter(a => a.currency === 'USD').reduce((sum, a) => sum + (a.montoEfectivo || 0), 0);
            const totalAdvancesComisionBs = todayAdvances.filter(a => a.currency === 'BS').reduce((sum, a) => sum + (a.montoComision || 0), 0);
            const totalAdvancesComisionUsd = todayAdvances.filter(a => a.currency === 'USD').reduce((sum, a) => sum + (a.montoComision || 0), 0);

            registroCierre = {
                id: `cierre_${currentCierreId}`,
                tipo: 'REGISTRO_CIERRE',
                cierreId: currentCierreId,
                cierreNumber: cierreNumber,
                timestamp: new Date().toISOString(),
                cajaCerrada: true,
                summary: {
                    todayTotalUsd,
                    todayTotalBs,
                    todayProfit,
                    todayItemsSold,
                    reconData,
                    copEnabled,
                    tasaCop,
                    cashier: {
                        nombre: activeUser?.nombre || 'Cajero',
                        rol: activeUser?.rol || 'CAJERO'
                    },
                    advances: {
                        count: todayAdvances.length,
                        totalEfectivoBs: totalAdvancesEfectivoBs,
                        totalEfectivoUsd: totalAdvancesEfectivoUsd,
                        totalComisionBs: totalAdvancesComisionBs,
                        totalComisionUsd: totalAdvancesComisionUsd
                    }
                }
            };
        }

        const updatedSales = sales.map(s => {
            if (!s.cajaCerrada && validTiposParaCerrar.includes(s.tipo || 'VENTA')) {
                return { ...s, cajaCerrada: true, cierreId: currentCierreId };
            }
            return s;
        });

        if (registroCierre) {
            updatedSales.push(registroCierre);
        }

        await storageService.setItem(SALES_KEY, updatedSales);
        setSales(updatedSales);
        setIsCashReconOpen(false);

        if (summaryObj) {
            setShowCierreSummary(true);
        } else {
            showToast('Cierre de caja completado (Sin movimientos)', 'success');
        }

        auditLog('VENTA', 'CIERRE_CAJA', 'Cierre de caja completado');
    };

    if (isLoading) {
        return (
            <div className="flex-1 p-3 sm:p-6 space-y-4">
                <Skeleton className="h-14 w-40 rounded-2xl" />
                <div className="grid grid-cols-3 gap-3">
                    <Skeleton className="h-24 rounded-2xl" />
                    <Skeleton className="h-24 rounded-2xl" />
                    <Skeleton className="h-24 rounded-2xl" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-32 rounded-3xl" />
                    <Skeleton className="h-32 rounded-3xl" />
                </div>
                <Skeleton className="h-48 rounded-3xl" />
                <Skeleton className="h-24 rounded-2xl" />
            </div>
        );
    }

    // Pull-to-refresh handlers
    const handleTouchStart = (e) => {
        if (scrollRef.current?.scrollTop === 0) {
            touchStartY.current = e.touches[0].clientY;
        }
    };
    const handleTouchMove = (e) => {
        if (scrollRef.current?.scrollTop > 0) return;
        const diff = e.touches[0].clientY - touchStartY.current;
        if (diff > 0) setPullDistance(Math.min(diff * 0.4, 80));
    };
    const handleTouchEnd = async () => {
        if (pullDistance > 60) {
            setIsRefreshing(true);
            try {
                await refreshData();
            } catch (err) {
                console.warn('[DashboardView] Pull-to-refresh error:', err);
            } finally {
                setIsRefreshing(false);
            }
        }
        setPullDistance(0);
    };

    return (
        <div
            ref={setRootRef}
            className="flex flex-col bg-surface-50 dark:bg-surface-950 p-3 sm:p-5 lg:p-6 xl:p-8"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Pull-to-refresh indicator */}
            {(pullDistance > 0 || isRefreshing) && (
                <div className="flex justify-center pb-3 transition-all" style={{ height: pullDistance > 0 ? pullDistance : 40 }}>
                    <div className={`w-6 h-6 rounded-full border-2 border-slate-300 dark:border-slate-700 border-t-brand ${isRefreshing || pullDistance > 60 ? 'animate-spin-slow' : ''}`}
                        style={{ opacity: Math.min(pullDistance / 60, 1), transform: `rotate(${pullDistance * 4}deg)` }}
                    />
                </div>
            )}

            {/* Header Sticky con 5 Fichas Integradas (estilo donde juancho - Glassmorphism & Scroll reactive) */}
            <div className={`sticky top-0 z-30 flex flex-col transition-all duration-200 -mx-3 sm:-mx-5 lg:-mx-6 xl:-mx-8 px-3 sm:px-5 lg:px-6 xl:px-8 py-2 mb-4 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur-md border-b ${isScrolled ? 'border-slate-200/80 dark:border-slate-800/80 shadow-md' : 'border-transparent'}`}>
                {/* Fila Superior: Reloj | Logo | SyncStatus */}
                <div className="flex md:grid md:grid-cols-3 items-center justify-between">
                    {/* Reloj y fecha en PC */}
                    <div className="hidden md:flex flex-col items-start gap-1">
                        <span className="text-xl font-display font-bold italic text-slate-800 dark:text-white leading-none">
                            {timeString}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider leading-none">
                            {formattedDate}
                        </span>
                    </div>
                    <div className="flex flex-col items-start md:items-center justify-center gap-0.5 shrink min-w-0">
                        <img src={theme === 'dark' ? './logodark.png' : './logo.png'} alt="PreciosAlDía" className="h-10 sm:h-12 md:h-[85px] w-auto object-contain drop-shadow-sm shrink-0" />
                    </div>
                    <div className="flex items-center justify-end gap-1.5 shrink-0">
                        <SyncStatus />

                        {useAuthStore.getState().requireLogin && useAuthStore.getState().usuarioActivo && (
                            <button
                                onClick={() => {
                                    triggerHaptic && triggerHaptic();
                                    useAuthStore.getState().logout();
                                }}
                                className="h-8 min-h-[32px] px-2.5 sm:px-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200/60 dark:border-rose-900/50 rounded-full sm:rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 shadow-sm shrink-0"
                                title={`Cerrar sesión (${useAuthStore.getState().usuarioActivo?.nombre})`}
                            >
                                <LogOut size={15} className="text-rose-500 shrink-0" />
                                <span className="hidden sm:inline text-xs font-bold">Salir</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Fila Inferior: 4 Fichas Pro (Visibles en Tablet/Desktop sm:grid) */}
                <div className="hidden sm:grid sm:grid-cols-4 gap-1 sm:gap-3 mt-2 pt-2 border-t border-slate-200/40 dark:border-slate-800/40 w-full max-w-4xl mx-auto">
                    <button
                        onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('ventas'); } }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 px-1 sm:px-3 py-1.5 sm:py-2 bg-[#01696f] hover:bg-[#00575d] dark:bg-[#1ce2ee] dark:hover:bg-[#0bc2cd] text-white dark:text-slate-950 rounded-xl font-extrabold text-[9.5px] sm:text-xs leading-tight transition-all active:scale-95 shadow-sm text-center"
                    >
                        <ShoppingCart size={17} className="shrink-0" />
                        <span className="truncate sm:whitespace-nowrap">Vender</span>
                    </button>
                    <button
                        onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('catalogo'); } }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 px-1 sm:px-3 py-1.5 sm:py-2 bg-[#01696f] hover:bg-[#00575d] dark:bg-[#1ce2ee] dark:hover:bg-[#0bc2cd] text-white dark:text-slate-950 rounded-xl font-extrabold text-[9.5px] sm:text-xs leading-tight transition-all active:scale-95 shadow-sm text-center"
                    >
                        <Store size={17} className="shrink-0" />
                        <span className="truncate sm:whitespace-nowrap">Inventario</span>
                    </button>
                    <button
                        onClick={() => { if (onNavigate) { triggerHaptic(); onNavigate('clientes'); } }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 px-1 sm:px-3 py-1.5 sm:py-2 bg-[#01696f] hover:bg-[#00575d] dark:bg-[#1ce2ee] dark:hover:bg-[#0bc2cd] text-white dark:text-slate-950 rounded-xl font-extrabold text-[9.5px] sm:text-xs leading-tight transition-all active:scale-95 shadow-sm text-center"
                    >
                        <Users size={17} className="shrink-0" />
                        <span className="truncate sm:whitespace-nowrap">Clientes</span>
                    </button>
                    <button
                        onClick={() => { triggerHaptic(); setShowMonitor(true); }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 px-1 sm:px-3 py-1.5 sm:py-2 bg-[#01696f] hover:bg-[#00575d] dark:bg-[#1ce2ee] dark:hover:bg-[#0bc2cd] text-white dark:text-slate-950 rounded-xl font-extrabold text-[9.5px] sm:text-xs leading-tight transition-all active:scale-95 shadow-sm text-center"
                    >
                        <TrendingUp size={17} className="shrink-0" />
                        <span className="truncate sm:whitespace-nowrap">Monitor</span>
                    </button>
                </div>
            </div>

            {/* Componente de historial de ventas reutilizable para Cajero y Admin */}
            {(() => {
                const salesHistoryComponent = (
                    <SalesHistory
                        sales={sales}
                        recentSales={recentSales}
                        todaySales={todaySales}
                        bcvRate={bcvRate}
                        totalSalesCount={sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA').length}
                        isAdmin={!isCajero}
                        onVoidSale={handleVoidSale}
                        onShareWhatsApp={handleShareWhatsApp}
                        onDownloadPDF={handleDownloadPDF}
                        onOpenDeleteModal={() => setIsDeleteModalOpen(true)}
                        onRequestClientForTicket={(sale) => {
                            triggerHaptic && triggerHaptic();
                            setTicketPendingSale(sale);
                        }}
                        onRecycleSale={(sale) => {
                            triggerHaptic && triggerHaptic();
                            loadCart(sale.items);
                            if (onNavigate) onNavigate('ventas');
                        }}
                        onPrintTicket={handlePrintTicket}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        tasaCop={tasaCop}
                    />
                );

                return isCajero ? (
                    <div className="space-y-4 mb-8">
                        {/* Hero Card de Acción Rápida para el Cajero */}
                        <div className="p-4 sm:p-5 rounded-2xl border border-brand/20 dark:border-brand/30 bg-gradient-to-br from-brand/5 via-white to-brand/10 dark:from-surface-900 dark:via-surface-900 dark:to-surface-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3.5">
                                <div className="w-12 h-12 rounded-2xl bg-brand text-white flex items-center justify-center shadow-md shadow-brand/20 shrink-0">
                                    <ShoppingCart size={24} />
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white leading-snug">
                                        Caja Activa · {usuarioActivo?.nombre || 'Cajero'}
                                    </h2>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Tasa oficial: <span className="font-semibold text-slate-700 dark:text-slate-200">{formatBs(bcvRate)} Bs/$</span>
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => { if (onNavigate) { triggerHaptic && triggerHaptic(); onNavigate('ventas'); } }}
                                className="w-full sm:w-auto px-5 py-2.5 bg-[#01696f] hover:bg-[#00575d] dark:bg-[#1ce2ee] dark:hover:bg-[#0bc2cd] text-white dark:text-slate-950 font-extrabold text-sm rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                                <ShoppingCart size={18} />
                                <span>Ir a Caja / Vender</span>
                            </button>
                        </div>

                        {/* Resumen del Turno (Sin clase .reveal que causaba opacidad cero) */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="card !p-4 !rounded-2xl relative overflow-hidden bg-white dark:bg-surface-900 border border-slate-200/70 dark:border-slate-800 shadow-sm">
                                <div className="w-9 h-9 bg-brand-light dark:bg-surface-800/30 rounded-xl flex items-center justify-center mb-2">
                                    <ShoppingCart size={18} className="text-brand" />
                                </div>
                                <p className="font-outfit text-3xl sm:text-4xl font-semibold text-surface-700 dark:text-surface-100 leading-none">{todaySales.length}</p>
                                <p className="text-[11px] font-medium text-surface-400 mt-1">{todaySales.length === 1 ? 'venta hoy' : 'ventas hoy'}</p>
                            </div>
                            <div className="card !p-4 !rounded-2xl relative overflow-hidden bg-white dark:bg-surface-900 border border-slate-200/70 dark:border-slate-800 shadow-sm">
                                <div className="w-9 h-9 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center mb-2">
                                    <Package size={18} className="text-emerald-500" />
                                </div>
                                <p className="font-outfit text-3xl sm:text-4xl font-semibold text-surface-700 dark:text-surface-100 leading-none">{todayItemsSold}</p>
                                <p className="text-[11px] font-medium text-surface-400 mt-1">{todayItemsSold === 1 ? 'artículo vendido' : 'artículos vendidos'}</p>
                            </div>
                        </div>

                        {/* Historial de ventas del turno para reimprimir tickets */}
                        {salesHistoryComponent}
                    </div>
                ) : (
                    <div className={`${(outOfStockProducts.length > 0 || lowStockProducts.length > 0 || topProducts.length > 0) ? 'lg:grid lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px] lg:gap-6 lg:items-start' : ''}`}>

                {/* LEFT: Stats + Payment + Chart */}
                <div>
                {/* Stats Cards */}
                <DashboardStats
                    isDemo={isDemo}
                    demoTimeLeft={demoTimeLeft}
                    deviceId={deviceId}
                    todayTotalUsd={todayTotalUsd}
                    todayTotalBs={todayTotalBs}
                    todayTotalCop={todayTotalCop}
                    todaySales={todaySales}
                    todayItemsSold={todayItemsSold}
                    todayExpenses={todayExpenses}
                    todayExpensesUsd={todayExpensesUsd}
                    todayGastosUsd={todayGastosUsd}
                    todayProfit={todayProfit}
                    bcvRate={bcvRate}
                    todayCashFlow={todayCashFlow}
                    totalDeudas={totalDeudas}
                    showTopDeudas={showTopDeudas}
                    setShowTopDeudas={setShowTopDeudas}
                    triggerHaptic={triggerHaptic}
                    onDailyClose={handleDailyClose}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                    onTasaClick={() => setShowMonitor(true)}
                    onOpenGasto={() => setIsAddGastoOpen(true)}
                />

                {/* Pago por Metodo */}
                <DashboardPaymentBreakdown
                    paymentBreakdown={paymentBreakdown}
                    receivables={todayReceivables}
                    todayTotalBs={todayTotalBs}
                    bcvRate={bcvRate}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                />

                {/* Gráfica semanal */}
                <SalesChart
                    weekData={weekData}
                    selectedDate={selectedChartDate}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    tasaCop={tasaCop}
                    bcvRate={bcvRate}
                    onDayClick={(date) => {
                        triggerHaptic();
                        setSelectedChartDate(prev => prev === date ? null : date);
                        setTimeout(() => {
                            window.scrollBy({ top: 150, behavior: 'smooth' });
                        }, 50);
                    }}
                />

                {/* Historial de ventas — integrado en la columna izquierda para eliminar espacios vacíos */}
                {salesHistoryComponent}

                </div>{/* end LEFT column */}

            {/* RIGHT: Inventory Valuation + Out of stock + Low stock + Top products */}
            <div>
            {/* Valoración del Inventario — Tarjeta Ejecutiva */}
            {inventoryMetrics && inventoryMetrics.totalRetailUsd > 0 && (
                <div className="bg-surface dark:bg-surface-100 rounded-2xl p-4 border border-emerald-200 dark:border-emerald-800/30 shadow-tone-sm mb-5 relative overflow-hidden">
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-50 dark:bg-emerald-900/10 rounded-full blur-2xl"></div>
                    <div className="flex items-center justify-between mb-2 relative z-10">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black">
                                $
                            </div>
                            <div>
                                <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase">Capital en Inventario</h3>
                                <p className="text-[10px] text-slate-400">Valoración total a PVP</p>
                            </div>
                        </div>
                        <span className="text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                            {inventoryMetrics.marginPct.toFixed(1)}% Margen
                        </span>
                    </div>

                    <div className="mt-3 relative z-10">
                        <p className="text-2xl font-outfit font-black text-slate-800 dark:text-white">
                            ${inventoryMetrics.totalRetailUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        {copEnabled && tasaCop > 0 ? (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                                {formatCop(inventoryMetrics.totalRetailUsd * tasaCop)} COP · {formatBs(inventoryMetrics.totalRetailUsd * bcvRate)} Bs
                            </p>
                        ) : (
                            <p className="text-[10px] text-slate-400 mt-0.5">{formatBs(inventoryMetrics.totalRetailUsd * bcvRate)} Bs</p>
                        )}

                        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 gap-2 text-[10px]">
                            <div>
                                <span className="text-slate-400 font-medium block">Costo Inversión:</span>
                                <span className="font-bold text-slate-600 dark:text-slate-300">
                                    ${inventoryMetrics.totalCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div>
                                <span className="text-emerald-500 font-medium block">Ganancia Proyectada:</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                    +${inventoryMetrics.totalProfitUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Sin Stock — Tarjeta Roja */}
            {outOfStockProducts.length > 0 && (
                <div className="bg-surface dark:bg-surface-100 rounded-2xl p-4 border border-red-200 dark:border-red-800/30 shadow-tone-sm mb-5">
                    <h3 className="text-xs font-bold text-red-500 uppercase mb-3 flex items-center gap-1">
                        <AlertTriangle size={12} className="text-red-500" /> Sin Stock ({outOfStockProducts.length})
                    </h3>
                    <div className="space-y-2">
                        {outOfStockProducts.map(p => (
                            <div key={p.id} className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                    {p.image ? <img src={p.image} className="w-full h-full object-contain" /> : <Package size={14} className="text-slate-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                </div>
                                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                    {p.stock ?? 0} {p.unit === 'kg' ? 'kg' : p.unit === 'litro' ? 'lt' : 'ud'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Bajo Stock — Tarjeta Ámbar */}
            {lowStockProducts.length > 0 && (
                <div className="bg-surface dark:bg-surface-100 rounded-2xl p-4 border border-amber-200 dark:border-amber-800/30 shadow-tone-sm mb-5">
                    <h3 className="text-xs font-bold text-amber-500 uppercase mb-3 flex items-center gap-1">
                        <AlertTriangle size={12} className="text-amber-500" /> Bajo Stock ({lowStockProducts.length})
                    </h3>
                    <div className="space-y-2">
                        {lowStockProducts.map(p => (
                            <div key={p.id} className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                    {p.image ? <img src={p.image} className="w-full h-full object-contain" /> : <Package size={14} className="text-slate-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                </div>
                                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                                    {p.stock ?? 0} {p.unit === 'kg' ? 'kg' : p.unit === 'litro' ? 'lt' : 'ud'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Productos — v1.2.0: reveal + shadow-tone-sm, text-accent para Bs (BCV-derived) */}
            {topProducts.length > 0 && (
                <div className="bg-surface dark:bg-surface-100 rounded-2xl p-4 border border-surface-200 dark:border-surface-700 shadow-tone-sm mb-5">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-1">
                        <TrendingUp size={12} /> Más Vendidos
                    </h3>
                    <div className="space-y-2">
                        {topProducts.map((p, i) => (
                            <div key={p.name} className="flex items-center gap-3">
                                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black ${i === 0 ? 'bg-amber-100 text-amber-600' : i === 1 ? 'bg-slate-200 text-slate-500' : 'bg-orange-50 text-orange-400'
                                    }`}>{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{p.qty} vendidos</p>
                                    <p className={`text-[10px] ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                                        {copEnabled && copPrimary && tasaCop > 0
                                            ? `${formatCop(p.revenue * tasaCop)} COP`
                                            : `$${p.revenue.toFixed(2)}`}
                                    </p>
                                    {/* v1.2.0: Bs (BCV-derived) destacado con text-accent-600 */}
                                    {copEnabled && tasaCop > 0
                                        ? <p className="text-[10px] text-accent-600 dark:text-accent-400">
                                            {copPrimary
                                                ? `$${p.revenue.toFixed(2)} · ${formatBs(p.revenue * bcvRate)} Bs`
                                                : `${formatCop(p.revenue * tasaCop)} COP · ${formatBs(p.revenue * bcvRate)} Bs`}
                                           </p>
                                        : <p className="text-[10px] text-accent-600 dark:text-accent-400">{formatBs(p.revenue * bcvRate)} Bs</p>
                                    }
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            </div>
            </div>
        );
    })()}

            {/* Empty state */}
            {sales.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 py-10 space-y-3">
                    <BarChart3 size={64} strokeWidth={1} />
                    <p className="text-sm font-medium">Sin datos aún</p>
                    <p className="text-xs text-slate-400">Las estadísticas aparecerán cuando hagas tu primera venta</p>
                </div>
            )}

            {/* Modals */}
            <TicketClientModal
                ticketPendingSale={ticketPendingSale}
                ticketClientName={ticketClientName}
                ticketClientPhone={ticketClientPhone}
                ticketClientDocument={ticketClientDocument}
                setTicketClientName={setTicketClientName}
                setTicketClientPhone={setTicketClientPhone}
                setTicketClientDocument={setTicketClientDocument}
                onClose={() => { setTicketPendingSale(null); setTicketClientName(''); setTicketClientPhone(''); setTicketClientDocument(''); }}
                onRegister={handleRegisterClientForTicket}
            />

            <DeleteHistoryModal
                isOpen={isDeleteModalOpen}
                deleteConfirmText={deleteConfirmText}
                setDeleteConfirmText={setDeleteConfirmText}
                onClose={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}
                onConfirm={async () => {
                    if (deleteConfirmText.trim().toUpperCase() === 'BORRAR') {
                        await storageService.setItem(SALES_KEY, []);
                        setIsDeleteModalOpen(false);
                        setDeleteConfirmText('');
                        window.location.reload();
                    }
                }}
            />

            <RecycleOfferModal
                recycleOffer={recycleOffer}
                onClose={() => setRecycleOffer(null)}
                onRecycle={() => {
                    loadCart(recycleOffer.items);
                    setRecycleOffer(null);
                    if (onNavigate) onNavigate('ventas');
                }}
            />

            {/* Modal Confirmación: Anular Venta */}
            <ConfirmModal
                isOpen={!!voidSaleTarget}
                onClose={() => setVoidSaleTarget(null)}
                onConfirm={confirmVoidSale}
                title={`Anular venta #${voidSaleTarget?.id?.substring(0, 6).toUpperCase() || ''}`}
                message={`Esta acción:\n• Marcará la venta como ANULADA\n• Devolverá el stock a la bodega\n• Revertirá deudas o saldos a favor\n\nEsta acción no se puede deshacer.`}
                confirmText="Sí, anular"
                variant="danger"
            />
            <CierreCajaWizard
                isOpen={isCashReconOpen}
                onClose={() => setIsCashReconOpen(false)}
                onConfirm={handleConfirmCashRecon}
                todaySales={todaySales}
                todayTotalUsd={todayTotalUsd}
                todayTotalBs={todayTotalBs}
                todayTotalCop={todayTotalCop}
                todayProfit={todayProfit}
                todayItemsSold={todayItemsSold}
                todayExpensesUsd={todayExpensesUsd}
                paymentBreakdown={paymentBreakdown}
                todayTopProducts={todayTopProducts}
                bcvRate={bcvRate}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
                todayCashFlow={todayCashFlow}
            />
            <CierreCajaSummaryModal
                isOpen={showCierreSummary}
                onClose={() => setShowCierreSummary(false)}
                summaryData={cierreSummaryData}
                onPrint={() => {
                    generateDailyClosePDF({ ...cierreSummaryData, action: 'print' });
                }}
                onDownload={() => {
                    generateDailyClosePDF({ ...cierreSummaryData, action: 'download' });
                }}
                onShare={() => {
                    generateDailyClosePDF({ ...cierreSummaryData, action: 'share' });
                }}
            />
            <GastosInternosModal
                isOpen={isAddGastoOpen}
                onClose={() => setIsAddGastoOpen(false)}
                sales={sales}
                products={products}
                bcvRate={bcvRate}
                tasaCop={tasaCop}
                copEnabled={copEnabled}
                registrarGasto={registrarGasto}
                registrarAutoconsumo={registrarAutoconsumo}
                anularGasto={anularGasto}
                triggerHaptic={triggerHaptic}
            />
            {showMonitor && (
                <div className="fixed inset-0 z-[150] bg-[#080E1C] flex flex-col">
                    <MonitorView
                        rates={rates}
                        loading={false}
                        isOffline={!isOnline}
                        onRefresh={() => refreshData()}
                        toggleTheme={toggleTheme}
                        theme={theme}
                        addLog={console.log}
                        triggerHaptic={triggerHaptic}
                        onClose={() => setShowMonitor(false)}
                    />
                </div>
            )}
        </div>
    );
}
