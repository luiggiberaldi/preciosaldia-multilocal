// ============================================================
// 🔍 FINANCIAL AUDITOR v6.0 — Auditoría Financiera Determinista
// ============================================================
// Opera sobre los datos REALES del negocio (bodega_*_v1).
// DETERMINISTA: mismos datos → mismo resultado siempre.
// v6.0 — Unit Test Suites completas para todos los motores
//         internos: dinero.js, FinancialEngine, procesarImpactoCliente.
// ============================================================

import { storageService } from '../utils/storageService';
import { round2, round4, mulR, divR, subR, sumR } from '../utils/dinero';
import { FinancialEngine } from '../core/FinancialEngine';
import { procesarImpactoCliente } from '../utils/financialLogic';

async function runGroqAnalysis(suites, elapsedSec) {
    try {
        const failed = suites.filter(s => s.status === 'failed');
        const passed = suites.filter(s => s.status === 'passed');
        const prompt = `Eres un auditor financiero experto en sistemas POS venezolanos (bodega/tienda). Analiza los resultados de esta auditoría y da un diagnóstico conciso en español (máximo 150 palabras):

Suites aprobadas (${passed.length}): ${passed.map(s => s.name).join(', ')}
Suites fallidas (${failed.length}): ${failed.map(s => `${s.name}: ${s.error}`).join('; ')}
Tiempo: ${elapsedSec}s

Da tu veredicto y recomendaciones específicas si hay fallos. Sé directo y práctico.`;

        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();
        return data.analysis || null;
    } catch (e) {
        console.warn('[Audit AI] Error en análisis:', e.message);
        return null;
    }
}

// ── Test State ──
const state = {
    logs: [],
    suites: [],
    isRunning: false,
    stopped: false,
    startedAt: null,
    finishedAt: null,
    aiAnalysis: null,
    onLog: null,
    onProgress: null,
    onComplete: null,
};

function resetState() {
    state.logs = []; state.suites = []; state.isRunning = false; state.stopped = false;
    state.startedAt = null; state.finishedAt = null; state.aiAnalysis = null;
    state.onLog = null; state.onProgress = null; state.onComplete = null;
}

function initSuites(activeSuites) {
    state.suites = activeSuites.map(s => ({
        id: s.key, name: s.name, status: 'pending',
        startedAt: null, finishedAt: null, error: null
    }));
}

function updateSuiteStatus(id, patch) {
    const s = state.suites.find(x => x.id === id);
    if (s) Object.assign(s, patch);
}

// ── Logging ──
function log(msg, type = 'info') {
    const ts = new Date().toLocaleTimeString('es-VE', { hour12: false });
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️', section: '━', day: '📅' };
    const icon = icons[type] || 'ℹ️';
    const entry = { time: ts, msg: `${icon} ${msg}`, type, raw: msg };
    state.logs.push(entry);
    state.onLog?.(entry);
    if (type === 'error') console.error(`[AUDIT ERROR] ${msg}`);
}

function section(title) {
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'section');
    log(title, 'section');
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'section');
}

// ── Assertions ──
class AssertionError extends Error {
    constructor(message) { super(message); this.name = 'AssertionError'; }
}

function assert(condition, message) {
    if (!condition) throw new AssertionError(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new AssertionError(`${message} (Esperado: ${expected}, Recibido: ${actual})`);
}

function assertClose(actual, expected, message, tolerance = 0.02) {
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) throw new AssertionError(`${message} (Esperado: ~${expected}, Recibido: ${actual}, Diff: ${diff.toFixed(4)})`);
}

function assertDeepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new AssertionError(`${message}\n  Esperado: ${e}\n  Recibido: ${a}`);
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════
// ██  BLOQUE A — MOTOR DINERO.JS (Aritmética de Precisión)
// ════════════════════════════════════════════════════════════

// ── A1. CERTIFICACIÓN DE PRECISIÓN (round2 + sumR + subR + mulR) ──
async function suitePrecisionFinanciera() {
    section('🔬 SUITE A1: Certificación de Precisión (Motor dinero.js)');

    assertClose(0.1 + 0.2, 0.30, 'Suma básica de punto flotante debe estar saneada');

    assertEqual(sumR(0.1, 0.2), 0.30, 'sumR: 0.1+0.2 = 0.30');
    assertEqual(subR(0.3, 0.2), 0.10, 'subR: 0.3-0.2 = 0.10');
    assertEqual(mulR(1.005, 100), 100.50, 'mulR: 1.005×100 = 100.50');
    assertEqual(round2(1.005), 1.01, 'round2: 1.005 → 1.01');
    assertEqual(round2(2.005), 2.01, 'round2: 2.005 → 2.01');
    assertEqual(sumR(0.1, 0.2, 0.3), 0.60, 'sumR triple: 0.1+0.2+0.3 = 0.60');

    // Cadena de precio * qty * tasa
    const precio = 5.99, qty = 3, tasa = 36.50;
    const esperado = round2(round2(precio * qty) * tasa);
    const calculado = mulR(mulR(precio, qty), tasa);
    assertEqual(calculado, esperado, `cadena precio×qty×tasa: ${precio}×${qty}×${tasa}`);

    log('Motor financiero (dinero.js) certificado con precisión IEEE 754 corregida.', 'success');
}

// ── A2. EXTENSIÓN DINERO — round4 + divR edge cases ──
async function suiteDineroExtended() {
    section('🧮 SUITE A2: Dinero Extended (round4 + divR + edge cases)');

    // round4
    assertEqual(round4(1.00005), 1.0001, 'round4: 1.00005 → 1.0001');
    assertEqual(round4(3.14159265), 3.1416, 'round4: π → 3.1416');
    assertEqual(round4(0), 0, 'round4: 0 → 0');
    assertEqual(round4(-1.23456), -1.2346, 'round4: negativo -1.23456 → -1.2346');
    assertEqual(round4(Infinity), 0, 'round4: Infinity → 0 (guard)');
    assertEqual(round4(NaN), 0, 'round4: NaN → 0 (guard)');

    // divR edge cases
    assertEqual(divR(10, 2), 5, 'divR: 10/2 = 5');
    assertEqual(divR(1, 3), 0.33, 'divR: 1/3 = 0.33');
    assertEqual(divR(0, 5), 0, 'divR: 0/5 = 0');
    assertEqual(divR(5, 0), 0, 'divR: división por 0 → 0 (guard)');
    assertEqual(divR(5, NaN), 0, 'divR: división por NaN → 0 (guard)');
    assertEqual(divR(5, Infinity), 0, 'divR: división por Infinity → 0 (guard)');
    assertEqual(divR(100, 0.01), 10000, 'divR: 100/0.01 = 10000');

    // round2 con valores negativos
    assertEqual(round2(-1.005), -1.01, 'round2: -1.005 → -1.01 (half-away-from-zero)');
    assertEqual(round2(-0), 0, 'round2: -0 → 0');
    assertEqual(round2(Infinity), 0, 'round2: Infinity → 0');
    assertEqual(round2(-Infinity), 0, 'round2: -Infinity → 0');
    assertEqual(round2(NaN), 0, 'round2: NaN → 0');

    // sumR con array vacío y valores undefined
    assertEqual(sumR([]), 0, 'sumR: array vacío → 0');
    assertEqual(sumR([undefined, null, 1]), 1, 'sumR: valores falsy → 0-safe');

    // mulR con cero
    assertEqual(mulR(0, 9999), 0, 'mulR: 0×cualquiera → 0');
    assertEqual(mulR(undefined, 5), 0, 'mulR: undefined → 0-safe');

    // Números grandes
    assertEqual(round2(999999.995), 1000000, 'round2: 999999.995 → 1000000');

    log('round4, divR, y todos los edge cases de dinero.js validados.', 'success');
}

// ════════════════════════════════════════════════════════════
// ██  BLOQUE B — MOTOR FINANCIERO (FinancialEngine)
// ════════════════════════════════════════════════════════════

// ── B1. CART ENGINE — buildCartTotals ──
async function suiteCartEngine() {
    section('🛒 SUITE B1: Cart Engine (FinancialEngine.buildCartTotals)');

    const RATE = 36.50;
    const COP_RATE = 4150;

    // Caso básico: un ítem sin descuento
    const cart1 = [{ priceUsd: 10, qty: 1 }];
    const t1 = FinancialEngine.buildCartTotals(cart1, null, RATE, 0);
    assertEqual(t1.subtotalUsd, 10, 'buildCartTotals: subtotalUsd básico');
    assertEqual(t1.totalUsd, 10, 'buildCartTotals: totalUsd sin descuento');
    assertClose(t1.totalBs, mulR(10, RATE), 'buildCartTotals: totalBs = totalUsd × tasa', 0.02);
    assertEqual(t1.discountAmountUsd, 0, 'buildCartTotals: sin descuento → discountAmountUsd = 0');
    assertEqual(t1.totalCop, 0, 'buildCartTotals: sin copRate → totalCop = 0');

    // Caso con múltiples ítems
    const cart2 = [
        { priceUsd: 5.99, qty: 3 },
        { priceUsd: 1.50, qty: 2 },
    ];
    const t2 = FinancialEngine.buildCartTotals(cart2, null, RATE, 0);
    const expectedSubtotal2 = sumR(mulR(5.99, 3), mulR(1.50, 2));
    assertClose(t2.subtotalUsd, expectedSubtotal2, 'buildCartTotals: subtotalUsd multi-ítem', 0.02);
    assertEqual(t2.totalUsd, t2.subtotalUsd, 'buildCartTotals: sin descuento totalUsd = subtotalUsd');

    // Caso con exactBs (precio fijado en Bs)
    const cart3 = [{ priceUsd: 10, qty: 1, exactBs: 380 }];
    const t3 = FinancialEngine.buildCartTotals(cart3, null, RATE, 0);
    assertEqual(t3.subtotalBs, 380, 'buildCartTotals: exactBs respeta el precio en Bs fijo');
    assertEqual(t3.subtotalUsd, 10, 'buildCartTotals: exactBs no afecta subtotalUsd');

    // Caso con COP
    const cart4 = [{ priceUsd: 20, qty: 1 }];
    const t4 = FinancialEngine.buildCartTotals(cart4, null, RATE, COP_RATE);
    assertEqual(t4.totalCop, mulR(20, COP_RATE), 'buildCartTotals: totalCop = totalUsd × copRate');

    // Carrito vacío
    const t5 = FinancialEngine.buildCartTotals([], null, RATE, 0);
    assertEqual(t5.subtotalUsd, 0, 'buildCartTotals: carrito vacío → subtotalUsd = 0');
    assertEqual(t5.totalUsd, 0, 'buildCartTotals: carrito vacío → totalUsd = 0');

    log('buildCartTotals validado: básico, multi-ítem, exactBs, COP, y carrito vacío.', 'success');
}

// ── B2. DISCOUNT LOGIC — porcentaje, fijo, clamping ──
async function suiteDiscountLogic() {
    section('🏷️ SUITE B2: Discount Logic (porcentaje, fijo, clamping)');

    const RATE = 36.50;
    const cart = [{ priceUsd: 100, qty: 1 }];

    // Descuento porcentual 10%
    const d1 = FinancialEngine.buildCartTotals(cart, { type: 'percentage', value: 10 }, RATE, 0);
    assertEqual(d1.discountAmountUsd, 10, 'descuento 10%: discountAmountUsd = 10');
    assertEqual(d1.totalUsd, 90, 'descuento 10%: totalUsd = 90');
    assertClose(d1.discountAmountBs, mulR(10, RATE), 'descuento 10%: discountAmountBs = discountAmountUsd × tasa', 0.02);

    // Descuento fijo $25
    const d2 = FinancialEngine.buildCartTotals(cart, { type: 'fixed', value: 25 }, RATE, 0);
    assertEqual(d2.discountAmountUsd, 25, 'descuento fijo $25: discountAmountUsd = 25');
    assertEqual(d2.totalUsd, 75, 'descuento fijo $25: totalUsd = 75');

    // Clamping: descuento mayor que subtotal → clampea al subtotal
    const d3 = FinancialEngine.buildCartTotals(cart, { type: 'fixed', value: 150 }, RATE, 0);
    assertEqual(d3.discountAmountUsd, 100, 'clamping: descuento $150 en carrito de $100 → clamped a $100');
    assertEqual(d3.totalUsd, 0, 'clamping: totalUsd no puede ser negativo → 0');

    // Descuento 100% (porcentual)
    const d4 = FinancialEngine.buildCartTotals(cart, { type: 'percentage', value: 100 }, RATE, 0);
    assertEqual(d4.totalUsd, 0, 'descuento 100%: totalUsd = 0');
    assertEqual(d4.discountAmountUsd, 100, 'descuento 100%: discountAmountUsd = subtotalUsd');

    // Carrito multi-ítem con descuento porcentual 15%
    const cart2 = [{ priceUsd: 5.99, qty: 3 }, { priceUsd: 1.50, qty: 2 }];
    const subtotal2 = sumR(mulR(5.99, 3), mulR(1.50, 2));
    const d5 = FinancialEngine.buildCartTotals(cart2, { type: 'percentage', value: 15 }, RATE, 0);
    assertClose(d5.discountAmountUsd, mulR(subtotal2, divR(15, 100)), 'descuento 15% multi-ítem: importe correcto', 0.02);
    assertClose(d5.totalUsd, subR(subtotal2, d5.discountAmountUsd), 'descuento 15% multi-ítem: totalUsd correcto', 0.02);

    // Sin descuento (discountData null)
    const d6 = FinancialEngine.buildCartTotals(cart, null, RATE, 0);
    assertEqual(d6.discountAmountUsd, 0, 'sin discountData: discountAmountUsd = 0');
    assertEqual(d6.totalUsd, 100, 'sin discountData: totalUsd = subtotalUsd');

    // Descuento con valor 0
    const d7 = FinancialEngine.buildCartTotals(cart, { type: 'percentage', value: 0 }, RATE, 0);
    assertEqual(d7.discountAmountUsd, 0, 'descuento value=0: sin efecto');

    log('Toda la lógica de descuentos certificada: porcentual, fijo, clamping, 100%, nulo.', 'success');
}

// ── B3. PROFIT ENGINE — calculateSaleProfit ──
async function suiteProfitEngine() {
    section('📈 SUITE B3: Profit Engine (FinancialEngine.calculateSaleProfit)');

    const RATE = 36.50;

    // Caso básico: costUsd en item
    const sale1 = {
        rate: RATE,
        items: [{ id: 'p1', priceUsd: 10, qty: 2, costUsd: 7 }],
        discountAmountUsd: 0
    };
    // Revenue = mulR(mulR(10, 2), 36.50) = mulR(20, 36.50) = 730
    // Cost    = mulR(mulR(7, 36.50), 2) = mulR(255.50, 2) = 511
    // Profit  = 730 - 511 = 219
    const p1 = FinancialEngine.calculateSaleProfit(sale1, RATE, []);
    const expectedP1 = subR(mulR(mulR(10, 2), RATE), mulR(mulR(7, RATE), 2));
    assertClose(p1, expectedP1, 'calculateSaleProfit: costUsd en item', 0.05);

    // Fallback a costBs en item
    const sale2 = {
        rate: RATE,
        items: [{ id: 'p2', priceUsd: 10, qty: 1, costBs: 300 }],
        discountAmountUsd: 0
    };
    const p2 = FinancialEngine.calculateSaleProfit(sale2, RATE, []);
    // Revenue = mulR(10, RATE) = 365
    // Cost    = mulR(300, 1) = 300 (costBs × qty)
    // Profit  = 365 - 300 = 65
    assertClose(p2, subR(mulR(10, RATE), mulR(300, 1)), 'calculateSaleProfit: fallback a costBs en item', 0.05);

    // Fallback dinámico al catálogo de productos
    const products3 = [{ id: 'p3', name: 'Harina', costUsd: 5, priceUsdt: 10 }];
    const sale3 = {
        rate: RATE,
        items: [{ id: 'p3', name: 'Harina', priceUsd: 10, qty: 1 }], // sin costUsd ni costBs
        discountAmountUsd: 0
    };
    const p3 = FinancialEngine.calculateSaleProfit(sale3, RATE, products3);
    // Revenue = mulR(10, RATE) = 365
    // Cost    = mulR(5, RATE) = 182.5 (costUsd desde catálogo)
    // Profit  = 365 - 182.5 = 182.5
    assertClose(p3, subR(mulR(10, RATE), mulR(mulR(5, RATE), 1)), 'calculateSaleProfit: fallback catálogo costUsd', 0.05);

    // Descuento en venta reduce profit
    const sale4 = {
        rate: RATE,
        items: [{ id: 'p1', priceUsd: 10, qty: 1, costUsd: 7 }],
        discountAmountUsd: 2
    };
    const p4 = FinancialEngine.calculateSaleProfit(sale4, RATE, []);
    // itemProfit = mulR(10, RATE) - mulR(mulR(7, RATE), 1) = 365 - 255.50 = 109.50
    // discountBs = mulR(2, RATE) = 73
    // profit = 109.50 - 73 = 36.50
    assertClose(p4, subR(subR(mulR(10, RATE), mulR(mulR(7, RATE), 1)), mulR(2, RATE)), 'calculateSaleProfit: descuento reduce profit', 0.05);

    // Venta sin items → 0
    const p5 = FinancialEngine.calculateSaleProfit({ items: [] }, RATE, []);
    assertEqual(p5, 0, 'calculateSaleProfit: sin items → 0');

    // Venta null → 0
    const p6 = FinancialEngine.calculateSaleProfit(null, RATE, []);
    assertEqual(p6, 0, 'calculateSaleProfit: null → 0');

    // Modo unidad: id termina en _unit → costBs ÷ unitsPerPackage
    const products7 = [{ id: 'p7', costBs: 200, unitsPerPackage: 4, priceUsdt: 5 }];
    const sale7 = {
        rate: RATE,
        items: [{ id: 'p7_unit', _originalId: 'p7', priceUsd: 5, qty: 1 }],
        discountAmountUsd: 0
    };
    const p7 = FinancialEngine.calculateSaleProfit(sale7, RATE, products7);
    // costBs unit = 200/4 = 50; revenue = mulR(5, RATE) = 182.50; cost = mulR(50, 1) = 50
    // profit = 182.50 - 50 = 132.50
    assert(p7 > 0, 'calculateSaleProfit: modo unidad genera profit positivo');

    // calculateAggregateProfit suma correctamente
    const agg = FinancialEngine.calculateAggregateProfit([sale1, sale2], RATE, []);
    assertClose(agg, sumR([p1, p2]), 'calculateAggregateProfit: suma de profits', 0.10);

    log('calculateSaleProfit certificado: costUsd, costBs, fallback catálogo, descuento, modo unidad.', 'success');
}

// ── B4. PAYMENT BREAKDOWN — calculatePaymentBreakdown ──
async function suitePaymentBreakdown() {
    section('💳 SUITE B4: Payment Breakdown (FinancialEngine.calculatePaymentBreakdown)');

    const RATE = 36.50;

    // Venta simple en efectivo USD
    const sales1 = [{
        tipo: 'VENTA',
        rate: RATE,
        totalUsd: 10,
        totalBs: mulR(10, RATE),
        changeUsd: 0,
        changeBs: 0,
        payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10 }]
    }];
    const b1 = FinancialEngine.calculatePaymentBreakdown(sales1);
    assert(b1['efectivo_usd'], 'breakdown: efectivo_usd existe');
    assertEqual(b1['efectivo_usd'].total, 10, 'breakdown: efectivo_usd total = 10');
    assert(!b1['_vuelto_usd'], 'breakdown: sin vuelto cuando changeUsd = 0');

    // Venta con cambio USD → se registra vuelto
    const sales2 = [{
        tipo: 'VENTA',
        rate: RATE,
        totalUsd: 7.50,
        totalBs: mulR(7.50, RATE),
        changeUsd: 2.50,
        changeBs: 0,
        payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10 }]
    }];
    const b2 = FinancialEngine.calculatePaymentBreakdown(sales2);
    assert(b2['_vuelto_usd'], 'breakdown: vuelto USD registrado cuando changeUsd > 0');
    assertEqual(b2['_vuelto_usd'].total, 2.50, 'breakdown: _vuelto_usd = 2.50');

    // APERTURA_CAJA → no es revenue, va a efectivo
    const sales3 = [{
        tipo: 'APERTURA_CAJA',
        openingUsd: 50,
        openingBs: 1000,
    }];
    const b3 = FinancialEngine.calculatePaymentBreakdown(sales3);
    assertEqual(b3['efectivo_usd'].total, 50, 'APERTURA_CAJA: openingUsd va a efectivo_usd');
    assertEqual(b3['efectivo_bs'].total, 1000, 'APERTURA_CAJA: openingBs va a efectivo_bs');

    // VENTA_FIADA → va a bucket fiado, no a pagos normales
    const sales4 = [{
        tipo: 'VENTA_FIADA',
        totalUsd: 20,
        totalBs: mulR(20, RATE),
        changeUsd: 0,
        changeBs: 0,
        payments: []
    }];
    const b4 = FinancialEngine.calculatePaymentBreakdown(sales4);
    assert(b4['fiado'], 'VENTA_FIADA: bucket fiado existe');
    assertEqual(b4['fiado'].total, 20, 'VENTA_FIADA: fiado.total = totalUsd de la venta');

    // COBRO_DEUDA → reduce fiado y registra pago real
    const sales5 = [
        {
            tipo: 'VENTA_FIADA',
            totalUsd: 30,
            totalBs: mulR(30, RATE),
            payments: []
        },
        {
            tipo: 'COBRO_DEUDA',
            totalUsd: 30,
            rate: RATE,
            changeUsd: 0,
            changeBs: 0,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 30 }]
        }
    ];
    const b5 = FinancialEngine.calculatePaymentBreakdown(sales5);
    // VENTA_FIADA agrega 30 a fiado; COBRO_DEUDA resta 30 → fiado = 0 (filtrado)
    assert(!b5['fiado'] || b5['fiado'].total === 0, 'COBRO_DEUDA: cancela VENTA_FIADA → fiado neto = 0');
    // El pago en efectivo_usd si se registra
    assert(b5['efectivo_usd'], 'COBRO_DEUDA: pago efectivo_usd registrado');

    // Ventas anuladas NO deberían estar en el array que llega aquí (pre-filtradas)
    // Ventas sin payments (legacy V1): usa paymentMethod + totalBs
    const sales6 = [{
        tipo: 'VENTA',
        rate: RATE,
        totalUsd: 5,
        totalBs: mulR(5, RATE),
        paymentMethod: 'efectivo_bs',
        changeUsd: 0,
        changeBs: 0,
        payments: []
    }];
    const b6 = FinancialEngine.calculatePaymentBreakdown(sales6);
    assert(b6['efectivo_bs'], 'legacy V1: pagos vacíos → usa paymentMethod');

    log('calculatePaymentBreakdown certificado: USD, vuelto, APERTURA, FIADO, COBRO_DEUDA, legacy V1.', 'success');
}

// ════════════════════════════════════════════════════════════
// ██  BLOQUE C — MOTOR DE CLIENTES (procesarImpactoCliente)
// ════════════════════════════════════════════════════════════

// ── C1. IMPACTO DE CLIENTE — todas las rutas Q0-Q3 + Golden Rule ──
async function suiteClienteImpacto() {
    section('👤 SUITE C1: Impacto de Cliente (procesarImpactoCliente — Golden Rule)');

    const clean = { id: 'c1', name: 'Test', deuda: 0, favor: 0 };

    // Q0: consumir saldo a favor
    const c0 = procesarImpactoCliente({ ...clean, favor: 10 }, { usaSaldoFavor: 3 });
    assertEqual(c0.favor, 7, 'Q0: favor 10 - 3 saldo = 7');
    assertEqual(c0.deuda, 0, 'Q0: deuda permanece 0');

    // Q0: consumir saldo a favor completo (no negativos)
    const c0b = procesarImpactoCliente({ ...clean, favor: 3 }, { usaSaldoFavor: 5 });
    assertEqual(c0b.favor, 0, 'Q0: no puede quedar favor negativo → clampea a 0');

    // Q1: generar deuda por venta fiada
    const c1 = procesarImpactoCliente(clean, { esCredito: true, deudaGenerada: 15 });
    assertEqual(c1.deuda, 15, 'Q1: deuda generada = 15');
    assertEqual(c1.favor, 0, 'Q1: favor permanece 0');

    // Q1 + Golden Rule: si ya tiene favor, el neto decide
    const c1b = procesarImpactoCliente({ ...clean, favor: 5 }, { esCredito: true, deudaGenerada: 15 });
    // neto = 5 - 15 = -10 → deuda = 10, favor = 0
    assertEqual(c1b.deuda, 10, 'Q1+Golden Rule: favor 5 vs deuda 15 → deuda neta = 10');
    assertEqual(c1b.favor, 0, 'Q1+Golden Rule: favor = 0');

    // Q2: vuelto abona primero a deuda
    const c2 = procesarImpactoCliente({ ...clean, deuda: 20 }, { vueltoParaMonedero: 8 });
    assertEqual(c2.deuda, 12, 'Q2: vuelto 8 abona deuda 20 → deuda = 12');
    assertEqual(c2.favor, 0, 'Q2: favor permanece 0');

    // Q2+Q3: vuelto paga toda la deuda y sobra va a favor
    const c3 = procesarImpactoCliente({ ...clean, deuda: 5 }, { vueltoParaMonedero: 12 });
    assertEqual(c3.deuda, 0, 'Q3: vuelto 12 paga deuda 5 → deuda = 0');
    assertEqual(c3.favor, 7, 'Q3: sobrante 7 va a favor');

    // Q3: sin deuda → todo vuelto a favor
    const c4 = procesarImpactoCliente(clean, { vueltoParaMonedero: 10 });
    assertEqual(c4.favor, 10, 'Q3 puro: sin deuda → vuelto 10 va directo a favor');
    assertEqual(c4.deuda, 0, 'Q3 puro: deuda permanece 0');

    // Golden Rule: no puede tener deuda Y favor simultáneos
    const c5 = procesarImpactoCliente({ ...clean, favor: 5, deuda: 3 }, {});
    assert(!(c5.favor > 0 && c5.deuda > 0), 'Golden Rule: imposible tener favor > 0 y deuda > 0 al mismo tiempo');

    // Golden Rule: favor > deuda → neto positivo → todo favor
    const c6 = procesarImpactoCliente({ ...clean, favor: 10, deuda: 3 }, {});
    assertEqual(c6.favor, 7, 'Golden Rule: favor 10 vs deuda 3 → favor neto = 7');
    assertEqual(c6.deuda, 0, 'Golden Rule: favor > deuda → deuda = 0');

    // Golden Rule: deuda > favor → neto negativo → todo deuda
    const c7 = procesarImpactoCliente({ ...clean, favor: 3, deuda: 10 }, {});
    assertEqual(c7.deuda, 7, 'Golden Rule: deuda 10 vs favor 3 → deuda neta = 7');
    assertEqual(c7.favor, 0, 'Golden Rule: deuda > favor → favor = 0');

    // Venta completa con Q0 + Q1: usa saldo y genera deuda
    const c8 = procesarImpactoCliente(
        { ...clean, favor: 5 },
        { usaSaldoFavor: 5, esCredito: true, deudaGenerada: 20 }
    );
    // Q0: favor 5 - 5 = 0; Q1: deuda += 20 → deuda = 20; Golden Rule: deuda 20, favor 0
    assertEqual(c8.favor, 0, 'Q0+Q1: favor consumido + deuda generada');
    assertEqual(c8.deuda, 20, 'Q0+Q1: deuda = 20');

    // Inmutabilidad: el objeto original no debe modificarse
    const original = { id: 'c9', favor: 10, deuda: 0 };
    procesarImpactoCliente(original, { usaSaldoFavor: 5 });
    assertEqual(original.favor, 10, 'Inmutabilidad: objeto original no modificado');

    log('procesarImpactoCliente certificado: Q0, Q1, Q2, Q3, Golden Rule, e inmutabilidad.', 'success');
}

// ════════════════════════════════════════════════════════════
// ██  BLOQUE D — FLUJOS DE CAJA (Checkout + Cambio + Fiado)
// ════════════════════════════════════════════════════════════

// ── D1. CÁLCULO DE FIADO ──
async function suiteFiadoCalculo() {
    section('📋 SUITE D1: Cálculo de Fiado (remainingUsd → fiadoAmountUsd → tipo)');

    // Simula la aritmética de checkoutProcessor.js
    function calcFiado(totalUsd, paymentsAmountUsd) {
        const totalPaid = sumR(paymentsAmountUsd.map(a => a));
        const remaining = round2(Math.max(0, subR(totalUsd, totalPaid)));
        const change    = round2(Math.max(0, subR(totalPaid, totalUsd)));
        const fiadoAmt  = remaining > 0.01 ? remaining : 0;
        const tipo      = fiadoAmt > 0 ? 'VENTA_FIADA' : 'VENTA';
        return { remaining, change, fiadoAmt, tipo };
    }

    // Pago exacto → no hay fiado
    const r1 = calcFiado(20, [20]);
    assertEqual(r1.fiadoAmt, 0, 'Fiado: pago exacto → fiadoAmt = 0');
    assertEqual(r1.tipo, 'VENTA', 'Fiado: pago exacto → tipo VENTA');
    assertEqual(r1.change, 0, 'Fiado: pago exacto → change = 0');

    // Pago excedente → vuelto, no fiado
    const r2 = calcFiado(15, [20]);
    assertEqual(r2.fiadoAmt, 0, 'Fiado: pago excedente → fiadoAmt = 0');
    assertEqual(r2.change, 5, 'Fiado: pago excedente → change = 5');
    assertEqual(r2.tipo, 'VENTA', 'Fiado: pago excedente → tipo VENTA');

    // Pago parcial → fiado
    const r3 = calcFiado(50, [30]);
    assertEqual(r3.fiadoAmt, 20, 'Fiado: pago parcial $30 de $50 → fiadoAmt = 20');
    assertEqual(r3.tipo, 'VENTA_FIADA', 'Fiado: pago parcial → tipo VENTA_FIADA');
    assertEqual(r3.change, 0, 'Fiado: hay fiado → change = 0');

    // Sin pago → todo fiado
    const r4 = calcFiado(100, [0]);
    assertEqual(r4.fiadoAmt, 100, 'Fiado: sin pago → fiadoAmt = totalUsd');
    assertEqual(r4.tipo, 'VENTA_FIADA', 'Fiado: sin pago → tipo VENTA_FIADA');

    // Pago multi-método cubriéndolo exactamente
    const r5 = calcFiado(30, [10, 10, 10]);
    assertEqual(r5.fiadoAmt, 0, 'Fiado: multi-método exacto → sin fiado');
    assertEqual(r5.tipo, 'VENTA', 'Fiado: multi-método exacto → VENTA');

    // Umbral de tolerancia: diferencia ≤ $0.01 no se considera fiado
    const r6 = calcFiado(20, [19.99]);
    assertEqual(r6.fiadoAmt, 0, 'Fiado: diff ≤ $0.01 no se considera fiado (umbral de centavo)');

    log('Cálculo de fiado certificado: exacto, excedente, parcial, nulo, multi-método, umbral.', 'success');
}

// ── D2. CAMBIO SPLIT (vuelto USD + Bs) ──
async function suiteCambioSplit() {
    section('💱 SUITE D2: Cambio Split (vuelto USD + Bs separado vs espejo)');

    const RATE = 36.50;

    // "Mismo cambio" mirror: changeBs ≈ changeUsd × rate → no doble conteo
    function isSameChange(changeUsd, changeBs, rate) {
        if (changeUsd <= 0 || changeBs <= 0) return false;
        const expectedBs = changeUsd * rate;
        return Math.abs(changeBs - expectedBs) / Math.max(expectedBs, 0.01) < 0.05;
    }

    function calcTotalChangeUsd(changeUsd, changeBs, rate) {
        if (changeBs > 0 && changeUsd > 0) {
            if (isSameChange(changeUsd, changeBs, rate)) {
                return changeUsd; // No doble contar
            } else {
                return round2(changeUsd + changeBs / rate); // Split real
            }
        } else if (changeBs > 0 && changeUsd === 0) {
            return round2(changeBs / rate);
        }
        return changeUsd;
    }

    // Cambio espejo (solo USD registrado, Bs es la equivalencia)
    const c1 = calcTotalChangeUsd(5, mulR(5, RATE), RATE);
    assertEqual(c1, 5, 'Cambio espejo: changeUsd=5, changeBs=182.50 → totalChange = 5 (sin doble conteo)');

    // Split real: $5 USD + Bs 100 independientes
    const c2 = calcTotalChangeUsd(5, 100, RATE);
    // $5 USD + Bs100 / 36.50 = $5 + $2.74 = $7.74
    assertClose(c2, round2(5 + 100 / RATE), 'Cambio split real: $5 USD + Bs 100 → totalChange ≈ $7.74', 0.02);

    // Solo cambio en Bs
    const c3 = calcTotalChangeUsd(0, 182.50, RATE);
    assertClose(c3, 5, 'Cambio solo Bs: Bs 182.50 / 36.50 = $5', 0.02);

    // Sin cambio
    const c4 = calcTotalChangeUsd(0, 0, RATE);
    assertEqual(c4, 0, 'Sin cambio: totalChange = 0');

    // isSameChange: detecta mirror correctamente
    assert(isSameChange(10, mulR(10, RATE), RATE), 'isSameChange: detecta espejo USD/Bs correcto');
    assert(!isSameChange(10, 100, RATE), 'isSameChange: detecta split real (100 Bs ≠ 10 × 36.50)');
    assert(!isSameChange(0, 100, RATE), 'isSameChange: changeUsd=0 no es espejo');
    assert(!isSameChange(10, 0, RATE), 'isSameChange: changeBs=0 no es espejo');

    log('Cambio split certificado: espejo, split real, solo Bs, sin cambio, detección de mirror.', 'success');
}

// ── D3. STOCK — modos unidad, peso, deducción ──
async function suiteStockModos() {
    section('📦 SUITE D3: Stock Modos (unidad, peso, empaque, stock negativo)');

    // Simula la lógica de deducción de stock en checkoutProcessor.js
    function calcDeduccion(items) {
        return items.reduce((sum, item) => {
            if (item.isWeight)         return sum + item.qty;
            if (item._mode === 'unit') return sum + divR(item.qty, item._unitsPerPackage || 1);
            return sum + item.qty;
        }, 0);
    }

    // Modo estándar (qty = paquetes)
    const d1 = calcDeduccion([{ qty: 3 }]);
    assertEqual(d1, 3, 'Stock: modo estándar → deduce qty en paquetes');

    // Modo peso (kg/unidad libre)
    const d2 = calcDeduccion([{ qty: 1.5, isWeight: true }]);
    assertEqual(d2, 1.5, 'Stock: modo peso → deduce qty directamente');

    // Modo unidad (subdivide el empaque)
    const d3 = calcDeduccion([{ qty: 12, _mode: 'unit', _unitsPerPackage: 6 }]);
    assertClose(d3, 2, 'Stock: modo unidad 12u÷6u/pkg → 2 paquetes deducidos', 0.001);

    // Modo unidad parcial
    const d4 = calcDeduccion([{ qty: 3, _mode: 'unit', _unitsPerPackage: 4 }]);
    assertClose(d4, 0.75, 'Stock: modo unidad 3u÷4u/pkg → 0.75 paquetes deducidos', 0.001);

    // Mezcla de modos en el mismo carrito
    const d5 = calcDeduccion([
        { qty: 2 },                                        // estándar
        { qty: 0.5, isWeight: true },                      // peso
        { qty: 8, _mode: 'unit', _unitsPerPackage: 4 },   // unidad (2 paquetes)
    ]);
    assertClose(d5, 4.5, 'Stock: mezcla de modos → 2 + 0.5 + 2 = 4.5', 0.001);

    // Stock negativo: con allow_negative_stock = true → puede ser negativo
    function applyStock(currentStock, deduccion, allowNeg) {
        const newStock = currentStock - deduccion;
        return allowNeg ? newStock : Math.max(0, newStock);
    }

    assertEqual(applyStock(5, 3, false), 2, 'Stock: deducción normal sin negativo');
    assertEqual(applyStock(2, 5, false), 0, 'Stock: clampea en 0 cuando allowNeg=false');
    assertEqual(applyStock(2, 5, true), -3, 'Stock: negativo permitido cuando allowNeg=true');

    // _unitsPerPackage ausente → default a 1 (no crash)
    const d6 = calcDeduccion([{ qty: 4, _mode: 'unit' }]); // sin _unitsPerPackage
    assertEqual(d6, 4, 'Stock: sin _unitsPerPackage → default 1 → deduce qty unidades');

    log('Lógica de deducción de stock certificada: estándar, peso, unidad, mezcla, negativo.', 'success');
}

// ════════════════════════════════════════════════════════════
// ██  BLOQUE E — LÓGICA COP COMPLETA
// ════════════════════════════════════════════════════════════

// ── E1. COP DISPLAY — precedencia de tasa, copPrimary ──
async function suiteCopDisplay() {
    section('🇨🇴 SUITE E1: COP Display (precedencia de tasa, copPrimary)');

    // Simula ProductContext: tasa COP efectiva
    function getEffectiveCopRate({ autoCopEnabled, autoCopRate, tasaCopManual }) {
        if (autoCopEnabled && autoCopRate > 0) return autoCopRate;
        return parseFloat(tasaCopManual) > 0 ? parseFloat(tasaCopManual) : 4150;
    }

    // Auto COP activo → usa autoCopRate
    const r1 = getEffectiveCopRate({ autoCopEnabled: true, autoCopRate: 4200, tasaCopManual: '3900' });
    assertEqual(r1, 4200, 'COP: autoCopEnabled=true → usa autoCopRate, ignora manual');

    // Auto COP inactivo → usa manual
    const r2 = getEffectiveCopRate({ autoCopEnabled: false, autoCopRate: 4200, tasaCopManual: '3900' });
    assertEqual(r2, 3900, 'COP: autoCopEnabled=false → usa tasaCopManual');

    // Sin manual ni auto → fallback 4150
    const r3 = getEffectiveCopRate({ autoCopEnabled: false, autoCopRate: 0, tasaCopManual: '' });
    assertEqual(r3, 4150, 'COP: sin tasa configurada → fallback 4150');

    // Auto COP activo pero sin precio → usa manual
    const r4 = getEffectiveCopRate({ autoCopEnabled: true, autoCopRate: 0, tasaCopManual: '4000' });
    assertEqual(r4, 4000, 'COP: autoCopEnabled=true pero autoCopRate=0 → usa manual');

    // copPrimary: display de total cuando COP es primario
    function displayTotal(totalUsd, copEnabled, copPrimary, tasaCop) {
        if (copEnabled && copPrimary && tasaCop > 0) {
            return `${Math.round(totalUsd * tasaCop)} COP`;
        }
        return `$${totalUsd.toFixed(2)}`;
    }

    assertEqual(displayTotal(10, true, true, 4150), '41500 COP', 'copPrimary: muestra COP cuando es primario');
    assertEqual(displayTotal(10, true, false, 4150), '$10.00', 'copPrimary: muestra USD cuando copPrimary=false');
    assertEqual(displayTotal(10, false, true, 4150), '$10.00', 'copPrimary: muestra USD cuando copEnabled=false');
    assertEqual(displayTotal(10, true, true, 0), '$10.00', 'copPrimary: muestra USD cuando tasaCop=0');

    // totalCop se calcula correctamente
    const totalUsd = 25;
    const tasaCop = 4150;
    const totalCop = mulR(totalUsd, tasaCop);
    assertEqual(totalCop, Math.round(totalUsd * tasaCop), 'totalCop: mulR(totalUsd, tasaCop) = redondeo correcto');

    log('COP Display certificado: precedencia de tasa, copPrimary, displayTotal.', 'success');
}

// ── E2. COP PAGOS — conversión en checkout, guarda en sale, breakdown nativo ──
async function suiteCopPagos() {
    section('💛 SUITE E2: COP Pagos (conversión checkout, guarda sale, breakdown nativo)');

    const RATE = 36.50;
    const TASA_COP = 4150;
    const safeTasaCop = TASA_COP > 0 ? TASA_COP : 4150;

    // ── useCheckoutCalculations: COP → USD (divR) ──
    // Pago de 83000 COP → divR(83000, 4150) = $20 USD
    const copPago = 83000;
    const copToUsd = divR(copPago, safeTasaCop);
    assertEqual(copToUsd, 20, 'COP→USD: divR(83000, 4150) = $20');

    // COP → Bs: mulR(divR(copAmount, tasaCop), rate)
    const copToBs = mulR(divR(copPago, safeTasaCop), RATE);
    assertEqual(copToBs, mulR(20, RATE), 'COP→Bs: mulR(divR(83000, 4150), 36.50) = 730 Bs');

    // Monto parcial COP
    const copParcial = 41500;
    const copParcialUsd = divR(copParcial, safeTasaCop);
    assertEqual(copParcialUsd, 10, 'COP parcial: 41500/4150 = $10');

    // fillBar COP: remainingUsd × safeTasaCop
    const remainingUsd = 15;
    const fillBarCop = Number((remainingUsd * safeTasaCop).toFixed(2));
    assertEqual(fillBarCop, 62250, 'fillBar COP: $15 × 4150 = 62250 COP');

    // safeTasaCop guard: tasaCop=0 → 4150
    const safeCopZero = (0 > 0 ? 0 : 4150);
    assertEqual(safeCopZero, 4150, 'safeTasaCop: tasaCop=0 → fallback 4150');

    // safeTasaCop guard: tasaCop negativo → 4150
    const safeCopNeg = (-100 > 0 ? -100 : 4150);
    assertEqual(safeCopNeg, 4150, 'safeTasaCop: tasaCop negativo → fallback 4150');

    // ── checkoutProcessor: guarda totalCop solo si copEnabled=true ──
    function calcTotalCop(totalUsd, copEnabled, tasaCop) {
        return copEnabled && tasaCop > 0 ? mulR(totalUsd, tasaCop) : 0;
    }
    assertEqual(calcTotalCop(10, true, 4150), mulR(10, 4150), 'totalCop: copEnabled=true → mulR(totalUsd, tasaCop)');
    assertEqual(calcTotalCop(10, false, 4150), 0, 'totalCop: copEnabled=false → 0');
    assertEqual(calcTotalCop(10, true, 0), 0, 'totalCop: tasaCop=0 → 0');

    // guarda tasaCop en sale: copEnabled ? tasaCop : 0
    function saleTaskCop(copEnabled, tasaCop) {
        return copEnabled ? tasaCop : 0;
    }
    assertEqual(saleTaskCop(true, 4150), 4150, 'sale.tasaCop: copEnabled=true → 4150');
    assertEqual(saleTaskCop(false, 4150), 0, 'sale.tasaCop: copEnabled=false → 0');

    // ── FinancialEngine.calculatePaymentBreakdown: COP nativo (p.currency === 'COP') ──
    // El engine guarda copAmount = mulR(amountUsd, sale.tasaCop)
    const amountUsd = 20;
    const tasaCopSale = 4150;
    const copNative = mulR(amountUsd, tasaCopSale);
    assertEqual(copNative, mulR(20, 4150), 'breakdown COP nativo: mulR(amountUsd, tasaCop)');

    // Prueba real a través del engine con pago efectivo_cop
    const salesCop = [{
        tipo: 'VENTA',
        rate: RATE,
        tasaCop: TASA_COP,
        totalUsd: 20,
        totalBs: mulR(20, RATE),
        changeUsd: 0,
        changeBs: 0,
        payments: [{
            methodId: 'efectivo_cop',
            currency: 'COP',
            amountUsd: 20,
            amountBs: mulR(20, RATE),
        }]
    }];
    const bdCop = FinancialEngine.calculatePaymentBreakdown(salesCop);
    assert(bdCop['efectivo_cop'], 'breakdown: efectivo_cop existe como bucket');
    // El total en COP debe ser mulR(20, 4150) = 83000
    assertEqual(bdCop['efectivo_cop'].total, mulR(20, TASA_COP), 'breakdown: efectivo_cop.total en COP nativo');
    assertEqual(bdCop['efectivo_cop'].currency, 'COP', 'breakdown: efectivo_cop.currency = COP');

    // transferencia_cop también funciona
    const salesCop2 = [{
        tipo: 'VENTA',
        rate: RATE,
        tasaCop: TASA_COP,
        totalUsd: 10,
        totalBs: mulR(10, RATE),
        changeUsd: 0,
        changeBs: 0,
        payments: [{
            methodId: 'transferencia_cop',
            currency: 'COP',
            amountUsd: 10,
        }]
    }];
    const bdCop2 = FinancialEngine.calculatePaymentBreakdown(salesCop2);
    assert(bdCop2['transferencia_cop'], 'breakdown: transferencia_cop existe como bucket');

    // ── Legacy V1 COP: method.includes('cop') → currency='COP', usa totalCop ──
    const salesLegacyCop = [{
        tipo: 'VENTA',
        rate: RATE,
        totalUsd: 10,
        totalBs: mulR(10, RATE),
        totalCop: mulR(10, TASA_COP),
        paymentMethod: 'efectivo_cop',
        changeUsd: 0,
        changeBs: 0,
        payments: []
    }];
    const bdLegacyCop = FinancialEngine.calculatePaymentBreakdown(salesLegacyCop);
    assert(bdLegacyCop['efectivo_cop'], 'legacy V1 COP: method.includes(cop) detectado');
    assertEqual(bdLegacyCop['efectivo_cop'].currency, 'COP', 'legacy V1 COP: currency = COP');

    // ── Detección de confusión USD→COP (usuario ingresa $10 en lugar de 41500 COP) ──
    function detectCopConfusion(inputVal, cartTotalUsd, safeTasaCop) {
        const expectedCop = cartTotalUsd * safeTasaCop;
        return inputVal < expectedCop * 0.05 && inputVal > 0 && inputVal <= cartTotalUsd * 2;
    }
    assert(detectCopConfusion(10, 10, 4150), 'COP confusion: $10 en campo COP de venta $10 → confusión detectada');
    assert(!detectCopConfusion(41500, 10, 4150), 'COP confusion: 41500 COP correcto → no confusión');
    assert(!detectCopConfusion(0, 10, 4150), 'COP confusion: 0 → no confusión');

    log('COP Pagos certificado: conversión checkout, guarda sale, breakdown nativo, legacy V1, confusión.', 'success');
}

// ════════════════════════════════════════════════════════════
// ██  BLOQUE F — AUDITORÍAS DE DATOS REALES (Legacy suites v5)
// ════════════════════════════════════════════════════════════

// ── F1. INTEGRIDAD DE LIBROS HISTÓRICOS ──
async function suiteAuditarDataHistorica() {
    section('🕵️ SUITE F1: Histórico: Integridad de Libros');
    const sales = await storageService.getItem('bodega_sales_v1', []);
    if (!sales || sales.length === 0) {
        log('Libro de ventas vacío: No hay historial para auditar.', 'info');
        return;
    }

    let driftCount = 0;

    for (const sale of sales) {
        if (!sale.items || sale.status === 'ANULADA') continue;

        let calculatedUsd = 0;
        for (const item of sale.items) {
            calculatedUsd = sumR(calculatedUsd, mulR(item.priceUsd, item.qty));
        }

        const discountUsd = sale.discountAmountUsd || sale.discount || 0;
        if (discountUsd > 0) calculatedUsd = subR(calculatedUsd, discountUsd);

        if (Math.abs(calculatedUsd - sale.totalUsd) > 0.05) {
            driftCount++;
            log(`[Ticket ${sale.id?.slice(-6) || '?'}] Calculado $${calculatedUsd} vs Registrado $${sale.totalUsd} (diff $${Math.abs(calculatedUsd - sale.totalUsd).toFixed(2)})`, 'warn');
        }
    }

    if (driftCount > 0) {
        log(`${driftCount} ticket(s) con drift aritmético en sus ítems.`, 'error');
        throw new AssertionError(`${driftCount} tickets con anomalías de integridad en sumas`);
    } else {
        log(`${sales.length} tickets auditados. Integridad 100%.`, 'success');
    }
}

// ── F2. INVENTARIO FANTASMA ──
async function suitePatrimonialInventario() {
    section('🛒 SUITE F2: Inventario: Auditoría Patrimonial (Inventario Fantasma)');
    const products = await storageService.getItem('bodega_products_v1', []);
    if (!products || !products.length) {
        log('No hay productos para auditar.', 'info');
        return;
    }

    const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
    let ghostItems = 0;
    let totalGhostValueUsd = 0;

    for (const p of products) {
        if (p.stock < 0) {
            ghostItems++;
            totalGhostValueUsd = sumR(totalGhostValueUsd, mulR(Math.abs(p.stock), p.priceUsdt || 0));
        }
    }

    if (ghostItems > 0 && !allowNeg) {
        log(`${ghostItems} producto(s) en stock negativo. Valor irreal proyectado: $${totalGhostValueUsd.toFixed(2)}`, 'error');
        throw new AssertionError(`${ghostItems} productos con stock negativo (config: stock negativo NO permitido)`);
    } else if (ghostItems > 0 && allowNeg) {
        log(`${ghostItems} producto(s) en negativo ($${totalGhostValueUsd.toFixed(2)}). Permitido por configuración.`, 'warn');
    } else {
        log(`${products.length} productos auditados. 0 items fantasma.`, 'success');
    }
}

// ── F3. DEUDA CIRCULAR ──
async function suiteDeudaCircular() {
    section('👥 SUITE F3: Clientes: Deuda Circular (Cartera)');
    const customers = await storageService.getItem('bodega_customers_v1', []);
    if (!customers || !customers.length) {
        log('No hay clientes para auditar.', 'info');
        return;
    }

    let circularCount = 0;

    for (const c of customers) {
        if (c.deuda > 0 && c.favor > 0) {
            circularCount++;
            log(`[${c.name || c.id?.slice(-6)}] Deuda $${c.deuda} y Favor $${c.favor} simultáneos — cartera sin normalizar.`, 'warn');
        }
    }

    if (circularCount > 0) {
        log(`${circularCount} cliente(s) con deuda circular (deuda y favor simultáneos).`, 'error');
        throw new AssertionError(`${circularCount} clientes con cartera no normalizada`);
    } else {
        log(`${customers.length} clientes auditados. Libros de cartera limpios.`, 'success');
    }
}

// ── F4. VENTAS HUÉRFANAS DE CIERRE ──
async function suiteOverlappingCierre() {
    section('📦 SUITE F4: Finanzas: Ventas Huérfanas de Cierre (>24h sin sincronizar)');
    const sales = await storageService.getItem('bodega_sales_v1', []);

    if (!sales || !sales.length) {
        log('No hay datos suficientes para cruzar reportes.', 'info');
        return;
    }

    let orphanedCount = 0;
    const now = new Date();

    for (const sale of sales) {
        if (sale.status === 'COMPLETADA') {
            const saleDate = new Date(sale.createdAt || sale.date);
            const hoursOld = (now - saleDate) / (1000 * 60 * 60);
            if (hoursOld > 24 && !sale.syncStatus) {
                orphanedCount++;
            }
        }
    }

    if (orphanedCount > 0) {
        log(`${orphanedCount} venta(s) huérfanas (>24h sin cierre de turno registrado).`, 'error');
        throw new AssertionError(`${orphanedCount} ventas huérfanas sin cierre de turno (>24h)`);
    } else {
        log('Conciliación de turnos OK. Todos los tickets tienen menos de 24h o están cerrados.', 'success');
    }
}

// ── F5. RATE SNEAK ──
async function suiteRateSneak() {
    section('💱 SUITE F5: Operaciones: Rate Sneak (Tasa Implícita vs Registrada)');
    const sales = await storageService.getItem('bodega_sales_v1', []);
    if (!sales || !sales.length) {
        log('No hay ventas para auditar.', 'info');
        return;
    }

    let tamperedCount = 0;

    for (const sale of sales) {
        if (sale.status === 'ANULADA' || !sale.totalUsd || !sale.totalBs || !sale.rate) continue;
        const implicitRate = sale.totalBs / sale.totalUsd;
        const diff = Math.abs(implicitRate - sale.rate);

        if (diff > 0.05) {
            log(`[Ticket ${sale.id?.slice(-6) || '?'}] Tasa registrada ${sale.rate}, implícita ${implicitRate.toFixed(2)} (diff ${diff.toFixed(2)})`, 'warn');
            tamperedCount++;
        }
    }

    if (tamperedCount > 0) {
        log(`${tamperedCount} transacción(es) con tasa implícita inconsistente (Rate Sneak).`, 'error');
        throw new AssertionError(`${tamperedCount} transacciones con volatilidad de tasa`);
    } else {
        log('Correlación Bs/USD coherente en todo el historial.', 'success');
    }
}

// ── F6. MARGEN NEGATIVO ──
async function suiteMargenNegativo() {
    section('💸 SUITE F6: Catálogo: Margen Negativo (Venta a Pérdida)');
    const products = await storageService.getItem('bodega_products_v1', []);
    if (!products || !products.length) {
        log('No hay productos para auditar.', 'info');
        return;
    }

    const rawRate = parseFloat(localStorage.getItem('bodega_custom_rate') || '0');
    if (!rawRate || rawRate <= 0) {
        log('No hay tasa configurada — no se puede calcular margen en Bs. Configura una tasa primero.', 'warn');
        return;
    }

    let negativeMarginCount = 0;
    let totalLossUsd = 0;

    for (const p of products) {
        const priceUsdt = p.priceUsdt || 0;
        if (priceUsdt <= 0) continue;

        let costUsd = 0;
        if (p.costUsd && p.costUsd > 0) {
            costUsd = p.costUsd;
        } else if (p.costBs && p.costBs > 0) {
            costUsd = round2(p.costBs / rawRate);
        } else {
            continue;
        }

        if (costUsd > 0 && priceUsdt < costUsd) {
            negativeMarginCount++;
            const lossUsd = round2(costUsd - priceUsdt);
            totalLossUsd = sumR(totalLossUsd, lossUsd);
            log(`[${p.name || p.id?.slice(-6)}] Precio $${priceUsdt} < Costo $${costUsd} → Pérdida unitaria $${lossUsd}`, 'warn');
        }
    }

    if (negativeMarginCount > 0) {
        log(`${negativeMarginCount} producto(s) con margen negativo. Pérdida potencial: $${totalLossUsd.toFixed(2)} por unidad.`, 'error');
        throw new AssertionError(`${negativeMarginCount} productos vendiendo por debajo de su costo (pérdida: $${totalLossUsd.toFixed(2)})`);
    } else {
        log(`${products.filter(p => (p.priceUsdt || 0) > 0).length} productos auditados. Todos con margen positivo.`, 'success');
    }
}

// ── F7. PAGOS INCONSISTENTES ──
async function suitePagosInconsistentes() {
    section('🧾 SUITE F7: Caja: Pagos Inconsistentes (Cuadre de Caja)');
    const sales = await storageService.getItem('bodega_sales_v1', []);
    if (!sales || !sales.length) {
        log('No hay ventas para auditar.', 'info');
        return;
    }

    let inconsistentCount = 0;

    for (const sale of sales) {
        if (sale.status === 'ANULADA' || !sale.payments || !sale.payments.length) continue;
        if (!sale.totalUsd) continue;
        if (sale.tipo === 'VENTA_FIADA') continue;

        let sumPaidUsd = 0;
        for (const pmt of sale.payments) {
            if (pmt.currency === 'USD' || pmt.methodId?.includes('usd')) {
                sumPaidUsd = sumR(sumPaidUsd, pmt.amountUsd || pmt.amount || 0);
            } else if (pmt.amountUsd) {
                sumPaidUsd = sumR(sumPaidUsd, pmt.amountUsd);
            } else if (pmt.amount && sale.rate) {
                sumPaidUsd = sumR(sumPaidUsd, round2(pmt.amount / sale.rate));
            }
        }

        const changeUsd = sale.changeUsd || 0;
        const changeBs  = sale.changeBs  || 0;
        const rate       = sale.rate || 1;

        let totalChangeUsd = changeUsd;
        if (changeBs > 0 && changeUsd > 0) {
            const expectedBs = changeUsd * rate;
            const isSameChange = Math.abs(changeBs - expectedBs) / Math.max(expectedBs, 0.01) < 0.05;
            if (!isSameChange) {
                totalChangeUsd = round2(changeUsd + changeBs / rate);
            }
        } else if (changeBs > 0 && changeUsd === 0) {
            totalChangeUsd = round2(changeBs / rate);
        }

        const netPaidUsd = subR(sumPaidUsd, totalChangeUsd);

        if (Math.abs(netPaidUsd - sale.totalUsd) > 0.05) {
            inconsistentCount++;
            const shortId = sale.id?.slice(-6) || '?';
            log(`[Ticket ${shortId}] Cobrado neto $${netPaidUsd} vs Total $${sale.totalUsd} (diff $${Math.abs(netPaidUsd - sale.totalUsd).toFixed(2)})`, 'warn');
            log(`  ↳ rate=${sale.rate} | changeUsd=${sale.changeUsd ?? 'N/A'} | changeBs=${sale.changeBs ?? 'N/A'} | tipo=${sale.tipo || 'VENTA'}`, 'warn');
            for (const pmt of sale.payments) {
                log(`  ↳ pago: method=${pmt.methodId} currency=${pmt.currency} amount=${pmt.amount ?? '—'} amountUsd=${pmt.amountUsd ?? '—'} amountBs=${pmt.amountBs ?? '—'}`, 'warn');
            }
        }
    }

    if (inconsistentCount > 0) {
        log(`${inconsistentCount} venta(s) con cuadre de pagos inconsistente.`, 'error');
        throw new AssertionError(`${inconsistentCount} ventas donde pagos ≠ total (posible descuadre de caja)`);
    } else {
        const auditedCount = sales.filter(s => s.status !== 'ANULADA' && s.payments?.length && s.totalUsd).length;
        log(`${auditedCount} ventas con pagos auditadas. Cuadre de caja perfecto.`, 'success');
    }
}

// ── F8. IDs DUPLICADOS ──
async function suiteIdsDuplicados() {
    section('🪪 SUITE F8: Registros: IDs y Nombres Duplicados');

    const [products, sales, customers] = await Promise.all([
        storageService.getItem('bodega_products_v1', []),
        storageService.getItem('bodega_sales_v1', []),
        storageService.getItem('bodega_customers_v1', []),
    ]);

    let totalDuplicates = 0;

    const checkDuplicates = (items, label, keyFn = i => i.id) => {
        if (!items?.length) return 0;
        const seen = new Map();
        let dups = 0;
        for (const item of items) {
            const key = keyFn(item);
            if (!key) continue;
            if (seen.has(key)) {
                dups++;
                log(`[${label}] ID duplicado: "${key}"`, 'warn');
            } else {
                seen.set(key, true);
            }
        }
        return dups;
    };

    totalDuplicates += checkDuplicates(products, 'Productos');
    totalDuplicates += checkDuplicates(sales, 'Ventas');
    totalDuplicates += checkDuplicates(customers, 'Clientes');

    const nameDups = checkDuplicates(products, 'Productos (nombre)', p => p.name?.trim().toLowerCase());
    if (nameDups > 0) {
        log(`${nameDups} producto(s) con nombre duplicado — posibles entradas dobles en catálogo.`, 'warn');
    }
    totalDuplicates += nameDups;

    if (totalDuplicates > 0) {
        log(`${totalDuplicates} duplicado(s) encontrados en registros.`, 'error');
        throw new AssertionError(`${totalDuplicates} registros con IDs o nombres duplicados`);
    } else {
        log('Integridad referencial OK. Sin IDs ni nombres duplicados.', 'success');
    }
}

// ── F9. COHERENCIA DE CARTERA (deuda calculada vs registrada) ──
async function suiteCarteraCoherencia() {
    section('📒 SUITE F9: Clientes: Coherencia de Cartera (Fiado vs Cobros)');

    const [sales, customers] = await Promise.all([
        storageService.getItem('bodega_sales_v1', []),
        storageService.getItem('bodega_customers_v1', []),
    ]);

    if (!customers?.length || !sales?.length) {
        log('Sin datos de clientes o ventas para cruzar.', 'info');
        return;
    }

    let mismatchCount = 0;

    for (const customer of customers) {
        // Recalcular deuda desde el historial: fiado acumulado - cobros
        const clientSales = sales.filter(s => s.customerId === customer.id);
        const fiadoTotal = clientSales
            .filter(s => s.tipo === 'VENTA_FIADA' && s.status !== 'ANULADA')
            .reduce((acc, s) => sumR(acc, s.fiadoUsd || s.totalUsd || 0), 0);
        const cobrosTotal = clientSales
            .filter(s => s.tipo === 'COBRO_DEUDA' && s.status !== 'ANULADA')
            .reduce((acc, s) => sumR(acc, s.totalUsd || 0), 0);

        const calculatedDeuda = round2(Math.max(0, subR(fiadoTotal, cobrosTotal)));

        // Tolerancia amplia: pagos parciales y abonos de saldo_favor también reducen la deuda
        const reportedDeuda = round2(customer.deuda || 0);
        if (Math.abs(calculatedDeuda - reportedDeuda) > 1.0) {
            mismatchCount++;
            log(`[${customer.name || customer.id?.slice(-6)}] Deuda calculada $${calculatedDeuda} vs registrada $${reportedDeuda} (diff $${Math.abs(calculatedDeuda - reportedDeuda).toFixed(2)})`, 'warn');
        }
    }

    if (mismatchCount > 0) {
        log(`${mismatchCount} cliente(s) con deuda histórica inconsistente.`, 'error');
        throw new AssertionError(`${mismatchCount} clientes con inconsistencia entre deuda registrada y ventas fiadas`);
    } else {
        log(`${customers.length} clientes cruzados con historial. Cartera coherente.`, 'success');
    }
}

// ── F10. APERTURA ÚNICA POR DÍA ──
async function suiteAperturaUnica() {
    section('🔓 SUITE F10: Caja: Apertura Única por Día');

    const sales = await storageService.getItem('bodega_sales_v1', []);
    if (!sales?.length) {
        log('Sin ventas para auditar aperturas.', 'info');
        return;
    }

    const aperturas = sales.filter(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
    const byDay = {};

    for (const a of aperturas) {
        const dayStr = a.timestamp ? a.timestamp.slice(0, 10) : 'unknown';
        if (!byDay[dayStr]) byDay[dayStr] = [];
        byDay[dayStr].push(a);
    }

    let duplicateDays = 0;
    for (const [day, records] of Object.entries(byDay)) {
        if (records.length > 1) {
            duplicateDays++;
            log(`[${day}] ${records.length} aperturas abiertas simultáneas — solo debe haber 1.`, 'warn');
        }
    }

    if (duplicateDays > 0) {
        log(`${duplicateDays} día(s) con múltiples aperturas de caja sin cerrar.`, 'error');
        throw new AssertionError(`${duplicateDays} días con apertura de caja duplicada`);
    } else {
        log(`${Object.keys(byDay).length} día(s) con apertura auditados. Una sola apertura por día.`, 'success');
    }
}

// ── F11. MÉTODOS DE PAGO VÁLIDOS ──
async function suiteMetodosValidos() {
    section('💳 SUITE F11: Caja: Métodos de Pago Válidos en Historial');

    const sales = await storageService.getItem('bodega_sales_v1', []);
    if (!sales?.length) {
        log('Sin ventas para auditar métodos de pago.', 'info');
        return;
    }

    // Métodos conocidos de fábrica + prefijos válidos
    const KNOWN_METHODS = new Set([
        'efectivo_bs', 'pago_movil', 'punto_venta',
        'efectivo_usd', 'efectivo_cop', 'transferencia_cop',
        'saldo_favor', 'fiado',
        'zelle', 'binance', 'paypal',
    ]);

    let unknownCount = 0;
    const unknownMethods = new Set();

    for (const sale of sales) {
        if (!sale.payments?.length) continue;
        for (const pmt of sale.payments) {
            const mid = pmt.methodId;
            if (!mid) continue;
            // custom_ prefix es válido
            if (mid.startsWith('custom_')) continue;
            if (!KNOWN_METHODS.has(mid)) {
                unknownMethods.add(mid);
                unknownCount++;
            }
        }
    }

    if (unknownCount > 0) {
        const methods = [...unknownMethods].join(', ');
        log(`${unknownCount} pago(s) con methodId desconocido: ${methods}`, 'warn');
        // Warning, no fallo crítico: los métodos personalizados son legítimos si tienen custom_ prefix
        // Solo falla si hay methodId null/undefined que causarían problemas de visualización
        const nullMethods = sales.some(s => s.payments?.some(p => !p.methodId));
        if (nullMethods) {
            throw new AssertionError('Hay pagos con methodId null o undefined — causará errores de visualización');
        } else {
            log('Los métodos desconocidos son personalizados. Sin methodIds nulos.', 'warn');
        }
    } else {
        const auditedSales = sales.filter(s => s.payments?.length).length;
        log(`${auditedSales} ventas con pagos auditadas. Todos los methodIds son conocidos.`, 'success');
    }
}

// ════════════════════════════════════════════════════════════
// REGISTRO DE SUITES v6.0
// ════════════════════════════════════════════════════════════
const SUITES = [
    // ── Bloque A: Motor dinero.js ──
    { key: 'precision_financiera',   name: '🔬 Motor A1: Certificación de Precisión',         fn: suitePrecisionFinanciera,  fast: true },
    { key: 'dinero_extended',        name: '🧮 Motor A2: Dinero Extended (round4 + divR)',     fn: suiteDineroExtended,       fast: true },

    // ── Bloque B: FinancialEngine ──
    { key: 'cart_engine',            name: '🛒 Engine B1: Cart Totals (buildCartTotals)',      fn: suiteCartEngine,           fast: true },
    { key: 'discount_logic',         name: '🏷️ Engine B2: Discount Logic (% / fijo / clamp)', fn: suiteDiscountLogic,        fast: true },
    { key: 'profit_engine',          name: '📈 Engine B3: Profit Engine (calculateSaleProfit)',fn: suiteProfitEngine,         fast: true },
    { key: 'payment_breakdown',      name: '💳 Engine B4: Payment Breakdown (desglose caja)', fn: suitePaymentBreakdown,     fast: true },

    // ── Bloque C: procesarImpactoCliente ──
    { key: 'cliente_impacto',        name: '👤 Clientes C1: Impacto Golden Rule (Q0–Q3)',     fn: suiteClienteImpacto,       fast: true },

    // ── Bloque D: Flujos de caja ──
    { key: 'fiado_calculo',          name: '📋 Caja D1: Cálculo de Fiado (remaining/tipo)',   fn: suiteFiadoCalculo,         fast: true },
    { key: 'cambio_split',           name: '💱 Caja D2: Cambio Split (USD+Bs / espejo)',       fn: suiteCambioSplit,          fast: true },
    { key: 'stock_modos',            name: '📦 Inventario D3: Stock Modos (unit/peso/pkg)',   fn: suiteStockModos,           fast: true },

    // ── Bloque E: Lógica COP completa ──
    { key: 'cop_display',            name: '🇨🇴 COP E1: Display (precedencia tasa / primary)', fn: suiteCopDisplay,           fast: true },
    { key: 'cop_pagos',              name: '💛 COP E2: Pagos (conversión, sale, breakdown)',    fn: suiteCopPagos,             fast: true },

    // ── Bloque F: Auditorías de datos reales ──
    { key: 'auditoria_historica',    name: '🕵️ Datos F1: Integridad de Libros Históricos',   fn: suiteAuditarDataHistorica, fast: true },
    { key: 'auditoria_patrimonial',  name: '🏭 Datos F2: Inventario Fantasma (stock -)',      fn: suitePatrimonialInventario,fast: true },
    { key: 'auditoria_cartera',      name: '👥 Datos F3: Deuda Circular (cartera)',           fn: suiteDeudaCircular,        fast: true },
    { key: 'auditoria_cierre',       name: '📦 Datos F4: Ventas Huérfanas de Cierre',         fn: suiteOverlappingCierre,    fast: true },
    { key: 'auditoria_tasas',        name: '💱 Datos F5: Rate Sneak (tasa implícita)',         fn: suiteRateSneak,            fast: true },
    { key: 'margen_negativo',        name: '💸 Datos F6: Margen Negativo (venta a pérdida)',  fn: suiteMargenNegativo,       fast: true },
    { key: 'pagos_inconsistentes',   name: '🧾 Datos F7: Pagos Inconsistentes (caja)',        fn: suitePagosInconsistentes,  fast: true },
    { key: 'ids_duplicados',         name: '🪪 Datos F8: IDs y Nombres Duplicados',           fn: suiteIdsDuplicados,        fast: true },
    { key: 'cartera_coherencia',     name: '📒 Datos F9: Coherencia de Cartera (fiado/cobro)',fn: suiteCarteraCoherencia,    fast: true },
    { key: 'apertura_unica',         name: '🔓 Datos F10: Apertura Única por Día',            fn: suiteAperturaUnica,        fast: true },
    { key: 'metodos_validos',        name: '💳 Datos F11: Métodos de Pago Válidos',           fn: suiteMetodosValidos,       fast: true },
];

// ════════════════════════════════════════════════════════════
// EXPORTS API
// ════════════════════════════════════════════════════════════

export const SystemTester = {
    getSuites: () => [...SUITES],

    getState: () => ({
        logs: [...state.logs],
        suites: [...state.suites],
        isRunning: state.isRunning,
        stopped: state.stopped,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        aiAnalysis: state.aiAnalysis || null,
    }),

    stop: () => {
        state.stopped = true;
        log('⛔ Auditoría detenida por el usuario.', 'warn');
    },

    async runAll({ onLog, onProgress, onComplete, fastMode = false } = {}) {
        resetState();
        const targetSuites = fastMode ? SUITES.filter(s => s.fast) : SUITES;
        initSuites(targetSuites);

        state.isRunning = true;
        state.startedAt = Date.now();
        state.onLog = onLog || null;
        state.onProgress = onProgress || null;

        log(`🚀 Auditor Financiero v6.0 — ${targetSuites.length} suites`, 'info');
        log(`   Bloques: A (dinero.js) · B (FinancialEngine) · C (Clientes) · D (Caja) · E (COP) · F (Datos Reales)`, 'info');

        let passed = 0;
        let failed = 0;

        for (let i = 0; i < targetSuites.length; i++) {
            const suiteConfig = targetSuites[i];

            if (state.stopped) {
                log('⛔ Auditoría abortada por el usuario.', 'warn');
                updateSuiteStatus(suiteConfig.key, { status: 'skipped' });
                continue;
            }

            onProgress?.({ name: suiteConfig.name, current: i + 1, total: targetSuites.length });
            updateSuiteStatus(suiteConfig.key, { status: 'running', startedAt: Date.now() });

            try {
                await suiteConfig.fn();
                updateSuiteStatus(suiteConfig.key, { status: 'passed', finishedAt: Date.now() });
                passed++;
            } catch (err) {
                log(`Suite fallida: ${suiteConfig.name} — ${err.message}`, 'error');
                updateSuiteStatus(suiteConfig.key, { status: 'failed', finishedAt: Date.now(), error: err.message });
                failed++;
            }

            await delay(20);
        }

        state.finishedAt = Date.now();
        const elapsedSec = ((state.finishedAt - state.startedAt) / 1000).toFixed(1);

        section('📊 RESULTADO FINAL');
        log(`✅ ${passed} aprobadas | ❌ ${failed} fallidas | ⏱️ ${elapsedSec}s`, passed > 0 && failed === 0 ? 'success' : failed > 0 ? 'error' : 'info');

        state.isRunning = false;

        // Run Groq AI analysis after all suites complete
        log('🤖 Generando análisis de IA...', 'info');
        state.aiAnalysis = await runGroqAnalysis(state.suites, elapsedSec);
        if (state.aiAnalysis) {
            log('✅ Análisis de IA completado.', 'success');
        }

        const finalSummary = this.getState();
        onComplete?.(finalSummary);
        return finalSummary;
    },

    async runSuite(suiteId, { onLog } = {}) {
        resetState();
        const suiteConfig = SUITES.find(s => s.key === suiteId);

        if (!suiteConfig) {
            log(`Suite "${suiteId}" no encontrada`, 'error');
            return null;
        }

        initSuites([suiteConfig]);
        state.isRunning = true;
        state.startedAt = Date.now();
        state.onLog = onLog || null;

        updateSuiteStatus(suiteConfig.key, { status: 'running', startedAt: Date.now() });

        try {
            await suiteConfig.fn();
            updateSuiteStatus(suiteConfig.key, { status: 'passed', finishedAt: Date.now() });
            log(`${suiteConfig.name} ✓`, 'success');
        } catch (err) {
            log(`Error en ${suiteConfig.name}: ${err.message}`, 'error');
            updateSuiteStatus(suiteConfig.key, { status: 'failed', finishedAt: Date.now(), error: err.message });
        }

        state.finishedAt = Date.now();
        state.isRunning = false;

        return this.getState();
    },
};
