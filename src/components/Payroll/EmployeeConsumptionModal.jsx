/**
 * EmployeeConsumptionModal.jsx — Registrar consumo de empleado (v1).
 *
 * Props: { employeeId?, onClose, onDone, tasaBcv }
 * - Si no trae employeeId, muestra selector de empleados activos.
 * - Editor de items: buscar producto por nombre, cantidad, valida stock.
 * - Muestra total USD + % del sueldo que representa (proyectado con lo nuevo).
 * - Si excede el límite, exige checkbox "Autorizar excedente (override auditado)".
 *
 * Servicio asumido (src/services/payrollService.js):
 *   listEmployees() / getResumen(employeeId) -> {empleado, salarioUsd, consumidoUsd,
 *     pct, limitePct, periodo:{salarioSnapshot}} / registerConsumo({employeeId,
 *     items:[{productId,qty,priceUsd}], overrideLimite})
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Minus, Trash2, Loader2, ShoppingBag, AlertTriangle } from 'lucide-react';
import { Modal } from '../Modal';
import { showToast } from '../Toast';
import { formatUsd } from '../../utils/calculatorUtils';
import { useProductContext } from '../../context/ProductContext';
import { isGranelProduct, granelUnitLabel, parseCartQuantity, formatStockDisplay } from '../../utils/granel'; // GRANEL-001
import * as payroll from '../../services/payrollService';

/** Precio de venta del producto (misma regla que ProductContext). */
function precioVenta(p) {
    return (p.sellByUnit && p.unitPriceUsd > 0) ? p.unitPriceUsd : (p.priceUsdt || p.priceUsd || 0);
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 placeholder:text-slate-400 placeholder:font-semibold';
const labelCls = 'text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5 block';

export default function EmployeeConsumptionModal({ employeeId: fixedEmployeeId, onClose, onDone, tasaBcv }) {
    const { products } = useProductContext();
    const [employees, setEmployees] = useState([]);
    const [employeeId, setEmployeeId] = useState(fixedEmployeeId || '');
    const [resumen, setResumen] = useState(null);
    const [query, setQuery] = useState('');
    const [items, setItems] = useState([]); // {productId, nombre, qty, priceUsd, stock, isGranel, unitLabel}
    const [override, setOverride] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [editingQtyId, setEditingQtyId] = useState(null); // GRANEL-001: edición decimal
    const [tempQty, setTempQty] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const emps = await payroll.listEmployees().catch(() => []);
                setEmployees((Array.isArray(emps) ? emps : []).filter((e) => e.activo !== false));
            } finally { setLoading(false); }
        })();
    }, []);

    useEffect(() => {
        if (!employeeId) { setResumen(null); return; }
        (async () => {
            try { setResumen(await payroll.getResumen(employeeId, tasaBcv)); }
            catch { setResumen(null); }
        })();
    }, [employeeId]);

    const empleado = employees.find((e) => String(e.id) === String(employeeId)) || null;

    const resultados = useMemo(() => {
        const q = norm(query.trim());
        if (q.length < 2) return [];
        return (products || [])
            .filter((p) => norm(p.name).includes(q))
            .slice(0, 8);
    }, [query, products]);

    const addItem = (p) => {
        const price = precioVenta(p);
        if (price <= 0) { showToast('El producto no tiene precio de venta', 'warning'); return; }
        const stock = Number(p.stock ?? 0);
        const granel = isGranelProduct(p);
        const unitLabel = granel ? (granelUnitLabel(p) === 'UND' ? 'kg' : granelUnitLabel(p)) : 'un.';
        setItems((prev) => {
            const ex = prev.find((i) => String(i.productId) === String(p.id));
            if (ex) {
                if (ex.qty + 1 > stock) { showToast('Sin stock suficiente', 'warning'); return prev; }
                return prev.map((i) => String(i.productId) === String(p.id) ? { ...i, qty: i.qty + 1 } : i);
            }
            if (stock <= 0) { showToast('Sin stock suficiente', 'warning'); return prev; }
            return [...prev, { productId: p.id, nombre: p.name, qty: 1, priceUsd: price, stock, isGranel: granel, unitLabel }];
        });
        // GRANEL-001: al agregar un producto a granel, abrir el editor decimal de una vez.
        if (granel) {
            setEditingQtyId(p.id);
            setTempQty('1');
        }
        setQuery('');
    };

    const chQty = (productId, delta) => {
        setItems((prev) => prev
            .map((i) => {
                if (String(i.productId) !== String(productId)) return i;
                const nq = i.qty + delta;
                if (nq > i.stock) { showToast('Sin stock suficiente', 'warning'); return i; }
                return { ...i, qty: nq };
            })
            .filter((i) => i.qty > 0));
    };

    // GRANEL-001: editor decimal para productos a granel (hasta 3 decimales).
    const submitQty = (item) => {
        setEditingQtyId(null);
        if (!tempQty || tempQty.trim() === '') { setTempQty(''); return; }
        const parsed = parseCartQuantity(tempQty, true);
        if (parsed === null || parsed <= 0) {
            showToast('Cantidad inválida', 'warning');
            setTempQty('');
            return;
        }
        if (parsed > item.stock) {
            showToast('Sin stock suficiente', 'warning');
            setTempQty('');
            return;
        }
        setItems((prev) => prev.map((i) =>
            String(i.productId) === String(item.productId) ? { ...i, qty: parsed } : i));
        setTempQty('');
    };

    const total = items.reduce((s, i) => s + i.qty * i.priceUsd, 0);
    const salarioUsd = Number(resumen?.salarioUsd) || 0;
    const pctProyectado = salarioUsd > 0 ? ((Number(resumen?.totalConsumosUsd) || 0) + total) / salarioUsd * 100 : 0;
    const limite = Number(empleado?.limiteConsumoPorc ?? 100);
    const excede = salarioUsd > 0 && pctProyectado > limite;

    const submit = async () => {
        if (!employeeId) { showToast('Elige un empleado', 'warning'); return; }
        if (items.length === 0) { showToast('Agrega al menos un producto', 'warning'); return; }
        if (excede && !override) { showToast('El consumo excede el límite: autoriza el excedente para continuar', 'warning'); return; }
        setSaving(true);
        try {
            await payroll.registerConsumo({
                employeeId,
                items: items.map((i) => ({ productId: i.productId, qty: i.qty })),
                tasaBcv,
                overrideLimite: excede && override,
            });
            showToast('Consumo registrado', 'success');
            onDone && onDone();
        } catch (err) {
            showToast(err?.message || 'No se pudo registrar el consumo', 'error');
        } finally { setSaving(false); }
    };

    return (
        <Modal isOpen onClose={onClose} title="Registrar consumo" size="max-w-lg">
            {loading ? (
                <div className="flex items-center justify-center py-10">
                    <Loader2 size={24} className="animate-spin text-brand" />
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Empleado */}
                    {!fixedEmployeeId && (
                        <div>
                            <label className={labelCls}>Empleado</label>
                            <div className="max-h-36 overflow-y-auto custom-scrollbar space-y-1.5 border border-slate-200 dark:border-slate-700 rounded-2xl p-2">
                                {employees.length === 0 && (
                                    <p className="text-xs font-semibold text-slate-400 p-2">No hay empleados activos.</p>
                                )}
                                {employees.map((e) => (
                                    <button
                                        key={e.id}
                                        type="button"
                                        onClick={() => setEmployeeId(e.id)}
                                        className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-extrabold transition-all ${
                                            String(employeeId) === String(e.id)
                                                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                        }`}
                                    >
                                        {e.nombre}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {empleado && resumen && (
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl px-4 py-3 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-black text-slate-700 dark:text-slate-200">{empleado.nombre}</p>
                                <p className="text-[10px] font-semibold text-slate-400">
                                    Consumido: ${formatUsd(resumen.totalConsumosUsd)} de ${formatUsd(salarioUsd)} · Límite {limite}%
                                </p>
                            </div>
                            <span className="text-sm font-black text-brand">{Math.round(resumen.pct || 0)}%</span>
                        </div>
                    )}

                    {/* Buscador de productos */}
                    <div>
                        <label className={labelCls}>Agregar producto</label>
                        <div className="relative">
                            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input className={`${inputCls} pl-11`} value={query} onChange={(e) => setQuery(e.target.value)}
                                placeholder="Buscar por nombre…" />
                        </div>
                        {resultados.length > 0 && (
                            <div className="mt-1.5 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                                {resultados.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => addItem(p)}
                                        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <span className="min-w-0">
                                            <span className="block text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{p.name}</span>
                                            <span className="block text-[10px] font-semibold text-slate-400">Stock: {p.stock ?? 0}</span>
                                        </span>
                                        <span className="shrink-0 text-sm font-black text-slate-800 dark:text-white">${formatUsd(precioVenta(p))}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Items */}
                    {items.length > 0 && (
                        <div>
                            <label className={labelCls}>Productos ({items.length})</label>
                            <div className="space-y-1.5">
                                {items.map((i) => (
                                    <div key={i.productId} className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded-2xl px-3 py-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{i.nombre}</p>
                                            <p className="text-[10px] font-semibold text-slate-400">${formatUsd(i.priceUsd)} c/u</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {i.isGranel ? (
                                                editingQtyId === i.productId ? (
                                                    <input
                                                        autoFocus
                                                        inputMode="decimal"
                                                        className="w-20 text-center text-sm font-black text-slate-800 dark:text-white bg-slate-50 dark:bg-slate-800 border border-brand/50 rounded-xl px-2 py-1.5 outline-none"
                                                        value={tempQty}
                                                        onChange={(e) => setTempQty(e.target.value)}
                                                        onBlur={() => submitQty(i)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') submitQty(i); if (e.key === 'Escape') { setEditingQtyId(null); setTempQty(''); } }}
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => { setEditingQtyId(i.productId); setTempQty(formatStockDisplay(i.qty, true)); }}
                                                        className="min-w-[4.5rem] text-center text-sm font-black text-slate-800 dark:text-white bg-slate-50 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl px-2 py-1.5 active:scale-95 transition-all"
                                                        title="Tocar para editar cantidad"
                                                    >
                                                        {formatStockDisplay(i.qty, true)} <span className="text-[10px] font-bold text-slate-400">{i.unitLabel}</span>
                                                    </button>
                                                )
                                            ) : (
                                                <>
                                                    <button type="button" onClick={() => chQty(i.productId, -1)}
                                                        className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-200 active:scale-90 transition-all">
                                                        <Minus size={14} />
                                                    </button>
                                                    <span className="w-8 text-center text-sm font-black text-slate-800 dark:text-white">{i.qty}</span>
                                                    <button type="button" onClick={() => chQty(i.productId, 1)}
                                                        className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-200 active:scale-90 transition-all">
                                                        <Plus size={14} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                        <span className="w-20 text-right text-sm font-black text-slate-800 dark:text-white">${formatUsd(i.qty * i.priceUsd)}</span>
                                        <button type="button" onClick={() => setItems((prev) => prev.filter((x) => String(x.productId) !== String(i.productId)))}
                                            className="p-2 rounded-xl text-slate-400 hover:text-red-500 transition-colors">
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Totales */}
                    <div className="bg-slate-900 dark:bg-white rounded-3xl p-4 flex items-center justify-between">
                        <div>
                            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">Total</p>
                            <p className="text-xl font-black text-white dark:text-slate-900">${formatUsd(total)}</p>
                        </div>
                        {salarioUsd > 0 && (
                            <div className="text-right">
                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">Del sueldo</p>
                                <p className={`text-xl font-black ${excede ? 'text-red-400' : 'text-white dark:text-slate-900'}`}>
                                    {Math.round(pctProyectado)}%
                                </p>
                            </div>
                        )}
                    </div>

                    {excede && (
                        <label className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-3 cursor-pointer">
                            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)}
                                className="mt-0.5 w-4 h-4 accent-amber-500" />
                            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                                <AlertTriangle size={13} className="inline mr-1" />
                                Autorizar excedente (override auditado): supera el límite de {limite}% del sueldo.
                            </span>
                        </label>
                    )}

                    <button onClick={submit} disabled={saving || !employeeId || items.length === 0}
                        className="w-full py-3.5 rounded-3xl text-sm font-extrabold bg-brand text-white shadow-md active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <ShoppingBag size={16} />}
                        Registrar consumo
                    </button>
                </div>
            )}
        </Modal>
    );
}
