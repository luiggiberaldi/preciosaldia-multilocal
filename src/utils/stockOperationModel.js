/**
 * Modelo de referencia, NO conectado a checkout/sync. Un snapshot de stock
 * NO es una operación. El baseline debe ser aprobado para una época nueva;
 * solo admite operaciones producidas bajo esa misma época y sede.
 *
 * Cantidades: enteros decimales canónicos en micro-unidades (10^6 por unidad).
 * BigInt evita drift y dependencia del orden. Los JSON llevan strings, no BigInt.
 * IDs/payloads son inmutables: dos variantes del mismo ID quedan en conflicto.
 * Un VOID refiere una SALE y compensa exactamente su delta, como máximo una vez.
 */
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const INTEGER = /^-?(?:0|[1-9]\d{0,39})$/;
const fields = new Set(['version', 'businessId', 'epochId', 'operationId', 'deviceId',
    'actorId', 'productId', 'kind', 'deltaUnits', 'saleOperationId']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = value => typeof value === 'string' && INTEGER.test(value) && value !== '-0';
const stable = value => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])));
const sortedObject = entries => Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

function invalidOperation(operation) {
    if (!plain(operation) || Object.keys(operation).some(key => !fields.has(key))) return 'invalid-shape';
    if (operation.version !== 1 || !['businessId', 'epochId', 'operationId', 'deviceId', 'actorId', 'productId']
        .every(key => typeof operation[key] === 'string' && ID.test(operation[key]))) return 'invalid-identity';
    if (!['SALE', 'RESTOCK', 'ADJUSTMENT', 'VOID'].includes(operation.kind)
        || !integer(operation.deltaUnits) || operation.deltaUnits === '0') return 'invalid-quantity-or-kind';
    const delta = BigInt(operation.deltaUnits);
    if (operation.kind === 'SALE' && delta >= 0n) return 'invalid-sale-sign';
    if (operation.kind === 'RESTOCK' && delta <= 0n) return 'invalid-restock-sign';
    if (operation.kind === 'VOID') {
        if (delta <= 0n || typeof operation.saleOperationId !== 'string' || !ID.test(operation.saleOperationId)
            || operation.saleOperationId === operation.operationId) return 'invalid-void-reference';
    } else if (operation.saleOperationId !== undefined) return 'unexpected-sale-reference';
    return null;
}

/** Recompute from baseline + full immutable operation set, never from yesterday's projection. */
export function projectStockOperations(baseline, operations) {
    if (!plain(baseline) || baseline.version !== 1
        || !['businessId', 'epochId'].every(key => typeof baseline[key] === 'string' && ID.test(baseline[key]))
        || !plain(baseline.stockUnits)
        || Object.entries(baseline.stockUnits).some(([id, value]) => !ID.test(id) || !integer(value))) {
        throw new Error('Invalid approved stock baseline');
    }
    if (!Array.isArray(operations)) throw new Error('Operations must be an array');
    const stock = new Map(Object.entries(baseline.stockUnits).map(([id, value]) => [id, BigInt(value)]));
    const groups = new Map(), rejected = [], conflicts = [], pending = [], accepted = new Map();
    let replays = 0;
    for (const operation of operations) {
        const reason = invalidOperation(operation);
        const id = typeof operation?.operationId === 'string' && ID.test(operation.operationId) ? operation.operationId : null;
        if (!id) { rejected.push({ operationId: null, reason: reason || 'invalid-identity' }); continue; }
        // Include invalid variants in the ID group: do not silently pick a valid sibling.
        const group = groups.get(id) || { variants: new Map(), invalid: false };
        const signature = plain(operation) ? stable(operation) : 'invalid';
        if (group.variants.has(signature)) replays++;
        group.variants.set(signature, operation);
        if (reason) { rejected.push({ operationId: id, reason }); group.invalid = true; }
        groups.set(id, group);
    }
    for (const [id, group] of groups) {
        if (group.variants.size > 1) { conflicts.push({ operationId: id, variantCount: group.variants.size }); continue; }
        if (group.invalid) continue;
        const operation = group.variants.values().next().value;
        if (operation.businessId !== baseline.businessId || operation.epochId !== baseline.epochId) {
            rejected.push({ operationId: id, reason: 'foreign-business-or-epoch' }); continue;
        }
        if (!stock.has(operation.productId)) { pending.push({ operationId: id, reason: 'unknown-product' }); continue; }
        accepted.set(id, operation);
    }
    const applied = new Set(), voided = new Set(), voids = new Map();
    for (const [id, operation] of accepted) {
        if (operation.kind === 'VOID') {
            const sale = accepted.get(operation.saleOperationId);
            if (!sale || sale.kind !== 'SALE') { pending.push({ operationId: id, reason: 'sale-not-confirmed' }); continue; }
            if (sale.productId !== operation.productId || BigInt(operation.deltaUnits) !== -BigInt(sale.deltaUnits)) {
                rejected.push({ operationId: id, reason: 'void-does-not-match-sale' }); continue;
            }
            const list = voids.get(sale.operationId) || [];
            list.push(operation); voids.set(sale.operationId, list);
        } else {
            stock.set(operation.productId, stock.get(operation.productId) + BigInt(operation.deltaUnits));
            applied.add(id);
        }
    }
    for (const [saleId, list] of voids) {
        // Several correctly authorized void commands still represent ONE cancellation.
        const sale = accepted.get(saleId);
        stock.set(sale.productId, stock.get(sale.productId) - BigInt(sale.deltaUnits));
        voided.add(saleId);
        for (const operation of list) applied.add(operation.operationId);
    }
    const sortIssues = list => list.sort((a, b) => stable(a).localeCompare(stable(b), 'en'));
    return {
        version: 1, businessId: baseline.businessId, epochId: baseline.epochId,
        stockUnits: sortedObject([...stock].map(([id, value]) => [id, value.toString()])),
        appliedOperationIds: [...applied].sort(), voidedSaleIds: [...voided].sort(), replays,
        conflicts: sortIssues(conflicts), pending: sortIssues(pending), rejected: sortIssues(rejected),
        complete: !conflicts.length && !pending.length && !rejected.length,
    };
}
