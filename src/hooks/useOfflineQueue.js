import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para detectar estado online/offline y cachear tasas.
 * La app ya guarda ventas localmente con storageService (IndexedDB).
 * Este hook agrega:
 * - Detección online/offline reactiva
 * - Cache de última tasa conocida para usar offline
 * - Indicador visual controlado
 */
export function useOfflineQueue() {
    const [isOnline, setIsOnline] = useState(
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );

    useEffect(() => {
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    /** Guardar tasa en cache para uso offline */
    const cacheRates = useCallback((rates) => {
        if (rates && rates.bcv?.price > 0) {
            localStorage.setItem('offline_cached_rates', JSON.stringify({
                ...rates,
                cachedAt: new Date().toISOString(),
            }));
        }
    }, []);

    /** Obtener tasa cacheada
     *  HOOK-024: Devuelve `{ rates, stale }` en vez del objeto crudo, marcando
     *  `stale: true` cuando la cache tiene más de 24h. El caller puede mostrar
     *  un indicador visual ("tasa desactualizada") y/o disparar un refresh.
     */
    const getCachedRates = useCallback(() => {
        try {
            const saved = localStorage.getItem('offline_cached_rates');
            if (!saved) return null;
            const parsed = JSON.parse(saved);
            if (!parsed) return null;
            // HOOK-024: stamp de staleness.
            const cachedAtMs = parsed.cachedAt ? new Date(parsed.cachedAt).getTime() : 0;
            const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h
            const stale = cachedAtMs > 0
                ? (Date.now() - cachedAtMs) > STALE_THRESHOLD_MS
                : true; // sin cachedAt → considerarlo stale
            return { rates: parsed, stale };
        } catch (e) {
            console.warn('[useOfflineQueue] getCachedRates parse error:', e);
            return null;
        }
    }, []);

    return { isOnline, cacheRates, getCachedRates };
}
