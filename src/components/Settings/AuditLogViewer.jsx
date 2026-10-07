import React, { useState, useEffect, useCallback } from 'react';
import { getAuditLog, getAuditCount, clearAuditLog, exportAuditLog } from '../../services/auditService';
import { showToast } from '../Toast';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { jsPDF } from 'jspdf';
import {
    FileText, Download, Trash2, Filter, Shield, ShoppingCart,
    Package, Users, Settings, Database, Clock, ChevronDown, AlertTriangle,
    Calendar, FileDown, Hash
} from 'lucide-react';

const CAT_CONFIG = {
    AUTH:       { label: 'Autenticacion', icon: Shield,       color: 'text-brand-dark dark:text-brand',  bg: 'bg-brand-light dark:bg-brand-dark/20' },
    VENTA:      { label: 'Ventas',        icon: ShoppingCart,  color: 'text-brand',    bg: 'bg-brand-light dark:bg-surface-800/20' },
    INVENTARIO: { label: 'Inventario',    icon: Package,       color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    CLIENTE:    { label: 'Clientes',      icon: Users,         color: 'text-sky-500',     bg: 'bg-sky-50 dark:bg-sky-900/20' },
    PROVEEDOR:  { label: 'Proveedores',   icon: Users,         color: 'text-brand-dark dark:text-brand',  bg: 'bg-brand-light dark:bg-brand-dark/20' },
    CONFIG:     { label: 'Configuracion', icon: Settings,      color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20' },
    USUARIO:    { label: 'Usuarios',      icon: Shield,        color: 'text-brand',  bg: 'bg-brand-light dark:bg-surface-800/20' },
    SISTEMA:    { label: 'Sistema',       icon: Database,      color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20' },
};

const CAT_LABELS = {
    AUTH: 'AUTH', VENTA: 'VENTA', INVENTARIO: 'INV', CLIENTE: 'CLI',
    PROVEEDOR: 'PROV', CONFIG: 'CFG', USUARIO: 'USR', SISTEMA: 'SIS',
};

function formatTs(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
           d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDatePdf(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function getLocalISODate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── PDF GENERATOR ──────────────────────────────────────
async function generateAuditPDF(entries, dateFrom, dateTo) {
    const WIDTH = 80;
    const M = 4;
    const RIGHT = WIDTH - M;
    const CX = WIDTH / 2;

    // Dynamic height: ~7mm per entry + header
    const H = Math.max(120, 65 + entries.length * 7);
    const doc = new jsPDF({ unit: 'mm', format: [WIDTH, H] });

    const INK   = [33, 37, 41];
    const BODY  = [73, 80, 87];
    const MUTED = [134, 142, 150];
    const BLUE  = [37, 99, 235];
    const RULE  = [206, 212, 218];

    let y = 5;

    const dash = (yy) => {
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([1, 1], 0);
        doc.line(M, yy, RIGHT, yy);
        doc.setLineDashPattern([], 0);
    };

    // ── Logo ──
    try {
        const img = new Image();
        img.src = '/logo.png';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        doc.addImage(img, 'PNG', CX - 23, y, 46, 11);
        y += 14;
    } catch (_) { y += 2; }

    // ── Titulo ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text('BITACORA DE ACTIVIDAD', CX, y, { align: 'center' });
    y += 5;

    // ── Rango de fechas ──
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    const fromLabel = new Date(dateFrom).toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' });
    const toLabel = new Date(dateTo).toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' });
    doc.text(`${fromLabel}  —  ${toLabel}`, CX, y, { align: 'center' });
    y += 4;
    doc.text(`${entries.length} registros`, CX, y, { align: 'center' });
    y += 5;

    dash(y); y += 5;

    // ── Header de tabla ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(...BLUE);
    doc.text('#', M, y);
    doc.text('FECHA/HORA', M + 5, y);
    doc.text('ACCION', M + 28, y);
    doc.text('USUARIO', RIGHT, y, { align: 'right' });
    y += 3;
    dash(y); y += 3;

    // ── Entries ──
    entries.forEach((entry, i) => {
        const num = entries.length - i;
        const dateStr = formatDatePdf(entry.ts);
        const catTag = CAT_LABELS[entry.cat] || entry.cat;
        const actionDesc = entry.desc.length > 28 ? entry.desc.substring(0, 28) + '...' : entry.desc;
        const user = entry.userName || 'Sistema';

        // Row #
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5);
        doc.setTextColor(...MUTED);
        doc.text(String(num), M, y);

        // Date
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5);
        doc.setTextColor(...BODY);
        doc.text(dateStr, M + 5, y);

        // Category + Action
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5);
        doc.setTextColor(...INK);
        doc.text(`[${catTag}]`, M + 28, y);

        y += 3;

        // Description
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5);
        doc.setTextColor(...BODY);
        doc.text(actionDesc, M + 5, y);

        // User
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5);
        doc.setTextColor(...MUTED);
        doc.text(user, RIGHT, y, { align: 'right' });

        y += 4;
    });

    // ── Pie ──
    y += 2;
    dash(y); y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...INK);
    doc.text('Precios Al Dia', CX, y, { align: 'center' });
    y += 3;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(...MUTED);
    doc.text(`Emitido: ${new Date().toLocaleString('es-VE')} - Sin valor fiscal`, CX, y, { align: 'center' });

    // ── Descargar ──
    const filename = `bitacora_${getLocalISODate(new Date(dateFrom))}_a_${getLocalISODate(new Date(dateTo))}.pdf`;
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ title: 'Bitacora de Actividad', files: [file] })
            .catch(() => doc.save(filename));
    } else {
        doc.save(filename);
    }
}

// ─── COMPONENT ──────────────────────────────────────────
export default function AuditLogViewer({ triggerHaptic }) {
    const [entries, setEntries] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [catFilter, setCatFilter] = useState(null);
    const [showFilters, setShowFilters] = useState(false);
    const [visibleCount, setVisibleCount] = useState(50);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [showDateExport, setShowDateExport] = useState(false);
    const [pdfFrom, setPdfFrom] = useState(getLocalISODate());
    const [pdfTo, setPdfTo] = useState(getLocalISODate());
    const [isGenerating, setIsGenerating] = useState(false);

    const loadLog = useCallback(async () => {
        const filters = {};
        if (catFilter) filters.cat = catFilter;
        filters.limit = visibleCount;
        const log = await getAuditLog(filters);
        setEntries(log);
        const count = await getAuditCount();
        setTotalCount(count);
    }, [catFilter, visibleCount]);

    useEffect(() => { loadLog(); }, [loadLog]);

    const handleClear = async () => {
        const usuarioActivo = useAuthStore.getState().usuarioActivo;
        try {
            await clearAuditLog(usuarioActivo);
            showToast('Audit log borrado', 'success');
            triggerHaptic?.();
            setShowClearConfirm(false);
            loadLog();
        } catch (err) {
            showToast(err.message || 'Error al borrar el log', 'error');
        }
    };

    const handleExportJSON = async () => {
        await exportAuditLog();
        showToast('Log exportado como JSON', 'success');
        triggerHaptic?.();
    };

    const handleExportPDF = async () => {
        setIsGenerating(true);
        triggerHaptic?.();
        try {
            const fromTs = new Date(pdfFrom + 'T00:00:00').getTime();
            const toTs = new Date(pdfTo + 'T23:59:59').getTime();

            const filtered = await getAuditLog({ fromTs, toTs });

            if (filtered.length === 0) {
                showToast('No hay registros en ese rango de fechas', 'warning');
                setIsGenerating(false);
                return;
            }

            await generateAuditPDF(filtered, fromTs, toTs);
            showToast(`PDF generado con ${filtered.length} registros`, 'success');
            setShowDateExport(false);
        } catch (err) {
            console.error(err);
            showToast('Error generando PDF', 'error');
        }
        setIsGenerating(false);
    };

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Hash size={12} className="text-slate-400" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        {totalCount} registros
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => { setShowFilters(!showFilters); triggerHaptic?.(); }}
                        className={`p-2 rounded-lg transition-all ${showFilters ? 'bg-brand-light dark:bg-surface-800/30 text-brand' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        title="Filtrar por categoria"
                    >
                        <Filter size={14} />
                    </button>
                    <button
                        onClick={() => { setShowDateExport(!showDateExport); triggerHaptic?.(); }}
                        className={`p-2 rounded-lg transition-all ${showDateExport ? 'bg-brand-light dark:bg-surface-800/30 text-brand' : 'text-slate-400 hover:text-brand hover:bg-brand-light dark:hover:bg-surface-800/20'}`}
                        title="Descargar PDF por fechas"
                    >
                        <FileDown size={14} />
                    </button>
                    <button onClick={handleExportJSON} className="p-2 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all" title="Exportar JSON">
                        <Download size={14} />
                    </button>
                    <button onClick={() => setShowClearConfirm(true)} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all" title="Borrar todo">
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {/* Date Export Panel */}
            {showDateExport && (
                <div className="p-3 bg-brand-light dark:bg-surface-950/50 rounded-xl border border-surface-200 dark:border-surface-700/30 space-y-3 animate-in slide-in-from-top-1 duration-200">
                    <p className="text-[10px] font-bold text-brand uppercase tracking-wider flex items-center gap-1.5">
                        <Calendar size={11} /> Descargar PDF por rango de fechas
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Desde</label>
                            <input
                                type="date"
                                value={pdfFrom}
                                onChange={e => setPdfFrom(e.target.value)}
                                max={pdfTo}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-2.5 text-xs font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/30"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Hasta</label>
                            <input
                                type="date"
                                value={pdfTo}
                                onChange={e => setPdfTo(e.target.value)}
                                min={pdfFrom}
                                max={getLocalISODate()}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-2.5 text-xs font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/30"
                            />
                        </div>
                    </div>
                    <button
                        onClick={handleExportPDF}
                        disabled={isGenerating}
                        className="w-full py-2.5 bg-brand text-white font-bold text-xs rounded-xl hover:bg-brand-dark active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isGenerating ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <FileDown size={14} /> Generar PDF
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Category Filters */}
            {showFilters && (
                <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800 animate-in slide-in-from-top-1 duration-200">
                    <button
                        onClick={() => { setCatFilter(null); triggerHaptic?.(); }}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${!catFilter ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                    >
                        Todos
                    </button>
                    {Object.entries(CAT_CONFIG).map(([key, conf]) => (
                        <button
                            key={key}
                            onClick={() => { setCatFilter(key); triggerHaptic?.(); }}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${catFilter === key ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                        >
                            {conf.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Entries */}
            {entries.length === 0 ? (
                <div className="text-center py-8">
                    <FileText size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-xs text-slate-400 font-bold">Sin registros</p>
                </div>
            ) : (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto scrollbar-hide">
                    {entries.map((entry, idx) => {
                        const conf = CAT_CONFIG[entry.cat] || CAT_CONFIG.SISTEMA;
                        const Icon = conf.icon;
                        const entryNumber = totalCount - idx;
                        return (
                            <div key={entry.id} className="flex items-start gap-2 p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-50 dark:border-slate-800">
                                {/* Number badge */}
                                <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
                                    <span className="text-[8px] font-black text-slate-300 dark:text-slate-600 tabular-nums leading-none">
                                        #{entryNumber}
                                    </span>
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${conf.bg}`}>
                                        <Icon size={12} className={conf.color} />
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 leading-tight">{entry.desc}</p>
                                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1">
                                        <span className={`text-[8px] font-black uppercase tracking-wider ${conf.color} ${conf.bg} px-1.5 py-0.5 rounded`}>
                                            {entry.action}
                                        </span>
                                        <span className="text-[9px] text-slate-400 font-bold">{entry.userName || 'Sistema'}</span>
                                        <span className="text-[9px] text-slate-300 dark:text-slate-600">|</span>
                                        <span className="text-[9px] text-slate-400 flex items-center gap-0.5">
                                            <Clock size={8} /> {formatTs(entry.ts)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Load more */}
            {entries.length >= visibleCount && (
                <button
                    onClick={() => { setVisibleCount(v => v + 50); triggerHaptic?.(); }}
                    className="w-full py-2 text-[10px] font-bold text-brand bg-brand-light dark:bg-surface-800/20 rounded-xl hover:bg-brand-light dark:hover:bg-surface-800/40 transition-colors flex items-center justify-center gap-1"
                >
                    <ChevronDown size={12} /> Cargar mas
                </button>
            )}

            {/* Clear Confirmation */}
            {showClearConfirm && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowClearConfirm(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl text-center animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="w-14 h-14 mx-auto bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-4">
                            <AlertTriangle size={28} />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">Borrar Log</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                            Se eliminaran todos los registros de auditoria. Esta accion no se puede deshacer.
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl active:scale-95 transition-all">
                                Cancelar
                            </button>
                            <button onClick={handleClear} className="flex-1 py-3 text-sm font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 active:scale-95 transition-all">
                                Si, borrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
