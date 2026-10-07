import { describe, expect, it } from 'vitest';
import { findBarcodeCollision } from '../src/utils/barcodeNormalizer';
import { IDB_KEYS, LS_KEYS, PROTECTED_KEYS } from '../src/config/backupKeys';

const products = [
    { id: 'p1', name: 'Harina PAN', barcode: '7591001001013' },
    { id: 'p2', name: 'Azúcar', barcode: '7591001001020' },
    { id: 'p3', name: 'Sin código', barcode: null },
];

describe('ALTO-7: findBarcodeCollision', () => {
    it('detecta un código idéntico en otro producto', () => {
        const c = findBarcodeCollision('7591001001013', products, null);
        expect(c?.name).toBe('Harina PAN');
    });

    it('no reporta el producto que se está editando', () => {
        expect(findBarcodeCollision('7591001001013', products, 'p1')).toBeNull();
    });

    it('no hay colisión con un código nuevo', () => {
        expect(findBarcodeCollision('7591001001999', products, null)).toBeNull();
    });

    it('código vacío no colisiona', () => {
        expect(findBarcodeCollision('', products, null)).toBeNull();
        expect(findBarcodeCollision('   ', products, null)).toBeNull();
        expect(findBarcodeCollision(null, products, null)).toBeNull();
    });

    it('detecta colisión vía des-shifteo (teclado ES escribe símbolos)', () => {
        // Producto con código numérico; el usuario tipea la variante con Shift.
        const prods = [{ id: 'a', name: 'Leche', barcode: '12345' }];
        // '!' es Shift+1 en ES/LATAM → "!2345" se resuelve a "12345".
        const c = findBarcodeCollision('!2345', prods, null);
        expect(c?.name).toBe('Leche');
    });

    it('detecta colisión contra el id del producto (el escáner también matchea ids)', () => {
        const c = findBarcodeCollision('p2', products, null);
        expect(c?.name).toBe('Azúcar');
    });
});

describe('ALTO-9: listas canónicas de backup completas', () => {
    it('IDB_KEYS incluye las ventas en espera', () => {
        expect(IDB_KEYS).toContain('bodega_pending_holds_v1');
    });

    it('LS_KEYS incluye tasas, redondeo, Cashea y reportes', () => {
        for (const k of [
            'bodega_rate_mode',
            'cashea_enabled',
            'cashea_min_amount',
            'checkout_bs_round_mode',
            'checkout_bs_round_step',
            'reportes_fiado_split',
            'reportes_reparacion_ledger',
            'receipt_currency_mode',
            'label_currency_mode',
        ]) {
            expect(LS_KEYS, k).toContain(k);
        }
    });

    it('las listas no contienen secretos ni sesión', () => {
        for (const k of [...IDB_KEYS, ...LS_KEYS]) {
            expect(k.startsWith('sb-')).toBe(false);
        }
        expect(LS_KEYS).not.toContain('pda_emergency_pin');
        expect(LS_KEYS).not.toContain('pda_cloud_session');
        expect(LS_KEYS).not.toContain('pda_device_id');
    });

    it('PROTECTED_KEYS no se pisa con las listas de backup', () => {
        for (const k of PROTECTED_KEYS) {
            expect(IDB_KEYS).not.toContain(k);
            expect(LS_KEYS).not.toContain(k);
        }
    });

    it('listas ordenadas alfabéticamente (diffs estables)', () => {
        const sorted = (arr) => [...arr].sort();
        expect([...IDB_KEYS]).toEqual(sorted(IDB_KEYS));
        expect([...LS_KEYS]).toEqual(sorted(LS_KEYS));
    });
});
