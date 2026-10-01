import { describe, it, expect } from 'vitest';
import { detectarColumnas, parseNumero, mapInventarioRows } from '../src/utils/excelImport.js';

describe('excelImport', () => {
    describe('detectarColumnas', () => {
        it('detecta el encabezado estándar de bodega', () => {
            const cols = detectarColumnas(['PRODUCTO', 'CODIGO', 'VENTA USD', 'EXISTENCIA', 'ESTIMADO USD']);
            expect(cols).toEqual({ nombre: 0, codigo: 1, precio: 2, existencia: 3 });
        });
        it('tolera "VENTA " con espacio y sin sufijo USD (cosméticos)', () => {
            const cols = detectarColumnas(['PRODUCTO', 'CODIGO', 'VENTA ', 'EXISTENCIA', 'ESTIMADO ']);
            expect(cols.precio).toBe(2);
        });
        it('devuelve null si no hay columna PRODUCTO', () => {
            expect(detectarColumnas(['A', 'B', 'C'])).toBeNull();
        });
    });

    describe('parseNumero', () => {
        it('pasa números tal cual', () => {
            expect(parseNumero(2.5)).toBe(2.5);
            expect(parseNumero(-35)).toBe(-35);
        });
        it('parsea "160,00" (texto de cosméticos)', () => {
            expect(parseNumero('160,00')).toBe(160);
        });
        it('parsea "1.234,56" con separador de miles', () => {
            expect(parseNumero('1.234,56')).toBe(1234.56);
        });
        it('parsea "1,234.56" estilo US', () => {
            expect(parseNumero('1,234.56')).toBe(1234.56);
        });
        it('vacio/null -> 0', () => {
            expect(parseNumero(null)).toBe(0);
            expect(parseNumero('')).toBe(0);
        });
    });

    describe('mapInventarioRows', () => {
        const filas = [
            ['PRODUCTO', 'CODIGO', 'VENTA USD', 'EXISTENCIA', 'ESTIMADO USD'],
            ['MAYONESA KRAFT 175GR', 7622201512279, 2.5, 13, 32.5],
            ['MANI SALADO', '1', 1.0, 233.66, 233.66],
            ['AVANCE EFECTIVO', '1', 0.14, 1680, 235.2], // código duplicado
            ['', 'X', 5, 10, 50], // sin nombre -> omitida
            ['EN NEGATIVO', 'N1', 3, -5, -15],
            ['SIN PRECIO', 'S1', 0, 4, 0],
        ];
        const r = mapInventarioRows(filas, { idGen: (() => { let n = 0; return () => `id-${++n}`; })() });

        it('mapea productos al esquema de la app', () => {
            expect(r.error).toBeNull();
            expect(r.products).toHaveLength(5);
            const m = r.products[0];
            expect(m.name).toBe('Mayonesa Kraft 175gr');
            expect(m.barcode).toBe('7622201512279');
            expect(m.priceUsd).toBe(2.5);
            expect(m.priceUsdt).toBe(2.5);
            expect(m.stock).toBe(13);
            expect(m.id).toBe('id-1');
        });
        it('al duplicado le quita el código (no rompe el POS)', () => {
            const dup = r.products.find(p => p.name === 'Avance Efectivo');
            expect(dup.barcode).toBeNull();
            expect(r.stats.duplicadosSinCodigo).toBe(1);
        });
        it('redondea existencia decimal (no granel)', () => {
            const mani = r.products.find(p => p.name === 'Mani Salado');
            expect(mani.stock).toBe(234);
            expect(r.stats.decimalesRedondeados).toBe(1);
        });
        it('conserva negativos y los cuenta', () => {
            const neg = r.products.find(p => p.name === 'En Negativo');
            expect(neg.stock).toBe(-5);
            expect(r.stats.negativos).toBe(1);
        });
        it('omite filas sin nombre y cuenta precio cero', () => {
            expect(r.stats.omitidos).toBe(1);
            expect(r.stats.precioCero).toBe(1);
            expect(r.stats.importados).toBe(5);
        });
        it('error si no hay encabezado', () => {
            const bad = mapInventarioRows([['a', 'b'], ['c', 'd']]);
            expect(bad.error).toBeTruthy();
            expect(bad.products).toHaveLength(0);
        });
    });
});
