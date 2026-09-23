import React, { useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus, Terminal, DollarSign, Zap } from 'lucide-react';

export const Card = ({ children, className = "" }) => (
  <div className={`bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-slate-100 dark:border-slate-800 transition-colors duration-300 ${className}`}>
    {children}
  </div>
);

export const Badge = ({ children, color = "slate", className = "" }) => {
  const colors = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    emerald: "bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
    indigo: "bg-brand-light text-brand-dark border border-surface-200 dark:bg-surface-800/30 dark:text-brand dark:border-surface-800",
    amber: "bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  };
  return (
    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border dark:border-opacity-50 ${colors[color] || colors.slate} ${className}`}>
      {children}
    </span>
  );
};

export const ChangeIndicator = ({ percent }) => {
  if (!percent || Math.abs(percent) < 0.01) return <span className="text-slate-300 dark:text-slate-600"><Minus size={12}/></span>;
  const isUp = percent > 0;
  return (
    <div className={`flex items-center gap-0.5 text-[10px] font-bold ${isUp ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
      {isUp ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
      {Math.abs(percent).toFixed(2)}%
    </div>
  );
};

export const LogViewer = ({ logs }) => {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="bg-slate-900 dark:bg-black rounded-2xl p-4 font-mono text-[10px] text-slate-300 shadow-inner border border-slate-800">
      <div className="flex items-center gap-2 mb-2 text-slate-400 border-b border-slate-800 pb-2">
        <Terminal size={12} />
        <span className="uppercase font-bold tracking-wider">Registro de Conexión</span>
      </div>
      <div ref={scrollRef} className="h-32 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700">
        {logs.length === 0 && <p className="text-slate-600 italic">Esperando actividad...</p>}
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-slate-600 shrink-0">[{log.time}]</span>
            <span className={`${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'}`}>
              {log.msg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SkeletonCard = () => (
    <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-slate-100 dark:border-slate-800 h-40 animate-pulse relative overflow-hidden">
        <div className="flex justify-between mb-4">
            <div className="h-5 w-20 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
            <div className="h-4 w-12 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
        </div>
        <div className="space-y-3 mt-8">
            <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
            <div className="h-10 w-40 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
        </div>
    </div>
);

// --- LOGO (Sin modo oscuro en texto/bordes) ---
export const Logo = () => (
  <div className="flex items-center gap-2.5">
    <div className="relative bg-[#FCD535] p-2.5 rounded-2xl shadow-lg shadow-yellow-500/20 rotate-3 border-2 border-white transition-all">
      <DollarSign size={24} className="text-slate-900" strokeWidth={3} />
      <div className="absolute -top-1.5 -right-1.5 bg-emerald-500 w-5 h-5 rounded-full border-[3px] border-white flex items-center justify-center z-10">
        <Zap size={10} className="text-white fill-white" />
      </div>
    </div>
    <div className="flex flex-col justify-center">
        {/* Texto siempre oscuro */}
        <h1 className="text-xl font-extrabold text-slate-900 leading-none tracking-tight transition-colors">
          Tasas<span className="text-[#FCD535]">AlDía</span>
        </h1>
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-snug ml-0.5">
          Monitor Venezuela
        </span>
    </div>
  </div>
);
