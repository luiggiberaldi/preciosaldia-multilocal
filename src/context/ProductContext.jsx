import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { shadowBackupService } from '../utils/shadowBackupService';
import { BODEGA_CATEGORIES } from '../config/categories';
import { pushLocalSync, pushCloudSync } from '../hooks/useCloudSync';
import { useRateContext } from './RateContext';
import { showToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { AlertTriangle, ShieldAlert, RotateCcw } from 'lucide-react';
import { isGranelProduct, adjustStockValue, normalizeStockValue } from '../utils/granel.js'; // GRANEL-001

// Mantener una única instancia durante HMR y cargas lazy. Si Vite recarga este
// módulo mientras una vista lazy conserva la versión anterior, un Context nuevo
// deja al consumidor sin su Provider aunque el árbol JSX sea correcto.
const PRODUCT_CONTEXT_KEY = '__preciosaldia_product_context__';
const ProductContext = globalThis[PRODUCT_CONTEXT_KEY] || createContext();
globalThis[PRODUCT_CONTEXT_KEY] = ProductContext;

const normalizeCategories = (cats) => {
    const list = Array.isArray(cats) ? cats : [];
    return list.map(cat => {
        if (!cat) return null;
        if (typeof cat === 'string') {
            return {
                id: cat.toLowerCase().replace(/\s+/g, '_'),
                label: cat.charAt(0).toUpperCase() + cat.slice(1),
                icon: '📦',
                color: 'slate'
            };
        }
        if (typeof cat === 'object') {
            const label = cat.label || cat.name || cat.id || 'Categoría';
            const id = cat.id || label.toLowerCase().replace(/\s+/g, '_');
            return {
                ...cat,
                id,
                label,
                icon: cat.icon || '📦',
                color: cat.color || 'slate'
            };
        }
        return null;
    }).filter(Boolean);
};

export function ProductProvider({ children }) {
    const rateState = useRateContext();

    const [products, setProducts] = useState([]);
    const [categories, setRawCategories] = useState(() => normalizeCategories(BODEGA_CATEGORIES));
    const setCategories = useCallback((cats) => {
        setRawCategories(prev => {
            const next = typeof cats === 'function' ? cats(prev) : cats;
            return normalizeCategories(next);
        });
    }, []);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);
    const [circuitBreakerWarning, setCircuitBreakerWarning] = useState(null);

    // Guard ref: prevents infinite loop when auto-save fires app_storage_update
    const savingRef = useRef(false);
    const hasMountedRef = useRef(false);
    const productsRef = useRef(products);
    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    // CHECKOUT MODE — 'auto' (Detección inteligente) | 'basic' (Móvil) | 'pos' (PC)
    const [checkoutMode, setCheckoutModeState] = useState(() => {
        return localStorage.getItem('checkout_mode') || 'auto';
    });
    const setCheckoutMode = (mode) => {
        setCheckoutModeState(mode);
        localStorage.setItem('checkout_mode', mode);
    };

    // Resuelve dinámicamente si el modal de cobro activo debe ser 'basic' (Móvil) o 'pos' (PC).
    // FASE 5 — feature flag `checkout_shell_v2`: en 'true' fuerza el modo 'basic'
    // (shell móvil del rediseño) incluso en pantallas ≥1024px. Palanca de
    // rollback/soporte en campo: apagar el flag restaura el comportamiento previo.
    const effectiveCheckoutMode = useMemo(() => {
        if (checkoutMode === 'basic') return 'basic';
        if (checkoutMode === 'pos' && localStorage.getItem('checkout_shell_v2') !== 'true') return 'pos';
        if (typeof window === 'undefined') return 'basic';

        const isMobile = window.innerWidth < 1024 ||
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator?.userAgent || '');

        return isMobile ? 'basic' : 'pos';
    }, [checkoutMode]);

    // Initial Load
    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            const savedProducts = await storageService.getItem('bodega_products_v1', []);
            const savedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
            if (isMounted) {
                setProducts(savedProducts);
                setCategories(savedCategories);
                setIsLoadingProducts(false);
            }
        };
        loadData();
        return () => { isMounted = false; };
    }, []);

    // Escuchar actualizaciones remotas del almacén de datos (ej. useMonitorSync en Modo Supervisor)
    useEffect(() => {
        const handleStorageUpdate = async (e) => {
            if (savingRef.current && e?.detail?.source !== 'remote') return;
            const updatedKey = e?.detail?.key || e?.key;
            if (!updatedKey || updatedKey === 'bodega_products_v1') {
                const refreshedProducts = await storageService.getItem('bodega_products_v1', []);
                setProducts(refreshedProducts);
            }
        };

        window.addEventListener('app_storage_update', handleStorageUpdate);
        window.addEventListener('storage', handleStorageUpdate);
        return () => {
            window.removeEventListener('app_storage_update', handleStorageUpdate);
            window.removeEventListener('storage', handleStorageUpdate);
        };
    }, []);

    // One-time migration: assign priceCop to existing products that don't have it
    useEffect(() => {
        if (isLoadingProducts || products.length === 0) return;
        if (!rateState?.copEnabled || !rateState?.tasaCop || rateState.tasaCop <= 0) return;
        if (localStorage.getItem('priceCop_migration_v1') === 'done') return;

        const needsMigration = products.some(p => p.priceUsdt > 0 && (p.priceCop == null || p.priceCop <= 0));
        if (!needsMigration) {
            localStorage.setItem('priceCop_migration_v1', 'done');
            return;
        }

        const migrated = products.map(p => {
            if (p.priceUsdt > 0 && (p.priceCop == null || p.priceCop <= 0) && rateState.copEnabled && rateState.tasaCop > 0) {
                const priceCop = Math.round(p.priceUsdt * rateState.tasaCop);
                const unitPriceCop = p.unitPriceUsd > 0
                    ? Math.round(p.unitPriceUsd * rateState.tasaCop)
                    : null;
                return { ...p, priceCop, ...(unitPriceCop ? { unitPriceCop } : {}) };
            }
            return p;
        });

        setProducts(migrated);
        localStorage.setItem('priceCop_migration_v1', 'done');
    }, [isLoadingProducts, products.length, rateState?.copEnabled, rateState?.tasaCop]);

    // Set Initial Street Rate (from BCV)
    useEffect(() => {
        if (!rateState?.streetRate && rateState?.rates?.bcv?.price > 0 && !localStorage.getItem('street_rate_bs')) {
            rateState.setStreetRate(rateState.rates.bcv.price);
        }
    }, [rateState?.rates?.bcv?.price, rateState?.streetRate, rateState?.setStreetRate]);

    // Auto-save products and categories with Debounce (Performance Fix)
    useEffect(() => {
        if (isLoadingProducts) return;

        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }

        savingRef.current = true;

        const timer = setTimeout(() => {
            const savePromises = [];
            if (products.length > 0) {
                savePromises.push(storageService.setItem('bodega_products_v1', products));
            } else {
                // VUL-003 Guard: Solo borrar si hay confirmación explícita de admin
                const isConfirmed = localStorage.getItem('confirm_bulk_delete_catalog_flag') === 'true';
                if (isConfirmed) {
                    savePromises.push(storageService.removeItem('bodega_products_v1'));
                }
            }
            savePromises.push(storageService.setItem('my_categories_v1', categories));
            Promise.all(savePromises).finally(() => {
                setTimeout(() => { savingRef.current = false; }, 50);
            });
        }, 1000);

        return () => {
            clearTimeout(timer);
        };
    }, [products, categories, isLoadingProducts]);

    // Listener para actualizar productos/categorías y detectar el disyuntor Circuit Breaker
    useEffect(() => {
        const handleCircuitBreaker = (e) => {
            const detail = e.detail;
            setCircuitBreakerWarning(detail);
        };

        const handleStorageChange = (e) => {
            if (e.key === 'bodega_products_v1') {
                storageService.getItem('bodega_products_v1', []).then(updatedProducts => {
                    if (JSON.stringify(updatedProducts) !== JSON.stringify(productsRef.current)) {
                        setProducts(updatedProducts);
                    }
                });
            }
            if (e.key === 'my_categories_v1') {
                storageService.getItem('my_categories_v1', BODEGA_CATEGORIES).then(updatedCategories => setCategories(updatedCategories));
            }
        };

        const handleAppStorageUpdate = async (e) => {
            if (savingRef.current && e?.detail?.source !== 'remote') return;
            const key = e.detail?.key;
            if (!key) return;

            if (key === 'bodega_products_v1') {
                const updatedProducts = await storageService.getItem('bodega_products_v1', []);
                if (JSON.stringify(updatedProducts) !== JSON.stringify(productsRef.current)) {
                    setProducts(updatedProducts);
                }
            }
            if (key === 'my_categories_v1') {
                const updatedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
                setCategories(updatedCategories);
            }
        };

        window.addEventListener('circuit_breaker_triggered', handleCircuitBreaker);
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('app_storage_update', handleAppStorageUpdate);
        return () => {
            window.removeEventListener('circuit_breaker_triggered', handleCircuitBreaker);
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('app_storage_update', handleAppStorageUpdate);
        };
    }, []);

    // Restauración de Copia de Sombra (Shadow Snapshot Restore)
    const restoreShadowBackup = useCallback(async () => {
        try {
            const restored = await shadowBackupService.restoreShadow('bodega_products_v1', storageService);
            if (restored && restored.data) {
                setProducts(restored.data);
                setCircuitBreakerWarning(null);
                showToast(`¡Catálogo restaurado desde copia de sombra! (${restored.count} productos)`, 'success');
                return true;
            }
        } catch (e) {
            showToast('No se pudo restaurar la copia de sombra', 'error');
        }
        return false;
    }, []);

    // GRANEL-001: ajuste con aritmética canónica — sin drift IEEE-754.
    // Granel → hasta 3 decimales; resto → entero estricto.
    const adjustStock = useCallback((productId, delta) => {
        setProducts(prevProducts => {
            const updated = prevProducts.map(p => {
                if (p.id === productId) {
                    const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                    const isGranel = isGranelProduct(p);
                    const newStock = adjustStockValue(p.stock ?? 0, delta, isGranel);
                    return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
                }
                return p;
            });
            storageService.setItem('bodega_products_v1', updated);
            return updated;
        });
    }, []);

    // GRANEL-001: fijar el stock directamente (edición inline en tarjeta/lista).
    // Aplica el mismo guardarraíl de tipado y respeta allow_negative_stock.
    const setDirectStock = useCallback((productId, newStockRaw) => {
        setProducts(prevProducts => {
            const updated = prevProducts.map(p => {
                if (p.id === productId) {
                    const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                    const isGranel = isGranelProduct(p);
                    const newStock = normalizeStockValue(newStockRaw, isGranel);
                    return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
                }
                return p;
            });
            storageService.setItem('bodega_products_v1', updated);
            return updated;
        });
    }, []);

    // Métricas Financieras del Inventario (Valor Total Venta $, Costo de Inversión $, Ganancia $, Margen %)
    const inventoryFinancials = useMemo(() => {
        let totalRetailUsd = 0;
        let totalCostUsd = 0;
        let totalUnits = 0;

        products.forEach(p => {
            const stockQty = p.stock ?? 0;
            if (stockQty <= 0) return;

            const retailPrice = (p.sellByUnit && p.unitPriceUsd > 0) ? p.unitPriceUsd : (p.priceUsdt || p.priceUsd || 0);
            const unitsCount = (p.sellByUnit && p.unitsPerPackage > 1) ? (stockQty * p.unitsPerPackage) : stockQty;

            totalRetailUsd += (retailPrice * unitsCount);
            totalUnits += stockQty;

            const cost = p.costUsd || 0;
            totalCostUsd += (cost * stockQty);
        });

        const totalProfitUsd = totalRetailUsd - totalCostUsd;
        const marginPct = totalRetailUsd > 0 ? (totalProfitUsd / totalRetailUsd) * 100 : 0;
        const markupPct = totalCostUsd > 0 ? (totalProfitUsd / totalCostUsd) * 100 : 0;

        return {
            totalRetailUsd,
            totalCostUsd,
            totalProfitUsd,
            marginPct,
            markupPct,
            totalUnits
        };
    }, [products]);

    const value = useMemo(() => ({
        ...rateState,
        products,
        setProducts,
        categories,
        setCategories,
        isLoadingProducts,
        checkoutMode,
        effectiveCheckoutMode,
        setCheckoutMode,
        adjustStock,
        setDirectStock,
        restoreShadowBackup,
        inventoryFinancials
    }), [
        rateState,
        products,
        categories,
        isLoadingProducts,
        checkoutMode,
        effectiveCheckoutMode,
        adjustStock,
        setDirectStock,
        restoreShadowBackup,
        inventoryFinancials
    ]);

    return (
        <ProductContext.Provider value={value}>
            {children}

            {/* Modal de Advertencia del Circuit Breaker en UI */}
            {circuitBreakerWarning && (
                <Modal
                    isOpen={true}
                    onClose={() => setCircuitBreakerWarning(null)}
                    title="⚠️ Intento de Sobrescritura Anómala Bloqueado"
                >
                    <div className="space-y-4 p-2">
                        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-600 dark:text-red-400">
                            <ShieldAlert className="shrink-0" size={32} />
                            <div>
                                <h4 className="font-black text-sm uppercase tracking-wide">Circuit Breaker Activado</h4>
                                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                    Se detectó un intento de reducir el inventario de <strong>{circuitBreakerWarning.currentCount}</strong> a <strong>{circuitBreakerWarning.incomingCount}</strong> productos (&lt;10% del total).
                                </p>
                            </div>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-400">
                            Por la seguridad de tus datos, la operación fue bloqueada automáticamente para evitar el vaciado accidental de tu catálogo.
                        </p>

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setCircuitBreakerWarning(null)}
                                className="flex-1 py-3 bg-surface-200 dark:bg-surface-800 text-surface-800 dark:text-white font-bold rounded-xl active:scale-95 transition-all text-xs"
                            >
                                Entendido, Mantener Actual
                            </button>
                            <button
                                onClick={restoreShadowBackup}
                                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl active:scale-95 transition-all flex items-center justify-center gap-2 text-xs"
                            >
                                <RotateCcw size={16} /> Restaurar Copia de Sombra
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </ProductContext.Provider>
    );
}

export const useProductContext = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error("useProductContext must be used within a ProductProvider");
    }
    return context;
};
