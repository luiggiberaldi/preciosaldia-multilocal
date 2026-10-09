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

const DEVICE_ID = "PDA-V2-E2EC0EC0000000000000000000000000";
const RATE = 40; // Bs por USD — determinista para todas las aserciones

const TEST_PRODUCTS = [
  {
    id: "p_cafe",
    name: "Cafe E2E",
    category: "abastos",
    stock: 50,
    costUsd: 1,
    priceUsd: 2,
    priceUsdt: 2,
    isWeight: false,
    barcode: "E2ECAFE1",
  },
  {
    id: "p_harina",
    name: "Harina E2E",
    category: "abastos",
    stock: 30,
    costUsd: 0.5,
    priceUsd: 1,
    priceUsdt: 1,
    isWeight: false,
    barcode: "E2EHARI1",
  },
  {
    id: "p_caraota",
    name: "Caraota E2E",
    category: "abastos",
    stock: 10,
    costUsd: 2,
    priceUsd: 5,
    priceUsdt: 5,
    isWeight: false,
    barcode: "E2ECARAO1",
  },
];

const TEST_CUSTOMERS = [
  {
    id: "cli_e2e_juan",
    code: "CLI-00001",
    name: "Juan E2E",
    documentId: "12345",
    phone: "",
    deuda: 0,
    favor: 18.5,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const TEST_PAYMENT_METHODS = [
  {
    id: "efectivo_usd",
    label: "Efectivo en Dólares",
    icon: "💲",
    currency: "USD",
    isFactory: true,
    isEnabled: true,
  },
  {
    id: "efectivo_bs",
    label: "Efectivo en Bolívares",
    icon: "💵",
    currency: "BS",
    isFactory: true,
    isEnabled: true,
  },
  {
    id: "pago_movil",
    label: "Pago Móvil",
    icon: "📱",
    currency: "BS",
    isFactory: true,
    isEnabled: true,
  },
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
    // Override de device_id para escenarios multi-dispositivo (window.__e2eDeviceId
    // lo inyecta el spec ANTES de este snippet vía un addInitScript previo). Si no
    // hay override, queda el ID por defecto. Debe tener formato legacy hex válido:
    // F1 conserva la identidad sembrada, sin recalcular fingerprint ni rotarla.
    const __deviceOverride = (typeof window !== 'undefined' && window.__e2eDeviceId) || null;
    const EFFECTIVE_DEVICE_ID = __deviceOverride || ${JSON.stringify(DEVICE_ID)};
    const LICENSE_CACHE = ${JSON.stringify({
      type: "permanent",
      isActive: true,
      expiresAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      deviceId: "__DEVICE_ID__",
      updatedAt: Date.now(),
    }).replace("__DEVICE_ID__", "' + EFFECTIVE_DEVICE_ID + '")};
    const PROJECT_CACHE = ${JSON.stringify({
      url: "https://e2e-local.invalid",
      key: "e2e-anon-key-never-used",
      code: "E2E-LOCAL",
    })};

    // Licencia: pda_pro_activated + pda_account_linked conceden premium en
    // checkLicense (useSecurity) sin red — flujo legítimo de un equipo ya
    // activado por CloudGate. La caché respalda el fallback offline.
    // pda_device_id: fixture legacy con formato hex válido. F1 conserva el ID
    // existente sin recalcular fingerprint ni sustituirlo. En multi-dispositivo
    // cada override es canónico y permanece igual tras recarga/cambio de sede.
    localStorage.setItem('pda_device_id', EFFECTIVE_DEVICE_ID);
    // Proyecto sintético requerido por el CloudGate: evita ir a licencia/directorio.
    // Las llamadas de red se interceptan antes de llegar a cualquier servicio externo.
    localStorage.setItem('pda_customer_project', JSON.stringify(PROJECT_CACHE));
    localStorage.setItem('pda_pro_activated', 'true');
    localStorage.setItem('pda_account_linked', 'true');
    localStorage.setItem('pda_license_cache', JSON.stringify(LICENSE_CACHE));

    // Sesión del dueño (V2.1.56): CloudGate entra en 'ready' solo si
    // getOwnerSession() ve una sesión NO anónima. auth.getSession() de
    // supabase-js es LOCAL (lee su propia clave de localStorage, sin red), así
    // que sembramos una sesión sintética válida: el gate se salta code/login.
    // La clave sigue el patrón sb-<host>-auth-token del proyecto sintético
    // (e2e-local.invalid → sb-e2e-local-auth-token). Nunca sale del navegador:
    // cualquier refresh contra .invalid se intercepta en neutralizeExternalNetwork.
    const SB_SESSION = ${JSON.stringify({
      access_token: "e2e-synthetic-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "e2e-synthetic-refresh-token",
      user: {
        id: "e2e-owner-user",
        aud: "authenticated",
        role: "authenticated",
        email: "dueno@e2e-local.invalid",
        is_anonymous: false,
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
      },
    })};
    localStorage.setItem('sb-e2e-local-auth-token', JSON.stringify(SB_SESSION));
    // Sin token RSA local: el premium viene de pda_pro_activated/pda_account_linked.

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
 * Neutraliza TODA la red externa: hermeticidad total de las pruebas.
 * - Loopback (dev server 4173 y servidores locales de escenarios) → pasa.
 * - *.invalid (Supabase sintético) → auth/RPC/REST con respuestas mínimas;
 *   get_license_status hace eco del device_id (licencia permanente).
 * - Cualquier otro https externo (supabase.co real incluido) → 200 '{}' vacío:
 *   ningún dato ni credencial real sale del navegador del test.
 *
 * NO se mockean rutas de la app (http://127.0.0.1:4173).
 */
export async function neutralizeExternalNetwork(page) {
  const OK_JSON = {};

  await page.route("**/*", async (route) => {
    const url = route.request().url();

    // 1) Todo lo local pasa sin tocar (dev server / assets / HMR).
    if (
      url.startsWith("http://127.0.0.1:4173") ||
      url.startsWith("http://localhost:4173")
    ) {
      return route.continue();
    }
    // Otros loopbacks: para escenarios locales explícitos contra su servidor.
    if (
      url.startsWith("http://127.0.0.1:") ||
      url.startsWith("http://localhost:")
    ) {
      return route.continue();
    }

    // 2) Supabase sintético (.invalid): respuestas mínimas coherentes.
    //    Este bloque va ANTES que cualquier fulfill genérico.
    if (url.includes(".invalid/")) {
      if (url.includes("/auth/v1/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(OK_JSON),
        });
      }
      if (url.includes("/rest/v1/rpc/get_license_status")) {
        // Eco del device_id consultado → licencia permanente.
        let deviceIdEcho = "";
        try {
          deviceIdEcho = route.request().postDataJSON()?.p_device_id || "";
        } catch {}
        const licenseRow = {
          type: "permanent",
          is_active: true,
          device_id: deviceIdEcho,
          expires_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([licenseRow]),
        });
      }
      if (url.includes("/rest/v1/rpc/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(true),
        });
      }
      if (url.includes("/rest/v1/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      }
      // Realtime (websocket) → abortar; la app lo trata como sin red.
      return route.abort("blockedbyclient");
    }

    // 3) Cualquier otro https EXTERNO se mockea vacío: hermeticidad total —
    //    ninguna prueba toca credenciales ni servicios reales (supabase.co
    //    incluido). La sesión/licencia ya viene sembrada localmente.
    if (url.startsWith("https://")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    }

    // Esquemas no http(s) (p.ej. ws:// inesperado) → abort.
    return route.abort("blockedbyclient");
  });
}
