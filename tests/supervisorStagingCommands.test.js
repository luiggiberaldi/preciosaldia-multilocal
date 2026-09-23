import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

const enabled = process.env.SUPERVISOR_STAGING_COMMANDS_E2E === 'true';
const stagingTest = enabled ? it : it.skip;
const STAGING_URL = 'https://tdfcpwctvumbdjmifypd.supabase.co';
const STAGING_REF = 'tdfcpwctvumbdjmifypd';
const TARGET_DEVICE_ID = 'e2e-primary-device';
const commandPrefix = `m2-e2e-${Date.now()}`;
const commandIds = [];

function readEnvValue(name) {
    const text = readFileSync('.env', 'utf8');
    return text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
}

function sqlLiteral(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

async function managementQuery(query) {
    const token = readEnvValue('SUPABASE_ACCESS_TOKEN');
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN ausente para el harness de staging');
    const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Management SQL staging: ${body.slice(0, 500)}`);
    return body ? JSON.parse(body) : [];
}

async function createAnonymousClient() {
    const key = readEnvValue('VITE_SUPABASE_STAGING_KEY');
    if (!key) throw new Error('VITE_SUPABASE_STAGING_KEY ausente para el harness de staging');
    const client = createClient(STAGING_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data?.user?.id) throw error || new Error('No se pudo crear identidad anónima de staging');
    return { client, userId: data.user.id };
}

function validPayload(expectedStock = 24) {
    return {
        direction: 'ingreso',
        productId: 'e2e-product-1',
        quantityInput: 2,
        inputUnit: 'cajas',
        unitsPerPackage: 24,
        expectedStock,
        reason: 'M2 staging sintético',
        lotReference: 'M2-LOT-001',
    };
}

async function createCommand(client, commandId, payload, expiresInMs = 30_000, commandType = 'supervisor.inventory.batch.adjust') {
    commandIds.push(commandId);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + expiresInMs);
    return client.rpc('create_supervisor_command', {
        p_command_id: commandId,
        p_target_device_id: TARGET_DEVICE_ID,
        p_command_type: commandType,
        p_payload: payload,
        p_issued_at: issuedAt.toISOString(),
        p_expires_at: expiresAt.toISOString(),
    });
}

async function readCommand(client, commandId) {
    const { data, error } = await client
        .from('supervisor_commands')
        .select('command_id,status,ack_payload,error_message')
        .eq('command_id', commandId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

describe('Supervisor M2 staging — ACK, NACK, timeout, replay y conflicto', () => {
    stagingTest('valida el ciclo autenticado sin tocar producción', async () => {
        const monitor = await createAnonymousClient();
        const primary = await createAnonymousClient();

        try {
            await managementQuery(`
                UPDATE public.device_pairings
                SET owner_auth_id = ${sqlLiteral(primary.userId)}::uuid,
                    monitor_auth_id = ${sqlLiteral(monitor.userId)}::uuid,
                    revoked_at = NULL,
                    paired_at = now()
                WHERE primary_device_id = ${sqlLiteral(TARGET_DEVICE_ID)};
            `);

            // La política general no depende de la allowlist temporal: un pairing
            // sintético activo debe poder crear el ingreso aunque el fixture esté
            // deshabilitado.
            await managementQuery(`
                UPDATE public.supervisor_canary_allowlist
                SET enabled = false, updated_at = now()
                WHERE primary_device_id = ${sqlLiteral(TARGET_DEVICE_ID)};
            `);
            const generalAccessId = `${commandPrefix}-general-pairing`;
            const generalAccess = await createCommand(monitor.client, generalAccessId, validPayload());
            expect(generalAccess.error).toBeNull();
            const generalAccessAck = await primary.client.rpc('ack_supervisor_command', {
                p_command_id: generalAccessId,
                p_status: 'applied',
                p_ack_payload: { unitsDelta: 48, stockAfter: 72 },
                p_error_message: null,
            });
            expect(generalAccessAck.error).toBeNull();
            expect(await readCommand(monitor.client, generalAccessId)).toMatchObject({ status: 'applied' });

            const appliedId = `${commandPrefix}-applied`;
            const appliedCreate = await createCommand(monitor.client, appliedId, validPayload());
            expect(appliedCreate.error).toBeNull();
            expect(appliedCreate.data).toMatchObject({ command_id: appliedId, status: 'pending' });

            const appliedAck = await primary.client.rpc('ack_supervisor_command', {
                p_command_id: appliedId,
                p_status: 'applied',
                p_ack_payload: { unitsDelta: 48, stockAfter: 72 },
                p_error_message: null,
            });
            expect(appliedAck.error).toBeNull();
            expect(await readCommand(monitor.client, appliedId)).toMatchObject({
                status: 'applied',
                ack_payload: { unitsDelta: 48, stockAfter: 72 },
            });

            const replayId = `${commandPrefix}-replay`;
            const firstReplay = await createCommand(monitor.client, replayId, validPayload());
            const secondReplay = await createCommand(monitor.client, replayId, validPayload());
            expect(firstReplay.error).toBeNull();
            expect(secondReplay.error).toBeNull();
            expect(secondReplay.data).toMatchObject({ command_id: replayId, status: 'pending' });

            const replayConflict = await createCommand(monitor.client, replayId, validPayload(999));
            expect(replayConflict.error?.message).toMatch(/command_id ya utilizado/i);

            const replayAck = await primary.client.rpc('ack_supervisor_command', {
                p_command_id: replayId,
                p_status: 'applied',
                p_ack_payload: { unitsDelta: 48 },
                p_error_message: null,
            });
            expect(replayAck.error).toBeNull();
            const replayAckAgain = await primary.client.rpc('ack_supervisor_command', {
                p_command_id: replayId,
                p_status: 'rejected',
                p_ack_payload: {},
                p_error_message: 'Replay de prueba',
            });
            expect(replayAckAgain.error).toBeNull();
            expect(replayAckAgain.data).toMatchObject({ command_id: replayId, status: 'applied' });

            const nackId = `${commandPrefix}-nack`;
            expect((await createCommand(monitor.client, nackId, validPayload(999))).error).toBeNull();
            const nack = await primary.client.rpc('ack_supervisor_command', {
                p_command_id: nackId,
                p_status: 'rejected',
                p_ack_payload: { reason: 'expectedStock conflict' },
                p_error_message: 'El stock cambió antes de aplicar',
            });
            expect(nack.error).toBeNull();
            expect(await readCommand(monitor.client, nackId)).toMatchObject({
                status: 'rejected',
                error_message: 'El stock cambió antes de aplicar',
            });

            const egressId = `${commandPrefix}-egress`;
            const egressCreate = await createCommand(monitor.client, egressId, {
                ...validPayload(),
                direction: 'egreso',
                reasonCategory: 'merma',
                reason: 'M4 staging: producto dañado',
            });
            expect(egressCreate.error?.message).toMatch(/Solo ingreso y tasas remotas están habilitados/i);
            expect(await readCommand(monitor.client, egressId)).toBeNull();

            const rateId = `${commandPrefix}-rate`;
            const rateCreate = await createCommand(monitor.client, rateId, {
                rateMode: 'manual',
                customRate: 123.45,
            }, 30_000, 'supervisor.rate.set');
            expect(rateCreate.error).toBeNull();
            const rateAck = await primary.client.rpc('ack_supervisor_command', {
                p_command_id: rateId,
                p_status: 'applied',
                p_ack_payload: { rateMode: 'manual', customRate: 123.45 },
                p_error_message: null,
            });
            expect(rateAck.error).toBeNull();
            expect(await readCommand(monitor.client, rateId)).toMatchObject({ status: 'applied' });

            const blockedFutureCommands = [
                ['supervisor.product.update', { productId: 'e2e-product-1', patch: { name: 'No aplicar' } }],
                ['supervisor.shift.close', { shiftId: 'shift-e2e', cierreId: 'cierre-e2e' }],
            ];
            for (const [commandType, payload] of blockedFutureCommands) {
                const blockedId = `${commandPrefix}-${commandType.split('.').pop()}`;
                const blocked = await createCommand(monitor.client, blockedId, payload, 30_000, commandType);
                expect(blocked.error?.message).toMatch(/Solo ingreso y tasas remotas están habilitados/i);
                expect(await readCommand(monitor.client, blockedId)).toBeNull();
            }

            const timeoutId = `${commandPrefix}-timeout`;
            expect((await createCommand(monitor.client, timeoutId, validPayload(), 700)).error).toBeNull();
            await new Promise(resolve => setTimeout(resolve, 1_200));
            const expiredAck = await primary.client.rpc('ack_supervisor_command', {
                p_command_id: timeoutId,
                p_status: 'applied',
                p_ack_payload: { unitsDelta: 48 },
                p_error_message: null,
            });
            expect(expiredAck.error).toBeNull();
            expect(expiredAck.data).toMatchObject({ command_id: timeoutId, status: 'failed' });
        } finally {
            if (commandIds.length > 0) {
                await managementQuery(`
                    DELETE FROM public.supervisor_commands
                    WHERE command_id IN (${commandIds.map(sqlLiteral).join(', ')});
                    UPDATE public.device_pairings
                    SET owner_auth_id = NULL,
                        monitor_auth_id = NULL
                    WHERE primary_device_id = ${sqlLiteral(TARGET_DEVICE_ID)};
                    UPDATE public.supervisor_canary_allowlist
                    SET enabled = true, updated_at = now()
                    WHERE primary_device_id = ${sqlLiteral(TARGET_DEVICE_ID)};
                `);
            }
            await monitor.client.auth.signOut();
            await primary.client.auth.signOut();
        }
    }, 30_000);

    afterAll(async () => {
        if (!enabled || commandIds.length === 0) return;
        await managementQuery(`
            DELETE FROM public.supervisor_commands
            WHERE command_id LIKE ${sqlLiteral(`${commandPrefix}%`)};
        `);
    });
});
