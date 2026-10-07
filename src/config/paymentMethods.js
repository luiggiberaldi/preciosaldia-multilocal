import { storageService } from '../utils/storageService';
import { Banknote, Smartphone, CreditCard, DollarSign, Store, ShoppingCart, Package, Coins, Key, Fingerprint, Wallet } from 'lucide-react';

const PM_KEY = 'bodega_payment_methods_v1';

// Método virtual protegido: representa crédito interno, no dinero recibido.
export const INTERNAL_CREDIT_PAYMENT_METHOD = Object.freeze({
    id: 'saldo_favor',
    label: 'Saldo a Favor',
    icon: '💰',
    currency: 'INTERNAL_CREDIT',
    isFactory: true,
    isVirtual: true,
    isInternalCredit: true,
    isEnabled: true,
});

// ── MÉTODOS DE FÁBRICA (no editables, no eliminables) ──
export const FACTORY_PAYMENT_METHODS = [
    // Bolívares
    { id: 'efectivo_bs', label: 'Efectivo en Bolívares', icon: '💵', Icon: Banknote, currency: 'BS', isFactory: true },
    { id: 'pago_movil', label: 'Pago Móvil', icon: '📱', Icon: Smartphone, currency: 'BS', isFactory: true },
    { id: 'punto_venta', label: 'Punto de Venta', icon: '💳', Icon: CreditCard, currency: 'BS', isFactory: true },
    // Dólares
    { id: 'efectivo_usd', label: 'Efectivo en Dólares', icon: '💲', Icon: DollarSign, currency: 'USD', isFactory: true },
    // Pesos
    { id: 'efectivo_cop', label: 'Efectivo en Pesos', icon: '🟡', Icon: Coins, currency: 'COP', isFactory: true },
    { id: 'transferencia_cop', label: 'Transferencia COP', icon: '🏦', Icon: Store, currency: 'COP', isFactory: true },
];

// Alias para compatibilidad
export const DEFAULT_PAYMENT_METHODS = FACTORY_PAYMENT_METHODS;

// ── PERSISTENCIA ──

/** Normaliza un nombre para comparar duplicados */
function _normLabel(s) {
    return (s || '').toLowerCase().trim()
        .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
        .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u')
        .replace(/\s+/g, ' ');
}

/** Obtener TODOS los métodos (activos e inactivos) */
export async function getAllPaymentMethods() {
    const saved = await storageService.getItem(PM_KEY, null) || [];

    // Si no hay nada guardado aún, devolver los de fábrica activos
    if (saved.length === 0) {
        return [...FACTORY_PAYMENT_METHODS].map(m => ({ ...m, isEnabled: true }));
    }

    // 1. Fusionar métodos de fábrica con la config guardada
    const mergedFactory = FACTORY_PAYMENT_METHODS.map(factoryMethod => {
        const savedMethod = saved.find(m => m.id === factoryMethod.id);
        return {
            ...factoryMethod,
            isEnabled: savedMethod ? savedMethod.isEnabled !== false : true,
        };
    });

    // 2. Extraer los métodos custom guardados y rehidratar el icono
    let rawCustom = saved.filter(m => !m.isFactory);

    // 2b. Migración: corregir métodos custom con nombre de pesos colombianos
    //     pero moneda BS — claramente mal configurados, deben ser COP.
    const COP_KEYWORDS = ['peso', 'cop', 'colombiano', 'pesos col'];
    let hadCurrencyFix = false;
    rawCustom = rawCustom.map(m => {
        if (m.currency === 'BS') {
            const norm = _normLabel(m.label);
            if (COP_KEYWORDS.some(kw => norm.includes(kw))) {
                hadCurrencyFix = true;
                return { ...m, currency: 'COP' };
            }
        }
        return m;
    });

    // 3. Deduplicar: eliminar custom methods cuyo nombre normalizado ya existe
    //    (sea en fábrica o en otro custom anterior)
    const seenLabels = new Set(FACTORY_PAYMENT_METHODS.map(m => _normLabel(m.label)));
    const dedupedCustom = [];
    let hadDuplicates = false;
    for (const m of rawCustom) {
        const norm = _normLabel(m.label);
        if (seenLabels.has(norm)) {
            hadDuplicates = true; // silently drop duplicate
        } else {
            seenLabels.add(norm);
            dedupedCustom.push(m);
        }
    }

    // Si se eliminaron duplicados o se corrigieron monedas, persistir la lista limpia
    if (hadDuplicates || hadCurrencyFix) {
        const cleaned = [...mergedFactory, ...dedupedCustom];
        storageService.setItem(PM_KEY, cleaned.map(({ Icon, ...rest }) => rest)).catch(() => {});
    }

    const customMethods = dedupedCustom.map(m => ({
        ...m,
        isEnabled: m.isEnabled !== false,
        Icon: ICON_COMPONENTS[m.icon] || null,
    }));

    return [...mergedFactory, ...customMethods];
}

/** Obtener métodos activos (fábrica + custom) para el Checkout */
export async function getActivePaymentMethods() {
    const all = await getAllPaymentMethods();
    return all.filter(m => m.isEnabled !== false);
}

/** Guardar métodos (reemplaza todo el array) */
export async function savePaymentMethods(methods) {
    // Serializar: quitar campos no-clonables (Icon, componentes React)
    const serializable = methods.map(m => {
        const { Icon, ...rest } = m;
        return rest;
    });
    await storageService.setItem(PM_KEY, serializable);
    // Refresh in-memory cache immediately
    _customMethodsCache = serializable;
}

/** Agregar un método custom */
export async function addPaymentMethod({ label, currency, icon }) {
    const methods = await getAllPaymentMethods();
    const newMethod = {
        id: 'custom_' + Date.now(),
        label,
        icon: icon || (currency === 'USD' ? '💲' : '💵'),
        currency,
        isFactory: false,
    };
    methods.push(newMethod);
    await savePaymentMethods(methods);
    return methods;
}

/** Eliminar un método (solo custom, no fábrica) */
export async function removePaymentMethod(id) {
    const methods = await getAllPaymentMethods();
    const filtered = methods.filter(m => m.id !== id || m.isFactory);
    await savePaymentMethods(filtered);
    return filtered;
}

/** Habilitar/deshabilitar un método */
export async function togglePaymentMethodEnabled(id) {
    const methods = await getAllPaymentMethods();
    const updated = methods.map(m => {
        if (m.id === id) {
            return { ...m, isEnabled: m.isEnabled === false ? true : false };
        }
        return m;
    });
    await savePaymentMethods(updated);
    return await getAllPaymentMethods(); // Return correctly hydrated array
}

// ── HELPERS ──

export const toTitleCase = (str) => {
    if (!str) return '';
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
};

// In-memory cache for synchronous lookups (populated from IndexedDB)
let _customMethodsCache = null;
let _cacheInitPromise = null;

async function _initCache() {
    try {
        const saved = await storageService.getItem(PM_KEY, null);
        _customMethodsCache = saved || [];
    } catch (e) {
        _customMethodsCache = [];
    }
}

// Call this early in the app lifecycle to warm up the cache
export function initPaymentMethodsCache() {
    if (!_cacheInitPromise) {
        _cacheInitPromise = _initCache();
    }
    return _cacheInitPromise;
}

// Auto-init on module load
initPaymentMethodsCache();

function _findCustom(id) {
    if (!_customMethodsCache) return null;
    return _customMethodsCache.find(m => m.id === id) || null;
}

export const getPaymentLabel = (id, fallbackLabel) => {
    // Check factory methods first
    const factory = FACTORY_PAYMENT_METHODS.find(m => m.id === id);
    if (factory) return toTitleCase(factory.label);

    // Check in-memory cache (populated from IndexedDB)
    const custom = _findCustom(id);
    if (custom && custom.label) return toTitleCase(custom.label);
    
    // Virtual categories (not selectable, display-only)
    if (id === 'fiado') return 'Fiado (Por Cobrar)';
    if (id === 'cashea') return 'Cashea (Por Cobrar)';
    if (id === 'saldo_favor') return 'Saldo a Favor';
    if (id === 'saldo_favor_generado' || id === '_saldo_favor_generado') return 'Saldo a Favor Generado';

    // Use fallback if provided and it's not a raw ID
    if (fallbackLabel && typeof fallbackLabel === 'string' && fallbackLabel !== id && !fallbackLabel.startsWith('custom_')) {
        return toTitleCase(fallbackLabel);
    }

    if (id && typeof id === 'string' && id.startsWith('custom_')) return 'Metodo Personalizado';

    return toTitleCase(String(id || ''));
};

export const getPaymentIcon = (id) => {
    // Check factory
    const factory = FACTORY_PAYMENT_METHODS.find(m => m.id === id);
    if (factory) return factory.Icon;

    // Check in-memory cache
    const custom = _findCustom(id);
    if (custom && custom.icon) return ICON_COMPONENTS[custom.icon] || null;
    
    if (id === 'cashea') return Smartphone;
    if (id === 'saldo_favor') return Wallet;
    if (id === 'saldo_favor_generado' || id === '_saldo_favor_generado') return Wallet;

    return null;
};

// Icon lookup for React components
export const PAYMENT_ICONS = {
    efectivo_bs: Banknote,
    pago_movil: Smartphone,
    punto_venta: CreditCard,
    efectivo_usd: DollarSign,
    fiado: ShoppingCart,
    cashea: Smartphone,
    saldo_favor: Wallet,
};

// Mapa para rehidratar íconos custom por su key string
export const ICON_COMPONENTS = {
    Banknote, Smartphone, CreditCard, DollarSign,
    Store, ShoppingCart, Package, Coins, Key, Fingerprint, Wallet,
};

export const getPaymentMethod = (id) => {
    const factory = FACTORY_PAYMENT_METHODS.find(m => m.id === id);
    if (factory) return factory;
    if (id === 'saldo_favor') return INTERNAL_CREDIT_PAYMENT_METHOD;

    // Check in-memory cache
    const custom = _findCustom(id);
    if (custom) return { ...custom, Icon: ICON_COMPONENTS[custom.icon] || null };

    return FACTORY_PAYMENT_METHODS[0];
};

// Colores por método (para dashboard/historial)
export const PAYMENT_COLORS = {
    emerald: {
        active: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20',
        text: 'text-emerald-600 dark:text-emerald-400',
        icon: 'text-emerald-500',
        bar: 'bg-emerald-500',
    },
    indigo: {
        active: 'border-brand bg-brand-light dark:bg-surface-800',
        text: 'text-brand-dark dark:text-brand',
        icon: 'text-brand',
        bar: 'bg-brand',
    },
    violet: {
        active: 'border-brand bg-brand-light dark:bg-surface-800',
        text: 'text-brand-dark dark:text-brand',
        icon: 'text-brand',
        bar: 'bg-brand',
    },
    blue: {
        active: 'border-brand bg-brand-light dark:bg-surface-800',
        text: 'text-brand-dark dark:text-brand',
        icon: 'text-brand',
        bar: 'bg-brand',
    },
};
