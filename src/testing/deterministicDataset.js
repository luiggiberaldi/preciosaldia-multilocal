// ============================================================
// DATASET DETERMINISTA v4.0 — FIA-REPORT-001
// ------------------------------------------------------------
// Generador PURO (sin window, sin storage, sin UI) para que el mismo dataset
// se pueda producir en la app y en los tests, al bit.
//
// Garantías:
//   - Semilla fija (12345) + tasa fija (36,50) ⇒ mismas 102 ventas SIEMPRE.
//   - El bloque de cartera (abonos, excedente, Cashea, anulaciones) usa un
//     SEGUNDO PRNG con semilla propia: extenderlo NO altera la secuencia de las
//     102 ventas originales (goldens históricos intactos).
//   - El ledger y el snapshot de cada cliente se derivan del MISMO recorrido,
//     así que el dataset es internamente consistente por construcción.
// ============================================================

import { mulR, round2, subR, sumR } from '../utils/dinero';

export const DETERMINISTIC_SEED = 12345;
export const DETERMINISTIC_RATE = 36.50;
export const DETERMINISTIC_SALES_COUNT = 102;
// Semilla independiente para el bloque de cartera (ver garantía arriba).
export const DETERMINISTIC_RECEIVABLES_SEED = DETERMINISTIC_SEED + 777;

// 10 productos con precio Y costo conocido (para verificar ganancia)
export const DETERMINISTIC_PRODUCTS = [
    { id: 'det-01', name: 'Harina PAN 1kg',       priceUsd: 1.10, priceUsdt: 1.10, costUsd: 0.75, stock: 500 },
    { id: 'det-02', name: 'Arroz Mary 1kg',        priceUsd: 0.95, priceUsdt: 0.95, costUsd: 0.60, stock: 300 },
    { id: 'det-03', name: 'Aceite Mazeite 1L',     priceUsd: 2.80, priceUsdt: 2.80, costUsd: 2.10, stock: 200 },
    { id: 'det-04', name: 'Azucar Montalban 1kg',  priceUsd: 1.25, priceUsdt: 1.25, costUsd: 0.85, stock: 250 },
    { id: 'det-05', name: 'Pasta Capri 500g',      priceUsd: 0.75, priceUsdt: 0.75, costUsd: 0.50, stock: 400 },
    { id: 'det-06', name: 'Leche Completa 1L',     priceUsd: 1.50, priceUsdt: 1.50, costUsd: 1.10, stock: 180 },
    { id: 'det-07', name: 'Huevos Carton 30u',     priceUsd: 3.50, priceUsdt: 3.50, costUsd: 2.80, stock: 100 },
    { id: 'det-08', name: 'Queso Llanero 1kg',     priceUsd: 4.00, priceUsdt: 4.00, costUsd: 3.20, stock: 80  },
    { id: 'det-09', name: 'Cafe Madrid 500g',      priceUsd: 3.20, priceUsdt: 3.20, costUsd: 2.50, stock: 150 },
    { id: 'det-10', name: 'Jabon Las Llaves 3u',   priceUsd: 1.80, priceUsdt: 1.80, costUsd: 1.20, stock: 220 },
];

// 3 clientes fijos para ventas fiadas
export const DETERMINISTIC_CUSTOMERS = [
    { id: 'det-cli-01', name: 'Maria Garcia',    phone: '0412-1111111', deuda: 0, favor: 0 },
    { id: 'det-cli-02', name: 'Jose Rodriguez',  phone: '0414-2222222', deuda: 0, favor: 0 },
    { id: 'det-cli-03', name: 'Ana Martinez',    phone: '0424-3333333', deuda: 0, favor: 0 },
];

export const DETERMINISTIC_EXCEDENTE_USD = 5;

// Curva de trafico diario (picos a 12pm y 6pm)
const HOURS_CURVE = [
    ...Array(5).fill(8),
    ...Array(10).fill(9),
    ...Array(15).fill(10),
    ...Array(18).fill(11),
    ...Array(20).fill(12),
    ...Array(10).fill(13),
    ...Array(5).fill(14),
    ...Array(8).fill(15),
    ...Array(12).fill(16),
    ...Array(18).fill(17),
    ...Array(25).fill(18),
    ...Array(15).fill(19),
    ...Array(5).fill(20),
];

/** Mulberry32: misma semilla → misma secuencia. */
export function createSeededRandom(seed) {
    let s = seed | 0;
    return () => {
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/** Hora del día (segundos desde medianoche) → timestamp ISO del mismo día. */
const stamp = (dateStr, secondsOfDay) => {
    const total = Math.floor(secondsOfDay) % 86400;
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${dateStr}T${hh}:${mm}:${ss}.000Z`;
};

/**
 * Construye el dataset completo.
 *
 * @param {{ dateStr?: string }} [opts] - Fecha base (por defecto, hoy en UTC).
 * @returns {{ dateStr, rate, sales, products, customers, ledger }}
 */
export function buildDeterministicDataset({ dateStr = new Date().toISOString().split('T')[0] } = {}) {
    const rand = createSeededRandom(DETERMINISTIC_SEED);
    const currentRate = DETERMINISTIC_RATE;

    // Copias frescas para mutar durante la generacion
    const products = DETERMINISTIC_PRODUCTS.map(p => ({ ...p }));
    const customers = DETERMINISTIC_CUSTOMERS.map(c => ({ ...c }));

    const sales = [];

    // ── Apertura de caja ──
    sales.push({
        id: 'det_apertura_001',
        tipo: 'APERTURA_CAJA',
        openingUsd: 100,
        openingBs: round2(100 * currentRate),
        timestamp: `${dateStr}T08:00:00.000Z`,
        cajaCerrada: false,
    });

    // ── Generar 102 ventas (secuencia original intacta) ──
    for (let i = 0; i < DETERMINISTIC_SALES_COUNT; i++) {
        const hRand = HOURS_CURVE[Math.floor(rand() * HOURS_CURVE.length)];
        const minRand = Math.floor(rand() * 60);
        const secRand = Math.floor(rand() * 60);
        const fTime = `${dateStr}T${String(hRand).padStart(2, '0')}:${String(minRand).padStart(2, '0')}:${String(secRand).padStart(2, '0')}.000Z`;

        // 1-4 items aleatorios (seeded)
        const itemC = Math.floor(rand() * 4) + 1;
        const items = [];
        let subtotalUsd = 0;

        for (let j = 0; j < itemC; j++) {
            const p = products[Math.floor(rand() * products.length)];
            const q = Math.floor(rand() * 3) + 1;
            items.push({ id: p.id, name: p.name, qty: q, priceUsd: p.priceUsd });
            subtotalUsd = sumR(subtotalUsd, mulR(p.priceUsd, q));
            p.stock = p.stock - q;
        }

        // 5% chance descuento 10%
        let discountUsd = 0;
        if (rand() < 0.05 && subtotalUsd > 1) {
            discountUsd = round2(subtotalUsd * 0.10);
        }

        const payableUsd = subR(subtotalUsd, discountUsd);
        const totalBs = round2(payableUsd * currentRate);

        // Tipo de venta (seeded)
        const rType = rand();
        let payments = [];
        let changeUsd = 0;
        let changeBs = 0;
        let fiadoUsd = 0;
        let customerId = null;
        let customerName = 'Consumidor Final';
        let tipoVenta = 'VENTA';
        let statusVenta = 'COMPLETADA';

        if (rType < 0.05) {
            // ~5% anuladas
            statusVenta = 'ANULADA';
            payments = [];
            for (const it of items) {
                const p = products.find(x => x.id === it.id);
                if (p) p.stock += it.qty;
            }
        } else if (rType < 0.15) {
            // ~10% fiadas
            tipoVenta = 'VENTA_FIADA';
            fiadoUsd = payableUsd;
            const c = customers[Math.floor(rand() * customers.length)];
            customerId = c.id;
            customerName = c.name;
            c.deuda = sumR(c.deuda || 0, fiadoUsd);
        } else if (rType < 0.35) {
            // ~20% efectivo USD con vuelto
            const bill = payableUsd < 15 ? 20 : (payableUsd < 45 ? 50 : 100);
            payments = [{ methodId: 'efectivo_usd', amount: bill, amountUsd: bill, currency: 'USD', methodLabel: 'Efectivo $' }];
            changeUsd = subR(bill, payableUsd);
            changeBs = 0;
        } else if (rType < 0.55) {
            // ~20% pago mixto
            const halfUsd = round2(payableUsd / 2);
            const remainingUsd = subR(payableUsd, halfUsd);
            payments = [
                { methodId: 'efectivo_usd', amount: halfUsd, amountUsd: halfUsd, currency: 'USD', methodLabel: 'Efectivo $' },
                { methodId: 'pago_movil', amount: round2(remainingUsd * currentRate), amountUsd: remainingUsd, currency: 'BS', methodLabel: 'Pago Movil' },
            ];
        } else {
            // ~45% pago movil total
            payments = [{ methodId: 'pago_movil', amount: totalBs, amountUsd: payableUsd, currency: 'BS', methodLabel: 'Pago Movil' }];
        }

        sales.push({
            id: `det_v3_${String(i).padStart(3, '0')}`,
            timestamp: fTime,
            items,
            cartSubtotalUsd: subtotalUsd,
            discountAmountUsd: discountUsd,
            discountValue: discountUsd > 0 ? 10 : 0,
            discountType: discountUsd > 0 ? 'PERCENT' : null,
            totalUsd: payableUsd,
            totalBs,
            rate: currentRate,
            tipo: tipoVenta,
            status: statusVenta,
            changeUsd,
            changeBs,
            fiadoUsd,
            payments,
            customerId,
            customerName,
            sellerName: 'Simulador v3.0 Determinista',
            saleNumber: 99000 + i,
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // BLOQUE DE CARTERA (FIA-REPORT-001) — PRNG propio, no toca lo anterior
    // ══════════════════════════════════════════════════════════════════════
    const rrand = createSeededRandom(DETERMINISTIC_RECEIVABLES_SEED);
    const ledger = [];
    let clock = 60 * 60 * 20;   // arranca a las 20:00, después del día de ventas
    const nextStamp = () => {
        clock += Math.floor(rrand() * 90) + 30;
        return stamp(dateStr, clock);
    };
    let balance = new Map(customers.map(c => [c.id, 0]));
    let ledgerSeq = 0;

    const move = (customerId, type, direction, amountUsd, { saleId = null, status = 'COMPLETED', reason, timestamp }) => {
        const before = round2(balance.get(customerId) || 0);
        const isVoid = status === 'VOIDED';
        const signed = direction === 'DEBIT' ? -amountUsd : amountUsd;
        // Un movimiento VOIDED no mueve el saldo: si algún consumidor lo contara,
        // el snapshot de cartera dejaría de cuadrar con el ledger (y el test cae).
        const after = isVoid ? before : round2(before + signed);
        balance.set(customerId, after);
        ledgerSeq += 1;
        ledger.push({
            id: `det_led_${String(ledgerSeq).padStart(3, '0')}`,
            customerId,
            type,
            direction,
            amountUsd: round2(amountUsd),
            currency: 'USD',
            balanceBeforeUsd: before,
            balanceAfterUsd: after,
            sourceType: saleId ? 'SALE' : 'MANUAL',
            sourceId: saleId,
            sourceSaleId: saleId,
            paymentMethodId: null,
            reason: reason || type,
            userId: 'DETERMINISTIC',
            userName: 'Simulador v3.0 Determinista',
            timestamp,
            status,
        });
        return after;
    };

    // Primero, un movimiento por cada venta fiada de las 102 (cronológico).
    const fiados = sales.filter(s => s.tipo === 'VENTA_FIADA' && s.status !== 'ANULADA');
    fiados.forEach(sale => {
        move(sale.customerId || 'det-cli-01', 'VENTA_FIADA', 'DEBIT', sale.fiadoUsd, {
            saleId: sale.id,
            timestamp: sale.timestamp,
            reason: 'Venta fiada (dataset determinista)',
        });
    });

    // Los clientes arrancan con la deuda del ledger, no con el acumulador suelto.
    customers.forEach(c => {
        const current = round2(balance.get(c.id) || 0);
        c.deuda = current < 0 ? round2(Math.abs(current)) : 0;
        c.favor = current > 0 ? current : 0;
    });

    let abonoSeq = 0;
    const methodFor = (roll) => {
        if (roll < 0.4) return { methodId: 'efectivo_usd', currency: 'USD', label: 'Efectivo $' };
        if (roll < 0.75) return { methodId: 'efectivo_bs', currency: 'BS', label: 'Efectivo Bs' };
        return { methodId: 'pago_movil', currency: 'BS', label: 'Pago Movil' };
    };
    const pushAbono = ({ customer, amountUsd, saldoFavorGeneradoUsd = 0, status = 'COMPLETADA', timestamp, note }) => {
        abonoSeq += 1;
        const method = methodFor(rrand());
        const totalBs = round2(amountUsd * currentRate);
        sales.push({
            id: `det_cobro_${String(abonoSeq).padStart(3, '0')}`,
            timestamp,
            tipo: 'COBRO_DEUDA',
            status,
            rate: currentRate,
            tasaCop: 0,
            totalUsd: round2(amountUsd),
            totalBs,
            saldoFavorGeneradoUsd,
            customerId: customer.id,
            customerName: customer.name,
            clienteId: customer.id,
            clienteName: customer.name,
            payments: [{
                methodId: method.methodId,
                methodLabel: method.label,
                amount: method.currency === 'USD' ? round2(amountUsd) : totalBs,
                currency: method.currency,
                amountUsd: round2(amountUsd),
                amountBs: totalBs,
            }],
            items: [{ id: null, name: `Abono de deuda: ${customer.name}`, qty: 1, priceUsd: round2(amountUsd), costBs: 0 }],
            sellerName: 'Simulador v3.0 Determinista',
            saleNumber: 99500 + abonoSeq,
            note,
        });
        if (status !== 'ANULADA') {
            move(customer.id, 'ABONO_DEUDA', 'CREDIT', amountUsd, {
                saleId: `det_cobro_${String(abonoSeq).padStart(3, '0')}`,
                timestamp,
                reason: 'Abono de deuda (dataset determinista)',
            });
        }
        return sales[sales.length - 1];
    };

    // 1) Abono parcial del 40% para cada deudor (los montos y métodos varían por PRNG).
    const deudores = customers.filter(c => round2(c.deuda) > 0.5);
    deudores.forEach(customer => {
        const parcial = round2(customer.deuda * 0.4);
        if (parcial <= 0) return;
        pushAbono({
            customer,
            amountUsd: parcial,
            timestamp: nextStamp(),
            note: 'Abono parcial del 40%',
        });
    });

    // 2) Abono con EXCEDENTE: el cliente det-cli-03 paga su deuda completa + $5
    //    ⇒ el sobrante se convierte en saldo a favor (H7: origen "excedente de abono").
    const clienteExcedente = customers.find(c => c.id === 'det-cli-03') || customers[0];
    const deudaActual = round2(balance.get(clienteExcedente.id) < 0 ? Math.abs(balance.get(clienteExcedente.id)) : 0);
    if (deudaActual > 0) {
        pushAbono({
            customer: clienteExcedente,
            amountUsd: round2(deudaActual + DETERMINISTIC_EXCEDENTE_USD),
            saldoFavorGeneradoUsd: DETERMINISTIC_EXCEDENTE_USD,
            timestamp: nextStamp(),
            note: `Abono con excedente de $${DETERMINISTIC_EXCEDENTE_USD.toFixed(2)} a favor`,
        });
    }

    // 3) Cashea: dos ventas financiadas y dos remesas (la última parcial para dejar
    //    saldo pendiente de Cashea y que la cartera no sea cero).
    let casheaSeq = 0;
    let casheaPendienteUsd = 0;
    const clienteCashea = customers.find(c => c.id === 'det-cli-02') || customers[0];
    for (let i = 0; i < 2; i++) {
        casheaSeq += 1;
        const ticketUsd = round2(20 + rrand() * 40);
        const casheaUsd = round2(ticketUsd * 0.3);
        const inicialUsd = round2(subR(ticketUsd, casheaUsd));
        casheaPendienteUsd = round2(casheaPendienteUsd + casheaUsd);
        sales.push({
            id: `det_cashea_${String(casheaSeq).padStart(3, '0')}`,
            timestamp: nextStamp(),
            tipo: 'VENTA_CASHEA',
            status: 'COMPLETADA',
            rate: currentRate,
            totalUsd: ticketUsd,
            totalBs: round2(ticketUsd * currentRate),
            fiadoUsd: 0,
            casheaUsd,
            customerId: clienteCashea.id,
            customerName: clienteCashea.name,
            payments: [
                { methodId: 'efectivo_usd', methodLabel: 'Efectivo $', amount: inicialUsd, currency: 'USD', amountUsd: inicialUsd, amountBs: round2(inicialUsd * currentRate) },
                { methodId: 'cashea', methodLabel: 'Cashea', amount: casheaUsd, currency: 'USD', amountUsd: casheaUsd, amountBs: round2(casheaUsd * currentRate), isCashea: true },
            ],
            items: [{ id: 'det-08', name: 'Queso Llanero 1kg', qty: 1, priceUsd: ticketUsd, costUsd: 3.20 }],
            sellerName: 'Simulador v3.0 Determinista',
            saleNumber: 99600 + casheaSeq,
        });
    }
    let remesaSeq = 0;
    const pushRemesa = (amountUsd, timestamp, note) => {
        remesaSeq += 1;
        sales.push({
            id: `det_remesa_${String(remesaSeq).padStart(3, '0')}`,
            timestamp,
            tipo: 'COBRO_CASHEA',
            status: 'COMPLETADA',
            rate: currentRate,
            totalUsd: round2(amountUsd),
            totalBs: round2(amountUsd * currentRate),
            payments: [{ methodId: 'pago_movil', methodLabel: 'Pago Movil', amount: round2(amountUsd * currentRate), currency: 'BS', amountUsd: round2(amountUsd), amountBs: round2(amountUsd * currentRate) }],
            items: [{ id: null, name: 'Remesa Cashea', qty: 1, priceUsd: round2(amountUsd), costBs: 0 }],
            sellerName: 'Simulador v3.0 Determinista',
            saleNumber: 99700 + remesaSeq,
            note,
        });
    };
    // Remesa del 80% de lo financiado ⇒ queda un 20% por cobrar a Cashea.
    const remesaParcial = round2(casheaPendienteUsd * 0.8);
    if (remesaParcial > 0) pushRemesa(remesaParcial, nextStamp(), 'Remesa parcial de Cashea (80%)');
    const remesaFinal = round2(subR(casheaPendienteUsd, remesaParcial));
    if (remesaFinal > 0) pushRemesa(remesaFinal, nextStamp(), 'Remesa final de Cashea');

    // 4) Anulaciones: una venta fiada y un abono anulados. Deben desaparecer de
    //    TODOS los agregados (y del efectivo) sin dejar rastro en la caja.
    const clienteAnulado = customers.find(c => c.id === 'det-cli-01') || customers[0];
    const tsAnuladaVenta = nextStamp();
    sales.push({
        id: 'det_anulada_fiado_001',
        timestamp: tsAnuladaVenta,
        tipo: 'VENTA_FIADA',
        status: 'ANULADA',
        rate: currentRate,
        totalUsd: 12.5,
        totalBs: round2(12.5 * currentRate),
        fiadoUsd: 12.5,
        payments: [],
        customerId: clienteAnulado.id,
        customerName: clienteAnulado.name,
        items: [{ id: 'det-03', name: 'Aceite Mazeite 1L', qty: 5, priceUsd: 2.5, costUsd: 2.10 }],
        sellerName: 'Simulador v3.0 Determinista',
        saleNumber: 99800,
        note: 'Venta fiada anulada (no debe contar)',
    });
    // Reverso en el ledger: se registra y se marca VOIDED (como hace la anulación real).
    move(clienteAnulado.id, 'ANULACION', 'CREDIT', 12.5, {
        saleId: 'det_anulada_fiado_001',
        status: 'VOIDED',
        timestamp: tsAnuladaVenta,
        reason: 'Reverso de venta fiada anulada',
    });
    const tsAnuladaAbono = nextStamp();
    sales.push({
        id: 'det_anulada_abono_001',
        timestamp: tsAnuladaAbono,
        tipo: 'COBRO_DEUDA',
        status: 'ANULADA',
        rate: currentRate,
        totalUsd: 7.25,
        totalBs: round2(7.25 * currentRate),
        saldoFavorGeneradoUsd: 0,
        customerId: clienteAnulado.id,
        customerName: clienteAnulado.name,
        payments: [{ methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs', amount: round2(7.25 * currentRate), currency: 'BS', amountUsd: 7.25, amountBs: round2(7.25 * currentRate) }],
        items: [{ id: null, name: `Abono de deuda: ${clienteAnulado.name}`, qty: 1, priceUsd: 7.25, costBs: 0 }],
        sellerName: 'Simulador v3.0 Determinista',
        saleNumber: 99801,
        note: 'Abono anulado (no debe contar como caja)',
    });

    // ── Snapshot final de cartera derivado del ledger (una sola verdad) ──
    customers.forEach(c => {
        const current = round2(balance.get(c.id) || 0);
        c.deuda = current < 0 ? round2(Math.abs(current)) : 0;
        c.favor = current > 0 ? current : 0;
    });
    // Lo que Cashea le debe a la bodega tras la remesa parcial.
    clienteCashea.casheaDeuda = round2(subR(casheaPendienteUsd, remesaParcial));

    return { dateStr, rate: currentRate, sales, products, customers, ledger };
}
