// Prueba determinista v2.1.49: verifica que la fusión de TODAS las
// versiones del registro produce la unión correcta.
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS: ${name}`); }
    else { fail++; console.log(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`); }
};

console.log('=== Test: fusión con datos reales de Supabase ===');

// Datos REALES de Supabase (obtenidos 2026-10-04 20:10 UTC):
// - Secundario (20:10:44, más nuevo): solo neg-1
// - Principal (20:08:58): neg-1 + neg-856cdc73
const remotePayloads = [
    { businesses: [{ id: 'neg-1', nombre: 'bodega', rif: '', direccion: '', telefono: '', createdAt: '2026-10-04T17:55:49.403Z' }], updatedAt: '2026-10-04T20:10:44.372Z' },
    { businesses: [{ id: 'neg-1', nombre: 'Bodega', rif: '', direccion: '', telefono: '', createdAt: '2026-09-30T00:04:41.432Z' }, { id: 'neg-856cdc73', nombre: 'Cosmeticos', rif: '', direccion: '', telefono: '', createdAt: '2026-09-30T14:23:24.885Z' }], updatedAt: '2026-10-04T20:08:58.52Z' },
];

console.log(`  Versiones en la nube: ${remotePayloads.length}`);
remotePayloads.forEach((p, i) => {
    console.log(`    v${i + 1}: ${p.businesses.length} sedes (${p.businesses.map(b => b.nombre).join(', ')})`);
});

// Usar la función REAL del fuente
const testCode = `
import { mergeBusinessRegistry } from '/home/hatch/workspace/preciosaldia-multilocal/src/utils/businessRegistry.js';
const remotePayloads = ${JSON.stringify(remotePayloads)};
// Simular el teléfono: solo tiene 1 sede local
const localNegocios = [{ id: 'neg-1', nombre: 'bodega', rif: '', direccion: '', telefono: '', createdAt: '2026-10-04T17:55:49.403Z' }];
// Fusionar como lo hace pullBusinessRegistry v2.1.49 (TODAS las versiones)
let merged = [...localNegocios];
for (const payload of remotePayloads) {
    merged = mergeBusinessRegistry(merged, payload);
}
console.log(JSON.stringify({
    mergedCount: merged.length,
    mergedIds: merged.map(n => n.id).sort(),
    mergedNames: merged.map(n => n.nombre).sort(),
}));
`;
writeFileSync('/tmp/test_merge.mjs', testCode);
const result = JSON.parse(execSync('node /tmp/test_merge.mjs', { cwd: process.cwd(), encoding: 'utf8' }).trim());

console.log(`\n  Resultado fusión: ${result.mergedCount} sedes (${result.mergedNames.join(', ')})`);

check('La fusión produce 2 sedes (unión, no LWW)', result.mergedCount === 2, `obtuvo ${result.mergedCount}`);
check('Incluye neg-1 (Bodega)', result.mergedIds.includes('neg-1'));
check('Incluye neg-856cdc73 (Cosmeticos)', result.mergedIds.includes('neg-856cdc73'), 'la sede que no llegaba');

// Verificar que el código v2.1.49 trae TODAS las versiones (limit 10, no limit 1)
const syncSrc = readFileSync('src/hooks/useCloudSync.js', 'utf8');
const pullMatch = syncSrc.match(/export const pullBusinessRegistry = async \(\) => \{([\s\S]*?)\n\};/);
check('pullBusinessRegistry existe', !!pullMatch);
if (pullMatch) {
    check(
        'Trae múltiples versiones (limit 10)',
        pullMatch[1].includes('.limit(10)'),
        'Si es limit(1), solo trae la más nueva y pierde sedes'
    );
    check(
        'Fusiona en loop todas las versiones',
        pullMatch[1].includes('for (const row of data)'),
        'Sin loop, no hay unión'
    );
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
