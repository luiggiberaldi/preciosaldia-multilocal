/**
 * tests/granelMoneySale.test.js — GRANEL-MONEY: venta a granel "por monto".
 *
 * Caso de uso: "dame 3$ de queso" / "dame 5000 Bs de jabón líquido".
 * Cubre parseMoneyAmount, bsToUsd y qtyFromMoneyAmount (utils/granel.js),
 * incluyendo los casos límite que debe manejar la UI:
 *   - montos con coma decimal ("3,5"),
 *   - Bs sin tasa configurada,
 *   - precio unitario inválido,
 *   - monto tan chico que la cantidad redondea a 0 (anti-bucle),
 *   - la cantidad resultante es compatible con addToCart/parseCartQuantity.
 */

import { describe, it, expect } from 'vitest';
import {
    parseMoneyAmount,
    bsToUsd,
    qtyFromMoneyAmount,
    parseCartQuantity,
    isGranelProduct,
} from '../src/utils/granel.js';

describe('GRANEL-MONEY · parseMoneyAmount', () => {
    it('parsea montos con punto decimal', () => {
        expect(parseMoneyAmount('3.00')).toBe(3);
        expect(parseMoneyAmount('5000')).toBe(5000);
    });

    it('parsea montos con coma decimal (es-VE)', () => {
        expect(parseMoneyAmount('3,5')).toBe(3.5);
        expect(parseMoneyAmount('2,50')).toBe(2.5);
    });

    it('rechaza vacíos, ceros, negativos y basura', () => {
        expect(parseMoneyAmount('')).toBeNull();
        expect(parseMoneyAmount('   ')).toBeNull();
        expect(parseMoneyAmount('0')).toBeNull();
        expect(parseMoneyAmount('-3')).toBeNull();
        expect(parseMoneyAmount('abc')).toBeNull();
        expect(parseMoneyAmount(null)).toBeNull();
        expect(parseMoneyAmount(undefined)).toBeNull();
    });
});

describe('GRANEL-MONEY · bsToUsd', () => {
    it('convierte con redondeo canónico a 2 decimales', () => {
        expect(bsToUsd(5000, 40)).toBe(125);
        expect(bsToUsd(100, 36.5)).toBe(2.74); // 2.7397… → 2.74
        expect(bsToUsd(79.75 * 3, 79.75)).toBe(3);
    });

    it('no lanza con tasa 0/inválida (devuelve 0; la validación vive en qtyFromMoneyAmount)', () => {
        expect(bsToUsd(100, 0)).toBe(0);
        expect(bsToUsd(100, NaN)).toBe(0);
    });
});

describe('GRANEL-MONEY · qtyFromMoneyAmount — USD', () => {
    const PRICE = 10; // $10 / kg (Queso Blanco, como en la captura)

    it('"dame 3$ de queso" a $10/kg → 0.3 kg exactos', () => {
        expect(qtyFromMoneyAmount(3, 'usd', PRICE, 40)).toBe(0.3);
    });

    it('montos que caen en decimales flotantes se normalizan a 3 decimales', () => {
        // 3.5 / 10 = 0.35 exacto; 7/3 = 2.333… → 2.333
        expect(qtyFromMoneyAmount(3.5, 'usd', PRICE, 40)).toBe(0.35);
        expect(qtyFromMoneyAmount(7, 'usd', 3, 40)).toBe(2.333);
    });

    it('precio por unidad en Bs → USD no altera el resultado (priceCop/tasaCop)', () => {
        // priceCop=400Bs, tasaCop=40 → $10/kg; "3$" → 0.3
        expect(qtyFromMoneyAmount(3, 'usd', 400 / 40, 40)).toBe(0.3);
    });
});

describe('GRANEL-MONEY · qtyFromMoneyAmount — Bs', () => {
    const PRICE = 10;  // $10/kg
    const RATE = 79.75;

    it('"dame 5000 Bs de jabón" → convierte a USD con la tasa vigente', () => {
        // 5000 / 79.75 = 62.6959… USD → 62.6959…/10 = 6.2696… → 6.27 kg? No:
        // round3(6.26959…) = 6.270
        const qty = qtyFromMoneyAmount(5000, 'bs', PRICE, RATE);
        expect(qty).toBeCloseTo(6.27, 3);
        expect(String(qty)).not.toMatch(/000000/); // sin artefactos flotantes
    });

    it('sin tasa (0) devuelve null → la UI pide configurar la tasa', () => {
        expect(qtyFromMoneyAmount(5000, 'bs', PRICE, 0)).toBeNull();
        expect(qtyFromMoneyAmount(5000, 'bs', PRICE, NaN)).toBeNull();
    });

    it('redondeo financiero round-half-away-from-zero en el paso Bs→USD', () => {
        // 79.75 Bs a tasa 79.75 = 1.0000 USD exacto → 0.1 kg a $10/kg
        expect(qtyFromMoneyAmount(79.75, 'bs', PRICE, RATE)).toBe(0.1);
    });
});

describe('GRANEL-MONEY · casos límite y guardarraíles', () => {
    it('precio unitario inválido (<=0) rechaza la conversión', () => {
        expect(qtyFromMoneyAmount(3, 'usd', 0, 40)).toBeNull();
        expect(qtyFromMoneyAmount(3, 'usd', -10, 40)).toBeNull();
        expect(qtyFromMoneyAmount(3, 'usd', NaN, 40)).toBeNull();
    });

    it('anti-bucle: monto menor que 0.001 unidades → null (UI muestra aviso)', () => {
        // $0.005 a $10/kg = 0.0005 kg → round3 → 0.001? No: 0.0005 → 0.001 (half away)
        // Usamos algo claramente inferior: $0.001 a $10/kg = 0.0001 → 0
        expect(qtyFromMoneyAmount(0.001, 'usd', 10, 40)).toBeNull();
        // Frontera exacta: $0.01 a $10/kg = 0.001 kg → se permite
        expect(qtyFromMoneyAmount(0.01, 'usd', 10, 40)).toBe(0.001);
    });

    it('monto 0/negativo/no numérico → null', () => {
        expect(qtyFromMoneyAmount(0, 'usd', 10, 40)).toBeNull();
        expect(qtyFromMoneyAmount(-5, 'usd', 10, 40)).toBeNull();
        expect(qtyFromMoneyAmount('x', 'usd', 10, 40)).toBeNull();
    });

    it('la cantidad resultante es aceptada por el pipeline del carrito (round-trip)', () => {
        // Lo que produce qtyFromMoneyAmount debe pasar parseCartQuantity para granel
        const qty = qtyFromMoneyAmount(3, 'usd', 10, 40);
        expect(qty).toBeGreaterThan(0);
        expect(parseCartQuantity(qty, true)).toBe(qty);

        // Y el producto de la captura es detectado como granel
        const queso = { name: 'Queso Blanco', unit: 'kg', priceUsdt: 10, stock: 55.5 };
        expect(isGranelProduct(queso)).toBe(true);
    });

    it('escala: "dame 50$" de queso a $10/kg → 5 kg', () => {
        expect(qtyFromMoneyAmount(50, 'usd', 10, 40)).toBe(5);
    });
});
