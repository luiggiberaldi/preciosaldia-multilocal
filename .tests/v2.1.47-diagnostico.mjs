// Prueba determinista: verifica la lógica de pullBusinessRegistry
// y el fix del teclado móvil.
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS: ${name}`); }
    else { fail++; console.log(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`); }
};

console.log('=== Test 1: pullBusinessRegistry existe y es independiente ===');
const syncSrc = readFileSync('src/hooks/useCloudSync.js', 'utf8');
check(
    'pullBusinessRegistry está exportada',
    syncSrc.includes('export const pullBusinessRegistry')
);
check(
    'pullBusinessRegistry NO usa getAccountSyncContext',
    (() => {
        const m = syncSrc.match(/export const pullBusinessRegistry = async \(\) => \{([\s\S]*?)\n\};/);
        return m && !m[1].includes('getAccountSyncContext');
    })()
);
check(
    'pullBusinessRegistry se llama al inicio de syncNow',
    syncSrc.includes('await pullBusinessRegistry()')
);
check(
    'App.jsx llama a pullBusinessRegistry al arrancar',
    readFileSync('src/App.jsx', 'utf8').includes('pullBusinessRegistry')
);

console.log('\n=== Test 2: Teclado móvil no debe aparecer ===');
const pinSrc = readFileSync('src/components/security/LoginPinModal.jsx', 'utf8');
check(
    'inputMode="none" en el input del PIN',
    pinSrc.includes('inputMode="none"')
);
// Verificar que NO se hace focus automático en dispositivos táctiles
const hasTouchCheck = pinSrc.includes('ontouchstart') ||
                      pinSrc.includes('maxTouchPoints') ||
                      pinSrc.includes('matchMedia') ||
                      pinSrc.includes('pointer: coarse');
check(
    'Hay detección de dispositivo táctil para evitar focus',
    hasTouchCheck,
    'Sin esto, el focus abre el teclado en móvil aunque inputMode sea none'
);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
