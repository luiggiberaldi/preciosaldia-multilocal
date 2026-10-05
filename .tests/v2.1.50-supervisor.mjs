// Prueba determinista v2.1.50: el supervisor baja datos de TODAS las sedes.
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS: ${name}`); }
    else { fail++; console.log(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`); }
};

console.log('=== Test: isDocForKnownBusiness ===');
const ctxSrc = readFileSync('src/utils/negocioContext.js', 'utf8');

check(
    'isDocForKnownBusiness está exportada',
    ctxSrc.includes('export function isDocForKnownBusiness')
);

check(
    'Revisa el registro local para sedes conocidas',
    ctxSrc.includes('_readRegistryState()')
);

console.log('\n=== Test: pull usa isDocForKnownBusiness (no solo activa) ===');
const syncSrc = readFileSync('src/hooks/useCloudSync.js', 'utf8');

check(
    'Importa isDocForKnownBusiness',
    syncSrc.includes('isDocForKnownBusiness')
);

// Contar usos en paths de PULL (no debe quedar isDocForActiveBusiness en pulls)
const pullUsages = (syncSrc.match(/if\s*\(\s*!isDocForKnownBusiness\(doc\.doc_id\)\)/g) || []).length;
check(
    'Pulls usan isDocForKnownBusiness',
    pullUsages >= 3,
    `encontrados ${pullUsages}, esperados >=3`
);

console.log('\n=== Test: escritura namespaced para sedes no activas ===');
check(
    'Define nsGet/nsSet para namespace correcto',
    syncSrc.includes('const nsGet =') && syncSrc.includes('const nsSet =')
);
check(
    'nsKey construye nb_<id>:<key>',
    syncSrc.includes('`${NEGOCIO_KEY_PREFIX}${targetNegocioId}:${k}`')
);
check(
    'Detecta si es otra sede (isOtherBusiness)',
    syncSrc.includes('isOtherBusiness')
);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
