// v1.2.1: Calibrador y preview de ticket ocultados hasta nuevo aviso
import React, { useState, useRef, useEffect } from 'react';
import { Store, Printer, Coins, Check, Tag } from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';
import { generarPreviewLabel } from '../../../utils/labelGenerator';


const CalibratorSlider = ({ label, value, setValue, baseKey, mode, paperWidth, min, max, step = 0.5, unit = 'mm', triggerHaptic }) => {
    const valFloat = parseFloat(value || '0');
    const is80 = paperWidth === '80';
    const suffix = is80
        ? (mode === 'mixto' ? '_80_mixto' : '_80_unico')
        : (mode === 'mixto' ? '_mixto' : '_unico');
    const storageKey = `${baseKey}${suffix}`;
    
    const handleIncrement = () => {
        const newVal = Math.min(max, valFloat + 1);
        const formatted = Number(newVal.toFixed(1)).toString();
        setValue(formatted);
        localStorage.setItem(storageKey, formatted);
        triggerHaptic?.();
    };

    const handleDecrement = () => {
        const newVal = Math.max(min, valFloat - 1);
        const formatted = Number(newVal.toFixed(1)).toString();
        setValue(formatted);
        localStorage.setItem(storageKey, formatted);
        triggerHaptic?.();
    };

    return (
        <div className="space-y-1">
            <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold w-full">
                <span>{label}</span>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-0.5 shadow-sm">
                    <input
                        type="number"
                        step={step}
                        min={min}
                        max={max}
                        value={value}
                        onChange={e => {
                            const rawVal = e.target.value;
                            setValue(rawVal);
                            if (rawVal !== '' && !isNaN(parseFloat(rawVal))) {
                                localStorage.setItem(storageKey, rawVal);
                            }
                        }}
                        className="w-10 bg-transparent text-[10px] font-black text-brand text-right focus:outline-none focus:ring-0 p-0 border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-[9px] font-black text-slate-400/80 dark:text-slate-500 select-none">{unit}</span>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={handleDecrement}
                    className="w-10 h-10 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 text-sm font-black transition-all active:scale-95 select-none"
                    aria-label="Disminuir"
                >
                    -
                </button>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={e => {
                        setValue(e.target.value);
                        localStorage.setItem(storageKey, e.target.value);
                        triggerHaptic?.();
                    }}
                    className="flex-1 h-2 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand"
                />
                <button
                    type="button"
                    onClick={handleIncrement}
                    className="w-10 h-10 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 text-sm font-black transition-all active:scale-95 select-none"
                    aria-label="Aumentar"
                >
                    +
                </button>
            </div>
        </div>
    );
};

export default function SettingsTabNegocio({
    businessName, setBusinessName,
    businessRif, setBusinessRif,
    paperWidth, setPaperWidth,
    labelCurrencyMode, setLabelCurrencyMode,
    labelOffsetNameX, setLabelOffsetNameX,
    labelOffsetNameY, setLabelOffsetNameY,
    labelOffsetPriceX, setLabelOffsetPriceX,
    labelOffsetPriceY, setLabelOffsetPriceY,
    labelOffsetSecPriceX, setLabelOffsetSecPriceX,
    labelOffsetSecPriceY, setLabelOffsetSecPriceY,
    labelOffsetFooterX, setLabelOffsetFooterX,
    labelOffsetFooterY, setLabelOffsetFooterY,
    labelOffsetFontName, setLabelOffsetFontName,
    labelOffsetFontPrice, setLabelOffsetFontPrice,
    labelOffsetFontSecPrice, setLabelOffsetFontSecPrice,
    labelOffsetFontFooter, setLabelOffsetFontFooter,
    copEnabled, setCopEnabled,
    autoCopEnabled, setAutoCopEnabled,
    tasaCopManual, setTasaCopManual,
    copPrimary, setCopPrimary,
    calculatedTasaCop,
    effectiveRate,
    handleSaveBusinessData,
    forceHeartbeat,
    showToast,
    triggerHaptic,
}) {
    const [showCalibrator, setShowCalibrator] = useState(false);

    // ─── PdfPreview: 100% pixel-perfect usando jsPDF real embebido en iframe ──
    // generarPreviewLabel usa exactamente el mismo código que generarEtiquetas,
    // devuelve un blobURL del PDF que mostramos directamente — cero simulación.
    const PdfPreview = () => {
        const [pdfUrl, setPdfUrl] = useState(null);
        const [loading, setLoading] = useState(true);
        const prevUrlRef = useRef(null);

        const isMixto = labelCurrencyMode === 'mixto';
        const PX_MM   = 3.78;
        const is80 = paperWidth === '80';
        const W_PX = (is80 ? 80 : 58) * PX_MM;
        const H_PX = (is80
            ? (isMixto ? 80 : (hasSecondaryPrice ? 68 : 60))
            : (isMixto ? 60 : (hasSecondaryPrice ? 50 : 44))
        ) * PX_MM;

        useEffect(() => {
            let cancelled = false;
            setLoading(true);
            generarPreviewLabel(effectiveRate, copEnabled, calculatedTasaCop).then(url => {
                if (cancelled) return;
                if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
                prevUrlRef.current = url;
                setPdfUrl(url);
                setLoading(false);
            }).catch(() => {
                if (!cancelled) setLoading(false);
            });
            return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [
            labelCurrencyMode,
            paperWidth,
            labelOffsetNameX, labelOffsetNameY,
            labelOffsetPriceX, labelOffsetPriceY,
            labelOffsetSecPriceX, labelOffsetSecPriceY,
            labelOffsetFooterX, labelOffsetFooterY,
            labelOffsetFontName, labelOffsetFontPrice,
            labelOffsetFontSecPrice, labelOffsetFontFooter,
            effectiveRate, copEnabled, calculatedTasaCop,
        ]);

        return (
            <div
                className="relative border border-slate-200 dark:border-slate-700 shadow-md rounded bg-white overflow-hidden"
                style={{ width: `${W_PX}px`, height: `${H_PX}px` }}
            >
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-slate-400 text-xs">
                        Generando…
                    </div>
                )}
                {pdfUrl && (
                    <iframe
                        key={pdfUrl}
                        src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                        title="Vista previa del ticket"
                        style={{
                            width: `${W_PX}px`,
                            height: `${H_PX}px`,
                            border: 'none',
                            display: 'block',
                        }}
                    />
                )}
            </div>
        );
    };


    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {/* Mi Negocio */}
            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={Store} title="Mi Negocio" subtitle="Datos que aparecen en tickets" iconColor="text-brand">
                    <div className="space-y-4">
                        <div>
                            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">Nombre del Negocio</label>
                            <input
                                type="text"
                                placeholder="Ej: Mi Bodega C.A."
                                value={businessName}
                                onChange={e => setBusinessName(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">RIF o Documento</label>
                            <input
                                type="text"
                                placeholder="Ej: J-12345678"
                                value={businessRif}
                                onChange={e => setBusinessRif(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                            />
                        </div>
                        <button
                            onClick={handleSaveBusinessData}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-brand-light dark:bg-surface-800/20 text-brand-dark dark:text-brand font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-brand-light dark:hover:bg-surface-800/40 transition-colors active:scale-[0.98]"
                        >
                            <Check size={16} /> Guardar
                        </button>
                    </div>
                </SectionCard>
            </div>

            {/* Impresora - Sólo Tamaño de Ticket */}
            <SectionCard icon={Printer} title="Tamaño de Ticket" subtitle="Configuración del ancho de papel" iconColor="text-brand">
                <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">Ancho de Papel</label>
                <div className="grid grid-cols-2 gap-2">
                    {[{ val: '58', label: '58 mm (Pequeña)' }, { val: '80', label: '80 mm (Estándar)' }].map(opt => (
                        <button
                            key={opt.val}
                            onClick={() => { setPaperWidth(opt.val); localStorage.setItem('printer_paper_width', opt.val); triggerHaptic?.(); }}
                            className={`py-2.5 px-3 text-xs font-bold rounded-xl transition-all border ${paperWidth === opt.val
                                ? 'bg-brand-light dark:bg-brand/10 border-brand text-brand-dark dark:text-brand shadow-sm'
                                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </SectionCard>

            {/* Etiquetas de Precios */}
            <SectionCard icon={Tag} title="Etiquetas de Productos" subtitle="Moneda a mostrar en la etiqueta" iconColor="text-brand">
                <div className="space-y-4">
                    <div>
                        <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">Moneda del Precio</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {[
                                { val: 'bs', label: 'Bs' },
                                { val: 'usd', label: '$' },
                                { val: 'mixto', label: 'Mixto' }
                            ].map(opt => (
                                <button
                                    key={opt.val}
                                    onClick={() => {
                                        setLabelCurrencyMode(opt.val);
                                        localStorage.setItem('label_currency_mode', opt.val);
                                        triggerHaptic?.();
                                        showToast(`Moneda de etiqueta cambiada a ${opt.label}`, 'success');
                                    }}
                                    className={`py-2.5 px-2 text-xs font-bold rounded-xl transition-all border text-center ${labelCurrencyMode === opt.val
                                        ? 'bg-brand-light dark:bg-brand/10 border-brand text-brand-dark dark:text-brand shadow-sm'
                                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </SectionCard>

            {/* Monedas COP */}
            <SectionCard icon={Coins} title="Peso Colombiano (COP)" subtitle="Habilitar pagos y calculos en COP" iconColor="text-amber-500">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Habilitar COP</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Pagos y calculos rapidos</p>
                    </div>
                    <Toggle
                        enabled={copEnabled}
                        color="amber"
                        onChange={() => {
                            const newVal = !copEnabled;
                            setCopEnabled(newVal);
                            localStorage.setItem('cop_enabled', newVal.toString());
                            forceHeartbeat();
                            showToast(newVal ? 'COP Habilitado' : 'COP Deshabilitado', 'success');
                            triggerHaptic?.();
                        }}
                    />
                </div>
                {copEnabled && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">COP como Moneda Principal</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Los precios se muestran primero en pesos</p>
                            </div>
                            <Toggle
                                enabled={copPrimary}
                                color="amber"
                                onChange={() => {
                                    const newVal = !copPrimary;
                                    setCopPrimary(newVal);
                                    localStorage.setItem('cop_primary', newVal.toString());
                                    triggerHaptic?.();
                                    showToast(newVal ? 'COP es moneda principal' : 'USD es moneda principal', 'success');
                                }}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Calcular Automaticamente</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">TRM Oficial + Binance USDT</p>
                            </div>
                            <Toggle
                                enabled={autoCopEnabled}
                                color="amber"
                                onChange={() => {
                                    const newVal = !autoCopEnabled;
                                    setAutoCopEnabled(newVal);
                                    localStorage.setItem('auto_cop_enabled', newVal.toString());
                                    triggerHaptic?.();
                                }}
                            />
                        </div>
                        <div>
                            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">
                                {autoCopEnabled ? 'Tasa Actual Calculada' : 'Tasa Manual (COP por 1 USD)'}
                            </label>
                            <input
                                type="number"
                                placeholder="Ej: 4150"
                                value={autoCopEnabled ? (calculatedTasaCop > 0 ? calculatedTasaCop.toFixed(2) : '') : tasaCopManual}
                                readOnly={autoCopEnabled}
                                onChange={e => {
                                    if (!autoCopEnabled) {
                                        setTasaCopManual(e.target.value);
                                        localStorage.setItem('tasa_cop', e.target.value);
                                    }
                                }}
                                className={`w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${autoCopEnabled ? 'text-slate-400 cursor-not-allowed bg-slate-100 dark:bg-slate-800/80' : 'text-amber-600 dark:text-amber-500'}`}
                            />
                            {autoCopEnabled && (
                                <p className="text-[10px] text-amber-650/80 dark:text-amber-400/80 mt-1.5 font-medium">Se actualiza automaticamente cada 30 segundos.</p>
                            )}
                        </div>
                    </div>
                )}
            </SectionCard>
        </div>
    );
}
