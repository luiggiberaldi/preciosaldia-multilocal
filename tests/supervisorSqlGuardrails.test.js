import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase_supervisor_auth_recovery.sql', 'utf8');
const commandSql = readFileSync('supabase_supervisor_commands.sql', 'utf8');
const inventoryBatchSql = readFileSync('supabase_supervisor_inventory_batch.sql', 'utf8');
const productionEgressSql = readFileSync('supabase_supervisor_inventory_egress_production.sql', 'utf8');
const commandReceiver = readFileSync('src/hooks/useRemoteCommands.js', 'utf8');

describe('Supervisor SQL guardrails', () => {
    it('no concede acceso directo a anon sobre datos del Supervisor', () => {
        expect(sql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.device_pairings\s+FROM\s+anon/i);
        expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.sync_documents\s+FROM\s+anon/i);
    });

    it('mantiene identidad Auth, consumo único y search_path en las RPC', () => {
        expect(sql).toContain('owner_auth_id uuid');
        expect(sql).toContain('monitor_auth_id uuid');
        expect(sql).toContain('token_used_at timestamptz');
        expect(sql).toContain('token_hash text');
        expect((sql.match(/SET search_path = public, extensions/g) || []).length).toBe(3);
        expect(sql).toContain('token_used_at IS NULL');
        expect(sql).toContain('OR revoked_at IS NOT NULL');
        expect(sql).not.toMatch(/CREATE POLICY\s+"sync_documents_anon_access"/i);
    });

    it('no reintroduce Broadcast público y exige RPC/RLS para comandos', () => {
        expect(commandReceiver).not.toContain('system_commands');
        expect(commandReceiver).not.toContain("channel.send");
        expect(commandSql).toContain('CREATE TABLE IF NOT EXISTS public.supervisor_commands');
        expect(commandSql).toContain('CREATE POLICY "supervisor_commands_authorized_read"');
        expect(commandSql).toContain('create_supervisor_command');
        expect(commandSql).toContain('ack_supervisor_command');
        expect(commandSql).toContain('schema_version');
        expect(commandSql).toContain('last_seen_at');
        expect(commandSql).toContain("p_payload->>'cierreId'");
        expect(commandSql).toContain("p_expires_at - p_issued_at > interval '60 seconds'");
        expect(commandSql).not.toContain("p_expires_at > now() + interval '60 seconds'");
        expect(commandReceiver).toContain('targetCierreId');
        expect(commandReceiver).toContain('Turno activo no encontrado');
        expect(commandReceiver).toContain('APPLIED_COMMANDS_KEY');
        expect(commandReceiver).toContain('applyInventoryBatchCommand');
        expect(commandSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect((commandSql.match(/SET search_path = public, extensions/g) || []).length).toBe(2);
    });

    it('mantiene la migración de ingreso por lote aditiva y cerrada', () => {
        expect(inventoryBatchSql).toContain('supervisor.inventory.batch.adjust');
        expect(inventoryBatchSql).toContain("p_payload->>'direction' NOT IN ('ingreso', 'egreso')");
        expect(inventoryBatchSql).toContain("p_payload->>'reasonCategory'");
        expect(inventoryBatchSql).toContain('DROP CONSTRAINT IF EXISTS');
        expect(inventoryBatchSql).toContain('ROLLBACK');
        expect(inventoryBatchSql).toContain('SET search_path = public, extensions');
        expect(inventoryBatchSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(inventoryBatchSql).not.toMatch(/DROP\s+TABLE/i);
    });

    it('mantiene la migración productiva de egreso con guardas y rollback', () => {
        expect(productionEgressSql).toContain("p_payload->>'direction' NOT IN ('ingreso', 'egreso')");
        expect(productionEgressSql).toContain("p_payload->>'reasonCategory' NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste')");
        expect(productionEgressSql).toContain("p_expires_at - p_issued_at > interval '60 seconds'");
        expect(productionEgressSql).toContain("p_expires_at <= now()");
        expect(productionEgressSql).toContain('monitor_auth_id = v_actor');
        expect(productionEgressSql).toContain('REVOKE ALL ON FUNCTION');
        expect(productionEgressSql).toContain('DROP TRIGGER IF EXISTS supervisor_income_pairing_guard');
        expect(productionEgressSql).toContain('CREATE OR REPLACE FUNCTION public.enforce_supervisor_income_command()');
        expect(productionEgressSql).toContain("NEW.payload->>'direction' = 'egreso'");
        expect(productionEgressSql).toContain("RAISE EXCEPTION 'Payload de ajuste por lote inválido'");
        expect(productionEgressSql).toContain('ROLLBACK');
        expect(productionEgressSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(productionEgressSql).not.toMatch(/DROP\s+TABLE/i);
    });
});
