/**
 * In-memory reference backend for hermetic tests only. It has no network access,
 * persistence, authentication, or production callers. A real backend must enforce
 * the same keys and validation inside a database transaction.
 */
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const INTEGER = /^-?(?:0|[1-9]\d{0,39})$/;
const OPERATION_KEYS = ['version', 'businessId', 'epochId', 'operationId', 'deviceId', 'actorId', 'productId', 'kind', 'deltaUnits', 'saleOperationId'];
const EVENT_KEYS = ['version', 'accountId', 'businessId', 'epochId', 'kind', 'eventId', 'saleId', 'revision', 'operations'];
const VOID_KINDS = new Set(['VOID']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { throw new Error(code); };
const id = value => typeof value === 'string' && ID.test(value);

function canonical(value, depth = 0) {
    if (depth > 24) fail('INVALID_JSON_DEPTH');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length || Object.keys(value).some((key, i) => key !== String(i))) fail('INVALID_JSON');
        return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
    }
    if (!plain(value)) fail('INVALID_JSON');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
}
function exactShape(value, keys) {
    if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) fail('INVALID_SHAPE');
}
function scope(event) {
    if (![event.accountId, event.businessId, event.epochId].every(id)) fail('INVALID_SCOPE');
    return JSON.stringify([event.accountId, event.businessId, event.epochId]);
}
function validateOperation(operation, event) {
    const allowedKeys = event.kind === 'VOID' ? OPERATION_KEYS : OPERATION_KEYS.filter(key => key !== 'saleOperationId');
    if (!plain(operation) || Object.keys(operation).some(key => !allowedKeys.includes(key))
        || allowedKeys.slice(0, 9).some(key => !Object.hasOwn(operation, key))) fail('INVALID_SHAPE');
    if (operation.version !== 1 || !['businessId', 'epochId', 'operationId', 'deviceId', 'actorId', 'productId']
        .every(key => id(operation[key]))) fail('INVALID_OPERATION_IDENTITY');
    if (operation.businessId !== event.businessId || operation.epochId !== event.epochId) fail('OPERATION_SCOPE_MISMATCH');
    if (typeof operation.deltaUnits !== 'string' || !INTEGER.test(operation.deltaUnits) || operation.deltaUnits === '0' || operation.deltaUnits === '-0') fail('INVALID_DELTA');
    if (operation.kind === 'SALE' && BigInt(operation.deltaUnits) >= 0n) fail('INVALID_OPERATION_KIND_OR_SIGN');
    if (operation.kind === 'RESTOCK' && BigInt(operation.deltaUnits) <= 0n) fail('INVALID_OPERATION_KIND_OR_SIGN');
    if (operation.kind === 'ADJUSTMENT' && !BigInt(operation.deltaUnits)) fail('INVALID_DELTA');
    if (operation.kind === 'VOID') {
        if (BigInt(operation.deltaUnits) <= 0n || !id(operation.saleOperationId) || operation.saleOperationId === operation.operationId) fail('INVALID_VOID');
    } else if (!['SALE', 'RESTOCK', 'ADJUSTMENT'].includes(operation.kind) || Object.hasOwn(operation, 'saleOperationId')) {
        fail('INVALID_OPERATION_KIND');
    }
    canonical(operation);
}

/** Construct a fresh fake backend. Pass the instance explicitly; no singleton. */
export function createMockStockOperationsBackend() {
    const events = new Map();
    const operations = new Map();
    const voidedSales = new Map();
    const conflicts = new Map();
    let receiptSequence = 0;
    const recordConflict = (subject, scopeId, existing, incoming) => {
        const key = JSON.stringify([subject, scopeId]);
        const variants = conflicts.get(key) || new Map();
        for (const value of [existing, incoming]) {
            const content = canonical(value);
            if (!variants.has(content)) variants.set(content, JSON.parse(content));
        }
        conflicts.set(key, variants);
    };

    return Object.freeze({
        async submit(input) {
            const event = JSON.parse(canonical(input));
            exactShape(event, EVENT_KEYS);
            const eventScope = scope(event);
            if (event.version !== 1 || !['SALE', 'VOID', 'RESTOCK', 'ADJUSTMENT'].includes(event.kind)
                || !id(event.eventId) || typeof event.revision !== 'string' || !/^[a-f0-9]{64}$/.test(event.revision)
                || !Array.isArray(event.operations) || event.operations.length < 1 || event.operations.length > 500) fail('INVALID_EVENT');
            const isVoid = VOID_KINDS.has(event.kind);
            if (!id(event.saleId) || (event.kind === 'SALE' && event.eventId !== event.saleId)
                || (event.kind !== 'SALE' && event.kind !== 'VOID')) fail('INVALID_EVENT_KIND_OR_SALE');
            if (event.operations.some(operation => operation.kind === 'VOID') !== isVoid
                || event.operations.some(operation => operation.kind !== event.kind)) fail('EVENT_KIND_MISMATCH');
            for (const operation of event.operations) validateOperation(operation, event);
            const operationIds = event.operations.map(operation => operation.operationId);
            if (new Set(operationIds).size !== operationIds.length) fail('DUPLICATE_OPERATION_IN_EVENT');
            const eventKey = JSON.stringify([eventScope, event.kind, event.eventId]);
            const content = canonical(event);
            const priorEvent = events.get(eventKey);
            if (priorEvent) {
                if (priorEvent.content !== content) {
                    recordConflict('event', eventKey, priorEvent.event, event);
                    fail('EVENT_ID_CONFLICT');
                }
                return { accepted: true, replay: true, receiptId: priorEvent.receiptId };
            }
            if (isVoid) {
                const saleKey = JSON.stringify([eventScope, event.saleId]);
                if (voidedSales.has(saleKey)) {
                    const priorVoid = events.get(JSON.stringify([eventScope, 'VOID', voidedSales.get(saleKey)]));
                    recordConflict('void-sale', saleKey, priorVoid?.event || { saleId: event.saleId }, event);
                    fail('SALE_ALREADY_VOIDED');
                }
                const original = events.get(JSON.stringify([eventScope, 'SALE', event.saleId]));
                if (!original) fail('SALE_EVENT_NOT_FOUND');
                const originalEvent = original.event;
                const bySaleOp = new Map(originalEvent.operations.map(operation => [operation.operationId, operation]));
                if (event.operations.length !== originalEvent.operations.length) fail('VOID_LINES_MISMATCH');
                for (const reversal of event.operations) {
                    const sale = bySaleOp.get(reversal.saleOperationId);
                    if (!sale || sale.productId !== reversal.productId || BigInt(reversal.deltaUnits) !== -BigInt(sale.deltaUnits)) fail('VOID_LINES_MISMATCH');
                }
            }
            for (const operation of event.operations) {
                const operationKey = JSON.stringify([eventScope, operation.operationId]);
                const owner = operations.get(operationKey);
                if (owner) {
                    recordConflict('operation', operationKey, owner.event, event);
                    if (owner.content !== canonical(operation)) fail('OPERATION_ID_CONFLICT');
                    fail('OPERATION_ALREADY_BOUND_TO_ANOTHER_EVENT');
                }
            }
            const receiptId = `mock-receipt-${++receiptSequence}`;
            events.set(eventKey, { content, receiptId, event });
            for (const operation of event.operations) {
                const operationKey = JSON.stringify([eventScope, operation.operationId]);
                operations.set(operationKey, { content: canonical(operation), operation, eventKey, event });
            }
            if (isVoid) voidedSales.set(JSON.stringify([eventScope, event.saleId]), event.eventId);
            return { accepted: true, replay: false, receiptId };
        },
        inspect() {
            return { eventCount: events.size, operationCount: operations.size, voidedSaleCount: voidedSales.size,
                conflictSubjectCount: conflicts.size,
                conflictVariantCount: [...conflicts.values()].reduce((sum, variants) => sum + variants.size, 0) };
        },
        readConflicts() {
            return [...conflicts.entries()].map(([key, variants]) => ({
                subject: JSON.parse(key)[0], scopeKey: JSON.parse(key)[1],
                variants: [...variants.values()].map(value => JSON.parse(canonical(value))),
            }));
        },
    });
}
