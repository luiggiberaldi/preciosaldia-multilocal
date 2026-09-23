import { useState, useMemo } from 'react';
import { 
    TrendingDown, 
    Search, 
    X, 
    Package, 
    Lightbulb, 
    Car, 
    User, 
    Wrench, 
    FileText, 
    CreditCard, 
    Calendar,
    Filter
} from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { getPaymentIcon, getPaymentLabel } from '../../config/paymentMethods';
import EmptyState from '../EmptyState';

const CATEGORY_META = {
    insumos: { label: 'Insumos', icon: Package, bgIcon: 'bg-blue-100 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400' },
    servicios: { label: 'Servicios', icon: Lightbulb, bgIcon: 'bg-amber-100 dark:bg-amber-900/30 text-amber-500 dark:text-amber-400' },
    transporte: { label: 'Transporte', icon: Car, bgIcon: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400' },
    personal: { label: 'Personal', icon: User, bgIcon: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 dark:text-emerald-400' },
    mantenimiento: { label: 'Mantenimiento', icon: Wrench, bgIcon: 'bg-rose-100 dark:bg-rose-900/30 text-rose-500 dark:text-rose-400' },
    proveedor: { label: 'Proveedor', icon: Wrench, bgIcon: 'bg-orange-100 dark:bg-orange-900/30 text-orange-500 dark:text-orange-400' },
    otros: { label: 'Otros', icon: FileText, bgIcon: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' }
};

export default function ReportsExpensesTab({ 
    expensesList = [], 
    expensesUsd = 0, 
    expensesBs = 0, 
    bcvRate = 0, 
    copEnabled = false, 
    copPrimary = false, 
    tasaCop = 0 
}) {
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all'); // all, insumos, servicios, etc.

    // Calculate currency sums
    const totalExpensesCop = useMemo(() => {
        return expensesUsd * tasaCop;
    }, [expensesUsd, tasaCop]);

    // Group expenses by category
    const categoryBreakdown = useMemo(() => {
        const breakdown = {};
        
        // Initialize all categories
        Object.keys(CATEGORY_META).forEach(cat => {
            breakdown[cat] = { key: cat, totalUsd: 0, totalBs: 0, count: 0 };
        });

        expensesList.forEach(g => {
            const isProveedor = g.tipo === 'PAGO_PROVEEDOR';
            const cat = isProveedor ? 'proveedor' : (g.category || 'otros');
            
            if (!breakdown[cat]) {
                breakdown[cat] = { key: cat, totalUsd: 0, totalBs: 0, count: 0 };
            }
            
            breakdown[cat].totalUsd += Math.abs(g.totalUsd || 0);
            breakdown[cat].totalBs += Math.abs(g.totalBs || 0);
            breakdown[cat].count += 1;
        });

        // Filter out categories with zero expenses and sort by highest total USD
        return Object.values(breakdown)
            .filter(c => c.totalUsd > 0)
            .sort((a, b) => b.totalUsd - a.totalUsd);
    }, [expensesList]);

    // Filtered expenses list
    const filteredExpenses = useMemo(() => {
        return expensesList.filter(g => {
            const isProveedor = g.tipo === 'PAGO_PROVEEDOR';
            const catKey = isProveedor ? 'proveedor' : (g.category || 'otros');
            
            const matchesCategory = categoryFilter === 'all' || categoryFilter === catKey;
            
            const text = (g.description || '').toLowerCase();
            const note = (g.note || '').toLowerCase();
            const label = (CATEGORY_META[catKey]?.label || '').toLowerCase();
            const query = searchQuery.toLowerCase().trim();
            const matchesSearch = !query || text.includes(query) || note.includes(query) || label.includes(query);

            return matchesCategory && matchesSearch;
        });
    }, [expensesList, categoryFilter, searchQuery]);

    const maxCategoryTotal = useMemo(() => {
        if (categoryBreakdown.length === 0) return 1;
        return categoryBreakdown[0].totalUsd;
    }, [categoryBreakdown]);

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 flex items-center justify-center mb-2">
                        <TrendingDown size={16} />
                    </div>
                    <p className="text-[10px] font-bold text-slate-650 dark:text-slate-400 uppercase">Total Egresos</p>
                    <p className="text-xl md:text-2xl font-outfit font-semibold text-slate-900 dark:text-white mt-0.5">
                        {copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(totalExpensesCop)} COP` : `$${expensesUsd.toFixed(2)}`}
                    </p>
                    <p className="text-xs font-bold text-slate-650 dark:text-slate-400 mt-0.5">
                        {copEnabled && tasaCop > 0 ? (
                            copPrimary ? `$${expensesUsd.toFixed(2)} · ${formatBs(expensesBs)} Bs` : `${formatCop(totalExpensesCop)} COP · ${formatBs(expensesBs)} Bs`
                        ) : `${formatBs(expensesBs)} Bs`}
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center mb-2">
                        <Package size={16} />
                    </div>
                    <p className="text-[10px] font-bold text-slate-650 dark:text-slate-400 uppercase">Caja Chica</p>
                    <p className="text-xl md:text-2xl font-outfit font-semibold text-slate-900 dark:text-white mt-0.5">
                        {(() => {
                            const cajaChicaUsd = expensesList.filter(g => g.tipo === 'GASTO_INTERNO').reduce((sum, g) => sum + Math.abs(g.totalUsd || 0), 0);
                            return `$${cajaChicaUsd.toFixed(2)}`;
                        })()}
                    </p>
                    <p className="text-xs font-bold text-slate-655 dark:text-slate-455 mt-0.5">Gastos operativos</p>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 flex items-center justify-center mb-2">
                        <Wrench size={16} />
                    </div>
                    <p className="text-[10px] font-bold text-slate-655 dark:text-slate-400 uppercase">Proveedores</p>
                    <p className="text-xl md:text-2xl font-outfit font-semibold text-slate-900 dark:text-white mt-0.5">
                        {(() => {
                            const proveedoresUsd = expensesList.filter(g => g.tipo === 'PAGO_PROVEEDOR').reduce((sum, g) => sum + Math.abs(g.totalUsd || 0), 0);
                            return `$${proveedoresUsd.toFixed(2)}`;
                        })()}
                    </p>
                    <p className="text-xs font-bold text-slate-655 dark:text-slate-455 mt-0.5">Pagos de mercancía</p>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mb-2">
                        <Calendar size={16} />
                    </div>
                    <p className="text-[10px] font-bold text-slate-655 dark:text-slate-400 uppercase">Transacciones</p>
                    <p className="text-xl md:text-2xl font-outfit font-semibold text-slate-900 dark:text-white mt-0.5">
                        {expensesList.length}
                    </p>
                    <p className="text-xs font-bold text-slate-655 dark:text-slate-455 mt-0.5">Movimientos totales</p>
                </div>
            </div>

            {/* Layout Grid: Breakdown on left, Detailed List on right */}
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
                
                {/* Left Card: Category Breakdown */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <h3 className="text-xs font-bold text-slate-650 dark:text-slate-400 uppercase tracking-wider">
                        Distribución de Egresos
                    </h3>
                    
                    {categoryBreakdown.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-6">Sin distribución disponible</p>
                    ) : (
                        <div className="space-y-4">
                            {categoryBreakdown.map(({ key, totalUsd, totalBs, count }) => {
                                const meta = CATEGORY_META[key] || CATEGORY_META.otros;
                                const IconComp = meta.icon;
                                const pct = (totalUsd / maxCategoryTotal) * 100;
                                
                                return (
                                    <div key={key} className="space-y-1.5">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-slate-700 dark:text-slate-350 flex items-center gap-1.5">
                                                <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] ${meta.bgIcon}`}>
                                                    <IconComp size={11} />
                                                </div>
                                                {meta.label}
                                            </span>
                                            <span className="font-black text-slate-850 dark:text-white">
                                                ${totalUsd.toFixed(2)}
                                                <span className="text-[10px] font-normal text-slate-400 ml-1">({count})</span>
                                            </span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-rose-500 rounded-full transition-all duration-500" 
                                                style={{ width: `${pct}%` }} 
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Right Area: List and Filters */}
                <div className="space-y-4">
                    {/* Filters Bar */}
                    <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        {/* Search Bar */}
                        <div className="flex-1 relative">
                            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Buscar por concepto o nota..."
                                className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-brand/35"
                            />
                            {searchQuery && (
                                <button 
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-605"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Category Selector */}
                        <div className="flex items-center gap-2">
                            <Filter size={14} className="text-slate-400 shrink-0" />
                            <select
                                value={categoryFilter}
                                onChange={e => setCategoryFilter(e.target.value)}
                                className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white text-xs font-bold cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-brand/35"
                            >
                                <option value="all">Todas las Categorías</option>
                                {Object.entries(CATEGORY_META).map(([key, value]) => (
                                    <option key={key} value={key}>{value.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Expenses List */}
                    {filteredExpenses.length === 0 ? (
                        <div className="mt-4">
                            <EmptyState
                                icon={TrendingDown}
                                title="No se encontraron egresos"
                                description={expensesList.length === 0 
                                    ? "No hay gastos o egresos registrados en el rango de fechas seleccionado."
                                    : "Prueba ajustando los filtros de búsqueda o categoría."
                                }
                            />
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {filteredExpenses.map(g => {
                                const d = new Date(g.timestamp);
                                const formattedDate = d.toLocaleString('es-VE', { 
                                    day: '2-digit', 
                                    month: 'short', 
                                    year: 'numeric',
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                });
                                
                                const isProveedor = g.tipo === 'PAGO_PROVEEDOR';
                                const catKey = isProveedor ? 'proveedor' : (g.category || 'otros');
                                const meta = CATEGORY_META[catKey] || CATEGORY_META.otros;
                                const IconComponent = meta.icon;
                                
                                const PaymentIcon = getPaymentIcon(g.paymentMethod) || CreditCard;

                                const formattedAmount = () => {
                                    if (g.payments && g.payments.length > 0) {
                                        const p = g.payments[0];
                                        if (p.currency === 'USD') return `$ ${Math.abs(p.amountUsd).toFixed(2)}`;
                                        if (p.currency === 'BS') return `Bs ${Math.abs(p.amountBs).toFixed(2)}`;
                                        if (p.currency === 'COP') return `$ ${Math.abs(p.amountCop).toLocaleString('es-CO')} COP`;
                                    }
                                    return `$ ${Math.abs(g.totalUsd || 0).toFixed(2)}`;
                                };

                                return (
                                    <div 
                                        key={g.id} 
                                        className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/80 shadow-sm hover:border-slate-350 dark:hover:border-slate-700 transition-all"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.bgIcon}`}>
                                                <IconComponent size={18} />
                                            </div>
                                            <div className="text-left min-w-0">
                                                <p className="text-xs font-black text-slate-855 dark:text-white truncate pr-2">
                                                    {g.description}
                                                </p>
                                                <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                                    <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wider font-black">
                                                        {isProveedor ? 'Proveedor' : meta.label}
                                                    </span>
                                                    <span>·</span>
                                                    <span className="flex items-center gap-0.5">
                                                        <PaymentIcon size={10} className="shrink-0" />
                                                        {getPaymentLabel(g.paymentMethod) || g.paymentMethod}
                                                    </span>
                                                    <span>·</span>
                                                    <span>{formattedDate}</span>
                                                    {g.note && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="italic font-medium text-slate-400">"{g.note}"</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <span className="text-sm font-black text-rose-500 shrink-0 font-display pl-4">
                                            -{formattedAmount()}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
