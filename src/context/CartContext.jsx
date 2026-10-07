import React, { createContext, useContext, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { isGranelProduct, normalizeCartQuantity } from '../utils/granel'; // GRANEL-001

// HOOK-006: CartContext es la ÚNICA fuente de verdad del carrito.
// Antes había estado duplicado en `useAppStore` (Zustand) y aquí mismo;
// la versión Zustand era legacy y se eliminó en `src/core/store.js`.
const CartContext = createContext(null);

export function CartProvider({ children }) {
    const [cart, setCart] = useState([]);
    const cartRef = useRef(cart);
    useEffect(() => { cartRef.current = cart; }, [cart]);

    // Navegacion destino tras cargar carrito reciclado
    const [pendingNavigate, setPendingNavigate] = useState(null);

    // Estado del descuento global
    const [discount, setDiscount] = useState({ type: 'percentage', value: 0 });

    /**
     * Carga un carrito reciclado desde cualquier parte de la app.
     * @param {Array} items - Array de items de la venta original
     * @param {string} navigateTo - Tab destino (e.g. 'ventas')
     */
    const loadCart = useCallback((items, navigateTo = 'ventas') => {
        if (!Array.isArray(items) || items.length === 0) return;
        setCart(items.map(item => {
            const itemIsGranel = isGranelProduct(item);
            const normalizedQty = normalizeCartQuantity(item.qty, itemIsGranel);
            return {
                ...item,
                id: item.id,
                name: item.name,
                qty: normalizedQty > 0 ? normalizedQty : 1,
                priceUsd: item.priceUsd,
                costBs: item.costBs || 0,
                costUsd: item.costUsd || 0,
                isWeight: itemIsGranel,
            };
        }));
        setPendingNavigate(navigateTo);
    }, []);

    const clearCart = useCallback(() => {
        setCart([]);
        setDiscount({ type: 'percentage', value: 0 });
    }, []);

    // HOOK-005: Memoizar el value para que los consumidores no se re-rendericen
    // en cada render del provider a menos que el carrito o el descuento cambien.
    // setCart/setPendingNavigate/setDiscount son estables (de useState).
    const value = useMemo(() => ({
        cart, setCart, cartRef, loadCart, clearCart,
        pendingNavigate, setPendingNavigate,
        discount, setDiscount
    }), [cart, pendingNavigate, discount, loadCart, clearCart]);

    return (
        <CartContext.Provider value={value}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error('useCart must be used within a CartProvider');
    return ctx;
}
