/**
 * mockSupabaseCloud.js — Backend "supabase-lite" con estado, EN EL PROCESO NODE.
 *
 * Sustituye el gate de staging para la verificación local multi-dispositivo:
 * dos contextos de navegador reales sincronizan a través de ESTE mapa en
 * memoria (registrado con page.route), que emula el subconjunto de PostgREST
 * que la app usa:
 *
 *   - `sync_documents`: upsert con conflicto (device_id,collection,doc_id),
 *     select con filtros in/eq/like/gt + order + limit.
 *   - `account_devices`: membresía de la cuenta (para getAccountSyncContext).
 *   - RPCs: get_license_status (eco del device_id), register_account_device,
 *     my_account_device_ids, report_pro_devices.
 *
 * GUARDIA TIPO RLS: escribir en sync_documents exige que el device_id sea
 * miembro ACTIVO de la cuenta (403 PostgREST si no). Así el negativo de
 * revocación prueba el camino real: el SERVIDOR rechaza y el cliente debe
 * fallar cerrado sin marcar éxito.
 *
 * No sale nada del navegador: la "nube" vive en este proceso.
 */

// ── Estado compartido entre contextos (la "nube") ──────────────────────────
export function createMockSupabaseBackend() {
  const syncDocuments = new Map(); // "device_id|collection|doc_id" → fila
  // Membresía: { [userId]: Map<device_id, { revoked:boolean, alias }> }
  const accounts = new Map();
  const pairings = new Map(); // legacy: primary_device_id → monitor_device_id

  const USER_ID = "e2e-owner-user";

  function registerDevice(
    deviceId,
    { revoked = false, alias = null, userId = USER_ID } = {},
  ) {
    if (!accounts.has(userId)) accounts.set(userId, new Map());
    accounts.get(userId).set(deviceId, { revoked, alias });
  }

  function activeDeviceIds(userId = USER_ID) {
    const m = accounts.get(userId);
    if (!m) return [];
    return [...m.entries()].filter(([, v]) => !v.revoked).map(([k]) => k);
  }

  function isDeviceActive(deviceId, userId = USER_ID) {
    const m = accounts.get(userId);
    return !!m && m.has(deviceId) && !m.get(deviceId).revoked;
  }

  function rowKey(row) {
    return `${row.device_id}|${row.collection}|${row.doc_id}`;
  }

  /** ¿Alguno de los docs de deviceId ya está en la nube (para expect.poll)? */
  function hasDocFrom(deviceId, docId = null) {
    for (const row of syncDocuments.values()) {
      if (row.device_id !== deviceId) continue;
      if (docId && row.doc_id !== docId) continue;
      return true;
    }
    return false;
  }

  function docsFrom(deviceId, docId = null) {
    return [...syncDocuments.values()].filter(
      (r) => r.device_id === deviceId && (!docId || r.doc_id === docId),
    );
  }

  function reset({ keepAccounts = true } = {}) {
    syncDocuments.clear();
    if (!keepAccounts) accounts.clear();
  }

  // ── Filtros PostgREST (subconjunto usado por la app) ───────────────────
  // OJO: url.searchParams ya devuelve valores DECODIFICADOS; NO re-decodificar
  // (un '%' suelto lanzaría URIError y tumbaría la petición enrutada).
  function applyFilters(rows, params) {
    let out = rows;
    for (const [key, rawValue] of params.entries()) {
      if (
        [
          "select",
          "order",
          "limit",
          "offset",
          "on_conflict",
          "apikey",
        ].includes(key)
      )
        continue;
      const value = rawValue;
      const m = /^(in|eq|neq|gt|gte|lt|lte|like|is)\.(.*)$/s.exec(value);
      if (!m) continue;
      const [, op, operand] = m;
      out = out.filter((row) => {
        const actual = row[key];
        switch (op) {
          case "in": {
            // supabase-js envía `in.(a,b)` SIN comillas para strings
            // simples, y `in.("a","b")` cuando hay caracteres
            // especiales: soportar ambas formas.
            const inner = operand.replace(/^\(/, "").replace(/\)$/, "");
            const items = inner.startsWith('"')
              ? inner.split('","').map((s) => s.replace(/^"|"$/g, ""))
              : inner
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
            return items.includes(String(actual));
          }
          case "eq":
            return operand === "true"
              ? actual === true
              : operand === "false"
                ? actual === false
                : String(actual) === operand;
          case "neq":
            return String(actual) !== operand;
          case "gt":
            return String(actual) > operand;
          case "gte":
            return String(actual) >= operand;
          case "lt":
            return String(actual) < operand;
          case "lte":
            return String(actual) <= operand;
          case "like":
            // Solo patrón prefijo: `nb\_%` → empieza con "nb_".
            return String(actual).startsWith(
              operand.replace(/\\_/g, "_").replace(/%/g, ""),
            );
          case "is":
            return operand === "null"
              ? actual === null || actual === undefined
              : false;
          default:
            return true;
        }
      });
    }
    const order = params.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      out = [...out].sort((a, b) => {
        const cmp = String(a[col] ?? "").localeCompare(String(b[col] ?? ""));
        return dir === "desc" ? -cmp : cmp;
      });
    }
    const limit = params.get("limit");
    if (limit) out = out.slice(0, Number(limit));
    return out;
  }

  const JSON_HEADERS = { "content-type": "application/json" };

  /**
   * Maneja UNA petición hacia e2e-local.invalid. Devuelve true si la
   * interceptó (la ruta fue respondida); false para dejarla pasar.
   * Blindaje: cualquier excepción del simulador responde 500 en vez de
   * propagarse al navegador (una ruta que lanza mata la navegación).
   */
  async function handle(route) {
    try {
      return await handleInner(route);
    } catch (e) {
      console.warn("[mockSupabase] error simulando", route.request().url(), e);
      try {
        await route.fulfill({
          status: 500,
          headers: JSON_HEADERS,
          body: JSON.stringify({ message: String(e?.message || e) }),
        });
      } catch {
        /* la ruta ya fue respondida o el contexto murió */
      }
      return true;
    }
  }

  async function handleInner(route) {
    const url = new URL(route.request().url());
    if (!url.hostname.includes("e2e-local.invalid")) return false;
    const path = url.pathname;
    const method = route.request().method();

    // ── Auth: la sesión vive localmente; responde 2xx vacío. ──
    if (path.includes("/auth/v1/")) {
      await route.fulfill({ status: 200, headers: JSON_HEADERS, body: "{}" });
      return true;
    }

    // ── Realtime (websocket) → abort; la app lo trata como sin red. ──
    if (path.includes("/realtime/")) {
      await route.abort("blockedbyclient");
      return true;
    }

    // ── RPC ──
    if (path.includes("/rest/v1/rpc/")) {
      const fn = path.split("/rpc/")[1];
      let args = {};
      try {
        args = route.request().postDataJSON() || {};
      } catch {
        /* sin body */
      }
      if (fn === "get_license_status") {
        const row = {
          type: "permanent",
          is_active: true,
          device_id: args.p_device_id || "",
          expires_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
        };
        await route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify([row]),
        });
        return true;
      }
      if (fn === "register_account_device") {
        const deviceId = args.p_device_id || "";
        const maxDevices = args.p_max_devices || 6;
        const m = accounts.get(USER_ID) || new Map();
        if (!m.has(deviceId) && m.size >= maxDevices) {
          await route.fulfill({
            status: 400,
            headers: JSON_HEADERS,
            body: JSON.stringify({
              message: "LIMIT_REACHED: cuenta llena",
              code: "P0001",
            }),
          });
          return true;
        }
        registerDevice(deviceId, { alias: args.p_alias || null });
        await route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: "true",
        });
        return true;
      }
      if (fn === "my_account_device_ids") {
        await route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(activeDeviceIds()),
        });
        return true;
      }
      // Cualquier otra RPC (report_pro_devices, etc.): éxito silencioso.
      await route.fulfill({ status: 200, headers: JSON_HEADERS, body: "true" });
      return true;
    }

    // ── Tablas REST ──
    if (path.includes("/rest/v1/account_devices")) {
      const userIdEq = (url.searchParams.get("user_id") || "").replace(
        "eq.",
        "",
      );
      const revokedEq = url.searchParams.get("revoked");
      const m = accounts.get(userIdEq) || new Map();
      const rows = [...m.entries()]
        .filter(([id, v]) => {
          if (revokedEq === "eq.false") return !v.revoked;
          if (revokedEq === "eq.true") return v.revoked;
          return true;
        })
        .map(([id, v]) => ({
          device_id: id,
          user_id: userIdEq,
          revoked: v.revoked,
          alias: v.alias,
          created_at: "2026-01-01T00:00:00.000Z",
          last_seen: new Date().toISOString(),
        }));
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(rows),
      });
      return true;
    }

    if (path.includes("/rest/v1/sync_documents")) {
      if (method === "POST") {
        // Upsert (merge-duplicates) con guardia tipo RLS.
        let body;
        try {
          body = route.request().postDataJSON();
        } catch {
          body = null;
        }
        const rows = Array.isArray(body) ? body : body ? [body] : [];
        for (const row of rows) {
          if (!row?.device_id || !row?.doc_id) {
            await route.fulfill({
              status: 400,
              headers: JSON_HEADERS,
              body: JSON.stringify({
                message: "fila incompleta",
                code: "23502",
              }),
            });
            return true;
          }
          if (!isDeviceActive(row.device_id)) {
            // Equivalente a la denegación RLS real para no-miembros.
            await route.fulfill({
              status: 403,
              headers: JSON_HEADERS,
              body: JSON.stringify({
                message:
                  'new row violates row-level security policy for table "sync_documents"',
                code: "42501",
              }),
            });
            return true;
          }
        }
        for (const row of rows) syncDocuments.set(rowKey(row), { ...row });
        await route.fulfill({ status: 201, headers: JSON_HEADERS, body: "[]" });
        return true;
      }
      if (method === "GET") {
        const all = [...syncDocuments.values()];
        const rows = applyFilters(all, url.searchParams);
        await route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(rows),
        });
        return true;
      }
      await route.fulfill({ status: 405, headers: JSON_HEADERS, body: "{}" });
      return true;
    }

    // Cualquier otro REST (p. ej. tablas no simuladas): lista vacía.
    if (path.includes("/rest/v1/")) {
      await route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
      return true;
    }

    await route.fulfill({ status: 200, headers: JSON_HEADERS, body: "{}" });
    return true;
  }

  return {
    USER_ID,
    syncDocuments,
    accounts,
    pairings,
    registerDevice,
    activeDeviceIds,
    isDeviceActive,
    hasDocFrom,
    docsFrom,
    reset,
    handle,
  };
}

/** Registra la ruta que canaliza todo el tráfico del proyecto sintético al backend. */
export async function routeMockSupabase(page, backend) {
  await page.route(/https:\/\/e2e-local\.invalid\//, (route) =>
    backend.handle(route),
  );
  // Cualquier intento de fuga hacia otros hosts https se vacía (defensa extra).
  await page.route(/https:\/\/(?!e2e-local\.invalid)/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}
