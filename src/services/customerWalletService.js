import { storageService } from '../utils/storageService.js';
import { withLock } from '../utils/withLock.js';
import {
    CUSTOMER_LEDGER_KEY,
    CUSTOMER_MOVEMENT_TYPES,
    createCustomerLedgerMovement,
    getCustomerBalance,
    hasLedgerSource,
    normalizeCustomer,
    snapshotCustomerBalance,
    transitionCustomerBalance,
} from '../utils/customerLedger.js';

const CUSTOMERS_KEY = 'bodega_customers_v1';

function currentUser(user) {
    return user || { id: 'SYSTEM', nombre: 'Sistema' };
}

function validateMovement(movement, user) {
    if (!movement?.type) throw new Error('La operación de cartera requiere un tipo.');
    if (movement.sourceType === 'ADMIN_ADJUSTMENT' && user?.rol && user.rol !== 'ADMIN') {
        throw new Error('Solo ADMIN puede realizar ajustes administrativos de cartera.');
    }
    const amount = Number(movement.amountUsd);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('El monto de cartera debe ser un número no negativo.');
    }
    if (!movement.sourceId) {
        throw new Error('La operación de cartera requiere sourceId para garantizar idempotencia.');
    }
}

/**
 * Applies one or more movements while the caller already owns pos_write_lock.
 * This is the only low-level write path for customer.deuda/favor.
 */
export async function applyCustomerMovementsWithinLock({
    customerId,
    movements,
    user,
    customers: suppliedCustomers,
    ledger: suppliedLedger,
}) {
    if (!customerId) throw new Error('Se requiere cliente para modificar cartera.');
    if (!Array.isArray(movements) || movements.length === 0) {
        throw new Error('La operación de cartera no contiene movimientos.');
    }
    movements.forEach(movement => validateMovement(movement, user));

    const customers = suppliedCustomers || await storageService.getItem(CUSTOMERS_KEY, []);
    const ledger = suppliedLedger || await storageService.getItem(CUSTOMER_LEDGER_KEY, []);
    const customer = customers.find(c => c.id === customerId);
    if (!customer) throw new Error('El cliente no existe o fue eliminado.');

    let workingCustomer = normalizeCustomer(customer);
    const createdMovements = [];
    const skippedMovements = [];
    let workingLedger = Array.isArray(ledger) ? [...ledger] : [];

    // Lazy baseline protects existing customers before the one-time migration runs.
    if (!workingLedger.some(m => m.customerId === customerId)) {
        const initialBalance = getCustomerBalance(workingCustomer);
        if (initialBalance !== 0) {
            const initial = createCustomerLedgerMovement({
                customerId,
                type: CUSTOMER_MOVEMENT_TYPES.INITIAL,
                direction: initialBalance >= 0 ? 'CREDIT' : 'DEBIT',
                amountUsd: Math.abs(initialBalance),
                balanceBeforeUsd: 0,
                balanceAfterUsd: initialBalance,
                sourceType: 'MIGRATION',
                sourceId: `customer_ledger_migration_v1:${customerId}`,
                reason: 'Saldo inicial importado',
                user: { id: 'SYSTEM', nombre: 'Sistema' },
                migrationVersion: 'v1',
            });
            workingLedger.push(initial);
        }
    }

    for (const movement of movements) {
        if (hasLedgerSource(workingLedger, movement.sourceId)) {
            skippedMovements.push(movement.sourceId);
            continue;
        }

        const amount = Number(movement.amountUsd);
        if (movement.type === CUSTOMER_MOVEMENT_TYPES.CREDIT_USED) {
            const available = Number(workingCustomer.favor) || 0;
            if (amount > available + 0.005) {
                throw new Error(`El saldo a favor disponible es insuficiente. Disponible: $${available.toFixed(2)}.`);
            }
        }

        const before = getCustomerBalance(workingCustomer);
        const nextCustomer = transitionCustomerBalance(workingCustomer, movement);
        const after = getCustomerBalance(nextCustomer);
        const created = createCustomerLedgerMovement({
            ...movement,
            customerId,
            amountUsd: amount,
            balanceBeforeUsd: before,
            balanceAfterUsd: after,
            user: currentUser(user),
        });

        workingCustomer = nextCustomer;
        workingLedger.push(created);
        createdMovements.push(created);
    }

    // Always normalize the snapshot, including idempotent retries.
    workingCustomer = normalizeCustomer(workingCustomer);
    const updatedCustomers = customers.map(c => c.id === customerId ? workingCustomer : c);
    await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
    if (createdMovements.length > 0 || !suppliedLedger) {
        await storageService.setItem(CUSTOMER_LEDGER_KEY, workingLedger);
    }

    return {
        updatedCustomer: workingCustomer,
        updatedCustomers,
        createdMovements,
        skippedMovements,
        ledger: workingLedger,
    };
}

export async function applyCustomerMovement({ customerId, movement, user }) {
    return withLock('pos_write_lock', () => applyCustomerMovementsWithinLock({
        customerId,
        movements: [movement],
        user,
    }));
}

export async function applyCustomerMovements({ customerId, movements, user }) {
    return withLock('pos_write_lock', () => applyCustomerMovementsWithinLock({
        customerId,
        movements,
        user,
    }));
}

export async function reverseCustomerMovement({ movement, user, reason = 'Anulación de movimiento' }) {
    if (!movement?.id || !movement.customerId) throw new Error('Movimiento inválido para reversión.');
    return applyCustomerMovement({
        customerId: movement.customerId,
        user,
        movement: {
            type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
            direction: movement.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
            amountUsd: movement.amountUsd,
            sourceType: 'REVERSAL',
            sourceId: `reversal:${movement.id}`,
            sourceSaleId: movement.sourceSaleId || null,
            reason,
            reversalOf: movement.id,
        },
    });
}

export async function rebuildCustomerSnapshot(customerId) {
    return withLock('pos_write_lock', async () => {
        const customers = await storageService.getItem(CUSTOMERS_KEY, []);
        const ledger = await storageService.getItem(CUSTOMER_LEDGER_KEY, []);
        const customer = customers.find(c => c.id === customerId);
        if (!customer) throw new Error('El cliente no existe.');
        const customerMovements = ledger.filter(m => m.customerId === customerId && m.status !== 'VOIDED');
        const balance = customerMovements.length > 0
            ? customerMovements[customerMovements.length - 1].balanceAfterUsd
            : getCustomerBalance(customer);
        const updatedCustomer = snapshotCustomerBalance(normalizeCustomer(customer), balance);
        const updatedCustomers = customers.map(c => c.id === customerId ? updatedCustomer : c);
        await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
        return { updatedCustomer, updatedCustomers, ledger };
    });
}

export { CUSTOMERS_KEY };
