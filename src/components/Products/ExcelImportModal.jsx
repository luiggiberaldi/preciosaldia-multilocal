import React, { useState, useRef } from 'react';
import { Modal } from '../Modal';
import {
    FileSpreadsheet, Upload, AlertTriangle, CheckCircle2, Package,
    Copy, TrendingDown, CircleDollarSign, Tag, X, Loader2, Info,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { mapInventarioRows } from '../../utils/excelImport';

// EXCEL-IMPORT-001: importar inventario desde Excel a la sede (negocio) activa.
// Flujo: elegir archivo -> vista previa (stats + advertencias + muestra) ->
// confirmar -> resultado. Nunca toca otra sede: el padre persiste con la clave
// ya prefijada por negocio (storageService).
const Stat = ({ icon: Icon, label, value, tone }) => {
    const tones = {
        blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
        amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
        red: 'bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400',
        slate: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
        emerald: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    };
    return (
        <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}>
                <Icon size={15} strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
                <p className="text-sm font-black text-slate-800 dark:text-white leading-none">{value}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">{label}</p>
            </div>
        </div>
    );
};

export default function ExcelImportModal({
    isOpen, onClose, sedeNombre, existentes = 0, effectiveRate = 1, onImport,
}) {
    const [paso, setPaso] = useState('elegir'); // elegir | preview | done
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);
    const [datos, setDatos] = useState(null); // {products, stats}
    const [nombreArchivo, setNombreArchivo] = useState('');
    const [modo, setModo] = useState('agregar'); // agregar | reemplazar
    const [resultado, setResultado] = useState(null);
    const inputRef = useRef(null);

    const reset = () => {
        setPaso('elegir'); setError(null); setDatos(null);
        setNombreArchivo(''); setResultado(null); setModo('agregar');
        if (inputRef.current) inputRef.current.value = '';
    };
    const cerrar = () => { reset(); onClose(); };

    const leerArchivo = (file) => {
        if (!file) return;
        setCargando(true); setError(null);
        setNombreArchivo(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const wb = XLSX.read(e.target.result, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
                const r = mapInventarioRows(filas, { effectiveRate });
                if (r.error) { setError(r.error); setPaso('elegir'); }
                else { setDatos(r); setPaso('preview'); }
            } catch (err) {
                setError('No se pudo leer el archivo. Verifica que sea un Excel válido (.xlsx).');
                setPaso('elegir');
            } finally { setCargando(false); }
        };
        reader.onerror = () => {
            setError('No se pudo leer el archivo.');
            setCargando(false); setPaso('elegir');
        };
        reader.readAsArrayBuffer(file);
    };

    const confirmar = async () => {
        if (!datos) return;
        setCargando(true);
        try {
            const res = await onImport(datos.products, modo);
            setResultado(res);
            setPaso('done');
        } catch (err) {
            setError('Ocurrió un error al guardar. Inténtalo de nuevo.');
        } finally { setCargando(false); }
    };

    const stats = datos?.stats;
    const advertencias = [];
    if (stats) {
        if (stats.duplicadosSinCodigo > 0)
            advertencias.push(`${stats.duplicadosSinCodigo} productos tenían código repetido: se importan sin código para no cobrar mal en el POS.`);
        if (stats.negativos > 0)
            advertencias.push(`${stats.negativos} productos con existencia negativa: se importan tal cual, revísalos en el informe.`);
        if (stats.decimalesRedondeados > 0)
            advertencias.push(`${stats.decimalesRedondeados} existencias con decimales se redondearon a entero.`);
        if (stats.precioCero > 0)
            advertencias.push(`${stats.precioCero} productos con precio $0: ponles precio antes de vender.`);
        if (stats.omitidos > 0)
            advertencias.push(`${stats.omitidos} filas vacías se omitieron.`);
    }

    return (
        <Modal isOpen={isOpen} onClose={cerrar} title="Importar Excel" size="max-w-lg">
            {paso === 'elegir' && (
                <div className="space-y-4">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        Carga el inventario de la sede <b className="text-slate-900 dark:text-white">{sedeNombre}</b>.
                        El archivo debe tener las columnas <b>PRODUCTO</b>, <b>CODIGO</b>, <b>VENTA USD</b> y <b>EXISTENCIA</b>.
                    </p>
                    <label
                        className="flex flex-col items-center justify-center gap-2 p-8 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-600 bg-slate-50 dark:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                        <input
                            ref={inputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            onChange={(e) => leerArchivo(e.target.files?.[0])}
                        />
                        {cargando
                            ? <Loader2 size={28} className="text-emerald-500 animate-spin" />
                            : <FileSpreadsheet size={28} className="text-emerald-500" />}
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                            {cargando ? 'Leyendo archivo…' : 'Toca para elegir el Excel'}
                        </span>
                        <span className="text-[11px] text-slate-400">.xlsx · la primera hoja</span>
                    </label>
                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40">
                            <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    )}
                </div>
            )}

            {paso === 'preview' && stats && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <FileSpreadsheet size={14} className="text-emerald-500" />
                        <span className="truncate font-semibold">{nombreArchivo}</span>
                        <button
                            type="button"
                            onClick={reset}
                            className="ml-auto text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline underline-offset-2 shrink-0"
                        >
                            Cambiar archivo
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Stat icon={Package} label="Productos a importar" value={stats.importados} tone="blue" />
                        <Stat icon={Copy} label="Duplicados sin código" value={stats.duplicadosSinCodigo} tone="amber" />
                        <Stat icon={TrendingDown} label="En negativo" value={stats.negativos} tone="red" />
                        <Stat icon={CircleDollarSign} label="Con precio $0" value={stats.precioCero} tone="slate" />
                    </div>

                    {advertencias.length > 0 && (
                        <div className="space-y-1.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40">
                            {advertencias.map((a, i) => (
                                <div key={i} className="flex items-start gap-2">
                                    <Info size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">{a}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {existentes > 0 && (
                        <div>
                            <p className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">
                                Esta sede ya tiene {existentes} productos. ¿Cómo importamos?
                            </p>
                            <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800">
                                {[
                                    { id: 'agregar', t: 'Agregar', d: 'Suma sin borrar nada' },
                                    { id: 'reemplazar', t: 'Reemplazar', d: 'Borra el inventario actual' },
                                ].map((o) => (
                                    <button
                                        key={o.id}
                                        type="button"
                                        onClick={() => setModo(o.id)}
                                        className={`p-2.5 rounded-xl text-left transition-all ${
                                            modo === o.id
                                                ? 'bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-700'
                                                : 'border border-transparent opacity-60 hover:opacity-100'
                                        }`}
                                    >
                                        <p className={`text-xs font-black ${modo === o.id ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{o.t}</p>
                                        <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{o.d}</p>
                                    </button>
                                ))}
                            </div>
                            {modo === 'reemplazar' && (
                                <p className="flex items-start gap-1.5 mt-2 text-[11px] text-red-600 dark:text-red-400">
                                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                                    Se eliminarán los {existentes} productos actuales de {sedeNombre}.
                                </p>
                            )}
                        </div>
                    )}

                    <div>
                        <p className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">Muestra (primeros 8)</p>
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                            {datos.products.slice(0, 8).map((p) => (
                                <div key={p.id} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800/60 last:border-0 text-xs">
                                    <span className="flex-1 truncate font-semibold text-slate-700 dark:text-slate-200">{p.name}</span>
                                    {p.barcode
                                        ? <span className="font-mono text-[10px] text-slate-400">{p.barcode}</span>
                                        : <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">sin código</span>}
                                    <span className="font-bold text-slate-700 dark:text-slate-200 w-14 text-right">${p.priceUsd}</span>
                                    <span className={`w-12 text-right font-bold ${p.stock < 0 ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>{p.stock}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={confirmar}
                        disabled={cargando || stats.importados === 0}
                        className="w-full flex items-center justify-center gap-2 p-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-black transition-all active:scale-[0.98]"
                    >
                        {cargando ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} strokeWidth={2.5} />}
                        {cargando ? 'Importando…' : `Importar ${stats.importados} productos a ${sedeNombre}`}
                    </button>
                </div>
            )}

            {paso === 'done' && resultado && (
                <div className="space-y-4 text-center py-4">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-500 flex items-center justify-center mx-auto">
                        <CheckCircle2 size={28} strokeWidth={2.2} />
                    </div>
                    <div>
                        <p className="text-base font-black text-slate-900 dark:text-white">Importación completa</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {resultado.importados} productos en <b>{sedeNombre}</b>
                            {resultado.omitidosExistentes > 0 && ` · ${resultado.omitidosExistentes} omitidos (código ya existía)`}
                            {resultado.eliminados > 0 && ` · ${resultado.eliminados} anteriores eliminados`}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={cerrar}
                        className="w-full p-3.5 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black transition-all active:scale-[0.98]"
                    >
                        Ver inventario
                    </button>
                </div>
            )}
        </Modal>
    );
}
