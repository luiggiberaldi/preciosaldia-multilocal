/**
 * sync-multidispositivo.e2e.spec.js — Gate local multi-dispositivo SIN staging.
 *
 * Sustituye el "gate de staging" del plan maestro en este entorno: dos
 * contextos de navegador REALES sincronizan a través de un backend mock con
 * estado en el proceso Node (helpers/mockSupabaseCloud.js) que emula
 * sync_documents/account_devices/RPC con guardia tipo RLS. Nada sale del
 * proceso de pruebas.
 *
 * Escenarios:
 *  - Round-trip A→B: la venta creada en la Caja A llega a la Caja B por el
 *    canal real (push delta → pull con membresía activa → merge por id).
 *  - Bidireccional B→A: la tasa manual de B vuelve a A (LWW).
 *  - Replay/idempotencia: syncs repetidos NO crean filas nuevas en el
 *    servidor (hash-gating del cliente + upsert idempotente) ni duplican
 *    la venta en B (mergeSales).
 *  - Revocación fail-closed: con B revocado, syncNow/push fallan cerrado y
 *    el SERVIDOR (guardia RLS del mock) rechaza sus filas con 403.
 *  - Secretos: abasto-auth-storage jamás existe como documento en la nube.
 *  - Sedes: el CRUD real de useNegociosStore publica el registro global
 *    bodega_businesses_registry_v1, la otra caja lo descubre al sincronizar
 *    y ambos equipos convergen a EXACTAMENTE DOS sedes (sin duplicados
 *    ni ping-pong), manteniendo cada equipo su sede activa.
 *
 * Ejecutar: ./node_modules/.bin/playwright test tests/e2e/sync-multidispositivo.e2e.spec.js
 */
import { test, expect } from "@playwright/test";
import {
  createMockSupabaseBackend,
  routeMockSupabase,
} from "./helpers/mockSupabaseCloud";
import {
  SEED_INDEXEDDB_SNIPPET,
  SEED_LOCALSTORAGE_SNIPPET,
} from "./helpers/seedBrowserState";

// IDs hex canónicos EN MAYÚSCULAS (FP_VALID_ID_RE = ^PDA(?:-V2)?-[0-9A-F]{8,64}$):
// el fingerprint real los adopta por TOFU (continuidad de instalación sembrada)
// y cada contexto conserva su identidad ante el mismo UA. En minúsculas el regex
// los rechaza y SEC-008 re-fija el ID real (comportamiento esperado).
const DEVICE_A = "PDA-V2-" + "A1".repeat(16);
const DEVICE_B = "PDA-V2-" + "B2".repeat(16);

// Puente determinista hacia los módulos reales de la app (mismo singleton
// que usa el propio código productivo, resuelto por el dev server de Vite).
// __e2eSyncNow espera a que el initSync del arranque active el receptor
// (isCloudSyncActive) para no rebotar por una carrera de inicialización.
const BRIDGE_SNIPPET = `
window.__e2eLogs = [];
// HMR-SAFE (2026-10-07): resuelve la URL EXACTA con la que la app cargó un
// módulo (Vite añade ?t=<ts> tras editar código con el server vivo). Un import
// dinámico sin ?t= crearía una SEGUNDA instancia del módulo (estado propio:
// isCloudSyncActive, stores zustand) y los tests leerían/escribirían una copia
// muerta → "Sincronización no activa" fantasma. Buscar la URL real en los
// resource entries del navegador y caer al specifier pelado si aún no cargó.
window.__e2eImportApp = async (suffix) => {
  const urls = (performance.getEntriesByType("resource") || [])
    .map((r) => r.name)
    .filter((u) => u.includes(suffix));
  const url = urls[urls.length - 1] || suffix;
  return import(/* @vite-ignore */ url);
};
(() => {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const push = (lvl) => (...args) => {
    try {
      window.__e2eLogs.push(lvl + ": " + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)?.slice(0, 120))).join(" ").slice(0, 220));
      if (window.__e2eLogs.length > 400) window.__e2eLogs.splice(0, 200);
    } catch { /* noop */ }
    orig[lvl](...args);
  };
  console.log = push("log");
  console.warn = push("warn");
  console.error = push("error");
})();
window.__e2eSyncNow = async () => {
  const m = await window.__e2eImportApp('/src/hooks/useCloudSync.js');
  let last = null;
  for (let i = 0; i < 40; i++) {
    last = await m.syncNow();
    if (last && last.ok) return last;
    // Reintentar SOLO carreras de inicialización: un initSync re-corrido
    // (StrictMode/remount) desactiva isCloudSyncActive a mitad del sync y
    // el push falla con "Sync no activo" hasta que el re-init termina.
    // NO ampliar a /no activ/: matchearía "autorización activa"/"membresía
    // activa" de la revocación, que debe fallar rápido.
    if (last && !/Sync no activo|Sincronización no activa|no identific/i.test(last.message || '')) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
};
window.__e2ePush = async (key, value) => {
  const m = await window.__e2eImportApp('/src/hooks/useCloudSync.js');
  for (let i = 0; i < 40; i++) {
    const r = await m.pushCloudSync(key, value);
    if (!r || r.error !== 'Sync no activo') return r;
    await new Promise((res) => setTimeout(res, 500));
  }
  return { ok: false, error: 'Sync no activo (timeout de prueba)' };
};
`;

/**
 * Lee la lista namespaced de una clave en la IndexedDB (localforage) de una
 * página. Equivalente al readIdb del arnés de auditoría.
 */
function readNamespacedList(page, key) {
  return page.evaluate((k) => {
    const candidates = [`nb_neg-1:${k}`, k];
    return new Promise((resolve) => {
      const req = indexedDB.open("BodegaApp");
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("bodega_app_data")) {
          db.close();
          resolve(null);
          return;
        }
        const store = db
          .transaction("bodega_app_data", "readonly")
          .objectStore("bodega_app_data");
        const keysReq = store.getAllKeys();
        keysReq.onsuccess = () => {
          const all = keysReq.result || [];
          const found =
            candidates.find((c) => all.includes(c)) ||
            all.find((x) => typeof x === "string" && x.endsWith(`:${k}`));
          if (found === undefined) {
            db.close();
            resolve(null);
            return;
          }
          const get = store.get(found);
          get.onsuccess = () => {
            const v = get.result ?? null;
            db.close();
            resolve(v);
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        };
        keysReq.onerror = () => {
          db.close();
          resolve(null);
        };
      };
    });
  }, key);
}

/**
 * Lee el registro de sedes del store (useNegociosStore) de una página.
 * Devuelve total de sedes, id activo e ids presentes.
 */
function readRegistrySedes(page) {
  return page.evaluate(async () => {
    const { useNegociosStore } = await window.__e2eImportApp(
      "/src/hooks/store/useNegociosStore.js",
    );
    const st = useNegociosStore.getState();
    return {
      total: st.negocios.length,
      activoId: st.negocioActivoId,
      ids: st.negocios.map((n) => n.id),
    };
  });
}

test.describe.serial("gate local multi-dispositivo (sin staging)", () => {
  test.setTimeout(240_000); // dos arranques de app + flujo de cobro + polls
  let backend;
  let A, B;
  const openContexts = [];

  test.beforeEach(() => {
    backend = createMockSupabaseBackend();
  });

  test.afterEach(async () => {
    for (const c of openContexts) await c.close().catch(() => {});
    openContexts.length = 0;
    A = B = null;
  });

  async function launchDevice(
    browser,
    deviceId,
    alias,
    {
      seedData = true,
      preserveSeedOnReload = false,
      captureRealtimePull = false,
    } = {},
  ) {
    backend.registerDevice(DEVICE_A, { alias: "Caja A" });
    backend.registerDevice(DEVICE_B, { alias: "Caja B" });

    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      hasTouch: true,
      isMobile: true,
    });
    openContexts.push(context);
    const page = await context.newPage();
    // Orden de init scripts: identidad → semilla → puente de módulos → rutas.
    await page.addInitScript(
      `window.__e2eDeviceId = ${JSON.stringify(deviceId)};`,
    );
    if (preserveSeedOnReload) {
      const seedKey = `__e2e_seeded_${deviceId}`;
      await page.addInitScript(`
        window.__e2eShouldSeed = sessionStorage.getItem(${JSON.stringify(seedKey)}) !== "done";
        if (window.__e2eShouldSeed) sessionStorage.setItem(${JSON.stringify(seedKey)}, "done");
      `);
      await page.addInitScript(
        `if (window.__e2eShouldSeed) { ${SEED_LOCALSTORAGE_SNIPPET} }`,
      );
      if (seedData) {
        await page.addInitScript(
          `if (window.__e2eShouldSeed) { ${SEED_INDEXEDDB_SNIPPET} }`,
        );
      }
    } else {
      await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
      if (seedData) await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
    }
    if (captureRealtimePull) {
      await page.addInitScript(`
        window.__e2eRealtimePulls = 0;
        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
          if (delay === 100) {
            const wrapped = (...callbackArgs) => {
              window.__e2eRealtimePulls++;
              return callback(...callbackArgs);
            };
            return nativeSetTimeout(wrapped, delay, ...args);
          }
          return nativeSetTimeout(callback, delay, ...args);
        };
      `);
    }
    await page.addInitScript(`
      (() => {
          localStorage.setItem("pda_customer_project", JSON.stringify({
            url: "https://e2e-local.invalid",
            key: "e2e-anon-key-never-used",
            code: "E2E-LOCAL",
          }));
          const realtimeGlobal = typeof self !== "undefined" ? self : window;
          window.__e2eWebSocketDebug = [];
          const nativeWebSocket = window.WebSocket;
          window.__e2eRealtimeTransportDebug = realtimeGlobal.WebSocket === window.WebSocket;
          const RoutedWebSocket = new Proxy(nativeWebSocket, {
            construct(Target, args) {
              const originalUrl = String(args[0]);
              const socket = new Target(originalUrl, ...args.slice(1));
              const debug = { url: socketUrl, sent: [], received: [] };
              if (window.__e2eWebSocketDebug.length > 50) window.__e2eWebSocketDebug.shift();
              window.__e2eWebSocketDebug.push(debug);
              const nativeSend = socket.send.bind(socket);
              socket.send = (message) => {
                try {
                  const payload = JSON.parse(String(message));
                  const frame = Array.isArray(payload)
                    ? { event: payload[3], topic: payload[2] }
                    : payload;
                  debug.sent.push({ event: frame.event, topic: frame.topic });
                  if (frame.event === "phx_join")
                    window.__e2eRealtimeTopic = frame.topic;
                } catch {
                  /* binary/non-Phoenix frame */
                }
                return nativeSend(message);
              };
              socket.addEventListener("message", (event) => {
                try {
                  const payload = JSON.parse(String(event.data));
                  const frame = Array.isArray(payload)
                    ? { event: payload[3], payload: payload[4] }
                    : payload;
                  debug.received.push({ event: frame.event, payload: frame.payload });
                  if (
                    frame.event === "phx_reply" &&
                    frame.payload?.status === "ok" &&
                    frame.payload?.response?.postgres_changes
                  ) {
                    window.__e2eRealtimeSubscribed = true;
                  }
                } catch {
                  /* binary/non-Phoenix frame */
                }
              });
              return socket;
            },
          });
          realtimeGlobal.WebSocket = RoutedWebSocket;
          if (realtimeGlobal !== window) window.WebSocket = RoutedWebSocket;
          window.__e2eRealtimeWebSocket = RoutedWebSocket;
        })();
      `);
    await page.addInitScript(BRIDGE_SNIPPET);

    await routeMockSupabase(page, backend);
    await page.goto("/");
    await expect(
      page.locator('[data-tour="tab-inicio"]'),
      `${alias}: la app arranca sin CloudGate`,
    ).toBeVisible({ timeout: 45_000 });
    // El fingerprint real (SEC-008) adoptó el ID sembrado y lo ancló.
    await expect
      .poll(
        async () => page.evaluate(() => localStorage.getItem("pda_device_id")),
        {
          timeout: 20_000,
        },
      )
      .toBe(deviceId);
    return { context, page };
  }

  /** Espera a que la app empuje el delta/venta del día y devuelve la fila servida. */
  async function expectDocFrom(backend, deviceId, fragment, timeout = 40_000) {
    await expect
      .poll(
        async () =>
          backend.docsFrom(deviceId).some((d) => d.doc_id.includes(fragment)),
        `el backend debe tener un doc de ${deviceId} que contenga "${fragment}"`,
        { timeout },
      )
      .toBe(true);
    return backend.docsFrom(deviceId).find((d) => d.doc_id.includes(fragment));
  }

  test("round-trip A→B: la venta de la Caja A llega a la Caja B", async ({
    browser,
  }) => {
    A = await launchDevice(browser, DEVICE_A, "Caja A");
    await expectDocFrom(backend, DEVICE_A, "bodega_"); // el push del arranque está activo

    // Venta real en la UI de A: cobro exacto $2 (Cafe E2E), flujo móviles.
    // Vender es lazy: su chunk compila al primer acceso (y vite puede recargar
    // a mitad); reintentar la pestaña como hace el arnés de auditoría.
    let salesReady = false;
    for (let intento = 0; intento < 4 && !salesReady; intento++) {
      await A.page.locator('[data-tour="tab-ventas"]').click();
      try {
        await A.page
          .getByPlaceholder("Buscar producto...")
          .waitFor({ state: "visible", timeout: 20_000 });
        salesReady = true;
      } catch {
        /* montaje lento o recarga: reintentar */
      }
    }
    expect(salesReady, "Vender montó el buscador").toBe(true);
    await expect(
      A.page.getByRole("heading", { name: "Caja Cerrada" }),
    ).toHaveCount(0, { timeout: 15_000 });
    const search = A.page.getByPlaceholder("Buscar producto...");
    await search.fill("Cafe E2E");
    await search.press("Enter");
    await A.page.getByText("Ver Cesta", { exact: true }).click();
    await A.page.getByRole("button", { name: /COBRAR/ }).click();
    await expect(A.page.getByRole("heading", { name: "COBRAR" })).toBeVisible();
    await A.page
      .locator('input[inputmode="decimal"][placeholder="0.00"]')
      .first()
      .fill("2.00");
    await A.page
      .getByRole("button", {
        name: /CONFIRMAR VENTA|INGRESA LOS PAGOS/,
      })
      .click();
    await expect(A.page.getByText("Tasa BCV Aplicada")).toBeVisible({
      timeout: 15_000,
    });

    // Push del delta del día (canal real).
    await A.page.evaluate(() => window.__e2eSyncNow());
    const deltaDoc = await expectDocFrom(
      backend,
      DEVICE_A,
      "bodega_sales_delta_",
    );

    // B arranca con la nube ya poblada: su pull inicial trae el delta de A.
    B = await launchDevice(browser, DEVICE_B, "Caja B", { seedData: false });
    const bSync = await B.page.evaluate(() => window.__e2eSyncNow());
    expect(
      bSync?.ok,
      `syncNow de B debe ser exitoso: ${bSync?.message ?? ""}`,
    ).toBe(true);

    // La venta de A está en B (fusionada por id, no LWW).
    await expect
      .poll(
        async () => {
          const sales = await readNamespacedList(B.page, "bodega_sales_v1");
          return (sales || []).some(
            (s) =>
              s?.totalUsd === 2 &&
              s?.tipo === "VENTA" &&
              !s?.tipo?.includes("ANULADA"),
          );
        },
        "la venta de $2 de A debe llegar a B por el canal de sync",
        { timeout: 40_000 },
      )
      .toBe(true);

    // Y el documento del delta existe en el servidor con el device_id de A.
    expect(deltaDoc.device_id).toBe(DEVICE_A);
  });

  test("Realtime propaga tasa y stock sin F5; reload y replay conservan el estado", async ({
    browser,
  }) => {
    A = await launchDevice(browser, DEVICE_A, "Caja A", {
      preserveSeedOnReload: true,
      captureRealtimePull: true,
    });
    B = await launchDevice(browser, DEVICE_B, "Caja B");
    await B.page.waitForTimeout(2_000);
    await B.page.evaluate(() => window.__e2eSyncNow());
    await expect
      .poll(
        () =>
          backend.realtimeSocketUrls.some((url) =>
            url.includes("/realtime/v1/websocket"),
          ),
        `Realtime websocket URL observadas: ${JSON.stringify(backend.realtimeSocketUrls)}`,
        { timeout: 15_000 },
      )
      .toBe(true);

    // Garantizar una revisión base de A antes de que B publique su cambio.
    const aPushRate = await A.page.evaluate(() =>
      window.__e2ePush("bodega_custom_rate", "40"),
    );
    expect(
      aPushRate?.ok,
      `push de la tasa inicial de A: ${aPushRate?.error ?? ""}`,
    ).toBe(true);
    await expectDocFrom(backend, DEVICE_A, "bodega_custom_rate");

    // A y B mantienen la vista de inventario abierta con el mismo catálogo.
    await A.page.locator('[data-tour="tab-catalogo"]').click();
    await B.page.locator('[data-tour="tab-catalogo"]').click();
    await expect(A.page.getByText("Cafe E2E", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(B.page.getByText("Cafe E2E", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const cafeCardA = A.page
      .locator("div.select-none")
      .filter({ has: A.page.getByText("Cafe E2E", { exact: true }) })
      .first();
    const cafeCardB = B.page
      .locator("div.select-none")
      .filter({ has: B.page.getByText("Cafe E2E", { exact: true }) })
      .first();
    await expect(cafeCardA).toBeVisible({ timeout: 30_000 });
    await expect(cafeCardB).toBeVisible({ timeout: 30_000 });
    await expect(
      cafeCardA.locator('button[title="Toca para editar el stock"]'),
    ).toHaveText("50");
    await expect(
      cafeCardB.locator('button[title="Toca para editar el stock"]'),
    ).toHaveText("50");

    // B modifica la tasa desde el panel real de ventas, como lo haría el usuario.
    await B.page.locator('[data-tour="tab-ventas"]').click();
    await expect(
      B.page.getByPlaceholder("Ingresa la tasa manual (ej: 42.50)"),
    ).toHaveCount(0);
    await expect(B.page.getByRole("button", { name: /40,00 MAN/ })).toBeVisible(
      { timeout: 30_000 },
    );
    await B.page.getByRole("button", { name: /40,00 MAN/ }).click();
    const rateInput = B.page.getByPlaceholder(
      "Ingresa la tasa manual (ej: 42.50)",
    );
    await expect(rateInput).toBeVisible();
    await rateInput.fill("41.5");
    await B.page.getByRole("button", { name: "Aceptar" }).click();
    await expect
      .poll(
        () => B.page.evaluate(() => localStorage.getItem("bodega_custom_rate")),
        {
          timeout: 10_000,
        },
      )
      .toBe("41.5");
    await expect
      .poll(
        () =>
          backend
            .docsFrom(DEVICE_B)
            .some(
              (row) =>
                row.doc_id.includes("bodega_custom_rate") &&
                row.data?.payload === "41.5",
            ),
        "la tasa confirmada de B queda en el backend simulado",
        { timeout: 30_000 },
      )
      .toBe(true);

    // A permanece abierta. Esperamos a que el sync explícito obtenga el doc
    // autorizado de B y lo aplique localmente.
    const timeOriginBefore = await A.page.evaluate(
      () => performance.timeOrigin,
    );
    const urlBefore = A.page.url();
    await expect
      .poll(
        () => A.page.evaluate(() =>
          localStorage.getItem("bodega_custom_rate"),
        ),
        "Realtime propaga la tasa publicada por B a A",
        { timeout: 30_000 },
      )
      .toBe("41.5");
    expect(await A.page.evaluate(() => performance.timeOrigin)).toBe(
      timeOriginBefore,
    );
    expect(A.page.url()).toBe(urlBefore);

    // Cambiar stock desde el control de producto en B (persistencia + cola cloud reales).
    await B.page.locator('[data-tour="tab-catalogo"]').click();
    await expect(
      cafeCardB.locator('button[title="Toca para editar el stock"]'),
    ).toHaveText("50");
    await cafeCardB
      .locator('button[title="Toca para editar el stock"]')
      .click();
    const stockInput = cafeCardB.locator('input[type="number"]');
    await stockInput.fill("47");
    await stockInput.press("Enter");
    await expect(
      cafeCardB.locator('button[title="Toca para editar el stock"]'),
    ).toHaveText("47");
    await expect
      .poll(
        () =>
          backend
            .docsFrom(DEVICE_B)
            .some(
              (row) =>
                row.doc_id.includes("bodega_stock_v1") &&
                row.data?.payload?.p_cafe === 47,
            ),
        "el mapa de stock modificado por B se publica",
        { timeout: 40_000 },
      )
      .toBe(true);

    // El evento Realtime de B hace que A baje el stock mientras sigue abierta.
    await expect(
      cafeCardA.locator('button[title="Toca para editar el stock"]'),
    ).toHaveText("47", { timeout: 30_000 });
    expect(await A.page.evaluate(() => performance.timeOrigin)).toBe(
      timeOriginBefore,
    );

    // Replay de ambos equipos no debe duplicar filas ni volver a aplicar el delta.
    const docsBeforeReplay = new Set(backend.syncDocuments.keys());
    const aStockBeforeReplay = await readNamespacedList(
      A.page,
      "bodega_products_v1",
    );
    const bStockBeforeReplay = await readNamespacedList(
      B.page,
      "bodega_products_v1",
    );
    expect(aStockBeforeReplay.find((p) => p.id === "p_cafe")?.stock).toBe(47);
    expect(bStockBeforeReplay.find((p) => p.id === "p_cafe")?.stock).toBe(47);
    const aReplay = await A.page.evaluate(() => window.__e2eSyncNow());
    const bReplay = await B.page.evaluate(() => window.__e2eSyncNow());
    expect(aReplay?.ok).toBe(true);
    expect(bReplay?.ok).toBe(true);
    expect(
      [...backend.syncDocuments.keys()].filter(
        (key) => !docsBeforeReplay.has(key),
      ),
      "el replay no crea nuevas claves de documento",
    ).toEqual([]);
    await expect
      .poll(
        async () =>
          (await readNamespacedList(A.page, "bodega_products_v1")).find(
            (p) => p.id === "p_cafe",
          )?.stock,
        "stock de A tras replay",
        { timeout: 20_000 },
      )
      .toBe(47);
    await expect
      .poll(
        async () =>
          (await readNamespacedList(B.page, "bodega_products_v1")).find(
            (p) => p.id === "p_cafe",
          )?.stock,
        "stock de B tras replay",
        { timeout: 20_000 },
      )
      .toBe(47);

    // Reload real: no se vuelve a ejecutar la semilla; el valor local aplicado
    // persiste y el pull de arranque/replay no lo modifica por segunda vez.
    await A.page.reload();
    const inventoryTab = A.page.locator('[data-tour="tab-catalogo"]');
    await expect(inventoryTab).toBeVisible({ timeout: 45_000 });
    await inventoryTab.click();
    const reloadedCafe = A.page
      .locator("div.select-none")
      .filter({ has: A.page.getByText("Cafe E2E", { exact: true }) })
      .first();
    await expect(reloadedCafe).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () => A.page.evaluate(() => localStorage.getItem("bodega_custom_rate")),
        {
          timeout: 20_000,
        },
      )
      .toBe("41.5");
    await expect
      .poll(
        () =>
          readNamespacedList(A.page, "bodega_products_v1").then(
            (products) => products?.find((p) => p.id === "p_cafe")?.stock,
          ),
        "stock guardado en IndexedDB tras reload",
        { timeout: 20_000 },
      )
      .toBe(47);
    const afterReload = await A.page.evaluate(() => window.__e2eSyncNow());
    expect(afterReload?.ok).toBe(true);
    await expect
      .poll(
        () =>
          readNamespacedList(A.page, "bodega_products_v1").then(
            (products) => products?.find((p) => p.id === "p_cafe")?.stock,
          ),
        "stock tras replay post-reload",
        { timeout: 20_000 },
      )
      .toBe(47);
    await expect(
      reloadedCafe.locator('button[title="Toca para editar el stock"]'),
    ).toHaveText("47");

    // Tras el reload también se permite el push de arranque del dispositivo;
    // verificar replay idempotente desde este punto ya asentado.
    const docsAfterReload = new Set(backend.syncDocuments.keys());
    const replayAfterReload = await A.page.evaluate(() =>
      window.__e2eSyncNow(),
    );
    expect(replayAfterReload?.ok).toBe(true);
    expect(
      [...backend.syncDocuments.keys()].filter(
        (key) => !docsAfterReload.has(key),
      ),
      "el replay posterior al reload no duplica documentos",
    ).toEqual([]);
  });

  test("sedes: crear en B, descubrir en A y exactamente dos sedes en ambos equipos", async ({
    browser,
  }) => {
    A = await launchDevice(browser, DEVICE_A, "Caja A");
    await A.page.waitForTimeout(2_000);
    await A.page.evaluate(() => window.__e2eSyncNow());
    B = await launchDevice(browser, DEVICE_B, "Caja B", { seedData: false });
    await B.page.waitForTimeout(2_000);
    await B.page.evaluate(() => window.__e2eSyncNow());

    // B crea una sede por el CRUD real de useNegociosStore: el store publica
    // el doc global bodega_businesses_registry_v1 vía queueCloudSync (el
    // mismo camino del botón "Publicar sedes ahora").
    const created = await B.page.evaluate(async () => {
      const { useNegociosStore } = await window.__e2eImportApp(
        "/src/hooks/store/useNegociosStore.js",
      );
      return useNegociosStore.getState().crearNegocio({
        nombre: "Sede B E2E",
        rif: "J-40222333-9",
      });
    });
    expect(created?.ok, `crearNegocio en B: ${created?.error ?? ""}`).toBe(
      true,
    );

    // El registro sale de B por el canal real (doc global: sin prefijo).
    await expectDocFrom(backend, DEVICE_B, "bodega_businesses_registry_v1");

    // A lo descubre al sincronizar (pullBusinessRegistry fusiona por id) y
    // conserva su sede activa (cada equipo mantiene su sede).
    const aSync = await A.page.evaluate(() => window.__e2eSyncNow());
    expect(
      aSync?.ok,
      `syncNow de A con registro de sedes: ${aSync?.message ?? ""}`,
    ).toBe(true);
    await expect
      .poll(
        async () => readRegistrySedes(A.page),
        "la Sede B E2E debe aparecer en A tras el sync",
        { timeout: 40_000 },
      )
      .toMatchObject({ total: 2, activoId: "neg-1" });

    // B tiene exactamente dos sedes.
    const sedesB = await readRegistrySedes(B.page);
    expect(sedesB.total, "B debe tener exactamente dos sedes").toBe(2);

    // En la UI de A: Ajustes → sección Negocio → selector de sedes, con
    // exactamente dos filas (la activa, title "Negocio activo", y la
    // descubierta, title "Cambiar a …"). Solo el dueño global (rol "DUENO")
    // ve "Mis Sedes": la semilla del gate es administrador del negocio y ese
    // rol nunca cuelga de usuarios del negocio (es solo sesión global).
    // Promover la sesión activa en el store (re-render en vivo, sin
    // recarga). La vista es diferida: reintentar la pestaña como hace la
    // auditoría.
    const promoted = await A.page.evaluate(async () => {
      const { useAuthStore } = await window.__e2eImportApp(
        "/src/hooks/store/useAuthStore.js",
      );
      const st = useAuthStore.getState();
      useAuthStore.setState({
        usuarioActivo: {
          ...(st.usuarioActivo ?? { id: 1, nombre: "Administrador" }),
          rol: "DUENO",
        },
      });
      return useAuthStore.getState().usuarioActivo?.rol === "DUENO";
    });
    expect(promoted, "sesión promovida a dueño global").toBe(true);
    let ajustesListos = false;
    for (let intento = 0; intento < 4 && !ajustesListos; intento++) {
      await A.page.locator('[data-tour="tab-ajustes"]').click();
      try {
        await A.page
          .getByRole("button", { name: "Negocio", exact: true })
          .first()
          .waitFor({ state: "visible", timeout: 20_000 });
        ajustesListos = true;
      } catch {
        /* chunk compilando o recarga: reintentar */
      }
    }
    expect(ajustesListos, "Ajustes montó sus secciones").toBe(true);
    await A.page
      .getByRole("button", { name: "Negocio", exact: true })
      .first()
      .click();
    const pill = A.page
      .locator('button[title="Cambiar o gestionar negocios"]')
      .first();
    await expect(
      pill,
      "el selector de sedes es visible en Ajustes",
    ).toBeVisible();
    await pill.click();
    await expect(A.page.getByText("Mis negocios")).toBeVisible();
    await expect(
      A.page.locator('button[title="Negocio activo"]'),
      "la sede activa aparece en el selector",
    ).toHaveCount(1);
    await expect(
      A.page.locator('button[title^="Cambiar a "]'),
      "la sede descubierta aparece en el selector",
    ).toHaveCount(1);

    // En la nube hay UNA sola fila del registro (sin duplicados) y con las
    // dos sedes.
    const registryRows = [...backend.syncDocuments.values()].filter((d) =>
      d.doc_id.endsWith("bodega_businesses_registry_v1"),
    );
    expect(
      registryRows.length,
      "el registro de sedes no se duplica en la nube",
    ).toBe(1);
    const payload = registryRows[0]?.data?.payload;
    expect(
      Array.isArray(payload?.businesses),
      "el documento publicado lleva businesses",
    ).toBe(true);
    const pubIds = (payload?.businesses ?? []).map((b) => b.id);
    expect(
      pubIds,
      "el doc publicado debe llevar exactamente las dos sedes",
    ).toEqual(expect.arrayContaining(["neg-1", created.id]));
    expect(pubIds.length, "sin filas extra en el doc de sedes").toBe(2);

    // Replay idempotente: syncs repetidos no crean filas del registro ni
    // cambian el número de sedes en ningún equipo (sin ping-pong).
    await A.page.evaluate(() => window.__e2eSyncNow());
    await B.page.evaluate(() => window.__e2eSyncNow());
    const rowsAfter = [...backend.syncDocuments.values()].filter((d) =>
      d.doc_id.endsWith("bodega_businesses_registry_v1"),
    ).length;
    expect(rowsAfter, "el replay no duplica el registro de sedes").toBe(1);
    expect(
      (await readRegistrySedes(A.page)).total,
      "A sigue con dos sedes",
    ).toBe(2);
    expect(
      (await readRegistrySedes(B.page)).total,
      "B sigue con dos sedes",
    ).toBe(2);
  });

  test("sedes: eliminar en B se propaga a A y la fila vieja no la revive", async ({
    browser,
  }) => {
    A = await launchDevice(browser, DEVICE_A, "Caja A");
    await A.page.waitForTimeout(2_000);
    await A.page.evaluate(() => window.__e2eSyncNow());
    B = await launchDevice(browser, DEVICE_B, "Caja B", { seedData: false });
    await B.page.waitForTimeout(2_000);
    await B.page.evaluate(() => window.__e2eSyncNow());

    // B crea una sede por el CRUD real (mismo canal del doc global).
    const created = await B.page.evaluate(async () => {
      const { useNegociosStore } = await window.__e2eImportApp(
        "/src/hooks/store/useNegociosStore.js",
      );
      return useNegociosStore.getState().crearNegocio({
        nombre: "Sede EFIMERA E2E",
        rif: "",
      });
    });
    expect(created?.ok, `crearNegocio en B: ${created?.error ?? ""}`).toBe(
      true,
    );
    await expectDocFrom(backend, DEVICE_B, "bodega_businesses_registry_v1");
    const aSync = await A.page.evaluate(() => window.__e2eSyncNow());
    expect(aSync?.ok, `sync de A tras crear: ${aSync?.message ?? ""}`).toBe(
      true,
    );
    await expect
      .poll(
        async () => readRegistrySedes(A.page),
        "la sede efímera debe llegar a A",
        { timeout: 40_000 },
      )
      .toMatchObject({ total: 2 });

    // B la ELIMINA por el CRUD real: el doc republicado lleva la tumba.
    const deleted = await B.page.evaluate(async (id) => {
      const { useNegociosStore } = await window.__e2eImportApp(
        "/src/hooks/store/useNegociosStore.js",
      );
      return useNegociosStore.getState().eliminarNegocio(id);
    }, created.id);
    expect(deleted?.ok, `eliminarNegocio en B: ${deleted?.error ?? ""}`).toBe(
      true,
    );
    await expect
      .poll(
        async () => {
          const row = backend
            .docsFrom(DEVICE_B)
            .find((d) => d.doc_id.endsWith("bodega_businesses_registry_v1"));
          return (row?.data?.payload?.deletedBusinesses ?? []).map((t) => t.id);
        },
        "el doc publicado por B debe llevar la tumba de la sede eliminada",
        { timeout: 40_000 },
      )
      .toContain(created.id);

    // Después del borrado, simular una caja A rezagada que republica su fila
    // vieja más reciente (sin tumba). «Buscar» debe combinarla con la tumba de B.
    const stalePush = await A.page.evaluate(async () => {
      const br = await window.__e2eImportApp("/src/utils/businessRegistry.js");
      const { useNegociosStore } = await window.__e2eImportApp(
        "/src/hooks/store/useNegociosStore.js",
      );
      const cs = await window.__e2eImportApp("/src/hooks/useCloudSync.js");
      const state = useNegociosStore.getState();
      return cs.pushCloudSync(
        br.BUSINESS_REGISTRY_DOC_KEY,
        br.buildBusinessRegistryDoc(state.negocios, state.sedesEliminadas),
      );
    });
    expect(
      stalePush?.ok,
      `A publica la copia vieja: ${stalePush?.error ?? ""}`,
    ).toBe(true);
    const staleRow = await expectDocFrom(
      backend,
      DEVICE_A,
      "bodega_businesses_registry_v1",
    );
    expect(staleRow.data.payload.businesses.map((n) => n.id)).toContain(
      created.id,
    );
    expect(staleRow.data.payload.deletedBusinesses ?? []).toHaveLength(0);

    // Usar el control real «Buscar sedes en la nube» con la fila vieja aún
    // presente en A. Debe consultar todas las filas autorizadas y respetar
    // la tumba de B, no volver a unir la sede eliminada.
    await A.page.evaluate(async () => {
      const { useAuthStore } = await window.__e2eImportApp(
        "/src/hooks/store/useAuthStore.js",
      );
      const store = useAuthStore.getState();
      useAuthStore.setState({
        usuarioActivo: {
          ...(store.usuarioActivo ?? { id: 1, nombre: "Dueño" }),
          rol: "DUENO",
        },
      });
    });
    await A.page.locator('[data-tour="tab-ajustes"]').click();
    await A.page
      .getByRole("button", { name: "Negocio", exact: true })
      .first()
      .click();
    const pill = A.page
      .locator('button[title="Cambiar o gestionar negocios"]')
      .first();
    await expect(pill).toBeVisible();
    await pill.click();
    const searchButton = A.page.getByRole("button", {
      name: "Buscar sedes en la nube",
    });
    await expect(searchButton).toBeVisible();
    await searchButton.click();
    await expect
      .poll(
        async () => readRegistrySedes(A.page),
        "Buscar sedes en la nube no debe resucitar la sede vieja",
        { timeout: 40_000 },
      )
      .toMatchObject({ total: 1, ids: ["neg-1"] });

    // A también conserva la tumba en syncs posteriores.
    await A.page.evaluate(() => window.__e2eSyncNow());
    await A.page.evaluate(() => window.__e2eSyncNow());
    const tombsA = await A.page.evaluate(async () => {
      const { useNegociosStore } = await window.__e2eImportApp(
        "/src/hooks/store/useNegociosStore.js",
      );
      return (
        useNegociosStore.getState().sedesEliminadas?.map((t) => t.id) ?? []
      );
    });
    expect(tombsA, "A conserva la tumba para futuros pulls").toContain(
      created.id,
    );
    expect(
      (await readRegistrySedes(A.page)).total,
      "el replay no revive la sede borrada en A",
    ).toBe(1);

    // B tampoco cambia en su replay (su tumba es local y persistente).
    await B.page.evaluate(() => window.__e2eSyncNow());
    expect(
      (await readRegistrySedes(B.page)).total,
      "B sigue con una sola sede",
    ).toBe(1);
  });

  test("revocación de B: fail-closed, sin éxito falso y con 403 del servidor", async ({
    browser,
  }) => {
    A = await launchDevice(browser, DEVICE_A, "Caja A");
    B = await launchDevice(browser, DEVICE_B, "Caja B", { seedData: false });
    await B.page.waitForTimeout(2_000);
    await B.page.evaluate(() => window.__e2eSyncNow());

    // El servidor revoca a B.
    backend.accounts.get(backend.USER_ID).get(DEVICE_B).revoked = true;

    // Cliente: syncNow y push fallan cerrado (sin éxito falso).
    const syncRes = await B.page.evaluate(() => window.__e2eSyncNow());
    expect(syncRes.ok, "syncNow debe fallar cerrado tras la revocación").toBe(
      false,
    );
    expect(
      syncRes.message || syncRes.error,
      "mensaje de fallo explicable",
    ).toBeTruthy();
    const pushRes = await B.page.evaluate(() =>
      window.__e2ePush("bodega_custom_rate", "99.9"),
    );
    expect(pushRes.ok, "el push del cliente es rechazado").toBe(false);

    // Servidor: aunque el cliente estuviera comprometido, el guardia tipo RLS
    // del mock rechaza la fila de un equipo que no es miembro activo.
    const serverRes = await B.page.evaluate(async () => {
      const res = await fetch(
        "https://e2e-local.invalid/rest/v1/sync_documents?on_conflict=device_id,collection,doc_id",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            device_id: localStorage.getItem("pda_device_id"),
            collection: "store",
            doc_id: "nb_neg-1:bodega_custom_rate",
            data: { payload: "99.9", updatedAt: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          }),
        },
      );
      return { status: res.status, body: await res.text() };
    });
    expect(
      serverRes.status,
      "el servidor rechaza filas de un equipo no autorizado",
    ).toBe(403);

    // A sigue activo y no recibe nada de B: su sync no trae datos de B.
    const aSync = await A.page.evaluate(() => window.__e2eSyncNow());
    expect(aSync.ok).toBe(true);
    const bRowForRate = backend.docsFrom(DEVICE_B);
    expect(
      bRowForRate.some((d) => JSON.stringify(d.data).includes("99.9")),
      "los datos de B no llegaron a la nube",
    ).toBe(false);
  });

  test("los secretos jamás viajan a sync_documents", async ({ browser }) => {
    A = await launchDevice(browser, DEVICE_A, "Caja A");
    await A.page.waitForTimeout(3_000);
    await A.page.evaluate(() => window.__e2eSyncNow());
    await expectDocFrom(backend, DEVICE_A, "bodega_");
    for (const row of backend.syncDocuments.values()) {
      expect(
        row.doc_id.includes("abasto-auth-storage"),
        "SEC-002: el documento de auth no se sincroniza",
      ).toBe(false);
      const payload = JSON.stringify(row.data ?? {});
      expect(payload.includes("pbkdf2"), "sin hashes de PIN en la nube").toBe(
        false,
      );
    }
  });
});
