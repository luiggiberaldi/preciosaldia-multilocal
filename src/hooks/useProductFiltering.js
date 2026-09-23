import { useMemo, useDeferredValue } from 'react';

export function useProductFiltering(products, searchTerm, activeCategory, sortField, sortDir, effectiveRate) {
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const filteredProducts = useMemo(() => {
        let result = products.filter(p => {
            const term = deferredSearchTerm.toLowerCase();
            const matchesSearch = p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.toLowerCase().includes(term));
            if (activeCategory === 'bajo-stock') {
                return matchesSearch && (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
            }
            const matchesCategory = activeCategory === 'todos' || p.category === activeCategory;
            return matchesSearch && matchesCategory;
        });

        // Apply sort if active
        if (sortField) {
            result = [...result].sort((a, b) => {
                let valA, valB;
                switch (sortField) {
                    case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
                    case 'price': valA = a.priceUsdt || 0; valB = b.priceUsdt || 0; break;
                    case 'stock': valA = a.stock ?? 0; valB = b.stock ?? 0; break;
                    case 'margin': {
                        const costA = a.costUsd || (a.costBs && effectiveRate > 0 ? a.costBs / effectiveRate : 0);
                        const costB = b.costUsd || (b.costBs && effectiveRate > 0 ? b.costBs / effectiveRate : 0);
                        valA = costA > 0 && a.priceUsdt > 0 ? ((a.priceUsdt - costA) / costA * 100) : -999;
                        valB = costB > 0 && b.priceUsdt > 0 ? ((b.priceUsdt - costB) / costB * 100) : -999;
                        break;
                    }
                    default: valA = 0; valB = 0;
                }
                if (valA < valB) return sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [products, deferredSearchTerm, activeCategory, sortField, sortDir, effectiveRate]);

    return { filteredProducts };
}
