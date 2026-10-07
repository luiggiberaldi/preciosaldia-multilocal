import React, { useState, useMemo } from 'react';
import { Clock, Send, Ban, ChevronDown, ChevronUp, Trash2, Shuffle, Recycle, Receipt, Printer, LockIcon, CornerDownLeft, Smartphone, DollarSign, HandCoins, Wallet, Search, X, Layers, ShoppingBag } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { getPaymentLabel, getPaymentMethod, PAYMENT_ICONS, toTitleCase, getPaymentIcon } from '../../config/paymentMethods';
import EmptyState from '../EmptyState';
import { printerSerial } from '../../services/PrinterSerial';
import { showToast } from '../Toast';
import CasheaIcon from '../CasheaIcon';
import { filterHistoryByKind } from '../../utils/receivablesReport';
import { usePagination } from '../../hooks/usePagination';
import PaginationBar from '../PaginationBar';

export default function SalesHistory({
    sales = [],
    recentSales = [],
    todaySales = [],
    bcvRate,
    totalSalesCount,
    onVoidSale,
    onShareWhatsApp,
    onDownloadPDF,
    onOpenDeleteModal,
    onRequestClientForTicket,
    onRecycleSale,
    onPrintTicket,
    isAdmin,
    copEnabled,
    copPrimary,
    tasaCop
}) {
    const [expandedSaleId, setExpandedSaleId] = useState(null);
    const [printingId, setPrintingId] = useState(null);
    const [historyTab, setHistoryTab] = useState('turno'); // 'turno' | 'general'
    const [searchTerm, setSearchTerm] = useState('');

    // Ventas del turno (caja abierta actual)
    const shiftSales = useMemo(() => {
        if (todaySales && todaySales.length > 0) {
            return todaySales.filter(s => !s.cajaCerrada);
        }
        return (recentSales || []).filter(s => !s.cajaCerrada);
    }, [todaySales, recentSales]);

    // Ventas generales (historial acumulado)
    const allSales = useMemo(() => {
        return recentSales || [];
    }, [recentSales]);

    // FIA-REPORT-001 (H3): las cobranzas (COBRO_DEUDA / COBRO_CASHEA) no son ventas.
    // Antes se mezclaban con las transacciones de venta en esta lista; ahora se
    // separan por tipo y el default las excluye.
    const [kindFilter, setKindFilter] = useState('ventas'); // 'ventas' | 'cobranzas' | 'todo'

    const collectionCount = useMemo(() => filterHistoryByKind(
        historyTab === 'turno' ? shiftSales : allSales,
        'cobranzas'
    ).length, [historyTab, shiftSales, allSales]);

    const currentBaseSales = useMemo(
        () => filterHistoryByKind(historyTab === 'turno' ? shiftSales : allSales, kindFilter),
        [historyTab, shiftSales, allSales, kindFilter]
    );

    // Motor de búsqueda inteligente con normalización y puntuación de relevancia
    const filteredSales = useMemo(() => {
        if (!searchTerm.trim()) return currentBaseSales;

        // Normalizador sin tildes ni caracteres especiales
        const norm = (str) => {
            if (!str) return '';
            return String(str)
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim();
        };

        const rawTerm = searchTerm.trim();
        const term = norm(rawTerm);
        // Limpiar prefijo # y ceros a la izquierda para comparar números de ticket
        const termNoHash = term.replace(/^#+/, '').trim();
        const termOnlyDigits = termNoHash.replace(/^0+/, ''); // '0000757' -> '757'
        const isNumeric = /^\d+(\.\d+)?$/.test(termNoHash);

        const scoredResults = [];

        for (const sale of currentBaseSales) {
            let score = 0;

            // 1. Número de Ticket / Venta (Máxima prioridad)
            const saleNum = sale.saleNumber != null ? String(sale.saleNumber) : '';
            const paddedNum = saleNum ? saleNum.padStart(7, '0') : ''; // '0000757'

            if (saleNum) {
                // Coincidencia exacta con el número de ticket (ej. "757" con ticket #757)
                if (termOnlyDigits && saleNum === termOnlyDigits) {
                    score += 1000;
                } else if (termNoHash && paddedNum === termNoHash) {
                    score += 900;
                } else if (termNoHash && paddedNum.endsWith(termNoHash)) {
                    score += 700;
                } else if (termNoHash && paddedNum.includes(termNoHash)) {
                    score += 500;
                }
            }

            // Factura externa o número de comprobante
            if (sale.invoiceNumber) {
                const inv = norm(sale.invoiceNumber);
                if (inv === termNoHash) score += 800;
                else if (inv.includes(termNoHash)) score += 400;
            }

            // 2. Cliente (Nombre, Cédula/RIF, Teléfono)
            const customer = norm(sale.customerName || sale.clientName);
            if (customer) {
                if (customer === term) {
                    score += 600;
                } else if (customer.startsWith(term)) {
                    score += 450;
                } else if (customer.includes(term)) {
                    score += 350;
                }
            }

            if (sale.clientDocument && norm(sale.clientDocument).includes(termNoHash)) {
                score += 400;
            }
            if (sale.clientPhone && norm(sale.clientPhone).includes(termNoHash)) {
                score += 400;
            }

            // 3. Productos dentro del ticket (Nombre y Código de barra)
            if (sale.items && Array.isArray(sale.items)) {
                for (const item of sale.items) {
                    const itemName = norm(item.name);
                    const barcode = item.barcode ? String(item.barcode).trim() : '';
                    if (itemName && itemName.includes(term)) {
                        score += 300;
                        break;
                    }
                    if (barcode && (barcode === rawTerm || barcode.includes(termNoHash))) {
                        score += 350;
                        break;
                    }
                }
            }

            // 4. Métodos de Pago y Modalidades
            const isCashea = (sale.tipo === 'VENTA_CASHEA') || (sale.casheaUsd > 0) || (sale.payments && sale.payments.some(p => p.isCashea || norm(p.methodId).includes('cashea') || norm(p.methodLabel).includes('cashea')));
            if (term === 'cashea' && isCashea) {
                score += 300;
            }
            if ((term === 'fiado' || term === 'deuda' || term === 'por cobrar') && sale.tipo === 'VENTA_FIADA') {
                score += 300;
            }
            if ((term === 'anulada' || term === 'cancelada') && sale.status === 'ANULADA') {
                score += 300;
            }
            if (term === 'mixto' && sale.payments && sale.payments.length > 1) {
                score += 300;
            }
            if (sale.payments && Array.isArray(sale.payments)) {
                for (const p of sale.payments) {
                    if (norm(p.methodLabel).includes(term) || norm(p.methodId).includes(term)) {
                        score += 200;
                        break;
                    }
                }
            }
            if (sale.paymentMethod && norm(sale.paymentMethod).includes(term)) {
                score += 200;
            }

            // 5. Monto Exacto en USD o Bs
            if (isNumeric) {
                const searchNum = parseFloat(termNoHash);
                const usdTotal = sale.totalUsd != null ? Math.round(sale.totalUsd * 100) / 100 : null;
                const bsTotal = sale.totalBs != null ? Math.round(sale.totalBs * 100) / 100 : null;

                if (usdTotal != null && usdTotal === searchNum) {
                    score += 250;
                } else if (bsTotal != null && bsTotal === searchNum) {
                    score += 250;
                }
            }

            // 6. Cajero
            if (sale.cashier?.nombre && norm(sale.cashier.nombre).includes(term)) {
                score += 200;
            }

            if (score > 0) {
                scoredResults.push({ sale, score });
            }
        }

        // Ordenar: primero por mayor relevancia, a igual relevancia por fecha más reciente
        scoredResults.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(b.sale.timestamp || 0) - new Date(a.sale.timestamp || 0);
        });

        return scoredResults.map(r => r.sale);
    }, [currentBaseSales, searchTerm]);

    const {
        currentPage,
        totalPages,
        paginatedItems: paginatedSales,
        goNext,
        goPrev,
        hasNext,
        hasPrev,
        startIndex,
        endIndex,
        totalItems,
    } = usePagination(filteredSales, 10);

    const handleThermalPrint = async (e, sale) => {
        e.stopPropagation();
        if (!printerSerial.isSupported()) {
            showToast('Tu navegador no soporta impresoras seriales. Usa Chrome o Edge.', 'error');
            return;
        }
        try {
            if (!printerSerial.isConnected()) {
                const connected = await printerSerial.connect();
                if (!connected) return;
            }
            setPrintingId(sale.id);
            await printerSerial.printTicket(sale, bcvRate);
            showToast('Ticket impreso correctamente', 'success');
        } catch (err) {
            showToast('Error al imprimir: ' + (err.message || 'desconocido'), 'error');
        } finally {
            setPrintingId(null);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm mb-20">
            {/* Encabezado con Título y Acciones */}
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5 tracking-wider">
                    <Clock size={14} className="text-slate-400" /> Historial de Ventas
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
                        {totalSalesCount || allSales.length} histórico
                    </span>
                    {isAdmin && (
                        <button
                            onClick={onOpenDeleteModal}
                            className="text-slate-300 hover:text-red-500 transition-colors bg-slate-50 hover:bg-red-50 dark:bg-slate-800/40 dark:hover:bg-red-900/30 p-1.5 rounded-lg"
                            title="Borrar historial"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Pestañas: Ventas del Turno vs Ventas en General */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl mb-3">
                <button
                    onClick={() => { setHistoryTab('turno'); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-extrabold transition-all ${
                        historyTab === 'turno'
                            ? 'bg-brand text-white shadow-sm dark:bg-[#1ce2ee] dark:text-slate-950'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                    }`}
                >
                    <ShoppingBag size={14} />
                    <span>Ventas del Turno</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        historyTab === 'turno'
                            ? 'bg-white/20 text-white dark:bg-slate-950/20 dark:text-slate-950'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                        {shiftSales.length}
                    </span>
                </button>

                <button
                    onClick={() => { setHistoryTab('general'); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-extrabold transition-all ${
                        historyTab === 'general'
                            ? 'bg-brand text-white shadow-sm dark:bg-[#1ce2ee] dark:text-slate-950'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                    }`}
                >
                    <Layers size={14} />
                    <span>Ventas en General</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        historyTab === 'general'
                            ? 'bg-white/20 text-white dark:bg-slate-950/20 dark:text-slate-950'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
                        {allSales.length}
                    </span>
                </button>
            </div>

            {(collectionCount > 0 || kindFilter !== 'ventas') && (
                <div className="flex items-center gap-1.5 mb-3">
                    {[
                        { id: 'ventas', label: 'Ventas' },
                        { id: 'cobranzas', label: `Cobranzas${collectionCount > 0 ? ` (${collectionCount})` : ''}` },
                        { id: 'todo', label: 'Todo' },
                    ].map(option => (
                        <button
                            key={option.id}
                            onClick={() => setKindFilter(option.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                kindFilter === option.id
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Barra de Búsqueda Inteligente */}
            <div className="relative mb-3">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar ticket, cliente, producto, pago o monto..."
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-xl text-xs text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 dark:focus:ring-brand/20 transition-all"
                />
                {searchTerm && (
                    <button
                        onClick={() => setSearchTerm('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                        title="Limpiar búsqueda"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* Contador de resultados cuando se busca */}
            {searchTerm && (
                <div className="flex items-center justify-between mb-2.5 px-1">
                    <span className="text-[11px] font-medium text-slate-400">
                        {filteredSales.length === 1 ? '1 resultado encontrado' : `${filteredSales.length} resultados encontrados`}
                    </span>
                    <button
                        onClick={() => setSearchTerm('')}
                        className="text-[11px] text-brand hover:underline font-bold"
                    >
                        Ver todas
                    </button>
                </div>
            )}

            {/* Empty state cuando no hay coincidencias o no hay ventas */}
            {filteredSales.length === 0 ? (
                <div className="py-10 text-center flex flex-col items-center justify-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-400">
                        {searchTerm ? <Search size={22} /> : <Receipt size={22} />}
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {searchTerm
                            ? `No hay coincidencias para "${searchTerm}"`
                            : historyTab === 'turno'
                                ? 'No hay ventas registradas en el turno activo'
                                : 'Aún no hay ventas en el historial general'}
                    </p>
                    <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
                        {searchTerm
                            ? 'Prueba buscando por número de ticket, producto, cliente, método de pago o monto.'
                            : historyTab === 'turno'
                                ? 'Las ventas que realices durante este turno aparecerán aquí.'
                                : 'Las ventas facturadas se acumularán en esta sección.'}
                    </p>
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            className="mt-2 text-xs text-brand font-bold bg-brand/10 hover:bg-brand/20 px-3 py-1.5 rounded-lg transition-colors"
                        >
                            Limpiar búsqueda
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                {paginatedSales.map(s => {
                    const d = new Date(s.timestamp);
                    const hasCashea = (s.payments && s.payments.some(p => 
                        (p.methodId && p.methodId.toLowerCase().includes('cashea')) || 
                        (p.methodLabel && p.methodLabel.toLowerCase().includes('cashea')) || 
                        p.isCashea
                    )) || (s.casheaUsd > 0) || (s.tipo === 'VENTA_CASHEA');

                    let methodLabel = 'Efectivo';
                    let PayMethodIcon = PAYMENT_ICONS['efectivo_bs'];

                    if (s.tipo === 'VENTA_FIADA') {
                        methodLabel = 'Por Cobrar';
                        PayMethodIcon = Clock;
                    } else if (s.payments && s.payments.length > 1) {
                        methodLabel = hasCashea ? 'Mixto (Cashea)' : 'Pago Mixto';
                        PayMethodIcon = Shuffle;
                    } else if (s.tipo === 'VENTA_CASHEA' || hasCashea) {
                        methodLabel = 'Cashea';
                        PayMethodIcon = Smartphone;
                    } else if (s.payments && s.payments.length === 1) {
                        methodLabel = toTitleCase(s.payments[0].methodLabel);
                        const m = getPaymentMethod(s.payments[0].methodId);
                        if (m) PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                    } else if (s.paymentMethod) {
                        const m = getPaymentMethod(s.paymentMethod);
                        if (m) {
                            methodLabel = toTitleCase(m.label);
                            PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                        }
                    }

                    const isCanceled = s.status === 'ANULADA';
                    const isExpanded = expandedSaleId === s.id;

                    return (
                        <div key={s.id} className={`rounded-xl border transition-all ${isCanceled ? 'bg-red-50/50 border-red-100/50 dark:bg-red-900/10 dark:border-red-900/20' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/60'} overflow-hidden`}>
                            <div
                                className="flex items-center gap-3 p-3 cursor-pointer select-none active:bg-slate-100 dark:active:bg-slate-800"
                                onClick={() => setExpandedSaleId(isExpanded ? null : s.id)}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                    isCanceled 
                                        ? 'bg-red-100 opacity-50' 
                                        : hasCashea
                                            ? 'bg-purple-150 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800'
                                            : 'bg-white dark:bg-slate-700 shadow-sm'
                                }`}>
                                    {isCanceled ? (
                                        <Ban size={20} className="text-red-400" />
                                    ) : (s.tipo === 'VENTA_CASHEA' || (hasCashea && !(s.payments && s.payments.length > 1))) ? (
                                        <CasheaIcon size={24} />
                                    ) : PayMethodIcon ? (
                                        <PayMethodIcon size={20} className="text-slate-500 dark:text-slate-400" />
                                    ) : (
                                        <span className="text-xl">💵</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-bold flex items-center gap-1.5 truncate ${isCanceled ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                        {s.tipo === 'AVANCE_EFECTIVO' ? 'Avance de Efectivo' : (s.customerName || 'Consumidor Final')} 
                                        {s.tipo === 'VENTA_FIADA' && <span className="text-[9px] bg-amber-100 text-amber-600 px-1 rounded uppercase font-black">Fiado</span>}
                                        {hasCashea && <span className="text-[9px] bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded uppercase font-black flex items-center gap-0.5"><CasheaIcon size={10} /> Cashea</span>}
                                    </p>
                                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                                        {s.saleNumber && <span className="font-black text-slate-400">#{String(s.saleNumber).padStart(7, '0')}</span>}
                                        {s.saleNumber && <span>·</span>}
                                        <span>{d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span> ·
                                        <span>{methodLabel}</span>
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className={`text-sm font-black ${isCanceled ? 'text-slate-400' : copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'}`}>
                                        {copEnabled && copPrimary
                                            ? `${formatCop((s.totalUsd || 0) * tasaCop)} COP`
                                            : `$${(s.totalUsd || 0).toFixed(2)}`}
                                    </p>
                                    {copEnabled && tasaCop > 0 && (
                                        <p className="text-[10px] font-medium">
                                            {copPrimary
                                                ? <><span className="text-slate-500 dark:text-slate-400">${(s.totalUsd || 0).toFixed(2)}</span><span className="text-slate-300 mx-0.5">|</span></>
                                                : <><span className="text-amber-600 dark:text-amber-400">{formatCop((s.totalUsd || 0) * tasaCop)} COP</span><span className="text-slate-300 mx-0.5">|</span></>}
                                            <span className="text-brand dark:text-brand">{formatBs((s.totalBs || (s.totalUsd || 0) * (s.rate || bcvRate)))} Bs</span>
                                        </p>
                                    )}
                                    <div className="flex justify-end mt-0.5">
                                        {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                    </div>
                                </div>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                                <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700/50 text-sm animate-in fade-in slide-in-from-top-1">
                                    {s.tipo === 'AVANCE_EFECTIVO' ? (
                                        <div className="space-y-1 mb-3 pt-2">
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Detalles del Avance</p>
                                            <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
                                                <span>Efectivo Entregado:</span>
                                                <strong className="font-bold text-slate-800 dark:text-white">
                                                    {s.currency === 'BS' ? `${formatBs(s.montoEfectivo)} Bs` : `$${s.montoEfectivo.toFixed(2)}`}
                                                </strong>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
                                                <span>Comisión Recargada ({s.comisionPct}%):</span>
                                                <strong className="font-bold text-emerald-600 dark:text-emerald-450">
                                                    {s.currency === 'BS' ? `+${formatBs(s.montoComision)} Bs` : `+$${s.montoComision.toFixed(2)}`}
                                                </strong>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-200 pt-1 border-t border-slate-200/50 dark:border-slate-800/50">
                                                <span>Total Cobrado:</span>
                                                <strong className="font-black text-brand">
                                                    {s.currency === 'BS' ? `${formatBs(s.totalCobrado)} Bs` : `$${s.totalCobrado.toFixed(2)}`}
                                                </strong>
                                            </div>
                                        </div>
                                    ) : s.items && s.items.length > 0 ? (
                                        <div className="space-y-1 mb-3 pt-2">
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Productos ({s.items.length})</p>
                                            {s.items.map((item, i) => (
                                                <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'}`}>
                                                    <span className="truncate pr-2">
                                                        {item.isWeight ? `${item.qty.toFixed(3)}kg` : `${item.qty}u`} {item.name}
                                                        {(item.isWeight || item.qty !== 1) && (
                                                            <span className="text-[10px] text-slate-400 font-normal ml-1">
                                                                ({item.isWeight ? '' : 'c/u '}{copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(item.priceCop || Math.round(item.priceUsd * tasaCop))} COP` : `$${item.priceUsd.toFixed(2)}`})
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="font-medium text-right">
                                                        {copEnabled && copPrimary
                                                            ? <span className="text-amber-600 dark:text-amber-400">{formatCop((item.priceCop || Math.round(item.priceUsd * tasaCop)) * item.qty)} COP</span>
                                                            : <span>${(item.priceUsd * item.qty).toFixed(2)}</span>}
                                                        {copEnabled && tasaCop > 0
                                                            ? <span className="text-slate-400 font-normal ml-1">
                                                                {copPrimary
                                                                    ? <>${(item.priceUsd * item.qty).toFixed(2)} · <span className="text-brand dark:text-brand">{formatBs(item.priceUsd * item.qty * (s.rate || bcvRate))} Bs</span></>
                                                                    : <>{formatCop((item.priceCop || Math.round(item.priceUsd * tasaCop)) * item.qty)} COP · <span className="text-brand dark:text-brand">{formatBs(item.priceUsd * item.qty * (s.rate || bcvRate))} Bs</span></>}
                                                              </span>
                                                            : <span className="text-slate-400 font-normal ml-1">· {formatBs(item.priceUsd * item.qty * (s.rate || bcvRate))} Bs</span>}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 mb-3 pt-2">Pago de Deudas (Sin productos)</p>
                                    )}

                                    {s.payments && s.payments.length > 0 && (
                                        <div className="space-y-1 mb-3 pt-2 border-t border-dashed border-slate-200 dark:border-slate-700/50">
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Detalle de Pago</p>
                                            {s.payments.map((p, i) => {
                                                const pIsCop = p.currency === 'COP';
                                                const isBs = !pIsCop && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
                                                const val = pIsCop
                                                    ? 'COP ' + (p.amountInput || (p.amountUsd * (s.tasaCop || tasaCop || 1))).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                                    : isBs
                                                    ? 'Bs ' + formatBs(p.amountBs || (p.amountUsd * (s.rate || bcvRate)))
                                                    : `$${(p.amountUsd || 0).toFixed(2)}`;
                                                
                                                const isCashea = p.methodId === 'cashea';
                                                
                                                return (
                                                    <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : isCashea ? 'text-purple-650 dark:text-purple-400 font-bold' : 'text-slate-600 dark:text-slate-350'}`}>
                                                        <span className="flex items-center gap-1.5">
                                                            {isCashea && <CasheaIcon size={12} />}
                                                            {p.methodLabel || 'Pago'}
                                                        </span>
                                                        <span className="font-semibold">{val} {p.methodId !== 'cashea' && p.amountUsd > 0 && <span className="text-[10px] font-normal text-slate-450">(${(p.amountUsd || 0).toFixed(2)})</span>}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {(() => {
                                        const allocation = s.changeAllocation;
                                        const tipUsd = s.tipDonated?.amountUsd || allocation?.keptInCashUsd || 0;
                                        const tipBs = s.tipDonated?.amountBs || 0;
                                        const monederoUsd = s.vueltoParaMonedero || allocation?.creditedUsd || 0;

                                        let deliveredUsd = 0;
                                        let deliveredBs = 0;

                                        if (allocation) {
                                            deliveredUsd = allocation.deliveredUsd || 0;
                                            deliveredBs = allocation.deliveredBs || 0;
                                        } else {
                                            const rawChangeUsd = s.changeUsd || 0;
                                            const remainingDelivered = Math.max(0, rawChangeUsd - tipUsd - monederoUsd);
                                            if (remainingDelivered > 0.009) {
                                                deliveredUsd = remainingDelivered;
                                                deliveredBs = s.changeBs || 0;
                                            } else if (rawChangeUsd > 0.009 && tipUsd === 0 && monederoUsd === 0) {
                                                deliveredUsd = rawChangeUsd;
                                                deliveredBs = s.changeBs || 0;
                                            }
                                        }

                                        const hasExtraInfo = s.casheaUsd > 0 || deliveredUsd > 0 || deliveredBs > 0 || monederoUsd > 0 || tipUsd > 0;

                                        return (
                                            <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 rounded-xl p-2.5 mb-3 space-y-2">
                                                {/* Tasa y referencia */}
                                                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-slate-600 dark:text-slate-300">Tasa:</span>
                                                        <span>{formatBs(s.rate || bcvRate)} Bs/$</span>
                                                        <span className="text-slate-300 dark:text-slate-700">•</span>
                                                        <span>Ref: <strong className="font-bold text-slate-700 dark:text-slate-300">{formatBs(s.totalBs)} Bs</strong></span>
                                                        {s.tasaCop > 0 && (
                                                            <>
                                                                <span className="text-slate-300 dark:text-slate-700">•</span>
                                                                <span>COP: {(s.totalCop || (s.totalUsd * s.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Badges de distribución de vuelto / Cashea */}
                                                {hasExtraInfo && (
                                                    <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-200/60 dark:border-slate-800">
                                                        {/* Cashea */}
                                                        {s.casheaUsd > 0 && (
                                                            <div className="inline-flex items-center gap-1 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-black px-2 py-1 rounded-lg border border-purple-200 dark:border-purple-800/60 text-[10px]">
                                                                <CasheaIcon size={11} />
                                                                <span>Cashea: Inicial ${((s.totalUsd || 0) - (s.casheaUsd || 0)).toFixed(2)} · Financia ${s.casheaUsd.toFixed(2)}</span>
                                                            </div>
                                                        )}

                                                        {/* Vuelto Entregado */}
                                                        {(deliveredUsd > 0 || deliveredBs > 0) && (
                                                            <div className="inline-flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 font-black px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-800/60 text-[10px]">
                                                                <CornerDownLeft size={11} className="text-blue-600 dark:text-blue-400 shrink-0" />
                                                                <span>
                                                                    Vuelto entregado:{' '}
                                                                    {deliveredUsd > 0 ? `$${deliveredUsd.toFixed(2)}` : ''}
                                                                    {deliveredUsd > 0 && deliveredBs > 0 ? ' + ' : ''}
                                                                    {deliveredBs > 0 ? `Bs ${formatBs(deliveredBs)}` : ''}
                                                                </span>
                                                            </div>
                                                        )}

                                                        {/* Dejado en caja / Propina */}
                                                        {tipUsd > 0 && (
                                                            <div className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-black px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800/60 text-[10px]">
                                                                <HandCoins size={11} className="text-emerald-600 shrink-0" />
                                                                <span>
                                                                    Dejado en caja: {s.tipDonated?.currency === 'BS' ? `Bs ${formatBs(tipBs || tipUsd * (s.rate || bcvRate))}` : `$${tipUsd.toFixed(2)}`}
                                                                </span>
                                                            </div>
                                                        )}

                                                        {/* Saldo a Favor / Billetera */}
                                                        {['VENTA', 'VENTA_CASHEA'].includes(s.tipo) && monederoUsd > 0 && (
                                                            <div className={`inline-flex items-center gap-1.5 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-300 font-black px-2 py-1 rounded-lg border border-cyan-200 dark:border-cyan-800/60 text-[10px] ${isCanceled ? 'line-through opacity-70' : ''}`}>
                                                                <Wallet size={11} className="text-cyan-600 shrink-0" />
                                                                <span>
                                                                    {isCanceled ? 'Saldo a favor revertido' : 'Acreditado a billetera'}: +${monederoUsd.toFixed(2)}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!s.customerName || s.customerName === 'Consumidor Final') {
                                                    onRequestClientForTicket(s);
                                                } else {
                                                    onShareWhatsApp(s);
                                                }
                                            }}
                                            className="flex-1 min-w-[120px] whitespace-nowrap py-2 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 hover:dark:bg-emerald-900/50 active:scale-95">
                                            <Send size={14} /> Enviar Ticket
                                        </button>
                                        {onDownloadPDF && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDownloadPDF(s); }}
                                                className="py-2 px-3 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand hover:bg-brand-light hover:dark:bg-surface-800/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm">
                                                PDF
                                            </button>
                                        )}
                                        {onPrintTicket && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onPrintTicket(s); }}
                                                className="py-2 px-3 bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                                                title="Imprimir ticket"
                                            >
                                                <Printer size={14} />
                                                <span>Imprimir</span>
                                            </button>
                                        )}

                                        {isAdmin && !isCanceled && !s.cajaCerrada && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onVoidSale(s); }}
                                                className="py-2 px-3 bg-slate-100 dark:bg-slate-900 text-red-600 dark:text-red-400 hover:bg-red-50 hover:dark:bg-red-900/30 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-800 shadow-sm active:scale-95">
                                                <Ban size={14} /> Anular
                                            </button>
                                        )}
                                        {!isCanceled && s.cajaCerrada && (
                                            <div title="Venta protegida por Cierre de Caja" className="py-2 px-3 bg-slate-50 dark:bg-slate-900 text-slate-400 font-bold rounded-lg flex justify-center items-center gap-1.5 text-[10px] uppercase border border-slate-100 dark:border-slate-800 tracking-wider cursor-not-allowed">
                                                <LockIcon size={12} /> Cerrada
                                            </div>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onRecycleSale(s); }}
                                            className="py-2 px-3 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand hover:bg-brand-light hover:dark:bg-surface-800/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95">
                                            <Recycle size={14} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            )}

            {filteredSales.length > 0 && (
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
                    label="ventas"
                />
            )}
        </div>
    );
}
