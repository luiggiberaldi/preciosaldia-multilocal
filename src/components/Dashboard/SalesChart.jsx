import React from 'react';
import { BarChart3 } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';

/**
 * Gráfica de barras: Ventas de los últimos 7 días.
 * Pure CSS — cero dependencias externas.
 */
function SalesChart({ weekData, onDayClick, selectedDate, copEnabled, copPrimary, tasaCop, bcvRate }) {
    if (!weekData || weekData.length === 0) return null;

    const maxVal = Math.max(...weekData.map(d => d.total), 1);
    const weekTotal = weekData.reduce((s, d) => s + d.total, 0);
    const isCop = copEnabled && tasaCop > 0;

    const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    const fmtBarLabel = (usd) => {
        if (copEnabled && copPrimary && tasaCop > 0) return `${formatCop(usd * tasaCop)}`;
        return `$${usd.toFixed(0)}`;
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm mb-5 transition-all">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                        <BarChart3 size={13} className="text-brand" /> Actividad Semanal
                    </h3>
                    <p className="text-sm font-outfit font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                        Ventas de los últimos 7 días
                    </p>
                </div>
                <div className="text-right">
                    <span className="text-[9px] font-extrabold text-brand dark:text-brand bg-brand-light/60 dark:bg-brand-dark/20 px-2 py-1 rounded-lg uppercase tracking-wider">
                        Panel
                    </span>
                </div>
            </div>

            {/* Chart Area */}
            <div className="relative h-32 flex items-end justify-between gap-2 px-1 mb-5 z-10">
                {/* Horizontal Grid Lines (background) */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none z-0">
                    <div className="w-full border-t border-dashed border-slate-100 dark:border-slate-800/40"></div>
                    <div className="w-full border-t border-dashed border-slate-100 dark:border-slate-800/40"></div>
                    <div className="w-full border-t border-dashed border-slate-100 dark:border-slate-800/40"></div>
                    <div className="w-full border-b border-solid border-slate-200/60 dark:border-slate-800"></div>
                </div>

                {weekData.map((day, i) => {
                    const pct = maxVal > 0 ? (day.total / maxVal) * 100 : 0;
                    const isToday = i === weekData.length - 1;
                    const dayName = DAYS[new Date(day.date + 'T00:00:00').getDay()];
                    const isSelected = selectedDate === day.date;

                    return (
                        <div
                            key={day.date}
                            onClick={() => onDayClick && onDayClick(day.date)}
                            className="flex-1 h-full flex flex-col justify-end items-center relative group cursor-pointer z-10"
                        >
                            {/* Hover tooltip */}
                            <span 
                                className={`absolute -top-7 text-[9px] font-bold px-2 py-1 rounded transition-all duration-200 scale-90 opacity-0 group-hover:opacity-100 group-hover:scale-100 bg-slate-800 dark:bg-slate-700 text-white dark:text-slate-100 shadow-md pointer-events-none z-20 whitespace-nowrap ${
                                    isSelected ? 'opacity-100 scale-100 bg-brand text-white dark:bg-brand-dark' : ''
                                }`}
                            >
                                {fmtBarLabel(day.total)}
                            </span>

                            {/* Capsule Track */}
                            <div className="w-2.5 md:w-4 h-[75%] bg-slate-100/60 dark:bg-slate-800/30 rounded-full relative overflow-hidden flex flex-col justify-end group-hover:bg-slate-200/50 dark:group-hover:bg-slate-800/50 transition-colors">
                                {/* Capsule Fill */}
                                <div
                                    className={`w-full rounded-full transition-all duration-500 ease-out origin-bottom ${
                                        isSelected
                                            ? 'bg-gradient-to-t from-brand to-brand-dark shadow-sm shadow-primary/30'
                                        : isToday
                                            ? 'bg-gradient-to-t from-emerald-500 to-emerald-400 shadow-sm shadow-emerald-500/20'
                                        : day.total > 0
                                            ? 'bg-gradient-to-t from-slate-400 to-slate-300 dark:from-slate-600 dark:to-slate-500'
                                            : 'bg-transparent'
                                    }`}
                                    style={{
                                        height: `${Math.max(pct, day.total > 0 ? 8 : 0)}%`,
                                    }}
                                />
                            </div>

                            {/* Day label */}
                            <span className={`text-[10px] font-bold mt-2 transition-colors ${
                                isSelected ? 'text-brand dark:text-brand font-black'
                                : isToday ? 'text-emerald-600 dark:text-emerald-400 font-extrabold'
                                : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-400'
                            }`}>
                                {isToday ? 'Hoy' : dayName}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Summary row */}
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
                        Total de la semana
                    </span>
                    {isCop && (
                        <div className="flex gap-2 mt-0.5">
                            {copPrimary
                                ? <span className="text-[10px] text-slate-400 font-medium">${weekTotal.toFixed(2)}</span>
                                : <span className="text-[10px] text-slate-400 font-medium">{formatCop(weekTotal * tasaCop)} COP</span>}
                            {bcvRate > 0 && <span className="text-[10px] text-slate-400 font-medium">{formatBs(weekTotal * bcvRate)} Bs</span>}
                        </div>
                    )}
                </div>
                <div className="text-right">
                    <span className={`text-base font-outfit font-bold ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'}`}>
                        {copEnabled && copPrimary
                            ? `${formatCop(weekTotal * tasaCop)} COP`
                            : `$${weekTotal.toFixed(2)}`}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default React.memo(SalesChart);
