import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compressString, decompressString, isCompressionSupported } from '../src/utils/compression';

describe('Compression Utility Tests', () => {
    const originalCompressionStream = global.CompressionStream;
    const originalDecompressionStream = global.DecompressionStream;

    afterEach(() => {
        // Restaurar globales por si fueron mockeadas
        global.CompressionStream = originalCompressionStream;
        global.DecompressionStream = originalDecompressionStream;
    });

    it('should verify if compression is supported in this environment', () => {
        const supported = isCompressionSupported();
        expect(typeof supported).toBe('boolean');
    });

    it('should successfully compress and decompress a string', async () => {
        if (!isCompressionSupported()) {
            console.warn('Skipping compression test because CompressionStream is not available.');
            return;
        }

        const originalText = JSON.stringify({
            message: 'Hello, this is a test string for verification of our daily backup compression feature!',
            timestamp: new Date().toISOString(),
            data: Array.from({ length: 50 }, (_, i) => ({ id: i, value: `item-${i}` }))
        });

        // Comprimir
        const compressedBase64 = await compressString(originalText);
        expect(compressedBase64).toBeDefined();
        expect(typeof compressedBase64).toBe('string');
        
        // Debería ser significativamente más corto que el original si es lo suficientemente largo,
        // aunque con textos muy pequeños la cabecera gzip + base64 puede agregar un pequeño overhead.
        expect(compressedBase64.length).toBeGreaterThan(0);

        // Descomprimir
        const decompressedText = await decompressString(compressedBase64);
        expect(decompressedText).toBe(originalText);
    });

    it('should fallback gracefully when compression APIs are not supported', async () => {
        // Simular que no hay soporte
        global.CompressionStream = undefined;
        global.DecompressionStream = undefined;

        expect(isCompressionSupported()).toBe(false);

        const text = 'Fallback test string content';

        const compressed = await compressString(text);
        expect(compressed).toBe(text); // Retorna sin cambios

        const decompressed = await decompressString(text);
        expect(decompressed).toBe(text); // Retorna sin cambios
    });

    it('should handle decompression error gracefully and return original input', async () => {
        if (!isCompressionSupported()) return;

        const invalidBase64 = 'not-a-valid-gzip-base64-string';
        const decompressed = await decompressString(invalidBase64);
        
        // Debe retornar la cadena original debido al bloque try-catch en el fallback de decompress
        expect(decompressed).toBe(invalidBase64);
    });
});
