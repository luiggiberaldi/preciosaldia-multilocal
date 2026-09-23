// ============================================================
// FIA-REPORT-001 — Escenarios congelados de cuentas por cobrar
// ------------------------------------------------------------
// REGLAS DE ESTE ARCHIVO:
//   1. Todo importe y todo `expected` están escritos a mano. Nunca se derivan
//      del código bajo prueba (si el motor cambia, el test debe fallar).
//   2. La tasa es fija (849,56) y las fechas son fijas: el escenario es
//      reproducible al centavo en cualquier máquina.
//   3. Cada escenario nombra el hallazgo que cubre.
//
// Los agregados de cada escenario se verifican además contra `sumRawByHand`
// (segunda implementación ingenua) en tests/receivablesInvariants.test.js.
// ============================================================

import { round2 } from '../../src/utils/dinero';

export const FIXED_RATE = 849.56;
export const PERIOD_FROM = '2026-09-01';
export const PERIOD_TO = '2026-09-30';

const day = (d) => `2026-09-${String(d).padStart(2, '0')}T14:00:00`;

/** Pago en la forma exacta que persiste el checkout. */
const pay = (methodId, amount, currency = 'USD') => ({
    methodId,
    methodLabel: methodId,
    amount,
    currency,
    amountUsd: currency === 'USD' ? amount : round2(amount / FIXED_RATE),
    amountBs: currency === 'USD' ? round2(amount * FIXED_RATE) : amount,
});

const base = {
    status: 'COMPLETADA',
    rate: FIXED_RATE,
    tasaCop: 0,
    copEnabled: false,
};

/** Venta 100 % fiada: exactamente lo que produce el checkout cuando nadie paga. */
export const fiadoSale = (id, usd, extra = {}) => ({
    ...base,
    id,
    tipo: 'VENTA_FIADA',
    timestamp: day(extra.day || 10),
    totalUsd: usd,
    totalBs: round2(usd * FIXED_RATE),
    fiadoUsd: usd,
    payments: [],
    customerId: extra.customerId || 'c-a',
    customerName: extra.customerName || 'Maria Garcia',
    saleNumber: extra.saleNumber || null,
    items: [{ id: 'p-1', name: 'Harina PAN 1kg', qty: 1, priceUsd: usd, costUsd: round2(usd * 0.7) }],
    ...extra,
});

/** Venta de contado pagada completa. */
export const cashSale = (id, usd, { methodId = 'efectivo_usd', currency = 'USD', day: d = 10 } = {}) => ({
    ...base,
    id,
    tipo: 'VENTA',
    timestamp: day(d),
    totalUsd: usd,
    totalBs: round2(usd * FIXED_RATE),
    fiadoUsd: 0,
    payments: [pay(methodId, currency === 'USD' ? usd : round2(usd * FIXED_RATE), currency)],
    items: [{ id: 'p-2', name: 'Arroz Mary 1kg', qty: 1, priceUsd: usd, costUsd: round2(usd * 0.7) }],
});

/** Abono del cliente (COBRO_DEUDA). */
export const abono = (id, usd, { methodId = 'efectivo_usd', currency = 'USD', saldoFavorGeneradoUsd = 0, day: d = 12 } = {}) => ({
    ...base,
    id,
    tipo: 'COBRO_DEUDA',
    timestamp: day(d),
    totalUsd: usd,
    totalBs: round2(usd * FIXED_RATE),
    saldoFavorGeneradoUsd,
    customerId: 'c-a',
    customerName: 'Maria Garcia',
    payments: [pay(methodId, currency === 'USD' ? usd : round2(usd * FIXED_RATE), currency)],
    items: [{ id: null, name: 'Abono de deuda: Maria Garcia', qty: 1, priceUsd: usd, costBs: 0 }],
});

export const SCENARIOS = {
    // ── H4 + H9: el fiado positivo diluía los % y generaba caja fantasma ──
    E1_fiado_con_cobranzas: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [fiadoSale('e1-f1', 150), cashSale('e1-v1', 100), abono('e1-a1', 50)],
        expected: {
            fiadoOtorgadoUsd: 150,
            cobranzasUsd: 50,
            netoUsd: 100,
            hasMovement: true,
            efectivoUsdBucket: 150,
            phantomCashBuckets: [],
            pctEfectivoUsd: 100,
        },
    },

    // ── H1: cobranzas > fiado ⇒ la sección desaparecía ──
    E2_cobranzas_mayor_que_fiado: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [
            fiadoSale('e2-f1', 4, { day: 5 }),
            fiadoSale('e2-f2', 6, { day: 6 }),
            abono('e2-a1', 4, { day: 7 }),
            abono('e2-a2', 6, { day: 8 }),
            abono('e2-a3', 15, { day: 9 }),
        ],
        expected: {
            fiadoOtorgadoUsd: 10,
            cobranzasUsd: 25,
            netoUsd: -15,
            hasMovement: true,
            fiadoBucketUsd: -15,
            efectivoUsdBucket: 25,
            phantomCashBuckets: [],
            pctEfectivoUsd: 100,
        },
    },

    // ── H1 extremo: solo cobranzas, cero fiado nuevo ──
    E3_solo_cobranzas: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [abono('e3-a1', 40)],
        expected: {
            fiadoOtorgadoUsd: 0,
            cobranzasUsd: 40,
            netoUsd: -40,
            hasMovement: true,
            efectivoUsdBucket: 40,
            phantomCashBuckets: [],
        },
    },

    // ── H7: el excedente de un abono es un origen distinto del vuelto acreditado ──
    E4_abono_con_excedente: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [
            fiadoSale('e4-f1', 25, { day: 4 }),
            abono('e4-a1', 40, { day: 5, saldoFavorGeneradoUsd: 15 }),
        ],
        expected: {
            fiadoOtorgadoUsd: 25,
            cobranzasUsd: 40,
            netoUsd: -15,
            saldoFavorGeneradoUsd: 15,
            walletOrigins: { vueltoMonederoUsd: 0, excedenteAbonoUsd: 15 },
            phantomCashBuckets: [],
        },
    },

    // ── FIN-004: venta fiada con pago parcial real ──
    E5_fiado_parcial: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [fiadoSale('e5-f1', 100, { fiadoUsd: 30, payments: [pay('efectivo_usd', 70)] })],
        expected: {
            fiadoOtorgadoUsd: 30,
            cobranzasUsd: 0,
            netoUsd: 30,
            efectivoUsdBucket: 70,
            phantomCashBuckets: [],
        },
    },

    // ── G7: lo anulado no existe para ningún agregado ──
    E6_anuladas: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [
            { ...fiadoSale('e6-f1', 50), status: 'ANULADA' },
            { ...abono('e6-a1', 50), status: 'ANULADA' },
        ],
        expected: {
            fiadoOtorgadoUsd: 0,
            cobranzasUsd: 0,
            netoUsd: 0,
            hasMovement: false,
            phantomCashBuckets: [],
        },
    },

    // ── H1 para Cashea: neto 0 y el bucket se descarta ⇒ la vista no puede depender del bucket ──
    E7_cashea_ida_y_vuelta: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [
            {
                ...base,
                id: 'e7-c1',
                tipo: 'VENTA_CASHEA',
                timestamp: day(6),
                totalUsd: 50,
                totalBs: round2(50 * FIXED_RATE),
                casheaUsd: 40,
                fiadoUsd: 0,
                customerId: 'c-a',
                customerName: 'Maria Garcia',
                payments: [pay('efectivo_usd', 10), { ...pay('cashea', 40), isCashea: true }],
                items: [{ id: 'p-3', name: 'Queso Llanero 1kg', qty: 1, priceUsd: 50, costUsd: 35 }],
            },
            {
                ...base,
                id: 'e7-r1',
                tipo: 'COBRO_CASHEA',
                timestamp: day(20),
                totalUsd: 40,
                totalBs: round2(40 * FIXED_RATE),
                payments: [pay('efectivo_usd', 40)],
                items: [{ id: null, name: 'Remesa Cashea', qty: 1, priceUsd: 40, costBs: 0 }],
            },
        ],
        expected: {
            fiadoOtorgadoUsd: 40,
            cobranzasUsd: 40,
            netoUsd: 0,
            hasMovement: true,
            efectivoUsdBucket: 50,
            phantomCashBuckets: [],
        },
    },

    // ── H4: crédito interno usado como pago no diluye ni suma como medio de pago ──
    E8_saldo_a_favor_usado: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [
            {
                ...base,
                id: 'e8-v1',
                tipo: 'VENTA',
                timestamp: day(11),
                totalUsd: 20,
                totalBs: round2(20 * FIXED_RATE),
                payments: [{ ...pay('saldo_favor', 20), currency: 'INTERNAL_CREDIT', isInternalCredit: true, amountBs: 0 }],
                items: [{ id: 'p-4', name: 'Leche Completa 1L', qty: 1, priceUsd: 20, costUsd: 14 }],
            },
        ],
        expected: {
            fiadoOtorgadoUsd: 0,
            cobranzasUsd: 0,
            hasMovement: false,
            internalCreditAppliedUsd: 20,
            methodsBs: 0,
        },
    },

    // ── Nada de ruido cuando no hay movimientos ──
    E9_periodo_vacio: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [cashSale('e9-v1', 30)],
        expected: {
            fiadoOtorgadoUsd: 0,
            cobranzasUsd: 0,
            netoUsd: 0,
            hasMovement: false,
            efectivoUsdBucket: 30,
            phantomCashBuckets: [],
        },
    },

    // ── H8: el peso en Bs usa la tasa de la venta, no la de hoy ──
    E10_tasa_cruzada: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [
            { ...fiadoSale('e10-f1', 10, { day: 3 }), rate: 36.5, totalBs: 365 },
            fiadoSale('e10-f2', 10, { day: 4 }),
        ],
        expected: {
            fiadoOtorgadoUsd: 20,
            cobranzasUsd: 0,
            netoUsd: 20,
            hasMovement: true,
            // 10 USD a 36,50 (=365 Bs de la venta vieja) + 10 USD a 849,56 (=8.495,60 Bs)
            fiadoBsAtSaleRate: 8860.6,
            // Con la tasa de HOY (849,56) el peso sería 16.991,20: ese es el error que H8 evita.
            fiadoBsAtTodayRate: 16991.2,
        },
    },

    // ── H9: la venta 100 % fiada no toca ningún bucket de efectivo ──
    E13_venta_100_fiada: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [fiadoSale('e13-f1', 20)],
        expected: {
            fiadoOtorgadoUsd: 20,
            cobranzasUsd: 0,
            netoUsd: 20,
            hasMovement: true,
            phantomCashBuckets: [],
            cashBuckets: [],
        },
    },

    // ── H9 por la otra puerta: fiado manual (sin el campo `payments`) ──
    E14_fiado_manual_sin_payments: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [
            {
                ...base,
                id: 'e14-f1',
                tipo: 'VENTA_FIADA',
                timestamp: day(7),
                totalUsd: 50,
                totalBs: round2(50 * FIXED_RATE),
                fiadoUsd: 50,
                clienteId: 'c-a',
                clienteName: 'Maria Garcia',
                items: [{ id: null, name: 'Crédito manual: Maria Garcia', qty: 1, priceUsd: 50, costBs: 0 }],
            },
        ],
        expected: {
            fiadoOtorgadoUsd: 50,
            cobranzasUsd: 0,
            phantomCashBuckets: [],
            cashBuckets: [],
        },
    },

    // ── I10: un `paymentMethod: 'fiado'` legacy no debe volcar Bs en el bucket `fiado` ──
    E15_legacy_payment_method_fiado: {
        from: PERIOD_FROM,
        to: PERIOD_TO,
        sales: [{ ...fiadoSale('e15-f1', 20), paymentMethod: 'fiado' }],
        expected: {
            fiadoOtorgadoUsd: 20,
            fiadoBucketUsd: 20,
            phantomCashBuckets: [],
            cashBuckets: [],
        },
    },
};

// ── H5: conciliación de cartera contra el ledger ────────────────────────────
export const RECONCILIATION_FIXTURE = {
    customers: [
        { id: 'c-a', name: 'Maria Garcia', deuda: 4, favor: 0 },
        { id: 'c-b', name: 'Jose Rodriguez', deuda: 6, favor: 0 }, // ledger dice 4 ⇒ drift +2
        { id: 'c-c', name: 'Ana Martinez', deuda: 0, favor: 3 },   // favor consistente
    ],
    ledger: [
        { id: 'l1', customerId: 'c-a', type: 'VENTA_FIADA', amountUsd: 4, balanceBeforeUsd: 0, balanceAfterUsd: -4, status: 'COMPLETED', timestamp: '2026-09-02T10:00:00' },
        { id: 'l2', customerId: 'c-b', type: 'VENTA_FIADA', amountUsd: 6, balanceBeforeUsd: 0, balanceAfterUsd: -6, status: 'COMPLETED', timestamp: '2026-09-02T10:05:00' },
        { id: 'l3', customerId: 'c-b', type: 'ABONO_DEUDA', amountUsd: 2, balanceBeforeUsd: -6, balanceAfterUsd: -4, status: 'COMPLETED', timestamp: '2026-09-03T10:00:00' },
        { id: 'l4', customerId: 'c-c', type: 'AJUSTE_CREDITO', amountUsd: 3, balanceBeforeUsd: 0, balanceAfterUsd: 3, status: 'COMPLETED', timestamp: '2026-09-04T10:00:00' },
        { id: 'l5', customerId: 'c-fantasma', type: 'VENTA_FIADA', amountUsd: 9, balanceBeforeUsd: 0, balanceAfterUsd: -9, status: 'COMPLETED', timestamp: '2026-09-05T10:00:00' },
    ],
    expected: {
        ok: false,
        checkedCount: 3,
        drift: [
            { customerId: 'c-b', customerDeudaUsd: 6, ledgerDeudaUsd: 4, deltaDeudaUsd: 2, deltaUsd: 2 },
        ],
        ledgerOrphans: 1,
    },
};

// ── Cartera acumulada (stock) vs flujo del período ──────────────────────────
export const CARTERA_FIXTURE = {
    customers: [
        { id: 'c-a', deuda: 120.5, casheaDeuda: 0 },
        { id: 'c-b', deuda: 30, casheaDeuda: 45.25 },
        { id: 'c-c', deuda: 0, favor: 10 },
    ],
    expectedCarteraUsd: 195.75,
};
