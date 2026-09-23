import React, { useState, useRef } from 'react';
import { Upload, Download, AlertTriangle, Check, X, Database, Share2, Fingerprint, Copy, Store, LayoutGrid, Zap, Smartphone, Monitor } from 'lucide-react';
import { storageService } from '../utils/storageService';
import localforage from 'localforage';
import { showToast } from '../components/Toast';
import PaymentMethodsManager from './Settings/PaymentMethodsManager';

import { useSecurity } from '../hooks/useSecurity';
import { useProductContext } from '../context/ProductContext';
import { decompressString } from '../utils/compression';

export default function SettingsModal({ isOpen, onClose, products, onImport, triggerHaptic }) {
    const { 
        copEnabled, setCopEnabled,
        autoCopEnabled, setAutoCopEnabled, 
        tasaCopManual, setTasaCopManual, 
        tasaCop: calculatedTasaCop,
        checkoutMode, setCheckoutMode,
    } = useProductContext();

    const [importStatus, setImportStatus] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const fileInputRef = useRef(null);
    const { deviceId, forceHeartbeat } = useSecurity();
    const [idCopied, setIdCopied] = useState(false);
    const [allowNegativeStock, setAllowNegativeStock] = useState(() => localStorage.getItem('allow_negative_stock') === 'true');
    // Used from context instead.

    // Configuración del negocio (Ticket WhatsApp)
    const [businessName, setBusinessName] = useState(() => localStorage.getItem('business_name') || '');
    const [businessRif, setBusinessRif] = useState(() => localStorage.getItem('business_rif') || '');
    const [paperWidth, setPaperWidth] = useState(() => localStorage.getItem('printer_paper_width') || '58');

    const handleNameChange = (e) => {
        setBusinessName(e.target.value);
    };

    const handleRifChange = (e) => {
        setBusinessRif(e.target.value);
    };

    const handleSaveBusinessData = () => {
        localStorage.setItem('business_name', businessName);
        localStorage.setItem('business_rif', businessRif);
        localStorage.setItem('printer_paper_width', paperWidth);
        forceHeartbeat();
        showToast("Datos del negocio guardados correctamente", "success");
        if (triggerHaptic) triggerHaptic();
    };

    if (!isOpen) return null;

    // --- EXPORTAR BACKUP ---
    const handleExport = async () => {
        try {
            setImportStatus('loading');
            setStatusMessage('Generando backup...');

            const allProducts = await storageService.getItem('bodega_products_v1', []);
            const accounts = await storageService.getItem('bodega_accounts_v2', []);
            const categories = await storageService.getItem('my_categories_v1', []);

            const backupData = {
                timestamp: new Date().toISOString(),
                version: '1.0',
                data: {
                    bodega_products_v1: JSON.stringify(allProducts),
                    bodega_accounts_v2: JSON.stringify(accounts),
                    my_categories_v1: JSON.stringify(categories),
                    premium_token: localStorage.getItem('premium_token'),
                    street_rate_bs: localStorage.getItem('street_rate_bs'),
                    catalog_use_auto_usdt: localStorage.getItem('catalog_use_auto_usdt'),
                    catalog_custom_usdt_price: localStorage.getItem('catalog_custom_usdt_price'),
                    catalog_show_cash_price: localStorage.getItem('catalog_show_cash_price'),
                    monitor_rates_v12: localStorage.getItem('monitor_rates_v12'),
                    business_name: localStorage.getItem('business_name'),
                    business_rif: localStorage.getItem('business_rif')
                }
            };

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup_tasasaldia_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setStatusMessage('Backup descargado.');
            setImportStatus('success');
            setTimeout(() => setImportStatus(null), 3000);
        } catch (error) {
            console.error(error);
            setStatusMessage('Error al generar backup.');
            setImportStatus('error');
        }
    };

    // --- IMPORTAR BACKUP ---
    const handleImportClick = () => fileInputRef.current?.click();

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                setImportStatus('loading');
                setStatusMessage('Restaurando datos...');
                let json = JSON.parse(e.target.result);

                // 1. Si es formato v2.0 comprimido (Gzip Base64), descomprimir la clave data
                if (json && json.compressed === true && typeof json.data === 'string') {
                    const decompressedStr = await decompressString(json.data);
                    const decompressedObj = JSON.parse(decompressedStr);
                    json = decompressedObj;
                }

                // 2. Extraer mapas de IndexedDB y localStorage según la versión del esquema
                let idbMap = {};
                let lsMap = {};

                if (json.data && (json.data.idb || json.data.ls)) {
                    // Formato v2.0: { timestamp, version: "2.0", data: { idb: {...}, ls: {...} } }
                    idbMap = json.data.idb || {};
                    lsMap = json.data.ls || {};
                } else if (json.idb || json.ls) {
                    // Formato directo { idb: {...}, ls: {...} }
                    idbMap = json.idb || {};
                    lsMap = json.ls || {};
                } else if (json.data && (json.data.bodega_products_v1 || json.data.bodega_accounts_v2 || json.data.my_categories_v1)) {
                    // Formato v1.0 legado: { timestamp, version: "1.0", data: { bodega_products_v1: "...", ... } }
                    idbMap = json.data;
                } else if (Array.isArray(json)) {
                    // Array directo de productos
                    idbMap = { bodega_products_v1: json };
                } else if (json.bodega_products_v1) {
                    idbMap = json;
                } else {
                    throw new Error('El archivo no contiene una estructura de respaldo reconocida.');
                }

                const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });

                // 3. Escribir todas las claves de IndexedDB
                let restoredCount = 0;
                for (const [key, val] of Object.entries(idbMap)) {
                    if (val !== null && val !== undefined) {
                        const parsedVal = typeof val === 'string' ? JSON.parse(val) : val;
                        await lf.setItem(key, parsedVal);
                        if (key === 'bodega_products_v1' && Array.isArray(parsedVal)) {
                            restoredCount = parsedVal.length;
                        }
                    }
                }

                // 4. Escribir todas las claves de localStorage
                for (const [key, val] of Object.entries(lsMap)) {
                    if (val !== null && val !== undefined) {
                        localStorage.setItem(key, typeof val === 'object' ? JSON.stringify(val) : val);
                    }
                }

                // Forzar sincronización incondicional post-importación
                localStorage.setItem('pda_cloud_sync_pending', 'true');

                setImportStatus('success');
                setStatusMessage(`¡Respaldo restaurado! (${restoredCount} productos). Recargando...`);
                setTimeout(() => window.location.reload(), 1200);

            } catch (error) {
                console.error('[ImportBackup Error]', error);
                setImportStatus('error');
                setStatusMessage('Error: ' + (error.message || 'El archivo no es válido.'));
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col">

                {/* Header */}
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Database size={18} className="text-slate-500" />
                        Ajustes
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                        <X size={18} className="text-slate-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-3 overflow-y-auto">

                    {/* Datos del Ticket (WhatsApp) */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/50 space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Store size={14} className="text-slate-500" />
                            <h4 className="font-bold text-xs text-slate-700 dark:text-slate-200">Personalización de Tickets</h4>
                        </div>
                        
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Nombre del Negocio</label>
                            <input 
                                type="text" 
                                placeholder="Ej: Mi Bodega C.A." 
                                value={businessName}
                                onChange={handleNameChange}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/50"
                            />
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">RIF o Documento</label>
                            <input 
                                type="text" 
                                placeholder="Ej: J-12345678" 
                                value={businessRif}
                                onChange={handleRifChange}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/50"
                            />
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Ancho de Impresora Térmica</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setPaperWidth('58')}
                                    className={`py-2 px-3 text-xs font-bold rounded-lg transition-colors border ${paperWidth === '58' ? 'bg-brand-light dark:bg-surface-800/30 border-brand text-brand-dark dark:text-brand' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                                >
                                    58 mm (Pequeña)
                                </button>
                                <button
                                    onClick={() => setPaperWidth('80')}
                                    className={`py-2 px-3 text-xs font-bold rounded-lg transition-colors border ${paperWidth === '80' ? 'bg-brand-light dark:bg-surface-800/30 border-brand text-brand-dark dark:text-brand' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                                >
                                    80 mm (Estándar)
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={handleSaveBusinessData}
                            className="w-full flex items-center justify-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors mt-2"
                        >
                            <Check size={16} />
                            Aceptar Cambios
                        </button>
                    </div>

                    {/* Modo de Cobro (Interfaz) */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/50 space-y-3">
                        <div>
                            <h4 className="font-bold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                <LayoutGrid size={16} className="text-brand dark:text-brand" />
                                Modo de Cobro (Interfaz)
                            </h4>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                                Selecciona la pantalla de pago activa para esta caja (Automática o fija).
                            </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                            {[
                                { 
                                    id: 'auto', 
                                    label: 'Automático', 
                                    desc: 'Auto por pantalla', 
                                    icon: Zap, 
                                    colorClass: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-200/60',
                                    badge: 'Auto'
                                },
                                { 
                                    id: 'basic', 
                                    label: 'Modo Móvil', 
                                    desc: '1 columna apilada', 
                                    icon: Smartphone, 
                                    colorClass: 'text-teal-500 bg-teal-50 dark:bg-teal-950/40 border-teal-200/60' 
                                },
                                { 
                                    id: 'pos', 
                                    label: 'Modo PC', 
                                    desc: '2 col. Listo POS', 
                                    icon: Monitor, 
                                    colorClass: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200/60' 
                                }
                            ].map(modeOpt => {
                                const isSelected = checkoutMode === modeOpt.id;
                                const IconComponent = modeOpt.icon;
                                return (
                                    <button
                                        key={modeOpt.id}
                                        type="button"
                                        onClick={() => {
                                            setCheckoutMode(modeOpt.id);
                                            forceHeartbeat();
                                            showToast(`Modo de cobro: ${modeOpt.label}`, 'success');
                                            if (triggerHaptic) triggerHaptic();
                                        }}
                                        className={`relative group p-3.5 rounded-2xl text-left transition-all border flex flex-col justify-between cursor-pointer active:scale-[0.98] ${
                                            isSelected
                                                ? 'bg-teal-800 text-white dark:bg-teal-900 dark:text-white border-teal-700 dark:border-teal-700 shadow-md ring-2 ring-teal-500/30'
                                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-xs'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                                                isSelected ? 'bg-white/20 text-white border-white/30' : modeOpt.colorClass
                                            }`}>
                                                <IconComponent size={15} />
                                            </div>
                                            {isSelected ? (
                                                <span className="flex items-center gap-0.5 text-[9px] font-black bg-white text-teal-800 px-1.5 py-0.5 rounded-full shadow-xs">
                                                    <Check size={9} strokeWidth={3} /> OK
                                                </span>
                                            ) : modeOpt.badge ? (
                                                <span className="text-[9px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-0.5 rounded-md">
                                                    {modeOpt.badge}
                                                </span>
                                            ) : null}
                                        </div>

                                        <div>
                                            <h4 className="text-xs font-black tracking-tight leading-snug">{modeOpt.label}</h4>
                                            <p className={`text-[9px] mt-0.5 ${isSelected ? 'text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                                                {modeOpt.desc}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Vender Sin Stock Toggle */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
                        <div>
                            <h4 className="font-bold text-sm text-slate-700 dark:text-slate-200">Vender sin Stock</h4>
                            <p className="text-[10px] text-slate-400 mt-1">Permitir ventas si el inventario es 0</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={allowNegativeStock}
                            aria-label="Permitir vender sin stock"
                            onClick={() => {
                                const newVal = !allowNegativeStock;
                                setAllowNegativeStock(newVal);
                                localStorage.setItem('allow_negative_stock', newVal.toString());
                                forceHeartbeat();
                                showToast(newVal ? 'Se permite vender sin stock' : 'No se permite vender sin stock', 'success');
                                if (triggerHaptic) triggerHaptic();
                            }}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1 cursor-pointer select-none shrink-0 active:scale-95 transition-transform"
                        >
                            <span className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                                allowNegativeStock ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                            }`}>
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                                    allowNegativeStock ? 'translate-x-5' : 'translate-x-0'
                                }`} />
                            </span>
                        </button>
                    </div>

                    {/* Configuración Peso Colombiano (COP) */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/50 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="font-bold text-sm text-slate-700 dark:text-slate-200">Peso Colombiano (COP)</h4>
                                <p className="text-[10px] text-slate-400 mt-1">Habilitar pagos y cálculos rápidos</p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={copEnabled}
                                aria-label="Habilitar Peso Colombiano"
                                onClick={() => {
                                    const newVal = !copEnabled;
                                    setCopEnabled(newVal);
                                    localStorage.setItem('cop_enabled', newVal.toString());
                                    forceHeartbeat();
                                    showToast(newVal ? 'COP Habilitado' : 'COP Deshabilitado', 'success');
                                    if (triggerHaptic) triggerHaptic();
                                }}
                                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1 cursor-pointer select-none shrink-0 active:scale-95 transition-transform"
                            >
                                <span className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                                    copEnabled ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'
                                }`}>
                                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                                        copEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`} />
                                </span>
                            </button>
                        </div>
                        {copEnabled && (
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-700/50 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="font-bold text-[13px] text-slate-700 dark:text-slate-200">Calcular Automáticamente</h4>
                                        <p className="text-[10px] text-slate-400 mt-0.5">Usar TRM Oficial y Binance USDT</p>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={autoCopEnabled}
                                        aria-label="Calcular TRM automáticamente"
                                        onClick={() => {
                                            const newVal = !autoCopEnabled;
                                            setAutoCopEnabled(newVal);
                                            localStorage.setItem('auto_cop_enabled', newVal.toString());
                                            if (triggerHaptic) triggerHaptic();
                                        }}
                                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1 cursor-pointer select-none shrink-0 active:scale-95 transition-transform"
                                    >
                                        <span className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                                            autoCopEnabled ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'
                                        }`}>
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                                                autoCopEnabled ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                        </span>
                                    </button>
                                </div>
                                
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                                        {autoCopEnabled ? 'Tasa Actual Calculada' : 'Tasa de Cambio Manual (COP por 1 USD)'}
                                    </label>
                                    <input 
                                        type="number" 
                                        placeholder="Ej: 4150" 
                                        value={autoCopEnabled ? (calculatedTasaCop > 0 ? calculatedTasaCop.toFixed(2) : '') : tasaCopManual}
                                        readOnly={autoCopEnabled}
                                        onChange={(e) => {
                                            if (!autoCopEnabled) {
                                                setTasaCopManual(e.target.value);
                                                localStorage.setItem('tasa_cop', e.target.value);
                                            }
                                        }}
                                        className={`w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${
                                            autoCopEnabled ? 'text-slate-400 dark:text-slate-400 cursor-not-allowed bg-slate-100 dark:bg-slate-800/80' : 'text-amber-600 dark:text-amber-500'
                                        }`}
                                    />
                                    {autoCopEnabled && (
                                        <p className="text-[9px] text-amber-600/70 dark:text-amber-400/70 mt-1.5 font-medium">Se actualiza automáticamente cada 30 segundos.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Share Catalog Button */}
                    {onImport && (
                        <button
                            onClick={() => { onClose(); setTimeout(() => onImport(), 100); }}
                            className="w-full flex items-center gap-3 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors group"
                        >
                            <div className="p-2 bg-brand-light dark:bg-surface-800/30 rounded-lg group-hover:bg-brand-light dark:group-hover:bg-surface-800/50 transition-colors">
                                <Share2 size={20} className="text-brand dark:text-brand" />
                            </div>
                            <div className="text-left flex-1">
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Compartir Inventario</p>
                                <p className="text-[10px] text-slate-400">Código de 6 dígitos • 24h</p>
                            </div>
                        </button>
                    )}

                    <div className="p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-lg flex gap-2.5">
                        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                            Al importar un backup, los datos actuales serán reemplazados.
                        </p>
                    </div>

                    <div className="grid gap-2">
                        <button
                            onClick={handleExport}
                            className="w-full flex items-center gap-3 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors group"
                        >
                            <div className="p-2 bg-brand-light dark:bg-surface-800/30 rounded-lg group-hover:bg-brand-light dark:group-hover:bg-surface-800/50 transition-colors">
                                <Download size={20} className="text-brand dark:text-brand" />
                            </div>
                            <div className="text-left flex-1">
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Exportar Backup</p>
                                <p className="text-[10px] text-slate-400">Descargar archivo .json</p>
                            </div>
                        </button>

                        <button
                            onClick={handleImportClick}
                            className="w-full flex items-center gap-3 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors group"
                        >
                            <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/50 transition-colors">
                                <Upload size={20} className="text-emerald-500 dark:text-emerald-400" />
                            </div>
                            <div className="text-left flex-1">
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Importar Backup</p>
                                <p className="text-[10px] text-slate-400">Restaurar desde archivo</p>
                            </div>
                        </button>
                    </div>

                    {/* Hidden Input */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".json"
                        className="hidden"
                    />

                    {/* Status Feedback */}
                    {importStatus && (
                        <div className={`mt-1 p-2 rounded-lg text-xs font-bold text-center flex items-center justify-center gap-2 ${importStatus === 'success'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                            {importStatus === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
                            {statusMessage}
                        </div>
                    )}

                    {/* Device ID para soporte */}
                    <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-xl">
                        <p className="text-[9px] uppercase tracking-wider font-bold text-slate-400 mb-1 flex items-center gap-1">
                            <Fingerprint size={10} /> ID de Instalación
                        </p>
                        <div className="flex items-center justify-between gap-2">
                            <p className="font-mono text-xs font-black text-slate-600 dark:text-slate-300 select-all">{deviceId || '...'}</p>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(deviceId).then(() => {
                                        setIdCopied(true);
                                        setTimeout(() => setIdCopied(false), 2000);
                                    });
                                }}
                                className="text-slate-400 hover:text-teal-500 transition-colors p-1 rounded"
                            >
                                {idCopied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                        </div>
                        <p className="text-[8px] text-slate-400 mt-1">Comparte este ID si necesitas soporte técnico.</p>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                        {/* 🖥️ Experiencia de Cobro */}
                        <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-xl">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-3">
                                🖥️ Experiencia de Cobro
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                {/* Card Auto */}
                                <button
                                    onClick={() => { setCheckoutMode('auto'); showToast('Detección automática de dispositivo activada', 'success'); if (triggerHaptic) triggerHaptic(); }}
                                    className={`p-2.5 rounded-xl border-2 text-left transition-all active:scale-95 ${
                                        checkoutMode === 'auto' || !checkoutMode
                                            ? 'border-brand bg-brand/5 dark:bg-brand/10'
                                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                    }`}
                                >
                                    <div className="flex items-center gap-1 mb-1">
                                        <span className="text-base">⚡</span>
                                        <span className={`text-xs font-black ${
                                            checkoutMode === 'auto' || !checkoutMode
                                                ? 'text-brand dark:text-brand'
                                                : 'text-slate-700 dark:text-slate-300'
                                        }`}>Auto</span>
                                        {(checkoutMode === 'auto' || !checkoutMode) && (
                                            <span className="ml-auto text-[7px] font-black bg-brand text-white px-1 py-0.5 rounded-full">ACTIVO</span>
                                        )}
                                    </div>
                                    <p className="text-[8.5px] text-slate-400 leading-tight">Detecta Móvil o PC según pantalla.</p>
                                </button>

                                {/* Card Móvil */}
                                <button
                                    onClick={() => { setCheckoutMode('basic'); showToast('Modo Móvil activado', 'success'); if (triggerHaptic) triggerHaptic(); }}
                                    className={`p-2.5 rounded-xl border-2 text-left transition-all active:scale-95 ${
                                        checkoutMode === 'basic'
                                            ? 'border-brand bg-brand/5 dark:bg-brand/10'
                                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                    }`}
                                >
                                    <div className="flex items-center gap-1 mb-1">
                                        <span className="text-base">📱</span>
                                        <span className={`text-xs font-black ${
                                            checkoutMode === 'basic'
                                                ? 'text-brand dark:text-brand'
                                                : 'text-slate-700 dark:text-slate-300'
                                        }`}>Móvil</span>
                                        {checkoutMode === 'basic' && (
                                            <span className="ml-auto text-[7px] font-black bg-brand text-white px-1 py-0.5 rounded-full">ACTIVO</span>
                                        )}
                                    </div>
                                    <p className="text-[8.5px] text-slate-400 leading-tight">Formulario vertical 1 columna.</p>
                                </button>

                                {/* Card PC */}
                                <button
                                    onClick={() => { setCheckoutMode('pos'); showToast('Modo PC activado', 'success'); if (triggerHaptic) triggerHaptic(); }}
                                    className={`p-2.5 rounded-xl border-2 text-left transition-all active:scale-95 ${
                                        checkoutMode === 'pos'
                                            ? 'border-brand bg-brand/5 dark:bg-brand/10'
                                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                    }`}
                                >
                                    <div className="flex items-center gap-1 mb-1">
                                        <span className="text-base">💻</span>
                                        <span className={`text-xs font-black ${
                                            checkoutMode === 'pos'
                                                ? 'text-brand dark:text-brand'
                                                : 'text-slate-700 dark:text-slate-300'
                                        }`}>PC</span>
                                        {checkoutMode === 'pos' && (
                                            <span className="ml-auto text-[7px] font-black bg-brand text-white px-1 py-0.5 rounded-full">ACTIVO</span>
                                        )}
                                    </div>
                                    <p className="text-[8.5px] text-slate-400 leading-tight">Pantalla 2 columnas escritorio.</p>
                                </button>
                            </div>
                        </div>

                        <PaymentMethodsManager triggerHaptic={triggerHaptic} />
                    </div>
                </div>
            </div>
        </div>
    );
}
