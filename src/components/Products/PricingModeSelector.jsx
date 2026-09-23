import React from 'react';
import { Zap, Banknote } from 'lucide-react';

const MODES = [
    {
        id: 'tasa_dia',
        icon: Zap,
        title: 'Tasa del Día',
        activeCls: 'border-purple-500 bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-1 ring-purple-500/40',
        iconCls: 'text-purple-500',
        desc: (rate) => `Un precio en $, los Bs salen a la tasa activa (${rate} Bs)`,
    },
    {
        id: 'dual_usd',
        icon: Banknote,
        title: 'Dos Precios en $',
        activeCls: 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/40',
        iconCls: 'text-emerald-500',
        desc: () => 'Un precio en $ si pagan en efectivo/divisas y otro precio en $ Ref si pagan en Bolívares',
    },
];

export default function PricingModeSelector({ value, onChange, effectiveRate, bcvRate, compact = false }) {
    return (
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-2' : 'gap-2.5'}`}>
            {MODES.map(m => {
                const Icon = m.icon;
                const active = (value || 'tasa_dia') === m.id;
                return (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => onChange(m.id)}
                        className={`text-left rounded-2xl border-2 transition-all cursor-pointer ${compact ? 'p-2.5' : 'p-3'} ${
                            active
                                ? m.activeCls
                                : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-850/60 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                    >
                        <span className={`flex items-center gap-2 font-black uppercase tracking-wider ${compact ? 'text-[10px]' : 'text-xs'}`}>
                            <Icon size={compact ? 14 : 16} className={active ? m.iconCls : 'text-slate-500 dark:text-slate-400'} />
                            {m.title}
                        </span>
                        {!compact && (
                            <span className="block text-[10px] font-bold mt-1.5 leading-tight text-slate-600 dark:text-slate-300">
                                {m.desc(effectiveRate, bcvRate || effectiveRate)}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
