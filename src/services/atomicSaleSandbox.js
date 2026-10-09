import { projectStockOperations } from '../utils/stockOperationModel.js';

// Deliberately NOT imported by checkout/storage/cloud sync. No default database,
// migration, network client or fallback into the operational BodegaApp database.
export const ATOMIC_SALE_SANDBOX_PREFIX = 'PDA-AtomicSale-Sandbox-';
const STORES = ['baselines', 'sales', 'operations', 'stock', 'outbox'];
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const QUANTITY = /^[1-9]\d{0,39}$/;
const MAX_LINES = 500;
const MAX_JSON_BYTES = 1024 * 1024;
const VOID_REASON_CODES = new Set(['CUSTOMER_REQUEST', 'WRONG_ITEM', 'DUPLICATE_SALE', 'OTHER']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fail(code) { throw new Error(code); }
function id(value) { if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_ID'); }
function exactKeys(value, keys) {
    if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_SHAPE');
}

/** Canonical JSON, not a lossy stringify/hash: invalid values never disappear. */
function canonical(value, depth = 0) {
    if (depth > 30) fail('JSON_TOO_DEEP');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length
            || Object.keys(value).some((key, i) => key !== String(i))) fail('INVALID_JSON_ARRAY');
        return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
    }
    if (!plain(value) || Object.getOwnPropertySymbols(value).length) fail('INVALID_JSON');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
}
function copyJSON(value, maxBytes = MAX_JSON_BYTES) {
    const text = canonical(value);
    if (new TextEncoder().encode(text).length > maxBytes) fail('JSON_TOO_LARGE');
    return JSON.parse(text);
}
function scopeFor({ accountId, businessId, epochId }) {
    [accountId, businessId, epochId].forEach(id);
    return JSON.stringify([accountId, businessId, epochId]);
}

/** All quantities are exact integer strings in micro-units; no generated IDs. */
export function prepareSandboxSale(input) {
    const sale = copyJSON(input); // capture caller data synchronously, before any I/O
    exactKeys(sale, ['version', 'accountId', 'businessId', 'epochId', 'saleId', 'deviceId', 'actorId', 'soldAt', 'lines', 'receipt']);
    if (sale.version !== 1) fail('INVALID_VERSION');
    const scope = scopeFor(sale);
    [sale.saleId, sale.deviceId, sale.actorId].forEach(id);
    if (typeof sale.soldAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(sale.soldAt)
        || !Number.isFinite(Date.parse(sale.soldAt)) || new Date(sale.soldAt).toISOString() !== sale.soldAt) fail('INVALID_SALE_TIME');
    if (!Array.isArray(sale.lines) || !sale.lines.length || sale.lines.length > MAX_LINES || !plain(sale.receipt)) fail('INVALID_SALE_LINES_OR_RECEIPT');
    const lineIds = new Set(), operationIds = new Set();
    const operations = sale.lines.map(line => {
        exactKeys(line, ['lineId', 'operationId', 'productId', 'quantityUnits']);
        [line.lineId, line.operationId, line.productId].forEach(id);
        if (typeof line.quantityUnits !== 'string' || !QUANTITY.test(line.quantityUnits)) fail('INVALID_QUANTITY');
        if (lineIds.has(line.lineId) || operationIds.has(line.operationId)) fail('DUPLICATE_LINE_OR_OPERATION');
        lineIds.add(line.lineId); operationIds.add(line.operationId);
        return { version: 1, businessId: sale.businessId, epochId: sale.epochId,
            operationId: line.operationId, deviceId: sale.deviceId, actorId: sale.actorId,
            productId: line.productId, kind: 'SALE', deltaUnits: '-' + line.quantityUnits };
    });
    // Line order is not identity; two identical replays with reordered lines match.
    sale.lines.sort((a, b) => a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0);
    operations.sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0);
    const content = canonical({ sale, operations });
    return { scope, sale, operations, content };
}

/** A void is an explicit compensating event. Free-text reasons are excluded to
 * keep this recovery journal bounded and avoid accidentally storing sensitive data. */
function prepareVoidEnvelope(input) {
    const voidEvent = copyJSON(input);
    exactKeys(voidEvent, ['version', 'accountId', 'businessId', 'epochId', 'voidId', 'saleId',
        'deviceId', 'actorId', 'voidedAt', 'reasonCode', 'lines']);
    if (voidEvent.version !== 1) fail('INVALID_VERSION');
    const scope = scopeFor(voidEvent);
    [voidEvent.voidId, voidEvent.saleId, voidEvent.deviceId, voidEvent.actorId].forEach(id);
    if (voidEvent.voidId === voidEvent.saleId) fail('INVALID_VOID_ID');
    if (typeof voidEvent.voidedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(voidEvent.voidedAt)
        || !Number.isFinite(Date.parse(voidEvent.voidedAt)) || new Date(voidEvent.voidedAt).toISOString() !== voidEvent.voidedAt) fail('INVALID_VOID_TIME');
    if (!VOID_REASON_CODES.has(voidEvent.reasonCode)) fail('INVALID_VOID_REASON');
    if (!Array.isArray(voidEvent.lines) || !voidEvent.lines.length || voidEvent.lines.length > MAX_LINES) fail('INVALID_VOID_LINES');
    const saleOperationIds = new Set(), operationIds = new Set();
    for (const line of voidEvent.lines) {
        exactKeys(line, ['saleOperationId', 'operationId']);
        [line.saleOperationId, line.operationId].forEach(id);
        if (line.saleOperationId === line.operationId || saleOperationIds.has(line.saleOperationId)
            || operationIds.has(line.operationId)) fail('DUPLICATE_VOID_LINE_OR_OPERATION');
        saleOperationIds.add(line.saleOperationId); operationIds.add(line.operationId);
    }
    voidEvent.lines.sort((a, b) => a.saleOperationId < b.saleOperationId ? -1 : a.saleOperationId > b.saleOperationId ? 1 : 0);
    return { scope, voidEvent, content: canonical(voidEvent) };
}

function buildVoidOperations(voidEvent, saleOperations) {
    const byId = new Map(saleOperations.map(operation => [operation.operationId, operation]));
    if (voidEvent.lines.length !== byId.size) fail('VOID_LINES_MISMATCH');
    const operations = voidEvent.lines.map(line => {
        const sale = byId.get(line.saleOperationId);
        if (!sale || sale.kind !== 'SALE') fail('VOID_LINES_MISMATCH');
        return { version: 1, businessId: voidEvent.businessId, epochId: voidEvent.epochId,
            operationId: line.operationId, deviceId: voidEvent.deviceId, actorId: voidEvent.actorId,
            productId: sale.productId, kind: 'VOID', deltaUnits: (-BigInt(sale.deltaUnits)).toString(),
            saleOperationId: sale.operationId };
    });
    operations.sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0);
    return operations;
}

function openDatabase(factory, name) {
    return new Promise((resolve, reject) => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore('baselines', { keyPath: 'scope' });
            for (const storeName of STORES.slice(1)) {
                const store = db.createObjectStore(storeName, { keyPath: ['scope', 'id'] });
                store.createIndex('scope', 'scope');
            }
        };
        request.onerror = () => reject(request.error || new Error('DATABASE_OPEN_FAILED'));
        // If open completed after a blocked rejection, do not leak a connection.
        let blocked = false;
        request.onblocked = () => { blocked = true; reject(new Error('DATABASE_OPEN_BLOCKED')); };
        request.onsuccess = () => {
            if (blocked) { request.result.close(); return; }
            resolve(request.result);
        };
    });
}

/** Resolve ONLY at oncomplete. Synchronous request callbacks keep IDB active;
 * no fetch/crypto/timer/await is permitted inside this transaction. */
function transaction(db, mode, work) {
    return new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(STORES, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
        catch (error) { reject(error); return; } // no relaxed/non-atomic fallback
        let result, cause;
        const abort = error => {
            cause = error;
            try { tx.abort(); } catch { reject(error); }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(cause || tx.error || new Error('TRANSACTION_ABORTED'));
        tx.onerror = event => { cause ||= event.target.error || tx.error || new Error('TRANSACTION_FAILED'); }; // preserve request error and default abort
        const request = (req, callback) => {
            req.onsuccess = () => { try { callback(req.result); } catch (error) { abort(error); } };
            return req;
        };
        try { work({ tx, request, done: value => { result = value; } }); }
        catch (error) { abort(error); }
    });
}
function readMany(context, entries, callback) {
    let remaining = entries.length;
    const values = {};
    if (!remaining) { callback(values); return; }
    for (const [name, request] of entries) context.request(request, value => {
        values[name] = value;
        if (--remaining === 0) callback(values);
    });
}

/** Explicit sandbox prefix is mandatory; merely importing this module opens nothing. */
export async function openAtomicSaleSandbox({ databaseName, indexedDB: factory = globalThis.indexedDB } = {}) {
    if (typeof databaseName !== 'string' || !databaseName.startsWith(ATOMIC_SALE_SANDBOX_PREFIX)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(databaseName.slice(ATOMIC_SALE_SANDBOX_PREFIX.length))) fail('SANDBOX_DATABASE_NAME_REQUIRED');
    if (!factory) fail('INDEXEDDB_UNAVAILABLE');
    const db = await openDatabase(factory, databaseName);
    db.onversionchange = () => db.close();

    return {
        close: () => db.close(),
        async exportBackup() {
            // One readonly transaction = coherent snapshot across every store.
            const data = await transaction(db, 'readonly', context => readMany(context,
                STORES.map(name => [name, context.tx.objectStore(name).getAll()]), context.done));
            const backup = { format: 'PDA-AtomicSale-Sandbox', version: 2,
                exportedAt: new Date().toISOString(), data: normalizeBackupData({ ...data,
                    outbox: data.outbox.map(entry => ({ ...entry, kind: entry.kind || 'SALE' })) }) };
            const sha256 = await digest(canonical(backup));
            const complete = { ...backup, sha256 };
            await validateAtomicSaleBackup(complete); // never export inconsistent evidence as restorable
            return complete;
        },
        async restoreBackup(input) {
            const backup = await validateAtomicSaleBackup(input);
            // Validation/crypto finishes BEFORE taking the write transaction.
            const restoredData = normalizeBackupData({ ...backup.data,
                outbox: backup.data.outbox.map(entry => ({ ...entry, kind: entry.kind || 'SALE' })) });
            return transaction(db, 'readwrite', context => readMany(context,
                STORES.map(name => [name, context.tx.objectStore(name).getAll()]), existing => {
                    if (STORES.some(name => existing[name].length)) {
                        const existingData = normalizeBackupData({ ...existing,
                            outbox: existing.outbox.map(entry => ({ ...entry, kind: entry.kind || 'SALE' })) });
                        if (canonical(existingData) !== canonical(restoredData)) fail('RESTORE_DESTINATION_NOT_EMPTY');
                        context.done({ restored: false, replay: true, rows: countBackupRows(restoredData) }); return;
                    }
                    for (const name of STORES) for (const row of restoredData[name]) context.tx.objectStore(name).add(row);
                    context.done({ restored: true, replay: false, rows: countBackupRows(restoredData) });
                }));
        },
        async initializeBaseline(input, { allowNegative = false } = {}) {
            const captured = copyJSON(input);
            exactKeys(captured, ['version', 'accountId', 'businessId', 'epochId', 'stockUnits']);
            if (typeof allowNegative !== 'boolean') fail('INVALID_STOCK_POLICY');
            const scope = scopeFor(captured);
            const { accountId: _accountId, ...baseline } = captured;
            projectStockOperations(baseline, []); // same exact quantities/model contract
            if (!allowNegative && Object.values(baseline.stockUnits).some(units => BigInt(units) < 0n)) fail('NEGATIVE_BASELINE');
            const content = canonical({ baseline: captured, allowNegative });
            return transaction(db, 'readwrite', context => {
                const baselines = context.tx.objectStore('baselines');
                context.request(baselines.get(scope), existing => {
                    if (existing) {
                        if (existing.content !== content) fail('BASELINE_CONFLICT');
                        context.done({ initialized: false, replay: true }); return;
                    }
                    baselines.add({ scope, baseline: captured, allowNegative, content });
                    for (const [productId, units] of Object.entries(captured.stockUnits)) {
                        context.tx.objectStore('stock').add({ scope, id: productId, units });
                    }
                    context.done({ initialized: true, replay: false });
                });
            });
        },
        async commitSale(input) {
            const prepared = prepareSandboxSale(input);
            if (!globalThis.crypto?.subtle) fail('WEB_CRYPTO_REQUIRED');
            // Compute revision before opening the transaction. Compare exact content
            // for replay; SHA-256 is only a transport revision token, not authority.
            const revision = await digest(prepared.content);
            const { scope, sale, operations, content } = prepared;
            const committedAt = new Date().toISOString();
            return transaction(db, 'readwrite', context => {
                const { tx } = context;
                const saleKey = [scope, sale.saleId];
                const products = [...new Set(operations.map(operation => operation.productId))];
                readMany(context, [
                    ['baseline', tx.objectStore('baselines').get(scope)],
                    ['sale', tx.objectStore('sales').get(saleKey)],
                    ['outbox', tx.objectStore('outbox').get(saleKey)],
                    ...operations.map((op, i) => ['op' + i, tx.objectStore('operations').get([scope, op.operationId])]),
                    ...products.map((productId, i) => ['stock' + i, tx.objectStore('stock').get([scope, productId])]),
                ], values => {
                    if (!values.baseline) fail('BASELINE_REQUIRED');
                    if (values.sale) {
                        if (values.sale.content !== content) fail('SALE_ID_CONFLICT');
                        if (!values.outbox || values.outbox.revision !== revision
                            || products.some((_, i) => !values['stock' + i])
                            || operations.some((operation, i) => values['op' + i]?.saleId !== sale.saleId
                                || canonical(values['op' + i]?.operation) !== canonical(operation))) fail('INCOMPLETE_COMMIT');
                        context.done({ committed: true, replay: true, saleId: sale.saleId, revision }); return;
                    }
                    if (values.outbox) fail('INCOMPLETE_COMMIT');
                    if (operations.some((_, i) => values['op' + i])) fail('OPERATION_ID_CONFLICT');
                    const { accountId: _accountId, ...baseline } = values.baseline.baseline;
                    if (!projectStockOperations(baseline, operations).complete) fail('INVALID_STOCK_OPERATIONS');
                    const nextStock = new Map(products.map((productId, i) => {
                        if (!values['stock' + i]) fail('PRODUCT_STOCK_REQUIRED');
                        return [productId, BigInt(values['stock' + i].units)];
                    }));
                    for (const operation of operations) nextStock.set(operation.productId,
                        nextStock.get(operation.productId) + BigInt(operation.deltaUnits));
                    if (!values.baseline.allowNegative && [...nextStock.values()].some(units => units < 0n)) fail('INSUFFICIENT_STOCK');
                    tx.objectStore('sales').add({ scope, id: sale.saleId, sale, content, revision, committedAt });
                    for (const operation of operations) tx.objectStore('operations').add({
                        scope, id: operation.operationId, saleId: sale.saleId, operation,
                    });
                    for (const [productId, units] of nextStock) tx.objectStore('stock').put({ scope, id: productId, units: units.toString() });
                    tx.objectStore('outbox').add({ scope, id: sale.saleId, kind: 'SALE', revision, status: 'pending', attempts: 0,
                        lastAttemptAt: null, committedAt, payload: { sale, operations } });
                    context.done({ committed: true, replay: false, saleId: sale.saleId, revision });
                });
            });
        },
        async voidSale(input) {
            const prepared = prepareVoidEnvelope(input);
            if (!globalThis.crypto?.subtle) fail('WEB_CRYPTO_REQUIRED');
            const { scope, voidEvent, content } = prepared;
            const revision = await digest(content);
            const committedAt = new Date().toISOString();
            return transaction(db, 'readwrite', context => {
                const { tx } = context;
                const outboxStore = tx.objectStore('outbox');
                readMany(context, [
                    ['baseline', tx.objectStore('baselines').get(scope)],
                    ['sale', tx.objectStore('sales').get([scope, voidEvent.saleId])],
                    ['idCollisionSale', tx.objectStore('sales').get([scope, voidEvent.voidId])],
                    ['voidOutbox', outboxStore.get([scope, voidEvent.voidId])],
                    ['scopeOutbox', outboxStore.index('scope').getAll(scope)],
                    ['scopeOperations', tx.objectStore('operations').index('scope').getAll(scope)],
                    ['scopeStock', tx.objectStore('stock').index('scope').getAll(scope)],
                ], values => {
                    if (!values.baseline) fail('BASELINE_REQUIRED');
                    if (values.idCollisionSale) fail('VOID_ID_CONFLICT');
                    if (!values.sale) fail('SALE_NOT_FOUND');
                    const sale = prepareSandboxSale(values.sale.sale);
                    if (sale.scope !== scope || sale.sale.saleId !== voidEvent.saleId || values.sale.content !== sale.content) fail('INCOMPLETE_COMMIT');
                    const saleOutbox = values.scopeOutbox.find(entry => entry.id === voidEvent.saleId);
                    if (!saleOutbox || (saleOutbox.kind && saleOutbox.kind !== 'SALE')
                        || saleOutbox.revision !== values.sale.revision
                        || canonical(saleOutbox.payload) !== canonical({ sale: sale.sale, operations: sale.operations })) fail('INCOMPLETE_COMMIT');
                    const operationsById = new Map(values.scopeOperations.map(row => [row.id, row]));
                    for (const operation of sale.operations) {
                        const row = operationsById.get(operation.operationId);
                        if (!row || row.saleId !== sale.sale.saleId || canonical(row.operation) !== canonical(operation)) fail('INCOMPLETE_COMMIT');
                    }
                    const operations = buildVoidOperations(voidEvent, sale.operations);
                    const existing = values.voidOutbox;
                    if (existing) {
                        if (existing.kind !== 'VOID' || existing.revision !== revision
                            || canonical(existing.payload?.void) !== canonical(voidEvent)
                            || canonical(existing.payload?.operations) !== canonical(operations)) fail('VOID_ID_CONFLICT');
                        if (values.scopeOutbox.some(entry => entry.kind === 'VOID' && entry.payload?.void?.saleId === voidEvent.saleId
                            && entry.id !== voidEvent.voidId)) fail('INCOMPLETE_COMMIT');
                        if (operations.some(operation => {
                            const row = operationsById.get(operation.operationId);
                            return !row || row.saleId !== voidEvent.saleId || canonical(row.operation) !== canonical(operation);
                        })) fail('INCOMPLETE_COMMIT');
                        const { accountId: _accountId, ...baseline } = values.baseline.baseline;
                        const projected = projectStockOperations(baseline, values.scopeOperations.map(row => row.operation));
                        if (!projected.complete) fail('INCOMPLETE_COMMIT');
                        assertStoredStock(projected.stockUnits, values.scopeStock);
                        context.done({ voided: true, replay: true, voidId: voidEvent.voidId, saleId: voidEvent.saleId, revision }); return;
                    }
                    if (values.scopeOutbox.some(entry => entry.kind === 'VOID' && entry.payload?.void?.saleId === voidEvent.saleId)) {
                        fail('SALE_ALREADY_VOIDED');
                    }
                    if (values.scopeOutbox.some(entry => entry.id === voidEvent.voidId)) fail('VOID_ID_CONFLICT');
                    if (values.scopeOperations.some(row => row.saleId === voidEvent.saleId && row.operation?.kind === 'VOID')) fail('INCOMPLETE_COMMIT');
                    const { accountId: _accountId, ...baseline } = values.baseline.baseline;
                    const current = values.scopeOperations.map(row => row.operation);
                    const before = projectStockOperations(baseline, current);
                    if (!before.complete) fail('INCOMPLETE_COMMIT');
                    assertStoredStock(before.stockUnits, values.scopeStock);
                    const operationIds = new Set(values.scopeOperations.map(row => row.id));
                    if (operations.some(operation => operationIds.has(operation.operationId))) fail('OPERATION_ID_CONFLICT');
                    const projection = projectStockOperations(baseline, [...current, ...operations]);
                    if (!projection.complete) fail('INVALID_VOID_OPERATIONS');
                    for (const operation of operations) tx.objectStore('operations').add({
                        scope, id: operation.operationId, saleId: voidEvent.saleId, operation,
                    });
                    for (const productId of new Set(operations.map(operation => operation.productId))) {
                        const stock = values.scopeStock.find(row => row.id === productId);
                        const units = BigInt(stock.units) + operations.filter(operation => operation.productId === productId)
                            .reduce((sum, operation) => sum + BigInt(operation.deltaUnits), 0n);
                        if (!values.baseline.allowNegative && units < 0n) fail('INVALID_VOID_STOCK');
                        tx.objectStore('stock').put({ scope, id: productId, units: units.toString() });
                    }
                    outboxStore.add({ scope, id: voidEvent.voidId, kind: 'VOID', revision, status: 'pending',
                        attempts: 0, lastAttemptAt: null, committedAt, payload: { void: voidEvent, operations } });
                    context.done({ voided: true, replay: false, voidId: voidEvent.voidId, saleId: voidEvent.saleId, revision });
                });
            });
        },
        async readScope(input) {
            const scope = scopeFor(copyJSON(input));
            return transaction(db, 'readonly', context => readMany(context, [
                ['baseline', context.tx.objectStore('baselines').get(scope)],
                ...STORES.slice(1).map(name => [name, context.tx.objectStore(name).index('scope').getAll(scope)]),
            ], values => context.done({ ...values, baseline: values.baseline ?? null })));
        },
        async recordOutboxAttempt(input) {
            const { scope, outboxId, kind, revision } = outboxIdentity(input);
            return transaction(db, 'readwrite', context => {
                const store = context.tx.objectStore('outbox');
                context.request(store.get([scope, outboxId]), entry => {
                    requireRevision(entry, revision, kind);
                    if (entry.status === 'confirmed') { context.done({ confirmed: true, attempts: entry.attempts }); return; }
                    store.put({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: new Date().toISOString() });
                    context.done({ confirmed: false, attempts: entry.attempts + 1 });
                });
            });
        },
        async confirmOutbox(input) {
            const captured = copyJSON(input);
            const { scope, outboxId, kind, revision } = outboxIdentity(captured);
            id(captured.receiptId);
            return transaction(db, 'readwrite', context => {
                const store = context.tx.objectStore('outbox');
                context.request(store.get([scope, outboxId]), entry => {
                    requireRevision(entry, revision, kind);
                    if (entry.status === 'confirmed') {
                        if (entry.receiptId !== captured.receiptId) fail('ACK_RECEIPT_CONFLICT');
                        context.done({ confirmed: true, replay: true }); return;
                    }
                    store.put({ ...entry, status: 'confirmed', receiptId: captured.receiptId, confirmedAt: new Date().toISOString() });
                    context.done({ confirmed: true, replay: false });
                });
            });
        },
    };
}
function requireRevision(entry, revision, kind) {
    if (!entry) fail('OUTBOX_NOT_FOUND');
    if (entry.revision !== revision) fail('ACK_REVISION_MISMATCH');
    if (kind && (entry.kind || 'SALE') !== kind) fail('OUTBOX_KIND_MISMATCH');
}
function assertStoredStock(projected, rows) {
    const stored = Object.fromEntries(rows.map(row => [row.id, row.units]));
    if (canonical(stored) !== canonical(projected)) fail('INCOMPLETE_COMMIT');
}
function outboxIdentity(input) {
    const captured = copyJSON(input);
    exactKeys(captured, ['version', 'accountId', 'businessId', 'epochId', 'stockUnits', 'saleId', 'outboxId', 'kind', 'revision', 'receiptId']);
    const scope = scopeFor(captured);
    const hasSaleId = Object.hasOwn(captured, 'saleId'), hasOutboxId = Object.hasOwn(captured, 'outboxId');
    if (hasSaleId === hasOutboxId) fail('INVALID_OUTBOX_ID');
    const outboxId = hasSaleId ? captured.saleId : captured.outboxId;
    id(outboxId);
    if (captured.kind !== undefined && !['SALE', 'VOID'].includes(captured.kind)) fail('INVALID_OUTBOX_KIND');
    if (typeof captured.revision !== 'string' || !/^[a-f0-9]{64}$/.test(captured.revision)) fail('INVALID_REVISION');
    if (captured.receiptId !== undefined) id(captured.receiptId);
    return { scope, outboxId, kind: captured.kind, revision: captured.revision };
}

const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const MAX_BACKUP_ROWS = 100000;
async function digest(text) {
    if (!globalThis.crypto?.subtle) fail('WEB_CRYPTO_REQUIRED');
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function timestamp(value) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
        || new Date(value).toISOString() !== value) fail('INVALID_BACKUP_TIMESTAMP');
}
function normalizeBackupData(data) {
    return Object.fromEntries(STORES.map(name => [name, [...data[name]].sort((a, b) => {
        const left = JSON.stringify([a.scope, a.id ?? null]), right = JSON.stringify([b.scope, b.id ?? null]);
        return left < right ? -1 : left > right ? 1 : 0;
    })]));
}
const countBackupRows = data => STORES.reduce((sum, name) => sum + data[name].length, 0);
const backupRowKey = row => JSON.stringify([row.scope, row.id]);
function equal(actual, expected) { if (canonical(actual) !== canonical(expected)) fail('INCONSISTENT_BACKUP'); }

/** Public validation captures a private copy; checks hashes AND economic relations.
 * No IDB writes. The caller receives only the fully verified normalized backup. */
export async function validateAtomicSaleBackup(input) {
    const backup = copyJSON(input, MAX_BACKUP_BYTES);
    exactKeys(backup, ['format', 'version', 'exportedAt', 'data', 'sha256']);
    if (backup.format !== 'PDA-AtomicSale-Sandbox' || ![1, 2].includes(backup.version)) fail('INVALID_BACKUP_VERSION');
    timestamp(backup.exportedAt);
    exactKeys(backup.data, STORES);
    if (STORES.some(name => !Array.isArray(backup.data[name]))) fail('INVALID_BACKUP_STORES');
    const { sha256, ...body } = backup;
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || await digest(canonical(body)) !== sha256) fail('BACKUP_CHECKSUM_MISMATCH');
    if (countBackupRows(backup.data) > MAX_BACKUP_ROWS) fail('INVALID_BACKUP_STORES');
    const maps = Object.fromEntries(STORES.map(name => [name, new Map()]));
    const shape = {
        baselines: ['scope', 'baseline', 'allowNegative', 'content'],
        sales: ['scope', 'id', 'sale', 'content', 'revision', 'committedAt'],
        operations: ['scope', 'id', 'saleId', 'operation'],
        stock: ['scope', 'id', 'units'],
        outbox: ['scope', 'id', 'kind', 'revision', 'status', 'attempts', 'lastAttemptAt', 'committedAt', 'payload', 'receiptId', 'confirmedAt'],
    };
    for (const name of STORES) for (const row of backup.data[name]) {
        exactKeys(row, backup.version === 1 && name === 'outbox' ? shape[name].filter(key => key !== 'kind') : shape[name]);
        if (name === 'outbox' && backup.version === 2 && !['SALE', 'VOID'].includes(row.kind)) fail('INVALID_BACKUP_OUTBOX_KIND');
        let parts;
        try { parts = JSON.parse(row.scope); } catch { fail('INVALID_BACKUP_SCOPE'); }
        if (!Array.isArray(parts) || parts.length !== 3) fail('INVALID_BACKUP_SCOPE');
        parts.forEach(id);
        if (JSON.stringify(parts) !== row.scope) fail('INVALID_BACKUP_SCOPE');
        if (name !== 'baselines') id(row.id);
        const key = name === 'baselines' ? row.scope : backupRowKey(row);
        if (maps[name].has(key)) fail('DUPLICATE_BACKUP_ROW');
        maps[name].set(key, row);
    }
    for (const row of backup.data.baselines) {
        exactKeys(row.baseline, ['version', 'accountId', 'businessId', 'epochId', 'stockUnits']);
        if (scopeFor(row.baseline) !== row.scope || typeof row.allowNegative !== 'boolean') fail('INCONSISTENT_BACKUP');
        const { accountId: _accountId, ...baseline } = row.baseline;
        projectStockOperations(baseline, []);
        if (!row.allowNegative && Object.values(baseline.stockUnits).some(units => BigInt(units) < 0n)) fail('NEGATIVE_BASELINE');
        equal(row.content, canonical({ baseline: row.baseline, allowNegative: row.allowNegative }));
    }
    const expectedOperations = new Map(), scopeOperations = new Map(), expectedOutboxes = new Map();
    for (const row of backup.data.sales) {
        const prepared = prepareSandboxSale(row.sale);
        if (prepared.scope !== row.scope || row.id !== prepared.sale.saleId || !maps.baselines.has(row.scope)) fail('INCONSISTENT_BACKUP');
        equal(row.sale, prepared.sale); equal(row.content, prepared.content);
        if (row.revision !== await digest(prepared.content)) fail('SALE_REVISION_MISMATCH');
        timestamp(row.committedAt);
        const outbox = maps.outbox.get(backupRowKey(row));
        if (!outbox) fail('INCOMPLETE_BACKUP');
        expectedOutboxes.set(backupRowKey(outbox), true);
        if (outbox.kind && outbox.kind !== 'SALE') fail('INCONSISTENT_BACKUP');
        equal(outbox.payload, { sale: prepared.sale, operations: prepared.operations });
        if (outbox.revision !== row.revision || outbox.committedAt !== row.committedAt
            || !['pending', 'confirmed'].includes(outbox.status)
            || !Number.isSafeInteger(outbox.attempts) || outbox.attempts < 0) fail('INCONSISTENT_BACKUP');
        if (outbox.attempts === 0) { if (outbox.lastAttemptAt !== null) fail('INCONSISTENT_BACKUP'); }
        else timestamp(outbox.lastAttemptAt);
        if (outbox.status === 'confirmed') { id(outbox.receiptId); timestamp(outbox.confirmedAt); }
        else if (Object.hasOwn(outbox, 'receiptId') || Object.hasOwn(outbox, 'confirmedAt')) fail('INCONSISTENT_BACKUP');
        const ops = scopeOperations.get(row.scope) || [];
        for (const operation of prepared.operations) {
            const opRow = { scope: row.scope, id: operation.operationId, saleId: row.id, operation };
            const key = backupRowKey(opRow);
            if (expectedOperations.has(key)) fail('OPERATION_ID_CONFLICT');
            expectedOperations.set(key, opRow); ops.push(operation);
            if (!maps.operations.has(key)) fail('INCOMPLETE_BACKUP');
            equal(maps.operations.get(key), opRow);
        }
        scopeOperations.set(row.scope, ops);
    }
    for (const outbox of backup.data.outbox) {
        if ((outbox.kind || 'SALE') !== 'VOID') continue;
        const voidEvent = outbox.payload?.void;
        const prepared = prepareVoidEnvelope(voidEvent);
        if (prepared.scope !== outbox.scope || prepared.voidEvent.voidId !== outbox.id
            || !maps.sales.has(backupRowKey({ scope: outbox.scope, id: voidEvent.saleId }))) fail('INCONSISTENT_BACKUP');
        const sale = prepareSandboxSale(maps.sales.get(backupRowKey({ scope: outbox.scope, id: voidEvent.saleId })).sale);
        const operations = buildVoidOperations(voidEvent, sale.operations);
        equal(outbox.payload, { void: voidEvent, operations });
        const revision = await digest(prepared.content);
        if (outbox.revision !== revision) fail('VOID_REVISION_MISMATCH');
        timestamp(outbox.committedAt);
        if (!['pending', 'confirmed'].includes(outbox.status) || !Number.isSafeInteger(outbox.attempts) || outbox.attempts < 0) fail('INCONSISTENT_BACKUP');
        if (outbox.attempts === 0) { if (outbox.lastAttemptAt !== null) fail('INCONSISTENT_BACKUP'); }
        else timestamp(outbox.lastAttemptAt);
        if (outbox.status === 'confirmed') { id(outbox.receiptId); timestamp(outbox.confirmedAt); }
        else if (Object.hasOwn(outbox, 'receiptId') || Object.hasOwn(outbox, 'confirmedAt')) fail('INCONSISTENT_BACKUP');
        if ([...expectedOutboxes.keys()].some(key => {
            const existing = maps.outbox.get(key);
            return existing?.scope === outbox.scope && existing?.kind === 'VOID'
                && existing?.payload?.void?.saleId === voidEvent.saleId && existing.id !== outbox.id;
        })) fail('SALE_ALREADY_VOIDED');
        expectedOutboxes.set(backupRowKey(outbox), true);
        for (const operation of operations) {
            const opRow = { scope: outbox.scope, id: operation.operationId, saleId: voidEvent.saleId, operation };
            const key = backupRowKey(opRow);
            if (expectedOperations.has(key)) fail('OPERATION_ID_CONFLICT');
            expectedOperations.set(key, opRow);
            const rows = scopeOperations.get(outbox.scope) || [];
            rows.push(operation); scopeOperations.set(outbox.scope, rows);
            if (!maps.operations.has(key)) fail('INCOMPLETE_BACKUP');
            equal(maps.operations.get(key), opRow);
        }
    }
    if (maps.operations.size !== expectedOperations.size || maps.outbox.size !== expectedOutboxes.size) fail('ORPHAN_BACKUP_ROW');
    const expectedStock = new Map();
    for (const row of backup.data.baselines) {
        const { accountId: _accountId, ...baseline } = row.baseline;
        const projection = projectStockOperations(baseline, scopeOperations.get(row.scope) || []);
        if (!projection.complete) fail('INCONSISTENT_BACKUP');
        for (const [productId, units] of Object.entries(projection.stockUnits)) {
            if (!row.allowNegative && BigInt(units) < 0n) fail('INSUFFICIENT_STOCK');
            const stockRow = { scope: row.scope, id: productId, units };
            const key = backupRowKey(stockRow); expectedStock.set(key, stockRow);
            if (!maps.stock.has(key)) fail('INCOMPLETE_BACKUP');
            equal(maps.stock.get(key), stockRow);
        }
    }
    if (maps.stock.size !== expectedStock.size) fail('ORPHAN_BACKUP_ROW');
    // The format has deterministic row order, so validation never returns a
    // modified body with the old checksum attached.
    equal(backup.data, normalizeBackupData(backup.data));
    return backup;
}
