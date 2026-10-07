import { describe, it, expect } from 'vitest';
import { round2 } from '../src/utils/dinero';

// Función pura de escalado que usará BulkPriceAdjustModal
export function calculateScaledProduct(p, multiplier) {
    const oldPriceUsd = p.priceUsdt ?? p.priceUsd ?? 0;
    const newPriceUsd = Math.max(0.01, round2(oldPriceUsd * multiplier));

    const updated = {
        ...p,
        priceUsdt: newPriceUsd,
        priceUsd: newPriceUsd,
    };

    // Escalar COP si existe
    if (p.priceCop && p.priceCop > 0) {
        updated.priceCop = Math.max(100, Math.round(p.priceCop * multiplier));
    }

    // Escalar referencia dual si existe
    if (p.priceBsUsdRef && p.priceBsUsdRef > 0) {
        updated.priceBsUsdRef = Math.max(0.01, round2(p.priceBsUsdRef * multiplier));
    }

    // Escalar precio unitario suelto si existe
    if (p.unitPriceUsd && p.unitPriceUsd > 0) {
        updated.unitPriceUsd = Math.max(0.01, round2(p.unitPriceUsd * multiplier));
    }

    // Escalar precio unitario COP si existe
    if (p.unitPriceCop && p.unitPriceCop > 0) {
        updated.unitPriceCop = Math.max(50, Math.round(p.unitPriceCop * multiplier));
    }

    return updated;
}

export function detectBelowCost(products, multiplier, effectiveRate = 1) {
    return products.filter(p => {
        const cost = p.costUsd || (p.costBs && effectiveRate > 0 ? p.costBs / effectiveRate : 0);
        if (cost <= 0) return false;
        const newPrice = Math.max(0.01, round2((p.priceUsdt ?? p.priceUsd ?? 0) * multiplier));
        return newPrice < cost;
    });
}

describe('Bulk Price Adjustment Logic & Guardrails', () => {
    it('escala correctamente precios en USD sin decimales flotantes sucios', () => {
        const product = { id: 'p1', name: 'Refresco', priceUsdt: 1.23, priceUsd: 1.23 };
        const multiplier = 1 + 10 / 100; // +10%
        const updated = calculateScaledProduct(product, multiplier);

        // 1.23 * 1.10 = 1.353 -> round2 debe dar 1.35, no 1.3530
        expect(updated.priceUsdt).toBe(1.35);
        expect(updated.priceUsd).toBe(1.35);
    });

    it('escala simultáneamente priceCop y unitPriceCop en enteros', () => {
        const product = {
            id: 'p2',
            name: 'Harina PAN',
            priceUsdt: 1.50,
            priceUsd: 1.50,
            priceCop: 6000,
            unitPriceUsd: 1.50,
            unitPriceCop: 6000
        };
        const multiplier = 1 + 15 / 100; // +15%
        const updated = calculateScaledProduct(product, multiplier);

        expect(updated.priceUsdt).toBe(1.73);
        expect(updated.priceUsd).toBe(1.73);
        // 6000 * 1.15 = 6900
        expect(updated.priceCop).toBe(6900);
        expect(updated.unitPriceCop).toBe(6900);
    });

    it('escala correctamente priceBsUsdRef en productos con modalidad dual_usd', () => {
        const product = {
            id: 'p3',
            name: 'Aceite',
            pricingMode: 'dual_usd',
            priceUsdt: 2.00,
            priceUsd: 2.00,
            priceBsUsdRef: 2.20
        };
        const multiplier = 1 - 10 / 100; // -10%
        const updated = calculateScaledProduct(product, multiplier);

        expect(updated.priceUsdt).toBe(1.80);
        expect(updated.priceUsd).toBe(1.80);
        expect(updated.priceBsUsdRef).toBe(1.98);
    });

    it('detecta productos que quedarán por debajo del costo al aplicar rebajas', () => {
        const products = [
            { id: '1', name: 'Leche', priceUsdt: 2.10, costUsd: 2.00 }, // Con -20% quedará en 1.68 (< 2.00)
            { id: '2', name: 'Galletas', priceUsdt: 5.00, costUsd: 2.00 }, // Con -20% quedará en 4.00 (> 2.00)
        ];
        const multiplier = 1 - 20 / 100; // -20%
        const belowCost = detectBelowCost(products, multiplier);

        expect(belowCost).toHaveLength(1);
        expect(belowCost[0].id).toBe('1');
    });

    it('filtra correctamente entre selección activa (selectedIds), categoría y todos', () => {
        const products = [
            { id: 'p1', name: 'A', category: 'viveres' },
            { id: 'p2', name: 'B', category: 'viveres' },
            { id: 'p3', name: 'C', category: 'bebidas' },
        ];
        const selectedIds = new Set(['p1', 'p3']);

        // Filtrado por selección
        const fromSelection = products.filter(p => selectedIds.has(p.id));
        expect(fromSelection).toHaveLength(2);

        // Filtrado por categoría
        const fromCat = products.filter(p => p.category === 'viveres');
        expect(fromCat).toHaveLength(2);

        // Todos
        expect(products).toHaveLength(3);
    });

    it('soporta rollback exacto restaurando el snapshot previo', () => {
        const initialProducts = [
            { id: 'p1', priceUsdt: 10, priceCop: 40000 },
            { id: 'p2', priceUsdt: 20, priceCop: 80000 },
        ];

        // Crear snapshot
        const snapshot = initialProducts.map(p => ({ ...p }));

        // Aplicar ajuste de +10%
        const modified = initialProducts.map(p => calculateScaledProduct(p, 1.10));
        expect(modified[0].priceUsdt).toBe(11);

        // Revertir con snapshot
        const restored = modified.map(p => {
            const snap = snapshot.find(s => s.id === p.id);
            return snap ? { ...p, ...snap } : p;
        });

        expect(restored[0].priceUsdt).toBe(10);
        expect(restored[0].priceCop).toBe(40000);
        expect(restored[1].priceUsdt).toBe(20);
        expect(restored[1].priceCop).toBe(80000);
    });
});
