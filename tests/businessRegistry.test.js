/**
 * businessRegistry.test.js — Registro de sedes (tombstones de eliminación).
 *
 * V2.1.57: el bug reportado en producción era que al borrar una sede y pulsar
 * "Buscar sedes en la nube" (o al sincronizar), la fila vieja publicada por
 * otra caja la revivía (el merge era unión por id sin memoria de borrados).
 * Ahora el documento lleva `deletedBusinesses` (tumbas) y el pull/buscar las
 * respetan: una sede borrada en cualquier equipo no vuelve.
 */
import { describe, it, expect } from 'vitest';
import {
    buildBusinessRegistryDoc,
    isValidBusinessRegistryDoc,
    mergeBusinessRegistry,
    mergeTombstones,
    pruneTombstoned,
    readTombstones,
    sanitizeTombstones,
} from '../src/utils/businessRegistry';

const BODEGA = { id: 'neg-1', nombre: 'bodega', rif: '', direccion: '', telefono: '', createdAt: '2026-10-01T00:00:00Z' };
const COSMETICOS = { id: 'neg-856cdc73', nombre: 'Cosmeticos', rif: '', direccion: '', telefono: '', createdAt: '2026-10-02T00:00:00Z' };

describe('buildBusinessRegistryDoc', () => {
    it('incluye deletedBusinesses cuando hay tumbas', () => {
        const doc = buildBusinessRegistryDoc([BODEGA], [{ id: COSMETICOS.id, deletedAt: '2026-10-07T00:00:00Z' }]);
        expect(doc.businesses).toHaveLength(1);
        expect(doc.deletedBusinesses).toEqual([{ id: COSMETICOS.id, deletedAt: '2026-10-07T00:00:00Z' }]);
    });

    it('no agrega deletedBusinesses si la lista está vacía o inválida', () => {
        expect(buildBusinessRegistryDoc([BODEGA]).deletedBusinesses).toBeUndefined();
        expect(buildBusinessRegistryDoc([BODEGA], []).deletedBusinesses).toBeUndefined();
        expect(isValidBusinessRegistryDoc(buildBusinessRegistryDoc([BODEGA], 'basura'))).toBe(true);
    });
});

describe('isValidBusinessRegistryDoc', () => {
    it('acepta documentos legacy sin tumbas', () => {
        const doc = buildBusinessRegistryDoc([BODEGA, COSMETICOS]);
        expect(isValidBusinessRegistryDoc(doc)).toBe(true);
    });

    it('acepta documentos con tumbas bien formadas', () => {
        const doc = buildBusinessRegistryDoc([BODEGA], [{ id: COSMETICOS.id, deletedAt: '2026-10-07T00:00:00Z' }]);
        expect(isValidBusinessRegistryDoc(doc)).toBe(true);
    });

    it('rechaza deletedBusinesses con tipo incorrecto o entradas inválidas', () => {
        const badType = buildBusinessRegistryDoc([BODEGA]);
        badType.deletedBusinesses = 'neg-1';
        expect(isValidBusinessRegistryDoc(badType)).toBe(false);

        const badEntry = buildBusinessRegistryDoc([BODEGA]);
        badEntry.deletedBusinesses = [{ sinId: true }];
        expect(isValidBusinessRegistryDoc(badEntry)).toBe(false);
    });
});

describe('tombstones: lectura, unión y prune', () => {
    it('readTombstones extrae y sanitiza (ignora entradas inválidas y duplicados)', () => {
        const doc = buildBusinessRegistryDoc([BODEGA], [
            { id: 'neg-a', deletedAt: '2026-10-07T01:00:00Z' },
            { id: 'neg-a' }, // duplicado
            { sinId: 1 },    // inválida
        ]);
        expect(readTombstones(doc)).toEqual([{ id: 'neg-a', deletedAt: '2026-10-07T01:00:00Z' }]);
        expect(readTombstones(null)).toEqual([]);
        expect(readTombstones({})).toEqual([]);
    });

    it('mergeTombstones une por id conservando la tumba más reciente', () => {
        const merged = mergeTombstones(
            [{ id: 'neg-a', deletedAt: '2026-10-06T00:00:00Z' }],
            [{ id: 'neg-a', deletedAt: '2026-10-07T00:00:00Z' }, { id: 'neg-b', deletedAt: '2026-10-07T01:00:00Z' }],
        );
        expect(merged).toHaveLength(2);
        expect(merged.find((t) => t.id === 'neg-a').deletedAt).toBe('2026-10-07T00:00:00Z');
    });

    it('pruneTombstoned elimina las sedes tumbadas y conserva el resto', () => {
        const pruned = pruneTombstoned(
            [BODEGA, COSMETICOS],
            [{ id: COSMETICOS.id, deletedAt: '' }],
        );
        expect(pruned).toEqual([BODEGA]);
        expect(pruneTombstoned([BODEGA], [])).toEqual([BODEGA]);
    });
});

describe('escenario de producción: sede borrada no revive con "Buscar sedes en la nube"', () => {
    it('el pull respeta la tumba aunque una fila vieja de otra caja traiga la sede', () => {
        // Local: el dueño borró "Cosmeticos" y publicó su doc con la tumba.
        const tumba = { id: COSMETICOS.id, deletedAt: '2026-10-07T03:00:00Z' };
        const docLocal = buildBusinessRegistryDoc([BODEGA], [tumba]);

        // Fila vieja de la otra caja (sin tumbas) que aún trae la sede borrada.
        const docViejo = buildBusinessRegistryDoc([BODEGA, COSMETICOS]);
        expect(isValidBusinessRegistryDoc(docViejo)).toBe(true);

        // Pull: unión de negocios + unión de tumbas + prune final.
        let merged = mergeBusinessRegistry([], docLocal);
        merged = mergeBusinessRegistry(merged, docViejo);
        const tombs = mergeTombstones(readTombstones(docLocal), readTombstones(docViejo));
        const final = pruneTombstoned(merged, tombs);

        expect(final.map((b) => b.nombre)).toEqual(['bodega']);
    });

    it('el revive explícito (misma id en un doc posterior sin tumba) sigue siendo posible vía prune local cero', () => {
        // La tumba solo desaparece si el usuario recrea la sede (crearNegocio la
        // saca de sedesEliminadas). Aquí validamos que el prune obedece al estado
        // local de tumbas: si el store ya no la tiene, la sede del remoto persiste.
        const merged = mergeBusinessRegistry([BODEGA], buildBusinessRegistryDoc([BODEGA, COSMETICOS]));
        const final = pruneTombstoned(merged, []);
        expect(final.map((b) => b.id)).toEqual([BODEGA.id, COSMETICOS.id]);
    });

    it('sanitizeTombstones tolera null/undefined y objetos raros', () => {
        expect(sanitizeTombstones(null)).toEqual([]);
        expect(sanitizeTombstones(undefined)).toEqual([]);
        expect(sanitizeTombstones([null, 42, { id: 'neg-x' }])).toEqual([{ id: 'neg-x', deletedAt: '' }]);
    });
});
