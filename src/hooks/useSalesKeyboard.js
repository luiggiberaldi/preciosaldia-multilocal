import { useEffect } from 'react';
import { isGranelProduct } from '../utils/granel'; // GRANEL-001

export function useSalesKeyboard({
    todayAperturaData,
    showCheckout,
    showReceipt,
    hierarchyPending,
    weightPending,
    showClearCartConfirm,
    showCustomAmountModal,
    showRateConfig,
    showKeyboardHelp,
    showDiscountModal,
    searchInputRef,
    setCartSelectedIndex,
    setShowClearCartConfirm,
    cartRef,
    setShowCheckout,
    cartSelectedIndex,
    updateQty,
    removeFromCart
}) {
    useEffect(() => {
        const handleGlobalKeys = (e) => {
            if (!todayAperturaData) return; // Block all shortcuts if box is closed
            
            // Block shortcuts if any modal is open
            if (showCheckout || showReceipt || hierarchyPending || weightPending || showClearCartConfirm || showCustomAmountModal || showRateConfig || showKeyboardHelp || showDiscountModal) return;

            const isTyping = document.activeElement === searchInputRef.current || document.activeElement?.tagName === 'INPUT';

            // F2 or Enter (when not typing): Focus Search
            if (e.key === 'F2' || (e.key === 'Enter' && !isTyping)) {
                e.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
                setCartSelectedIndex(-1); // Resets cart focus
                return;
            }

            // F4: Clear Cart
            if (e.key === 'F4') {
                e.preventDefault();
                if (cartRef.current.length > 0) setShowClearCartConfirm(true);
                return;
            }

            // F9: Process Checkout
            if (e.key === 'F9') {
                e.preventDefault();
                if (cartRef.current.length > 0) setShowCheckout(true);
                return;
            }

            // --- Cart Navigation and Modification ---
            if (!isTyping && cartRef.current.length > 0) {
                let currentCartIndices = cartRef.current.length - 1;
                let activeIdx = cartSelectedIndex === -1 ? currentCartIndices : cartSelectedIndex; // Default to last item if none selected

                const item = cartRef.current[activeIdx];
                if (!item) return;

                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCartSelectedIndex(Math.max(0, activeIdx - 1));
                    return;
                }
                
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCartSelectedIndex(Math.min(currentCartIndices, activeIdx + 1));
                    return;
                }

                if (e.key === '+' || e.key === 'Add') {
                    e.preventDefault();
                    updateQty(item.id, isGranelProduct(item) ? 0.1 : 1);
                    setCartSelectedIndex(activeIdx); // Ensure selection is active
                    return;
                }
                
                if (e.key === '-' || e.key === 'Subtract') {
                    e.preventDefault();
                    updateQty(item.id, isGranelProduct(item) ? -0.1 : -1);
                    setCartSelectedIndex(activeIdx);
                    return;
                }

                if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    removeFromCart(item.id);
                    if (cartRef.current.length <= 1) { // Will be 0 after update
                        setCartSelectedIndex(-1);
                        searchInputRef.current?.focus();
                    } else {
                        setCartSelectedIndex(Math.max(0, activeIdx - 1));
                    }
                    return;
                }
                
                if (e.key === 'Enter' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setCartSelectedIndex(-1);
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeys);
        return () => window.removeEventListener('keydown', handleGlobalKeys);
    }, [
        todayAperturaData, showCheckout, showReceipt, hierarchyPending, weightPending, 
        showClearCartConfirm, showCustomAmountModal, showRateConfig, showKeyboardHelp, 
        showDiscountModal, searchInputRef, setCartSelectedIndex, setShowClearCartConfirm, 
        cartRef, setShowCheckout, cartSelectedIndex, updateQty, removeFromCart
    ]);
}
