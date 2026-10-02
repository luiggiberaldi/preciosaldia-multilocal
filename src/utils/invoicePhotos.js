/**
 * invoicePhotos.js — Fotos de facturas de proveedores (SOLO LOCAL).
 *
 * Las fotos se guardan en IndexedDB en un object store separado
 * (`pda-invoice-photos`) que NUNCA se sincroniza a la nube.
 * Cada foto se identifica por el ID de la factura.
 *
 * @module utils/invoicePhotos
 */

const DB_NAME = 'pda-invoice-photos';
const STORE_NAME = 'photos';
const DB_VERSION = 1;

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Guarda la foto de una factura (Blob o dataURL).
 * @param {string} invoiceId
 * @param {Blob|string} photo - Blob o dataURL
 */
export async function saveInvoicePhoto(invoiceId, photo) {
    if (!invoiceId || !photo) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        // Convertir dataURL a Blob para ahorrar espacio
        let value = photo;
        if (typeof photo === 'string' && photo.startsWith('data:')) {
            value = dataUrlToBlob(photo);
        }
        const req = store.put(value, invoiceId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
}

/**
 * Obtiene la foto de una factura como object URL.
 * @param {string} invoiceId
 * @returns {Promise<string|null>} object URL o null si no hay foto
 */
export async function getInvoicePhotoUrl(invoiceId) {
    if (!invoiceId) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(invoiceId);
        req.onsuccess = () => {
            const blob = req.result;
            db.close();
            if (!blob) return resolve(null);
            const url = blob instanceof Blob
                ? URL.createObjectURL(blob)
                : blob; // ya es dataURL
            resolve(url);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

/**
 * ¿Tiene foto esta factura?
 * @param {string} invoiceId
 */
export async function hasInvoicePhoto(invoiceId) {
    if (!invoiceId) return false;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getKey(invoiceId);
        req.onsuccess = () => {
            db.close();
            resolve(!!req.result);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

/**
 * Elimina la foto de una factura.
 */
export async function deleteInvoicePhoto(invoiceId) {
    if (!invoiceId) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(invoiceId);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

/**
 * Comprime una imagen a max 1200px y calidad 0.8 para ahorrar espacio local.
 * @param {File|Blob} file
 * @returns {Promise<Blob>}
 */
export function compressImage(file, maxDim = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                const ratio = Math.min(maxDim / width, maxDim / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error('compress failed')),
                'image/jpeg',
                quality
            );
        };
        img.onerror = reject;
        img.src = url;
    });
}
