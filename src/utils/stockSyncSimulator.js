import { projectStockOperations } from './stockOperationModel.js';

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object' ? '{' + Object.keys(value).sort()
        .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
        : JSON.stringify(value);
function fail(message) { throw new Error(message); }
function projectionIdentity(projection) {
    return canonical({ stockUnits: projection.stockUnits, appliedOperationIds: projection.appliedOperationIds,
        voidedSaleIds: projection.voidedSaleIds, conflicts: projection.conflicts,
        pending: projection.pending, rejected: projection.rejected });
}

/**
 * Deterministically applies each replica's received event stream from the same
 * approved baseline, then recomputes the union from that baseline. It models
 * delivery/replay/convergence only; it is not a transport or stock authority.
 *
 * replicas: [{ replicaId, deliveries: [operation, ...] }]
 */
export function simulateStockSync({ baseline, replicas }) {
    if (!Array.isArray(replicas) || !replicas.length || replicas.length > 1000) fail('INVALID_REPLICAS');
    const replicaIds = new Set();
    let deliveryCount = 0;
    const perReplica = replicas.map(replica => {
        if (!plain(replica) || Object.keys(replica).some(key => !['replicaId', 'deliveries'].includes(key))
            || typeof replica.replicaId !== 'string' || !ID.test(replica.replicaId)
            || !Array.isArray(replica.deliveries)) fail('INVALID_REPLICA');
        if (replicaIds.has(replica.replicaId)) fail('DUPLICATE_REPLICA_ID');
        replicaIds.add(replica.replicaId);
        deliveryCount += replica.deliveries.length;
        if (deliveryCount > 100000) fail('TOO_MANY_DELIVERIES');
        const projection = projectStockOperations(baseline, replica.deliveries);
        return {
            replicaId: replica.replicaId,
            deliveryCount: replica.deliveries.length,
            uniqueOperationIds: [...new Set(replica.deliveries.map(event => event?.operationId)
                .filter(value => typeof value === 'string' && ID.test(value)))].sort(),
            projection,
        };
    });
    const allDeliveries = replicas.flatMap(replica => replica.deliveries);
    const globalProjection = projectStockOperations(baseline, allDeliveries);
    const globalIdentity = projectionIdentity(globalProjection);
    const unresolvedReplicas = perReplica.filter(replica => projectionIdentity(replica.projection) !== globalIdentity)
        .map(replica => replica.replicaId);
    const oversoldProducts = Object.entries(globalProjection.stockUnits)
        .filter(([, units]) => BigInt(units) < 0n)
        .map(([productId, units]) => ({ productId, units }));
    return {
        version: 1,
        deliveryCount,
        globalProjection,
        replicas: perReplica,
        converged: unresolvedReplicas.length === 0,
        unresolvedReplicas,
        oversoldProducts,
        hasConflicts: globalProjection.conflicts.length > 0,
        complete: globalProjection.complete,
    };
}
