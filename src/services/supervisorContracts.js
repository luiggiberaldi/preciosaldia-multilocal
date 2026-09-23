// Contratos puros del Modo Supervisor.
// Este módulo no conoce React, Supabase ni localStorage: sirve como frontera
// común para validar datos antes de conectarlos a persistencia o Realtime.

export const PAIRING_STATES = Object.freeze({
    PENDING: 'pending',
    PAIRED: 'paired',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
});

const PAIRING_TRANSITIONS = Object.freeze({
    [PAIRING_STATES.PENDING]: new Set([PAIRING_STATES.PAIRED, PAIRING_STATES.EXPIRED, PAIRING_STATES.REVOKED]),
    [PAIRING_STATES.PAIRED]: new Set([PAIRING_STATES.REVOKED]),
    [PAIRING_STATES.EXPIRED]: new Set([PAIRING_STATES.PENDING, PAIRING_STATES.REVOKED]),
    [PAIRING_STATES.REVOKED]: new Set([PAIRING_STATES.PENDING]),
});

export function canTransitionPairing(from, to) {
    return from === to || Boolean(PAIRING_TRANSITIONS[from]?.has(to));
}

export function canMonitorRead(state) {
    return state === PAIRING_STATES.PAIRED;
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isBooleanLike = (value) => value === true || value === false || value === 'true' || value === 'false';
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const SYNC_VALIDATORS = Object.freeze({
    bodega_products_v1: Array.isArray,
    bodega_customers_v1: Array.isArray,
    bodega_customer_ledger_v1: Array.isArray,
    bodega_sales_v1: Array.isArray,
    bodega_payment_methods_v1: Array.isArray,
    bodega_accounts_v2: Array.isArray,
    abasto_audit_log_v1: Array.isArray,
    monitor_rates_v12: isPlainObject,
    bodega_custom_rate: (value) => {
        const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        return isFiniteNumber(parsed) && parsed > 0;
    },
    bodega_use_auto_rate: isBooleanLike,
    bodega_rate_mode: (value) => ['bcv', 'euro', 'usdt', 'manual'].includes(value),
    tasa_cop: (value) => isFiniteNumber(Number(value)) && Number(value) >= 0,
    cop_enabled: isBooleanLike,
    auto_cop_enabled: isBooleanLike,
});

export const SUPERVISOR_SYNC_KEYS = Object.freeze(Object.keys(SYNC_VALIDATORS));

export function isSupervisorSyncKey(docId) {
    return typeof docId === 'string' && Object.prototype.hasOwnProperty.call(SYNC_VALIDATORS, docId);
}

export function validateSupervisorSyncDocument(docId, payload) {
    if (!isSupervisorSyncKey(docId)) {
        return { valid: false, error: `Documento no permitido: ${String(docId)}` };
    }

    if (payload == null) {
        return { valid: false, error: `Payload vacío: ${docId}` };
    }

    const valid = SYNC_VALIDATORS[docId](payload);
    return valid
        ? { valid: true, error: null }
        : { valid: false, error: `Schema inválido: ${docId}` };
}

export const SUPERVISOR_COMMAND_TYPES = Object.freeze([
    'supervisor.rate.set',
    'supervisor.product.create',
    'supervisor.product.update',
    'supervisor.product.delete',
    'supervisor.user.create',
    'supervisor.user.pin.change',
    'supervisor.user.update',
    'supervisor.user.delete',
    'supervisor.shift.close',
    'supervisor.shift.reopen',
    'supervisor.inventory.batch.adjust',
]);

const COMMAND_TTL_MS = 60_000;
const MAX_COMMAND_ID_LENGTH = 128;

function validateCommandPayload(type, payload) {
    if (!isPlainObject(payload)) return false;

    switch (type) {
        case 'supervisor.rate.set':
            return ['bcv', 'euro', 'usdt', 'manual'].includes(payload.rateMode)
                && (payload.rateMode !== 'manual'
                    || (isFiniteNumber(Number(payload.customRate)) && Number(payload.customRate) > 0));
        case 'supervisor.product.create':
            return typeof payload.product?.id === 'string' && typeof payload.product?.name === 'string';
        case 'supervisor.product.update':
            return typeof payload.productId === 'string' && isPlainObject(payload.patch);
        case 'supervisor.product.delete':
            return typeof payload.productId === 'string';
        case 'supervisor.user.create':
            return typeof payload.nombre === 'string'
                && ['CAJERO', 'ADMIN'].includes(payload.rol);
        case 'supervisor.user.pin.change':
            return Number.isFinite(payload.userId) && typeof payload.newPin === 'string';
        case 'supervisor.user.update':
            return Number.isFinite(payload.userId) && isPlainObject(payload.patch);
        case 'supervisor.user.delete':
            return Number.isFinite(payload.userId);
        case 'supervisor.shift.close':
        case 'supervisor.shift.reopen':
            return typeof payload.shiftId === 'string'
                && payload.shiftId.length > 0
                && typeof payload.cierreId === 'string'
                && payload.cierreId.length > 0;
        case 'supervisor.inventory.batch.adjust':
            return ['ingreso', 'egreso'].includes(payload.direction)
                && (payload.direction !== 'egreso' || ['merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'].includes(payload.reasonCategory))
                && typeof payload.productId === 'string'
                && payload.productId.length > 0
                && Number.isFinite(Number(payload.quantityInput))
                && Number(payload.quantityInput) > 0
                && ['unidades', 'cajas', 'bultos'].includes(payload.inputUnit)
                && Number.isFinite(Number(payload.unitsPerPackage))
                && Number(payload.unitsPerPackage) > 0
                && Number.isFinite(Number(payload.expectedStock))
                && Number(payload.expectedStock) >= 0
                && typeof payload.reason === 'string'
                && payload.reason.trim().length > 0
                && payload.reason.length <= 240;
        default:
            return false;
    }
}

/**
 * Valida la forma mínima de un comando. La autenticidad criptográfica y la
 * autorización final deben comprobarse en backend; esta función evita que el
 * cliente procese basura o comandos fuera de ventana.
 */
export function validateSupervisorCommand(command, { targetDeviceId, monitorDeviceId, now = Date.now() } = {}) {
    if (!isPlainObject(command)) return { valid: false, error: 'Comando inválido' };
    if (!SUPERVISOR_COMMAND_TYPES.includes(command.type)) return { valid: false, error: 'Tipo de comando no permitido' };
    if (typeof command.commandId !== 'string' || command.commandId.length < 8 || command.commandId.length > MAX_COMMAND_ID_LENGTH) {
        return { valid: false, error: 'commandId inválido' };
    }
    if (typeof command.targetDeviceId !== 'string' || !targetDeviceId || command.targetDeviceId !== targetDeviceId) {
        return { valid: false, error: 'Target no autorizado' };
    }
    if (typeof command.monitorDeviceId !== 'string' || !monitorDeviceId || command.monitorDeviceId !== monitorDeviceId) {
        return { valid: false, error: 'Monitor no autorizado' };
    }
    if (!Number.isFinite(command.issuedAt) || !Number.isFinite(command.expiresAt)) {
        return { valid: false, error: 'Ventana temporal inválida' };
    }
    if (command.expiresAt <= command.issuedAt || command.expiresAt - command.issuedAt > COMMAND_TTL_MS || now > command.expiresAt) {
        return { valid: false, error: 'Comando expirado o TTL inválido' };
    }
    if (!validateCommandPayload(command.type, command.payload)) {
        return { valid: false, error: 'Payload inválido' };
    }

    return { valid: true, error: null };
}

export class AppliedCommandGuard {
    constructor({ maxEntries = 1000, now = () => Date.now() } = {}) {
        this.maxEntries = maxEntries;
        this.now = now;
        this.entries = new Map();
    }

    has(commandId) {
        this._prune();
        return this.entries.has(commandId);
    }

    accept(commandId, expiresAt) {
        this._prune();
        if (typeof commandId !== 'string' || this.entries.has(commandId)) return false;
        this.entries.set(commandId, expiresAt);
        while (this.entries.size > this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
        return true;
    }

    _prune() {
        const now = this.now();
        for (const [commandId, expiresAt] of this.entries) {
            if (!Number.isFinite(expiresAt) || expiresAt <= now) this.entries.delete(commandId);
        }
    }
}

export default {
    PAIRING_STATES,
    SUPERVISOR_SYNC_KEYS,
    SUPERVISOR_COMMAND_TYPES,
    canTransitionPairing,
    canMonitorRead,
    isSupervisorSyncKey,
    validateSupervisorSyncDocument,
    validateSupervisorCommand,
    AppliedCommandGuard,
};
