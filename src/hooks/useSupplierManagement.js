import { useState } from 'react';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';

export function useSupplierManagement({ bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog }) {
    const [suppliers, setSuppliers] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [selectedSupplier, setSelectedSupplier] = useState(null);

    // Modales de Proveedores
    const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [isAddInvoiceModalOpen, setIsAddInvoiceModalOpen] = useState(false);
    const [isPayInvoiceModalOpen, setIsPayInvoiceModalOpen] = useState(false);
    const [deleteSupplierTarget, setDeleteSupplierTarget] = useState(null);
    const [supplierHistoryData, setSupplierHistoryData] = useState([]);

    const saveSuppliers = async (updatedSuppliers) => {
        setSuppliers(updatedSuppliers);
        await storageService.setItem('bodega_suppliers_v1', updatedSuppliers);
    };

    const saveInvoices = async (updatedInvoices) => {
        setInvoices(updatedInvoices);
        await storageService.setItem('bodega_supplier_invoices_v1', updatedInvoices);
    };

    const handleSaveSupplier = async (supplierData) => {
        triggerHaptic && triggerHaptic();
        let updated;
        if (editingSupplier) {
            updated = suppliers.map(s => s.id === supplierData.id ? supplierData : s);
            showToast('Proveedor actualizado', 'success');
            auditLog('PROVEEDOR', 'PROVEEDOR_EDITADO', `Proveedor "${supplierData.name}" actualizado`);
        } else {
            updated = [...suppliers, supplierData];
            showToast('Proveedor agregado', 'success');
            auditLog('PROVEEDOR', 'PROVEEDOR_CREADO', `Proveedor "${supplierData.name}" creado`);
        }
        await saveSuppliers(updated);
        setIsAddSupplierModalOpen(false);
        setEditingSupplier(null);
        if (selectedSupplier && selectedSupplier.id === supplierData.id) setSelectedSupplier(supplierData);
    };

    const refreshSupplierHistory = async (supplierId) => {
        const allSales = await storageService.getItem('bodega_sales_v1', []);
        const supplierInvoices = invoices.filter(i => i.supplierId === supplierId);
        const supplierPayments = allSales.filter(s => s.tipo === 'PAGO_PROVEEDOR' && s.supplierId === supplierId);

        const combined = [...supplierInvoices, ...supplierPayments]
            .sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp));

        setSupplierHistoryData(combined);
    };

    const handleSelectSupplier = (supplier) => {
        triggerHaptic && triggerHaptic();
        setSelectedSupplier(supplier);
        refreshSupplierHistory(supplier.id);
    };

    const handleAddInvoice = async (invoiceData) => {
        triggerHaptic && triggerHaptic();
        const updatedInvoices = [...invoices, invoiceData];
        await saveInvoices(updatedInvoices);

        // Actualizar deuda del proveedor
        const supplier = suppliers.find(s => s.id === invoiceData.supplierId);
        if (supplier) {
            const updatedSupplier = { ...supplier, deuda: (supplier.deuda || 0) + invoiceData.amountUsd };
            const updatedSuppliers = suppliers.map(s => s.id === supplier.id ? updatedSupplier : s);
            await saveSuppliers(updatedSuppliers);
            setSelectedSupplier(updatedSupplier);
        }
        setIsAddInvoiceModalOpen(false);
        showToast('Factura registrada', 'success');
        auditLog('PROVEEDOR', 'FACTURA_REGISTRADA', `Factura $${invoiceData.amountUsd?.toFixed(2)} - ${suppliers.find(s => s.id === invoiceData.supplierId)?.name || '?'}`);
        refreshSupplierHistory(invoiceData.supplierId);
    };

    const handlePayInvoice = async ({ amountUsd, amountBs, amountCop, paymentMethod, currencyMode, retiraCaja }) => {
        triggerHaptic && triggerHaptic();
        const supplier = selectedSupplier;
        if (!supplier) return;

        // 1. Descontar deuda
        const updatedSupplier = { ...supplier, deuda: Math.max(0, (supplier.deuda || 0) - amountUsd) };
        const updatedSuppliers = suppliers.map(s => s.id === supplier.id ? updatedSupplier : s);
        await saveSuppliers(updatedSuppliers);
        setSelectedSupplier(updatedSupplier);

        // 2. Registrar en Caja/Sistema
        const sales = await storageService.getItem('bodega_sales_v1', []);
        const totalEnBs = currencyMode === 'BS' ? amountBs : (amountUsd * bcvRate);
        const totalEnUsd = currencyMode === 'USD' ? amountUsd : (bcvRate > 0 ? amountBs / bcvRate : 0);
        const totalEnCop = currencyMode === 'COP' ? amountBs : (amountUsd * tasaCop);

        const pagoRecord = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            tipo: 'PAGO_PROVEEDOR',
            supplierId: supplier.id,
            supplierName: supplier.name,
            totalBs: -totalEnBs,
            totalUsd: -totalEnUsd,
            ...(copEnabled && { totalCop: -totalEnCop }),
            paymentMethod: paymentMethod,
            afectaCaja: retiraCaja, // <-- Sostiene si descuenta de caja
            payments: [{
                methodId: paymentMethod,
                amountUsd: currencyMode === 'USD' ? -totalEnUsd : 0,
                amountBs: currencyMode === 'BS' ? -totalEnBs : 0,
                ...(copEnabled && { amountCop: currencyMode === 'COP' ? -totalEnCop : 0 }),
                currency: currencyMode,
                methodLabel: retiraCaja ? 'Pago a Proveedor' : 'Pago Externo a Proveedor'
            }],
            items: [{ name: `Pago a proveedor: ${supplier.name}${retiraCaja ? '' : ' (Externo)'}`, qty: 1, priceUsd: -totalEnUsd, costBs: 0 }]
        };
        sales.push(pagoRecord);
        await storageService.setItem('bodega_sales_v1', sales);

        setIsPayInvoiceModalOpen(false);
        showToast(retiraCaja ? 'Pago registrado y descontado de caja' : 'Pago registrado (externo)', 'success');
        auditLog('PROVEEDOR', 'PAGO_PROVEEDOR', `Pago $${amountUsd.toFixed(2)} a ${supplier.name} (${retiraCaja ? 'Caja' : 'Externo'})`);
        refreshSupplierHistory(supplier.id);
    };

    const handleDeleteSupplier = async () => {
        const updated = suppliers.filter(s => s.id !== deleteSupplierTarget.id);
        await saveSuppliers(updated);
        showToast(`Proveedor ${deleteSupplierTarget.name} eliminado`, 'success');
        setSelectedSupplier(null);
        setDeleteSupplierTarget(null);
    };

    // Called from parent's loadData to hydrate supplier state
    const hydrateSuppliers = (savedSuppliers, savedInvoices) => {
        setSuppliers(savedSuppliers);
        setInvoices(savedInvoices);
    };

    return {
        // State
        suppliers,
        invoices,
        selectedSupplier,
        isAddSupplierModalOpen,
        editingSupplier,
        isAddInvoiceModalOpen,
        isPayInvoiceModalOpen,
        deleteSupplierTarget,
        supplierHistoryData,

        // State setters (needed by JSX callbacks)
        setSelectedSupplier,
        setIsAddSupplierModalOpen,
        setEditingSupplier,
        setIsAddInvoiceModalOpen,
        setIsPayInvoiceModalOpen,
        setDeleteSupplierTarget,

        // Functions
        saveSuppliers,
        saveInvoices,
        handleSaveSupplier,
        refreshSupplierHistory,
        handleSelectSupplier,
        handleAddInvoice,
        handlePayInvoice,
        handleDeleteSupplier,
        hydrateSuppliers,
    };
}
