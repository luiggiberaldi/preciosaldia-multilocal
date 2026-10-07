// ============================================================
// 🔍 FINANCIAL AUDITOR VIEW v5.0 — Auditor Determinista
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SystemTester } from '../testing/SystemTester';
import {
    ShieldCheck, Square, Copy, CheckCircle2, XCircle,
    ChevronLeft, ChevronDown, ChevronUp, TerminalSquare, Trash2,
    Download, AlertTriangle, Brain
} from 'lucide-react';

function _fallbackCopy(text, setCopied) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    } catch (e) {
        console.warn('[Copy] execCommand fallback failed', e);
    }
    document.body.removeChild(ta);
}

const SUITE_ICONS = {
    // Bloque A — Motor dinero.js
    precision_financiera:  '🔬',
    dinero_extended:       '🧮',
    // Bloque B — FinancialEngine
    cart_engine:           '🛒',
    discount_logic:        '🏷️',
    profit_engine:         '📈',
    payment_breakdown:     '💳',
    // Bloque C — Clientes
    cliente_impacto:       '👤',
    // Bloque D — Flujos de caja
    fiado_calculo:         '📋',
    cambio_split:          '💱',
    stock_modos:           '📦',
    // Bloque E — Display COP
    cop_display:           '🇨🇴',
    cop_pagos:             '💛',
    // Bloque F — Datos reales
    auditoria_historica:   '🕵️',
    auditoria_patrimonial: '🏭',
    auditoria_cartera:     '👥',
    auditoria_cierre:      '📦',
    auditoria_tasas:       '💱',
    margen_negativo:       '💸',
    pagos_inconsistentes:  '🧾',
    ids_duplicados:        '🪪',
    cartera_coherencia:    '📒',
    apertura_unica:        '🔓',
    metodos_validos:       '💳',
};

export const TesterView = ({ onBack }) => {
    const [isRunning, setIsRunning]   = useState(false);
    const [logs, setLogs]             = useState([]);
    const [progress, setProgress]     = useState(null);
    const [summary, setSummary]       = useState(null);
    const [copied, setCopied]         = useState(false);
    const [logFilter, setLogFilter]   = useState('all');
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const handleRunAll = useCallback(async () => {
        setIsRunning(true);
        setLogs([]);
        setSummary(null);
        setCopied(false);
        try {
            await SystemTester.runAll({
                fastMode: true,
                onLog:      (entry) => setLogs(prev => [...prev, entry]),
                onProgress: (p)     => setProgress(p),
                onComplete: (s)     => { setSummary(s); setProgress(null); },
            });
        } catch (err) {
            setLogs(prev => [...prev, {
                time: new Date().toLocaleTimeString(), msg: `💥 Error fatal: ${err.message}`, type: 'error'
            }]);
        }
        setIsRunning(false);
    }, []);

    const handleRunSuite = useCallback(async (suiteKey) => {
        setIsRunning(true);
        setLogs([]);
        setSummary(null);
        setCopied(false);
        try {
            const result = await SystemTester.runSuite(suiteKey, {
                onLog: (entry) => setLogs(prev => [...prev, entry]),
            });
            setSummary(result);
        } catch (err) {
            setLogs(prev => [...prev, {
                time: new Date().toLocaleTimeString(), msg: `💥 ${err.message}`, type: 'error'
            }]);
        }
        setIsRunning(false);
    }, []);

    const handleStop = useCallback(() => {
        SystemTester.stop();
        setIsRunning(false);
    }, []);

    const handleCopyAll = useCallback(() => {
        let text = '═══ AUDITOR FINANCIERO v5.0 — Precios al Día ═══\n\n';
        text += logs.map(l => `[${l.time}] ${l.msg}`).join('\n');

        if (summary?.suites?.length) {
            const passed  = summary.suites.filter(s => s.status === 'passed').length;
            const failed  = summary.suites.filter(s => s.status === 'failed').length;
            const elapsed = summary.startedAt && summary.finishedAt
                ? ((summary.finishedAt - summary.startedAt) / 1000).toFixed(1) : 0;

        text += `\n── RESUMEN ──\nTotal: ${summary.suites.length} | OK: ${passed} | FALLO: ${failed} | Tiempo: ${elapsed}s\n`;
            text += '\n── DETALLE ──\n';
            summary.suites.forEach(r => {
                text += `${r.status === 'passed' ? '✅' : '❌'} ${r.name}${r.error ? ` — ${r.error}` : ''}\n`;
            });

            if (summary.aiAnalysis) {
                text += `\n── ANÁLISIS IA ──\n${summary.aiAnalysis}\n`;
            }
        }

        // Try modern clipboard API first, fallback to execCommand
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }).catch(() => {
                _fallbackCopy(text, setCopied);
            });
        } else {
            _fallbackCopy(text, setCopied);
        }
    }, [logs, summary]);

    const handleClear = useCallback(() => {
        setLogs([]);
        setSummary(null);
        setProgress(null);
        setCopied(false);
    }, []);

    const suites = SystemTester.getSuites();

    const logColors = {
        success: 'text-emerald-400',
        error:   'text-rose-400',
        warn:    'text-amber-400',
        info:    'text-slate-400',
        section: 'text-brand font-bold',
    };

    const totalSuites  = summary?.suites?.length || 0;
    const passedSuites = summary?.suites?.filter(s => s.status === 'passed').length || 0;
    const failedSuites = summary?.suites?.filter(s => s.status === 'failed').length || 0;
    const elapsedSec   = summary?.startedAt && summary?.finishedAt
        ? ((summary.finishedAt - summary.startedAt) / 1000).toFixed(1) : 0;

    const visibleLogs = logFilter === 'all'
        ? logs
        : logs.filter(l => l.type === logFilter);

    const findings = summary?.suites?.filter(s => s.status === 'failed') || [];

    return (
        // v1.2.0: bg-surface-950 reapunta a warm carbón (H=85). Dev-only view.
        <div className="min-h-screen bg-surface-950 text-white p-3 sm:p-6 space-y-3 sm:space-y-4">

            {/* ── Header ── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                    {/* v1.2.0: touch target ≥ 40px + aria-label */}
                    <button onClick={onBack} aria-label="Volver"
                        className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center bg-surface-800 hover:bg-surface-700 rounded-xl transition-all active:scale-95">
                        <ChevronLeft size={18} aria-hidden="true" />
                    </button>
                    <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-rose-600 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-rose-600/30">
                        <ShieldCheck size={18} aria-hidden="true" />
                    </div>
                    <div>
                        <h1 className="text-sm sm:text-lg font-black tracking-tight">Auditor Financiero <span className="text-rose-400">v6.1</span></h1>
                        <p className="text-[8px] sm:text-[10px] text-surface-500 uppercase tracking-widest font-bold">23 Suites • Determinista • Datos Reales • Groq AI</p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                    {logs.length > 0 && !isRunning && (
                        <button onClick={handleCopyAll}
                            className={`flex items-center gap-1 px-2 sm:px-3 py-2 min-h-[40px] rounded-xl text-[10px] sm:text-xs font-bold transition-all ${
                                copied ? 'bg-emerald-600 text-white' : 'bg-surface-800 text-surface-300 hover:bg-surface-700 border border-surface-700'
                            }`}>
                            {copied ? <CheckCircle2 size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                            <span className="hidden sm:inline">{copied ? '¡Copiado!' : 'Copiar'}</span>
                        </button>
                    )}

                    {isRunning ? (
                        <button onClick={handleStop}
                            className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] bg-rose-600 hover:bg-rose-500 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-lg shadow-rose-600/30 active:scale-95">
                            <Square size={14} aria-hidden="true" /> <span className="hidden sm:inline">Detener</span>
                        </button>
                    ) : (
                        <button onClick={handleRunAll}
                            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 min-h-[40px] bg-rose-600 hover:bg-rose-500 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-lg shadow-rose-600/30 active:scale-95">
                            <ShieldCheck size={14} aria-hidden="true" /> Auditar Ahora
                        </button>
                    )}
                </div>
            </div>

            {/* ── Suite Buttons ── */}
            {/* v1.2.0: touch target ≥ 32px (dev tool, denso) + surface tokens + aria-label. */}
            <div className="flex flex-wrap gap-1 sm:gap-1.5">
                {suites.map(s => (
                    <button
                        key={s.key}
                        onClick={() => handleRunSuite(s.key)}
                        disabled={isRunning}
                        aria-label={`Ejecutar suite ${s.name}`}
                        className="flex items-center gap-1 px-2 sm:px-3 py-1.5 min-h-[32px] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-[10px] sm:text-xs font-bold transition-all border active:scale-95 bg-surface-800 hover:bg-surface-700 border-surface-700 hover:border-surface-500"
                    >
                        <span aria-hidden="true">{SUITE_ICONS[s.key]}</span>
                        <span className="hidden sm:inline">{s.name.replace(/^[^\s]+\s/, '')}</span>
                        <span className="sm:hidden">{s.key.slice(0, 5)}</span>
                    </button>
                ))}
            </div>

            {/* ── Progress Bar ── */}
            {progress && (
                <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-slate-400">{progress.name}</span>
                        <span className="text-xs font-mono text-slate-500">{progress.current}/{progress.total}</span>
                    </div>
                    <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-rose-500 to-orange-500 rounded-full transition-all duration-300"
                            style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                    </div>
                </div>
            )}

            {/* ── Stats Bar ── */}
            {summary && (
                <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                    <div className="bg-slate-800/80 rounded-xl p-2 sm:p-3 text-center border border-slate-700">
                        <p className="text-lg sm:text-2xl font-black text-white">{totalSuites}</p>
                        <p className="text-[7px] sm:text-[9px] text-slate-500 uppercase font-bold">Suites</p>
                    </div>
                    <div className="bg-emerald-950/50 rounded-xl p-2 sm:p-3 text-center border border-emerald-800/30">
                        <p className="text-lg sm:text-2xl font-black text-emerald-400">{passedSuites}</p>
                        <p className="text-[7px] sm:text-[9px] text-emerald-500 uppercase font-bold">OK</p>
                    </div>
                    <div className="bg-rose-950/50 rounded-xl p-2 sm:p-3 text-center border border-rose-800/30">
                        <p className="text-lg sm:text-2xl font-black text-rose-400">{failedSuites}</p>
                        <p className="text-[7px] sm:text-[9px] text-rose-500 uppercase font-bold">Fallo</p>
                    </div>
                    <div className="bg-slate-800/80 rounded-xl p-2 sm:p-3 text-center border border-slate-700">
                        <p className="text-lg sm:text-2xl font-black text-slate-300">{elapsedSec}s</p>
                        <p className="text-[7px] sm:text-[9px] text-slate-500 uppercase font-bold">Tiempo</p>
                    </div>
                </div>
            )}

            {/* ── Veredicto ── */}
            {summary && (
                <div className={`flex items-center justify-center gap-3 p-3 rounded-xl border ${
                    failedSuites === 0
                        ? 'bg-emerald-950/30 border-emerald-700/30'
                        : failedSuites <= 2 ? 'bg-amber-950/30 border-amber-700/30'
                        : 'bg-rose-950/30 border-rose-700/30'
                }`}>
                    <span className="text-3xl sm:text-4xl">
                        {failedSuites === 0 ? '🟢' : failedSuites <= 2 ? '🟡' : '🔴'}
                    </span>
                    <div>
                        <p className={`text-sm sm:text-lg font-black ${
                            failedSuites === 0 ? 'text-emerald-400'
                            : failedSuites <= 2 ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}>
                            {failedSuites === 0
                                ? 'SISTEMA FINANCIERO SANO'
                                : `${failedSuites} PROBLEMA${failedSuites > 1 ? 'S' : ''} DETECTADO${failedSuites > 1 ? 'S' : ''}`}
                        </p>
                        <p className="text-[9px] sm:text-[10px] text-slate-500 font-bold">
                            {passedSuites}/{totalSuites} suites OK • {elapsedSec}s • Determinista
                        </p>
                    </div>
                </div>
            )}

            {/* ── Hallazgos ── */}
            {findings.length > 0 && (
                <div className="bg-rose-950/20 rounded-xl border border-rose-800/30 overflow-hidden">
                    <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 border-b border-rose-800/20">
                        <AlertTriangle size={14} className="text-rose-400" />
                        <span className="text-xs sm:text-sm font-black text-rose-300 uppercase tracking-wide">
                            Hallazgos — {findings.length} problema{findings.length > 1 ? 's' : ''}
                        </span>
                    </div>
                    <div className="p-2 sm:p-3 space-y-1.5">
                        {findings.map((s, i) => (
                            <div key={i} className="flex items-start gap-2 px-2 sm:px-3 py-2 bg-rose-950/30 rounded-lg">
                                <XCircle size={12} className="text-rose-500 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-[10px] sm:text-xs font-bold text-rose-300">{s.name}</p>
                                    {s.error && (
                                        <p className="text-[9px] sm:text-[10px] text-rose-400/70 mt-0.5">{s.error}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── AI Analysis ── */}
            {summary?.aiAnalysis && (
                <div className="bg-cyan-950/20 rounded-xl border border-cyan-800/30 overflow-hidden">
                    <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 border-b border-cyan-800/20">
                        <Brain size={14} className="text-cyan-400" />
                        <span className="text-xs sm:text-sm font-black text-cyan-300 uppercase tracking-wide">Análisis de IA — Groq</span>
                    </div>
                    <div className="p-3 sm:p-4">
                        <p className="text-[10px] sm:text-xs text-cyan-100/80 leading-relaxed whitespace-pre-wrap">{summary.aiAnalysis}</p>
                    </div>
                </div>
            )}

            {/* ── Log Console ── */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-slate-800/50 border-b border-slate-700">
                    <div className="flex items-center gap-2">
                        <TerminalSquare size={14} className="text-slate-500" />
                        <span className="text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Log</span>
                        {logs.length > 0 && (
                            <span className="text-[8px] sm:text-[9px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full font-mono">{logs.length}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="flex gap-1">
                            {['all', 'error', 'warn'].map(f => (
                                <button key={f} onClick={() => setLogFilter(f)}
                                    aria-label={`Filtrar por ${f}`}
                                    className={`px-2 py-1 min-h-[28px] rounded-lg text-[8px] sm:text-[9px] font-black uppercase transition-all ${
                                        logFilter === f
                                            ? f === 'error' ? 'bg-rose-600 text-white'
                                              : f === 'warn' ? 'bg-amber-500 text-white'
                                              : 'bg-brand-dark text-white'
                                            : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
                                    }`}>
                                    {f === 'all'
                                        ? `Todo (${logs.length})`
                                        : f === 'error'
                                        ? `Errores (${logs.filter(l => l.type === 'error').length})`
                                        : `Avisos (${logs.filter(l => l.type === 'warn').length})`}
                                </button>
                            ))}
                        </div>
                        {/* v1.2.0: aria-label + min-h[32px] en icon buttons (dev tool, denso) */}
                        <button onClick={handleClear} disabled={isRunning || logs.length === 0} aria-label="Limpiar log"
                            className="p-1.5 min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-surface-500 hover:text-surface-300 hover:bg-surface-700 transition-all disabled:opacity-30" title="Limpiar">
                            <Trash2 size={13} aria-hidden="true" />
                        </button>
                        <button
                            onClick={() => {
                                const data = { timestamp: new Date().toISOString(), summary, logs };
                                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url; a.download = `audit-${Date.now()}.json`; a.click();
                                URL.revokeObjectURL(url);
                            }}
                            disabled={logs.length === 0}
                            aria-label="Descargar log como JSON"
                            className="flex items-center gap-1 px-2 py-1 min-h-[32px] rounded-xl text-[10px] sm:text-xs font-bold bg-surface-800 text-surface-300 hover:bg-brand-dark hover:text-white border border-surface-700 transition-all disabled:opacity-30">
                            <Download size={12} aria-hidden="true" />
                            <span className="hidden sm:inline">JSON</span>
                        </button>
                    </div>
                </div>

                <div className="max-h-[35vh] sm:max-h-[45vh] overflow-y-auto p-2 sm:p-3 font-mono text-[9px] sm:text-xs space-y-0.5 select-text">
                    {logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 sm:py-16 gap-3 select-none">
                            <ShieldCheck size={28} className="text-slate-700" />
                            <p className="text-slate-600 text-xs sm:text-sm font-bold">Presiona "Auditar Ahora" para iniciar</p>
                            <p className="text-slate-700 text-[8px] sm:text-[10px]">{suites.length} suites • Datos reales • Determinista</p>
                        </div>
                    ) : (
                        visibleLogs.map((entry, i) => (
                            <div key={i} className={`flex gap-1.5 sm:gap-2 ${logColors[entry.type] || 'text-slate-400'}`}>
                                <span className="text-slate-600 shrink-0">[{entry.time}]</span>
                                <span className="break-all">{entry.msg}</span>
                            </div>
                        ))
                    )}
                    <div ref={logsEndRef} />
                </div>
            </div>

            {/* ── Detalle de Suites ── */}
            {summary?.suites && summary.suites.length > 0 && (
                <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="px-3 sm:px-4 py-2 bg-slate-800/50 border-b border-slate-700">
                        <span className="text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Detalle de Suites</span>
                    </div>
                    <div className="max-h-40 sm:max-h-60 overflow-y-auto p-1.5 sm:p-2 space-y-0.5 sm:space-y-1">
                        {summary.suites.map((s, i) => (
                            <div key={i} className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[9px] sm:text-xs ${
                                s.status === 'passed' ? 'bg-emerald-950/30'
                                : s.status === 'failed' ? 'bg-rose-950/30'
                                : 'bg-slate-800'
                            }`}>
                                {s.status === 'passed'
                                    ? <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                                    : s.status === 'failed'
                                    ? <XCircle size={10} className="text-rose-500 shrink-0" />
                                    : <Square size={10} className="text-slate-500 shrink-0" />}
                                <span className={`font-bold shrink-0 ${
                                    s.status === 'passed' ? 'text-emerald-400'
                                    : s.status === 'failed' ? 'text-rose-400'
                                    : 'text-slate-400'
                                }`}>{SUITE_ICONS[s.id] || '⚙️'}</span>
                                <span className="text-slate-300 truncate">{s.name}</span>
                                {s.error && (
                                    <span className="text-rose-500/70 text-[8px] ml-auto shrink-0 max-w-[30%] truncate">{s.error}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Footer ── */}
            <p className="text-center text-[7px] sm:text-[9px] text-slate-700 font-mono uppercase pb-20 mt-4">
                Precios al Día — Bodega • Auditor Financiero v6.1 • {new Date().getFullYear()} • 23 Suites Deterministas
            </p>
        </div>
    );
};
