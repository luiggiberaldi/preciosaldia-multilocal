// Harness v2.1.35: validación de licencia post-CloudGate
// Extrae la lógica real de checkLicense (primer bloque sincrónico)

// Simular localStorage
const store = {};
global.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

// Lógica extraída de useSecurity.checkLicense (bloque sincrónico v2.1.35)
function checkSyncFlag() {
  try {
    if (localStorage.getItem('pda_pro_activated') === 'true') {
      return { isPremium: true };
    }
  } catch {}
  return { isPremium: false };
}

// TEST 1: flag presente → premium
localStorage.setItem('pda_pro_activated', 'true');
console.log('T1 flag true → premium:', checkSyncFlag().isPremium === true ? 'PASS' : 'FAIL');

// TEST 2: flag ausente → no premium (sigue al resto del flujo)
localStorage.removeItem('pda_pro_activated');
console.log('T2 sin flag → no premium:', checkSyncFlag().isPremium === false ? 'PASS' : 'FAIL');

// TEST 3: flag con otro valor → no premium
localStorage.setItem('pda_pro_activated', 'false');
console.log('T3 flag false → no premium:', checkSyncFlag().isPremium === false ? 'PASS' : 'FAIL');

// TEST 4: CloudGate setea los 3 flags (lógica extraída)
// Simula lo que hace CloudGate al completar
function cloudGateComplete() {
  try {
    localStorage.setItem('pda_pro_activated', 'true');
    localStorage.setItem('pda_account_linked', 'true');
  } catch {}
}
localStorage.removeItem('pda_pro_activated');
localStorage.removeItem('pda_account_linked');
cloudGateComplete();
console.log('T4 CloudGate setea flags:',
  localStorage.getItem('pda_pro_activated') === 'true' &&
  localStorage.getItem('pda_account_linked') === 'true' ? 'PASS' : 'FAIL');

// TEST 5: tras CloudGate, el check sincrónico da premium
console.log('T5 post-CloudGate → premium:', checkSyncFlag().isPremium === true ? 'PASS' : 'FAIL');

// TEST 6: botón "Ya tengo un código" limpia flags (lógica extraída de PremiumGuard)
function retryActivation() {
  try {
    localStorage.removeItem('pda_pro_activated');
    localStorage.removeItem('pda_account_linked');
  } catch {}
  return 'reload';
}
retryActivation();
console.log('T6 retry limpia flags:',
  localStorage.getItem('pda_pro_activated') === null &&
  localStorage.getItem('pda_account_linked') === null ? 'PASS' : 'FAIL');
