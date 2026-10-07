import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * UpdateBanner Component (A-001/B-003)
 * Muestra un banner discreto cuando hay una actualización de PWA disponible.
 * Permite al cajero decidir cuándo aplicar la actualización sin perder transacciones activas.
 */
export function UpdateBanner() {
    const [showBanner, setShowBanner] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    useEffect(() => {
        const handleUpdateAvailable = () => {
            setShowBanner(true);
        };

        // main.jsx puede detectar el SW antes de que React monte este componente.
        // Consultar también la marca persistente evita perder la actualización.
        if (window.__pdaSwUpdateAvailable) {
            setShowBanner(true);
        }

        window.addEventListener('sw-update-available', handleUpdateAvailable);
        return () => window.removeEventListener('sw-update-available', handleUpdateAvailable);
    }, []);

    const applyUpdate = async () => {
        if (isUpdating) return;
        setIsUpdating(true);

        // FIX (2026-10-02): recarga directa y agresiva. La actualización
        // "elegante" del SW se colgaba en algunos navegadores. Un reload
        // simple es más confiable: el navegador descarga la nueva versión.
        try {
            // Intentar activar el SW en espera (best-effort, con timeout corto)
            if ('serviceWorker' in navigator) {
                const reg = await Promise.race([
                    navigator.serviceWorker.getRegistration(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
                ]).catch(() => null);
                if (reg?.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                    // Dar 1s al SW para activarse, luego recargar de todas formas
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        } catch {
            // Ignorar errores, igual recargamos
        }
        // Recarga forzada (bypass caché HTML)
        window.location.reload();
    };

    if (!showBanner) return null;

    // FIX (2026-10-02): z-index mayor que el LockScreen (z-[250]) para que
    // el botón "Actualizar ahora" no quede tapado por "Instalar App".
    return (
        <div className="fixed top-0 inset-x-0 z-[300] bg-emerald-600 text-white px-4 py-2 flex items-center justify-between text-sm font-medium shadow-md">
            <div className="flex items-center gap-2">
                <span className="text-base">🚀</span>
                <span>Nueva versión disponible de Precios Al Día</span>
            </div>
            <div className="flex items-center gap-2">
                <button
                    disabled={isUpdating}
                    onClick={() => setShowBanner(false)}
                    className="px-3 py-1 rounded bg-black/20 hover:bg-black/30 text-white text-xs transition disabled:opacity-50"
                >
                    Ahora no
                </button>
                <button
                    disabled={isUpdating}
                    onClick={applyUpdate}
                    className="px-3 py-1 rounded bg-white text-emerald-800 hover:bg-emerald-50 text-xs font-bold transition shadow-sm flex items-center gap-1.5 disabled:opacity-80"
                >
                    {isUpdating ? (
                        <>
                            <Loader2 size={13} className="animate-spin text-emerald-800" />
                            <span>Actualizando...</span>
                        </>
                    ) : (
                        <span>Actualizar ahora</span>
                    )}
                </button>
            </div>
        </div>
    );
}

export default UpdateBanner;
