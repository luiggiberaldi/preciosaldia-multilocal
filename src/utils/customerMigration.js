import { storageService } from './storageService.js';
import { withLock } from './withLock.js';
import {
    CUSTOMER_LEDGER_KEY,
    CUSTOMER_LEDGER_MIGRATION_KEY,
    CUSTOMER_MOVEMENT_TYPES,
    createCustomerLedgerMovement,
    getCustomerBalance,
    normalizeCustomer,
} from './customerLedger.js';

const CUSTOMERS_KEY = 'bodega_customers_v1';

function finiteAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
}

function normalizeLegacyCustomer(customer) {
    // saldoFavor was used by older UI versions. Add it to favor, then calculate
    // the net balance so debt/favor cannot remain positive at the same time.
    const legacyFavor = finiteAmount(customer?.favor) + finiteAmount(customer?.saldoFavor);
    const legacyDebt = finiteAmount(customer?.deuda);
    return normalizeCustomer({
        ...customer,
        favor: legacyFavor,
        deuda: legacyDebt,
    });
}

export async function migrateCustomerLedgerWithinLock() {
    const alreadyMigrated = await storageService.getItem(CUSTOMER_LEDGER_MIGRATION_KEY, null);
    if (alreadyMigrated?.version === 'v1') {
        return { migrated: false, alreadyMigrated: true, report: alreadyMigrated.report || null };
    }

    const customers = await storageService.getItem(CUSTOMERS_KEY, []);
    const ledger = await storageService.getItem(CUSTOMER_LEDGER_KEY, []);
    const nextLedger = Array.isArray(ledger) ? [...ledger] : [];
    const report = {
        version: 'v1',
        reviewed: customers.length,
        normalized: 0,
        withFavor: 0,
        withDebt: 0,
        inconsistent: 0,
        initialMovements: 0,
        manualReview: [],
    };

    const updatedCustomers = customers.map(customer => {
        const beforeFavor = finiteAmount(customer?.favor) + finiteAmount(customer?.saldoFavor);
        const beforeDebt = finiteAmount(customer?.deuda);
        if (beforeFavor > 0 && beforeDebt > 0) report.inconsistent += 1;

        const normalized = normalizeLegacyCustomer(customer);
        if (normalized.favor > 0) report.withFavor += 1;
        if (normalized.deuda > 0) report.withDebt += 1;
        if (normalized.favor !== beforeFavor || normalized.deuda !== beforeDebt || customer?.saldoFavor != null) {
            report.normalized += 1;
        }

        const sourceId = `customer_ledger_migration_v1:${customer.id}`;
        if (normalized.favor > 0 || normalized.deuda > 0) {
            if (!nextLedger.some(m => m.sourceId === sourceId)) {
                const balance = getCustomerBalance(normalized);
                nextLedger.push(createCustomerLedgerMovement({
                    customerId: customer.id,
                    type: CUSTOMER_MOVEMENT_TYPES.INITIAL,
                    direction: balance >= 0 ? 'CREDIT' : 'DEBIT',
                    amountUsd: Math.abs(balance),
                    balanceBeforeUsd: 0,
                    balanceAfterUsd: balance,
                    sourceType: 'MIGRATION',
                    sourceId,
                    reason: 'Saldo inicial migrado desde cartera histórica',
                    user: { id: 'SYSTEM', nombre: 'Sistema' },
                    migrationVersion: 'v1',
                }));
                report.initialMovements += 1;
            }
        }
        return normalized;
    });

    await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
    await storageService.setItem(CUSTOMER_LEDGER_KEY, nextLedger);
    await storageService.setItem(CUSTOMER_LEDGER_MIGRATION_KEY, {
        version: 'v1',
        completedAt: new Date().toISOString(),
        report,
    });

    return { migrated: true, alreadyMigrated: false, report, updatedCustomers, ledger: nextLedger };
}

export async function migrateCustomerLedger() {
    return withLock('pos_write_lock', migrateCustomerLedgerWithinLock);
}

export { normalizeLegacyCustomer };
