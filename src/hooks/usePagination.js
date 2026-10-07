import { useState, useMemo } from 'react';

export function usePagination(items, itemsPerPage = 10) {
    const [currentPage, setCurrentPage] = useState(1);

    const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));

    // Auto-reset si la página actual excede el total (cuando cambian los filtros)
    const safePage = Math.min(currentPage, totalPages);

    const paginatedItems = useMemo(() => {
        const start = (safePage - 1) * itemsPerPage;
        return items.slice(start, start + itemsPerPage);
    }, [items, safePage, itemsPerPage]);

    const goToPage = (page) => setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    const goNext = () => goToPage(safePage + 1);
    const goPrev = () => goToPage(safePage - 1);
    const resetPage = () => setCurrentPage(1);

    return {
        currentPage: safePage,
        totalPages,
        paginatedItems,
        goToPage,
        goNext,
        goPrev,
        resetPage,
        hasNext: safePage < totalPages,
        hasPrev: safePage > 1,
        startIndex: (safePage - 1) * itemsPerPage + 1,
        endIndex: Math.min(safePage * itemsPerPage, items.length),
        totalItems: items.length,
    };
}
