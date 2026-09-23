import { useState, useEffect, useMemo } from 'react';
// v1.2.0: useReveal hook para animaciones reveal-on-scroll (design system "Precios al Día")
import { useReveal } from '../hooks/useReveal';
import { Users, Plus, Search, User, X, Trash2, Pencil, Phone, RefreshCw, Save, ArrowDownRight, ArrowUpRight, Clock, CheckCircle2, CreditCard, ShoppingBag, Truck, Smartphone, Download } from 'lucide-react';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { formatBs, formatUsd, formatCop } from '../utils/calculatorUtils';
import { applyCustomerMovement } from '../services/customerWalletService';
import { CUSTOMER_MOVEMENT_TYPES, CUSTOMER_LEDGER_KEY } from '../utils/customerLedger';
import { buildCustomerCreditLens, fiadoCustomerIds } from '../utils/customerCreditLens';
import TransactionModal from '../components/Customers/TransactionModal';
import { processCustomerTransaction } from '../utils/customerTransactionProcessor';
import { DEFAULT_PAYMENT_METHODS } from '../config/paymentMethods';
import { processCasheaRemittance } from '../utils/casheaRemittanceProcessor';
import CasheaRemittanceModal from '../components/Customers/CasheaRemittanceModal';
import ConfirmModal from '../components/ConfirmModal';
import EmptyState from '../components/EmptyState';
import SwipeableItem from '../components/SwipeableItem';
import { useProductContext } from '../context/ProductContext';
import { useAudit } from '../hooks/useAudit';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useSupplierManagement } from '../hooks/useSupplierManagement';
import { usePagination } from '../hooks/usePagination';
import PaginationBar from '../components/PaginationBar';
import CasheaIcon from '../components/CasheaIcon';

// Importaciones de Proveedores
import SuppliersList from '../components/Suppliers/SuppliersList';
import { AddSupplierModal, AddInvoiceModal, PayInvoiceModal, SupplierDetailsSheet } from '../components/Suppliers/SupplierModals';
import { getActivePaymentMethods } from '../config/paymentMethods';

export default function CustomersView({ triggerHaptic, rates, isActive }) {
    // v1.2.0: reveal-on-scroll para header, filtros y lista de tarjetas.
    const revealRef = useReveal();
    const [customers, setCustomers] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // 'all' | 'deuda' | 'favor' | 'fiadoMes'
    const [ledger, setLedger] = useState([]);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const usuarioActivo = useAuthStore(state => state.usuarioActivo);
    const isAdmin = !usuarioActivo || usuarioActivo.rol === 'ADMIN';
    const isCajero = usuarioActivo?.rol === 'CAJERO';

    // Modal de Abono / Crédito
    const [transactionModal, setTransactionModal] = useState({ isOpen: false, type: null, customer: null }); // type: 'ABONO' | 'CREDITO'
    const [casheaModalCustomer, setCasheaModalCustomer] = useState(null);
    const [transactionAmount, setTransactionAmount] = useState('');
    const [currencyMode, setCurrencyMode] = useState('BS'); // 'BS' | 'USD'
    const [paymentMethod, setPaymentMethod] = useState('efectivo_bs');
    const [activePaymentMethods, setActivePaymentMethods] = useState([]);
    const [resetBalanceCustomer, setResetBalanceCustomer] = useState(null);
    const { effectiveRate: bcvRate, tasaCop, copEnabled, copPrimary } = useProductContext();
    const { log: auditLog } = useAudit();
    const [expandedHistory, setExpandedHistory] = useState(null);
    const [historyData, setHistoryData] = useState([]);
    // Modales de Clientes
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [deleteCustomerTarget, setDeleteCustomerTarget] = useState(null);
    const [detailingTransaction, setDetailingTransaction] = useState(null);

    // Guard: evita eliminar clientes con deuda o saldo a favor pendiente
    const handleDeleteCustomerRequest = (customer) => {
        const deuda = customer.deuda || 0;
        const saldo = customer.favor || 0;
        if (deuda > 0.005) {
            showToast(`No se puede eliminar: ${customer.name} tiene una deuda de $${deuda.toFixed(2)} pendiente.`, 'error');
            return;
        }
        if (saldo > 0.005) {
            showToast(`No se puede eliminar: ${customer.name} tiene un saldo a favor de $${saldo.toFixed(2)}.`, 'error');
            return;
        }
        setDeleteCustomerTarget(customer);
    };

    // ── ESTADOS DE PROVEEDORES ──
    const [activeTab, setActiveTab] = useState('clientes'); // 'clientes' | 'proveedores'

    // Cajero no puede ver proveedores — forzar a clientes si accedió antes
    useEffect(() => {
        if (isCajero && activeTab === 'proveedores') setActiveTab('clientes');
    }, [isCajero, activeTab]);

    const {
        suppliers, invoices, selectedSupplier,
        isAddSupplierModalOpen, editingSupplier,
        isAddInvoiceModalOpen, isPayInvoiceModalOpen,
        deleteSupplierTarget, supplierHistoryData,
        setSelectedSupplier, setIsAddSupplierModalOpen, setEditingSupplier,
        setIsAddInvoiceModalOpen, setIsPayInvoiceModalOpen, setDeleteSupplierTarget,
        handleSaveSupplier, refreshSupplierHistory, handleSelectSupplier,
        handleAddInvoice, handlePayInvoice, handleDeleteSupplier, hydrateSuppliers,
    } = useSupplierManagement({ bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog });

    const loadData = async () => {
        const [savedCustomers, savedSuppliers, savedInvoices, savedMethods, savedLedger] = await Promise.all([
            storageService.getItem('bodega_customers_v1', []),
            storageService.getItem('bodega_suppliers_v1', []),
            storageService.getItem('bodega_supplier_invoices_v1', []),
            getActivePaymentMethods(),
            storageService.getItem(CUSTOMER_LEDGER_KEY, [])
        ]);
        setCustomers(savedCustomers);
        hydrateSuppliers(savedSuppliers, savedInvoices);
        setActivePaymentMethods(savedMethods);
        setLedger(savedLedger);
    };

    useEffect(() => {
        loadData();
    }, []);

    // Re-sincronizar cuando el usuario navega a esta tab para reflejar cambios
    // realizados por otras vistas (e.g. ventas fiadas, abonos desde el ticket)
    useEffect(() => {
        if (isActive) loadData();
    }, [isActive]);

    const saveCustomers = async (updatedCustomers) => {
        setCustomers(updatedCustomers);
        await storageService.setItem('bodega_customers_v1', updatedCustomers);
    };

    // LENTE-CREDITO (H2, opción C): solo lectura del ledger. Expone el crédito
    // extendido del mes aunque la cartera neta no muestre deuda (fiado consumido
    // por saldo a favor). Ver PLAN-LENS-CREDITO-EXTENDIDO.md.
    const creditLens = useMemo(() => buildCustomerCreditLens(ledger, customers), [ledger, customers]);
    const fiadoIdsMes = useMemo(() => fiadoCustomerIds(creditLens), [creditLens]);

    const filteredCustomers = customers.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || (c.phone && c.phone.includes(searchTerm));
        if (!matchesSearch) return false;
        if (filterType === 'deuda') return c.deuda > 0.01;
        if (filterType === 'favor') return c.favor > 0.01;
        if (filterType === 'fiadoMes') return fiadoIdsMes.includes(c.id);
        return true;
    });

    const {
        currentPage,
        totalPages,
        paginatedItems: paginatedCustomers,
        goNext,
        goPrev,
        resetPage,
        hasNext,
        hasPrev,
        startIndex,
        endIndex,
        totalItems,
    } = usePagination(filteredCustomers, 10);

    useEffect(() => {
        resetPage();
    }, [searchTerm, filterType]);

    const toggleHistory = async (customerId) => {
        triggerHaptic && triggerHaptic();
        setExpandedHistory(customerId);
        const allSales = await storageService.getItem('bodega_sales_v1', []);
        const customerSales = allSales
            .filter(s => s.customerId === customerId || s.clienteId === customerId)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 20);
        setHistoryData(customerSales);
    };

    const handleResetBalance = async (customer) => {
        triggerHaptic();
        setResetBalanceCustomer(customer);
    };

    const confirmResetBalance = async () => {
        const customer = resetBalanceCustomer;
        if (!customer) return;

        // casheaDeuda NO se toca: es una cuenta por cobrar A CASHEA, no saldo del
        // cliente. Reiniciar deuda/favor es un ajuste auditable, no una edición directa.
        const freshCustomers = await storageService.getItem('bodega_customers_v1', []);
        const freshCustomer = freshCustomers.find(c => c.id === customer.id);
        const balance = (freshCustomer?.favor || 0) - (freshCustomer?.deuda || 0);
        if (Math.abs(balance) > 0.005) {
            const result = await applyCustomerMovement({
                customerId: customer.id,
                user: usuarioActivo,
                movement: {
                    type: balance > 0 ? CUSTOMER_MOVEMENT_TYPES.DEBIT_ADJUSTMENT : CUSTOMER_MOVEMENT_TYPES.CREDIT_ADJUSTMENT,
                    direction: balance > 0 ? 'DEBIT' : 'CREDIT',
                    amountUsd: Math.abs(balance),
                    sourceType: 'ADMIN_ADJUSTMENT',
                    sourceId: `reset_balance:${customer.id}:${Date.now()}`,
                    reason: 'Reinicio administrativo de saldo a cero',
                },
            });
            setCustomers(result.updatedCustomers);
        }
        showToast(`Saldo reiniciado a cero para ${customer.name}`, 'success');
        auditLog('CLIENTE', 'DEUDA_CONDONADA', `Saldo reiniciado a $0 para ${customer.name}`);
        setResetBalanceCustomer(null);
    };

    // Registra la REMESA que Cashea envía a la bodega. Antes esto solo ponía
    // casheaDeuda en 0 sin registrar dinero, sin monto en auditoría y sin parciales
    // — y además nunca llegó a cablearse a ningún botón.
    const handleCasheaRemittance = async ({ transactionAmount, currencyMode, paymentMethod: metodo }) => {
        triggerHaptic();
        const target = casheaModalCustomer;
        if (!target) return;

        const res = await processCasheaRemittance({
            transactionAmount,
            currencyMode,
            customer: target,
            paymentMethod: metodo,
            bcvRate,
            tasaCop,
            copEnabled,
        });

        if (res?.error) {
            showToast(res.error, 'error');
            return;
        }

        await saveCustomers(res.newCustomers);
        showToast(`Remesa Cashea de $${res.aplicado.toFixed(2)} registrada para ${target.name}`, 'success');
        auditLog('CLIENTE', 'REMESA_CASHEA', `Remesa Cashea de $${res.aplicado.toFixed(2)} recibida por ${target.name}`);
        setCasheaModalCustomer(null);
    };

    const handleTransaction = async () => {
        if (!transactionAmount || isNaN(transactionAmount) || parseFloat(transactionAmount) <= 0) return;
        triggerHaptic();

        const transactionResult = await processCustomerTransaction({
            transactionAmount,
            currencyMode,
            type: transactionModal.type,
            customer: transactionModal.customer,
            paymentMethod,
            bcvRate,
            tasaCop,
            copEnabled
        });

        if (transactionResult?.error) {
            showToast(transactionResult.error, 'error');
            return;
        }
        await saveCustomers(transactionResult.newCustomers);
        showToast(`Operación de ${transactionModal.type} exitosa`, 'success');
        auditLog('CLIENTE', transactionModal.type === 'ABONO' ? 'ABONO_REGISTRADO' : 'CREDITO_REGISTRADO', `${transactionModal.type} de ${transactionAmount} ${currencyMode} para ${transactionModal.customer?.name}`);

        // Cerrar modal
        setTransactionModal({ isOpen: false, type: null, customer: null });
        setTransactionAmount('');
        setCurrencyMode('BS');
        setPaymentMethod('efectivo_bs');
    };

    if (activeTab === 'proveedores') {
        return (
            // v1.2.0: revealRef reutilizado + surface tokens (warm cream).
            <div ref={revealRef} className="flex flex-col h-full bg-surface-50 dark:bg-surface-950 overflow-hidden relative">
                {/* Segmented Control Premium */}
                <div className="px-3 sm:px-6 pt-3 sm:pt-6 shrink-0 z-10 bg-surface-50/80 dark:bg-surface-950/80 backdrop-blur-xl">
                    <div className="flex bg-surface-200/50 dark:bg-surface-800/80 p-1.5 rounded-2xl shadow-inner">
                        <button
                            onClick={() => { setActiveTab('clientes'); triggerHaptic && triggerHaptic(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 min-h-[40px] text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'clientes' ? 'bg-surface dark:bg-surface-900 shadow-tone-sm text-brand-dark dark:text-brand scale-100' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 scale-95 hover:scale-100'}`}
                        >
                            <Users size={18} aria-hidden="true" /> Clientes
                        </button>
                        {!isCajero && (
                            <button
                                onClick={() => { setActiveTab('proveedores'); triggerHaptic && triggerHaptic(); }}
                                className={`flex flex-1 items-center justify-center gap-2 py-2.5 min-h-[40px] text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'proveedores' ? 'bg-surface dark:bg-surface-900 shadow-tone-sm text-brand dark:text-brand scale-100 ring-1 ring-surface-900/5 dark:ring-white/10' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 scale-95 hover:scale-100'}`}
                            >
                                <Truck size={18} aria-hidden="true" /> Proveedores
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    <SuppliersList
                        suppliers={suppliers}
                        invoices={invoices}
                        bcvRate={bcvRate}
                        tasaCop={tasaCop}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        triggerHaptic={triggerHaptic}
                        isAdmin={isAdmin}
                        onAddSupplier={() => setIsAddSupplierModalOpen(true)}
                        onSelectSupplier={handleSelectSupplier}
                        onDeleteSupplier={(s) => setDeleteSupplierTarget(s)}
                    />
                </div>

                {isAddSupplierModalOpen && (
                    <AddSupplierModal 
                        editingSupplier={editingSupplier}
                        onClose={() => { setIsAddSupplierModalOpen(false); setEditingSupplier(null); }} 
                        onSave={handleSaveSupplier} 
                    />
                )}
                {isAddInvoiceModalOpen && selectedSupplier && (
                    <AddInvoiceModal 
                        supplier={selectedSupplier}
                        bcvRate={bcvRate}
                        onClose={() => setIsAddInvoiceModalOpen(false)}
                        onSave={handleAddInvoice}
                    />
                )}
                {isPayInvoiceModalOpen && selectedSupplier && (
                    <PayInvoiceModal
                        supplier={selectedSupplier}
                        bcvRate={bcvRate}
                        tasaCop={tasaCop}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        activePaymentMethods={activePaymentMethods}
                        onClose={() => setIsPayInvoiceModalOpen(false)}
                        onSave={handlePayInvoice}
                    />
                )}
                <SupplierDetailsSheet
                    supplier={selectedSupplier}
                    isOpen={!!selectedSupplier}
                    isAdmin={isAdmin}
                    bcvRate={bcvRate}
                    tasaCop={tasaCop}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    historyData={supplierHistoryData}
                    triggerHaptic={triggerHaptic}
                    onClose={() => setSelectedSupplier(null)}
                    onAddInvoice={() => setIsAddInvoiceModalOpen(true)}
                    onPayInvoice={() => setIsPayInvoiceModalOpen(true)}
                    onEdit={() => { setEditingSupplier(selectedSupplier); setIsAddSupplierModalOpen(true); }}
                    onDelete={() => setDeleteSupplierTarget(selectedSupplier)}
                />
                <ConfirmModal
                    isOpen={!!deleteSupplierTarget}
                    onClose={() => setDeleteSupplierTarget(null)}
                    onConfirm={handleDeleteSupplier}
                    title="Eliminar Proveedor"
                    message={deleteSupplierTarget ? `¿Eliminar a ${deleteSupplierTarget.name}? Esta acción no se puede deshacer.` : ''}
                    confirmText="Sí, eliminar"
                    variant="danger"
                />
            </div>
        );
    }

    return (
        // v1.2.0: revealRef + surface tokens (warm cream).
        <div ref={revealRef} className="flex flex-col h-full bg-surface-50 dark:bg-surface-950 overflow-hidden relative">
            {/* Segmented Control Premium */}
            <div className="px-3 sm:px-6 pt-3 sm:pt-6 shrink-0 z-10 bg-surface-50/80 dark:bg-surface-950/80 backdrop-blur-xl">
                <div className="flex bg-surface-200/50 dark:bg-surface-800/80 p-1.5 rounded-2xl shadow-inner">
                    <button
                        onClick={() => { setActiveTab('clientes'); triggerHaptic && triggerHaptic(); }}
                        className={`flex flex-1 items-center justify-center gap-2 py-2.5 min-h-[40px] text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'clientes' ? 'bg-surface dark:bg-surface-900 shadow-tone-sm text-brand-dark dark:text-brand scale-100 ring-1 ring-surface-900/5 dark:ring-white/10' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 scale-95 hover:scale-100'}`}
                    >
                        <Users size={18} aria-hidden="true" /> Clientes
                    </button>
                    {!isCajero && (
                        <button
                            onClick={() => { setActiveTab('proveedores'); triggerHaptic && triggerHaptic(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 min-h-[40px] text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'proveedores' ? 'bg-surface dark:bg-surface-900 shadow-tone-sm text-brand dark:text-brand scale-100' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 scale-95 hover:scale-100'}`}
                        >
                            <Truck size={18} aria-hidden="true" /> Proveedores
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide p-3 sm:p-6 pb-20">
                {/* Header Clientes */}
            <div className="reveal shrink-0 mb-5 flex justify-between items-start">
                <div>
                    {/* v1.2.0: text-surface-700 en vez de slate-700 (warm tone) */}
                    <h2 className="text-2xl font-black text-surface-700 dark:text-white tracking-tight flex items-center gap-2">
                        <Users size={26} className="text-brand" aria-hidden="true" /> Contactos
                    </h2>
                    <p className="text-sm text-surface-400 font-medium ml-1">
                        Deudas y Saldos a Favor
                    </p>
                </div>
                {/* v1.2.0: touch target ≥ 48px + shadow-primary-tone */}
                <button
                    onClick={() => { triggerHaptic(); setIsAddModalOpen(true); }}
                    className="p-3 min-h-[48px] bg-brand text-white rounded-2xl shadow-primary-tone hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                    <Plus size={20} className="shrink-0" aria-hidden="true" />
                    <span className="text-sm font-bold hidden sm:inline">Nuevo Contacto</span>
                </button>
            </div>

            {/* Búsqueda y Filtros */}
            <div className="reveal mb-5 shrink-0 flex flex-col gap-3">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400" size={20} aria-hidden="true" />
                    <input
                        type="text"
                        placeholder="Buscar cliente..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input w-full bg-surface dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl pl-11 pr-4 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 shadow-tone-sm"
                    />
                </div>
                {/* LENTE-CREDITO: resumen del mes (solo si hubo fiados). */}
                {creditLens.totalFiadoMes > 0.001 && (
                    <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 flex-wrap">
                        <Clock size={12} aria-hidden="true" />
                        <span>
                            Crédito extendido este mes: {formatUsd(creditLens.totalFiadoMes)}
                            {creditLens.totalConsumoFavorMes > 0.001 && ` · ${formatUsd(creditLens.totalConsumoFavorMes)} cubierto con saldo a favor`}
                        </span>
                    </p>
                )}
                {/* Filtros tipo Chips */}
                {/* v1.2.0: chips con min-h-[40px] (a11y) + surface tokens + .badge classes opcional. */}
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                    <button
                        onClick={() => { setFilterType('all'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-sm font-bold whitespace-nowrap transition-colors ${filterType === 'all' ? 'bg-brand text-white shadow-primary-tone' : 'bg-surface dark:bg-surface-900 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-800'}`}
                    >
                        Todos
                    </button>
                    <button
                        onClick={() => { setFilterType('deuda'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${filterType === 'deuda' ? 'bg-red-500 text-white shadow-tone-sm' : 'bg-surface dark:bg-surface-900 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-800'}`}
                    >
                        <div className={`w-2 h-2 rounded-full ${filterType === 'deuda' ? 'bg-white' : 'bg-red-500'}`}></div>
                        Con Deuda
                    </button>
                    <button
                        onClick={() => { setFilterType('favor'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${filterType === 'favor' ? 'bg-emerald-500 text-white shadow-tone-sm' : 'bg-surface dark:bg-surface-900 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-800'}`}
                    >
                        <div className={`w-2 h-2 rounded-full ${filterType === 'favor' ? 'bg-white' : 'bg-emerald-500'}`}></div>
                        Saldo a Favor
                    </button>
                    <button
                        onClick={() => { setFilterType('fiadoMes'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${filterType === 'fiadoMes' ? 'bg-amber-500 text-white shadow-tone-sm' : 'bg-surface dark:bg-surface-900 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-800'}`}
                    >
                        <div className={`w-2 h-2 rounded-full ${filterType === 'fiadoMes' ? 'bg-white' : 'bg-amber-500'}`}></div>
                        Fiados del mes
                    </button>
                </div>
            </div>

            {/* Listado de Clientes */}
            <div className="flex-1 space-y-3 pb-20">
                {customers.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title="Sin Clientes"
                        description="Registra a tus clientes habituales para llevar un control de sus fiados y saldos a favor."
                        actionLabel="NUEVO CLIENTE"
                        onAction={() => { triggerHaptic && triggerHaptic(); setIsAddModalOpen(true); }}
                    />
                ) : filteredCustomers.length === 0 ? (
                    <EmptyState
                        icon={Search}
                        title="Sin resultados"
                        description={`No encontramos ningún cliente con el término "${searchTerm}".`}
                        secondaryActionLabel="Limpiar Búsqueda"
                        onSecondaryAction={() => { setSearchTerm(''); triggerHaptic && triggerHaptic(); }}
                    />
                ) : (
                    <>
                        {paginatedCustomers.map(customer => (
                            <SwipeableItem
                                key={customer.id}
                                onDelete={isAdmin ? () => handleDeleteCustomerRequest(customer) : undefined}
                                triggerHaptic={triggerHaptic}
                            >
                                <CustomerCard
                                    customer={customer}
                                    creditLensEntry={creditLens.byCustomer[customer.id]}
                                    bcvRate={bcvRate}
                                    tasaCop={tasaCop}
                                    copEnabled={copEnabled}
                                    copPrimary={copPrimary}
                                    onClick={() => {
                                        setSelectedCustomer(customer);
                                        toggleHistory(customer.id);
                                    }}
                                    onDelete={isAdmin ? () => handleDeleteCustomerRequest(customer) : undefined}
                                />
                            </SwipeableItem>
                        ))}
                        <PaginationBar
                            currentPage={currentPage}
                            totalPages={totalPages}
                            totalItems={totalItems}
                            startIndex={startIndex}
                            endIndex={endIndex}
                            onNext={goNext}
                            onPrev={goPrev}
                            hasNext={hasNext}
                            hasPrev={hasPrev}
                            label="clientes"
                        />
                    </>
                )}
            </div>
        </div>

            {/* Modal para Agregar Cliente */}
            {
                isAddModalOpen && (
                    <AddCustomerModal
                        onClose={() => setIsAddModalOpen(false)}
                        onSave={async (newC) => {
                            const nextCodeNum = customers.reduce((mx, c) => {
                                const numPart = parseInt(c.code?.replace('CLI-', ''), 10);
                                return isNaN(numPart) ? mx : Math.max(mx, numPart);
                            }, 0) + 1;
                            const code = `CLI-${String(nextCodeNum).padStart(5, '0')}`;
                            const clientWithCode = { ...newC, code };
                            const updated = [...customers, clientWithCode];
                            await saveCustomers(updated);
                            auditLog('CLIENTE', 'CLIENTE_CREADO', `Cliente "${newC.name}" creado con código ${code}`);
                            setIsAddModalOpen(false);
                        }}
                    />
                )
            }

            <CasheaRemittanceModal
                isOpen={!!casheaModalCustomer}
                customer={casheaModalCustomer}
                onClose={() => setCasheaModalCustomer(null)}
                onConfirm={handleCasheaRemittance}
                activePaymentMethods={activePaymentMethods}
            />

            {/* Modal Unificado: Ajustar Cuenta */}
            <TransactionModal
                transactionModal={transactionModal}
                setTransactionModal={setTransactionModal}
                transactionAmount={transactionAmount}
                setTransactionAmount={setTransactionAmount}
                currencyMode={currencyMode}
                setCurrencyMode={setCurrencyMode}
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                activePaymentMethods={activePaymentMethods}
                bcvRate={bcvRate}
                tasaCop={tasaCop}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                handleTransaction={handleTransaction}
            />

            {/* Customer Detail Bottom Sheet */}
            <CustomerDetailSheet
                customer={selectedCustomer}
                isOpen={!!selectedCustomer}
                isAdmin={isAdmin}
                onClose={() => {
                    setSelectedCustomer(null);
                    setExpandedHistory(null);
                    setHistoryData([]);
                }}
                onAjustar={() => {
                    setTransactionModal({ isOpen: true, type: 'ABONO', customer: selectedCustomer });
                    setSelectedCustomer(null);
                }}
                onReset={() => {
                    handleResetBalance(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                onSaldarCashea={(c) => {
                    setCasheaModalCustomer(c);
                    setSelectedCustomer(null);
                }}
                onEdit={() => {
                    setEditingCustomer(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                onDelete={() => {
                    const deuda = selectedCustomer?.deuda || 0;
                    const saldo = selectedCustomer?.favor || 0;
                    const casheaDeuda = selectedCustomer?.casheaDeuda || 0;

                    if (deuda > 0.005) {
                        showToast(`No se puede eliminar: ${selectedCustomer.name} tiene una deuda de $${deuda.toFixed(2)} pendiente.`, 'error');
                        return;
                    }
                    if (saldo > 0.005) {
                        showToast(`No se puede eliminar: ${selectedCustomer.name} tiene un saldo a favor de $${saldo.toFixed(2)}.`, 'error');
                        return;
                    }
                    if (casheaDeuda > 0.005) {
                        showToast(`No se puede eliminar: hay $${casheaDeuda.toFixed(2)} por cobrar a Cashea vinculados a ${selectedCustomer.name}.`, 'error');
                        return;
                    }
                    setDeleteCustomerTarget(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                bcvRate={bcvRate}
                tasaCop={tasaCop}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                sales={historyData}
                onSelectTransaction={setDetailingTransaction}
            />

            {/* Modal Confirmación: Reiniciar Saldo */}
            <ConfirmModal
                isOpen={!!resetBalanceCustomer}
                onClose={() => setResetBalanceCustomer(null)}
                onConfirm={confirmResetBalance}
                title="Reiniciar saldo del cliente"
                message={resetBalanceCustomer ? `¿Estás seguro de reiniciar la deuda y saldo a favor a $0.00 para ${resetBalanceCustomer.name}?\n\nEsta acción es permanente y no se puede deshacer.` : ''}
                confirmText="Sí, reiniciar"
                variant="danger"
            />

            {/* Modal Confirmación: Eliminar Cliente */}
            <ConfirmModal
                isOpen={!!deleteCustomerTarget}
                onClose={() => setDeleteCustomerTarget(null)}
                onConfirm={async () => {
                    const updated = customers.filter(c => c.id !== deleteCustomerTarget.id);
                    await saveCustomers(updated);
                    showToast(`Cliente ${deleteCustomerTarget.name} eliminado`, 'success');
                    auditLog('CLIENTE', 'CLIENTE_ELIMINADO', `Cliente "${deleteCustomerTarget.name}" eliminado`);
                    setDeleteCustomerTarget(null);
                }}
                title="Eliminar cliente"
                message={deleteCustomerTarget ? `¿Eliminar a ${deleteCustomerTarget.name}? Esta acción no se puede deshacer.` : ''}
                confirmText="Sí, eliminar"
                variant="danger"
            />

            {detailingTransaction && (
                <TransactionDetailModal
                    sale={detailingTransaction}
                    bcvRate={bcvRate}
                    tasaCop={tasaCop}
                    copEnabled={copEnabled}
                    copPrimary={copPrimary}
                    onClose={() => setDetailingTransaction(null)}
                />
            )}

            {/* Modal Editar Cliente */}
            {editingCustomer && (
                <EditCustomerModal
                    customer={editingCustomer}
                    onClose={() => setEditingCustomer(null)}
                    onSave={async (updated) => {
                        const newCustomers = customers.map(c => c.id === updated.id ? updated : c);
                        await saveCustomers(newCustomers);
                        setEditingCustomer(null);
                        showToast('Cliente actualizado', 'success');
                    }}
                />
            )}
        </div >
    );
}

// ─── Sub-componente: Tarjeta Compacta ───────────────────────
function CustomerCard({ customer, creditLensEntry, bcvRate, tasaCop, copEnabled, copPrimary, onClick, onDelete }) {
    return (
        // v1.2.0: surface tokens + shadow-tone-sm (warm shadow) en vez de shadow-sm.
        <article className="reveal bg-white dark:bg-surface-900 rounded-2xl px-4 py-3 border border-slate-200 dark:border-slate-700 shadow-sm transition-all active:scale-[0.98] flex items-center gap-2 relative">
            <div
                onClick={onClick}
                className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer"
            >
                <div className="w-11 h-11 rounded-full bg-brand-light dark:bg-slate-700 flex items-center justify-center shrink-0">
                    <span className="text-lg font-black text-brand-dark dark:text-white">
                        {customer.name.charAt(0).toUpperCase()}
                    </span>
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 dark:text-white text-sm truncate capitalize">
                        {customer.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {customer.code && (
                            <span className="font-mono text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/55 dark:border-slate-800/50 px-1.5 py-0.5 rounded-md leading-none shrink-0">
                                {customer.code}
                            </span>
                        )}
                        {customer.documentId && (
                            <span className="font-mono text-[9px] font-black text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-100 dark:border-cyan-900/30 px-1.5 py-0.5 rounded-md leading-none shrink-0">
                                C.I: {customer.documentId}
                            </span>
                        )}
                        {customer.phone && (
                            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-300 flex items-center gap-0.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/55 dark:border-slate-800/50 px-1.5 py-0.5 rounded-md leading-none shrink-0">
                                <Phone size={9} aria-hidden="true" /> {customer.phone}
                            </span>
                        )}
                        {creditLensEntry && creditLensEntry.fiadoMes > 0.001 && (
                            <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 px-1.5 py-0.5 rounded-md leading-none">
                                Fiado este mes: {formatUsd(creditLensEntry.fiadoMes)}
                                {creditLensEntry.consumoFavorMes > 0.001 && ` · ${formatUsd(creditLensEntry.consumoFavorMes)} de su saldo a favor`}
                            </span>
                        )}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    {customer.deuda > 0 || customer.casheaDeuda > 0 ? (
                        <>
                            {customer.deuda > 0 && (
                                <>
                                    <p className={`text-sm font-black ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'} leading-tight`}>
                                        {copEnabled && copPrimary && tasaCop > 0
                                            ? `-${formatCop(customer.deuda * tasaCop)} COP`
                                            : `-$${formatUsd(customer.deuda)}`}
                                    </p>
                                    {copEnabled && copPrimary && <p className="text-[10px] font-bold text-red-600 dark:text-red-400">-${formatUsd(customer.deuda)}</p>}
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-red-600 dark:text-red-400">-{formatBs(customer.deuda * bcvRate)} Bs</p>}
                                    {copEnabled && !copPrimary && tasaCop > 0 && <p className="text-[10px] font-bold text-red-600 dark:text-red-400">-{formatCop(customer.deuda * tasaCop)} COP</p>}
                                </>
                            )}
                            {customer.casheaDeuda > 0 && (
                                <div className="text-[10px] font-black text-purple-500 dark:text-purple-400 flex items-center justify-end gap-1 mt-0.5">
                                    <CasheaIcon size={12} />
                                    <span>-${formatUsd(customer.casheaDeuda)}</span>
                                </div>
                            )}
                        </>
                    ) : customer.favor > 0 ? (
                        <>
                            <p className={`text-sm font-black ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-500'} leading-tight`}>
                                {copEnabled && copPrimary && tasaCop > 0
                                    ? `+${formatCop(customer.favor * tasaCop)} COP`
                                    : `+$${formatUsd(customer.favor)}`}
                            </p>
                            {copEnabled && copPrimary && <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+${formatUsd(customer.favor)}</p>}
                            {bcvRate > 0 && <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+{formatBs(customer.favor * bcvRate)} Bs</p>}
                            {copEnabled && !copPrimary && tasaCop > 0 && <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">+{formatCop(customer.favor * tasaCop)} COP</p>}
                        </>
                    ) : (
                        // v1.2.0: badge-success class para "Al día".
                        <span className="badge badge-success !text-xs">
                            <CheckCircle2 size={12} aria-hidden="true" /> Al día
                        </span>
                    )}
                </div>
            </div>
            {onDelete && (
                // v1.2.0: touch target ≥ 48px (a11y WCAG AA).
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    aria-label="Eliminar contacto"
                    className="p-2 min-h-[48px] min-w-[48px] flex items-center justify-center shrink-0 text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors active:scale-95 z-10"
                >
                    <Trash2 size={16} aria-hidden="true" />
                </button>
            )}
        </article>
    );
}

// Genera la URL de WhatsApp con el estado de cuenta formateado y las últimas 7 transacciones
function buildCustomerStatementWhatsAppUrl(customer, sales, bcvRate) {
    const formattedName = customer.name
        ? customer.name.trim().toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : '';
        
    let msg = `*ESTADO DE CUENTA - PRECIOS AL DÍA*\n`;
    msg += `----------------------------------\n`;
    msg += `*Cliente:* ${formattedName}\n`;
    if (customer.documentId) msg += `*C.I:* ${customer.documentId}\n`;

    const deuda = customer.deuda || 0;
    const favor = customer.favor || 0;
    const casheaDeuda = customer.casheaDeuda || 0;

    if (deuda > 0) {
        msg += `*Estado:* Deuda Pendiente de *$${formatUsd(deuda)}*`;
        if (bcvRate > 0) msg += ` (Bs ${formatBs(deuda * bcvRate)})`;
        msg += `\n`;
    } else if (favor > 0) {
        msg += `*Estado:* Saldo a Favor de *$${formatUsd(favor)}*`;
        if (bcvRate > 0) msg += ` (Bs ${formatBs(favor * bcvRate)})`;
        msg += `\n`;
    } else {
        msg += `*Estado:* Al día [Activo]\n`;
    }

    // Cashea le remesa a la bodega: el cliente NO debe este monto. Se informa
    // como referencia de su financiamiento, nunca como deuda con la bodega.
    if (casheaDeuda > 0) {
        msg += `*Financiamiento Cashea:* $${formatUsd(casheaDeuda)} (lo paga Cashea, no usted)\n`;
    }

    msg += `\n*ÚLTIMAS TRANSACCIONES:*\n`;
    const lastSales = (sales || []).slice(0, 7);
    if (lastSales.length === 0) {
        msg += `Sin movimientos registrados.\n`;
    } else {
        lastSales.forEach((sale, idx) => {
            const date = new Date(sale.timestamp);
            const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
            
            const isCobro = sale.tipo === 'COBRO_DEUDA';
            const isFiada = sale.tipo === 'VENTA_FIADA';
            const isCashea = sale.tipo === 'VENTA_CASHEA';
            const isAnulada = sale.status === 'ANULADA';

            let typeStr = isCobro ? 'Abono de deuda' : isFiada ? 'Venta fiada' : isCashea ? 'Venta Cashea' : 'Venta';
            if (isAnulada) typeStr += ' (ANULADA)';

            let sign = isCobro ? '+' : '';
            msg += `${idx + 1}. [${dateStr}] ${typeStr}: *${sign}$${formatUsd(sale.totalUsd || 0)}*`;
            if (bcvRate > 0 && !isAnulada) msg += ` (Bs ${formatBs((sale.totalUsd || 0) * bcvRate)})`;
            msg += `\n`;
            if (['VENTA', 'VENTA_CASHEA'].includes(sale.tipo) && sale.vueltoParaMonedero > 0) {
                msg += `   _Saldo a favor acreditado: +$${formatUsd(sale.vueltoParaMonedero)}_\n`;
            }

            if (sale.tipo === 'COBRO_DEUDA' && sale.saldoFavorGeneradoUsd > 0) {
                msg += `   _Saldo a favor generado por sobrante de abono: +$${formatUsd(sale.saldoFavorGeneradoUsd)}_\n`;
            }
            const saldoFavorUsado = (sale.payments || [])
                .filter(p => p.methodId === 'saldo_favor' || p.currency === 'INTERNAL_CREDIT' || p.isInternalCredit)
                .reduce((sum, p) => sum + (Number(p.amountUsd) || 0), 0);
            if (saldoFavorUsado > 0) {
                msg += `   _Saldo a favor utilizado: -$${formatUsd(saldoFavorUsado)}_\n`;
            }

            if (sale.items && sale.items.length > 0) {
                const itemsStr = sale.items.map(i => i.name).join(', ');
                msg += `   _${itemsStr.substring(0, 60)}${itemsStr.length > 60 ? '...' : ''}_\n`;
            }
        });
    }

    msg += `----------------------------------\n`;
    msg += `_Reporte generado el ${new Date().toLocaleDateString('es-VE')} a las ${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true })}._`;

    const cleanPhone = (customer.phone || '').replace(/\D/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `58${cleanPhone}` : cleanPhone;
    return `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(msg)}`;
}

// ─── Sub-componente: Bottom Sheet de Detalle ────────────────
function CustomerDetailSheet({ customer, isOpen, isAdmin, onClose, onAjustar, onReset, onSaldarCashea, onEdit, onDelete, bcvRate, tasaCop, copEnabled, copPrimary, sales, onSelectTransaction }) {
    // ⚠️ Reglas de los Hooks: TODOS los hooks van antes de cualquier salida
    // temprana; si no, la cantidad de hooks cambia entre renders y React
    // emite "Expected static flag was missing" (hallazgo H1 de la auditoría E2E).
    // Mini-paginación del historial
    const [historyPage, setHistoryPage] = useState(1);

    // Resetear página de historial cuando cambia el cliente
    useEffect(() => {
        setHistoryPage(1);
    }, [customer?.id]);

    if (!isOpen || !customer) return null;

    const createdDate = customer.createdAt
        ? new Date(customer.createdAt).toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })
        : 'Julio de 2026';

    const deuda = customer.deuda || 0;
    const favor = customer.favor || 0;
    const casheaDeuda = customer.casheaDeuda || 0;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
            <div
                className="relative w-full max-w-md bg-[#FBF9F5] dark:bg-slate-950 rounded-t-[2.5rem] sm:rounded-[2.5rem] max-h-[90vh] overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-250 shadow-2xl p-5 border border-stone-200/60 dark:border-slate-800/80"
                onClick={e => e.stopPropagation()}
            >
                {/* Botón de Cierre X */}
                <div className="flex items-center justify-between mb-4">
                    <div className="w-8 sm:hidden" />
                    <div className="w-10 h-1 bg-stone-300 dark:bg-slate-700 rounded-full sm:hidden mx-auto" />
                    <button 
                        onClick={onClose} 
                        aria-label="Cerrar" 
                        className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-stone-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-stone-200/50 dark:hover:bg-slate-800 rounded-full transition-colors ml-auto"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <div className="space-y-4">
                    {/* Tarjeta de Perfil del Cliente */}
                    <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-4 flex items-center gap-4 shadow-sm border border-stone-200/40 dark:border-slate-800">
                        <div className="w-16 h-16 rounded-2xl bg-stone-100 dark:bg-slate-800 flex items-center justify-center shrink-0 shadow-inner">
                            <span className="text-2xl font-black text-slate-800 dark:text-white capitalize">
                                {customer.name.charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white capitalize leading-tight truncate">
                                {customer.name}
                            </h3>
                            
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                                {customer.documentId && (
                                    <span className="inline-flex items-center gap-1 bg-stone-100 dark:bg-slate-800 text-stone-600 dark:text-slate-300 px-3 py-1 rounded-full text-xs font-bold font-mono">
                                        <User size={12} className="text-stone-400" />
                                        C.I: {customer.documentId}
                                    </span>
                                )}
                                {customer.phone && (
                                    <span className="inline-flex items-center gap-1 bg-stone-100 dark:bg-slate-800 text-stone-600 dark:text-slate-300 px-3 py-1 rounded-full text-xs font-bold">
                                        <Phone size={12} className="text-stone-400" />
                                        {customer.phone}
                                    </span>
                                )}
                            </div>

                            <p className="text-[11px] font-bold text-stone-400 dark:text-slate-500 uppercase tracking-wider mt-2 flex items-center gap-1">
                                <span>📅</span> MIEMBRO DESDE {createdDate.toUpperCase()}
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta de Estado Financiero (Deuda / Favor / Al Día) */}
                    {deuda > 0 ? (
                        <div className="bg-[#FFF5F3] dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/40 rounded-[2rem] p-5 text-center shadow-sm">
                            <p className="text-xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-1">DEUDA PENDIENTE</p>
                            <p className="text-3xl font-black text-rose-600 dark:text-rose-400 tracking-tight">
                                -${formatUsd(deuda)}
                            </p>
                            {bcvRate > 0 && (
                                <p className="text-xs font-bold text-stone-400 dark:text-slate-500 mt-1">
                                    -{formatBs(deuda * bcvRate)} Bs
                                </p>
                            )}
                        </div>
                    ) : favor > 0 ? (
                        <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 rounded-[2rem] p-5 text-center shadow-sm">
                            <p className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">SALDO A FAVOR</p>
                            <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                                +${formatUsd(favor)}
                            </p>
                            {bcvRate > 0 && (
                                <p className="text-xs font-bold text-stone-400 dark:text-slate-500 mt-1">
                                    +{formatBs(favor * bcvRate)} Bs
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="bg-stone-50 dark:bg-slate-900 border border-stone-200/60 dark:border-slate-800 rounded-[2rem] p-5 text-center shadow-sm">
                            <p className="text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500 mb-1">ESTADO FINANCIERO</p>
                            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-2 mt-1">
                                <CheckCircle2 size={20} className="text-emerald-500" /> Al Día
                            </p>
                        </div>
                    )}

                    {/* Por Cobrar a Cashea (Si Aplica) — NO es deuda del cliente:
                        Cashea le remesa a la bodega. */}
                    {casheaDeuda > 0 && (
                        <div className="bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40 rounded-[2rem] p-4 shadow-sm space-y-3">
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-2">
                                    <CasheaIcon size={18} />
                                    <span className="text-xs font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">Por cobrar a Cashea</span>
                                </div>
                                <span className="text-xl font-black text-purple-600 dark:text-purple-400">${formatUsd(casheaDeuda)}</span>
                            </div>
                            <button
                                onClick={() => onSaldarCashea(customer)}
                                className="w-full bg-purple-600 hover:bg-purple-700 text-white rounded-[1.5rem] py-3 min-h-[48px] flex items-center justify-center gap-2 font-bold text-sm shadow-md active:scale-95 transition-all"
                            >
                                <CasheaIcon size={16} />
                                <span>Registrar remesa recibida</span>
                            </button>
                        </div>
                    )}

                    {/* Botones de Acción Grid */}
                    <div className="space-y-3 pt-1">
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={onAjustar}
                                className="bg-[#1E3A70] dark:bg-indigo-900 hover:bg-[#182E59] text-white rounded-[2rem] py-4 min-h-[56px] flex items-center justify-center gap-2 font-bold text-sm shadow-md active:scale-95 transition-all"
                            >
                                <CreditCard size={18} aria-hidden="true" />
                                <span>Ajustar Cuenta</span>
                            </button>

                            {isAdmin && (
                                <button
                                    onClick={onReset}
                                    className="bg-white dark:bg-slate-900 text-slate-800 dark:text-white rounded-[2rem] py-4 min-h-[56px] flex items-center justify-center gap-2 font-bold text-sm shadow-sm border border-stone-200/60 dark:border-slate-800 hover:bg-stone-50 transition-all active:scale-95"
                                >
                                    <RefreshCw size={18} aria-hidden="true" />
                                    <span>Poner en 0</span>
                                </button>
                            )}
                        </div>

                        {/* Botón WhatsApp */}
                        <button
                            onClick={() => {
                                const url = buildCustomerStatementWhatsAppUrl(customer, sales, bcvRate);
                                window.open(url, '_blank');
                            }}
                            disabled={!customer.phone}
                            title={!customer.phone ? "Debe configurar un teléfono para el cliente" : "Enviar estado de cuenta por WhatsApp"}
                            className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white rounded-[2rem] py-4 min-h-[56px] flex items-center justify-center gap-2.5 font-bold text-sm shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 0 24 24">
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.625 1.451 5.403.002 9.803-4.392 9.806-9.8.001-2.617-1.01-5.079-2.859-6.93C16.378 2.025 13.926.994 12.01.994c-5.405 0-9.804 4.393-9.807 9.8-.001 1.77.464 3.5 1.345 5.03L2.57 20.31l4.077-1.156z"/>
                            </svg>
                            <span>Enviar Estado de Cuenta (WhatsApp)</span>
                        </button>
                    </div>

                    {/* Historial Section */}
                    <div className="pt-2">
                        <h4 className="text-xs font-black uppercase tracking-wider text-stone-500 dark:text-slate-400 flex items-center gap-1.5 mb-3">
                            <Clock size={14} className="text-stone-400" /> HISTORIAL
                        </h4>

                        {(!sales || sales.length === 0) ? (
                            <div className="bg-white/60 dark:bg-slate-900/40 border border-dashed border-stone-200/80 dark:border-slate-800 rounded-[2rem] p-8 text-center flex flex-col items-center justify-center animate-in fade-in duration-200">
                                <div className="w-10 h-10 rounded-full bg-stone-100 dark:bg-slate-800 flex items-center justify-center text-stone-400 mb-2">
                                    <Clock size={18} />
                                </div>
                                <p className="font-bold text-slate-700 dark:text-slate-200 text-sm mb-1">Sin movimientos registrados</p>
                                <p className="text-xs text-stone-400 dark:text-slate-500 max-w-xs leading-relaxed">
                                    Las compras, abonos y deudas de este cliente se listarán en esta sección.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {sales.slice(0, historyPage * 5).map(sale => {
                                    const date = new Date(sale.timestamp);
                                    const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
                                    const timeStr = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
                                    const isCobro = sale.tipo === 'COBRO_DEUDA';
                                    const isFiada = sale.tipo === 'VENTA_FIADA';
                                    const isCashea = sale.tipo === 'VENTA_CASHEA';
                                    const isAnulada = sale.status === 'ANULADA';
                                    return (
                                        <div 
                                            key={sale.id} 
                                            onClick={() => onSelectTransaction && onSelectTransaction(sale)}
                                            className={`flex items-start gap-3 p-3.5 bg-white dark:bg-slate-900 border border-stone-200/40 dark:border-slate-800 rounded-2xl cursor-pointer hover:bg-stone-50 dark:hover:bg-slate-850 transition-colors ${isAnulada ? 'opacity-50 grayscale' : ''}`}
                                        >
                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${isAnulada ? 'bg-slate-200 dark:bg-slate-800' : isCobro ? 'bg-emerald-100 dark:bg-emerald-900/30' : isFiada ? 'bg-amber-100 dark:bg-amber-900/30' : isCashea ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-brand-light dark:bg-surface-800/30'}`}>
                                                {isCobro ? <ArrowUpRight size={16} className={isAnulada ? "text-slate-500" : "text-emerald-600"} /> : isFiada ? <CreditCard size={16} className={isAnulada ? "text-slate-500" : "text-amber-600"} /> : isCashea ? <Smartphone size={16} className={isAnulada ? "text-slate-500" : "text-purple-600"} /> : <ShoppingBag size={16} className={isAnulada ? "text-slate-500" : "text-brand"} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <p className={`text-xs font-bold ${isAnulada ? 'text-slate-500 line-through' : 'text-slate-800 dark:text-slate-200'}`}>
                                                            {isCobro ? 'Abono de deuda' : isFiada ? 'Venta fiada' : isCashea ? 'Venta Cashea' : 'Venta'}
                                                        </p>
                                                        {isAnulada && <span className="text-[10px] font-black text-rose-500 tracking-wider">ANULADA</span>}
                                                    </div>
                                                    <div className="text-right">
                                                        <p className={`text-xs font-black ${isAnulada ? 'text-slate-400 line-through' : isCobro ? 'text-emerald-600' : isFiada ? 'text-amber-600' : isCashea ? 'text-purple-600 dark:text-purple-400' : 'text-slate-800 dark:text-white'}`}>
                                                            {isCobro ? '+' : ''}${formatUsd(sale.totalUsd || 0)}
                                                        </p>
                                                        {bcvRate > 0 && !isAnulada && (
                                                            <p className={`text-[9px] font-bold ${isCobro ? 'text-emerald-500/70' : isFiada ? 'text-amber-500/70' : isCashea ? 'text-purple-500/70' : 'text-slate-400'}`}>
                                                                {isCobro ? '+' : ''}{formatBs((sale.totalUsd || 0) * bcvRate)} Bs
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                {sale.items && sale.items.length > 0 && (
                                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                                        {sale.items.map(i => i.name).join(', ')}
                                                    </p>
                                                )}
                                                {['VENTA', 'VENTA_CASHEA'].includes(sale.tipo) && sale.vueltoParaMonedero > 0 && (
                                                    <p className={`text-[10px] font-bold mt-1 ${isAnulada ? 'text-slate-400 line-through' : 'text-cyan-600 dark:text-cyan-400'}`}>
                                                        {isAnulada ? 'Saldo a favor revertido' : 'Saldo a favor acreditado'}: +${formatUsd(sale.vueltoParaMonedero)}
                                                    </p>
                                                )}
                                                {sale.tipo === 'COBRO_DEUDA' && sale.saldoFavorGeneradoUsd > 0 && (
                                                    <p className={`text-[10px] font-bold mt-1 ${isAnulada ? 'text-slate-400 line-through' : 'text-cyan-600 dark:text-cyan-400'}`}>
                                                        {isAnulada ? 'Saldo a favor revertido' : 'Saldo a favor generado por sobrante'}: +${formatUsd(sale.saldoFavorGeneradoUsd)}
                                                    </p>
                                                )}
                                                <p className="text-[9px] text-stone-400 mt-1">{dateStr} • {timeStr}</p>
                                            </div>
                                        </div>
                                    );
                                })}

                                {sales.length > historyPage * 5 && (
                                    <button
                                        onClick={() => setHistoryPage(p => p + 1)}
                                        className="w-full mt-2.5 py-2.5 px-4 bg-white dark:bg-slate-900 border border-stone-200/50 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 rounded-2xl hover:bg-stone-50 transition-all flex items-center justify-center gap-1.5 active:scale-[0.97]"
                                    >
                                        <Clock size={12} className="opacity-70" />
                                        <span>Cargar más transacciones ({sales.length - historyPage * 5} más)</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer Actions (Editar en centro, Eliminar flotante circular a la derecha) */}
                    <div className="relative pt-4 flex items-center justify-center">
                        <button
                            onClick={onEdit}
                            className="flex items-center gap-2 py-2 px-5 text-slate-700 dark:text-slate-200 font-bold text-sm rounded-2xl hover:bg-stone-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <Pencil size={16} />
                            <span>Editar</span>
                        </button>

                        {isAdmin && (
                            <button
                                onClick={onDelete}
                                aria-label="Eliminar cliente"
                                className="absolute right-0 w-12 h-12 rounded-full bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shadow-sm active:scale-95 transition-all"
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Sub-componente: Editar Cliente ───────────────────────
function EditCustomerModal({ customer, onClose, onSave }) {
    const [name, setName] = useState(customer.name);
    const [documentId, setDocumentId] = useState(customer.documentId || '');
    const [phone, setPhone] = useState(customer.phone || '');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ ...customer, name: name.trim(), documentId: documentId.trim(), phone: phone.trim() });
    };

    return (
        // v1.2.0: surface tokens + shadow-tone-lg en modal de editar.
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-surface-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface dark:bg-surface-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-tone-lg overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-surface-100 dark:border-surface-800 flex justify-between items-center bg-surface-100 dark:bg-surface-800/50">
                    <h3 className="text-xl font-black text-surface-700 dark:text-white flex items-center gap-2">
                        <Pencil size={20} className="text-brand" aria-hidden="true" /> Editar Cliente
                    </h3>
                    {/* v1.2.0: touch target ≥ 48px + aria-label */}
                    <button onClick={onClose} aria-label="Cerrar" className="p-2 min-h-[48px] min-w-[48px] flex items-center justify-center text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 rounded-full transition-colors">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Nombre *</label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-4 py-3 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 transition-all font-medium"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Cédula / RIF (Opcional)</label>
                        <input
                            type="text"
                            value={documentId}
                            onChange={(e) => setDocumentId(e.target.value.toUpperCase())}
                            placeholder="V-12345678"
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-4 py-3 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 transition-all font-medium uppercase"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Teléfono</label>
                        <div className="w-full flex items-center bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl focus-within:ring-2 focus-within:ring-brand/50 transition-all overflow-hidden">
                            <span className="px-3 py-3 text-sm font-black text-brand border-r border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-800 shrink-0 select-none">+58</span>
                            <input
                                type="tel"
                                placeholder="0412 1234567"
                                value={phone}
                                onChange={(e) => {
                                    const clean = e.target.value.replace(/^\+?58/, '');
                                    setPhone(clean);
                                }}
                                className="flex-1 bg-transparent px-3 py-3 text-surface-700 dark:text-white outline-none text-sm font-medium placeholder:text-surface-400"
                            />
                        </div>
                        <p className="text-[9px] text-surface-400 mt-1 ml-1">Venezuela · Ej: 0412 1234567</p>
                    </div>
                    {/* v1.2.0: touch target ≥ 48px */}
                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className="w-full py-3.5 min-h-[48px] bg-brand disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white font-bold rounded-xl active:scale-95 transition-all mt-4 flex justify-center items-center gap-2"
                    >
                        <Save size={18} aria-hidden="true" /> Guardar Cambios
                    </button>
                </form>
            </div>
        </div>
    );
}

function AddCustomerModal({ onClose, onSave }) {
    const [name, setName] = useState('');
    const [documentId, setDocumentId] = useState('');
    const [phone, setPhone] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        onSave({
            id: crypto.randomUUID(),
            name: name.trim(),
            documentId: documentId.trim(),
            phone: phone.trim(),
            deuda: 0,
            favor: 0,
            createdAt: new Date().toISOString()
        });
    };

    return (
        // v1.2.0: surface tokens + shadow-tone-lg + aria-hidden en AddCustomerModal.
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-surface-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface dark:bg-surface-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-tone-lg overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-surface-100 dark:border-surface-800 flex justify-between items-center bg-surface-100 dark:bg-surface-800/50">
                    <h3 className="text-xl font-black text-surface-700 dark:text-white flex items-center gap-2">
                        <User size={22} className="text-brand" aria-hidden="true" /> Nuevo Cliente
                    </h3>
                    {/* v1.2.0: touch target ≥ 48px + aria-label */}
                    <button onClick={onClose} aria-label="Cerrar" className="p-2 min-h-[48px] min-w-[48px] flex items-center justify-center text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 rounded-full transition-colors">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Nombre del Cliente *</label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej. María Pérez"
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-4 py-3 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 transition-all font-medium"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Cédula / RIF (Opcional)</label>
                        <input
                            type="text"
                            value={documentId}
                            onChange={(e) => setDocumentId(e.target.value.toUpperCase())}
                            placeholder="V-12345678"
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-4 py-3 text-surface-700 dark:text-white placeholder:text-surface-400 focus:ring-2 focus:ring-brand/50 transition-all font-medium uppercase"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-surface-400 uppercase mb-2">Teléfono (opcional)</label>
                        <div className="w-full flex items-center bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl focus-within:ring-2 focus-within:ring-brand/50 transition-all overflow-hidden">
                            <span className="px-3 py-3 text-sm font-black text-brand border-r border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-800 shrink-0 select-none">+58</span>
                            <input
                                type="tel"
                                placeholder="0412 1234567"
                                value={phone}
                                onChange={(e) => {
                                    const clean = e.target.value.replace(/^\+?58/, '');
                                    setPhone(clean);
                                }}
                                className="flex-1 bg-transparent px-3 py-3 text-surface-700 dark:text-white outline-none text-sm font-medium placeholder:text-surface-400"
                            />
                        </div>
                        <p className="text-[9px] text-surface-400 mt-1 ml-1">Venezuela · Ej: 0412 1234567</p>
                    </div>

                    {/* v1.2.0: touch target ≥ 48px */}
                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className="w-full py-3.5 min-h-[48px] bg-brand disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white font-bold rounded-xl active:scale-95 transition-all mt-4 flex justify-center items-center gap-2"
                    >
                        <Save size={18} aria-hidden="true" /> Guardar Cliente
                    </button>
                </form>
            </div>
        </div>
    );
}

export function TransactionDetailModal({ sale, bcvRate, tasaCop, copEnabled, copPrimary, onClose }) {
    if (!sale) return null;

    const d = new Date(sale.timestamp);
    const dateStr = d.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    
    const isCobro = sale.tipo === 'COBRO_DEUDA';
    const isFiada = sale.tipo === 'VENTA_FIADA';
    const isCashea = sale.tipo === 'VENTA_CASHEA';
    const isAnulada = sale.status === 'ANULADA';

    const handleShare = () => {
        const useCop = copEnabled && copPrimary && tasaCop > 0;
        let text = `*COMPROBANTE | PRECIOS AL DIA*\n`;
        text += `Orden: #${sale.id.substring(0, 6).toUpperCase()}\n`;
        text += `Fecha: ${d.toLocaleString('es-VE')}\n`;
        text += `================================\n`;
        if (sale.items && sale.items.length > 0) {
            sale.items.forEach(item => {
                const qty = item.isWeight ? `${item.qty.toFixed(3)}Kg` : `${item.qty} Und`;
                if (useCop) {
                    text += `- ${item.name} ${qty} x ${formatCop(item.priceCop || Math.round(item.priceUsd * tasaCop))} COP = *${formatCop((item.priceCop || Math.round(item.priceUsd * tasaCop)) * item.qty)} COP*\n`;
                } else {
                    text += `- ${item.name} ${qty} x $${item.priceUsd.toFixed(2)} = *$${(item.priceUsd * item.qty).toFixed(2)}*\n`;
                }
            });
        }
        if (useCop) {
            text += `\n*TOTAL: ${formatCop((sale.totalUsd || 0) * tasaCop)} COP*\n`;
            text += `Ref: $${(sale.totalUsd || 0).toFixed(2)}\n`;
        } else {
            text += `\n*TOTAL: $${(sale.totalUsd || 0).toFixed(2)}*\n`;
            text += `Ref: ${formatBs(sale.totalBs || 0)} Bs\n`;
        }
        const encoded = encodeURIComponent(text);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    };

    const handlePDF = () => {
        import('../utils/dailyCloseGenerator').then(({ generateTicketPDF }) => {
            generateTicketPDF(sale, bcvRate);
        });
    };

    const getPaymentLabel = (methodId) => {
        const labels = {
            efectivo_bs:       'Efectivo Bs',
            pago_movil:        'Pago Móvil',
            punto_venta:       'Punto de Venta',
            efectivo_usd:      'Efectivo $',
            efectivo_cop:      'Efectivo COP',
            transferencia_cop: 'Transferencia COP',
            saldo_favor:       'Saldo a Favor',
            fiado:             'Fiado (Por Cobrar)',
            cashea:            'Cashea (Por Cobrar)',
        };
        return labels[methodId] || methodId;
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200 text-left" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                    <div>
                        <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-1.5 uppercase tracking-wide">
                            Detalle de Movimiento
                        </h3>
                        <p className="text-[10px] text-slate-400 font-mono">ID: #{sale.id.toUpperCase()}</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* Resumen de Montos */}
                    <div className="text-center p-4 bg-slate-50 dark:bg-slate-955 rounded-2xl border border-slate-100 dark:border-slate-850">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                            {isCobro ? 'Abono Recibido' : isFiada ? 'Crédito Otorgado' : isCashea ? 'Venta Cashea' : 'Total Transacción'}
                        </p>
                        <p className={`text-3xl font-black ${isAnulada ? 'text-slate-400 line-through' : isCobro ? 'text-emerald-500' : isFiada ? 'text-amber-500' : isCashea ? 'text-purple-500' : 'text-slate-800 dark:text-white'}`}>
                            {isCobro ? '+' : ''}${formatUsd(sale.totalUsd || 0)}
                        </p>
                        <div className="flex flex-col gap-0.5 mt-1 text-[10px] text-slate-400 font-bold">
                            {bcvRate > 0 && <p>{isCobro ? '+' : ''}{formatBs((sale.totalUsd || 0) * (sale.rate || bcvRate))} Bs</p>}
                            {copEnabled && tasaCop > 0 && <p>{isCobro ? '+' : ''}{formatCop((sale.totalUsd || 0) * (sale.tasaCop || tasaCop))} COP</p>}
                        </div>
                        {isAnulada && (
                            <span className="inline-block mt-2 px-2 py-0.5 text-[10px] font-black tracking-widest text-white bg-red-500 rounded-md">ANULADA</span>
                        )}
                    </div>

                    {/* Meta Info */}
                    <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                        <div>
                            <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Tipo Operación</span>
                            <span className="font-bold text-slate-700 dark:text-slate-200">{isCobro ? 'Abono de Deuda' : isFiada ? 'Venta Fiada' : isCashea ? 'Venta Cashea' : 'Venta de Productos'}</span>
                        </div>
                        <div>
                            <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Fecha / Hora</span>
                            <span className="font-bold text-slate-700 dark:text-slate-200">{dateStr}</span>
                        </div>
                    </div>

                    {/* Productos listados */}
                    {sale.items && sale.items.length > 0 ? (
                        <div className="border-t border-dashed border-slate-200 dark:border-slate-800 pt-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Productos ({sale.items.length})</p>
                            <div className="space-y-1.5">
                                {sale.items.map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-300">
                                        <span className="truncate pr-4 flex-1">
                                            {item.isWeight ? `${item.qty.toFixed(3)}kg` : `${item.qty}u`} {item.name}
                                            {(item.isWeight || item.qty !== 1) && (
                                                <span className="text-[10px] text-slate-400 font-normal ml-1">
                                                    (c/u ${item.priceUsd.toFixed(2)})
                                                </span>
                                            )}
                                        </span>
                                        <span className="font-bold text-slate-800 dark:text-slate-200">${(item.priceUsd * item.qty).toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        isCobro && (
                            <div className="border-t border-dashed border-slate-200 dark:border-slate-800 pt-3 text-xs text-slate-500 leading-normal bg-slate-50 dark:bg-slate-900/30 p-3 rounded-xl">
                                ℹ️ Esta operación es un abono para amortizar la deuda acumulada del cliente. No incluye venta directa de artículos.
                            </div>
                        )
                    )}

                    {/* Desglose de pagos */}
                    {sale.payments && sale.payments.length > 0 && (
                        <div className="border-t border-dashed border-slate-200 dark:border-slate-800 pt-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Método de Cobro/Pago</p>
                            <div className="space-y-1.5">
                                {sale.payments.map((p, idx) => {
                                    const isCopCurrency = p.currency === 'COP';
                                    const isInternalCredit = p.methodId === 'saldo_favor' || p.currency === 'INTERNAL_CREDIT' || p.isInternalCredit;
                                    const isBsCurrency = !isCopCurrency && !isInternalCredit && (p.currency ? p.currency !== 'USD' : p.methodId?.includes('_bs'));
                                    const label = p.methodLabel || getPaymentLabel(p.methodId);
                                    
                                    let formattedAmt = isInternalCredit ? `Crédito interno $${(p.amountUsd || 0).toFixed(2)}` : `$${(p.amountUsd || 0).toFixed(2)}`;
                                    if (isCopCurrency) {
                                        formattedAmt = `${(p.amountCop || Math.round(p.amountUsd * (sale.tasaCop || tasaCop))).toLocaleString('es-CO')} COP`;
                                    } else if (isBsCurrency) {
                                        formattedAmt = `${formatBs(p.amountBs || (p.amountUsd * (sale.rate || bcvRate)))} Bs`;
                                    }

                                    return (
                                        <div key={idx} className="flex justify-between items-center text-xs text-slate-650 dark:text-slate-350">
                                            <span>{label}</span>
                                            <span className="font-bold text-slate-800 dark:text-slate-200">
                                                {formattedAmt} {!isInternalCredit && p.currency !== 'USD' && <span className="text-[9px] text-slate-400 font-normal">(${p.amountUsd.toFixed(2)})</span>}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Vuelto, saldo a favor y notas */}
                    {(sale.changeUsd > 0 || sale.changeBs > 0 || (['VENTA', 'VENTA_CASHEA'].includes(sale.tipo) && sale.vueltoParaMonedero > 0) || (sale.tipo === 'COBRO_DEUDA' && sale.saldoFavorGeneradoUsd > 0) || sale.note) && (
                        <div className="border-t border-dashed border-slate-200 dark:border-slate-800 pt-3 space-y-2">
                            {sale.changeUsd > 0 && (
                                <div className="flex justify-between text-xs text-orange-500">
                                    <span>Vuelto entregado ($)</span>
                                    <span className="font-black">-${formatUsd(sale.changeUsd)}</span>
                                </div>
                            )}
                            {sale.changeBs > 0 && (
                                <div className="flex justify-between text-xs text-orange-500">
                                    <span>Vuelto entregado (Bs)</span>
                                    <span className="font-black">-${formatBs(sale.changeBs)} Bs</span>
                                </div>
                            )}
                            {['VENTA', 'VENTA_CASHEA'].includes(sale.tipo) && sale.vueltoParaMonedero > 0 && (
                                <div className={`flex justify-between text-xs ${isAnulada ? 'text-slate-400 line-through' : 'text-cyan-600 dark:text-cyan-400'}`}>
                                    <span>{isAnulada ? 'Saldo a favor revertido' : 'Saldo a favor acreditado'}</span>
                                    <span className="font-black">+${formatUsd(sale.vueltoParaMonedero)}</span>
                                </div>
                            )}
                            {sale.tipo === 'COBRO_DEUDA' && sale.saldoFavorGeneradoUsd > 0 && (
                                <div className={`flex justify-between text-xs ${isAnulada ? 'text-slate-400 line-through' : 'text-cyan-600 dark:text-cyan-400'}`}>
                                    <span>{isAnulada ? 'Saldo a favor revertido' : 'Saldo a favor generado por sobrante'}</span>
                                    <span className="font-black">+${formatUsd(sale.saldoFavorGeneradoUsd)}</span>
                                </div>
                            )}
                            {sale.note && (
                                <div className="text-left text-xs bg-slate-50 dark:bg-slate-900/30 p-2.5 rounded-xl text-slate-550 dark:text-slate-400">
                                    <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block mb-0.5">Notas</span>
                                    {sale.note}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer de Acciones */}
                <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex gap-2">
                    <button onClick={handleShare} className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-sm">
                        <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24">
                            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.625 1.451 5.403.002 9.803-4.392 9.806-9.8.001-2.617-1.01-5.079-2.859-6.93C16.378 2.025 13.926.994 12.01.994c-5.405 0-9.804 4.393-9.807 9.8-.001 1.77.464 3.5 1.345 5.03L2.57 20.31l4.077-1.156z"/>
                        </svg>
                        Compartir
                    </button>
                    <button onClick={handlePDF} className="flex-1 py-3 px-4 bg-brand text-slate-900 hover:brightness-110 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-sm">
                        <Download size={14} /> PDF
                    </button>
                </div>
            </div>
        </div>
    );
}
