import { lazy } from 'react';

/**
 * lazyWithRetry — Envoltorio resiliente para React.lazy.
 * 
 * Resuelve el error clásico de SPAs / Vite:
 * "Failed to fetch dynamically imported module" (404)
 * que ocurre cuando un usuario tiene la app abierta mientras se despliega una nueva versión en Vercel.
 *
 * Si la carga del chunk falla, recarga automáticamente la página una vez para obtener
 * el index.html actualizado con los nuevos hashes de chunks.
 *
 * @param {Function} componentImport Función que retorna una promesa import('./...')
 * @param {string} [name='chunk'] Identificador del componente para control de reintentos
 * @returns {React.LazyExoticComponent}
 */
export function lazyWithRetry(componentImport, name = 'chunk') {
    return lazy(async () => {
        const storageKey = `__pda_chunk_retry_${name}`;
        const lastRetry = parseInt(sessionStorage.getItem(storageKey) || '0', 10);
        const isRecentRetry = Date.now() - lastRetry < 10000;

        try {
            const component = await componentImport();
            // Éxito: limpiar marca de reintento
            sessionStorage.removeItem(storageKey);
            return component;
        } catch (error) {
            console.warn(`[lazyWithRetry] Fallo al cargar chunk "${name}":`, error);

            const isChunkError =
                error?.message?.includes('Failed to fetch dynamically imported module') ||
                error?.message?.includes('Importing a module script failed') ||
                error?.message?.includes('error loading dynamically imported module') ||
                error?.name === 'TypeError';

            if (isChunkError && !isRecentRetry) {
                sessionStorage.setItem(storageKey, String(Date.now()));
                console.info(`[lazyWithRetry] Recargando aplicación para cargar nueva versión de "${name}"...`);
                window.location.reload();
                // Retornar promesa suspendida mientras se ejecuta el reload
                return new Promise(() => {});
            }

            throw error;
        }
    });
}

export default lazyWithRetry;
