/**
 * customerCreditLens.js — Lente de crédito extendido del mes (solo lectura).
 *
 * Origen: hallazgo H2 de la auditoría E2E (AUDITORIA-E2E-FLUJOS.md). La cartera
 * es un saldo neto: fiar a un cliente con saldo a favor consume el favor y la
 * deuda no aumenta. Ledger y snapshot cuadran, pero cualquier superficie que
 * lea `customer.deuda` como «crédito extendido» no ve ese fiado.
 *
 * Este lente lee el ledger (fuente append-only) y expone, por cliente, cuánto
 * crédito se extendió en el mes en curso y cuánto se consumió de saldo a favor.
 * PLAN-LENS-CREDITO-EXTENDIDO.md · opción C (punto medio): cero cambios de
 * matemática, solo visibilidad.
 *
 * Guardarraíles:
 *  - FUNCIÓN PURA: no muta ledger, customers ni nada. Solo lectura.
 *  - `now` inyectable para determinismo en tests.
 *  - Movimientos con status VOIDED no cuentan.
 *  - Una venta ANULADA se compensa con su REVERSAL (reversalOf → movimiento
 *    original). Doble defensa: si se pasa `salesById` y la venta fuente está
 *    ANULADA, se excluye aunque el REVERSAL falte (ledger dañado).
 *
 * @module utils/customerCreditLens
 */

import { round2 } from './dinero.js';
import { CUSTOMER_MOVEMENT_TYPES } from './customerLedger.js';

const FIADO_TYPE = CUSTOMER_MOVEMENT_TYPES.CREDIT_SALE;   // 'VENTA_FIADA'
const CONSUMO_TYPE = CUSTOMER_MOVEMENT_TYPES.CREDIT_USED; // 'SALDO_FAVOR_USADO'
const REVERSAL_TYPE = CUSTOMER_MOVEMENT_TYPES.REVERSAL;   // 'ANULACION'

/** Clave de mes `YYYY-MM` desde un timestamp ISO; null si la fecha es inválida. */
function monthKeyOf(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {Array}  ledger           Movimientos de bodega_customer_ledger_v1
 * @param {Array}  customers        Lista de clientes (solo lectura; el lente no la usa para saldos)
 * @param {Object} [opts]
 * @param {Date}   [opts.now]       Momento de referencia (default: ahora). Movimientos
 *                                  de otros meses o futuros no cuentan.
 * @param {Map}    [opts.salesById] Mapa saleId → sale, doble defensa para anuladas.
 * @returns {{
 *   byCustomer: Object<string, {fiadoMes:number, consumoFavorMes:number, netoMes:number, fiadoCount:number}>,
 *   totalFiadoMes: number, totalConsumoFavorMes: number,
 * }}
 */
export function buildCustomerCreditLens(ledger, customers, { now = new Date(), salesById = null } = {}) {
    const refKey = monthKeyOf(now.toISOString());
    const byCustomer = {};
    const ensure = (id) => {
        if (!byCustomer[id]) {
            byCustomer[id] = { fiadoMes: 0, consumoFavorMes: 0, netoMes: 0, fiadoCount: 0 };
        }
        return byCustomer[id];
    };

    // Pata por movimiento original: id → { customerId, leg, amount }.
    // La reversión llega con `reversalOf` apuntando a ese id.
    const legByMovementId = new Map();
    // Pata por venta (para reversiones sin reversalOf): saleId → { fiado?: amount, consumo?: amount }.
    const legsBySaleId = new Map();

    for (const m of (Array.isArray(ledger) ? ledger : [])) {
        if (!m || m.status === 'VOIDED') continue;

        if (m.type === FIADO_TYPE || m.type === CONSUMO_TYPE) {
            const key = monthKeyOf(m.timestamp);
            if (!key || key !== refKey || new Date(m.timestamp).getTime() > now.getTime()) continue;

            // Doble defensa: venta fuente ANULADA sin REVERSAL no cuenta.
            const sale = salesById?.get(m.sourceSaleId);
            if (sale && sale.status === 'ANULADA') continue;

            const leg = m.type === FIADO_TYPE ? 'fiado' : 'consumo';
            const amount = round2(Number(m.amountUsd) || 0);
            const entry = ensure(m.customerId);
            if (leg === 'fiado') {
                entry.fiadoMes = round2(entry.fiadoMes + amount);
                entry.fiadoCount += 1;
            } else {
                entry.consumoFavorMes = round2(entry.consumoFavorMes + amount);
            }
            const record = { customerId: m.customerId, leg, amount };
            if (m.id) legByMovementId.set(m.id, record);
            if (m.sourceSaleId) {
                const bySale = legsBySaleId.get(m.sourceSaleId) || {};
                bySale[leg] = round2((bySale[leg] || 0) + amount);
                legsBySaleId.set(m.sourceSaleId, bySale);
            }
            continue;
        }

        if (m.type === REVERSAL_TYPE) {
            const key = monthKeyOf(m.timestamp);
            if (!key || key !== refKey) continue;

            // 1) Camino canónico: reversalOf → movimiento original.
            const original = m.reversalOf ? legByMovementId.get(m.reversalOf) : null;
            if (original) {
                const entry = ensure(original.customerId);
                if (original.leg === 'fiado') {
                    entry.fiadoMes = round2(entry.fiadoMes - original.amount);
                    entry.fiadoCount = Math.max(0, entry.fiadoCount - 1);
                } else {
                    entry.consumoFavorMes = round2(entry.consumoFavorMes - original.amount);
                }
                legByMovementId.delete(m.reversalOf);
                continue;
            }

            // 2) Fallback: reversión sin reversalOf (legacy). La dirección de la
            //    reversión es la opuesta a la del movimiento original: CREDIT
            //    revierte un DEBIT (fiado), DEBIT revierte un CREDIT (consumo).
            const bySale = m.sourceSaleId ? legsBySaleId.get(m.sourceSaleId) : null;
            if (bySale) {
                const leg = m.direction === 'CREDIT' ? 'fiado' : 'consumo';
                const amount = round2(bySale[leg] || 0);
                if (amount > 0) {
                    const entry = ensure(m.customerId);
                    if (leg === 'fiado') {
                        entry.fiadoMes = round2(entry.fiadoMes - amount);
                        entry.fiadoCount = Math.max(0, entry.fiadoCount - 1);
                    } else {
                        entry.consumoFavorMes = round2(entry.consumoFavorMes - amount);
                    }
                    bySale[leg] = 0;
                }
            }
            // 3) Reversión de otro tipo (abono, vuelto): no aplica al lente.
        }
        // Otros tipos (ABONO_DEUDA, VUELTO_ACREDITADO, ...) no cuentan.
    }

    let totalFiadoMes = 0;
    let totalConsumoFavorMes = 0;
    for (const entry of Object.values(byCustomer)) {
        entry.netoMes = round2(entry.fiadoMes - entry.consumoFavorMes);
        totalFiadoMes = round2(totalFiadoMes + entry.fiadoMes);
        totalConsumoFavorMes = round2(totalConsumoFavorMes + entry.consumoFavorMes);
    }

    return { byCustomer, totalFiadoMes, totalConsumoFavorMes };
}

/** El cliente tiene fiados en el mes (aunque su deuda actual sea 0). */
export function hasFiadoThisMonth(lensEntry) {
    return Boolean(lensEntry && lensEntry.fiadoCount > 0);
}

/** Ids de clientes con fiados del mes, para el chip «Fiados del mes». */
export function fiadoCustomerIds(lens) {
    if (!lens?.byCustomer) return [];
    return Object.keys(lens.byCustomer).filter(id => hasFiadoThisMonth(lens.byCustomer[id]));
}
