import React from 'react';
import { X } from 'lucide-react';

export default function CloseButton({ onClick, ariaLabel = "Cerrar", className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full
        bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700
        text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200
        transition-colors shrink-0 active:scale-95 ${className}`}
    >
      <X size={20} />
    </button>
  );
}
