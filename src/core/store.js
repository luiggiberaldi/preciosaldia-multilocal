import { create } from 'zustand';
import { tenantConfig } from '../config/tenant';

// Store Core que todas las apps utilizarán
//
// HOOK-006: Eliminados `cart`, `addToCart`, `clearCart` — el carrito vive
// exclusivamente en `CartContext` (React Context). La versión Zustand era
// legacy y no se usaba en ningún lugar (verificado con grep: cero callers
// de `useAppStore` fuera de este archivo).
//
// HOOK-035: Eliminados `user` y `setUser` — duplicaban `useAuthStore.usuarioActivo`
// y no se usaban en ningún lugar (verificado con grep). La autenticación de
// usuarios se centraliza en `src/hooks/store/useAuthStore.js`.
export const useAppStore = create(() => ({
    // Theme global (Dictado por config/tenant.js)
    theme: tenantConfig.themeMode,
    tenantFeatures: tenantConfig.features,
}));
