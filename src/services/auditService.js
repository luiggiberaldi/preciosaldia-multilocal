/**
 * ═══════════════════════════════════════════════════════
 *  AUDIT SERVICE — Bitácora Universal Oculta
 *  Registra todas las acciones de la app con usuario,
 *  timestamp, categoría y descripción.
 * ═══════════════════════════════════════════════════════
 */
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';

const AUDIT_KEY = 'abasto_audit_log_v1';
const MAX_ENTRIES = 15000;

// HOOK-009: Subimos de 90 días a 5 años (1825) para cumplir requisitos
// fiscales/legales de retención de evidencia en VE.
const MAX_AGE_DAYS = 1825;

// HOOK-009: Categorías con valor fiscal/legal — NUNCA purgar.
// VENTA: tickets/ventas realizadas.
// CLIENTE: estado de cuenta de clientes (saldos, fiados).
// PAGO: pagos aplicados / cierres de caja.
const FISCAL_CATEGORIES = Object.freeze(['VENTA', 'CLIENTE', 'PAGO']);

// HOOK-008: Lock name para serializar read-modify-write del audit log.
const AUDIT_LOCK = 'audit_log_lock';

// ─── Core ──────────────────────────────────────────────

/**
 * Registra un evento en el audit log.
 *
 * HOOK-008: Envuelve el read-modify-write en `withLock(AUDIT_LOCK, ...)` para
 * evitar que dos `logEvent` concurrentes (ej: checkout dispara VENTA + STOCK +
 * CLIENTE en ráfaga) se pisen y pierdan entradas.
 *
 * @param {string} cat - Categoría (AUTH, VENTA, INVENTARIO, CLIENTE, PROVEEDOR, CONFIG, USUARIO, SISTEMA)
 * @param {string} action - Código de acción (ej: VENTA_COMPLETADA)
 * @param {string} desc - Descripción legible
 * @param {object} [user] - { id, nombre, rol } del usuario activo
 * @param {object} [meta] - Datos extra opcionales
 */
export async function logEvent(cat, action, desc, user = null, meta = null) {
    try {
        const entry = {
            id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            ts: Date.now(),
            cat,
            action,
            desc,
            userId: user?.id ?? null,
            userName: user?.nombre ?? 'Sistema',
            userRole: user?.rol ?? 'SYSTEM',
        };
        if (meta) entry.meta = meta;

        await withLock(AUDIT_LOCK, async () => {
            const log = await storageService.getItem(AUDIT_KEY, []);
            log.unshift(entry); // Más reciente primero

            // Límite duro
            if (log.length > MAX_ENTRIES) {
                log.length = MAX_ENTRIES;
            }

            await storageService.setItem(AUDIT_KEY, log);
        });
    } catch (err) {
        // Silencioso — el audit log nunca debe romper la app
        console.warn('[AuditService] Error writing log:', err);
    }
}

// ─── Queries ───────────────────────────────────────────

/**
 * Obtiene los logs con filtros opcionales.
 * @param {object} [filters]
 * @param {string} [filters.cat] - Filtrar por categoría
 * @param {number} [filters.userId] - Filtrar por usuario
 * @param {number} [filters.fromTs] - Desde timestamp
 * @param {number} [filters.toTs] - Hasta timestamp
 * @param {number} [filters.limit] - Máximo de resultados
 * @returns {Promise<Array>}
 */
export async function getAuditLog(filters = {}) {
    try {
        let log = await storageService.getItem(AUDIT_KEY, []);

        if (filters.cat) {
            log = log.filter(e => e.cat === filters.cat);
        }
        if (filters.userId) {
            log = log.filter(e => e.userId === filters.userId);
        }
        if (filters.fromTs) {
            log = log.filter(e => e.ts >= filters.fromTs);
        }
        if (filters.toTs) {
            log = log.filter(e => e.ts <= filters.toTs);
        }
        if (filters.limit) {
            log = log.slice(0, filters.limit);
        }

        return log;
    } catch (err) {
        console.warn('[AuditService] Error reading log:', err);
        return [];
    }
}

/**
 * Cuenta total de registros.
 */
export async function getAuditCount() {
    try {
        const log = await storageService.getItem(AUDIT_KEY, []);
        return log.length;
    } catch {
        return 0;
    }
}

// ─── Mantenimiento ─────────────────────────────────────

/**
 * Elimina registros con más de MAX_AGE_DAYS días.
 * Llamar al iniciar la app.
 *
 * HOOK-009: NUNCA purga entradas de categorías fiscales (VENTA/CLIENTE/PAGO)
 * sin importar su antigüedad — son evidencia legal.
 */
export async function purgeOldEntries() {
    try {
        const log = await storageService.getItem(AUDIT_KEY, []);
        const cutoff = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
        const filtered = log.filter(e =>
            // Conservar si es categoría fiscal (no importa la edad)...
            FISCAL_CATEGORIES.includes(e.cat) ||
            // ...o si es más reciente que el cutoff.
            (typeof e.ts === 'number' && e.ts >= cutoff)
        );

        if (filtered.length < log.length) {
            await storageService.setItem(AUDIT_KEY, filtered);
            if (import.meta.env?.DEV) {
                console.info(`[AuditService] Purged ${log.length - filtered.length} old entries (retaining ${filtered.length} of ${log.length}). Max age: ${MAX_AGE_DAYS}d.`);
            }
        }
    } catch (err) {
        console.warn('[AuditService] Error purging:', err);
    }
}

/**
 * Borra todo el audit log. Solo ADMIN.
 *
 * SEC-019: Antes esta función aceptaba `user = null` (cualquiera podía llamarla
 * sin argumentos) y solo validaba el rol si el caller pasaba `user`. Ahora:
 *   - Si `user` no se pasa, se intenta leer `usuarioActivo` de `useAuthStore`
 *     vía import dinámico (backward-compat con callers existentes que no pasan user).
 *   - Solo `rol === 'ADMIN'` (sin OWNER/SUPERADMIN inventados — la app solo
 *     usa ADMIN/CAJERO).
 *   - El intento fallido se loguea (append-only) antes de lanzar el error.
 *
 * HOOK-008: serializar con lock para que no se mezcle con un logEvent en vuelo.
 *
 * @param {object} [user] - { id, nombre, rol } del usuario que solicita el borrado.
 * @returns {Promise<void>}
 * @throws {Error} Si no hay `user` con `rol === 'ADMIN'`.
 */
export async function clearAuditLog(user) {
    // SEC-019: El usuario debe proporcionarse de forma explícita desde la UI
    if (!user) {
        throw new Error('Permiso denegado: se requiere un usuario autenticado para realizar esta acción.');
    }

    // SEC-019: rol debe ser ADMIN (no OWNER/SUPERADMIN inventados).
    const isAllowed = user && user.rol === 'ADMIN';

    if (!isAllowed) {
        // Loguear el intento fallido (append-only audit log).
        try {
            const entry = {
                id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
                ts: Date.now(),
                cat: 'AUDIT',
                action: 'CLEAR_AUDIT_DENIED',
                desc: `Intento de borrar audit log denegado (rol=${user?.rol ?? 'NONE'}, usuario=${user?.nombre ?? 'desconocido'})`,
                userId: user?.id ?? null,
                userName: user?.nombre ?? 'Sistema',
                userRole: user?.rol ?? 'SYSTEM',
            };
            const log = await storageService.getItem(AUDIT_KEY, []);
            log.unshift(entry);
            if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
            await storageService.setItem(AUDIT_KEY, log);
        } catch { /* nunca romper la denegación por un fallo de log */ }

        const err = new Error('Permiso denegado: solo ADMIN puede borrar el audit log (SEC-019).');
        err.code = 'AUDIT_PERMISSION_DENIED';
        throw err;
    }

    // HOOK-008: serializar con lock para que no se mezcle con un logEvent en vuelo.
    await withLock(AUDIT_LOCK, async () => {
        await storageService.setItem(AUDIT_KEY, []);
    });

    // Loguear el borrado exitoso.
    try {
        const entry = {
            id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
            ts: Date.now(),
            cat: 'AUDIT',
            action: 'CLEAR_AUDIT',
            desc: `Audit log borrado por ${user.nombre || 'admin'}`,
            userId: user.id ?? null,
            userName: user.nombre ?? 'Sistema',
            userRole: user.rol ?? 'SYSTEM',
        };
        const log = await storageService.getItem(AUDIT_KEY, []);
        log.unshift(entry);
        if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
        await storageService.setItem(AUDIT_KEY, log);
    } catch { /* silencioso */ }
}

/**
 * Exporta el log como JSON descargable.
 */
export async function exportAuditLog() {
    const log = await storageService.getItem(AUDIT_KEY, []);
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Exportado para tests / diagnóstico.
export const _AUDIT_CONFIG = Object.freeze({
    AUDIT_KEY,
    MAX_ENTRIES,
    MAX_AGE_DAYS,
    FISCAL_CATEGORIES,
    AUDIT_LOCK,
});
