/**
 * ModoJefePanel.jsx — Bloques monetarios del Modo Jefe (Fase B).
 *
 * - `ModoJefePanel`: detalle monetario de UNA sede (lo usan el dueño por sede
 *   y el administrador para la suya).
 * - `ConsolidadoJefe`: agregados del dueño sumando todas las sedes.
 *
 * R1 (solo lectura): estos componentes solo calculan sobre `sales` ya leídos;
 * ningún botón aquí muta datos. R5: el badge de frescura lo recibe por prop.
 *
 * UI: todo redondeado, sin <select> nativo, una sola señal de foco,
 * iconos lucide, sin alert/confirm/prompt.
 */
import React, { useMemo, useState } from 'react';
import {
    Banknote, Wallet, Coins, CreditCard, Zap, Eye, HandCoins, Scale,
    TrendingUp, TrendingDown, Minus, TriangleAlert, BadgePercent,
    FileX, Clock3, ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';
import { getLocalISODate } from '../utils/dateHelpers';
import { formatUsd, formatBs, formatCop } from '../utils/calculatorUtils';
import {
    resumenPlataHoy, fiadosHoy, movimientoCajaHoy, feedVentas,
    resumenDia, alertasJefe, combinarPlata,
} from '../utils/modoJefe';

function SectionTitle({ icon: Icon, children, right }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <Icon size={16} className="text-brand" />
            <h3 className="text-sm font-black text-slate-800 dark:text-white">{children}</h3>
            {right && <span className="ml-auto">{right}</span>}
        </div>
    );
}

function Card({ children, className = '' }) {
    return (
        <div className={`bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-4 shadow-sm ${className}`}>
            {children}
        </div>
    );
}

/** Badge "actualizado hace Xs" (R5: frescura visible). */
export function FrescuraBadge({ updatedAt }) {
    const txt = useMemo(() => {
        if (!updatedAt) return 'actualizando…';
        const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
        if (s < 5) return 'ahora mismo';
        if (s < 60) return `hace ${s} s`;
        return `hace ${Math.floor(s / 60)} min`;
    }, [updatedAt]);
    return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {txt}
        </span>
    );
}

function MonedaChips({ porMoneda }) {
    // Si el COP no está activado, no aparece en el sistema.
    const [copEnabled] = useState(() => localStorage.getItem('cop_enabled') === 'true');
    const chips = [
        { icon: Banknote, label: 'USD', value: `$${formatUsd(porMoneda.USD)}`, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
        { icon: Wallet, label: 'Bs', value: `Bs ${formatBs(porMoneda.BS)}`, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
        ...(copEnabled ? [{ icon: Coins, label: 'COP', value: `$ ${formatCop(porMoneda.COP)}`, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' }] : []),
    ];
    return (
        <div className={`grid gap-2 ${chips.length > 2 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {chips.map(({ icon: Icon, label, value, tone }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl px-2 py-2.5 text-center">
                    <div className={`inline-flex w-7 h-7 rounded-xl items-center justify-center mb-1 ${tone}`}>
                        <Icon size={14} />
                    </div>
                    <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">{label}</div>
                    <div className="text-xs font-black text-slate-800 dark:text-white truncate">{value}</div>
                </div>
            ))}
        </div>
    );
}

function MetodoRows({ porMetodo, totalUsd }) {
    if (porMetodo.length === 0) {
        return <p className="text-xs text-slate-400 font-semibold">Sin ventas hoy todavía.</p>;
    }
    return (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {porMetodo.map((m) => {
                const pct = totalUsd > 0 ? Math.round((m.totalUsd / totalUsd) * 100) : 0;
                return (
                    <div key={m.label} className="flex items-center gap-3 py-2.5">
                        <div className="w-8 h-8 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center shrink-0">
                            <CreditCard size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{m.label}</div>
                            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 mt-1 overflow-hidden">
                                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            <div className="text-sm font-black text-slate-800 dark:text-white">${formatUsd(m.totalUsd)}</div>
                            <div className="text-[10px] font-bold text-slate-400">{m.count} · {pct}%</div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function OjoCard({ icon: Icon, label, value, sub, tone }) {
    return (
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3">
            <div className={`inline-flex w-7 h-7 rounded-xl items-center justify-center mb-1.5 ${tone}`}>
                <Icon size={14} />
            </div>
            <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">{label}</div>
            <div className="text-base font-black text-slate-800 dark:text-white">{value}</div>
            {sub && <div className="text-[10px] font-semibold text-slate-400">{sub}</div>}
        </div>
    );
}

function AlertaRow({ alerta }) {
    const tone = alerta.severidad === 'alta'
        ? 'bg-rose-500/10 text-rose-500'
        : alerta.severidad === 'media'
            ? 'bg-amber-500/10 text-amber-500'
            : 'bg-sky-500/10 text-sky-500';
    const Icon = alerta.tipo === 'descuento' ? BadgePercent : alerta.tipo === 'anuladas' ? FileX : Clock3;
    return (
        <div className="flex items-start gap-3 px-4 py-3">
            <div className={`w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 ${tone}`}>
                <Icon size={15} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-800 dark:text-white">{alerta.titulo}</div>
                <div className="text-[11px] text-slate-400 font-semibold">{alerta.detalle}</div>
            </div>
        </div>
    );
}

function ComparativaRow({ label, actual, previo }) {
    const diff = actual.totalUsd - previo.totalUsd;
    const Icon = diff > 0.005 ? TrendingUp : diff < -0.005 ? TrendingDown : Minus;
    const tone = diff > 0.005 ? 'text-emerald-500' : diff < -0.005 ? 'text-rose-500' : 'text-slate-400';
    return (
        <div className="flex items-center gap-3 py-2.5">
            <div className="flex-1">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{label}</div>
                <div className="text-sm font-black text-slate-800 dark:text-white">
                    ${formatUsd(previo.totalUsd)} <span className="text-[11px] font-bold text-slate-400">· {previo.count} tickets</span>
                </div>
            </div>
            <div className={`flex items-center gap-1 text-xs font-black ${tone}`}>
                <Icon size={14} />
                {diff >= 0 ? '+' : ''}${formatUsd(diff)}
            </div>
        </div>
    );
}

function shiftDateStr(base, days) {
    const d = new Date(`${base}T12:00:00`);
    d.setDate(d.getDate() + days);
    return getLocalISODate(d);
}

/** Detalle monetario de una sede. */
export function ModoJefePanel({ sales, updatedAt }) {
    const today = getLocalISODate();
    const plata = useMemo(() => resumenPlataHoy(sales, today), [sales, today]);
    const fiados = useMemo(() => fiadosHoy(sales, today), [sales, today]);
    const caja = useMemo(() => movimientoCajaHoy(sales, today), [sales, today]);
    const feed = useMemo(() => feedVentas(sales, 8), [sales]);
    const alertas = useMemo(() => alertasJefe(sales, today), [sales, today]);
    const ayer = useMemo(() => resumenDia(sales, shiftDateStr(today, -1)), [sales, today]);
    const hace7 = useMemo(() => resumenDia(sales, shiftDateStr(today, -7)), [sales, today]);
    const hoyMini = useMemo(() => ({ totalUsd: plata.totalUsd, count: plata.count }), [plata]);

    return (
        <div className="space-y-5">
            {/* Plata de hoy: desglose */}
            <div>
                <SectionTitle icon={Banknote}>Plata de hoy · detalle</SectionTitle>
                <Card>
                    <MonedaChips porMoneda={plata.porMoneda} />
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                            Por método de pago
                        </div>
                        <MetodoRows porMetodo={plata.porMetodo} totalUsd={plata.totalUsd} />
                    </div>
                    {plata.mejorHora && (
                        <p className="mt-2 text-[11px] font-bold text-slate-400">
                            Mejor hora: {String(plata.mejorHora.hora).padStart(2, '0')}:00 · ${formatUsd(plata.mejorHora.totalUsd)}
                        </p>
                    )}
                </Card>
            </div>

            {/* En vivo */}
            <div>
                <SectionTitle icon={Zap} right={<FrescuraBadge updatedAt={updatedAt} />}>
                    En vivo
                </SectionTitle>
                {feed.length === 0 ? (
                    <Card><p className="text-xs text-slate-400 font-semibold">Sin ventas registradas todavía.</p></Card>
                ) : (
                    <Card className="!p-0 overflow-hidden">
                        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {feed.map((v) => (
                                <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <span className="text-[11px] font-black text-slate-400 w-11 shrink-0">{v.hora}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-slate-800 dark:text-white truncate">
                                            {v.cliente}
                                            {v.fiado && (
                                                <span className="ml-1.5 text-[9px] font-black uppercase bg-orange-500/15 text-orange-500 px-1.5 py-0.5 rounded-full">
                                                    Fiado
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-slate-400 font-semibold">{v.metodo}</div>
                                    </div>
                                    <div className="text-sm font-black text-emerald-600 dark:text-emerald-400 shrink-0">
                                        ${formatUsd(v.totalUsd)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}
            </div>

            {/* Ojo de jefe */}
            <div>
                <SectionTitle icon={Eye}>Ojo de jefe</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                    <OjoCard icon={BadgePercent} label="Descuentos hoy" value={`$${formatUsd(plata.descuentos.totalUsd)}`} sub={`${plata.descuentos.count} tickets`} tone="bg-amber-500/10 text-amber-500" />
                    <OjoCard icon={FileX} label="Anuladas hoy" value={`${plata.anuladas.count}`} sub={`$${formatUsd(plata.anuladas.totalUsd)}`} tone="bg-rose-500/10 text-rose-500" />
                    <OjoCard icon={Scale} label="Caja esperada" value={`$${formatUsd(caja.esperadoUsd)}`} sub={`apertura $${formatUsd(caja.aperturaUsd)}`} tone="bg-emerald-500/10 text-emerald-500" />
                    <OjoCard icon={ArrowDownLeft} label="Egresos hoy" value={`$${formatUsd(caja.egresosUsd)}`} sub="proveedores + gastos" tone="bg-slate-500/10 text-slate-500" />
                </div>
            </div>

            {/* Fiados en movimiento */}
            <div>
                <SectionTitle icon={HandCoins}>Fiados en movimiento</SectionTitle>
                <Card>
                    <div className="flex items-center gap-3">
                        <div className="flex-1 bg-orange-500/10 rounded-2xl p-3 text-center">
                            <div className="flex items-center justify-center gap-1 text-[9px] font-extrabold uppercase tracking-wider text-orange-500">
                                <ArrowUpRight size={12} /> Otorgados
                            </div>
                            <div className="text-base font-black text-slate-800 dark:text-white">${formatUsd(fiados.otorgadoUsd)}</div>
                            <div className="text-[10px] font-bold text-slate-400">{fiados.otorgadoCount} fiados</div>
                        </div>
                        <div className="flex-1 bg-emerald-500/10 rounded-2xl p-3 text-center">
                            <div className="flex items-center justify-center gap-1 text-[9px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                <ArrowDownLeft size={12} /> Cobrados
                            </div>
                            <div className="text-base font-black text-slate-800 dark:text-white">${formatUsd(fiados.cobradoUsd)}</div>
                            <div className="text-[10px] font-bold text-slate-400">{fiados.cobradoCount} cobros</div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Comparativas */}
            <div>
                <SectionTitle icon={TrendingUp}>Comparativas</SectionTitle>
                <Card>
                    <ComparativaRow label="Ayer" actual={hoyMini} previo={ayer} />
                    <div className="border-t border-slate-100 dark:border-slate-800/60" />
                    <ComparativaRow label="Hace 7 días" actual={hoyMini} previo={hace7} />
                </Card>
            </div>

            {/* Alertas */}
            <div>
                <SectionTitle icon={TriangleAlert} right={
                    alertas.length > 0 && (
                        <span className="text-[10px] font-black bg-rose-500/15 text-rose-500 px-2 py-0.5 rounded-full">
                            {alertas.length}
                        </span>
                    )
                }>
                    Alertas de jefe
                </SectionTitle>
                {alertas.length === 0 ? (
                    <Card><p className="text-xs text-slate-400 font-semibold">Todo tranquilo: sin anuladas, descuentos normales y caja con apertura.</p></Card>
                ) : (
                    <Card className="!p-0 overflow-hidden">
                        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {alertas.map((a, i) => <AlertaRow key={`${a.tipo}-${i}`} alerta={a} />)}
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
}

/** Agregados del dueño: suma todas las sedes. */
export function ConsolidadoJefe({ negocios, dataById, updatedAt }) {
    const today = getLocalISODate();
    const perSede = useMemo(
        () => negocios.map((n) => {
            const sales = dataById[n.id]?.sales || [];
            return {
                negocio: n,
                plata: resumenPlataHoy(sales, today),
                fiados: fiadosHoy(sales, today),
                caja: movimientoCajaHoy(sales, today),
                alertas: alertasJefe(sales, today),
            };
        }),
        [negocios, dataById, today]
    );
    const combinado = useMemo(() => combinarPlata(perSede.map((p) => p.plata)), [perSede]);
    const totFiados = useMemo(() => ({
        otorgadoUsd: perSede.reduce((a, p) => a + p.fiados.otorgadoUsd, 0),
        cobradoUsd: perSede.reduce((a, p) => a + p.fiados.cobradoUsd, 0),
    }), [perSede]);
    const totCaja = useMemo(
        () => perSede.reduce((a, p) => a + p.caja.esperadoUsd, 0),
        [perSede]
    );
    const totEgresos = useMemo(
        () => perSede.reduce((a, p) => a + p.caja.egresosUsd, 0),
        [perSede]
    );
    const todasAlertas = useMemo(
        () => perSede.flatMap((p) => p.alertas.map((a) => ({ ...a, sede: p.negocio.nombre }))),
        [perSede]
    );
    const ranking = useMemo(
        () => [...perSede].sort((a, b) => b.plata.totalUsd - a.plata.totalUsd),
        [perSede]
    );

    return (
        <div className="space-y-5">
            <div>
                <SectionTitle icon={Banknote} right={<FrescuraBadge updatedAt={updatedAt} />}>
                    Plata de hoy · consolidado
                </SectionTitle>
                <Card>
                    <div className="flex items-end justify-between mb-3">
                        <div>
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                                Recaudación total
                            </div>
                            <div className="text-3xl font-black text-slate-800 dark:text-white">
                                ${formatUsd(combinado.totalUsd)}
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm font-black text-slate-700 dark:text-slate-200">{combinado.count} tickets</div>
                            <div className="text-[11px] font-bold text-slate-400">ticket ${formatUsd(combinado.ticketPromedio)}</div>
                        </div>
                    </div>
                    <MonedaChips porMoneda={combinado.porMoneda} />
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                            Por método de pago
                        </div>
                        <MetodoRows porMetodo={combinado.porMetodo} totalUsd={combinado.totalUsd} />
                    </div>
                </Card>
            </div>

            <div>
                <SectionTitle icon={Eye}>Ojo de jefe · consolidado</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                    <OjoCard icon={BadgePercent} label="Descuentos" value={`$${formatUsd(combinado.descuentos.totalUsd)}`} sub={`${combinado.descuentos.count} tickets`} tone="bg-amber-500/10 text-amber-500" />
                    <OjoCard icon={FileX} label="Anuladas" value={`${combinado.anuladas.count}`} sub={`$${formatUsd(combinado.anuladas.totalUsd)}`} tone="bg-rose-500/10 text-rose-500" />
                    <OjoCard icon={Scale} label="Caja esperada" value={`$${formatUsd(totCaja)}`} sub="todas las sedes" tone="bg-emerald-500/10 text-emerald-500" />
                    <OjoCard icon={ArrowDownLeft} label="Egresos" value={`$${formatUsd(totEgresos)}`} sub="proveedores + gastos" tone="bg-slate-500/10 text-slate-500" />
                </div>
            </div>

            <div>
                <SectionTitle icon={HandCoins}>Fiados · consolidado</SectionTitle>
                <Card>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-orange-500">Otorgados hoy</div>
                            <div className="text-lg font-black text-slate-800 dark:text-white">${formatUsd(totFiados.otorgadoUsd)}</div>
                        </div>
                        <div className="text-right">
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Cobrados hoy</div>
                            <div className="text-lg font-black text-slate-800 dark:text-white">${formatUsd(totFiados.cobradoUsd)}</div>
                        </div>
                    </div>
                </Card>
            </div>

            {todasAlertas.length > 0 && (
                <div>
                    <SectionTitle icon={TriangleAlert} right={
                        <span className="text-[10px] font-black bg-rose-500/15 text-rose-500 px-2 py-0.5 rounded-full">
                            {todasAlertas.length}
                        </span>
                    }>
                        Alertas · todas las sedes
                    </SectionTitle>
                    <Card className="!p-0 overflow-hidden">
                        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {todasAlertas.map((a, i) => (
                                <div key={`${a.tipo}-${i}`}>
                                    <AlertaRow alerta={a} />
                                    <p className="px-4 pb-2 -mt-1 text-[10px] font-bold text-slate-400">{a.sede}</p>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            )}

            {ranking.length > 1 && (
                <div>
                    <SectionTitle icon={TrendingUp}>Ranking de sedes · hoy</SectionTitle>
                    <Card className="!p-0 overflow-hidden">
                        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {ranking.map((p, i) => (
                                <div key={p.negocio.id} className="flex items-center gap-3 px-4 py-3">
                                    <span className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${i === 0 ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                        {i + 1}
                                    </span>
                                    <span className="flex-1 text-sm font-bold text-slate-800 dark:text-white truncate">
                                        {p.negocio.nombre}
                                    </span>
                                    <span className="text-sm font-black text-slate-700 dark:text-slate-200 shrink-0">
                                        ${formatUsd(p.plata.totalUsd)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
