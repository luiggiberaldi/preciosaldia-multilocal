/**
 * Identidad local de instalación, no identidad de hardware ni autorización.
 * Las instalaciones legacy conservan su ID; ninguna reparación es automática.
 * Un perfil clonado copia también este ID: detectar clones requiere servidor.
 */
export const INSTALLATION_ID_KEY = 'pda_device_id';
const ANCHOR_KEY = 'pda_fp_anchor_v1';
const LEGACY_ID_RE = /^PDA(?:-V2)?-[0-9A-F]{8,64}$/;
const INSTALLATION_ID_RE = /^PDA-I-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isInstallationId(id) {
    return typeof id === 'string' && INSTALLATION_ID_RE.test(id);
}

export function isSupportedDeviceId(id) {
    return isInstallationId(id) || (typeof id === 'string' && LEGACY_ID_RE.test(id));
}

function identityError(code) {
    const error = new Error('No se pudo verificar la identidad de esta instalación. Conserva los datos y solicita revisión; no borres el almacenamiento ni cambies el ID.');
    error.code = code;
    return error;
}

function readIdentity(storage) {
    try {
        const id = storage.getItem(INSTALLATION_ID_KEY);
        const rawAnchor = storage.getItem(ANCHOR_KEY);
        let anchor = null;
        if (rawAnchor !== null) {
            try {
                anchor = JSON.parse(rawAnchor)?.anchor;
            } catch {
                throw identityError('IDENTITY_ANCHOR_INVALID');
            }
            if (!isSupportedDeviceId(anchor)) throw identityError('IDENTITY_ANCHOR_INVALID');
        }
        if (id !== null && !isSupportedDeviceId(id)) throw identityError('IDENTITY_ID_INVALID');
        if (anchor && anchor !== id) throw identityError('IDENTITY_CONFLICT');
        return { id, anchor };
    } catch (error) {
        if (error?.code?.startsWith?.('IDENTITY_')) throw error;
        throw identityError('IDENTITY_STORAGE_UNAVAILABLE');
    }
}

function createRandomId(cryptoSource) {
    let uuid;
    try {
        if (typeof cryptoSource?.randomUUID === 'function') {
            uuid = cryptoSource.randomUUID();
        } else if (typeof cryptoSource?.getRandomValues === 'function') {
            const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
            uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
    } catch {
        throw identityError('IDENTITY_ENTROPY_UNAVAILABLE');
    }
    const id = `PDA-I-${uuid}`;
    if (!isInstallationId(id)) throw identityError('IDENTITY_ENTROPY_UNAVAILABLE');
    return id;
}

/**
 * Obtiene el ID canónico bajo el mismo origen, independiente de sede/usuario.
 * Web Locks serializa el primer arranque entre pestañas. Sin Locks, solo se
 * permite leer IDs existentes: no acuñar dos identidades concurrentes.
 * Nunca retorna una identidad nueva si no se pudo guardar y releer.
 * @returns {Promise<string>}
 */
export async function getOrCreateInstallationId() {
    let storage;
    try {
        storage = globalThis.localStorage;
        if (!storage) throw new Error('Storage unavailable');
    } catch {
        throw identityError('IDENTITY_STORAGE_UNAVAILABLE');
    }
    const existing = readIdentity(storage);
    if (existing.id) return existing.id;
    const locks = globalThis.navigator?.locks;
    if (typeof locks?.request !== 'function') throw identityError('IDENTITY_LOCK_UNAVAILABLE');
    return locks.request('pda-installation-identity-v1', () => {
        // Otro arranque puede haber persistido el ID mientras esperábamos.
        const current = readIdentity(storage);
        if (current.id) return current.id;
        const id = createRandomId(globalThis.crypto);
        try {
            storage.setItem(INSTALLATION_ID_KEY, id);
            if (storage.getItem(INSTALLATION_ID_KEY) !== id) throw new Error('Readback mismatch');
            storage.setItem(ANCHOR_KEY, JSON.stringify({ anchor: id, updatedAt: Date.now() }));
            const persisted = readIdentity(storage);
            if (persisted.id !== id || persisted.anchor !== id) throw new Error('Anchor readback mismatch');
        } catch {
            // No rollback/clear: un write parcial se conserva para revisión/reintento.
            throw identityError('IDENTITY_STORAGE_UNAVAILABLE');
        }
        return id;
    });
}

/** Comprueba continuidad local, sin fingerprint ni red ni creación de otro ID. */
export function verifyInstallationIdentity(expectedId) {
    try {
        if (!isSupportedDeviceId(expectedId)) return false;
        const { id, anchor } = readIdentity(globalThis.localStorage);
        return id === expectedId && (!isInstallationId(id) || anchor === id);
    } catch {
        return false;
    }
}
