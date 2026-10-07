// ============================================================
// FIA-REPORT-001 — Agregados CONGELADOS del dataset determinista v4.0
// ------------------------------------------------------------
// Cómo se obtuvo cada número (no se derivan del código bajo prueba):
//   1. Se construyó el dataset con fecha fija (`buildDeterministicDataset`).
//   2. Se corrió el pipeline real (calcularReportsData + conciliación).
//   3. Cada agregado se verificó con una SUMA INDEPENDIENTE sobre los registros
//      crudos (ver `tests/receivablesDeterministic.test.js`), que es lo que hace
//      que estos números sean una prueba y no una tautología.
//
// Partida doble verificada:
//   fiadoSoloUsd 139,28 + casheaOtorgado 23,01 = fiadoOtorgadoUsd 162,29
//   abonosUsd     95,69 + remesasUsd      23,01 = cobranzasUsd     118,70
//   fiadoOtorgado 162,29 − cobranzas      118,70 = netoUsd           43,59
//   netoUsd 43,59 == bucket `fiado` del motor == fiadoBucketUsd 43,59
//   carteraUsd 53,19 = 27,45 (cli-01) + 21,14 (cli-02) + 4,60 Cashea (cli-02)
//   saldo a favor: cli-03 con 5,00 (= DETERMINISTIC_EXCEDENTE_USD)
// ============================================================

export const DETERMINISTIC_DATE = '2026-09-20';
export const DETERMINISTIC_PERIOD = { from: '2026-09-18', to: '2026-09-22' };

export const DETERMINISTIC_EXPECTED = {
    // ── Dataset ──
    rate: 36.50,
    totalRecords: 113,          // 1 apertura + 102 ventas + 4 abonos + 2 cashea + 2 remesas + 2 anuladas
    businessRecords: 102,       // las 102 ventas originales (secuencia intacta)
    voidedRecords: 5,           // 3 del generador original + 2 del bloque de cartera
    ledgerMovements: 18,

    // ── Cuentas por cobrar del período ──
    fiadoOtorgadoUsd: 162.29,   // 139,28 fiado + 23,01 Cashea
    fiadoSoloUsd: 139.28,
    casheaOtorgadoUsd: 23.01,
    cobranzasUsd: 118.70,       // 95,69 abonos + 23,01 remesas
    abonosUsd: 95.69,
    remesasUsd: 23.01,
    netoUsd: 43.59,
    saldoFavorGeneradoUsd: 5,
    fiadosCount: 15,            // 13 VENTA_FIADA + 2 VENTA_CASHEA
    cobranzasCount: 6,          // 4 COBRO_DEUDA + 2 COBRO_CASHEA
    movimientosCount: 21,

    // ── Caja (bruta: el vuelto vive en su propio bucket) ──
    efectivoUsd: 525.09,
    efectivoBs: 514.29,
    pagoMovilBs: 26617.73,
    vueltosUsd: 203.95,

    // ── Buckets del motor ──
    fiadoBucketUsd: 43.59,
    fiadoBsAtSaleRate: 1591.05, // 43,59 × 36,50
    saldoFavorBucketUsd: 5,
    saldoFavorOrigins: { vueltoMonederoUsd: 0, excedenteAbonoUsd: 5 },

    // ── Ventas del período ──
    totalUsd: 1108.07,
    totalBs: 40444.67,
    totalItems: 493,
    profitBs: 11826.45,
    historySales: 105,          // 102 ventas + 2 Cashea + 1 fiado anulado (las cobranzas no son historial de ventas)
    salesCountStats: 101,       // VENTA + VENTA_FIADA + VENTA_CASHEA NO anuladas (105 de historial − 4 anuladas)

    // ── Cartera (stock) ──
    carteraUsd: 53.19,
    clientes: [
        { id: 'det-cli-01', name: 'Maria Garcia', deudaUsd: 27.45, favorUsd: 0, casheaDeudaUsd: 0 },
        { id: 'det-cli-02', name: 'Jose Rodriguez', deudaUsd: 21.14, favorUsd: 0, casheaDeudaUsd: 4.60 },
        { id: 'det-cli-03', name: 'Ana Martinez', deudaUsd: 0, favorUsd: 5, casheaDeudaUsd: 0 },
    ],

    // ── Conciliación: el dataset es consistente por construcción ──
    reconciliation: { ok: true, checkedCount: 3, drift: 0, ledgerOrphans: 0 },
};
