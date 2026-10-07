// src/config/tenant.js

export const TENANTS = {
    REVENDEDOR: 'REVENDEDOR', // El proyecto original
    BODEGA: 'BODEGA',         // Maneja stock, balanzas, cobro rápido
    COMIDA: 'COMIDA',         // Modificadores, comandas, facturación rápida
    REPUESTOS: 'REPUESTOS',   // SKU complejo, número de parte, vehículos
    QUINCALLERIA: 'QUINCALLERIA' // Mayor vs Detal
};

// -------------------------------------------------------------
// [CONFIGURACIÓN ACTIVA] -> Cambia esto para generar el nuevo MVP
// -------------------------------------------------------------
export const ACTIVE_TENANT = TENANTS.BODEGA;

// Configuración de metadatos globales de la UI dependiendo del MVP
export const getTenantTheme = () => {
    switch (ACTIVE_TENANT) {
        case TENANTS.BODEGA:
            return {
                appName: 'Mi Bodega Inteligente',
                primaryColor: 'emerald', // Colores definidos en tailwind.config
                themeMode: 'light', // o dark
                features: {
                    hasInventoryTracking: true,
                    hasWeightScale: true,
                    hasSku: false
                }
            };
        case TENANTS.COMIDA:
            return {
                appName: 'Comanda Express',
                primaryColor: 'orange',
                themeMode: 'dark',
                features: {
                    hasModifiers: true,
                    hasTables: true,
                    hasSku: false
                }
            };
        case TENANTS.REPUESTOS:
            return {
                appName: 'AutoParts Pro',
                primaryColor: 'blue',
                themeMode: 'light',
                features: {
                    hasInventoryTracking: true,
                    hasWeightScale: false,
                    hasSku: true
                }
            };
        case TENANTS.REVENDEDOR:
        default:
            return {
                appName: 'Precios al Día',
                primaryColor: 'brand',
                themeMode: 'dark', // Legacy preference
                features: {
                    hasInventoryTracking: false,
                    hasWeightScale: false,
                    hasSku: false
                }
            };
    }
};

export const tenantConfig = getTenantTheme();
