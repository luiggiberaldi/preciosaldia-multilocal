import { useState, useEffect, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { getActivePaymentMethods, INTERNAL_CREDIT_PAYMENT_METHOD } from '../config/paymentMethods';
import { getLocalISODate } from '../utils/dateHelpers';
import { migrateCustomerLedger } from '../utils/customerMigration';
import { isGranelProduct, normalizeCartQuantity } from '../utils/granel'; // GRANEL-001

export const SALES_KEY = 'bodega_sales_v1';

function addInternalCreditMethod(methods) {
    return [
        ...(Array.isArray(methods) ? methods : []),
        { ...INTERNAL_CREDIT_PAYMENT_METHOD },
    ];
}

function sanitizeCart(rawCart) {
    if (!Array.isArray(rawCart)) return [];
    return rawCart
        .filter(item => item && typeof item === 'object')
        .map((item, idx) => {
            const itemIsGranel = isGranelProduct(item);
            const normalizedQty = normalizeCartQuantity(item.qty, itemIsGranel);
            return {
                ...item,
                id: item.id ?? `legacy_cart_item_${idx}_${Date.now()}`,
                name: item.name || 'Producto Sin Nombre',
                // Corrige una cesta legacy: granel conserva 3 decimales; el resto
                // queda en entero estricto antes de llegar a la UI.
                qty: normalizedQty > 0 ? normalizedQty : 1,
                priceUsd: typeof item.priceUsd === 'number' && !isNaN(item.priceUsd) ? item.priceUsd : 0,
                isWeight: itemIsGranel,
            };
        });
}

export function useSalesData({ setCart, cartRef, isActive }) {
    const [customers, setCustomers] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(true);
    const [salesData, setSalesData] = useState([]);
    const [todayAperturaData, setTodayAperturaData] = useState(null);

    // Load data
    useEffect(() => {
        let mounted = true;
        const load = async () => {
            try {
                await migrateCustomerLedger();
            } catch (error) {
                console.error('[useSalesData] No se pudo migrar la cartera:', error);
            }
            const [savedCustomers, methods, savedCart, savedSales] = await Promise.all([
                storageService.getItem('bodega_customers_v1', []),
                getActivePaymentMethods(),
                storageService.getItem('bodega_pending_cart_v1', []),
                storageService.getItem(SALES_KEY, [])
            ]);
            if (mounted) { setSalesData(savedSales); }
            if (mounted) {
                setCustomers(savedCustomers);
                setPaymentMethods(addInternalCreditMethod(methods));

                // Sanitizar el carrito de posibles ítems nulos o corruptos antes de cargarlo
                const cleanCart = sanitizeCart(savedCart);
                if (cleanCart.length > 0 && cartRef.current.length === 0) {
                    setCart(cleanCart);
                }

                // Check Apertura (timezone-safe)
                const todayStr = getLocalISODate(new Date());
                const apertura = savedSales.find(s => {
                    if (s.tipo !== 'APERTURA_CAJA' || s.cajaCerrada) return false;
                    const saleDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : todayStr;
                    return saleDay === todayStr;
                });
                setTodayAperturaData(apertura || null);

                setIsLoadingLocal(false);

            }
        };
        load();
        return () => { mounted = false; };
    }, []);

    // Refresh payment methods and customers when tab becomes active (consolidates window focus + isActive)
    const handleReloadContent = useCallback(() => {
        if (!isActive) return;
        Promise.all([
            migrateCustomerLedger().catch(error => console.error('[useSalesData] Error migrando cartera:', error)),
            getActivePaymentMethods(),
            storageService.getItem('bodega_customers_v1', []),
            storageService.getItem(SALES_KEY, [])
        ]).then(([, methods, savedCustomers, savedSales]) => {
            setPaymentMethods(addInternalCreditMethod(methods));
            setCustomers(savedCustomers);
            setSalesData(savedSales);

            // Recalculate Apertura (uses imported getLocalISODate)
            const todayStr = getLocalISODate(new Date());

            const apertura = savedSales.find(s => {
                if (s.tipo !== 'APERTURA_CAJA' || s.cajaCerrada) return false;
                const saleLocalDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : todayStr;
                return saleLocalDay === todayStr;
            });
            setTodayAperturaData(apertura || null);
        }).catch(err => console.error('[useSalesData] Error al recargar datos:', err));
    }, [isActive]);

    useEffect(() => {
        handleReloadContent();
    }, [handleReloadContent]);

    // Recargar cuando la app vuelve desde el background en móviles (PWA) o cuando hay un cambio en el storage
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                handleReloadContent();
            }
        };

        const onStorageUpdate = (e) => {
            if (e.detail && e.detail.key === SALES_KEY) {
                // Pequeño timeout para dar margen a que IndexedDB haya persistido los datos
                setTimeout(handleReloadContent, 50);
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('focus', handleReloadContent);
        window.addEventListener('app_storage_update', onStorageUpdate);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('focus', handleReloadContent);
            window.removeEventListener('app_storage_update', onStorageUpdate);
        };
    }, [handleReloadContent]);

    return {
        customers, setCustomers,
        paymentMethods, setPaymentMethods,
        isLoadingLocal,
        salesData, setSalesData,
        todayAperturaData, setTodayAperturaData,
        refreshData: handleReloadContent,
    };
}
