import { useMemo, useState, useEffect } from 'react';
import { getProductImageCandidates } from '../utils/imageFallback';
import { getCachedImage, saveImageToCache } from '../services/imageBlobCache';

const isLocalCatalogCandidate = (value) => (
    typeof value === 'string' && value.startsWith('/images/catalog/')
);

async function findLoadableCandidate(candidates, startIndex = 0) {
    for (let index = startIndex; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (candidate.startsWith('data:')) return { index, url: candidate };

        try {
            // Validar antes de asignar `src` evita que un 404 llegue al elemento
            // <img> y ensucie la consola con errores repetidos.
            const response = await fetch(candidate, {
                method: 'HEAD',
                cache: 'force-cache',
                credentials: isLocalCatalogCandidate(candidate) ? 'same-origin' : 'omit',
            });
            if (response.ok) return { index, url: candidate };
        } catch {
            // Imagen ausente, CORS u offline: probar el siguiente candidato.
        }
    }
    return null;
}

/**
 * SmartImage — Componente de imagen resiliente con doble capa de caché (IndexedDB + SW + Fallbacks).
 *
 * Las rutas locales se validan antes de asignarse al elemento <img>; así una
 * imagen ausente termina en el icono de fallback sin ensuciar la consola con
 * una cascada de errores 404.
 */
export default function SmartImage({
    src,
    alt = '',
    className = 'w-full h-full object-contain',
    fallbackIcon = null,
    product = null
}) {
    const rawSrc = src || product?.image;
    const productImagePath = product?.image_path;
    const candidates = useMemo(
        () => getProductImageCandidates({ image: rawSrc, image_path: productImagePath }),
        [rawSrc, productImagePath]
    );

    const [cachedUrl, setCachedUrl] = useState(null);
    const [resolvedUrl, setResolvedUrl] = useState(null);
    const [candidateIndex, setCandidateIndex] = useState(0);
    const [isResolving, setIsResolving] = useState(false);
    const [failed, setFailed] = useState(false);

    // Intentar primero una copia local y después resolver solo una URL válida.
    useEffect(() => {
        let isMounted = true;
        setCandidateIndex(0);
        setCachedUrl(null);
        setResolvedUrl(null);
        setFailed(false);
        setIsResolving(Boolean(rawSrc));

        if (!rawSrc) {
            setIsResolving(false);
            return () => { isMounted = false; };
        }

        (async () => {
            const localDataUrl = await getCachedImage(rawSrc);
            if (!isMounted) return;
            if (localDataUrl) {
                setCachedUrl(localDataUrl);
                setIsResolving(false);
                return;
            }

            const match = await findLoadableCandidate(candidates, 0);
            if (!isMounted) return;
            if (match) {
                setCandidateIndex(match.index);
                setResolvedUrl(match.url);
            } else {
                setFailed(true);
            }
            setIsResolving(false);
        })();

        return () => { isMounted = false; };
    }, [rawSrc, candidates]);

    const handleLoadSuccess = () => {
        // Guardar la URL que realmente cargó, no el candidato remoto que pudo fallar.
        const sourceToCache = resolvedUrl || rawSrc;
        if (navigator.onLine && sourceToCache && !sourceToCache.startsWith('data:')) {
            saveImageToCache(sourceToCache);
        }
    };

    const handleError = async () => {
        setCachedUrl(null);
        setResolvedUrl(null);
        setIsResolving(true);

        const startIndex = candidateIndex + 1;
        const match = await findLoadableCandidate(candidates, startIndex);
        if (match) {
            setCandidateIndex(match.index);
            setResolvedUrl(match.url);
            setIsResolving(false);
        } else {
            setFailed(true);
            setIsResolving(false);
        }
    };

    if (failed || isResolving || candidates.length === 0) {
        return fallbackIcon;
    }

    const currentSource = cachedUrl || resolvedUrl;
    if (!currentSource) return fallbackIcon;

    return (
        <img
            src={currentSource}
            alt={alt}
            className={className}
            onLoad={handleLoadSuccess}
            onError={handleError}
            loading="lazy"
        />
    );
}
