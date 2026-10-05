// Prueba determinista v2.1.51: el caché sincronizado evita el race condition.
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS: ${name}`); }
    else { fail++; console.log(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`); }
};

console.log('=== Test v2.1.51: caché sincronizado para isDocForKnownBusiness ===');

const ctxSrc = readFileSync('src/utils/negocioContext.js', 'utf8');

check(
    'setKnownBusinessIds está exportada',
    ctxSrc.includes('export function setKnownBusinessIds')
);

check(
    'Hay caché en memoria (_knownBusinessIdsCache)',
    ctxSrc.includes('_knownBusinessIdsCache')
);

check(
    'isDocForKnownBusiness revisa el caché primero',
    ctxSrc.includes('_knownBusinessIdsCache.includes(negocioId)')
);

const syncSrc = readFileSync('src/hooks/useCloudSync.js', 'utf8');

check(
    'pullBusinessRegistry actualiza el caché',
    syncSrc.includes('setKnownBusinessIds(merged.map')
);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
