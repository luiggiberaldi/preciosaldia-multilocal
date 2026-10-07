import { useState, useEffect, useRef } from 'react';
import { storageService } from '../utils/storageService';

const SALES_KEY = 'bodega_sales_v1';

export function useDashboardData(isActive, requestPermission) {
    const [sales, setSales] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(true);
    const hasRequestedPermRef = useRef(false);

    useEffect(() => {
        if (!isActive) return;
        let mounted = true;
        const load = async () => {
            const [savedSales, savedCustomers] = await Promise.all([
                storageService.getItem(SALES_KEY, []),
                storageService.getItem('bodega_customers_v1', []),
            ]);
            if (mounted) {
                setSales(savedSales);
                setCustomers(savedCustomers);
                setIsLoadingLocal(false);
            }
        };
        load();
        // Solicitar permiso de notificaciones al primer uso
        if (!hasRequestedPermRef.current) { hasRequestedPermRef.current = true; requestPermission(); }
        return () => { mounted = false; };
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return undefined;
        let mounted = true;
        const reloadRemoteSales = async (event) => {
            if (event.detail?.source !== 'remote' || event.detail.key !== SALES_KEY) return;
            // Pull de la nube puede llegar después del primer render; el estado
            // del dashboard no depende solo de montar o cambiar de pestaña.
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (!mounted) return;
            const savedSales = await storageService.getItem(SALES_KEY, []);
            if (mounted) setSales(savedSales);
        };
        window.addEventListener('app_storage_update', reloadRemoteSales);
        return () => {
            mounted = false;
            window.removeEventListener('app_storage_update', reloadRemoteSales);
        };
    }, [isActive]);

    const refreshData = async () => {
        const [savedSales, savedCustomers] = await Promise.all([
            storageService.getItem(SALES_KEY, []),
            storageService.getItem('bodega_customers_v1', []),
        ]);
        setSales(savedSales);
        setCustomers(savedCustomers);
    };

    return { sales, setSales, customers, setCustomers, isLoadingLocal, refreshData };
}
