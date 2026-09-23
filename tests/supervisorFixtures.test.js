import { describe, expect, it } from 'vitest';
import { createSupervisorReadonlyFixture } from './fixtures/supervisorFixtures';
import {
    buildSupervisorInventoryMovements,
    buildSupervisorProductReport,
    filterSupervisorRecords,
} from '../src/services/supervisorReportData';

describe('Supervisor synthetic fixtures', () => {
    it('no contiene credenciales ni datos de producción y es determinista', () => {
        const first = createSupervisorReadonlyFixture();
        const second = createSupervisorReadonlyFixture();

        expect(first).toEqual(second);
        expect(first.deviceId).toContain('e2e-');
        expect(JSON.stringify(first)).not.toMatch(/token|password|pin|secret/i);
    });

    it('cubre dos cierres, ventas y movimientos por lote', () => {
        const fixture = createSupervisorReadonlyFixture();
        const firstClose = filterSupervisorRecords(fixture.records, { cierreId: 'close-fixture-1' });
        const movements = buildSupervisorInventoryMovements(firstClose);
        const products = buildSupervisorProductReport(firstClose);

        expect(firstClose.some(row => row.tipo === 'APERTURA_CAJA')).toBe(true);
        expect(firstClose.some(row => row.tipo === 'VENTA')).toBe(true);
        expect(movements).toHaveLength(2);
        expect(movements.some(row => row.inputUnit === 'bultos')).toBe(true);
        expect(movements.every(row => row.lotReference === 'LOTE-E2E-001')).toBe(true);
        expect(products).toHaveLength(1);
    });

    it('conserva el documento legacy para mostrarlo como incompleto', () => {
        const fixture = createSupervisorReadonlyFixture();
        const legacy = buildSupervisorInventoryMovements(fixture.records.filter(row => row.id === 'legacy-inventory'));

        expect(legacy).toHaveLength(1);
        expect(legacy[0].isIncomplete).toBe(true);
    });
});
