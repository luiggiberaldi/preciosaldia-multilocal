import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function PaginationBar({
    currentPage,
    totalPages,
    totalItems,
    startIndex,
    endIndex,
    onNext,
    onPrev,
    onGoTo,
    hasNext,
    hasPrev,
    label = 'registros'
}) {
    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center justify-between px-2 py-3 border-t border-surface-200 dark:border-surface-800 mt-2">
            <span className="text-xs text-surface-400 dark:text-surface-500">
                {startIndex}–{endIndex} de {totalItems} {label}
            </span>
            <div className="flex items-center gap-1">
                <button
                    onClick={onPrev}
                    disabled={!hasPrev}
                    className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-surface-600 dark:text-surface-300"
                    aria-label="Página anterior"
                >
                    <ChevronLeft size={20} />
                </button>
                <span className="text-xs font-medium px-2 text-surface-600 dark:text-surface-300">
                    {currentPage} / {totalPages}
                </span>
                <button
                    onClick={onNext}
                    disabled={!hasNext}
                    className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-surface-600 dark:text-surface-300"
                    aria-label="Siguiente página"
                >
                    <ChevronRight size={20} />
                </button>
            </div>
        </div>
    );
}
