/**
 * check_cloud_schema.mjs — Detección de drift entre el esquema REAL de Supabase
 * y la allowlist del código (src/config/cloudSchema.js).
 *
 * Uso:
 *   node scripts/check_cloud_schema.mjs            # lee service key de ../estacion-maestra/.env.local
 *   CLOUD_SCHEMA_URL=... CLOUD_SCHEMA_KEY=... node scripts/check_cloud_schema.mjs
 *
 * Exit codes: 0 = sin drift · 1 = drift o error (útil para CI).
 */
import { readFileSync } from 'fs';

const envPath = new URL('../../estacion-maestra/.env.local', import.meta.url);
let SUPABASE_URL = process.env.CLOUD_SCHEMA_URL;
let SERVICE_KEY = process.env.CLOUD_SCHEMA_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    try {
        const env = readFileSync(envPath, 'utf8');
        const getUrl = (name) => (env.match(new RegExp('^' + name + '=(.*)$', 'm')) || [])[1]?.trim();
        SUPABASE_URL = SUPABASE_URL || getUrl('NEXT_PUBLIC_SUPABASE_URL') || getUrl('SUPABASE_URL');
        SERVICE_KEY = SERVICE_KEY || getUrl('SUPABASE_SERVICE_ROLE_KEY') || getUrl('SERVICE_ROLE_KEY');
    } catch {
        // sin .env.local: requiere variables de entorno
    }
}

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Faltan credenciales: configura CLOUD_SCHEMA_URL y CLOUD_SCHEMA_KEY o el .env.local de estacion-maestra.');
    process.exit(1);
}

// Allowlists espejo del esquema COMPLETO (deben coincidir con
// CLOUD_BACKUPS_COLUMNS / SYNC_DOCUMENTS_COLUMNS en src/config/cloudSchema.js).
// La comparación es contra el esquema completo, no solo el escribible.
const CLOUD_BACKUPS_COLUMNS = ['device_id', 'backup_data', 'updated_at', 'id', 'email', 'password_hash'];
const SYNC_DOCUMENTS_COLUMNS = ['device_id', 'collection', 'doc_id', 'data', 'updated_at', 'id', 'payload'];

const res = await fetch(`${SUPABASE_URL}/rest/v1/?select=*`, {
    headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/openapi+json',
    },
});

if (!res.ok) {
    console.error('No se pudo obtener el OpenAPI de Supabase:', res.status, (await res.text()).slice(0, 300));
    process.exit(1);
}

const spec = await res.json();
const definitions = spec.definitions || spec.components?.schemas || {};

let drift = false;

function checkTable(table, allowlist) {
    const def = definitions[table];
    if (!def) {
        console.error(`❌ ${table}: NO existe en el esquema real (¿renombrada o migración pendiente?).`);
        drift = true;
        return;
    }
    const realCols = Object.keys(def.properties || {}).sort();
    const allowed = [...allowlist].sort();

    const unexpected = realCols.filter(c => !allowed.includes(c));
    const missing = allowed.filter(c => !realCols.includes(c));

    if (unexpected.length === 0 && missing.length === 0) {
        console.log(`✅ ${table}: en sincronía (${realCols.length} columnas).`);
        return;
    }
    drift = true;
    if (unexpected.length > 0) {
        console.error(`❌ ${table}: columnas en la allowlist que NO existen en la tabla: ${unexpected.join(', ')}`);
        console.error('   → Actualiza src/config/cloudSchema.js (y el test de contrato).');
    }
    if (missing.length > 0) {
        console.error(`❌ ${table}: columnas en la allowlist que YA NO están en la tabla: ${missing.join(', ')}`);
        console.error('   → Actualiza src/config/cloudSchema.js y el test de contrato.');
    }
}

console.log('Comparando esquema real de Supabase con la allowlist del código...\n');
checkTable('cloud_backups', CLOUD_BACKUPS_COLUMNS);
checkTable('sync_documents', SYNC_DOCUMENTS_COLUMNS);

console.log('');
if (drift) {
    console.error('DRIFT DETECTADO: el código y la base de datos no coinciden.');
    process.exit(1);
}
console.log('Sin drift: el contrato de esquema se cumple.');
