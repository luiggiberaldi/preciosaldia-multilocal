import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal } from '../Modal';
import CustomSelect from '../CustomSelect';
import { getActivePaymentMethods, getPaymentIcon, getPaymentLabel } from '../../config/paymentMethods';
import {
    Trash2,
    AlertCircle,
    Calendar,
    CreditCard,
    PlusCircle,
    History,
    Package,
    Lightbulb,
    Car,
    User,
    Wrench,
    FileText,
    TrendingDown,
    Info,
    ShoppingBag,
    Search,
    X,
    Plus,
    Minus,
    DollarSign,
    Tag,
} from 'lucide-react';
import { getLocalISODate } from '../../utils/dateHelpers';
import { useAuthStore } from '../../hooks/store/useAuthStore';

// Map GASTO_CATEGORIES identifiers to professional styling
const CATEGORY_META = {
    insumos: {
        label: 'Insumos',
        icon: Package,
        activeClass: 'bg-blue-50/80 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/30 text-blue-600 dark:text-blue-400',
        iconColor: 'text-blue-500',
        bgIcon: 'bg-blue-100/50 dark:bg-blue-900/40',
        hoverClass: 'hover:border-blue-300 dark:hover:border-blue-800 hover:bg-blue-50/30'
    },
    servicios: {
        label: 'Servicios',
        icon: Lightbulb,
        activeClass: 'bg-amber-50/80 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/30 text-amber-600 dark:text-amber-400',
        iconColor: 'text-amber-500',
        bgIcon: 'bg-amber-100/50 dark:bg-amber-900/40',
        hoverClass: 'hover:border-amber-300 dark:hover:border-amber-800 hover:bg-amber-50/30'
    },
    transporte: {
        label: 'Transporte',
        icon: Car,
        activeClass: 'bg-indigo-50/80 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-900/30 text-indigo-600 dark:text-indigo-400',
        iconColor: 'text-indigo-500',
        bgIcon: 'bg-indigo-100/50 dark:bg-indigo-900/40',
        hoverClass: 'hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-indigo-50/30'
    },
    personal: {
        label: 'Personal',
        icon: User,
        activeClass: 'bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400',
        iconColor: 'text-emerald-500',
        bgIcon: 'bg-emerald-100/50 dark:bg-emerald-900/40',
        hoverClass: 'hover:border-emerald-300 dark:hover:border-emerald-800 hover:bg-emerald-50/30'
    },
    mantenimiento: {
        label: 'Mantenimiento',
        icon: Wrench,
        activeClass: 'bg-rose-50/80 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900/30 text-rose-600 dark:text-rose-400',
        iconColor: 'text-rose-500',
        bgIcon: 'bg-rose-100/50 dark:bg-rose-900/40',
        hoverClass: 'hover:border-rose-300 dark:hover:border-rose-800 hover:bg-rose-50/30'
    },
    autoconsumo: {
        label: 'Autoconsumo',
        icon: ShoppingBag,
        activeClass: 'bg-violet-50/80 border-violet-200 dark:bg-violet-950/20 dark:border-violet-900/30 text-violet-600 dark:text-violet-400',
        iconColor: 'text-violet-500',
        bgIcon: 'bg-violet-100/50 dark:bg-violet-900/40',
        hoverClass: 'hover:border-violet-300 dark:hover:border-violet-800 hover:bg-violet-50/30'
    },
    otros: {
        label: 'Otros',
        icon: FileText,
        activeClass: 'bg-slate-100 border-slate-300 dark:bg-slate-800/80 dark:border-slate-700 text-slate-700 dark:text-slate-300',
        iconColor: 'text-slate-500',
        bgIcon: 'bg-slate-150 dark:bg-slate-800',
        hoverClass: 'hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50'
    }
};

export default function GastosInternosModal({
    isOpen,
    onClose,
    sales = [],
    products = [],
    bcvRate = 0,
    tasaCop = 0,
    copEnabled = false,
    registrarGasto,
    registrarAutoconsumo,
    anularGasto,
    triggerHaptic
}) {
    const { usuarioActivo, requireLogin } = useAuthStore();
    const isCajero = requireLogin && usuarioActivo?.rol === 'CAJERO';
    const canDeleteGasto = !isCajero;

    const [activeTab, setActiveTab]           = useState('registrar');
    // ── Campos de gasto normal ──
    const [description, setDescription]       = useState('');
    const [category, setCategory]             = useState('otros');
    const [currency, setCurrency]             = useState('USD');
    const [amount, setAmount]                 = useState('');
    const [selectedMethodId, setSelectedMethodId] = useState('');
    const [note, setNote]                     = useState('');
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [loadingMethods, setLoadingMethods] = useState(true);
    // ── Modo autoconsumo ──
    const [isAutoconsumo, setIsAutoconsumo]   = useState(false);
    const [productSearch, setProductSearch]   = useState('');
    const [selectedItems, setSelectedItems]   = useState([]); // [{ id, name, stock, costUsd, priceUsd, qty, valoracion }]
    const [valoracion, setValoracion]         = useState('costo'); // 'costo' | 'venta'
    const [showResults, setShowResults]       = useState(false);
    const [lastSeenCount, setLastSeenCount]   = useState(0);
    const [gastoToVoid, setGastoToVoid]       = useState(null);

    // Fetch active payment methods
    useEffect(() => {
        if (isOpen) {
            getActivePaymentMethods().then(methods => {
                setPaymentMethods(methods);
                setLoadingMethods(false);
            });
        }
    }, [isOpen]);

    // Filter payment methods based on selected currency
    const filteredMethods = useMemo(() => {
        return paymentMethods.filter(m => m.currency === currency);
    }, [paymentMethods, currency]);

    // Map filtered payment methods to CustomSelect options format with professional Lucide icons
    const methodOptions = useMemo(() => {
        return filteredMethods.map(m => {
            const IconComponent = getPaymentIcon(m.id);
            let iconColor = "text-slate-500 dark:text-slate-400";
            if (m.id.includes('bs')) iconColor = "text-emerald-600 dark:text-emerald-400";
            else if (m.id.includes('usd') || m.id.includes('zelle')) iconColor = "text-emerald-500 dark:text-emerald-400";
            else if (m.id.includes('cop')) iconColor = "text-amber-500 dark:text-amber-400";
            else if (m.id.includes('punto')) iconColor = "text-blue-500 dark:text-blue-400";
            else if (m.id.includes('movil')) iconColor = "text-purple-500 dark:text-purple-400";
            return {
                value: m.id,
                label: m.label,
                icon: IconComponent ? <IconComponent size={15} className={iconColor} /> : null
            };
        });
    }, [filteredMethods]);

    // Auto-select first payment method of selected currency
    useEffect(() => {
        if (filteredMethods.length > 0) {
            setSelectedMethodId(filteredMethods[0].id);
        } else {
            setSelectedMethodId('');
        }
    }, [filteredMethods]);

    // Reset form when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setDescription('');
            setCategory('otros');
            setCurrency('USD');
            setAmount('');
            setNote('');
            setActiveTab('registrar');
            setIsAutoconsumo(false);
            setSelectedItems([]);
            setProductSearch('');
            setValoracion('costo');
            setLastSeenCount(0); // reset badge on every open
        }
    }, [isOpen]);

    // When category switches to autoconsumo, activate the toggle automatically
    useEffect(() => {
        if (category === 'autoconsumo') setIsAutoconsumo(true);
        else if (isAutoconsumo) setIsAutoconsumo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [category]);

    // When toggle activates, auto-switch category to autoconsumo
    useEffect(() => {
        if (isAutoconsumo) setCategory('autoconsumo');
        else if (category === 'autoconsumo') setCategory('otros');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAutoconsumo]);

    // ── Product search results ──
    const searchResults = useMemo(() => {
        if (!productSearch.trim() || productSearch.length < 2) return [];
        const q = productSearch.toLowerCase();
        return products
            .filter(p => p.name?.toLowerCase().includes(q) || p.barcode?.includes(q))
            .slice(0, 8);
    }, [products, productSearch]);

    // ── Auto-generate description from selected items ──
    useEffect(() => {
        if (!isAutoconsumo) return;
        if (selectedItems.length === 0) {
            setDescription('');
            return;
        }
        const parts = selectedItems.map(i => `${i.qty}u ${i.name}`);
        setDescription(`Retiro: ${parts.join(', ')}`);
    }, [selectedItems, isAutoconsumo]);

    // ── Totals for autoconsumo ──
    const autoconsumoTotalUsd = useMemo(() => {
        return selectedItems.reduce((sum, i) => {
            const price = valoracion === 'costo' ? (i.costUsd || 0) : (i.priceUsd || 0);
            return sum + price * i.qty;
        }, 0);
    }, [selectedItems, valoracion]);

    const autoconsumoTotalBs = useMemo(() => {
        return autoconsumoTotalUsd * bcvRate;
    }, [autoconsumoTotalUsd, bcvRate]);

    const addProductToList = useCallback((product) => {
        triggerHaptic && triggerHaptic();
        setSelectedItems(prev => {
            const existing = prev.find(i => i.id === product.id);
            if (existing) {
                return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
            }
            return [...prev, {
                id:       product.id,
                name:     product.name,
                stock:    product.stock ?? 0,
                costUsd:  product.costUsd  || 0,
                priceUsd: product.priceUsd || 0,
                qty:      1,
            }];
        });
        setProductSearch('');
        setShowResults(false);
    }, [triggerHaptic]);

    const updateItemQty = useCallback((id, delta) => {
        setSelectedItems(prev =>
            prev
                .map(i => i.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i)
        );
    }, []);

    const removeItem = useCallback((id) => {
        triggerHaptic && triggerHaptic();
        setSelectedItems(prev => prev.filter(i => i.id !== id));
    }, [triggerHaptic]);

    // ── Get today's expenses ──
    const today = getLocalISODate();
    const todayExpenses = useMemo(() => {
        return sales.filter(s => {
            if (s.tipo !== 'GASTO_INTERNO') return false;
            const saleDate = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : today;
            return saleDate === today;
        });
    }, [sales, today]);

    const activeTodayExpensesCount = useMemo(() => {
        return todayExpenses.filter(s => s.status !== 'ANULADA').length;
    }, [todayExpenses]);

    // ── Currency conversions (for normal gasto) ──
    const parsedAmount = parseFloat(amount) || 0;
    const equivalentBs = useMemo(() => {
        if (currency === 'BS')  return parsedAmount;
        if (currency === 'USD') return parsedAmount * bcvRate;
        if (currency === 'COP' && tasaCop > 0) return (parsedAmount / tasaCop) * bcvRate;
        return 0;
    }, [parsedAmount, currency, bcvRate, tasaCop]);

    const equivalentUsd = useMemo(() => {
        if (currency === 'USD') return parsedAmount;
        if (currency === 'BS' && bcvRate > 0) return parsedAmount / bcvRate;
        if (currency === 'COP' && tasaCop > 0) return parsedAmount / tasaCop;
        return 0;
    }, [parsedAmount, currency, bcvRate, tasaCop]);

    const equivalentCop = useMemo(() => {
        if (currency === 'COP') return parsedAmount;
        if (currency === 'USD') return parsedAmount * tasaCop;
        if (currency === 'BS' && bcvRate > 0) return (parsedAmount / bcvRate) * tasaCop;
        return 0;
    }, [parsedAmount, currency, bcvRate, tasaCop]);

    const handleAmountChange = (e) => {
        let v = e.target.value.replace(',', '.');
        if (!/^[0-9.]*$/.test(v)) return;
        const dots = v.match(/\./g);
        if (dots && dots.length > 1) return;
        setAmount(v);
    };

    // ── Submit ──
    const handleSubmit = async (e) => {
        e.preventDefault();

        if (isAutoconsumo) {
            // Autoconsumo path
            if (selectedItems.length === 0) {
                return;
            }
            await registrarAutoconsumo({
                description,
                items:      selectedItems,
                valoracion,
                note,
                totalUsd:   autoconsumoTotalUsd,
                totalBs:    autoconsumoTotalBs,
            });
            setSelectedItems([]);
            setDescription('');
            setNote('');
            return;
        }

        // Normal gasto path
        if (!description.trim() || parsedAmount <= 0 || !selectedMethodId) return;
        const success = await registrarGasto({
            description,
            category,
            amountUsd: currency === 'USD' ? parsedAmount : parseFloat(equivalentUsd.toFixed(4)),
            amountBs:  currency === 'BS'  ? parsedAmount : parseFloat(equivalentBs.toFixed(2)),
            methodId: selectedMethodId,
            currency,
            note
        });
        if (success) {
            setDescription('');
            setAmount('');
            setNote('');
        }
    };

    const isSubmitDisabled = isAutoconsumo
        ? selectedItems.length === 0
        : (!description.trim() || parsedAmount <= 0 || !selectedMethodId);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Egresos y Gastos Internos"
            size="max-w-2xl"
        >
            {/* Tabs Selector */}
            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl mb-6 border border-slate-200/30 dark:border-slate-700/30">
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setActiveTab('registrar'); }}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                        activeTab === 'registrar'
                            ? 'bg-white dark:bg-slate-700 text-brand shadow-md shadow-slate-200/50 dark:shadow-none'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                >
                    <PlusCircle size={15} />
                    Registrar Gasto
                </button>
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setActiveTab('historial'); setLastSeenCount(activeTodayExpensesCount); }}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                        activeTab === 'historial'
                            ? 'bg-white dark:bg-slate-700 text-brand shadow-md shadow-slate-200/50 dark:shadow-none'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                >
                    <History size={15} />
                    <span>Historial de Hoy</span>
                    {activeTodayExpensesCount > lastSeenCount && activeTab !== 'historial' && (
                        <span className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center justify-center min-w-[16px] h-4 shrink-0 animate-pulse">
                            {activeTodayExpensesCount}
                        </span>
                    )}
                </button>
            </div>

            {activeTab === 'registrar' ? (
                <form onSubmit={handleSubmit} className="space-y-5">

                    {/* ── Toggle Autoconsumo ── */}
                    <div
                        className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer transition-all ${
                            isAutoconsumo
                                ? 'bg-violet-50/80 border-violet-200 dark:bg-violet-950/20 dark:border-violet-900/40'
                                : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200/30 dark:border-slate-700/30 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                        onClick={() => { triggerHaptic && triggerHaptic(); setIsAutoconsumo(v => !v); }}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isAutoconsumo ? 'bg-violet-100 dark:bg-violet-900/40' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                <ShoppingBag size={17} className={isAutoconsumo ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400'} />
                            </div>
                            <div>
                                <p className={`text-xs font-black ${isAutoconsumo ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-slate-300'}`}>
                                    Retiro de Mercancía (Autoconsumo)
                                </p>
                                <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                                    {isAutoconsumo ? 'Descuenta inventario · No afecta caja' : 'Activar para retirar productos del inventario'}
                                </p>
                            </div>
                        </div>
                        <div className={`w-11 h-6 rounded-full flex items-center transition-all duration-300 relative ${isAutoconsumo ? 'bg-violet-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                            <div className={`w-5 h-5 rounded-full bg-white shadow-sm absolute transition-all duration-300 ${isAutoconsumo ? 'left-[22px]' : 'left-[2px]'}`} />
                        </div>
                    </div>

                    {/* ════════════════════════════════════════
                        MODO AUTOCONSUMO
                    ════════════════════════════════════════ */}
                    {isAutoconsumo ? (
                        <div className="space-y-4">

                            {/* Valoración */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Valorar por
                                </label>
                                <div className="flex bg-slate-50 dark:bg-slate-800/40 p-1 rounded-2xl border border-slate-200/20 dark:border-slate-700/20">
                                    {[
                                        { key: 'costo', label: 'Precio de Costo', Icon: DollarSign },
                                        { key: 'venta', label: 'Precio de Venta', Icon: Tag }
                                    ].map(opt => (
                                        <button
                                            key={opt.key}
                                            type="button"
                                            onClick={() => { triggerHaptic && triggerHaptic(); setValoracion(opt.key); }}
                                            className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                                                valoracion === opt.key
                                                    ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm font-black'
                                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                                            }`}
                                        >
                                            <opt.Icon size={13} />
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                {valoracion === 'costo' && (
                                    <p className="text-[9px] text-slate-400 font-medium mt-1 ml-1">
                                        Recomendado · Refleja el costo real del inventario retirado
                                    </p>
                                )}
                            </div>

                            {/* Buscador + Lista — 2 columnas en desktop */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">

                                {/* Columna izquierda — Buscador */}
                                <div className="relative">
                                    <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                        Buscar Producto
                                    </label>
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={productSearch}
                                            onChange={e => { setProductSearch(e.target.value); setShowResults(true); }}
                                            onFocus={() => setShowResults(true)}
                                            placeholder="Nombre o código de barras..."
                                            className="w-full pl-9 pr-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                        />
                                    </div>

                                    {/* Resultados dropdown */}
                                    {showResults && searchResults.length > 0 && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-50 overflow-hidden max-h-52 overflow-y-auto">
                                            {searchResults.map(p => (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    onClick={() => addProductToList(p)}
                                                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors text-left"
                                                >
                                                    <div>
                                                        <p className="text-xs font-black text-slate-800 dark:text-white leading-tight">{p.name}</p>
                                                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                                                            Stock: {p.stock ?? 0} ·{' '}
                                                            Costo ${(p.costUsd || 0).toFixed(2)} ·{' '}
                                                            Precio ${(p.priceUsd || 0).toFixed(2)}
                                                        </p>
                                                    </div>
                                                    <Plus size={15} className="text-violet-500 shrink-0 ml-2" />
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {showResults && productSearch.length >= 2 && searchResults.length === 0 && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-50 px-4 py-3 text-xs font-bold text-slate-400">
                                            Sin resultados para "{productSearch}"
                                        </div>
                                    )}

                                    {/* Hint cuando no hay búsqueda */}
                                    {!productSearch && (
                                        <p className="text-[9px] font-bold text-slate-400 mt-2 ml-1">
                                            Escribe mínimo 2 caracteres para buscar
                                        </p>
                                    )}
                                </div>

                                {/* Columna derecha — Productos seleccionados */}
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider ml-1">
                                        Productos a Retirar
                                    </label>

                                    {selectedItems.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-24 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-400">
                                            <ShoppingBag size={20} className="mb-1.5 opacity-40" />
                                            <p className="text-[10px] font-bold">Sin productos aún</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                                {selectedItems.map(item => {
                                                    const unitPrice = valoracion === 'costo' ? (item.costUsd || 0) : (item.priceUsd || 0);
                                                    const subtotal = unitPrice * item.qty;
                                                    return (
                                                        <div key={item.id} className="flex items-center gap-2 p-2.5 rounded-2xl bg-violet-50/60 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/30">
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-xs font-black text-slate-800 dark:text-white truncate">{item.name}</p>
                                                                <p className="text-[9px] font-bold text-violet-500 mt-0.5">
                                                                    ${unitPrice.toFixed(2)} c/u = ${subtotal.toFixed(2)}
                                                                </p>
                                                            </div>
                                                            {/* Qty controls */}
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updateItemQty(item.id, -1)}
                                                                    className="w-6 h-6 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                                                                >
                                                                    <Minus size={10} />
                                                                </button>
                                                                <span className="w-5 text-center text-xs font-black text-slate-700 dark:text-white">{item.qty}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updateItemQty(item.id, 1)}
                                                                    className="w-6 h-6 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                                                                >
                                                                    <Plus size={10} />
                                                                </button>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => removeItem(item.id)}
                                                                className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors shrink-0"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Total del autoconsumo */}
                                            <div className="flex items-center justify-between p-3 rounded-2xl bg-violet-500/10 border border-violet-200/50 dark:border-violet-800/30">
                                                <span className="text-xs font-black text-violet-700 dark:text-violet-300">Total a descontar</span>
                                                <div className="text-right">
                                                    <span className="text-sm font-black text-violet-600 dark:text-violet-400">
                                                        ${autoconsumoTotalUsd.toFixed(2)} USD
                                                    </span>
                                                    {bcvRate > 0 && (
                                                        <p className="text-[9px] font-bold text-violet-400 mt-0.5">
                                                            Bs {autoconsumoTotalBs.toFixed(2)}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                            </div>{/* fin grid 2 cols */}


                            {/* Descripción editable */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Descripción (Autogenerada / Editable)
                                </label>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Se genera automáticamente al agregar productos..."
                                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                />
                            </div>

                            {/* Nota */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Nota (Opcional)
                                </label>
                                <input
                                    type="text"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="Ej. Para consumo personal, evento familiar..."
                                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                />
                            </div>

                            {/* Info badge */}
                            <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30">
                                <Info size={14} className="text-amber-500 mt-0.5 shrink-0" />
                                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 leading-relaxed">
                                    Este retiro <strong>descuenta el inventario</strong> pero <strong>no afecta el arqueo de caja</strong>. Quedará registrado en el reporte de gastos como "Autoconsumo".
                                </p>
                            </div>
                        </div>
                    ) : (
                        /* ════════════════════════════════════════
                            MODO GASTO NORMAL
                        ════════════════════════════════════════ */
                        <>
                            {/* Description */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Descripción / Concepto
                                </label>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Ej. Compra de bolsas, bombillo, refresco..."
                                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent focus:bg-white dark:focus:bg-slate-800"
                                    required
                                />
                            </div>

                            {/* Category Selector */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Categoría del Gasto
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {Object.entries(CATEGORY_META).filter(([key]) => key !== 'autoconsumo').map(([key, meta]) => {
                                        const IconComponent = meta.icon;
                                        const isSelected = category === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => { triggerHaptic && triggerHaptic(); setCategory(key); }}
                                                className={`py-3.5 px-2 rounded-2xl border text-center transition-all flex flex-col items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 ${
                                                    isSelected
                                                        ? `${meta.activeClass} shadow-inner`
                                                        : `border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 ${meta.hoverClass}`
                                                }`}
                                            >
                                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                                                    isSelected ? 'bg-white/90 dark:bg-slate-950/20' : meta.bgIcon
                                                }`}>
                                                    <IconComponent size={18} className={isSelected ? 'text-current' : meta.iconColor} />
                                                </div>
                                                <span className="text-[10px] font-black tracking-tight">{meta.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Currency Chips */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Moneda de Pago
                                </label>
                                <div className="flex bg-slate-50 dark:bg-slate-800/40 p-1 rounded-2xl border border-slate-200/20 dark:border-slate-700/20">
                                    <button type="button" onClick={() => { triggerHaptic && triggerHaptic(); setCurrency('USD'); }}
                                        className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${currency === 'USD' ? 'bg-white dark:bg-slate-700 text-brand shadow-sm font-black' : 'text-slate-500 hover:text-slate-850 dark:hover:text-slate-200'}`}>
                                        $ USD
                                    </button>
                                    <button type="button" onClick={() => { triggerHaptic && triggerHaptic(); setCurrency('BS'); }}
                                        className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${currency === 'BS' ? 'bg-white dark:bg-slate-700 text-brand shadow-sm font-black' : 'text-slate-500 hover:text-slate-850 dark:hover:text-slate-200'}`}>
                                        Bs Bolívares
                                    </button>
                                    {copEnabled && (
                                        <button type="button" onClick={() => { triggerHaptic && triggerHaptic(); setCurrency('COP'); }}
                                            className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${currency === 'COP' ? 'bg-white dark:bg-slate-700 text-brand shadow-sm font-black' : 'text-slate-500 hover:text-slate-850 dark:hover:text-slate-200'}`}>
                                            $ COP (Pesos)
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Amount Input */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Monto a Retirar
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={amount}
                                        onChange={handleAmountChange}
                                        onFocus={(e) => {
                                            e.target.select();
                                            if (amount === '0' || amount === '0.00') setAmount('');
                                        }}
                                        placeholder="0.00"
                                        className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-white text-base font-black transition-all focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent focus:bg-white dark:focus:bg-slate-800"
                                        required
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-slate-400 text-xs tracking-wider">
                                        {currency}
                                    </span>
                                </div>

                                {parsedAmount > 0 && (
                                    <div className="mt-2.5 p-3 rounded-2xl bg-amber-500/5 dark:bg-amber-400/5 border border-amber-200/40 dark:border-amber-900/20 space-y-1.5">
                                        <div className="flex items-center gap-1 text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                                            <Info size={11} />
                                            <span>Equivalencias de caja:</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs font-black text-slate-700 dark:text-slate-350 pl-4">
                                            {currency !== 'USD' && <div>$ {equivalentUsd.toFixed(2)} USD</div>}
                                            {currency !== 'BS'  && <div>Bs {equivalentBs.toFixed(2)}</div>}
                                            {copEnabled && currency !== 'COP' && <div>{equivalentCop.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 })} COP</div>}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Payment Method Selector */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Método de Caja / Origen
                                </label>
                                {loadingMethods ? (
                                    <div className="h-12 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-2xl" />
                                ) : filteredMethods.length > 0 ? (
                                    <CustomSelect
                                        value={selectedMethodId}
                                        onChange={setSelectedMethodId}
                                        options={methodOptions}
                                        placeholder="Seleccionar origen de caja..."
                                        className="w-full font-black text-sm"
                                    />
                                ) : (
                                    <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 flex items-start gap-2">
                                        <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                                        <span className="text-[11px] font-bold text-red-650 dark:text-red-400">
                                            No hay métodos de pago habilitados en {currency}. Por favor, configúralos en Ajustes.
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Note */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
                                    Nota / Observación (Opcional)
                                </label>
                                <input
                                    type="text"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="Ej. Factura #4012, para mantenimiento..."
                                    className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent focus:bg-white dark:focus:bg-slate-800"
                                />
                            </div>
                        </>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isSubmitDisabled}
                        className={`w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all duration-300 shadow-md ${
                            isSubmitDisabled
                                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none'
                                : isAutoconsumo
                                    ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-violet-500/10 hover:shadow-lg hover:shadow-violet-500/20 hover:brightness-105 active:scale-95'
                                    : 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-red-500/10 hover:shadow-lg hover:shadow-red-500/20 hover:brightness-105 active:scale-95'
                        }`}
                    >
                        {isAutoconsumo ? <ShoppingBag size={16} strokeWidth={3} /> : <TrendingDown size={16} strokeWidth={3} />}
                        {isAutoconsumo ? 'Registrar Retiro de Inventario' : 'Registrar Gasto de Caja Chica'}
                    </button>
                </form>
            ) : (
                /* ════════════════════════════════════════
                    TAB HISTORIAL
                ════════════════════════════════════════ */
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-slate-50/80 dark:bg-slate-800/40 px-4 py-3.5 rounded-2xl border border-slate-200/20 dark:border-slate-750 font-display">
                        <span className="text-xs font-bold text-slate-500">Total Gastado Hoy</span>
                        <span className="text-base font-black text-red-500">
                            $ {todayExpenses.filter(g => g.status !== 'ANULADA').reduce((sum, g) => sum + Math.abs(g.totalUsd || 0), 0).toFixed(2)} USD
                        </span>
                    </div>

                    {todayExpenses.length === 0 ? (
                        <div className="text-center py-16 text-slate-400/80">
                            <Calendar size={36} className="mx-auto mb-2.5 text-slate-300 dark:text-slate-700" />
                            <p className="text-xs font-bold">No se han registrado gastos hoy</p>
                        </div>
                    ) : (
                        <div className="space-y-2.5 max-h-[45vh] overflow-y-auto pr-1 custom-scrollbar">
                            {todayExpenses.map(g => {
                                const isAutoconsumoRecord = g.isAutoconsumo === true;
                                const meta = isAutoconsumoRecord ? CATEGORY_META.autoconsumo : (CATEGORY_META[g.category] || CATEGORY_META.otros);
                                const IconComponent = meta.icon;
                                const isVoided = g.status === 'ANULADA';
                                const formattedAmount = () => {
                                    if (g.payments && g.payments.length > 0) {
                                        const p = g.payments[0];
                                        if (p.methodId === 'autoconsumo') return `$ ${Math.abs(g.totalUsd || 0).toFixed(2)}`;
                                        if (p.currency === 'USD') return `$ ${Math.abs(p.amountUsd).toFixed(2)}`;
                                        if (p.currency === 'BS')  return `Bs ${Math.abs(p.amountBs).toFixed(2)}`;
                                        if (p.currency === 'COP') return `$ ${Math.abs(p.amountCop).toLocaleString('es-CO')} COP`;
                                    }
                                    return `$ ${Math.abs(g.totalUsd || 0).toFixed(2)}`;
                                };

                                return (
                                    <div
                                        key={g.id}
                                        className={`p-3.5 rounded-2xl border flex items-center justify-between transition-all ${
                                            isVoided
                                                ? 'bg-slate-50/40 dark:bg-slate-900/30 border-slate-100 dark:border-slate-900 opacity-60 line-through'
                                                : g.cajaCerrada
                                                    ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800/80'
                                                    : isAutoconsumoRecord
                                                        ? 'bg-violet-50/50 dark:bg-violet-950/10 border-violet-100 dark:border-violet-900/30 shadow-sm'
                                                        : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800/80 shadow-sm hover:border-slate-200 dark:hover:border-slate-700'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                                                isVoided ? 'bg-slate-100 dark:bg-slate-800 text-slate-400' : meta.bgIcon
                                            }`}>
                                                <IconComponent size={18} className={isVoided ? 'text-slate-400' : meta.iconColor} />
                                            </div>
                                            <div className="text-left">
                                                <div className="text-xs font-black text-slate-850 dark:text-white leading-tight">
                                                    {g.description}
                                                </div>
                                                <div className="text-[9px] font-bold text-slate-400 mt-1 flex items-center gap-1.5">
                                                    <span>{meta.label}</span>
                                                    {isAutoconsumoRecord && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="text-violet-400">Sin impacto en caja</span>
                                                        </>
                                                    )}
                                                    {!isAutoconsumoRecord && (() => {
                                                        const PaymentIcon = getPaymentIcon(g.paymentMethod) || CreditCard;
                                                        return (
                                                            <>
                                                                <span>·</span>
                                                                <span className="flex items-center gap-0.5">
                                                                    <PaymentIcon size={9} className="shrink-0" />
                                                                    {getPaymentLabel(g.paymentMethod) || g.paymentMethod}
                                                                </span>
                                                            </>
                                                        );
                                                    })()}
                                                    {g.note && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="italic font-medium">"{g.note}"</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-black font-display shrink-0 ${isVoided ? 'text-slate-400' : isAutoconsumoRecord ? 'text-violet-500' : 'text-red-500'}`}>
                                                -{formattedAmount()}
                                            </span>

                                            {!isVoided && !g.cajaCerrada && canDeleteGasto && (
                                                <button
                                                    onClick={() => setGastoToVoid(g)}
                                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-full transition-colors"
                                                    title={isAutoconsumoRecord ? 'Anular y devolver stock' : 'Anular gasto'}
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            )}
                                            {isVoided && (
                                                <span className="text-[8px] bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-black px-1.5 py-0.5 rounded">
                                                    ANULADA
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Modal de Confirmación de Anulación (Reemplaza a window.confirm — Regla 15) */}
            {gastoToVoid && (
                <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center animate-in zoom-in-95 duration-200">
                        <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/30 text-red-500 flex items-center justify-center mx-auto mb-4">
                            <Trash2 size={24} />
                        </div>
                        <h3 className="text-base font-black text-slate-800 dark:text-white mb-1">
                            {gastoToVoid.isAutoconsumo ? '¿Anular este retiro?' : '¿Anular este gasto?'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
                            {gastoToVoid.isAutoconsumo
                                ? 'El stock retirado será devuelto automáticamente al inventario.'
                                : 'Esta acción revertirá el egreso de la caja.'}
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setGastoToVoid(null)}
                                className="flex-1 py-2.5 rounded-xl font-bold text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={async () => {
                                    await anularGasto(gastoToVoid.id);
                                    setGastoToVoid(null);
                                }}
                                className="flex-1 py-2.5 rounded-xl font-bold text-xs bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/20 active:scale-95 transition-all"
                            >
                                Sí, Anular
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
}
