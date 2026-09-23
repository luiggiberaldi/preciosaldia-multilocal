import React, { useState, useRef, useEffect } from 'react';
// v1.2.0: useReveal hook para animaciones reveal-on-scroll (design system "Precios al Día")
import { useReveal } from '../hooks/useReveal';
import {
    ArrowLeft, Store, Printer, Coins, Package, CreditCard, Database,
    Palette, Fingerprint, Upload, Download, Share2, Check, X,
    AlertTriangle, Copy, Sun, Moon, ChevronRight, Trash2, Users, FileText, Lock, Key
} from 'lucide-react';
import { showToast } from '../components/Toast';
import PaymentMethodsManager from '../components/Settings/PaymentMethodsManager';
import AuditLogViewer from '../components/Settings/AuditLogViewer';
import { useSecurity } from '../hooks/useSecurity';
import { useProductContext } from '../context/ProductContext';
import ShareInventoryModal from '../components/ShareInventoryModal';
import { useAudit } from '../hooks/useAudit';
import SettingsTabNegocio from '../components/Settings/tabs/SettingsTabNegocio';
import SettingsTabVentas from '../components/Settings/tabs/SettingsTabVentas';
import SettingsTabUsuarios from '../components/Settings/tabs/SettingsTabUsuarios';
import SettingsTabSistema from '../components/Settings/tabs/SettingsTabSistema';
import SettingsTabLicencia from '../components/Settings/tabs/SettingsTabLicencia';
import { useCloudBackup } from '../hooks/useCloudBackup';
import { useDataImportExport } from '../hooks/useDataImportExport';
import { useAuthStore } from '../hooks/store/useAuthStore';
import WalletView from './WalletView';


// ───────────────────────────────────────────────────── Tab Config
const TABS = [
    { id: 'negocio', label: 'Negocio', icon: Store },
    { id: 'ventas', label: 'Ventas', icon: CreditCard },
    // { id: 'cuentas', label: 'Cuentas', icon: Coins }, // Ocultado por solicitud del usuario
    { id: 'usuarios', label: 'Usuarios', icon: Users },
    { id: 'licencia', label: 'Licencia', icon: Key },
    { id: 'sistema', label: 'Sistema', icon: Database },
];

export default function SettingsView({ onClose, theme, toggleTheme, triggerHaptic, isTab = false, rates }) {
    // v1.2.0: reveal-on-scroll para header y tabs.
    const revealRef = useReveal();
    const {
        products, categories, setProducts, setCategories,
        copEnabled, setCopEnabled,
        autoCopEnabled, setAutoCopEnabled,
        tasaCopManual, setTasaCopManual,
        copPrimary, setCopPrimary,
        tasaCop: calculatedTasaCop,
        effectiveRate
    } = useProductContext();

    const { requireLogin, setRequireLogin, usuarioActivo } = useAuthStore();
    const [autoLockMinutes, setAutoLockMinutes] = useState(() => localStorage.getItem('admin_auto_lock_minutes') || '3');

    const isAdmin = !requireLogin || !usuarioActivo || usuarioActivo.rol === 'ADMIN';

    const { deviceId, forceHeartbeat, isPremium, isDemo } = useSecurity();
    // LICENCIA-CLOUD: solo licencias completas (premium y no demo) acceden a la nube.
    const isLicensedCloud = isPremium && !isDemo;
    const { log: auditLog } = useAudit();
    const fileInputRef = useRef(null);
    const [activeTab, setActiveTab] = useState('negocio');
    const [idCopied, setIdCopied] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);

    // Business Data
    const [businessName, setBusinessName] = useState(() => localStorage.getItem('business_name') || '');
    const [businessRif, setBusinessRif] = useState(() => localStorage.getItem('business_rif') || '');
    const [paperWidth, setPaperWidth] = useState(() => localStorage.getItem('printer_paper_width') || '58');
    const [labelCurrencyMode, setLabelCurrencyMode] = useState(() => localStorage.getItem('label_currency_mode') || 'mixto');

    // Helper para inicializar offsets según el modo de moneda guardado
    const getInitialOffset = (key, defaultMixto, defaultUnico) => {
        const initialMode = localStorage.getItem('label_currency_mode') || 'mixto';
        const initialWidth = localStorage.getItem('printer_paper_width') || '58';
        const isMixto = initialMode === 'mixto';
        const is80 = initialWidth === '80';
        
        let suffix;
        let fallback = defaultMixto;
        if (is80) {
            suffix = isMixto ? '_80_mixto' : '_80_unico';
            // Sobrescribir fallback con defaults de 80mm
            if (key === 'label_offset_name_x') fallback = '0';
            else if (key === 'label_offset_name_y') fallback = '0';
            else if (key === 'label_offset_price_x') fallback = '0';
            else if (key === 'label_offset_price_y') fallback = isMixto ? '-6' : '-2';
            else if (key === 'label_offset_sec_price_x') fallback = '0';
            else if (key === 'label_offset_sec_price_y') fallback = isMixto ? '-3' : '2';
            else if (key === 'label_offset_footer_x') fallback = '0';
            else if (key === 'label_offset_footer_y') fallback = '0';
            else if (key === 'label_offset_font_name') fallback = '4';
            else if (key === 'label_offset_font_price') fallback = '14';
            else if (key === 'label_offset_font_sec_price') fallback = isMixto ? '12' : '0';
            else if (key === 'label_offset_font_footer') fallback = '3';
        } else {
            suffix = isMixto ? '_mixto' : '_unico';
            fallback = isMixto ? defaultMixto : defaultUnico;
        }
        return localStorage.getItem(`${key}${suffix}`) || fallback;
    };

    const [labelOffsetNameX, setLabelOffsetNameX] = useState(() => getInitialOffset('label_offset_name_x', '-1.5', '1'));
    const [labelOffsetNameY, setLabelOffsetNameY] = useState(() => getInitialOffset('label_offset_name_y', '2', '0'));
    const [labelOffsetPriceX, setLabelOffsetPriceX] = useState(() => getInitialOffset('label_offset_price_x', '-1.5', '1'));
    const [labelOffsetPriceY, setLabelOffsetPriceY] = useState(() => getInitialOffset('label_offset_price_y', '-7.5', '-3'));
    const [labelOffsetSecPriceX, setLabelOffsetSecPriceX] = useState(() => getInitialOffset('label_offset_sec_price_x', '-1.5', '1'));
    const [labelOffsetSecPriceY, setLabelOffsetSecPriceY] = useState(() => getInitialOffset('label_offset_sec_price_y', '-3', '2'));
    const [labelOffsetFooterX, setLabelOffsetFooterX] = useState(() => getInitialOffset('label_offset_footer_x', '-1.5', '1'));
    const [labelOffsetFooterY, setLabelOffsetFooterY] = useState(() => getInitialOffset('label_offset_footer_y', '-1', '1'));
    const [labelOffsetFontName, setLabelOffsetFontName] = useState(() => getInitialOffset('label_offset_font_name', '5', '5'));
    const [labelOffsetFontPrice, setLabelOffsetFontPrice] = useState(() => getInitialOffset('label_offset_font_price', '10', '10'));
    const [labelOffsetFontSecPrice, setLabelOffsetFontSecPrice] = useState(() => getInitialOffset('label_offset_font_sec_price', '12.5', '0'));
    const [labelOffsetFontFooter, setLabelOffsetFontFooter] = useState(() => getInitialOffset('label_offset_font_footer', '4', '4'));
    const [allowNegativeStock, setAllowNegativeStock] = useState(() => localStorage.getItem('allow_negative_stock') === 'true');

    // Sincronizar offsets en React cuando cambia el modo de moneda o el ancho de papel
    useEffect(() => {
        const isMixto = labelCurrencyMode === 'mixto';
        const is80 = paperWidth === '80';
        const suffix = is80 ? (isMixto ? '_80_mixto' : '_80_unico') : (isMixto ? '_mixto' : '_unico');
        
        let defNameX, defNameY, defPriceX, defPriceY, defSecPriceX, defSecPriceY, defFooterX, defFooterY;
        let defFontName, defFontPrice, defFontSecPrice, defFontFooter;

        if (is80) {
            defNameX = '0';
            defNameY = '0';
            defPriceX = '0';
            defPriceY = isMixto ? '-6' : '-2';
            defSecPriceX = '0';
            defSecPriceY = isMixto ? '-3' : '2';
            defFooterX = '0';
            defFooterY = '0';
            defFontName = '4';
            defFontPrice = '14';
            defFontSecPrice = isMixto ? '12' : '0';
            defFontFooter = '3';
        } else {
            defNameX = isMixto ? '-1.5' : '1';
            defNameY = isMixto ? '2' : '0';
            defPriceX = isMixto ? '-1.5' : '1';
            defPriceY = isMixto ? '-7.5' : '-3';
            defSecPriceX = isMixto ? '-1.5' : '1';
            defSecPriceY = isMixto ? '-3' : '2';
            defFooterX = isMixto ? '-1.5' : '1';
            defFooterY = isMixto ? '-1' : '1';
            defFontName = isMixto ? '5' : '5';
            defFontPrice = isMixto ? '10' : '10';
            defFontSecPrice = isMixto ? '12.5' : '0';
            defFontFooter = isMixto ? '4' : '4';
        }

        setLabelOffsetNameX(localStorage.getItem(`label_offset_name_x${suffix}`) || defNameX);
        setLabelOffsetNameY(localStorage.getItem(`label_offset_name_y${suffix}`) || defNameY);
        setLabelOffsetPriceX(localStorage.getItem(`label_offset_price_x${suffix}`) || defPriceX);
        setLabelOffsetPriceY(localStorage.getItem(`label_offset_price_y${suffix}`) || defPriceY);
        setLabelOffsetSecPriceX(localStorage.getItem(`label_offset_sec_price_x${suffix}`) || defSecPriceX);
        setLabelOffsetSecPriceY(localStorage.getItem(`label_offset_sec_price_y${suffix}`) || defSecPriceY);
        setLabelOffsetFooterX(localStorage.getItem(`label_offset_footer_x${suffix}`) || defFooterX);
        setLabelOffsetFooterY(localStorage.getItem(`label_offset_footer_y${suffix}`) || defFooterY);
        
        setLabelOffsetFontName(localStorage.getItem(`label_offset_font_name${suffix}`) || defFontName);
        setLabelOffsetFontPrice(localStorage.getItem(`label_offset_font_price${suffix}`) || defFontPrice);
        setLabelOffsetFontSecPrice(localStorage.getItem(`label_offset_font_sec_price${suffix}`) || defFontSecPrice);
        setLabelOffsetFontFooter(localStorage.getItem(`label_offset_font_footer${suffix}`) || defFontFooter);
    }, [labelCurrencyMode, paperWidth]);

    const visibleTabs = TABS;

    // ─── Cloud backup hook ────────────────────────────────
    const {
        importStatus,
        setImportStatus,
        statusMessage,
        setStatusMessage,
        dataConflictPending,
        setDataConflictPending,
        lastError,
        setLastError,
        handleSyncCloud,
        handleDataConflictChoice,
    } = useCloudBackup({
        deviceId,
        auditLog,
        forceHeartbeat,
        isLicensedCloud,
        triggerHaptic,
    });

    // ─── Data import/export hook ──────────────────────────
    const {
        showDeleteConfirm,
        setShowDeleteConfirm,
        deleteInput,
        setDeleteInput,
        handleExport,
        handleFileChange,
        handleDeleteAllData,
    } = useDataImportExport({
        auditLog,
        triggerHaptic,
        setImportStatus,
        setStatusMessage,
    });

    // ─── HANDLERS ─────────────────────────────────────────
    const handleSaveBusinessData = () => {
        localStorage.setItem('business_name', businessName);
        localStorage.setItem('business_rif', businessRif);
        localStorage.setItem('printer_paper_width', paperWidth);
        forceHeartbeat();
        showToast('Datos del negocio guardados', 'success');
        auditLog('CONFIG', 'NEGOCIO_ACTUALIZADO', `Datos negocio: ${businessName || 'sin nombre'}`);
        triggerHaptic?.();
    };

    const handleImportClick = () => fileInputRef.current?.click();

    const settingsDialog = (
        <div
            ref={revealRef}
            onClick={e => e.stopPropagation()}
            className={isTab
                ? "flex-1 flex flex-col w-full h-full bg-surface-50 dark:bg-surface-950 overflow-hidden"
                : "fixed inset-0 z-[150] bg-surface-50 dark:bg-surface-950 flex flex-col h-[100dvh] max-h-[100dvh] w-full overflow-hidden animate-in slide-in-from-right duration-300 md:relative md:inset-auto md:w-[90vw] md:max-w-5xl md:h-[85vh] md:max-h-[760px] lg:max-w-6xl md:rounded-3xl md:shadow-tone-lg md:border md:border-slate-100 md:dark:border-slate-800/80 md:animate-in md:zoom-in-95"
            }
        >
            {/* Header */}
            <div className="shrink-0 px-4 pt-[env(safe-area-inset-top)] bg-surface dark:bg-surface-900 border-b border-surface-100 dark:border-surface-800 shadow-tone-sm">
                <div className="flex items-center gap-3 py-4">
                    {!isTab && (
                        <button
                            onClick={onClose}
                            aria-label="Volver"
                            className="p-2 min-h-[48px] min-w-[48px] -ml-1 flex items-center justify-center rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors active:scale-95"
                        >
                            <ArrowLeft size={20} className="text-surface-600 dark:text-surface-300" aria-hidden="true" />
                        </button>
                    )}
                    <h1 className="text-lg font-black text-surface-700 dark:text-white tracking-tight">Configuración</h1>
                </div>

                {/* Tab Bar (Visible only on mobile) */}
                <div className="flex gap-1 -mb-px overflow-x-auto scrollbar-hide md:hidden">
                    {visibleTabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); triggerHaptic?.(); }}
                                className={`flex items-center gap-1.5 px-3.5 py-2.5 min-h-[48px] text-xs font-bold rounded-t-xl transition-all whitespace-nowrap border-b-2 ${
                                    isActive
                                        ? 'text-brand-dark dark:text-brand border-strong-token bg-brand-light/50 dark:bg-surface-800/10'
                                        : 'text-surface-400 border-transparent hover:text-surface-600 dark:hover:text-surface-300'
                                }`}
                            >
                                <Icon size={14} aria-hidden="true" />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Main content area */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-surface-50 dark:bg-surface-950">
                {/* Desktop Sidebar (Visible only on md+) */}
                <div className="hidden md:flex flex-col w-52 shrink-0 bg-surface dark:bg-surface-900 border-r border-surface-100 dark:border-surface-800 p-4 space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 mb-2">Opciones</p>
                    {visibleTabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); triggerHaptic?.(); }}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
                                    isActive
                                        ? 'bg-brand text-white dark:bg-slate-900 dark:text-brand shadow-sm shadow-primary/20'
                                        : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800/40'
                                }`}
                            >
                                <Icon size={16} aria-hidden="true" />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Scrollable Content Pane */}
                <div className="flex-1 overflow-y-auto pb-[calc(3rem+env(safe-area-inset-bottom))] md:pb-6 md:p-6">
                    <div className="w-full space-y-4 md:mt-2">
                        {/* ═══ TAB: NEGOCIO ═══ */}
                        {activeTab === 'negocio' && (
                            <SettingsTabNegocio
                                businessName={businessName} setBusinessName={setBusinessName}
                                businessRif={businessRif} setBusinessRif={setBusinessRif}
                                paperWidth={paperWidth} setPaperWidth={setPaperWidth}
                                labelCurrencyMode={labelCurrencyMode} setLabelCurrencyMode={setLabelCurrencyMode}
                                labelOffsetNameX={labelOffsetNameX} setLabelOffsetNameX={setLabelOffsetNameX}
                                labelOffsetNameY={labelOffsetNameY} setLabelOffsetNameY={setLabelOffsetNameY}
                                labelOffsetPriceX={labelOffsetPriceX} setLabelOffsetPriceX={setLabelOffsetPriceX}
                                labelOffsetPriceY={labelOffsetPriceY} setLabelOffsetPriceY={setLabelOffsetPriceY}
                                labelOffsetSecPriceX={labelOffsetSecPriceX} setLabelOffsetSecPriceX={setLabelOffsetSecPriceX}
                                labelOffsetSecPriceY={labelOffsetSecPriceY} setLabelOffsetSecPriceY={setLabelOffsetSecPriceY}
                                labelOffsetFooterX={labelOffsetFooterX} setLabelOffsetFooterX={setLabelOffsetFooterX}
                                labelOffsetFooterY={labelOffsetFooterY} setLabelOffsetFooterY={setLabelOffsetFooterY}
                                labelOffsetFontName={labelOffsetFontName} setLabelOffsetFontName={setLabelOffsetFontName}
                                labelOffsetFontPrice={labelOffsetFontPrice} setLabelOffsetFontPrice={setLabelOffsetFontPrice}
                                labelOffsetFontSecPrice={labelOffsetFontSecPrice} setLabelOffsetFontSecPrice={setLabelOffsetFontSecPrice}
                                labelOffsetFontFooter={labelOffsetFontFooter} setLabelOffsetFontFooter={setLabelOffsetFontFooter}
                                copEnabled={copEnabled} setCopEnabled={setCopEnabled}
                                autoCopEnabled={autoCopEnabled} setAutoCopEnabled={setAutoCopEnabled}
                                tasaCopManual={tasaCopManual} setTasaCopManual={setTasaCopManual}
                                copPrimary={copPrimary} setCopPrimary={setCopPrimary}
                                calculatedTasaCop={calculatedTasaCop}
                                effectiveRate={effectiveRate}
                                handleSaveBusinessData={handleSaveBusinessData}
                                forceHeartbeat={forceHeartbeat}
                                showToast={showToast}
                                triggerHaptic={triggerHaptic}
                            />
                        )}

                        {/* ═══ TAB: VENTAS ═══ */}
                        {activeTab === 'ventas' && (
                            <SettingsTabVentas
                                allowNegativeStock={allowNegativeStock} setAllowNegativeStock={setAllowNegativeStock}
                                forceHeartbeat={forceHeartbeat}
                                showToast={showToast}
                                triggerHaptic={triggerHaptic}
                            />
                        )}

                        {/* ═══ TAB: USUARIOS ═══ */}
                        {activeTab === 'usuarios' && (
                            <SettingsTabUsuarios
                                requireLogin={requireLogin}
                                setRequireLogin={setRequireLogin}
                                autoLockMinutes={autoLockMinutes}
                                setAutoLockMinutes={setAutoLockMinutes}
                                showToast={showToast}
                                triggerHaptic={triggerHaptic}
                            />
                        )}

                        {/* ═══ TAB: SISTEMA ═══ */}
                        {activeTab === 'sistema' && (
                            <SettingsTabSistema
                                theme={theme} toggleTheme={toggleTheme}
                                deviceId={deviceId} idCopied={idCopied} setIdCopied={setIdCopied}
                                isAdmin={isAdmin}
                                importStatus={importStatus} statusMessage={statusMessage}
                                handleExport={handleExport}
                                handleImportClick={handleImportClick}
                                handleSyncCloud={handleSyncCloud}
                                dataConflictPending={dataConflictPending}
                                handleDataConflictChoice={handleDataConflictChoice}
                                lastError={lastError}
                                onDismissError={() => setLastError(null)}
                                setIsShareOpen={setIsShareOpen}
                                setShowDeleteConfirm={setShowDeleteConfirm}
                                isLicensedCloud={isLicensedCloud}
                                triggerHaptic={triggerHaptic}
                            />
                        )}

                        {/* ═══ TAB: LICENCIA ═══ */}
                        {activeTab === 'licencia' && (
                            <SettingsTabLicencia
                                deviceId={deviceId}
                                triggerHaptic={triggerHaptic}
                            />
                        )}

                        {/* ═══ TAB: CUENTAS ═══ */}
                        {activeTab === 'cuentas' && (
                            <WalletView rates={rates} />
                        )}

                        {/* Version footer */}
                        <div className="text-center py-4">
                            <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold">PreciosAlDía Bodegas v1.7.1</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowDeleteConfirm(false)}>
                    <div className="bg-surface dark:bg-surface-900 rounded-3xl p-6 w-full max-w-sm shadow-tone-lg animate-in zoom-in-95 duration-200 text-center" onClick={e => e.stopPropagation()}>
                        <div className="w-16 h-16 mx-auto bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-4">
                            <AlertTriangle size={32} aria-hidden="true" />
                        </div>
                        <h3 className="text-xl font-black text-surface-700 dark:text-white mb-2">Estas seguro?</h3>
                        <p className="text-sm text-surface-500 dark:text-surface-400 mb-6">
                            Esta accion eliminara <strong>todo el historial de ventas</strong> y dejara las estadisticas en cero.
                            <br/><br/>
                            Para confirmar, escribe <span className="font-mono font-bold text-red-500 bg-red-50 dark:bg-red-900/40 px-1 rounded">ELIMINAR</span> abajo:
                        </p>
                        <input
                            type="text"
                            value={deleteInput}
                            onChange={e => setDeleteInput(e.target.value.toUpperCase())}
                            placeholder="Escribe ELIMINAR"
                            className="input w-full bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-slate-800 rounded-xl px-4 py-3 min-h-[48px] text-center font-mono font-bold text-surface-700 dark:text-white mb-4 focus:ring-2 focus:ring-red-500/50 uppercase transition-colors"
                            autoFocus
                        />
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                                className="flex-1 py-3 min-h-[48px] text-sm font-bold text-surface-500 bg-surface-100 dark:bg-surface-800 rounded-xl hover:bg-surface-200 dark:hover:bg-surface-700 active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                disabled={deleteInput !== 'ELIMINAR'}
                                onClick={handleDeleteAllData}
                                className="flex-1 py-3 min-h-[48px] text-sm font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Si, borrar todo
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* INPUT OCULTO — requerido para que handleImportClick funcione */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
            />

            <ShareInventoryModal
                isOpen={isShareOpen}
                onClose={() => setIsShareOpen(false)}
            />
        </div>
    );

    if (isTab) return settingsDialog;

    return (
        <div className="fixed inset-0 z-[150] md:flex md:items-center md:justify-center md:bg-black/50 md:backdrop-blur-xs animate-in fade-in duration-300" onClick={onClose}>
            {settingsDialog}
        </div>
    );
}
