// E2E armature: rebuilds the device backup payload, uploads to cloud_backups
// (service-role, same as Estación Maestra api/backup/complete) and seeds
// sync_documents (the production P2P restore channel).
// Run from repo root: node preciosaldia-bodega/scripts/e2e_upload.mjs
import { readFileSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';

const envPath = new URL('../../estacion-maestra/.env.local', import.meta.url);
const env = readFileSync(envPath, 'utf8');
const getUrl = (name) => (env.match(new RegExp('^' + name + '=(.*)$', 'm')) || [])[1]?.trim();
const SUPABASE_URL = getUrl('NEXT_PUBLIC_SUPABASE_URL') || getUrl('SUPABASE_URL');
const SERVICE_KEY = getUrl('SUPABASE_SERVICE_ROLE_KEY') || getUrl('SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SERVICE key in estacion-maestra/.env.local');
    process.exit(1);
}

const DEVICE_ID = 'PDA-V2-397707D972EDAD7DB78763765FA6A090';

// ── Seed data (same fingerprint the browser seeded and snapshotted) ────────
const products = [
    { id: 'p1', name: 'Queso Blanco', stock: 55.5, unit: 'kg', packagingType: 'granel', price: 8.5, cost: 6 },
    { id: 'p2', name: 'Refresco Cola', stock: 24, unit: 'unidad', price: 1.2, cost: 0.8 },
    { id: 'p3', name: 'Aceite Girasol 1L', stock: 1.75, unit: 'litro', packagingType: 'granel', price: 3.1, cost: 2.4 },
];
const sales = [
    { id: 's1', timestamp: '2026-09-09T02:58:41.123Z', total: 2.975, items: [{ productId: 'p1', qty: 0.35, price: 8.5 }] },
    { id: 's2', timestamp: '2026-09-09T02:58:41.123Z', total: 1.2, items: [{ productId: 'p2', qty: 1, price: 1.2 }] },
];
const customers = [{ id: 'c1', name: 'Doña Elena', phone: '0412-5551234', balanceUsd: 12.5 }];
const categories = [{ id: 'cat1', name: 'Lácteos' }, { id: 'cat2', name: 'Bebidas' }];

const idb = {
    abasto_audit_log_v1: [],
    bodega_accounts_v2: [],
    bodega_customers_v1: customers,
    bodega_customer_ledger_v1: [],
    bodega_products_v1: products,
    bodega_sales_v1: sales,
    my_categories_v1: categories,
};
const ls = {
    allow_negative_stock: 'true',
    auto_cop_enabled: 'false',
    bodega_use_auto_rate: 'false',
    business_name: 'Bodega E2E Test',
    cop_enabled: 'false',
    cop_primary: 'usd',
    monitor_rates_v12: '{}',
    street_rate_bs: '79.75',
};

const backup = {
    timestamp: new Date().toISOString(),
    version: '2.0',
    appName: 'TasasAlDia_Bodegas_Cloud',
    data: { idb: idb, ls: ls },
};

const payloadToUpload = {
    compressed: true,
    version: '2.0',
    timestamp: backup.timestamp,
    appName: backup.appName,
    summary: {
        idbKeys: Object.keys(idb),
        lsKeys: Object.keys(ls),
        recordCount: Object.keys(idb).length + Object.keys(ls).length,
    },
    data: gzipSync(Buffer.from(JSON.stringify(backup), 'utf8')).toString('base64'),
};

const now = new Date().toISOString();

// ── 1. Upsert cloud_backups (service-role bypasses RLS) ─────────────────────
const res = await fetch(`${SUPABASE_URL}/rest/v1/cloud_backups?on_conflict=device_id`, {
    method: 'POST',
    headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([{ device_id: DEVICE_ID, backup_data: payloadToUpload, updated_at: now }]),
});
if (!res.ok) {
    console.error('UPLOAD_FAILED', res.status, (await res.text()).slice(0, 400));
    process.exit(1);
}

// ── 2. Read back cloud_backups (integrity of the stored row) ────────────────
const readRes = await fetch(`${SUPABASE_URL}/rest/v1/cloud_backups?device_id=eq.${DEVICE_ID}&select=backup_data,updated_at`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
});
const rows = await readRes.json();
const row = rows?.[0];
const rowBack = row?.backup_data;

let decompressedOk = false;
let decompressedProducts = null;
try {
    const buf = Buffer.from(rowBack.data, 'base64');
    const { gunzipSync } = await import('zlib');
    const parsed = JSON.parse(gunzipSync(buf).toString('utf8'));
    decompressedOk = parsed?.data?.idb?.bodega_products_v1?.length === 3;
    decompressedProducts = parsed?.data?.idb?.bodega_products_v1?.map(p => `${p.id}:${p.stock}`);
} catch (e) {
    decompressedOk = false;
}

// ── 3. Seed sync_documents (production restore channel for the device) ─────
const syncRows = [];
for (const [key, value] of Object.entries(idb)) {
    syncRows.push({ device_id: DEVICE_ID, collection: 'store', doc_id: key, data: { payload: value }, updated_at: now });
}
for (const [key, value] of Object.entries(ls)) {
    syncRows.push({ device_id: DEVICE_ID, collection: 'local', doc_id: key, data: { payload: value }, updated_at: now });
}
const syncRes = await fetch(`${SUPABASE_URL}/rest/v1/sync_documents?on_conflict=device_id,collection,doc_id`, {
    method: 'POST',
    headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(syncRows),
});
if (!syncRes.ok) {
    console.error('SYNC_SEED_FAILED', syncRes.status, (await syncRes.text()).slice(0, 400));
    process.exit(1);
}

const result = {
    uploadOk: true,
    deviceId: DEVICE_ID,
    cloudRow: {
        exists: !!rowBack,
        compressed: !!rowBack?.compressed,
        summary: rowBack?.summary || null,
        sizeChars: JSON.stringify(rowBack).length,
        updatedAt: row?.updated_at,
        decompressedOk,
        decompressedProducts,
    },
    syncDocumentsSeeded: syncRows.length,
};
writeFileSync(new URL('./e2e_upload_result.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
