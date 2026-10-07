import React from 'react';

export default function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  actionLabel, 
  onAction,
  secondaryActionLabel,
  onSecondaryAction
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-white/50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 min-h-[300px]">
      <div className="w-16 h-16 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mb-4 shadow-inner">
        {Icon ? <Icon className="w-8 h-8 text-slate-500 dark:text-slate-400" /> : <div className="w-8 h-8 bg-slate-300 dark:bg-slate-600 rounded-full" />}
      </div>
      <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
        {title}
      </h3>
      <p className="text-sm text-slate-600 dark:text-slate-300 max-w-sm mb-6">
        {description}
      </p>
      
      <div className="flex flex-col sm:flex-row gap-3">
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-all outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            {actionLabel}
          </button>
        )}
        
        {secondaryActionLabel && onSecondaryAction && (
          <button
            onClick={onSecondaryAction}
            className="px-6 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium rounded-xl border border-slate-200 dark:border-slate-700 active:scale-95 transition-all outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            {secondaryActionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
