import { describe, it, expect } from 'vitest';
import { unShiftBarcode, isLikelyBarcode, normalizeBarcode } from '../src/utils/barcodeNormalizer';

describe('barcodeNormalizer utility', () => {
    describe('unShiftBarcode', () => {
        it('traduce símbolos producidos por Shift/Bloq Mayús en teclado español/LATAM', () => {
            // Caso real de usuario: /%)))%)====" # -> 7599959000023
            const input = '/%)))%)====" #';
            expect(unShiftBarcode(input)).toBe('7599959000023');
        });

        it('traduce todos los dígitos 0-9 correspondientes a Shift', () => {
            // = ! " # $ % & / ( )
            const allSymbols = '=!"#$%&/()';
            expect(unShiftBarcode(allSymbols)).toBe('0123456789');
        });

        it('soporta símbolo de punto medio · como 3 en teclado español España', () => {
            const input = '/%·=';
            expect(unShiftBarcode(input)).toBe('7530');
        });

        it('soporta caracteres Shift de teclado US como fallback (@, ^, *)', () => {
            const input = '!@#$^=*';
            // !->1, @->2, #->3, $->4, ^->6, =->0, *->8
            expect(unShiftBarcode(input)).toBe('1234608');
        });

        it('no altera cadenas numéricas estándar', () => {
            expect(unShiftBarcode('7591234567890')).toBe('7591234567890');
        });

        it('maneja strings vacíos, nulos o no-strings', () => {
            expect(unShiftBarcode('')).toBe('');
            expect(unShiftBarcode(null)).toBe('');
            expect(unShiftBarcode(undefined)).toBe('');
        });
    });

    describe('isLikelyBarcode', () => {
        it('reconoce códigos de barra numéricos de 3 o más dígitos', () => {
            expect(isLikelyBarcode('7591234567890')).toBe(true);
            expect(isLikelyBarcode('123456')).toBe(true);
            expect(isLikelyBarcode('123')).toBe(true);
            expect(isLikelyBarcode('12')).toBe(false);
        });

        it('reconoce secuencias de símbolos Shift que representan códigos numéricos', () => {
            expect(isLikelyBarcode('/%)))%)====" #')).toBe(true);
            expect(isLikelyBarcode('!@#$')).toBe(true);
            expect(isLikelyBarcode('/%')).toBe(false); // muy corto (< 3)
        });

        it('retorna false para texto normal', () => {
            expect(isLikelyBarcode('arroz')).toBe(false);
            expect(isLikelyBarcode('coca cola 2L')).toBe(false);
            expect(isLikelyBarcode('')).toBe(false);
        });
    });

    describe('normalizeBarcode', () => {
        const mockProducts = [
            { id: '101', name: 'Toddy 200gr', barcode: '7599959000023' },
            { id: '102', name: 'Arroz Primor', barcode: '7591234567890' },
            { id: '2100123', name: 'Queso Paisa', barcode: '2100123' },
        ];

        it('resuelve el código del usuario cuando está con Bloq Mayús', () => {
            const raw = '/%)))%)====" #';
            const normalized = normalizeBarcode(raw, mockProducts);
            expect(normalized).toBe('7599959000023');
        });

        it('respeta la coincidencia directa si el código ya coincide', () => {
            const raw = '7591234567890';
            expect(normalizeBarcode(raw, mockProducts)).toBe('7591234567890');
        });

        it('convierte símbolos a números incluso si el producto no está en el catálogo', () => {
            const raw = '/%====!';
            // 7500001
            expect(normalizeBarcode(raw, mockProducts)).toBe('7500001');
        });

        it('mantiene texto alfanumérico si no es traducible a números', () => {
            expect(normalizeBarcode('harina pan', mockProducts)).toBe('harina pan');
        });
    });
});
