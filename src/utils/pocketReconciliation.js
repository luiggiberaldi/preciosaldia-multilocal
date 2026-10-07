// ============================================================
// FIA-REPORT-001 (H5) — Conciliación cartera ↔ ledger de clientes
// ------------------------------------------------------------
// Hay tres fuentes de verdad para la deuda de un cliente:
//   1. El registro de la venta (`VENTA_FIADA` / `COBRO_DEUDA`) → reportes.
//   2. `customer.deuda` / `customer.favor` (snapshot denormalizado) → Dashboard.
//   3. El ledger de movimientos con `balanceAfterUsd` → hoy sin lectores.
//
// Este núcleo compara (2) contra (3). Es de solo lectura: no repara nada.
// La reparación existe (`rebuildCustomersFromLedger`) y se invoca desde la UI
// con confirmación explícita.
//
// Convención del ledger (ver customerLedger.js): saldo NEGATIVO = el cliente
// debe; saldo POSITIVO = el cliente tiene saldo a favor.
// ============================================================

import { calculateLedgerBalance } from './customerLedger';
import { round2, sumR } from './dinero';

export const RECONCILIATION_TOLERANCE_USD = 0.01;

function nameOf(customer) {
    return customer?.name || customer?.nombre || customer?.id || '(sin nombre)';
}

/**
 * Compara la cartera guardada en cada cliente con el saldo de su ledger.
 *
 * @param {Array} customers
 * @param {Array} ledger
 * @param {{ tolerance?: number }} [opts]
 * @returns {{
 *   ok: boolean, checkedCount: number, ledgerMovements: number,
 *   drift: Array, ledgerOrphans: Array, totals: { driftUsd: number }
 * }}
 */
export function reconcileCustomersWithLedger(customers = [], ledger = [], {
    tolerance = RECONCILIATION_TOLERANCE_USD,
} = {}) {
    const customerList = (Array.isArray(customers) ? customers : []).filter(c => c && c.id);
    const entries = Array.isArray(ledger) ? ledger : [];
    const knownIds = new Set(customerList.map(c => c.id));

    const movementCount = new Map();
    const ledgerOrphans = [];
    entries.forEach(movement => {
        if (!movement) return;
        if (!movement.customerId || !knownIds.has(movement.customerId)) {
            ledgerOrphans.push(movement);
            return;
        }
        if (movement.status === 'VOIDED') return;
        movementCount.set(movement.customerId, (movementCount.get(movement.customerId) || 0) + 1);
    });

    const drift = [];
    let checkedCount = 0;

    customerList.forEach(customer => {
        // Sin movimientos en el ledger no hay nada que conciliar: el cliente
        // puede ser previo al ledger (saldo migrado sin movimientos).
        if (!movementCount.has(customer.id)) return;
        checkedCount += 1;

        const ledgerBalanceUsd = round2(calculateLedgerBalance(entries, customer.id));
        const ledgerDeudaUsd = round2(Math.max(0, -ledgerBalanceUsd));
        const ledgerFavorUsd = round2(Math.max(0, ledgerBalanceUsd));
        const customerDeudaUsd = round2(Number(customer.deuda) || 0);
        const customerFavorUsd = round2(Number(customer.favor) || 0);

        const deltaDeudaUsd = round2(customerDeudaUsd - ledgerDeudaUsd);
        const deltaFavorUsd = round2(customerFavorUsd - ledgerFavorUsd);
        if (Math.abs(deltaDeudaUsd) <= tolerance && Math.abs(deltaFavorUsd) <= tolerance) return;

        drift.push({
            customerId: customer.id,
            name: nameOf(customer),
            customerDeudaUsd,
            ledgerDeudaUsd,
            deltaDeudaUsd,
            customerFavorUsd,
            ledgerFavorUsd,
            deltaFavorUsd,
            deltaUsd: round2(deltaDeudaUsd + deltaFavorUsd),
            ledgerBalanceUsd,
            movementCount: movementCount.get(customer.id) || 0,
        });
    });

    // Orden determinista: mayor descuadre primero, y desempate por id para que
    // dos corridas con los mismos datos produzcan exactamente el mismo informe.
    drift.sort((a, b) => {
        const byDelta = Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd);
        if (byDelta !== 0) return byDelta;
        return String(a.customerId).localeCompare(String(b.customerId));
    });

    return {
        ok: drift.length === 0,
        checkedCount,
        ledgerMovements: entries.length,
        drift,
        ledgerOrphans,
        totals: {
            driftUsd: round2(sumR(drift.map(d => Math.abs(d.deltaUsd)))),
        },
    };
}
