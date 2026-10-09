/**
 * topProductsAggregation.test.js — Ranking de "Más vendidos".
 *
 * Antes se agrupaba por nombre: "Cigarro Consul" y "CIGARRO CONSUL" salían como
 * dos productos, y productos fuera del inventario aparecían igual.
 */
import { describe, expect, it } from 'vitest';
import { aggregateTopProducts } from '../src/hooks/useDashboardMetrics.js';

const catalog = [
    { id: 'c1', name: 'Cigarro Consul', priceUsd: 1 },
    { id: 'p1', name: 'Cerveza Polar Light', priceUsd: 2 },
];

describe('aggregateTopProducts', () => {
    it('agrupa por id: nombres distintos del mismo producto suman en uno', () => {
        const sales = [
            { items: [{ id: 'c1', name: 'Cigarro Consul', qty: 2, priceUsd: 1 }] },
            { items: [{ id: 'c1', name: 'CIGARRO CONSUL', qty: 3, priceUsd: 1 }] },
        ];
        const out = aggregateTopProducts(sales, catalog);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ id: 'c1', name: 'Cigarro Consul', qty: 5 });
    });

    it('excluye productos que ya no están en el inventario', () => {
        const sales = [
            { items: [{ id: 'borrado', name: 'Producto viejo', qty: 99, priceUsd: 1 }] },
            { items: [{ id: 'p1', name: 'Cerveza Polar Light', qty: 1, priceUsd: 2 }] },
        ];
        const out = aggregateTopProducts(sales, catalog);
        expect(out.map(p => p.id)).toEqual(['p1']);
    });

    it('usa el nombre actual del catálogo', () => {
        const sales = [{ items: [{ id: 'p1', name: 'Polar vieja', qty: 1, priceUsd: 2 }] }];
        expect(aggregateTopProducts(sales, catalog)[0].name).toBe('Cerveza Polar Light');
    });

    it('usa _originalId cuando el ítem es una línea derivada', () => {
        const sales = [{ items: [{ id: 'linea-1', _originalId: 'p1', name: 'Cerveza Polar Light', qty: 2, priceUsd: 2 }] }];
        const out = aggregateTopProducts(sales, catalog);
        expect(out[0]).toMatchObject({ id: 'p1', qty: 2 });
    });

    it('ignora ventas libres y personalizadas', () => {
        const sales = [{ items: [
            { id: 'custom_1', name: 'Venta libre', qty: 5, priceUsd: 1, isCustom: true },
            { id: 'c1', name: 'Cigarro Consul', qty: 1, priceUsd: 1 },
        ] }];
        expect(aggregateTopProducts(sales, catalog)).toHaveLength(1);
    });

    it('ordena por cantidad vendida, de mayor a menor', () => {
        const sales = [{ items: [
            { id: 'c1', name: 'Cigarro Consul', qty: 1, priceUsd: 1 },
            { id: 'p1', name: 'Cerveza Polar Light', qty: 4, priceUsd: 2 },
        ] }];
        expect(aggregateTopProducts(sales, catalog).map(p => p.id)).toEqual(['p1', 'c1']);
    });
});
