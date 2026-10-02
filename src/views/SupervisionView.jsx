/**
 * SupervisionView.jsx — Vista Supervisión (Fase 1.5).
 *
 * - Dueño global: selector por sede + Consolidado (comparación entre negocios).
 * - Administrador: solo su sede (negocio activo), sin selector.
 * - Todo es SOLO LECTURA: los datos se leen directo de `nb_<id>:<clave>` vía
 *   `utils/supervisionData` sin cambiar el negocio activo. Las acciones
 *   operativas requieren entrar a la sede ("Entrar a esta sede", solo dueño).
 *
 * Métricas por sede: ventas hoy / semana / mes (USD), ticket promedio, top
 * productos, stock bajo/agotado y fiados pendientes.
 *
 * Fase B — Modo Jefe: cada sede suma el bloque monetario detallado
 * (`views/ModoJefePanel.jsx`, motor puro en `utils/modoJefe.js`): plata de hoy
 * por moneda y método de pago, feed en vivo (refresco 10 s, pausado con la
 * pestaña oculta), ojo de jefe (descuentos, anuladas, caja esperada, egresos),
 * fiados en movimiento, comparativas y alertas. El consolidado agrega todo.
 *
 * UI: todo redondeado, sin <select> nativo (píldoras), sin alert/confirm/prompt,
 * iconos lucide.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Building2, LayoutGrid, Store, TrendingUp, CalendarDays, CalendarRange,
    Receipt, Trophy, AlertTriangle, PackageX, HandCoins, Loader2,
    ArrowRight, Eye,
} from 'lucide-react';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useNegociosStore } from '../hooks/store/useNegociosStore';
import { useProductContext } from '../context/ProductContext';
import { useDashboardMetrics } from '../hooks/useDashboardMetrics';
import { readNegocioData, summarizeSales } from '../utils/supervisionData';
import { isOwner, isAdministrador } from '../utils/roles';
import { formatUsd } from '../utils/calculatorUtils';
import { ModoJefePanel, ConsolidadoJefe, FrescuraBadge } from './ModoJefePanel';

function KpiCard({ icon: Icon, label, value, sub, tone }) {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 ${tone}`}>
                    <Icon size={16} />
                </div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    {label}
                </span>
            </div>
            <div className="text-xl font-black text-slate-800 dark:text-white">{value}</div>
            {sub && <div className="text-[11px] font-semibold text-slate-400 mt-0.5">{sub}</div>}
        </div>
    );
}

function SectionTitle({ icon: Icon, children, count }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <Icon size={16} className="text-brand" />
            <h3 className="text-sm font-black text-slate-800 dark:text-white">{children}</h3>
            {typeof count === 'number' && (
                <span className="text-[10px] font-black bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                    {count}
                </span>
            )}
        </div>
    );
}

/**
 * Panel de una sede: KPIs + Modo Jefe (detalle monetario en vivo) + top
 * productos + alertas + fiados.
 * Usa el mismo motor de métricas que el dashboard (useDashboardMetrics).
 */
function SedePanel({ negocio, data, bcvRate, isOwnerView, onEnterSede, updatedAt }) {
    const { sales, customers, products } = data;
    const metrics = useDashboardMetrics(sales, customers, products, bcvRate);
    const summary = useMemo(() => summarizeSales(sales), [sales]);

    const stockAlerts = useMemo(() => ([
        ...(metrics.outOfStockProducts || []).map(p => ({ ...p, critical: true })),
        ...(metrics.lowStockProducts || []).map(p => ({ ...p, critical: false })),
    ].slice(0, 6)), [metrics]);

    const isActiveSede = negocio?.id === useNegociosStore.getState().negocioActivoId;

    return (
        <div className="space-y-5">
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3">
                <KpiCard
                    icon={TrendingUp} label="Ventas hoy"
                    value={`$${formatUsd(summary.todayTotalUsd)}`}
                    sub={`${summary.todayCount} ticket${summary.todayCount === 1 ? '' : 's'}`}
                    tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                />
                <KpiCard
                    icon={Receipt} label="Ticket promedio"
                    value={`$${formatUsd(summary.ticketAvgUsd)}`}
                    sub="promedio de hoy"
                    tone="bg-sky-500/10 text-sky-600 dark:text-sky-400"
                />
                <KpiCard
                    icon={CalendarDays} label="Últimos 7 días"
                    value={`$${formatUsd(summary.weekTotalUsd)}`}
                    sub="ventas acumuladas"
                    tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
                />
                <KpiCard
                    icon={CalendarRange} label="Este mes"
                    value={`$${formatUsd(summary.monthTotalUsd)}`}
                    sub="ventas acumuladas"
                    tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                />
            </div>

            {/* Modo Jefe (Fase B): detalle monetario + en vivo, solo lectura */}
            <ModoJefePanel sales={sales} updatedAt={updatedAt} />

            {/* Top productos */}
            <div>
                <SectionTitle icon={Trophy} count={(metrics.topProducts || []).length}>
                    Top productos
                </SectionTitle>
                {(metrics.topProducts || []).length === 0 ? (
                    <p className="text-xs text-slate-400 font-semibold bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4">
                        Sin ventas registradas todavía.
                    </p>
                ) : (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/60 overflow-hidden">
                        {metrics.topProducts.map((p, i) => (
                            <div key={`${p.name}-${i}`} className="flex items-center gap-3 px-4 py-3">
                                <span className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${i === 0 ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                    {i + 1}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{p.name}</div>
                                    <div className="text-[11px] text-slate-400 font-semibold">{p.qty} uds vendidas</div>
                                </div>
                                <div className="text-sm font-black text-slate-700 dark:text-slate-200 shrink-0">
                                    ${formatUsd(p.revenue)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Alertas de stock */}
            <div>
                <SectionTitle icon={AlertTriangle} count={stockAlerts.length}>
                    Stock bajo / agotado
                </SectionTitle>
                {stockAlerts.length === 0 ? (
                    <p className="text-xs text-slate-400 font-semibold bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4">
                        Inventario sin alertas.
                    </p>
                ) : (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/60 overflow-hidden">
                        {stockAlerts.map((p) => (
                            <div key={p.id ?? p.name} className="flex items-center gap-3 px-4 py-3">
                                <div className={`w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 ${p.critical ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                                    {p.critical ? <PackageX size={15} /> : <AlertTriangle size={15} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{p.name}</div>
                                    <div className={`text-[11px] font-bold ${p.critical ? 'text-rose-500' : 'text-amber-500'}`}>
                                        {p.critical ? 'Agotado' : `Quedan ${p.stock ?? 0} uds`}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Fiados pendientes */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0">
                    <HandCoins size={18} />
                </div>
                <div className="flex-1">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                        Fiados pendientes
                    </div>
                    <div className="text-lg font-black text-slate-800 dark:text-white">
                        ${formatUsd(metrics.totalDeudas?.totalUsd || 0)}
                    </div>
                </div>
            </div>

            {/* Entrar a la sede (solo dueño, solo lectura aquí) */}
            {isOwnerView && !isActiveSede && (
                <button
                    onClick={() => onEnterSede && onEnterSede(negocio.id)}
                    className="w-full px-4 py-3.5 rounded-3xl font-extrabold text-sm bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/25 transition-all active:scale-[0.98] flex items-center justify-center gap-2 outline-none focus:ring-2 focus:ring-brand/50"
                >
                    <Store size={16} />
                    Entrar a "{negocio.nombre}" para operar
                    <ArrowRight size={16} />
                </button>
            )}
            <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 font-semibold flex items-center justify-center gap-1.5">
                <Eye size={12} />
                Vista de solo lectura — las acciones operativas requieren entrar a la sede.
            </p>
        </div>
    );
}

/** Consolidado: comparación entre negocios, solo lectura. */
function ConsolidadoTable({ negocios, dataById }) {
    const rows = negocios.map((n) => ({
        negocio: n,
        summary: summarizeSales(dataById[n.id]?.sales || []),
        fiados: dataById[n.id]?.customers?.filter((c) => (c.deuda || 0) > 0.01 || (c.casheaDeuda || 0) > 0.01).length ?? 0,
    }));
    const totals = rows.reduce(
        (acc, r) => ({
            hoy: acc.hoy + r.summary.todayTotalUsd,
            semana: acc.semana + r.summary.weekTotalUsd,
            mes: acc.mes + r.summary.monthTotalUsd,
        }),
        { hoy: 0, semana: 0, mes: 0 }
    );

    return (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                    <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                            <th className="px-4 py-3 font-extrabold">Sede</th>
                            <th className="px-4 py-3 font-extrabold text-right">Hoy</th>
                            <th className="px-4 py-3 font-extrabold text-right">7 días</th>
                            <th className="px-4 py-3 font-extrabold text-right">Mes</th>
                            <th className="px-4 py-3 font-extrabold text-right">Fiados</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {rows.map(({ negocio, summary, fiados }) => (
                            <tr key={negocio.id}>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-2xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
                                            <Store size={14} />
                                        </div>
                                        <span className="font-bold text-slate-800 dark:text-white truncate max-w-[140px]">
                                            {negocio.nombre}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-right font-black text-slate-800 dark:text-white">
                                    ${formatUsd(summary.todayTotalUsd)}
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-slate-600 dark:text-slate-300">
                                    ${formatUsd(summary.weekTotalUsd)}
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-slate-600 dark:text-slate-300">
                                    ${formatUsd(summary.monthTotalUsd)}
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-orange-500">
                                    {fiados}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                            <td className="px-4 py-3 font-black text-slate-800 dark:text-white">Total</td>
                            <td className="px-4 py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                                ${formatUsd(totals.hoy)}
                            </td>
                            <td className="px-4 py-3 text-right font-black text-slate-700 dark:text-slate-200">
                                ${formatUsd(totals.semana)}
                            </td>
                            <td className="px-4 py-3 text-right font-black text-slate-700 dark:text-slate-200">
                                ${formatUsd(totals.mes)}
                            </td>
                            <td className="px-4 py-3" />
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}

export default function SupervisionView({ triggerHaptic, isActive }) {
    const { usuarioActivo, requireLogin } = useAuthStore();
    const negocios = useNegociosStore((s) => s.negocios);
    const negocioActivoId = useNegociosStore((s) => s.negocioActivoId);
    const activarNegocio = useNegociosStore((s) => s.activarNegocio);
    const { effectiveRate: bcvRate } = useProductContext();

    // Sin login no hay sesión: acceso total (comportamiento legacy).
    const owner = isOwner(usuarioActivo) || !requireLogin;
    const administrador = isAdministrador(usuarioActivo);

    const [selected, setSelected] = useState(() => (owner ? 'consolidado' : negocioActivoId));
    const [dataById, setDataById] = useState(null);
    const [updatedAt, setUpdatedAt] = useState(null);
    const [tick, setTick] = useState(0);
    const firstLoad = useRef(true);

    // R2: refresco en vivo cada 10 s — solo con la vista activa y la pestaña
    // visible (ahorra batería); limpieza al desmontar/ocultar.
    useEffect(() => {
        if (!isActive) return;
        const id = setInterval(() => {
            if (!document.hidden) setTick((t) => t + 1);
        }, 10000);
        return () => clearInterval(id);
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return;
        let cancelled = false;
        // Loader solo en la primera carga: los refrescos en vivo no parpadean.
        if (firstLoad.current) setDataById(null);
        (async () => {
            try {
                const ids = owner ? negocios.map((n) => n.id) : [negocioActivoId];
                const entries = await Promise.all(
                    ids.map(async (id) => [id, await readNegocioData(id)])
                );
                if (!cancelled) {
                    setDataById(Object.fromEntries(entries));
                    setUpdatedAt(Date.now());
                    firstLoad.current = false;
                }
            } catch {
                if (!cancelled && firstLoad.current) setDataById({});
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, negocioActivoId, tick]);

    if (!owner && !administrador) return null;

    const handleEnterSede = (id) => {
        triggerHaptic && triggerHaptic();
        activarNegocio(id); // recarga la app en la sede elegida (decisión Fase 1)
    };

    const selectedNegocio = negocios.find((n) => n.id === selected);

    return (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-28">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-3xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center shadow-lg shadow-brand/25 shrink-0">
                        <Building2 size={20} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-800 dark:text-white leading-tight">
                            Control
                        </h2>
                        <p className="text-[11px] text-slate-400 font-semibold">
                            {owner
                                ? 'Todas tus sedes en una vista'
                                : `Tu sede: ${negocios.find((n) => n.id === negocioActivoId)?.nombre ?? ''}`}
                        </p>
                    </div>
                </div>

                {/* Selector de sede (solo dueño con más de un negocio) */}
                {owner && negocios.length > 1 && (
                    <div className="flex gap-2 mb-5 overflow-x-auto pt-2 pb-1">
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); setSelected('consolidado'); }}
                            className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-extrabold transition-all outline-none focus:ring-2 focus:ring-brand/50 ${
                                selected === 'consolidado'
                                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
                                    : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200/70 dark:border-slate-800'
                            }`}
                        >
                            <LayoutGrid size={13} />
                            Consolidado
                        </button>
                        {negocios.map((n) => (
                            <button
                                key={n.id}
                                onClick={() => { triggerHaptic && triggerHaptic(); setSelected(n.id); }}
                                className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-extrabold transition-all outline-none focus:ring-2 focus:ring-brand/50 max-w-[180px] ${
                                    selected === n.id
                                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
                                        : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200/70 dark:border-slate-800'
                                }`}
                            >
                                <Store size={13} className="shrink-0" />
                                <span className="truncate">{n.nombre}</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Contenido */}
                {!dataById ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Loader2 size={28} className="animate-spin text-brand" />
                        <p className="text-xs font-bold text-slate-400">Cargando datos de las sedes…</p>
                    </div>
                ) : selected === 'consolidado' && owner ? (
                    <div className="space-y-5">
                        <ConsolidadoJefe negocios={negocios} dataById={dataById} updatedAt={updatedAt} />
                        <ConsolidadoTable negocios={negocios} dataById={dataById} />
                    </div>
                ) : (
                    (() => {
                        const sedeId = owner ? selected : negocioActivoId;
                        const neg = negocios.find((n) => n.id === sedeId) ?? negocios[0];
                        const d = dataById[sedeId];
                        if (!neg || !d) return null;
                        return (
                            <SedePanel
                                negocio={neg}
                                data={d}
                                bcvRate={bcvRate}
                                isOwnerView={owner}
                                onEnterSede={handleEnterSede}
                                updatedAt={updatedAt}
                            />
                        );
                    })()
                )}
            </div>
        </div>
    );
}
