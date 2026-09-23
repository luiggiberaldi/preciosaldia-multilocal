import { describe, expect, it } from 'vitest';
import { getProductImageCandidates } from '../src/utils/imageFallback';

describe('Resolución de imágenes del catálogo', () => {
    it('conserva el subdirectorio y genera formatos locales alternativos', () => {
        expect(getProductImageCandidates({
            image: '/images/catalog/carnes-y-proteinas/harina-pan-1kg.webp',
        })).toEqual([
            '/images/catalog/carnes-y-proteinas/harina-pan-1kg.webp',
            '/images/catalog/carnes-y-proteinas/harina-pan-1kg.jpg',
            '/images/catalog/carnes-y-proteinas/harina-pan-1kg.png',
        ]);
    });

    it('prioriza el catálogo local antes de conservar una URL remota', () => {
        const candidates = getProductImageCandidates({
            image: 'https://sodgzkablshladvbtnes.supabase.co/storage/v1/object/public/product-images/device/product-1.webp',
        });

        expect(candidates.slice(0, 3)).toEqual([
            '/images/catalog/product-1.jpg',
            '/images/catalog/product-1.png',
            '/images/catalog/product-1.webp',
        ]);
        expect(candidates.at(-1)).toContain('supabase.co/storage');
        expect(new Set(candidates).size).toBe(candidates.length);
    });

    it('usa image_path cuando el registro conserva la ruta del catálogo', () => {
        const candidates = getProductImageCandidates({
            image: '/images/catalog/harina-pan-1kg.webp',
            image_path: '/images/catalog/carnes-y-proteinas/harina-pan-1kg.webp',
        });

        expect(candidates[0]).toBe('/images/catalog/carnes-y-proteinas/harina-pan-1kg.webp');
        expect(candidates).toContain('/images/catalog/harina-pan-1kg.webp');
    });

    it('no genera peticiones candidatas para una imagen vacía o embebida', () => {
        expect(getProductImageCandidates(null)).toEqual([]);
        expect(getProductImageCandidates('')).toEqual([]);
        expect(getProductImageCandidates('data:image/png;base64,abc')).toEqual(['data:image/png;base64,abc']);
    });
});
