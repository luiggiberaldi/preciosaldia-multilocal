import { useState } from 'react';

export function useProductSorting() {
    const [sortField, setSortField] = useState(null);
    const [sortDir, setSortDir] = useState('asc');

    const handleSort = (field, setCurrentPage) => {
        if (sortField === field) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
        setCurrentPage(1);
    };

    return {
        sortField, setSortField,
        sortDir, setSortDir,
        handleSort,
    };
}
