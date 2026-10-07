// tests/provisionContract.test.js — Contrato del aprovisionamiento.
//
// F13/F14 (estático, determinista): el script provision-customer.mjs debe
// listar los 7 SQL en el orden exacto documentado — `supabase_pairing_setup.sql`
// ANTES de `001_device_own_row_rls.sql` porque sus políticas referencian
// `public.device_pairings` — cada archivo debe existir y ser idempotente
// (`IF NOT EXISTS` / `OR REPLACE`) para poder re-correr el provision.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRO_REPO = join(HERE, '..');
const SCRIPT = join(HERE, '..', 'scripts', 'provision-customer.mjs');
const HAS_LOCAL_PROVISIONER = existsSync(SCRIPT);

const EXPECTED_ORDER = [
    'supabase_cloud_schema.sql',
    'supabase_pairing_setup.sql',
    'supabase/migrations/001_device_own_row_rls.sql',
    'supabase/migrations/002_account_devices.sql',
    'supabase/migrations/003_my_account_device_ids.sql',
    'supabase/migrations/004_device_limit.sql',
    'supabase/customer-project/002_customer_additions.sql',
];

function readSchemaFiles() {
    const src = readFileSync(SCRIPT, 'utf8');
    const m = src.match(/const SCHEMA_FILES = \[([\s\S]*?)\];/);
    if (!m) throw new Error('no se encontró SCHEMA_FILES en provision-customer.mjs');
    return [...m[1].matchAll(/'([^']+\.sql)'/g)].map((x) => x[1]);
}

describe.skipIf(!HAS_LOCAL_PROVISIONER)('F13 — orden de los SQL de aprovisionamiento (requiere scripts/provision-customer.mjs)', () => {
    it('lista exactamente los 7 archivos en el orden documentado', () => {
        expect(readSchemaFiles()).toEqual(EXPECTED_ORDER);
    });

    it('pairing_setup va ANTES de 001 (sus políticas referencian device_pairings)', () => {
        const files = readSchemaFiles();
        const pairing = files.indexOf('supabase_pairing_setup.sql');
        const mig001 = files.indexOf('supabase/migrations/001_device_own_row_rls.sql');
        expect(pairing).toBeGreaterThanOrEqual(0);
        expect(mig001).toBeGreaterThan(pairing);
    });

    it('001 referencia device_pairings: el orden anterior es obligatorio, no cosmético', () => {
        const mig001 = readFileSync(
            join(PRO_REPO, 'supabase/migrations/001_device_own_row_rls.sql'),
            'utf8'
        );
        expect(mig001).toMatch(/device_pairings/);
    });
});

describe.skipIf(!HAS_LOCAL_PROVISIONER)('F14 — cada SQL existe y es idempotente (requiere scripts/provision-customer.mjs)', () => {
    for (const f of EXPECTED_ORDER) {
        it(`${f} existe`, () => {
            expect(existsSync(join(PRO_REPO, f))).toBe(true);
        });
    }

    it('todos usan IF NOT EXISTS u OR REPLACE (re-correr el provision es seguro)', () => {
        const offenders = [];
        for (const f of EXPECTED_ORDER) {
            const sql = readFileSync(join(PRO_REPO, f), 'utf8').toLowerCase();
            const hasCreate = /create\s+(table|function|policy|index|trigger|type|extension)/.test(sql);
            const idempotent =
                sql.includes('if not exists') || sql.includes('or replace');
            if (hasCreate && !idempotent) offenders.push(f);
        }
        expect(offenders).toEqual([]);
    });
});
