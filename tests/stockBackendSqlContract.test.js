import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/candidates/stock_operations_candidate.sql';
async function readMigration() { return readFile(migrationPath, 'utf8'); }

describe('unapplied stock operations SQL candidate', () => {
    it('is explicitly a candidate, has no direct client grants, and leaves authorization closed', async () => {
        const sql = await readMigration();
        expect(sql).toMatch(/CANDIDATE ONLY: not applied/i);
        expect(sql).toMatch(/enable row level security/i);
        expect(sql).toMatch(/revoke all on public\.stock_operation_events from anon, authenticated/i);
        expect(sql).toMatch(/revoke all on public\.stock_operations from anon, authenticated/i);
        expect(sql).toMatch(/Deliberately no policies or RPC grants are created/i);
        expect(sql).not.toMatch(/create policy/i);
        expect(sql).not.toMatch(/grant execute/i);
    });

    it('declares operation-level idempotency, immutable variants and at most one void per sale', async () => {
        const sql = await readMigration();
        expect(sql).toMatch(/primary key \(account_id, business_id, epoch_id, event_kind, event_id\)/i);
        expect(sql).toMatch(/primary key \(account_id, business_id, epoch_id, operation_id\)/i);
        expect(sql).toMatch(/create table if not exists public\.stock_operation_conflicts/i);
        expect(sql).toMatch(/primary key \(account_id, business_id, epoch_id, sale_id\)/i);
        expect(sql).toMatch(/check \(event_kind = 'VOID'\)/i);
        expect(sql).toMatch(/numeric\(40, 0\)/i);
    });
});
