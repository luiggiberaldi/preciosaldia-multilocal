/**
 * seedBrowserState.js — Estado inicial determinista para los e2e del checkout móvil.
 *
 * Estrategia (validada contra el código real):
 * - `useAuthStore.persist` se hidrata desde localStorage → se siembra
 *   `abasto-auth-storage` con un usuario ADMIN y `requireLogin: false`,
 *   más la sesión `abasto-device-session` ({ id:number, nombre, rol }).
 * - `useSecurity` solo acepta tokens firmados (SEC-001); la licencia premium
 *   se garantiza sembrando `pda_license_cache` (fallback offline legítimo del
 *   propio código cuando Supabase no responde) y bloqueando las RPC de
 *   licencia con page.route.
 * - `useSalesData` carga de IndexedDB (localforage) → productos, clientes,
 *   métodos de pago y APERTURA_CAJA se siembran ahí vía addInitScript.
 * - La tasa se fija con `bodega_rate_mode: 'manual'` + `bodega_custom_rate`,
 *   así la venta no depende de la red de tasas.
 * - Supabase/COP/rates: todo se neutraliza con page.route (2xx vacío o JSON
 *   mínimo) para que ningún flujo dependa de la nube.
 */

//──────────────────────────────────────────────────────────────────────────
// Datos de prueba
//──────────────────────────────────────────────────────────────────────────

const DEVICE_ID = 'PDA-V2-E2ECHECKOUT0000000000000000000000';
const RATE = 40; // Bs por USD — determinista para todas las aserciones

const TEST_PRODUCTS = [
    {
        id: 'p_cafe', name: 'Cafe E2E', category: 'abastos', stock: 50,
        costUsd: 1, priceUsd: 2, priceUsdt: 2, isWeight: false, barcode: 'E2ECAFE1',
    },
    {
        id: 'p_harina', name: 'Harina E2E', category: 'abastos', stock: 30,
        costUsd: 0.5, priceUsd: 1, priceUsdt: 1, isWeight: false, barcode: 'E2EHARI1',
    },
    {
        id: 'p_caraota', name: 'Caraota E2E', category: 'abastos', stock: 10,
        costUsd: 2, priceUsd: 5, priceUsdt: 5, isWeight: false, barcode: 'E2ECARAO1',
    },
];

const TEST_CUSTOMERS = [
    {
        id: 'cli_e2e_juan', code: 'CLI-00001', name: 'Juan E2E', documentId: '12345',
        phone: '', deuda: 0, favor: 18.5, createdAt: '2026-01-01T00:00:00.000Z',
    },
];

const TEST_PAYMENT_METHODS = [
    { id: 'efectivo_usd', label: 'Efectivo en Dólares', icon: '💲', currency: 'USD', isFactory: true, isEnabled: true },
    { id: 'efectivo_bs', label: 'Efectivo en Bolívares', icon: '💵', currency: 'BS', isFactory: true, isEnabled: true },
    { id: 'pago_movil', label: 'Pago Móvil', icon: '📱', currency: 'BS', isFactory: true, isEnabled: true },
];

//──────────────────────────────────────────────────────────────────────────
// Siembra de IndexedDB (corre en el navegador antes de que cargue la app)
//──────────────────────────────────────────────────────────────────────────

export const SEED_INDEXEDDB_SNIPPET = `
(function () { async function __seedLocalforage() {
    const DATA = {
        'bodega_products_v1': ${JSON.stringify(TEST_PRODUCTS)},
        'bodega_customers_v1': ${JSON.stringify(TEST_CUSTOMERS)},
        'bodega_payment_methods_v1': ${JSON.stringify(TEST_PAYMENT_METHODS)},
        // La caja abierta es la puerta del flujo e2e (CajaCerradaOverlay sin ella).
        'bodega_sales_v1': [{
            id: 'apertura_e2e_1', tipo: 'APERTURA_CAJA',
            openingUsd: 100, openingBs: 4000, openingCop: 0,
            timestamp: new Date().toISOString(), cajaCerrada: false,
        }],
    };
    // Borrar bases previas para partir de cero en cada test.
    const existing = await indexedDB.databases?.().catch(() => []) || [];
    for (const db of existing) {
        if (db && db.name) indexedDB.deleteDatabase(db.name);
    }
    const req = indexedDB.open('BodegaApp', 1);
    req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('bodega_app_data')) db.createObjectStore('bodega_app_data');
    };
    await new Promise((resolve, reject) => {
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('bodega_app_data', 'readwrite');
            const store = tx.objectStore('bodega_app_data');
            for (const [key, value] of Object.entries(DATA)) store.put(value, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
    });
}
__seedLocalforage().catch(e => console.error('[e2e-seed] IndexedDB', e));
})();
`;

//──────────────────────────────────────────────────────────────────────────
// Siembra de localStorage (licencia, sesión, tasas, config de features)
//──────────────────────────────────────────────────────────────────────────

export const SEED_LOCALSTORAGE_SNIPPET = `
(function __seedLocalStorage() {
    const LICENSE_CACHE = ${JSON.stringify({
        type: 'permanent',
        isActive: true,
        expiresAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        deviceId: DEVICE_ID,
        updatedAt: Date.now(),
    })};

    // Licencia: el fallback offline de useSecurity acepta esta caché cuando la
    // red de licencias está bloqueada por el test (comportamiento legítimo del
    // código productivo: "sin respuesta del servidor → usar caché offline").
    // NOTA: pda_device_id NO se siembra — SEC-008 revoca la licencia si el ID
    // guardado no coincide con el fingerprint calculado en runtime. La
    // licencia real llega vía el mock de get_license_status, que hace eco del
    // device_id que la app consulta.
    localStorage.setItem('pda_device_id', ${JSON.stringify(DEVICE_ID)});
    // Sin token RSA local: obliga al código a ir a la red, que responderá desde
    // la caché offline sembrada (el flujo real de una caja sin conexión).

    // Sesión local: ADMIN sin PIN (estructura validada por SEC-018/_validateSessionShape).
    const session = { id: 1, nombre: 'Administrador', rol: 'ADMIN' };
    localStorage.setItem('abasto-device-session', JSON.stringify(session));

    // Store de zustand persist (abasto-auth-storage): usuarios + requireLogin=false.
    // Los hashes son placeholders: verifyPin solo se invoca si alguien intenta loguear.
    const authStorage = {
        state: {
            usuarios: [{
                id: 1, nombre: 'Administrador', rol: 'ADMIN',
                pin: 'pbkdf2$sha256$100000$e2ee2eplaceholder$e2ee2eplaceholder',
            }],
            requireLogin: false,
            requireAdminPin: true,
            requireCajeroPin: true,
            failedAttempts: 0,
            lockUntil: null,
            consecutiveLockouts: 0,
            lastFailedAttemptTs: 0,
            adminEmail: null,
            isCloudConfigured: false,
        },
        version: 0,
    };
    localStorage.setItem('abasto-auth-storage', JSON.stringify(authStorage));

    // Tasa determinista: modo manual (fue el camino natural del flujo productivo).
    localStorage.setItem('bodega_rate_mode', 'manual');
    localStorage.setItem('bodega_custom_rate', String(${RATE}));
    localStorage.setItem('bodega_use_auto_rate', 'false');

    // Overlays que bloquean la vista la primera vez.
    localStorage.setItem('pda_terms_accepted', 'true');
    localStorage.setItem('pda_onboarding_done', 'true');

    // Checkout móvil explícito (aunque <1024px ya resuelve 'basic').
    localStorage.setItem('checkout_mode', 'basic');

    // Sin Cashea y sin COP para los tests base (los tests que los cubren los activan).
    localStorage.setItem('cashea_enabled', 'false');
    localStorage.setItem('cop_enabled', 'false');

    // UI estable: sin sonidos (autoplay puede interferir) ni avisos.
    localStorage.setItem('sounds_enabled', 'false');
})();
`;

//──────────────────────────────────────────────────────────────────────────
// Neutralización de red externa (page.route, se registra en cada test)
//──────────────────────────────────────────────────────────────────────────

/**
 * Bloquea/mockea todas las llamadas externas que no afectan al flujo de cobro:
 * - Supabase (ambos proyectos): auth + rest + realtime → respuestas vacías 2xx.
 *   * get_license_status/auto_register_device/heartbeat_device → []
 *   * Licencias REST: lista vacía (con la caché offline sembrada basta).
 * - Google Scripts de tasas → 200 vacío (usa DEFAULT_RATES pero el modo manual
 *   no las consulta).
 * - Fuentes/imágenes remotas → abort (más rápido).
 *
 * NO se mockean rutas de la app (http://127.0.0.1:4173).
 */
export async function neutralizeExternalNetwork(page) {
    const EMPTY_ARRAY = { data: [], error: null };
    const OK_JSON = {};

    await page.route('**/*', async (route) => {
        const url = route.request().url();

        // Dejar pasar todo lo local (dev server / preview / assets).
        if (url.startsWith('http://127.0.0.1:4173') || url.startsWith('http://localhost:4173')) {
            return route.continue();
        }

        // Supabase (ambos proyectos): auth/rest/realtime.
        if (url.includes('supabase.co') || url.includes('supabase.in')) {
            // get_license_status: eco del device_id consultado → licencia permanente.
            // Así la app es "premium" sin importar qué fingerprint genere SEC-008.
            if (url.includes('/rest/v1/rpc/get_license_status')) {
                let deviceIdEcho = '';
                try { deviceIdEcho = route.request().postDataJSON()?.p_device_id || ''; } catch { }
                const licenseRow = {
                    type: 'permanent', is_active: true, device_id: deviceIdEcho,
                    expires_at: null, created_at: '2026-01-01T00:00:00.000Z',
                };
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([licenseRow]) });
            }
            // Otras RPC de registro/heartbeat.
            if (url.includes('/rest/v1/rpc/')) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(true) });
            }
            if (url.includes('/rest/v1/')) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
            }
            if (url.includes('/auth/v1/')) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OK_JSON) });
            }
            // Realtime (websocket) → abortar; la app lo trata como sin red.
            return route.abort('blockedbyclient');
        }

        // Google Scripts de tasas / respaldos.
        if (url.includes('script.google.com') || url.includes('googleusercontent')) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OK_JSON) });
        }

        // DolarApi u otros de tasas.
        if (url.includes('dolarapi') || url.includes('exchangerate')) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        }

        // Fuentes e imágenes remotas → abort silencioso (más velocidad).
        if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
            return route.abort('blockedbyclient');
        }

        // Todo lo demás externo: continuar (el dev server de Vite puede pedir
        // recursos de node_modules vía el propio servidor local, ya cubierto).
        return route.continue();
    });
}
