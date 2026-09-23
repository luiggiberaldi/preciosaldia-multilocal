import { useState, useEffect } from 'react';
import localforage from 'localforage';
import { Share2, Download, X, Copy, Check, Loader2, AlertTriangle, Package, Users, ShoppingBag, Settings2, Database } from 'lucide-react';
import { storageService } from '../utils/storageService';

// BACKUP-005: al restaurar por código de compartición también debe activarse
// la bandera de re-sincronización; si no, los datos importados nunca suben a
// sync_documents y solo existen en este dispositivo.
const BACKUP_IMPORTED_FLAG = 'pda_backup_imported_flag';

// Grupos de datos compartibles
const SHARE_GROUPS = [
    {
        id: 'inventory',
        label: 'Inventario',
        desc: 'Productos y categorías',
        Icon: Package,
        idbKeys: ['bodega_products_v1', 'my_categories_v1'],
        countKey: 'bodega_products_v1',
        lsKeys: [],
    },
    {
        id: 'customers',
        label: 'Clientes',
        desc: 'Clientes y proveedores',
        Icon: Users,
        idbKeys: ['bodega_customers_v1', 'bodega_suppliers_v1', 'bodega_supplier_invoices_v1'],
        countKey: 'bodega_customers_v1',
        lsKeys: [],
    },
    {
        id: 'sales',
        label: 'Historial de Ventas',
        desc: 'Todas las transacciones',
        Icon: ShoppingBag,
        idbKeys: ['bodega_sales_v1', 'bodega_accounts_v2', 'abasto_audit_log_v1'],
        countKey: 'bodega_sales_v1',
        lsKeys: [],
    },
    {
        id: 'config',
        label: 'Configuración',
        desc: 'Ajustes y métodos de pago',
        Icon: Settings2,
        idbKeys: ['bodega_payment_methods_v1', 'bodega_pending_cart_v1'],
        countKey: null,
        lsKeys: [
            'business_name', 'business_rif', 'printer_paper_width',
            'allow_negative_stock', 'cop_enabled', 'auto_cop_enabled', 'tasa_cop',
            'bodega_use_auto_rate', 'bodega_custom_rate', 'bodega_inventory_view',
        ],
    },
];

const API_URL = '/api/share';

export default function ShareInventoryModal({ isOpen, onClose }) {
    const [tab, setTab] = useState('export');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [shareCode, setShareCode] = useState('');
    const [copied, setCopied] = useState(false);
    const [importCode, setImportCode] = useState('');
    const [importResult, setImportResult] = useState(null);

    const [selected, setSelected] = useState({ inventory: true, customers: false, sales: false, config: false });
    const [counts, setCounts] = useState({});

    // Cargar conteos al abrir
    useEffect(() => {
        if (!isOpen) return;
        async function loadCounts() {
            const c = {};
            for (const g of SHARE_GROUPS) {
                if (g.countKey) {
                    const data = await storageService.getItem(g.countKey, null);
                    c[g.id] = Array.isArray(data) ? data.length : 0;
                } else {
                    // Config: contar cuántas LS keys tienen valor
                    c[g.id] = g.lsKeys.filter(k => localStorage.getItem(k) !== null).length;
                }
            }
            setCounts(c);
        }
        loadCounts();
        setShareCode('');
        setError('');
        setImportCode('');
        setImportResult(null);
    }, [isOpen]);

    if (!isOpen) return null;

    const toggleGroup = (id) => setSelected(prev => ({ ...prev, [id]: !prev[id] }));

    const totalSelected = SHARE_GROUPS
        .filter(g => selected[g.id])
        .reduce((sum, g) => sum + (counts[g.id] || 0), 0);

    const handleExport = async () => {
        const activeGroups = SHARE_GROUPS.filter(g => selected[g.id]);
        if (activeGroups.length === 0) {
            setError('Selecciona al menos un tipo de datos para compartir.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const idb = {};
            const ls = {};
            for (const g of activeGroups) {
                for (const key of g.idbKeys) {
                    const val = await storageService.getItem(key, null);
                    if (val !== null) idb[key] = val;
                }
                for (const key of g.lsKeys) {
                    const val = localStorage.getItem(key);
                    if (val !== null) ls[key] = val;
                }
            }
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idb, ls, groups: activeGroups.map(g => g.id) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al compartir');
            setShareCode(data.code);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(shareCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleImport = async () => {
        const clean = importCode.replace(/[-\s]/g, '').trim();
        if (clean.length !== 6) return;
        setLoading(true);
        setError('');
        setImportResult(null);
        try {
            const res = await fetch(`${API_URL}?code=${clean}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al importar');
            setImportResult(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const confirmImport = async () => {
        if (!importResult) return;
        setLoading(true);
        try {
            if (importResult.idb) {
                for (const [key, value] of Object.entries(importResult.idb)) {
                    await localforage.setItem(key, value);
                }
            }
            if (importResult.ls) {
                for (const [key, value] of Object.entries(importResult.ls)) {
                    localStorage.setItem(key, value);
                }
            }
            localStorage.setItem(BACKUP_IMPORTED_FLAG, 'true');
            setTimeout(() => window.location.reload(), 300);
        } catch (err) {
            setError('Error al restaurar: ' + err.message);
            setLoading(false);
        }
    };

    const handleCodeInput = (val) => {
        const digits = val.replace(/\D/g, '').slice(0, 6);
        setImportCode(digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits);
    };

    const handleClose = () => {
        setShareCode('');
        setError('');
        setImportCode('');
        setImportResult(null);
        setLoading(false);
        onClose();
    };

    // Información resumida del resultado de importar
    const importSummary = importResult ? (() => {
        const groups = importResult.groups || [];
        const labels = SHARE_GROUPS.filter(g => groups.includes(g.id)).map(g => g.label);
        const productCount = importResult.idb?.bodega_products_v1?.length ?? 0;
        const salesCount = importResult.idb?.bodega_sales_v1?.length ?? 0;
        const customerCount = importResult.idb?.bodega_customers_v1?.length ?? 0;
        return { labels, productCount, salesCount, customerCount };
    })() : null;

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200" onClick={handleClose}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-[2rem] sm:rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 duration-200" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <Database size={20} className="text-brand" /> Compartir Base de Datos
                    </h2>
                    <button onClick={handleClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-5">
                    <button
                        onClick={() => { setTab('export'); setError(''); setShareCode(''); }}
                        className={`flex-1 py-2.5 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${tab === 'export' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-400'}`}
                    >
                        <Share2 size={14} /> Exportar
                    </button>
                    <button
                        onClick={() => { setTab('import'); setError(''); }}
                        className={`flex-1 py-2.5 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${tab === 'import' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-400'}`}
                    >
                        <Download size={14} /> Importar
                    </button>
                </div>

                {/* Error */}
                {error && (
                    <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-xs font-medium mb-4">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
                    </div>
                )}

                {/* TAB: Exportar */}
                {tab === 'export' && (
                    <div className="space-y-3">
                        {!shareCode ? (
                            <>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">¿Qué deseas compartir?</p>

                                {SHARE_GROUPS.map(({ id, label, desc, Icon }) => {
                                    const isChecked = selected[id];
                                    const count = counts[id] ?? 0;
                                    return (
                                        <button
                                            key={id}
                                            onClick={() => toggleGroup(id)}
                                            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all text-left ${isChecked ? 'border-brand bg-brand-light dark:bg-surface-950/30' : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900'}`}
                                        >
                                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isChecked ? 'bg-brand-light dark:bg-surface-800/40' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                                <Icon size={18} className={isChecked ? 'text-brand' : 'text-slate-400'} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-bold ${isChecked ? 'text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{label}</p>
                                                <p className="text-[11px] text-slate-400">{desc} · {count} registros</p>
                                            </div>
                                            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${isChecked ? 'bg-brand border-brand' : 'border-slate-300 dark:border-slate-600'}`}>
                                                {isChecked && <Check size={12} className="text-white" strokeWidth={3} />}
                                            </div>
                                        </button>
                                    );
                                })}

                                <div className="flex items-center justify-between pt-1 pb-1">
                                    <p className="text-[11px] text-slate-400">
                                        <span className="font-bold text-slate-600 dark:text-slate-300">{totalSelected} registros</span> seleccionados · El código expira en 24h.
                                    </p>
                                </div>

                                <button
                                    onClick={handleExport}
                                    disabled={loading || Object.values(selected).every(v => !v)}
                                    className="w-full py-3.5 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white font-black rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all"
                                >
                                    {loading ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
                                    {loading ? 'Generando código...' : 'Generar Código'}
                                </button>
                            </>
                        ) : (
                            <div className="text-center py-2">
                                <div className="w-14 h-14 bg-brand-light dark:bg-surface-800/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                                    <Check size={28} className="text-brand" />
                                </div>
                                <p className="text-xs text-slate-400 mb-2">Código para compartir:</p>
                                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-5 mb-3">
                                    <p className="text-4xl font-black text-brand-dark dark:text-brand tracking-[0.3em] font-mono">{shareCode}</p>
                                </div>
                                <p className="text-[10px] text-slate-400 mb-4">El receptor va a Compartir Datos → Importar y escribe este código.</p>
                                <button
                                    onClick={handleCopy}
                                    className="w-full py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl flex items-center justify-center gap-2 transition-all"
                                >
                                    {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                                    {copied ? '¡Copiado!' : 'Copiar Código'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB: Importar */}
                {tab === 'import' && (
                    <div className="space-y-4">
                        {!importResult ? (
                            <>
                                <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                                    Escribe el código de 6 dígitos para importar los datos.
                                </p>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={importCode}
                                    onChange={(e) => handleCodeInput(e.target.value)}
                                    placeholder="000-000"
                                    maxLength={7}
                                    className="w-full text-center text-3xl font-black font-mono tracking-[0.3em] p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 outline-none focus:border-brand text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600 transition-colors"
                                />
                                <button
                                    onClick={handleImport}
                                    disabled={loading || importCode.replace(/\D/g, '').length !== 6}
                                    className="w-full py-3.5 bg-brand hover:bg-brand-dark text-white font-black rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                                >
                                    {loading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                                    {loading ? 'Buscando...' : 'Importar Datos'}
                                </button>
                            </>
                        ) : (
                            <div className="text-center py-1">
                                <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                                    <Check size={28} className="text-emerald-500" />
                                </div>
                                <p className="text-sm font-bold text-slate-700 dark:text-white mb-2">¡Datos encontrados!</p>

                                {/* Resumen de lo que contiene */}
                                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 mb-3 text-left space-y-1.5">
                                    {importSummary?.productCount > 0 && (
                                        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                            <Package size={13} className="text-brand shrink-0" />
                                            <span><strong>{importSummary.productCount}</strong> productos</span>
                                        </div>
                                    )}
                                    {importSummary?.customerCount > 0 && (
                                        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                            <Users size={13} className="text-brand shrink-0" />
                                            <span><strong>{importSummary.customerCount}</strong> clientes</span>
                                        </div>
                                    )}
                                    {importSummary?.salesCount > 0 && (
                                        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                            <ShoppingBag size={13} className="text-emerald-400 shrink-0" />
                                            <span><strong>{importSummary.salesCount}</strong> ventas</span>
                                        </div>
                                    )}
                                    {importSummary?.labels?.includes('Configuración') && (
                                        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                            <Settings2 size={13} className="text-amber-400 shrink-0" />
                                            <span>Configuración de la app</span>
                                        </div>
                                    )}
                                </div>

                                <p className="text-[10px] text-amber-500 font-medium mb-4">
                                    ⚠️ Esto reemplazará los datos actuales del dispositivo.
                                </p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setImportResult(null)}
                                        disabled={loading}
                                        className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={confirmImport}
                                        disabled={loading}
                                        className="flex-1 py-3 text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                                        {loading ? 'Importando...' : 'Confirmar'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
