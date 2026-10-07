/**
 * Detecta si el navegador soporta las APIs nativas CompressionStream y DecompressionStream.
 */
export const isCompressionSupported = () => {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
};

/**
 * Comprime un string de texto (como un JSON) usando Gzip y devuelve una cadena codificada en Base64.
 * @param {string} str - Texto plano o string de JSON a comprimir.
 * @returns {Promise<string>} Promesa que resuelve al string comprimido en Base64.
 */
export async function compressString(str) {
    if (!isCompressionSupported()) {
        console.warn('[compression] CompressionStream no soportado en este entorno. Retornando texto original.');
        return str;
    }

    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(str));
            controller.close();
        }
    });
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const response = new Response(compressedStream);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Descomprime una cadena codificada en Base64 que contiene datos Gzip de vuelta a texto plano.
 * Si no es compatible o la entrada no está comprimida, intenta decodificarla o retorna la entrada por seguridad.
 * @param {string} base64 - Cadena comprimida en Base64.
 * @returns {Promise<string>} Promesa que resuelve al texto plano original.
 */
export async function decompressString(base64) {
    if (!isCompressionSupported()) {
        console.warn('[compression] DecompressionStream no soportado en este entorno. Retornando texto original.');
        return base64;
    }

    try {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(bytes);
                controller.close();
            }
        });
        const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
        const response = new Response(decompressedStream);
        return await response.text();
    } catch (e) {
        console.error('[compression] Error al descomprimir, retornando el input original por seguridad:', e);
        return base64;
    }
}
