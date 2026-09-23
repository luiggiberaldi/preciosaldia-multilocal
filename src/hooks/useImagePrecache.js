import { useEffect, useRef, useState } from 'react';
import { useProductContext } from '../context/ProductContext';
import { getProductImageCandidates } from '../utils/imageFallback';
import { saveImageToCache } from '../services/imageBlobCache';

/**
 * OFFLINE-IMG: Precalentador del cache de imágenes de producto.
 *
 * El service worker ya cachea las imágenes de Storage con CacheFirst
 * (`product-images-cache` en vite.config.js), pero solo las que el usuario
 * llegó a VER estando online. Este hook recorre TODO el inventario y hace un
 * fetch silencioso de cada imagen para que el SW las guarde todas — así el
 * inventario y la caja se ven completos sin internet.
 *
 * Las imágenes locales del catálogo se validan bajo demanda en SmartImage y el
 * Service Worker las cachea al mostrarlas. El precalentador solo recorre URLs
 * remotas conocidas; así no dispara cientos de peticiones a slugs locales que
 * no existen. Los data: base64 no necesitan precalentado.
 *
 * Diseño:
 *  - Debounce de 5s tras cambios en `products` (agrupa ediciones/sync).
 *  - Skip por URL si ya está en Cache Storage (`caches.match` → 0 red).
 *  - Lotes de 4 fetches concurrentes para no saturar equipos de gama baja.
 *  - Hash de la lista de URLs para no re-recorrer si nada cambió.
 *  - Errores individuales silenciosos: una URL rota no aborta el resto.
 */

const BATCH_SIZE = 4;
const DEBOUNCE_MS = 5000;

/**
 * ¿Debe precalentarse esta imagen?
 *  - URL remota (Supabase Storage) → sí, si existe.
 *  - Ruta local /images/... → no: SmartImage la resuelve bajo demanda y el SW
 *    la cachea después de una validación exitosa.
 *  - data: base64 → se excluye: ya viaja embebido en el producto.
 */
function isPrecacheableImage(img) {
    if (typeof img !== 'string' || img.length === 0) return false;
    return /^https?:/i.test(img);
}

/**
 * Resuelve una ruta relativa contra el origen. Cache Storage indexa por URL
 * absoluta, así que sin esto `caches.match('/images/...')` dependería del <base>
 * del documento.
 */
function toAbsoluteUrl(img) {
    try {
        return new URL(img, window.location.origin).href;
    } catch {
        return img;
    }
}

function urlListHash(urls) {
    const str = urls.join('|');
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return `${urls.length}_${h >>> 0}`;
}

async function precacheImages(urls) {
    let cacheStorage = null;
    try {
        // Cache Storage API; puede no existir en WebViews viejas.
        cacheStorage = typeof caches !== 'undefined' ? caches : null;
    } catch { /* contexto sin Cache Storage */ }

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        if (!navigator.onLine) return; // se cayó la conexión a mitad: abortar sin ruido
        const batch = urls.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (url) => {
            try {
                // Guardar en la caché permanente de IndexedDB
                await saveImageToCache(url);

                if (cacheStorage) {
                    const hit = await cacheStorage.match(url);
                    if (hit) return; // ya cacheada por el SW: 0 red
                }
                try {
                    await fetch(url, { mode: 'cors', credentials: 'omit' });
                } catch {
                    await fetch(url, { mode: 'no-cors' });
                }
            } catch { /* URL rota u offline parcial: continuar con el resto */ }
        }));
    }
}

export function useImagePrecache() {
    const { products, isLoadingProducts } = useProductContext();
    const lastHashRef = useRef('');
    const runningRef = useRef(false);
    // Contador que fuerza un nuevo intento al recuperar conexión (el reset del
    // hash solo no re-dispararía el efecto).
    const [onlineTick, setOnlineTick] = useState(0);

    useEffect(() => {
        const onOnline = () => {
            lastHashRef.current = '';
            setOnlineTick(t => t + 1);
        };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, []);

    useEffect(() => {
        if (isLoadingProducts) return;
        if (!('serviceWorker' in navigator)) return;

        const timer = setTimeout(async () => {
            // Sin SW controlador (primera carga, dev, Electron file://) el fetch no
            // pasaría por la regla de cache: no tiene sentido precalentar.
            if (!navigator.serviceWorker.controller) return;
            if (!navigator.onLine) return;
            if (runningRef.current) return;

            const rawUrls = [];
            (products || []).forEach(p => {
                const candidates = getProductImageCandidates(p);
                candidates.forEach(c => {
                    if (isPrecacheableImage(c)) {
                        rawUrls.push(toAbsoluteUrl(c));
                    }
                });
            });
            const urls = [...new Set(rawUrls)];
            if (urls.length === 0) return;

            const hash = urlListHash(urls);
            if (hash === lastHashRef.current) return; // nada nuevo que cachear

            runningRef.current = true;
            try {
                await precacheImages(urls);
                lastHashRef.current = hash;
            } finally {
                runningRef.current = false;
            }
        }, DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [products, isLoadingProducts, onlineTick]);
}

/** Microcomponente para montar el hook dentro de <ProductProvider>. */
export function ImagePrecacheRunner() {
    useImagePrecache();
    return null;
}
