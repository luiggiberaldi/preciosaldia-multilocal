/**
 * NominaView.jsx — Zona de Nómina (v1).
 *
 * SOLO DUEÑO: el nav ya filtra el tab ('nomina' solo en TABS_DUENO); aquí se
 * re-valida con isOwner() y se muestra "Acceso restringido" si no lo es.
 *
 * Pestañas internas: Resumen | Empleados | Historial.
 *
 * Servicio asumido (src/services/payrollService.js):
 *   listEmployees() -> [{id,nombre,cedula,cargo,salarioMonto,salarioMoneda:'USD'|'Bs',
 *     frecuenciaPago:'semanal'|'quincenal'|'mensual',limiteConsumoPorc,activo}]
 *   createEmployee(data) / updateEmployee(id,data) / deactivateEmployee(id)
 *   registerConsumo({employeeId, items:[{productId,qty,priceUsd}], overrideLimite}) -> consumo
 *   anularConsumo(consumoId, motivo)
 *   getResumen(employeeId) -> {empleado, periodo:{key,frecuencia,inicioISO,finISO,
 *     salarioSnapshot:{monto,moneda}|null}, salarioUsd, consumidoUsd, pct, netoUsd,
 *     consumos, limitePct, liquidacion|null}
 *   liquidar(employeeId) -> liquidacion
 *   listConsumos(employeeId?) -> [{id,employeeId,employeeNombre,timestamp,
 *     items:[{nombre,qty,priceUsd}],totalUsd,status:'APPLIED'|'VOIDED',settlementId,actor}]
 *   listLiquidaciones(employeeId?) -> [liquidacion]
 *
 * UI: todo redondeado, sin <select> nativo (píldoras), sin alert/confirm/prompt,
 * iconos lucide, dark mode con dark:.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Users, Wallet, History, Plus, Pencil, Ban, Receipt, ShoppingBag,
    Loader2, ShieldAlert, X,
} from 'lucide-react';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { isOwner } from '../utils/roles';
import { Modal } from '../components/Modal';
import { showToast } from '../components/Toast';
import { formatUsd } from '../utils/calculatorUtils';
import * as payroll from '../services/payrollService';
import EmployeeConsumptionModal from '../components/Payroll/EmployeeConsumptionModal';
import PayrollReceiptModal from '../components/Payroll/PayrollReceiptModal';

const FREC_LABEL = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' };
const FRECS = ['semanal', 'quincenal', 'mensual'];

/** Semáforo de % consumido: <70 verde, 70-99 ámbar, >=100 rojo. */
function semaforo(pct) {
    if (pct >= 100) return 'rojo';
    if (pct >= 70) return 'ambar';
    return 'verde';
}
const SEM_TONE = {
    verde: { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
    ambar: { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', chip: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
    rojo: { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400', chip: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
};

const fmtFecha = (ts) => {
    try {
        return new Date(ts).toLocaleString('es-VE', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return ''; }
};

const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 placeholder:text-slate-400 placeholder:font-semibold';
const labelCls = 'text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5 block';

function Pill({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`px-4 py-2.5 rounded-full text-xs font-extrabold transition-all outline-none focus:ring-2 focus:ring-brand/50 ${
                active
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
                    : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200/70 dark:border-slate-800'
            }`}
        >
            {children}
        </button>
    );
}

/* ─── Formulario de empleado (crear / editar) ─────────────────────────── */
function EmployeeForm({ initial, onSave, onCancel, saving }) {
    const [form, setForm] = useState(() => ({
        nombre: initial?.nombre || '',
        cedula: initial?.cedula || '',
        cargo: initial?.cargo || '',
        salarioMonto: initial?.salarioMonto ?? '',
        salarioMoneda: initial?.salarioMoneda || 'USD',
        frecuenciaPago: initial?.frecuenciaPago || 'semanal',
        limiteConsumoPorc: initial?.limiteConsumoPorc ?? 100,
    }));
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const submit = () => {
        const monto = Number(form.salarioMonto);
        if (!form.nombre.trim()) { showToast('El nombre es obligatorio', 'warning'); return; }
        if (!Number.isFinite(monto) || monto <= 0) { showToast('El salario debe ser mayor a cero', 'warning'); return; }
        const limite = Number(form.limiteConsumoPorc);
        if (!Number.isFinite(limite) || limite <= 0) { showToast('El límite % debe ser mayor a cero', 'warning'); return; }
        onSave({
            nombre: form.nombre.trim(),
            cedula: form.cedula.trim(),
            cargo: form.cargo.trim(),
            salarioMonto: monto,
            salarioMoneda: form.salarioMoneda,
            frecuenciaPago: form.frecuenciaPago,
            limiteConsumoPorc: limite,
        });
    };

    return (
        <div className="space-y-4">
            <div>
                <label className={labelCls}>Nombre *</label>
                <input className={inputCls} value={form.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Nombre del empleado" />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={labelCls}>Cédula</label>
                    <input className={inputCls} value={form.cedula} onChange={(e) => set('cedula', e.target.value)} placeholder="Opcional" />
                </div>
                <div>
                    <label className={labelCls}>Cargo</label>
                    <input className={inputCls} value={form.cargo} onChange={(e) => set('cargo', e.target.value)} placeholder="Opcional" />
                </div>
            </div>
            <div>
                <label className={labelCls}>Salario (por período) *</label>
                <div className="flex gap-2">
                    <input type="number" min="0" step="any" className={inputCls} value={form.salarioMonto}
                        onChange={(e) => set('salarioMonto', e.target.value)} placeholder="0.00" />
                    <div className="flex gap-1.5 shrink-0">
                        {['USD', 'Bs'].map((m) => (
                            <Pill key={m} active={form.salarioMoneda === m} onClick={() => set('salarioMoneda', m)}>{m === 'USD' ? '$' : 'Bs'}</Pill>
                        ))}
                    </div>
                </div>
            </div>
            <div>
                <label className={labelCls}>Frecuencia de pago</label>
                <div className="flex gap-1.5 flex-wrap">
                    {FRECS.map((f) => (
                        <Pill key={f} active={form.frecuenciaPago === f} onClick={() => set('frecuenciaPago', f)}>{FREC_LABEL[f]}</Pill>
                    ))}
                </div>
            </div>
            <div>
                <label className={labelCls}>Límite de consumo (% del sueldo)</label>
                <input type="number" min="1" step="any" className={inputCls} value={form.limiteConsumoPorc}
                    onChange={(e) => set('limiteConsumoPorc', e.target.value)} placeholder="100" />
            </div>
            <div className="flex gap-2 pt-1">
                <button onClick={onCancel} className="flex-1 py-3 rounded-2xl text-sm font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 active:scale-95 transition-all">
                    Cancelar
                </button>
                <button onClick={submit} disabled={saving}
                    className="flex-1 py-3 rounded-2xl text-sm font-extrabold bg-brand text-white shadow-md active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {saving && <Loader2 size={15} className="animate-spin" />}
                    {initial ? 'Guardar cambios' : 'Crear empleado'}
                </button>
            </div>
        </div>
    );
}

/* ─── Tarjeta de resumen por empleado ─────────────────────────────────── */
function ResumenCard({ resumen, liquidaciones, onConsumo, onLiquidar, onRecibo, triggerHaptic }) {
    const { empleado, periodo, salarioUsd, consumidoUsd, pct, netoUsd, consumos, limitePct, liquidacion } = resumen;
    const sem = semaforo(pct || 0);
    const tone = SEM_TONE[sem];
    const liq = liquidacion || liquidaciones.find((l) => l.employeeId === empleado.id && l.periodoKey === periodo?.key);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                    <p className="font-black text-slate-800 dark:text-white truncate">{empleado.nombre}</p>
                    <p className="text-[11px] font-semibold text-slate-400">
                        Sueldo del período: <span className="font-extrabold text-slate-600 dark:text-slate-200">
                            {empleado.salarioMoneda === 'USD' ? `$${formatUsd(empleado.salarioMonto)}` : `Bs ${formatUsd(empleado.salarioMonto)}`}
                        </span>
                        {' · '}{FREC_LABEL[empleado.frecuenciaPago] || empleado.frecuenciaPago}
                        {periodo?.salarioSnapshot && (
                            <span className="text-slate-400"> (congelado)</span>
                        )}
                    </p>
                </div>
                <span className={`shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full ${tone.chip}`}>
                    {Math.round(pct || 0)}%
                </span>
            </div>

            <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden my-3">
                <div className={`h-full rounded-full transition-all ${tone.bar}`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl py-2">
                    <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Consumido</p>
                    <p className={`text-sm font-black ${tone.text}`}>${formatUsd(consumidoUsd)}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl py-2">
                    <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Neto</p>
                    <p className="text-sm font-black text-slate-800 dark:text-white">${formatUsd(netoUsd)}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl py-2">
                    <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Consumos</p>
                    <p className="text-sm font-black text-slate-800 dark:text-white">{consumos ?? 0}</p>
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); onConsumo(empleado.id); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-extrabold bg-slate-900 dark:bg-white text-white dark:text-slate-900 active:scale-95 transition-all"
                >
                    <ShoppingBag size={14} /> Consumo
                </button>
                {liq ? (
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); onRecibo(liq, empleado); }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-extrabold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 active:scale-95 transition-all"
                    >
                        <Receipt size={14} /> Recibo
                    </button>
                ) : (
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); onLiquidar(empleado.id); }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-extrabold bg-brand text-white shadow-md active:scale-95 transition-all"
                    >
                        <Wallet size={14} /> Liquidar
                    </button>
                )}
            </div>
            {limitePct != null && (
                <p className="text-[10px] font-semibold text-slate-400 mt-2 text-center">Límite: {limitePct}% del sueldo</p>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════ */
export default function NominaView({ rates, triggerHaptic, isActive }) {
    const tasaBcv = Number(rates?.bcv?.price) || 0;
    const session = useAuthStore.getState().usuarioActivo;
    const owner = isOwner(session);

    const [tab, setTab] = useState('resumen'); // resumen | empleados | historial
    const [employees, setEmployees] = useState([]);
    const [resumenes, setResumenes] = useState({});
    const [consumos, setConsumos] = useState([]);
    const [liquidaciones, setLiquidaciones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filtroEmp, setFiltroEmp] = useState('todos');

    const [showEmpForm, setShowEmpForm] = useState(false);
    const [editingEmp, setEditingEmp] = useState(null);
    const [savingEmp, setSavingEmp] = useState(false);

    const [showConsumo, setShowConsumo] = useState(false);
    const [consumoEmpId, setConsumoEmpId] = useState(null);

    const [reciboData, setReciboData] = useState(null); // {liquidacion, empleado, periodo}
    const [confirmLiq, setConfirmLiq] = useState(null); // employeeId
    const [liqBusy, setLiqBusy] = useState(false);

    const [anularTarget, setAnularTarget] = useState(null); // consumo
    const [motivo, setMotivo] = useState('');
    const [anularBusy, setAnularBusy] = useState(false);

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const emps = await payroll.listEmployees().catch(() => []);
            const list = Array.isArray(emps) ? emps : [];
            setEmployees(list);
            const res = {};
            for (const e of list) {
                try { res[e.id] = await payroll.getResumen(e.id, tasaBcv); }
                catch (err) {
                    // E2E 2026-10-03: no tragar el error en silencio; sin esto el
                    // Resumen muestra "Sin movimientos" sin pista de la causa.
                    console.error('[Nomina] getResumen falló para', e?.id, err);
                    showToast(`No se pudo cargar el resumen de ${e?.nombre || 'empleado'}`, 'error');
                }
            }
            setResumenes(res);
            setConsumos(await payroll.listConsumos().catch(() => []));
            setLiquidaciones(await payroll.listLiquidaciones().catch(() => []));
        } catch (err) {
            showToast('Error cargando nómina', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (isActive && owner) cargar(); }, [isActive, owner, cargar]);

    /* Todos los hooks ANTES de cualquier early return (reglas de hooks de React:
       un hook después de un return condicional causa el error #310 si `owner`
       cambia entre renders). */
    const consumosFiltrados = useMemo(() => {
        const list = [...(consumos || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (filtroEmp === 'todos') return list;
        return list.filter((c) => String(c.employeeId) === String(filtroEmp));
    }, [consumos, filtroEmp]);

    /* ── Acceso restringido (re-validación; el nav ya filtra) ── */
    if (!owner) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 px-6 text-center">
                <div className="w-14 h-14 rounded-3xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <ShieldAlert size={26} className="text-red-500" />
                </div>
                <p className="font-black text-slate-800 dark:text-white">Acceso restringido</p>
                <p className="text-xs font-semibold text-slate-400">La Zona de Nómina es solo para el dueño.</p>
            </div>
        );
    }

    /* ── Acciones ── */
    const handleSaveEmp = async (data) => {
        setSavingEmp(true);
        try {
            if (editingEmp) await payroll.updateEmployee(editingEmp.id, data);
            else await payroll.createEmployee(data);
            showToast(editingEmp ? 'Empleado actualizado' : 'Empleado creado', 'success');
            setShowEmpForm(false); setEditingEmp(null);
            cargar();
        } catch (err) {
            showToast(err?.message || 'No se pudo guardar el empleado', 'error');
        } finally { setSavingEmp(false); }
    };

    const handleDeactivate = async (emp) => {
        try {
            await payroll.deactivateEmployee(emp.id);
            showToast('Empleado desactivado', 'success');
            cargar();
        } catch (err) {
            showToast(err?.message || 'No se pudo desactivar', 'error');
        }
    };

    const doLiquidar = async () => {
        if (!confirmLiq) return;
        setLiqBusy(true);
        try {
            const { liquidacion: liq } = await payroll.liquidar({ employeeId: confirmLiq, tasaBcv });
            const emp = employees.find((e) => e.id === confirmLiq);
            const per = resumenes[confirmLiq]?.periodo || null;
            showToast('Período liquidado', 'success');
            setConfirmLiq(null);
            await cargar();
            if (liq) setReciboData({ liquidacion: liq, empleado: emp || null, periodo: per });
        } catch (err) {
            showToast(err?.message || 'No se pudo liquidar', 'error');
        } finally { setLiqBusy(false); }
    };

    const doAnular = async () => {
        if (!anularTarget) return;
        if (!motivo.trim()) { showToast('Indica el motivo de la anulación', 'warning'); return; }
        setAnularBusy(true);
        try {
            await payroll.anularConsumo(anularTarget.id, motivo.trim());
            showToast('Consumo anulado', 'success');
            setAnularTarget(null); setMotivo('');
            cargar();
        } catch (err) {
            showToast(err?.message || 'No se pudo anular', 'error');
        } finally { setAnularBusy(false); }
    };

    const activos = employees.filter((e) => e.activo !== false);

    const TABS = [
        { id: 'resumen', label: 'Resumen', icon: Wallet },
        { id: 'empleados', label: 'Empleados', icon: Users },
        { id: 'historial', label: 'Historial', icon: History },
    ];

    return (
        <div className="pt-4 pb-8 px-1">
            {/* Pestañas internas */}
            <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 pt-1 px-1 -mx-1">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => { triggerHaptic && triggerHaptic(); setTab(id); }}
                        className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-extrabold transition-all outline-none focus:ring-2 focus:ring-brand/50 ${
                            tab === id
                                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
                                : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200/70 dark:border-slate-800'
                        }`}
                    >
                        <Icon size={13} /> {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 size={28} className="animate-spin text-brand" />
                    <p className="text-xs font-bold text-slate-400">Cargando nómina…</p>
                </div>
            ) : (
                <>
                    {/* ── RESUMEN ── */}
                    {tab === 'resumen' && (
                        <div className="space-y-3">
                            {activos.length === 0 ? (
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-8 sm:p-10 text-center">
                                    <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-light dark:bg-brand/10 flex items-center justify-center mb-3">
                                        <Users size={26} className="text-brand" />
                                    </div>
                                    <p className="text-base font-black text-slate-700 dark:text-white">Sin empleados registrados</p>
                                    <p className="text-xs font-semibold text-slate-400 mt-1 mb-4 max-w-[240px] mx-auto">Registra a tu equipo para llevar sus consumos y liquidar su nómina desde aquí.</p>
                                    <button
                                        onClick={() => { triggerHaptic && triggerHaptic(); setTab('empleados'); setShowEmpForm(true); }}
                                        className="px-5 py-2.5 rounded-full bg-brand text-white text-xs font-black shadow-md shadow-brand/30 active:scale-95 transition-all"
                                    >
                                        + Crear empleado
                                    </button>
                                </div>
                            ) : activos.map((emp) => resumenes[emp.id] ? (
                                <ResumenCard
                                    key={emp.id}
                                    resumen={resumenes[emp.id]}
                                    liquidaciones={liquidaciones}
                                    triggerHaptic={triggerHaptic}
                                    onConsumo={(id) => { setConsumoEmpId(id); setShowConsumo(true); }}
                                    onLiquidar={(id) => setConfirmLiq(id)}
                                    onRecibo={(liq, empleado) => {
                                        const per = resumenes[empleado.id]?.periodo || null;
                                        setReciboData({ liquidacion: liq, empleado, periodo: per });
                                    }}
                                />
                            ) : (
                                <div key={emp.id} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4">
                                    <p className="font-black text-slate-800 dark:text-white">{emp.nombre}</p>
                                    <p className="text-[11px] font-semibold text-slate-400">Sin movimientos este período</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── EMPLEADOS ── */}
                    {tab === 'empleados' && (
                        <div className="space-y-3">
                            <button
                                onClick={() => { triggerHaptic && triggerHaptic(); setEditingEmp(null); setShowEmpForm(true); }}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-3xl text-sm font-extrabold bg-brand text-white shadow-md active:scale-[0.98] transition-all"
                            >
                                <Plus size={16} /> Nuevo empleado
                            </button>
                            {employees.length === 0 ? (
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
                                    <Users size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                                    <p className="text-sm font-extrabold text-slate-500 dark:text-slate-400">Aún no hay empleados</p>
                                </div>
                            ) : employees.map((emp) => (
                                <div key={emp.id} className={`bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4 shadow-sm ${emp.activo === false ? 'opacity-60' : ''}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-black text-slate-800 dark:text-white truncate">{emp.nombre}</p>
                                            <p className="text-[11px] font-semibold text-slate-400">
                                                {[emp.cedula, emp.cargo].filter(Boolean).join(' · ') || 'Sin datos'}
                                            </p>
                                            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-300 mt-1">
                                                {emp.salarioMoneda === 'Bs' ? `Bs ${formatUsd(emp.salarioMonto)}` : `$${formatUsd(emp.salarioMonto)}`}
                                                {' · '}{FREC_LABEL[emp.frecuenciaPago] || emp.frecuenciaPago}
                                                {' · '}Límite {emp.limiteConsumoPorc ?? 100}%
                                            </p>
                                        </div>
                                        <span className={`shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full ${emp.activo === false
                                            ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                                            : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'}`}>
                                            {emp.activo === false ? 'Inactivo' : 'Activo'}
                                        </span>
                                    </div>
                                    {emp.activo !== false && (
                                        <div className="flex gap-2 mt-3">
                                            <button
                                                onClick={() => { triggerHaptic && triggerHaptic(); setEditingEmp(emp); setShowEmpForm(true); }}
                                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 active:scale-95 transition-all"
                                            >
                                                <Pencil size={13} /> Editar
                                            </button>
                                            <button
                                                onClick={() => { triggerHaptic && triggerHaptic(); setConsumoEmpId(emp.id); setShowConsumo(true); }}
                                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-extrabold bg-slate-900 dark:bg-white text-white dark:text-slate-900 active:scale-95 transition-all"
                                            >
                                                <ShoppingBag size={13} /> Consumo
                                            </button>
                                            <button
                                                onClick={() => { triggerHaptic && triggerHaptic(); handleDeactivate(emp); }}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-extrabold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 active:scale-95 transition-all"
                                            >
                                                <Ban size={13} /> Desactivar
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── HISTORIAL ── */}
                    {tab === 'historial' && (
                        <div className="space-y-3">
                            <div className="flex gap-1.5 overflow-x-auto pb-1">
                                <Pill active={filtroEmp === 'todos'} onClick={() => setFiltroEmp('todos')}>Todos</Pill>
                                {employees.map((e) => (
                                    <Pill key={e.id} active={String(filtroEmp) === String(e.id)} onClick={() => setFiltroEmp(e.id)}>
                                        {e.nombre}
                                    </Pill>
                                ))}
                            </div>
                            {consumosFiltrados.length === 0 ? (
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
                                    <History size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                                    <p className="text-sm font-extrabold text-slate-500 dark:text-slate-400">Sin consumos</p>
                                </div>
                            ) : consumosFiltrados.map((c) => {
                                const anulable = c.status === 'APPLIED' && !c.settlementId;
                                return (
                                    <div key={c.id} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4 shadow-sm">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="font-black text-slate-800 dark:text-white text-sm truncate">{c.employeeNombre || 'Empleado'}</p>
                                                <p className="text-[11px] font-semibold text-slate-400">{fmtFecha(c.timestamp)}</p>
                                                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 mt-1">
                                                    {(c.items || []).slice(0, 3).map((it) => `${it.qty}× ${it.nombre}`).join(', ')}
                                                    {(c.items || []).length > 3 && ` +${(c.items || []).length - 3} más`}
                                                </p>
                                                <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                                                    Registró: {c.actor || '—'}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="font-black text-slate-800 dark:text-white">${formatUsd(c.totalUsd)}</p>
                                                <span className={`inline-block mt-1 text-[10px] font-black px-2 py-0.5 rounded-full ${
                                                    c.status === 'VOIDED'
                                                        ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                                                        : c.settlementId
                                                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                                            : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                                }`}>
                                                    {c.status === 'VOIDED' ? 'Anulado' : c.settlementId ? 'Liquidado' : 'Aplicado'}
                                                </span>
                                            </div>
                                        </div>
                                        {anulable && (
                                            <button
                                                onClick={() => { triggerHaptic && triggerHaptic(); setAnularTarget(c); setMotivo(''); }}
                                                className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-extrabold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 active:scale-95 transition-all"
                                            >
                                                <X size={13} /> Anular consumo
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {/* ── Modal empleado ── */}
            <Modal isOpen={showEmpForm} onClose={() => { setShowEmpForm(false); setEditingEmp(null); }}
                title={editingEmp ? 'Editar empleado' : 'Nuevo empleado'} size="max-w-md">
                <EmployeeForm initial={editingEmp} saving={savingEmp} onSave={handleSaveEmp}
                    onCancel={() => { setShowEmpForm(false); setEditingEmp(null); }} />
            </Modal>

            {/* ── Modal registrar consumo ── */}
            {showConsumo && (
                <EmployeeConsumptionModal
                    employeeId={consumoEmpId}
                    tasaBcv={tasaBcv}
                    onClose={() => { setShowConsumo(false); setConsumoEmpId(null); }}
                    onDone={() => { setShowConsumo(false); setConsumoEmpId(null); cargar(); }}
                />
            )}

            {/* ── Confirmar liquidación ── */}
            <Modal isOpen={!!confirmLiq} onClose={() => setConfirmLiq(null)} title="Liquidar período" size="max-w-sm">
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-300 mb-1">
                    Se pagará el neto del período actual a:
                </p>
                <p className="font-black text-slate-800 dark:text-white mb-4">
                    {employees.find((e) => e.id === confirmLiq)?.nombre}
                    {resumenes[confirmLiq] && (
                        <span className="text-brand"> · ${formatUsd(resumenes[confirmLiq].netoUsd)}</span>
                    )}
                </p>
                <p className="text-[11px] font-semibold text-slate-400 mb-4">
                    Se genera el egreso de caja y los consumos quedan marcados como liquidados (no se pueden anular después).
                </p>
                <div className="flex gap-2">
                    <button onClick={() => setConfirmLiq(null)}
                        className="flex-1 py-3 rounded-2xl text-sm font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 active:scale-95 transition-all">
                        Cancelar
                    </button>
                    <button onClick={doLiquidar} disabled={liqBusy}
                        className="flex-1 py-3 rounded-2xl text-sm font-extrabold bg-brand text-white shadow-md active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                        {liqBusy && <Loader2 size={15} className="animate-spin" />}
                        Confirmar pago
                    </button>
                </div>
            </Modal>

            {/* ── Anular consumo (pide motivo) ── */}
            <Modal isOpen={!!anularTarget} onClose={() => { setAnularTarget(null); setMotivo(''); }} title="Anular consumo" size="max-w-sm">
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-300 mb-3">
                    Se devolverá el stock y el monto dejará de descontarse del sueldo. Esta acción queda en auditoría.
                </p>
                <label className={labelCls}>Motivo *</label>
                <input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ej: error al registrar" />
                <div className="flex gap-2 mt-4">
                    <button onClick={() => { setAnularTarget(null); setMotivo(''); }}
                        className="flex-1 py-3 rounded-2xl text-sm font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 active:scale-95 transition-all">
                        Cancelar
                    </button>
                    <button onClick={doAnular} disabled={anularBusy}
                        className="flex-1 py-3 rounded-2xl text-sm font-extrabold bg-red-500 text-white shadow-md active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                        {anularBusy && <Loader2 size={15} className="animate-spin" />}
                        Anular
                    </button>
                </div>
            </Modal>

            {/* ── Recibo de pago ── */}
            {reciboData && (
                <PayrollReceiptModal
                    liquidacion={reciboData.liquidacion}
                    empleado={reciboData.empleado}
                    periodo={reciboData.periodo}
                    onClose={() => setReciboData(null)}
                />
            )}
        </div>
    );
}
