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
const REALTIME_WS_URL =
  /^(?:wss?:\/\/e2e-local\.invalid|ws:\/\/127\.0\.0\.1:4173)\/realtime\/v1\/websocket/;

export function createMockSupabaseBackend() {
  const syncDocuments = new Map(); // "device_id|collection|doc_id" → fila
  // Membresía: { [userId]: Map<device_id, { revoked:boolean, alias }> }
  const accounts = new Map();
  const pairings = new Map(); // legacy: primary_device_id → monitor_device_id
  const realtimeClients = new Set();
  const realtimeSocketUrls = [];
  const realtimeColumns = [
    { name: "id", type: "int8" },
    { name: "device_id", type: "text" },
    { name: "collection", type: "text" },
    { name: "doc_id", type: "text" },
    { name: "data", type: "jsonb" },
    { name: "payload", type: "jsonb" },
    { name: "updated_at", type: "timestamptz" },
  ];

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

  function handleRealtime(route) {
    const channels = new Map();
    const client = { route, channels };
    realtimeClients.add(client);
    route.onMessage((message) => {
      let decoded;
      try {
        decoded = JSON.parse(String(message));
      } catch {
        return;
      }
      if (
        (!Array.isArray(decoded) || decoded.length < 5) &&
        (!decoded || typeof decoded !== "object" || !decoded.event)
      )
        return;
      // Realtime protocol v2 serializes Phoenix frames as
      // [join_ref, ref, topic, event, payload], but v1 uses object frames.
      const [joinRef, ref, topic, event, payload] = Array.isArray(decoded)
        ? decoded
        : [
            decoded.join_ref,
            decoded.ref,
            decoded.topic,
            decoded.event,
            decoded.payload,
          ];
      if (event === "phx_join") {
        const filters = payload?.config?.postgres_changes || [];
        const accepted = filters.map((filter, index) => ({
          ...filter,
          id: String(index + 1),
        }));
        channels.set(topic, {
          joinRef,
          filters: accepted,
          protocol: Array.isArray(decoded) ? "array" : "object",
        });
        route.send(
          JSON.stringify(
            decoded && !Array.isArray(decoded)
              ? {
                  join_ref: joinRef,
                  ref,
                  topic,
                  event: "phx_reply",
                  payload: {
                    status: "ok",
                    response: { postgres_changes: accepted },
                  },
                }
              : [
                  joinRef,
                  ref,
                  topic,
                  "phx_reply",
                  { status: "ok", response: { postgres_changes: accepted } },
                ],
          ),
        );
      } else if (event === "heartbeat") {
        route.send(
          JSON.stringify(
            Array.isArray(decoded)
              ? [
                  joinRef,
                  ref,
                  topic,
                  "phx_reply",
                  { status: "ok", response: {} },
                ]
              : {
                  join_ref: joinRef,
                  ref,
                  topic,
                  event: "phx_reply",
                  payload: { status: "ok", response: {} },
                },
          ),
        );
      } else if (event === "phx_leave") {
        channels.delete(topic);
        route.send(
          JSON.stringify(
            Array.isArray(decoded)
              ? [
                  joinRef,
                  ref,
                  topic,
                  "phx_reply",
                  { status: "ok", response: {} },
                ]
              : {
                  join_ref: joinRef,
                  ref,
                  topic,
                  event: "phx_reply",
                  payload: { status: "ok", response: {} },
                },
          ),
        );
      }
    });
    route.onClose(() => realtimeClients.delete(client));
  }

  function publishRealtime(row, eventType = "INSERT") {
    const data = {
      schema: "public",
      table: "sync_documents",
      commit_timestamp: row.updated_at,
      type: eventType,
      errors: null,
      columns: realtimeColumns,
      record: row,
      old_record: {},
    };
    for (const client of realtimeClients) {
      for (const [topic, channel] of client.channels) {
        const ids = channel.filters
          .filter(
            (filter) =>
              filter.schema === "public" &&
              filter.table === "sync_documents" &&
              (filter.event === "*" || filter.event === eventType),
          )
          .map((filter) => filter.id);
        if (ids.length === 0) continue;
        client.route.send(
          JSON.stringify(
            channel.protocol === "array"
              ? [
                  channel.joinRef,
                  null,
                  topic,
                  "postgres_changes",
                  { ids, data },
                ]
              : {
                  join_ref: channel.joinRef,
                  ref: null,
                  topic,
                  event: "postgres_changes",
                  payload: { ids, data },
                },
          ),
        );
      }
    }
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
          "or",
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
    const expression = params.get("or");
    if (expression) {
      // F2 keyset subset: top-level OR of AND clauses with quoted strings.
      const split = (value) => {
        const parts = [];
        let depth = 0;
        let quoted = false;
        let begin = 0;
        for (let i = 0; i < value.length; i++) {
          if (value[i] === '"' && value[i - 1] !== "\\") quoted = !quoted;
          if (quoted) continue;
          if (value[i] === "(") depth++;
          if (value[i] === ")") depth--;
          if (value[i] === "," && depth === 0) {
            parts.push(value.slice(begin, i));
            begin = i + 1;
          }
        }
        parts.push(value.slice(begin));
        return parts;
      };
      const match = (row, clause) => {
        if (clause.startsWith("and("))
          return split(clause.slice(4, -1)).every((c) => match(row, c));
        const m = /^([a-z_]+)\.(eq|gt)\.(.+)$/.exec(clause);
        if (!m) throw new Error("Filtro OR no soportado en mock");
        const value = m[3].startsWith('"') ? JSON.parse(m[3]) : m[3];
        return m[2] === "eq"
          ? String(row[m[1]]) === value
          : String(row[m[1]]) > value;
      };
      out = out.filter((row) =>
        split(expression.replace(/^\(|\)$/g, "")).some((clause) =>
          match(row, clause),
        ),
      );
    }
    const order = params.get("order");
    if (order) {
      const columns = order.split(",").map((part) => part.split("."));
      out = [...out].sort((a, b) => {
        for (const [col, dir] of columns) {
          const left = String(a[col] ?? ""),
            right = String(b[col] ?? "");
          const cmp = left < right ? -1 : left > right ? 1 : 0;
          if (cmp) return dir === "desc" ? -cmp : cmp;
        }
        return 0;
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
        for (const row of rows) {
          const key = rowKey(row);
          const eventType = syncDocuments.has(key) ? "UPDATE" : "INSERT";
          const stored = {
            ...row,
            id: syncDocuments.get(key)?.id ?? syncDocuments.size + 1,
          };
          syncDocuments.set(key, stored);
          publishRealtime(stored, eventType);
        }
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
    handleRealtime,
    publishRealtime,
    get realtimeSubscriberCount() {
      return realtimeClients.size;
    },
    realtimeSocketUrls,
    reset,
    handle,
  };
}

/** Registra la ruta que canaliza todo el tráfico del proyecto sintético al backend. */
export async function routeMockSupabase(page, backend) {
  await page.routeWebSocket(/.*/, (route) => {
    backend.realtimeSocketUrls.push(route.url());
    if (REALTIME_WS_URL.test(route.url())) {
      backend.handleRealtime(route);
      return;
    }
    if (route.url().startsWith("ws://127.0.0.1:4173/")) {
      route.connectToServer();
      return;
    }
    route.close({ code: 1000, reason: "Blocked external WebSocket in E2E" });
  });
  await page.route(/https:\/\/e2e-local\.invalid\//, (route) =>
    backend.handle(route),
  );
  // Cualquier intento de fuga hacia otros hosts https se vacía (defensa extra).
  await page.route(/https:\/\/(?!e2e-local\.invalid)/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}
