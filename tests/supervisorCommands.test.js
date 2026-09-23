import { describe, expect, it } from 'vitest';
import {
    AppliedCommandGuard,
    validateSupervisorCommand,
} from '../src/services/supervisorContracts';
import {
    buildSupervisorCommand,
    sendSupervisorCommand,
    shouldAwaitSupervisorAck,
    SUPERVISOR_COMMAND_TTL_MS,
    fetchPendingSupervisorCommands,
} from '../src/services/supervisorCommandService';

const baseCommand = (overrides = {}) => ({
    commandId: 'command-1234',
    type: 'supervisor.product.delete',
    monitorDeviceId: 'monitor-1',
    targetDeviceId: 'primary-1',
    issuedAt: 1_000,
    expiresAt: 50_000,
    payload: { productId: 'product-1' },
    ...overrides,
});

describe('Supervisor command contract', () => {
    it('acepta un comando dirigido dentro de su TTL', () => {
        const result = validateSupervisorCommand(baseCommand(), {
            targetDeviceId: 'primary-1',
            monitorDeviceId: 'monitor-1',
            now: 2_000,
        });
        expect(result).toEqual({ valid: true, error: null });
    });

    it('rechaza target o monitor diferentes', () => {
        expect(validateSupervisorCommand(baseCommand(), {
            targetDeviceId: 'primary-2',
            monitorDeviceId: 'monitor-1',
            now: 2_000,
        }).valid).toBe(false);
        expect(validateSupervisorCommand(baseCommand(), {
            targetDeviceId: 'primary-1',
            monitorDeviceId: 'monitor-2',
            now: 2_000,
        }).valid).toBe(false);
    });

    it('rechaza comandos vencidos, TTL largo o sin commandId', () => {
        expect(validateSupervisorCommand(baseCommand({ expiresAt: 100_000 }), {
            targetDeviceId: 'primary-1', monitorDeviceId: 'monitor-1', now: 2_000,
        }).valid).toBe(false);
        expect(validateSupervisorCommand(baseCommand({ expiresAt: 1_001 }), {
            targetDeviceId: 'primary-1', monitorDeviceId: 'monitor-1', now: 2_000,
        }).valid).toBe(false);
        expect(validateSupervisorCommand(baseCommand({ commandId: 'short' }), {
            targetDeviceId: 'primary-1', monitorDeviceId: 'monitor-1', now: 2_000,
        }).valid).toBe(false);
    });

    it('valida ingreso y egreso por lote con categoría de salida', () => {
        const valid = validateSupervisorCommand(baseCommand({
            type: 'supervisor.inventory.batch.adjust',
            payload: {
                direction: 'ingreso',
                productId: 'product-1',
                quantityInput: 2,
                inputUnit: 'cajas',
                unitsPerPackage: 24,
                expectedStock: 10,
                reason: 'Mercancía recibida',
                lotReference: 'LOTE-001',
            },
        }), {
            targetDeviceId: 'primary-1',
            monitorDeviceId: 'monitor-1',
            now: 2_000,
        });
        expect(valid.valid).toBe(true);

        const validEgress = validateSupervisorCommand(baseCommand({
            type: 'supervisor.inventory.batch.adjust',
            payload: {
                direction: 'egreso',
                productId: 'product-1',
                quantityInput: 1,
                inputUnit: 'unidades',
                unitsPerPackage: 1,
                expectedStock: 10,
                reasonCategory: 'merma',
                reason: 'Producto dañado',
            },
        }), {
            targetDeviceId: 'primary-1',
            monitorDeviceId: 'monitor-1',
            now: 2_000,
        });
        expect(validEgress.valid).toBe(true);

        const invalid = validateSupervisorCommand(baseCommand({
            type: 'supervisor.inventory.batch.adjust',
            payload: {
                direction: 'egreso',
                productId: 'product-1',
                quantityInput: 1,
                inputUnit: 'unidades',
                unitsPerPackage: 1,
                expectedStock: 10,
                reason: 'Producto dañado',
            },
        }), {
            targetDeviceId: 'primary-1',
            monitorDeviceId: 'monitor-1',
            now: 2_000,
        });
        expect(invalid.valid).toBe(false);
    });

    it('rechaza tipos y payloads no permitidos', () => {
        expect(validateSupervisorCommand(baseCommand({ type: 'supervisor.unknown' }), {
            targetDeviceId: 'primary-1', monitorDeviceId: 'monitor-1', now: 2_000,
        }).valid).toBe(false);
        expect(validateSupervisorCommand(baseCommand({ payload: {} }), {
            targetDeviceId: 'primary-1', monitorDeviceId: 'monitor-1', now: 2_000,
        }).valid).toBe(false);
    });

    it('rechaza una orden repetida mediante commandId', () => {
        let now = 2_000;
        const guard = new AppliedCommandGuard({ now: () => now });
        expect(guard.accept('command-1234', 50_000)).toBe(true);
        expect(guard.has('command-1234')).toBe(true);
        expect(guard.accept('command-1234', 50_000)).toBe(false);
        now = 60_000;
        expect(guard.has('command-1234')).toBe(false);
        expect(guard.accept('command-1234', 70_000)).toBe(true);
    });

    it('construye el envelope de comando con TTL y schema', () => {
        const command = buildSupervisorCommand({
            type: 'supervisor.product.delete',
            targetDeviceId: 'primary-1',
            monitorDeviceId: 'monitor-1',
            payload: { productId: 'product-1' },
            commandId: 'command-5678',
            now: 10_000,
        });
        expect(command).toMatchObject({
            commandId: 'command-5678',
            schemaVersion: 1,
            issuedAt: 10_000,
            expiresAt: 10_000 + SUPERVISOR_COMMAND_TTL_MS,
        });
    });

    it('no intenta red mientras las mutaciones están bloqueadas', async () => {
        const result = await sendSupervisorCommand({
            type: 'supervisor.product.delete',
            targetDeviceId: 'primary-1',
            payload: { productId: 'product-1' },
        });
        expect(result).toMatchObject({ ok: false, status: 'disabled' });
    });

    it('recupera órdenes pendientes al reconectar la caja', async () => {
        const calls = [];
        const query = {
            from(table) { calls.push(['from', table]); return this; },
            select(columns) { calls.push(['select', columns]); return this; },
            eq(column, value) { calls.push(['eq', column, value]); return this; },
            order(column, options) { calls.push(['order', column, options]); return this; },
            limit(value) { calls.push(['limit', value]); return Promise.resolve({ data: [], error: null }); },
        };

        await fetchPendingSupervisorCommands(query, 'primary-1');

        expect(calls).toEqual([
            ['from', 'supervisor_commands'],
            ['select', 'command_id,target_device_id,actor_auth_id,command_type,status,issued_at,expires_at,payload,schema_version'],
            ['eq', 'target_device_id', 'primary-1'],
            ['eq', 'status', 'pending'],
            ['order', 'issued_at', { ascending: true }],
            ['limit', 25],
        ]);
    });

    it('envía tasas como notificación sin esperar ACK visible', () => {
        expect(shouldAwaitSupervisorAck('supervisor.rate.set')).toBe(false);
        expect(shouldAwaitSupervisorAck('supervisor.inventory.batch.adjust')).toBe(true);
    });

    it('mantiene la tasa remota separada de las demás mutaciones', async () => {
        const result = await sendSupervisorCommand({
            type: 'supervisor.rate.set',
            targetDeviceId: 'primary-1',
            payload: { rateMode: 'euro', customRate: null },
        });
        expect(result).toMatchObject({ ok: false, status: 'disabled' });
    });
});
