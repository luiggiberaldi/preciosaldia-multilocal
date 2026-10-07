import { useEffect, useRef } from "react";
import { appForage } from "../utils/appForage";
import { supabaseCloud } from "../config/supabaseCloud";
import { useAuthStore } from "./store/useAuthStore";
import {
  toCloudDocId,
  parseCloudDocId,
  isDocForKnownBusiness,
} from "../utils/negocioContext";
import {
  SUPERVISOR_SYNC_KEYS,
  validateSupervisorSyncDocument,
} from "../services/supervisorContracts";
import { ensureSupervisorSession } from "../services/supervisorAuth";
import { ensureDeviceSessionRegistered } from "../utils/deviceIdentity";
// Acceso de cuenta/dispositivo verificado desde cloudAccount antes del sync;
// el pairing legacy se conserva como flujo independiente.
import {
  isAccountLinkedLocally,
  validateCurrentDeviceSyncAccess,
} from "../services/cloudAccount";
import {
  mergeLedgerEntries,
  rebuildCustomersFromLedger,
} from "../utils/customerLedger";
// Catálogo de usuarios sin PINs (SEC-002): merge preservando PINs locales.
import {
  mergeUserCatalog,
  isValidUserCatalogDoc,
  buildUserCatalogDoc,
  readUserTombstones,
} from "../utils/userCatalog";
import {
  mergeBusinessRegistry,
  mergeTombstones,
  pruneTombstoned,
  readTombstones,
  isValidBusinessRegistryDoc,
  BUSINESS_REGISTRY_DOC_KEY,
} from "../utils/businessRegistry";
// QUOTA-001: sincronización delta (stock liviano vs catálogo) + poda de ventas.
import {
  applyStockMapDelta,
  buildSalesDeltaPayload,
  buildStockMap,
  isSalesDeltaKey,
  isValidSalesDelta,
  isValidStockMap,
  mergeSales,
  pruneSalesForSync,
  salesDayString,
  salesDeltaKeyForDate,
  salesDeltaTickets,
} from "../utils/syncDelta";
import { RETENTION } from "../utils/retentionPolicy";
import {
  buildSyncEnvelope,
  getSyncMetadataKey,
  isNewerSyncDocument,
  readSyncEnvelope,
  withSyncRetry,
} from "../services/supervisorSyncService";
import {
  recordSyncConflict,
  friendlyConflictName,
} from "../utils/syncConflicts";
import { contentHash } from "../utils/contentHash";

// Claves con semántica append-only o de fusión: su descarte/merge no es un
// conflicto a reportar (M-17 solo vigila documentos NO append-only).
const MERGED_SYNC_KEYS = new Set([
  "bodega_sales_v1",
  "bodega_customer_ledger_v1",
  "bodega_stock_v1",
]);
const isMergeSemanticsKey = (key) =>
  MERGED_SYNC_KEYS.has(key) || isSalesDeltaKey(key);

// Una única allowlist compartida por primary y monitor.
const SYNC_KEYS = SUPERVISOR_SYNC_KEYS;

function shortCloudSyncId(value) {
  if (!value || typeof value !== "string") return null;
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

// SEC-002: `abasto-auth-storage` (hashes de PIN) YA NO se sincroniza a sync_documents.
// Las políticas RLS de `sync_documents` en el schema original permiten lectura global
// (ver SEC-002/INFRA-002 — fix del SQL corresponde a Agente D). Aunque se arregle la
// RLS, los hashes de PIN no deben viajar por una tabla compartida entre dispositivos.
const LOCAL_KEYS = [
  "bodega_custom_rate",
  "bodega_use_auto_rate",
  "bodega_rate_mode",
  "tasa_cop",
  "cop_enabled",
  "auto_cop_enabled",
];

const quickHash = contentHash;

function catalogFingerprint(products) {
  if (!Array.isArray(products)) return [];
  return products.map((product) => {
    if (!product || typeof product !== "object") return product;
    const stable = {};
    for (const key of Object.keys(product).sort()) {
      if (key !== "stock" && key !== "updatedAt") stable[key] = product[key];
    }
    return stable;
  });
}

const LAST_PUSH_HASH_PREFIX = "bodega_last_periodic_push_hash_";
const CONFIRMED_PUSH_HASH_PREFIX = "bodega_last_confirmed_push_hash_";
const _pushHashKey = (key) => LAST_PUSH_HASH_PREFIX + toCloudDocId(key);
const _confirmedPushHashKey = (key) =>
  CONFIRMED_PUSH_HASH_PREFIX + toCloudDocId(key);
const _confirmedDocHashKey = (docId) => CONFIRMED_PUSH_HASH_PREFIX + docId;

/* ─── M-6: último mapa de stock visto por fuente (para reconciliar por delta) */
const lastRemoteStockKey = (docId, sourceDeviceId) =>
  `pda_stock_lastremote_${docId}__${sourceDeviceId || "unknown"}`;
function readLastRemoteStockMap(docId, sourceDeviceId) {
  try {
    const raw = localStorage.getItem(lastRemoteStockKey(docId, sourceDeviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function writeLastRemoteStockMap(docId, sourceDeviceId, map) {
  try {
    if (map)
      localStorage.setItem(
        lastRemoteStockKey(docId, sourceDeviceId),
        JSON.stringify(map),
      );
  } catch {
    /* cuota llena: se re-siembra en el próximo ciclo */
  }
}

// ─── FASE 1 MULTI-NEGOCIO ──────────────────────────────────────────────────
// `doc_id = nb_<negocioId>:<clave>` (la columna `collection` ya separa
// 'store'/'local', así que no se duplica en el doc_id). Las claves globales
// (tasas, etc.) quedan sin prefijo y se comparten entre negocios.
// El hash de último push también es por doc_id: cada negocio tiene su estado.
function _confirmedPushKey(key) {
  return _confirmedPushHashKey(key);
}

// ─── Estado Global del Motor ───────────────────────────────────────────────
let globalSubscription = null;
let isSyncingFromCloud = false; // true mientras aplicamos cambios de la nube → evita eco
let pendingPush = {}; // Debounce: { [key]: timeoutId }
let _currentDeviceId = ""; // Device ID activo para pushCloudSync
let isCloudSyncActive = false; // Evita empujar a la nube si el dispositivo no está autenticado/emparejado

/** M-22 (2026-10-01): expone si el sync está activo para bloquear operaciones destructivas. */
export function isCloudSyncActiveNow() {
  return isCloudSyncActive;
}

// SEC-009 / HOOK-011: ELIMINADO el monkeypatch global de `localStorage.setItem`.
// Antes se reemplazaba `localStorage.setItem` a nivel módulo, interceptando TODAS
// las escrituras (incluyendo extensiones y devtools) y empujando a sync_documents.
// Eso causaba:
//   1. Recursión si el módulo se importa dos veces (HMR, tests).
//   2. Filtrado de hashes de PIN a una tabla pública (SEC-002).
//
// Ahora, los puntos de escritura explícitos llaman a `storageService.setItem` (que
// invoca `pushCloudSync` internamente). Para localStorage writes directos, los
// callers deben usar `pushLocalSync(key, value)` explícitamente.
//
// Mantenemos `originalSetItem` como referencia interna solo para aplicar cambios
// venidos de la nube sin disparar re-eco.

const originalSetItem = localStorage.setItem.bind(localStorage);

// Keys pesadas (arrays grandes con imágenes) usan debounce más largo para agrupar ediciones
// QUOTA-002: `abasto_audit_log_v1` salió del sync (diagnóstico local, crecía sin cota).
const HEAVY_KEYS = [
  "bodega_products_v1",
  "bodega_stock_v1",
  "bodega_sales_v1",
  "bodega_customers_v1",
  "bodega_customer_ledger_v1",
];
const DEBOUNCE_LIGHT_MS = 300;
const DEBOUNCE_HEAVY_MS = 3000;

function _debouncePush(key, value) {
  if (pendingPush[key]) clearTimeout(pendingPush[key]);
  const delay = HEAVY_KEYS.includes(key)
    ? DEBOUNCE_HEAVY_MS
    : DEBOUNCE_LIGHT_MS;
  pendingPush[key] = setTimeout(() => {
    delete pendingPush[key];
    // B-13 (2026-10-01): antes los errores se tragaban con `.catch(() => {})`
    // y el push fallaba en silencio. Ahora se registran (evento + último
    // error consultable) para que la UI pueda avisar.
    pushCloudSync(key, value)
      .then((res) => {
        if (res && res.ok === false && !res.skipped)
          recordSyncPushError(key, res.error);
      })
      .catch((err) => {
        recordSyncPushError(key, err?.message || String(err));
      });
  }, delay);
}

/** B-13 (2026-10-01): último error de push (no silencioso). */
export const SYNC_PUSH_ERROR_EVENT = "pda_sync_push_error";
let _lastSyncPushError = null;
export function recordSyncPushError(key, error) {
  _lastSyncPushError = {
    key,
    error: String(error || "Error desconocido"),
    at: new Date().toISOString(),
  };
  try {
    window.dispatchEvent(
      new CustomEvent(SYNC_PUSH_ERROR_EVENT, { detail: _lastSyncPushError }),
    );
  } catch {
    /* sin window (tests): silenciar */
  }
  return _lastSyncPushError;
}
export function getLastSyncPushError() {
  return _lastSyncPushError;
}

export const pushCloudSync = async (key, value, forceUnconditional = false) => {
  if (!supabaseCloud)
    return { ok: false, skipped: true, error: "Supabase no disponible" };
  if (isSyncingFromCloud)
    return { ok: false, skipped: true, error: "Cambio remoto en aplicación" };
  if (!isCloudSyncActive)
    return { ok: false, skipped: true, error: "Sync no activo" };
  if (!SYNC_KEYS.includes(key))
    return { ok: false, skipped: true, error: "Clave no allowlisted" };
  if (!_currentDeviceId)
    return { ok: false, skipped: true, error: "Dispositivo no definido" };

  // SEC-002: jamás empujar `abasto-auth-storage` aunque accidentalmente lo pidan.
  if (
    key === "abasto-auth-storage" ||
    parseCloudDocId(key).key === "abasto-auth-storage"
  ) {
    return {
      ok: false,
      skipped: true,
      error: "Documento de autenticación bloqueado",
    };
  }

  const deviceAccess = await validateCurrentDeviceSyncAccess(
    _currentDeviceId || localStorage.getItem("pda_device_id"),
  );
  if (!deviceAccess.ok) {
    return {
      ok: false,
      skipped: false,
      error: deviceAccess.error || "Equipo sin autorización activa",
    };
  }

  // QUOTA-001: hash del catálogo pendiente de confirmación (se escribe solo
  // si el upsert del documento completo tiene éxito).
  let pendingCatalogHash = null;

  // QUOTA-001: el 99% de los cambios en productos es SOLO stock (cada venta).
  // En ese caso se empuja únicamente el mapa liviano `bodega_stock_v1`
  // (~40KB) y se omite el catálogo completo (~3MB). El catálogo solo viaja
  // cuando cambia algo estructural (precio, nombre, foto, alta/baja).
  if (key === "bodega_products_v1" && Array.isArray(value)) {
    const stockResult = await pushCloudSync(
      "bodega_stock_v1",
      buildStockMap(value),
      forceUnconditional,
    );
    if (!stockResult?.ok) return stockResult;
    if (!forceUnconditional) {
      const chKey = `${LAST_PUSH_HASH_PREFIX}catalog:${toCloudDocId(key)}`;
      const ch = await quickHash(catalogFingerprint(value));
      if (localStorage.getItem(chKey) === ch) {
        if (!stockResult?.ok) return stockResult;
        return {
          ok: true,
          skipped: true,
          reason: "Solo cambió stock (delta)",
          stock: stockResult,
        };
      }
      // Se confirma abajo, solo si Supabase acepta el upsert.
      pendingCatalogHash = { chKey, ch };
    }
    // Sigue abajo: empuja el catálogo completo (cambió algo estructural).
  }

  const docId = toCloudDocId(key);
  const hashKey = _pushHashKey(key);
  const confirmedHashKey = _confirmedPushHashKey(key);
  const currentHash = await quickHash(value);
  if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) {
    if (localStorage.getItem(confirmedHashKey) === currentHash) {
      return { ok: true, skipped: true, reason: "Sin cambios" };
    }
    // Hash registrado SIN confirmación (p. ej. _applyFromCloud fusionó un
    // doc remoto en un equipo que aún nunca subió esta clave): re-empujar
    // es idempotente (upsert por clave compuesta) y re-confirma el estado.
    // Antes se devolvía aquí un error permanente que mataba la
    // auto-recuperación de initSync y dejaba el sync inactivo en
    // dispositivos nuevos que solo habían recibido pull.
  }

  // QUOTA-003: ventas usan delta idempotente; la ventana completa se sube aparte.
  // Ambos caminos validan dispositivo antes de escribir.
  if (key === "bodega_sales_v1" && Array.isArray(value)) {
    return await pushSalesDelta(value, forceUnconditional);
  }
  const payloadValue = value;

  const collectionType = LOCAL_KEYS.includes(key) ? "local" : "store";
  const updatedAt = new Date().toISOString();
  const document = {
    device_id: _currentDeviceId,
    collection: collectionType,
    doc_id: docId,
    data: buildSyncEnvelope(payloadValue, updatedAt),
    updated_at: updatedAt,
  };

  try {
    const result = await withSyncRetry(async () => {
      const response = await supabaseCloud
        .from("sync_documents")
        .upsert(document, { onConflict: "device_id,collection,doc_id" });
      if (response.error) throw response.error;
      return response;
    });

    // Solo confirmar los hashes después de que Supabase confirmó el upsert.
    localStorage.setItem(hashKey, currentHash);
    localStorage.setItem(confirmedHashKey, currentHash);
    if (pendingCatalogHash) {
      localStorage.setItem(pendingCatalogHash.chKey, pendingCatalogHash.ch);
    }
    return { ok: true, skipped: false, updatedAt, data: result.data ?? null };
  } catch (error) {
    console.warn(
      "[CloudSync] No se pudo confirmar el push:",
      error?.message ?? error,
    );
    return {
      ok: false,
      skipped: false,
      error: error?.message || "Error de sincronización",
    };
  }
};

/**
 * QUOTA-003: sube el DELTA diario de ventas (solo los tickets del día).
 * El doc_id es `bodega_sales_delta_YYYY-MM-DD` (por negocio vía toCloudDocId).
 * Pesa ~KB en vez de ~MB. El receptor fusiona por id (mergeSales).
 *
 * @param {Array} salesArray - array local completo de ventas
 * @param {string} day - día YYYY-MM-DD local (defecto: hoy)
 */
const pushSingleSalesDelta = async (
  salesArray,
  day,
  forceUnconditional = false,
) => {
  const deviceAccess = await validateCurrentDeviceSyncAccess(
    _currentDeviceId || localStorage.getItem("pda_device_id"),
  );
  if (!deviceAccess.ok) {
    return {
      ok: false,
      skipped: false,
      error: deviceAccess.error || "Equipo sin autorización activa",
    };
  }
  // El delta se escribe en la fila del equipo propio; también es seguro para
  // pairing legacy, cuya política RLS no autoriza leer documentos hermanos.
  const deltaKey = salesDeltaKeyForDate(day);
  const docId = toCloudDocId(deltaKey);
  const payload = buildSalesDeltaPayload(salesArray, day);

  // Hash-gating propio del delta: si los tickets del día no cambiaron, no subir.
  const hashKey = LAST_PUSH_HASH_PREFIX + docId;
  const currentHash = await quickHash(payload);
  if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) {
    if (
      localStorage.getItem(CONFIRMED_PUSH_HASH_PREFIX + docId) !== currentHash
    ) {
      return {
        ok: false,
        skipped: false,
        error: "El delta todavía no está confirmado en la nube",
      };
    }
    return { ok: true, skipped: true, reason: "Delta sin cambios" };
  }

  const updatedAt = new Date().toISOString();
  const document = {
    device_id: _currentDeviceId,
    collection: "store",
    doc_id: docId,
    data: buildSyncEnvelope(payload, updatedAt),
    updated_at: updatedAt,
  };

  try {
    const result = await withSyncRetry(async () => {
      const response = await supabaseCloud
        .from("sync_documents")
        .upsert(document, { onConflict: "device_id,collection,doc_id" });
      if (response.error) throw response.error;
      return response;
    });
    localStorage.setItem(hashKey, currentHash);
    localStorage.setItem(CONFIRMED_PUSH_HASH_PREFIX + docId, currentHash);
    return {
      ok: true,
      skipped: false,
      updatedAt,
      data: result.data ?? null,
      deltaTickets: payload.tickets.length,
    };
  } catch (error) {
    console.warn(
      "[CloudSync] No se pudo confirmar el push del delta:",
      error?.message ?? error,
    );
    return {
      ok: false,
      skipped: false,
      error: error?.message || "Error de sincronización",
    };
  }
};

/**
 * NÓMINA (v1): sube un documento individual de nómina
 * (`bodega_payroll_consumo_<id>`, `bodega_payroll_periodo_<...>`, `bodega_payroll_liquidacion_<id>`).
 * Upsert directo por (device_id, collection, doc_id) —las keys dinámicas no pasan
 * por `pushCloudSync` (allowlist estática)—, mismo patrón que `pushSingleSalesDelta`.
 * LWW limpio por doc_id: el doc es inmutable salvo anulación (updated_at nuevo).
 */
export const pushPayrollDoc = async (docKey, value) => {
  if (!supabaseCloud || !isCloudSyncActive || !_currentDeviceId) {
    return { ok: false, skipped: true, error: "Sync no activo" };
  }
  const deviceAccess = await validateCurrentDeviceSyncAccess(
    _currentDeviceId || localStorage.getItem("pda_device_id"),
  );
  if (!deviceAccess.ok) {
    return {
      ok: false,
      skipped: false,
      error: deviceAccess.error || "Equipo sin autorización activa",
    };
  }
  if (!deviceAccess.context) {
    return {
      ok: false,
      skipped: false,
      error: "Nómina requiere una cuenta con membresía activa",
    };
  }
  const docId = toCloudDocId(docKey);
  const hashKey = LAST_PUSH_HASH_PREFIX + docId;
  const currentHash = await quickHash(value);
  if (
    localStorage.getItem(hashKey) === currentHash &&
    localStorage.getItem(_confirmedDocHashKey(docId)) === currentHash
  ) {
    return { ok: true, skipped: true, reason: "Documento sin cambios" };
  }
  const updatedAt = new Date().toISOString();
  const document = {
    device_id: _currentDeviceId,
    collection: "store",
    doc_id: docId,
    data: buildSyncEnvelope(value, updatedAt),
    updated_at: updatedAt,
  };
  try {
    const response = await withSyncRetry(async () => {
      const res = await supabaseCloud
        .from("sync_documents")
        .upsert(document, { onConflict: "device_id,collection,doc_id" });
      if (res.error) throw res.error;
      return res;
    });
    localStorage.setItem(hashKey, currentHash);
    localStorage.setItem(_confirmedDocHashKey(docId), currentHash);
    return { ok: true, skipped: false, updatedAt, data: response.data ?? null };
  } catch (error) {
    console.warn(
      "[CloudSync] No se pudo subir documento de nómina:",
      error?.message ?? error,
    );
    return {
      ok: false,
      skipped: false,
      error: error?.message || "Error de sincronización",
    };
  }
};

const pushSalesDelta = async (salesArray, forceUnconditional = false) => {
  const result = await pushSingleSalesDelta(
    salesArray,
    salesDayString(),
    forceUnconditional,
  );
  // CRÍTICO-2(a) (2026-10-01): si el equipo estuvo offline días previos, sus
  // deltas nunca se empujaron. Re-empujar los pendientes (fire-and-forget).
  if (result?.ok) {
    pushPendingSalesDeltas(salesArray).catch(() => {});
  }
  return result;
};

/**
 * CRÍTICO-2(a): re-empuja los deltas de días previos (dentro de la ventana de
 * retención) cuyo hash no coincide con el último confirmado. Cada día tiene
 * hash-gating propio, así que los ya subidos se saltan sin tráfico.
 * Tope de 7 días por ciclo para no hacer ráfagas contra la cuota.
 */
const MAX_PENDING_DELTA_DAYS_PER_CYCLE = 7;
const SALES_WINDOW_DAILY_KEY = "pda_sales_window_last_push";
const SALES_WINDOW_DAILY_MS = 24 * 60 * 60 * 1000;
const pushPendingSalesDeltas = async (salesArray) => {
  if (!supabaseCloud || !isCloudSyncActive || !_currentDeviceId)
    return { ok: false, skipped: true };
  const today = salesDayString();
  const cutoff = Date.now() - RETENTION.SALES_SYNC_DAYS * 24 * 60 * 60 * 1000;
  const days = new Set();
  for (const t of Array.isArray(salesArray) ? salesArray : []) {
    const raw = t?.timestamp || t?.fecha;
    const ts = raw ? new Date(raw).getTime() : NaN;
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const day = salesDayString(new Date(ts));
    if (day !== today) days.add(day);
  }
  let pushed = 0;
  let checked = 0;
  for (const day of days) {
    if (checked >= MAX_PENDING_DELTA_DAYS_PER_CYCLE) break;
    checked++;
    const r = await pushSingleSalesDelta(salesArray, day, false);
    if (r?.ok && !r?.skipped) pushed++;
  }
  if (pushed > 0)
    console.info(`[CloudSync] Deltas de días previos re-empujados: ${pushed}`);
  // CRÍTICO-2(b) (2026-10-01): la ventana de 90 días se sube como respaldo
  // al menos 1 vez al día (además del cierre de caja explícito). Así un
  // supervisor que pida historial siempre tiene de dónde reconstruir.
  maybePushDailySalesWindow();
  return { ok: true, pushed, checked };
};

/** Sube la ventana de 90 días si hace más de 24h que no se sube. */
const maybePushDailySalesWindow = () => {
  try {
    const last = Number(localStorage.getItem(SALES_WINDOW_DAILY_KEY) || 0);
    if (Date.now() - last < SALES_WINDOW_DAILY_MS) return;
  } catch {
    return;
  }
  pushSalesWindow()
    .then((r) => {
      if (r?.ok) {
        try {
          localStorage.setItem(SALES_WINDOW_DAILY_KEY, String(Date.now()));
        } catch {}
        console.info("[CloudSync] Ventana de ventas diaria subida");
      }
    })
    .catch(() => {});
};

/**
 * QUOTA-003: sube la ventana completa de 90 días de ventas (podada).
 * Uso: 1 vez al día al cierre del negocio, o bajo demanda cuando un
 * supervisor pide historial completo. NO se llama en cada venta.
 */
export const pushSalesWindow = async () => {
  if (!supabaseCloud || !isCloudSyncActive || !_currentDeviceId) {
    return { ok: false, skipped: true, error: "Sync no activo" };
  }
  const deviceAccess = await validateCurrentDeviceSyncAccess(
    _currentDeviceId || localStorage.getItem("pda_device_id"),
  );
  if (!deviceAccess.ok) {
    return {
      ok: false,
      skipped: false,
      error: deviceAccess.error || "Equipo sin autorización activa",
    };
  }
  // La ventana también es una escritura del device_id propio, protegida por
  // la validación legacy de revocación o por membresía activa de cuenta.
  try {
    const salesArray = await appForage.getItem("bodega_sales_v1");
    if (!Array.isArray(salesArray))
      return { ok: false, error: "Sin ventas locales" };
    const payloadValue = pruneSalesForSync(
      salesArray,
      RETENTION.SALES_SYNC_DAYS,
    );
    const docId = toCloudDocId("bodega_sales_v1");
    const updatedAt = new Date().toISOString();
    const document = {
      device_id: _currentDeviceId,
      collection: "store",
      doc_id: docId,
      data: buildSyncEnvelope(payloadValue, updatedAt),
      updated_at: updatedAt,
    };
    await withSyncRetry(async () => {
      const res = await supabaseCloud
        .from("sync_documents")
        .upsert(document, { onConflict: "device_id,collection,doc_id" });
      if (res.error) throw res.error;
      return res;
    });
    try {
      localStorage.setItem(SALES_WINDOW_DAILY_KEY, String(Date.now()));
    } catch {}
    return { ok: true, updatedAt, windowTickets: payloadValue.length };
  } catch (error) {
    console.warn(
      "[CloudSync] No se pudo subir la ventana de ventas:",
      error?.message ?? error,
    );
    return { ok: false, error: error?.message || "Error de sincronización" };
  }
};

/**
 * SEC-009 / HOOK-011: Reemplazo EXPLÍCITO del antiguo monkeypatch.
 *
 * Los callers que escriban directamente en localStorage con una clave en LOCAL_KEYS
 * deben invocar esta función (o usar `storageService.setItem`) para que el cambio
 * se propague a la nube. Ya NO se intercepta automáticamente `localStorage.setItem`.
 *
 * @param {string} key
 * @param {any} value
 */
export const pushLocalSync = (key, value) => {
  if (!LOCAL_KEYS.includes(key) && !SYNC_KEYS.includes(key)) return;
  if (key === "abasto-auth-storage") return; // SEC-002
  _debouncePush(key, value);
};

/**
 * EGRESS-FIX (RC2 + RC5): encola un push de una key `store` a la nube a través
 * del debounce por-key (`_debouncePush`), en vez de empujar directo. Esto:
 *   • Agrupa ráfagas de ediciones en las keys pesadas (HEAVY_KEYS → 3000ms).
 *   • Colapsa el antiguo doble-push (storageService.setItem + listener de este
 *     hook) en un solo upsert, ya que ambos caían en la misma key del debounce.
 * `_debouncePush` → `pushCloudSync`, que respeta isSyncingFromCloud /
 * isCloudSyncActive / SYNC_KEYS, así que la seguridad anti-eco se preserva.
 *
 * @param {string} key
 * @param {any} value
 */
export const queueCloudSync = (key, value) => {
  if (!SYNC_KEYS.includes(key)) return;
  if (key === "abasto-auth-storage") return; // SEC-002
  _debouncePush(key, value);
};

/**
 * SYNC-MANUAL (2026-10-01): sincronización completa bajo demanda.
 * Pull + push manual, tras validar autorización y membresía. El pairing legacy
 * no habilita lecturas de documentos de otros dispositivos.
 *
 * @returns {Promise<{ok: boolean, pulled: number, pushed: number, message: string}>}
 */
/**
 * V2.1.49: Baja el registro de sedes solo de los dispositivos autorizados.
 * FUSIONA las versiones visibles según el acceso RLS de la cuenta activa.
 * Se llama al inicio de syncNow y al arrancar la app, con cuenta activa.
 * @returns {Promise<{ok: boolean, count: number, message: string}>}
 */
export const pullBusinessRegistry = async () => {
  if (!supabaseCloud) {
    return { ok: false, count: 0, message: "Sin conexión a la nube" };
  }
  const activeDeviceId =
    _currentDeviceId || localStorage.getItem("pda_device_id");
  const deviceAccess = await validateCurrentDeviceSyncAccess(activeDeviceId);
  if (!deviceAccess.ok) {
    return {
      ok: false,
      count: 0,
      message: deviceAccess.error || "Equipo sin autorización activa",
    };
  }
  if (!deviceAccess.context) {
    return {
      ok: false,
      count: 0,
      message:
        "Se requiere una cuenta con membresía activa para consultar sedes",
    };
  }
  try {
    const {
      mergeBusinessRegistry,
      mergeTombstones,
      pruneTombstoned,
      readTombstones,
      BUSINESS_REGISTRY_DOC_KEY,
    } =
      await import("../utils/businessRegistry.js");
    // Traer las versiones del registro visibles para los dispositivos de la cuenta.
    const { data, error } = await supabaseCloud
      .from("sync_documents")
      .select("data, updated_at")
      .in("device_id", deviceAccess.context.deviceIds)
      .eq("doc_id", BUSINESS_REGISTRY_DOC_KEY)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    if (!data || data.length === 0) {
      return { ok: false, count: 0, message: "No hay registro en la nube" };
    }
    const { useNegociosStore } = await import("./store/useNegociosStore.js");
    const st = useNegociosStore.getState();
    // Fusionar todas las versiones remotas entre sí, luego con lo local.
    // La unión por ID garantiza que ninguna sede se pierda.
    let merged = Array.isArray(st.negocios) ? [...st.negocios] : [];
    let remoteCount = 0;
    // V2.1.57: tumbas de eliminación — cualquier documento remoto puede
    // declarar sedes borradas; se respetan aunque filas viejas las traigan.
    let remoteTombstones = [];
    for (const row of data) {
      const payload = row?.data?.payload;
      if (!isValidBusinessRegistryDoc(payload)) {
        throw new Error(
          "El registro remoto de sedes tiene un formato inválido",
        );
      }
      remoteCount += payload.businesses.length;
      merged = mergeBusinessRegistry(merged, payload);
      remoteTombstones = mergeTombstones(
        remoteTombstones,
        readTombstones(payload),
      );
    }
    const before = st.negocios.length;
    const tombstones = mergeTombstones(
      Array.isArray(st.sedesEliminadas) ? st.sedesEliminadas : [],
      remoteTombstones,
    );
    const finalList = pruneTombstoned(merged, tombstones);
    if (typeof st.aplicarRegistroRemoto !== "function") {
      throw new Error("El store no puede aplicar el registro remoto de sedes");
    }
    await st.aplicarRegistroRemoto(finalList, tombstones);
    // V2.1.51: actualizar el caché sincronizado para que isDocForKnownBusiness
    // acepte docs de estas sedes inmediatamente (sin esperar a localStorage).
    try {
      const { setKnownBusinessIds } =
        await import("../utils/negocioContext.js");
      setKnownBusinessIds(finalList.map((n) => n?.id).filter(Boolean));
    } catch {
      /* noop */
    }
    console.log(
      `[pullBusinessRegistry] versiones=${data.length}, locales=${before}, remotos(total)=${remoteCount}, fusionados=${finalList.length}, tumbas=${tombstones.length}`,
    );
    return {
      ok: true,
      count: finalList.length,
      message: `${finalList.length} sedes`,
    };
  } catch (e) {
    console.warn("[pullBusinessRegistry] Error:", e?.message ?? e);
    return { ok: false, count: 0, message: e?.message ?? "Error" };
  }
};

export const syncNow = async () => {
  if (!supabaseCloud) {
    return {
      ok: false,
      pulled: 0,
      pushed: 0,
      message: "Sin conexión a la nube",
    };
  }
  const activeDeviceId =
    _currentDeviceId || localStorage.getItem("pda_device_id");
  if (!activeDeviceId) {
    return {
      ok: false,
      pulled: 0,
      pushed: 0,
      message: "Equipo no identificado",
    };
  }
  if (!isCloudSyncActive) {
    return {
      ok: false,
      pulled: 0,
      pushed: 0,
      message: "Sincronización no activa (revisa tu sesión)",
    };
  }
  let pulled = 0;
  let pushed = 0;
  try {
    const deviceAccess = await validateCurrentDeviceSyncAccess(activeDeviceId);
    if (!deviceAccess.ok) {
      return {
        ok: false,
        pulled,
        pushed,
        message:
          deviceAccess.error ||
          "El equipo no tiene autorización de sincronización",
      };
    }

    const accountCtx = deviceAccess.context;
    if (!accountCtx && deviceAccess.mode !== "legacy") {
      return {
        ok: false,
        pulled,
        pushed,
        message:
          "La sincronización manual requiere una cuenta o autorización legacy válida",
      };
    }
    if (accountCtx && !accountCtx.deviceIds.includes(activeDeviceId)) {
      return {
        ok: false,
        pulled,
        pushed,
        message:
          "El equipo ya no pertenece a la cuenta; sincronización cancelada",
      };
    }

    // El registro de sedes es global dentro de la cuenta: consultarlo solo
    // cuando hay una membresía activa. Legacy nunca usa esa ruta global.
    if (accountCtx) {
      const registryResult = await pullBusinessRegistry();
      if (
        !registryResult.ok &&
        registryResult.message !== "No hay registro en la nube"
      ) {
        return {
          ok: false,
          pulled,
          pushed,
          message: `No se pudo validar el registro de sedes: ${registryResult.message}`,
        };
      }
    }

    // ── PULL: bajar documentos nuevos de la nube ──
    // SYNC-MANUAL: ignora el watermark y trae todo lo del negocio activo.
    // El watermark optimiza los pulls automáticos, pero un sync manual
    // debe ser determinista: siempre trae lo último, sin depender del
    // estado del watermark local.
    if (accountCtx?.userId) {
      const wmKey = `cloud_pull_watermark_${accountCtx.userId}`;
      const { data: docs, error: docsError } = await supabaseCloud
        .from("sync_documents")
        .select("collection, doc_id, data, updated_at, device_id")
        .in("device_id", accountCtx.deviceIds)
        .in("collection", ["store", "local"])
        .order("updated_at", { ascending: true })
        .limit(2000);
      if (docsError) throw docsError;
      const pullDocs = Array.isArray(docs) ? docs : [];

      // El registro de sedes solo se consulta desde los dispositivos
      // autorizados de esta cuenta.
      let pullFailed = false;
      try {
        const { data: globalDocs, error: globalError } = await supabaseCloud
          .from("sync_documents")
          .select("collection, doc_id, data, updated_at, device_id")
          .in("device_id", accountCtx.deviceIds)
          .eq("doc_id", "bodega_businesses_registry_v1")
          .in("collection", ["store", "local"])
          .order("updated_at", { ascending: false })
          .limit(1);
        if (globalError) throw globalError;
        if (globalDocs && globalDocs.length > 0) {
          const gd = globalDocs[0];
          // Evitar duplicado si ya vino en el pull principal.
          if (!pullDocs.some((d) => d.doc_id === gd.doc_id)) {
            pullDocs.push(gd);
            console.log(
              `[syncNow] PULL global: registro de sedes de ${gd.device_id}`,
            );
          }
        }
      } catch (e) {
        pullFailed = true;
        console.warn(
          "[syncNow] No se pudo traer el registro global de sedes:",
          e?.message,
        );
      }

      // Los docs de todas las sedes de la cuenta se consultan solo desde
      // dispositivos que la membresía activa autoriza.
      try {
        const { data: businessDocs, error: businessError } = await supabaseCloud
          .from("sync_documents")
          .select("collection, doc_id, data, updated_at, device_id")
          .in("device_id", accountCtx.deviceIds)
          .like("doc_id", "nb\\_%")
          .in("collection", ["store", "local"])
          .order("updated_at", { ascending: false })
          .limit(500);
        if (businessError) throw businessError;
        if (businessDocs && businessDocs.length > 0) {
          let added = 0;
          for (const bd of businessDocs) {
            if (
              !pullDocs.some(
                (d) => d.doc_id === bd.doc_id && d.device_id === bd.device_id,
              )
            ) {
              pullDocs.push(bd);
              added++;
            }
          }
          if (added > 0)
            console.log(
              `[syncNow] PULL: ${added} docs adicionales de sedes autorizadas`,
            );
        }
      } catch (e) {
        pullFailed = true;
        console.warn(
          "[syncNow] No se pudo traer docs globales de sedes:",
          e?.message,
        );
      }

      console.log(`[syncNow] PULL: ${pullDocs.length} documentos de la nube`);
      let pullFailures = 0;
      for (const doc of pullDocs) {
        // V2.1.50: aceptar docs de cualquier sede conocida (para el supervisor).
        if (!isDocForKnownBusiness(doc.doc_id)) {
          console.log(`[syncNow] SKIP (no es de sede conocida): ${doc.doc_id}`);
          continue;
        }
        try {
          const applied = await _applyFromCloud(
            doc.doc_id,
            doc.collection,
            doc.data,
            doc.device_id,
          );
          console.log(
            `[syncNow] ${doc.doc_id}: ${applied ? "APLICADO" : "descartado (no es más nuevo)"}`,
          );
          if (applied) pulled++;
        } catch (e) {
          pullFailures++;
          console.warn(`[syncNow] Error aplicando ${doc.doc_id}:`, e);
        }
      }
      console.log(
        `[syncNow] PULL completo: ${pulled} aplicados; ${pullFailures} fallos`,
      );
      if (pullFailures > 0 || pullFailed) {
        return {
          ok: false,
          pulled,
          pushed,
          message: `Sync parcial: ${pullFailures} documento(s) fallaron al aplicar y${pullFailed ? " una consulta falló" : ""}; se reintentará en el próximo ciclo`,
        };
      }
      const maxTs = pullDocs.reduce(
        (m, d) => (d.updated_at && d.updated_at > m ? d.updated_at : m),
        localStorage.getItem(wmKey) || "",
      );
      if (maxTs) {
        try {
          localStorage.setItem(wmKey, maxTs);
        } catch {
          /* noop */
        }
      }
    } else if (deviceAccess.mode === "legacy") {
      // El pairing legacy solo puede leer la fila del propio equipo según RLS.
      const { data: docs, error: docsError } = await supabaseCloud
        .from("sync_documents")
        .select("collection, doc_id, data, updated_at, device_id")
        .eq("device_id", activeDeviceId)
        .in("collection", ["store", "local"])
        .order("updated_at", { ascending: true })
        .limit(2000);
      if (docsError) throw docsError;
      let pullFailures = 0;
      for (const doc of Array.isArray(docs) ? docs : []) {
        if (!isDocForKnownBusiness(doc.doc_id)) continue;
        try {
          const applied = await _applyFromCloud(
            doc.doc_id,
            doc.collection,
            doc.data,
            doc.device_id,
          );
          if (applied) pulled++;
        } catch (error) {
          pullFailures++;
          console.warn(
            `[syncNow] Error aplicando doc propio ${doc.doc_id}:`,
            error,
          );
        }
      }
      if (pullFailures > 0) {
        return {
          ok: false,
          pulled,
          pushed,
          message: `Sync parcial: ${pullFailures} documento(s) fallaron al aplicar`,
        };
      }
    }

    // ── PUSH: subir cambios locales ──
    const criticalKeys = [
      "bodega_sales_v1",
      "bodega_products_v1",
      "bodega_customers_v1",
      "bodega_customer_ledger_v1",
      "bodega_accounts_v2",
    ];
    for (const key of criticalKeys) {
      const val = await appForage.getItem(key);
      if (val !== null) {
        const res = await pushCloudSync(key, val);
        if (res?.ok && !res?.skipped) pushed++;
        else if (!res?.ok)
          throw new Error(res?.error || `Falló el push de ${key}`);
      }
    }

    // Reportar dispositivos al directorio (no bloquea)
    try {
      const { reportDevicesToDirectory } =
        await import("../services/cloudAccount.js");
      // La misma validación cubre dueño, dispositivo vinculado por código y
      // pairing legacy; no usar solo el directorio para validar cuentas.
      const finalAccess = await validateCurrentDeviceSyncAccess(activeDeviceId);
      if (!finalAccess.ok) {
        return {
          ok: false,
          pulled,
          pushed,
          message:
            finalAccess.error ||
            "No se pudo validar el estado del equipo; sincronización cancelada",
        };
      }
      localStorage.setItem("cloud_sync_ts", new Date().toISOString());
      reportDevicesToDirectory().catch(() => {});
    } catch (e) {
      console.warn(
        "[syncNow] No se pudo validar el estado del equipo:",
        e?.message,
      );
      return {
        ok: false,
        pulled,
        pushed,
        message:
          "No se pudo validar el estado del equipo; sincronización cancelada",
      };
    }
    const parts = [];
    if (pulled > 0) parts.push(`${pulled} actualizados`);
    if (pushed > 0) parts.push(`${pushed} subidos`);
    const detail =
      parts.length > 0 ? ` (${parts.join(", ")})` : " (todo al día)";
    return {
      ok: true,
      pulled,
      pushed,
      message: `Sincronizado correctamente${detail}`,
    };
  } catch (e) {
    console.error("[syncNow] Error:", e);
    return {
      ok: false,
      pulled,
      pushed,
      message: `No se pudo sincronizar: ${e?.message || "error de red"}`,
    };
  }
};

/**
 * Empuja de forma forzada TODOS los datos del punto de venta a la nube Supabase.
 * Se invoca al iniciar la app o al vincular el dispositivo.
 */
export const forceSyncAllPOSData = async (
  overrideDeviceId,
  forceUnconditional = false,
) => {
  if (!supabaseCloud) return { ok: false, error: "Supabase no disponible" };
  const isMonitor = localStorage.getItem("pda_pairing_mode") === "monitor";
  if (isMonitor) return { ok: true, skipped: true };

  const activeDeviceId =
    overrideDeviceId ||
    _currentDeviceId ||
    localStorage.getItem("pda_device_id");
  if (!activeDeviceId)
    return { ok: false, error: "Dispositivo no identificado" };

  if (!isCloudSyncActive) return { ok: false, error: "Sync no activo" };
  const deviceAccess = await validateCurrentDeviceSyncAccess(activeDeviceId);
  if (!deviceAccess.ok) {
    return {
      ok: false,
      error: deviceAccess.error || "Equipo sin autorización activa",
    };
  }

  try {
    // FASE 1: appForage lee del namespace del negocio activo.
    const criticalKeys = [
      "bodega_sales_v1",
      "bodega_products_v1",
      "bodega_customers_v1",
      "bodega_customer_ledger_v1",
      "bodega_accounts_v2",
    ];
    for (const key of criticalKeys) {
      const val = await appForage.getItem(key);
      if (val !== null) {
        const result = await pushCloudSync(key, val, forceUnconditional);
        if (!result?.ok) {
          throw new Error(result?.error || `Falló el push de ${key}`);
        }
      }
    }
    // Catálogo de usuarios sin PINs (SEC-002): vive en el auth store, no en appForage.
    const { usuarios } = useAuthStore.getState();
    if (Array.isArray(usuarios) && usuarios.length > 0) {
      const result = await pushCloudSync(
        "bodega_users_catalog_v1",
        buildUserCatalogDoc(usuarios, readUserTombstones()),
        forceUnconditional,
      );
      if (!result?.ok) {
        throw new Error(
          result?.error || "Falló el push del catálogo de usuarios",
        );
      }
    }
    return { ok: true };
  } catch (e) {
    console.warn("[CloudSync] Error en sincronización forzada POS:", e);
    return { ok: false, error: e?.message || "Error de sincronización" };
  }
};

// ─── Validación de Esquema para Sincronización Remota (DATA-001) ─────────────
const STORE_SCHEMAS = {
  bodega_products_v1: (data) => Array.isArray(data),
  // QUOTA-001: mapa liviano { productId: stock }.
  bodega_stock_v1: (data) => isValidStockMap(data),
  bodega_sales_v1: (data) => Array.isArray(data),
  bodega_customers_v1: (data) => Array.isArray(data),
  bodega_customer_ledger_v1: (data) =>
    Array.isArray(data) &&
    data.every(
      (movement) =>
        Boolean(movement?.id && movement?.customerId) &&
        Number.isFinite(Number(movement?.amountUsd)) &&
        Number(movement.amountUsd) >= 0 &&
        ["CREDIT", "DEBIT"].includes(movement?.direction),
    ),
  bodega_payment_methods_v1: (data) => Array.isArray(data),
  bodega_accounts_v2: (data) => Array.isArray(data),
  // Catálogo de usuarios sin PINs (SEC-002): `{ v: 1, users, deleted }`.
  bodega_users_catalog_v1: (data) => isValidUserCatalogDoc(data),
  bodega_categories_v1: (data) => Array.isArray(data),
  monitor_rates_v12: (data) => typeof data === "object" && data !== null,
  abasto_audit_log_v1: (data) => Array.isArray(data),
  pda_rate_mode: (data) =>
    typeof data === "string" &&
    ["bcv", "paralelo", "promedio", "custom"].includes(data),
};

/**
 * Aplica un documento recibido de la nube al almacenamiento local.
 * Garantiza que isSyncingFromCloud esté activo durante toda la operación.
 *
 * FASE 1: el doc_id viene como `nb_<negocioId>:<clave>`. Solo se aplican los
 * documentos de negocios conocidos o globales que ya pasaron autorización
 * de cuenta/dispositivo en el caller.
 */
async function _applyFromCloud(docId, collection, data, sourceDeviceId = null) {
  isSyncingFromCloud = true;
  try {
    if (!["store", "local"].includes(collection)) return false;

    // ── Filtro multi-negocio (Fase 1) + SEC-002 ──
    // V2.1.50: aceptar cualquier sede conocida (el supervisor lee todas).
    if (!isDocForKnownBusiness(docId)) return false;
    const { key, negocioId } = parseCloudDocId(docId);
    // V2.1.50: si el doc es de una sede NO activa, escribir directo con
    // el namespace correcto, sin pasar por el router (que usa la activa).
    const { NEGOCIO_KEY_PREFIX, getNegocioActivoId } =
      await import("../utils/negocioContext.js");
    const targetNegocioId = negocioId || getNegocioActivoId();
    const isOtherBusiness = negocioId && negocioId !== getNegocioActivoId();
    // Helper para leer/escribir en el namespace correcto.
    const { default: localforage } = await import("localforage");
    const nsKey = (k) =>
      isOtherBusiness ? `${NEGOCIO_KEY_PREFIX}${targetNegocioId}:${k}` : k;
    const nsGet = (k) =>
      isOtherBusiness ? localforage.getItem(nsKey(k)) : appForage.getItem(k);
    const nsSet = (k, v) =>
      isOtherBusiness
        ? localforage.setItem(nsKey(k), v)
        : appForage.setItem(k, v);

    const envelope = readSyncEnvelope(data);
    if (!envelope.valid) {
      console.warn(`[CloudSync] Envelope remoto rechazado: ${envelope.error}`);
      throw new Error(
        `Envelope remoto inválido para ${docId}: ${envelope.error}`,
      );
    }

    const { payload } = envelope;
    let payloadToStore = payload;

    const metadataKey = getSyncMetadataKey(docId);
    const previousUpdatedAt = localStorage.getItem(metadataKey);
    console.log(
      `[syncNow] ${docId}: remoto=${envelope.updatedAt} local=${previousUpdatedAt || "nunca"}`,
    );
    if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
      console.log(`[syncNow] ${docId}: DESCARTADO (remoto no es más nuevo)`);
      // M-17 (2026-10-01): el LWW descartaba en silencio. Si el contenido
      // remoto difiere del confirmado y la clave no es append-only, se
      // registra el conflicto para avisar en UI.
      if (!isMergeSemanticsKey(key)) {
        const hashKey = CONFIRMED_PUSH_HASH_PREFIX + docId;
        const confirmedHash = (() => {
          try {
            return localStorage.getItem(hashKey);
          } catch {
            return null;
          }
        })();
        if (confirmedHash && confirmedHash !== (await quickHash(payload))) {
          recordSyncConflict({
            key,
            docId,
            direction: "remote-discarded",
            detail: `Otro equipo también modificó ${friendlyConflictName(key)}; se conservó tu versión (más reciente).`,
          });
        }
      }
      return false;
    }

    // Contrato común del supervisor: incluso el primary debe rechazar
    // documentos no allowlisted antes de aplicarlos localmente.
    // Se valida con la clave BASE (sin prefijo de negocio).
    const supervisorValidation = validateSupervisorSyncDocument(key, payload);
    if (!supervisorValidation.valid) {
      console.warn(
        `[CloudSync] Documento remoto rechazado: ${supervisorValidation.error}`,
      );
      throw new Error(
        `Documento remoto inválido ${docId}: ${supervisorValidation.error}`,
      );
    }

    // DATA-001: Validación de Schema antes de escribir en almacenamiento local
    // QUOTA-003: el delta valida por su propio contrato (no está en STORE_SCHEMAS
    // porque la key es dinámica por día).
    if (isSalesDeltaKey(key)) {
      let deltaToValidate = payload;
      if (typeof payload === "string") {
        try {
          deltaToValidate = JSON.parse(payload);
        } catch {
          /* silenciar */
        }
      }
      if (!isValidSalesDelta(deltaToValidate)) {
        console.warn(
          `[CloudSync] Schema validation falló para ${key}, ignorando payload remoto.`,
        );
        throw new Error(`Schema inválido para documento remoto ${docId}`);
      }
    }
    const validator = STORE_SCHEMAS[key];
    if (validator) {
      let dataToValidate = payload;
      if (
        typeof payload === "string" &&
        (payload.startsWith("[") || payload.startsWith("{"))
      ) {
        try {
          dataToValidate = JSON.parse(payload);
        } catch {
          /* silenciar parse error */
        }
      }
      if (!validator(dataToValidate)) {
        console.warn(
          `[CloudSync] Schema validation falló para ${key}, ignorando payload remoto.`,
          payload,
        );
        throw new Error(`Schema inválido para documento remoto ${docId}`);
      }
    }

    if (collection === "local") {
      // Colección 'local' = claves globales (tasas): docId sin prefijo.
      const stringPayload =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      originalSetItem(docId, stringPayload); // Escribe sin pasar por interceptor (no existe ya)
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: docId,
          newValue: stringPayload,
          storageArea: localStorage,
        }),
      );
      window.dispatchEvent(
        new CustomEvent("app_storage_update", {
          detail: { key, source: "remote" },
        }),
      );
    } else {
      // Colección 'store' → IndexedDB del negocio activo vía appForage
      // (enruta la clave lógica al namespace correcto), sin pasar por
      // storageService.setItem.
      // El ledger es append-only: nunca se reemplaza por un snapshot remoto.
      if (key === "bodega_customer_ledger_v1") {
        const localLedger = await nsGet(key);
        const merged = mergeLedgerEntries(localLedger, payload);
        payloadToStore = merged.ledger;
        if (merged.conflicts.length > 0) {
          console.warn(
            `[CloudSync] Conflictos de ledger retenidos localmente: ${merged.conflicts.length}`,
          );
        }
      }
      // QUOTA-001: el mapa de stock se fusiona sobre el catálogo local.
      // Nunca reemplaza productos: solo actualiza existencias.
      // M-6 (2026-10-01): reconciliación por DELTAS por fuente en vez de
      // asignación absoluta (LWW perdía descuentos concurrentes). Los
      // docs del propio equipo se ignoran: lo local ya es autoritativo.
      if (key === "bodega_stock_v1" && payload && typeof payload === "object") {
        const ownId =
          _currentDeviceId ||
          (() => {
            try {
              return localStorage.getItem("pda_device_id");
            } catch {
              return null;
            }
          })();
        const isOwnDoc = Boolean(
          sourceDeviceId && ownId && sourceDeviceId === ownId,
        );
        const localProducts = await nsGet("bodega_products_v1");
        // V2.1.54: si no hay datos locales (post-Reparar), usar el remoto directamente.
        if (
          !Array.isArray(localProducts) &&
          Array.isArray(payload) &&
          !isOwnDoc
        ) {
          await nsSet("bodega_products_v1", payload);
          window.dispatchEvent(
            new CustomEvent("app_storage_update", {
              detail: { key: "bodega_products_v1", source: "remote" },
            }),
          );
        } else if (Array.isArray(localProducts) && !isOwnDoc) {
          const lastRemote = readLastRemoteStockMap(docId, sourceDeviceId);
          const { products: mergedProducts, nextRemoteMap } =
            applyStockMapDelta(localProducts, payload, lastRemote);
          writeLastRemoteStockMap(docId, sourceDeviceId, nextRemoteMap);
          if (mergedProducts !== localProducts) {
            await nsSet("bodega_products_v1", mergedProducts);
            window.dispatchEvent(
              new CustomEvent("app_storage_update", {
                detail: { key: "bodega_products_v1", source: "remote" },
              }),
            );
          }
        } else if (isOwnDoc) {
          // Sembrar el "último visto" propio por coherencia, sin tocar stock.
          writeLastRemoteStockMap(docId, sourceDeviceId, { ...payload });
        }
        const hashKey = LAST_PUSH_HASH_PREFIX + docId;
        const payloadHash = await quickHash(payload);
        localStorage.setItem(hashKey, payloadHash);
        localStorage.setItem(CONFIRMED_PUSH_HASH_PREFIX + docId, payloadHash);
        if (envelope.updatedAt)
          localStorage.setItem(metadataKey, envelope.updatedAt);
        // Log: cuántos productos tienen foto después de aplicar
        if (Array.isArray(payload)) {
          const conFoto = payload.filter((p) => p?.image).length;
          console.log(
            `[syncNow] ${docId}: APLICADO (${payload.length} productos, ${conFoto} con foto)`,
          );
        } else {
          console.log(`[syncNow] ${docId}: APLICADO`);
        }
        return true;
      }
      // ── Catálogo de usuarios sin PINs (SEC-002) ─────────────────────
      // Se fusiona preservando los PINs locales (mergeUserCatalog): los
      // usuarios nuevos quedan con `pinPendiente: true` y los borrados se
      // aplican vía tombstones. El doc jamás trae PINs.
      if (
        key === "bodega_users_catalog_v1" &&
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload)
      ) {
        try {
          const authState = useAuthStore.getState();
          const merged = mergeUserCatalog(authState.usuarios, payload);
          if (typeof authState.aplicarCatalogoRemoto !== "function") {
            throw new Error("El store no puede aplicar el catálogo remoto");
          }
          await authState.aplicarCatalogoRemoto(merged);
        } catch (e) {
          console.warn(
            "[CloudSync] No se pudo aplicar el catálogo de usuarios:",
            e?.message ?? e,
          );
          throw e;
        }
        window.dispatchEvent(
          new CustomEvent("app_storage_update", {
            detail: { key: "bodega_users_catalog_v1", source: "remote" },
          }),
        );
        const hashKey = LAST_PUSH_HASH_PREFIX + docId;
        const payloadHash = await quickHash(payload);
        localStorage.setItem(hashKey, payloadHash);
        localStorage.setItem(CONFIRMED_PUSH_HASH_PREFIX + docId, payloadHash);
        if (envelope.updatedAt)
          localStorage.setItem(metadataKey, envelope.updatedAt);
        return true;
      }
      // ── Registro de negocios (multi-sede) ───────────────────────────
      // Documento GLOBAL: permite que un equipo nuevo descubra
      // automáticamente las sedes. Se fusiona por id sin tocar el
      // negocio activo local.
      if (
        key === BUSINESS_REGISTRY_DOC_KEY &&
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload)
      ) {
        console.log(
          `[syncNow] ${docId}: validando registro de negocios`,
          JSON.stringify(payload).slice(0, 200),
        );
        try {
          const { useNegociosStore } =
            await import("./store/useNegociosStore.js");
          const negState = useNegociosStore.getState();
          console.log(
            `[syncNow] ${docId}: negocios locales=${negState.negocios.length}, remotos=${payload.businesses?.length}`,
          );
          const tombstones = mergeTombstones(
            negState.sedesEliminadas || [],
            readTombstones(payload),
          );
          const merged = pruneTombstoned(
            mergeBusinessRegistry(negState.negocios, payload),
            tombstones,
          );
          console.log(`[syncNow] ${docId}: fusionados=${merged.length}, tumbas=${tombstones.length}`);
          if (typeof negState.aplicarRegistroRemoto !== "function") {
            throw new Error("El store no puede aplicar el registro de sedes");
          }
          await negState.aplicarRegistroRemoto(merged, tombstones);
          console.log(`[syncNow] ${docId}: APLICADO registro de negocios`);
        } catch (e) {
          console.warn(
            "[CloudSync] No se pudo aplicar el registro de negocios:",
            e?.message ?? e,
          );
          throw e;
        }
        window.dispatchEvent(
          new CustomEvent("app_storage_update", {
            detail: { key: BUSINESS_REGISTRY_DOC_KEY, source: "remote" },
          }),
        );
        const hashKey2 = LAST_PUSH_HASH_PREFIX + docId;
        const payloadHash = await quickHash(payload);
        localStorage.setItem(hashKey2, payloadHash);
        localStorage.setItem(CONFIRMED_PUSH_HASH_PREFIX + docId, payloadHash);
        if (envelope.updatedAt)
          localStorage.setItem(metadataKey, envelope.updatedAt);
        return true;
      }
      // QUOTA-002: las ventas remotas llegan podadas (90 días); se
      // fusionan por id para jamás perder historial local.
      if (key === "bodega_sales_v1" && Array.isArray(payload)) {
        const localSales = await nsGet(key);
        payloadToStore = mergeSales(localSales, payload);
      }
      // QUOTA-003: el delta diario trae { date, tickets }; se fusiona por
      // id sobre las ventas locales (idempotente: duplicados no hacen daño)
      // y se guarda en `bodega_sales_v1`, no bajo la key del delta.
      if (isSalesDeltaKey(key)) {
        const localSales = await nsGet("bodega_sales_v1");
        const deltaTickets = salesDeltaTickets(payload);
        payloadToStore = mergeSales(localSales, deltaTickets);
        await nsSet("bodega_sales_v1", payloadToStore);
        window.dispatchEvent(
          new CustomEvent("app_storage_update", {
            detail: { key: "bodega_sales_v1", source: "remote" },
          }),
        );
        const hashKey = LAST_PUSH_HASH_PREFIX + docId;
        const payloadHash = await quickHash(payloadToStore);
        localStorage.setItem(hashKey, payloadHash);
        localStorage.setItem(CONFIRMED_PUSH_HASH_PREFIX + docId, payloadHash);
        if (envelope.updatedAt)
          localStorage.setItem(metadataKey, envelope.updatedAt);
        return true;
      }
      // M-17 (2026-10-01): si el documento local tiene cambios sin confirmar
      // y el remoto (más nuevo) los va a reemplazar, registrar el
      // conflicto antes de perderlos.
      if (!isMergeSemanticsKey(key)) {
        try {
          const hashKeyB = CONFIRMED_PUSH_HASH_PREFIX + docId;
          const confirmedHashB = localStorage.getItem(hashKeyB);
          const localValue = await nsGet(key);
          if (
            localValue != null &&
            confirmedHashB &&
            (await quickHash(localValue)) !== confirmedHashB &&
            (await quickHash(payloadToStore)) !== (await quickHash(localValue))
          ) {
            recordSyncConflict({
              key,
              docId,
              direction: "local-overwritten",
              detail: `Tus cambios sin sincronizar en ${friendlyConflictName(key)} fueron reemplazados por la versión más reciente de otro equipo.`,
            });
          }
        } catch {
          /* la detección nunca debe romper el sync */
        }
      }
      await nsSet(key, payloadToStore);
      if (key === "bodega_customer_ledger_v1") {
        const localCustomers = await nsGet("bodega_customers_v1");
        if (Array.isArray(localCustomers)) {
          await nsSet(
            "bodega_customers_v1",
            rebuildCustomersFromLedger(localCustomers, payloadToStore),
          );
          window.dispatchEvent(
            new CustomEvent("app_storage_update", {
              detail: { key: "bodega_customers_v1", source: "remote" },
            }),
          );
        }
      }

      // Notificar a los componentes React que lean este store (clave lógica)
      window.dispatchEvent(
        new CustomEvent("app_storage_update", {
          detail: { key, source: "remote" },
        }),
      );
    }

    // Update local hash to prevent periodic push from re-uploading what we just downloaded
    const hashKey = LAST_PUSH_HASH_PREFIX + docId;
    const storedHash = await quickHash(payloadToStore);
    localStorage.setItem(hashKey, storedHash);
    if (!isMergeSemanticsKey(key)) {
      localStorage.setItem(CONFIRMED_PUSH_HASH_PREFIX + docId, storedHash);
    }
    if (envelope.updatedAt)
      localStorage.setItem(metadataKey, envelope.updatedAt);
    return true;
  } finally {
    isSyncingFromCloud = false;
  }
}

// ─── Hook de React ─────────────────────────────────────────────────────────
export function useCloudSync(deviceId) {
  const isInitialized = useRef(false);

  useEffect(() => {
    if (!supabaseCloud || !deviceId) {
      console.info("[CloudSync] Listener no iniciado", {
        reason: !supabaseCloud
          ? "supabase_no_disponible"
          : "device_id_no_definido",
        deviceId: shortCloudSyncId(deviceId),
      });
      isCloudSyncActive = false;
      if (globalSubscription) {
        try {
          supabaseCloud.removeChannel(globalSubscription).catch(() => {});
        } catch {}
        globalSubscription = null;
        isInitialized.current = false;
        _currentDeviceId = "";
      }
      return;
    }

    // Si el deviceId cambió con respecto al inicializado, forzar reinicio y cleanup de suscripción
    if (isInitialized.current && _currentDeviceId !== deviceId) {
      if (globalSubscription) {
        try {
          supabaseCloud.removeChannel(globalSubscription).catch(() => {});
        } catch {}
        globalSubscription = null;
      }
      isInitialized.current = false;
    }

    if (isInitialized.current) return;

    _currentDeviceId = deviceId;

    const initSync = async () => {
      try {
        const { session, error: sessionError } =
          await ensureSupervisorSession();
        if (sessionError || !session) {
          isCloudSyncActive = false;
          console.warn("[CloudSync] Sesión no disponible para sincronizar", {
            deviceId: shortCloudSyncId(deviceId),
            error: sessionError?.message || "sin sesión",
          });
          return;
        }

        console.info("[CloudSync] Sesión Auth lista", {
          deviceId: shortCloudSyncId(deviceId),
          authUserId: shortCloudSyncId(session.user?.id),
        });

        // Comprobar cuenta/membresía activa desde servidor antes de permitir
        // lecturas multi-dispositivo. El pairing queda como compatibilidad
        // restringida al device_id propio según las políticas actuales.
        let deviceAccess = { ok: false, error: "No se pudo validar el equipo" };
        try {
          const registration = await ensureDeviceSessionRegistered(deviceId);
          if (!registration?.ok) {
            throw new Error(
              registration?.error?.message ||
                registration?.error ||
                "No se pudo registrar la identidad de este equipo",
            );
          }
          deviceAccess = await validateCurrentDeviceSyncAccess(deviceId);
        } catch (error) {
          deviceAccess = {
            ok: false,
            error: error?.message || "No se pudo validar el equipo",
          };
        }
        const accountCtx = deviceAccess.context || null;
        if (!deviceAccess.ok || (isAccountLinkedLocally() && !accountCtx)) {
          isCloudSyncActive = false;
          console.warn(
            "[CloudSync] Cuenta o equipo sin autorización activa; sync pausado",
            {
              deviceId: shortCloudSyncId(deviceId),
              error: deviceAccess.error || null,
            },
          );
          return;
        }

        let pairedMonitorId = null;
        if (!accountCtx) {
          const { data: pairing, error: pairingError } = await supabaseCloud
            .from("device_pairings")
            .select("monitor_device_id")
            .eq("primary_device_id", deviceId)
            .maybeSingle();

          console.info("[CloudSync] Pairing consultado", {
            deviceId: shortCloudSyncId(deviceId),
            paired: Boolean(pairing?.monitor_device_id),
            monitorDeviceId: shortCloudSyncId(pairing?.monitor_device_id),
            error: pairingError?.message || null,
          });

          if (pairingError || !pairing?.monitor_device_id) {
            isCloudSyncActive = false;
            console.warn(
              "[CloudSync] Sincronización pausada hasta completar el pairing",
              {
                reason: pairingError?.message || "pairing_sin_monitor",
                deviceId: shortCloudSyncId(deviceId),
              },
            );
            if (!globalSubscription) {
              globalSubscription = supabaseCloud
                .channel(`device_pairings:${deviceId}`)
                .on(
                  "postgres_changes",
                  {
                    event: "*",
                    schema: "public",
                    table: "device_pairings",
                    filter: `primary_device_id=eq.${deviceId}`,
                  },
                  () => {
                    isInitialized.current = false;
                    initSync();
                  },
                )
                .subscribe();
            }
            return;
          }
          pairedMonitorId = pairing.monitor_device_id;
        } else {
          console.info("[CloudSync] Modo cuenta activo", {
            deviceId: shortCloudSyncId(deviceId),
            mode: accountCtx.mode,
            devices: accountCtx.deviceIds.length,
          });
        }

        isCloudSyncActive = true;
        isInitialized.current = true;
        console.info("[CloudSync] Receptor activo", {
          deviceId: shortCloudSyncId(deviceId),
          monitorDeviceId: shortCloudSyncId(pairedMonitorId),
          accountMode: Boolean(accountCtx),
        });

        // Sincronizar automáticamente todos los datos del POS a la nube en segundo plano (Patrón Donde Juancho)
        // En modo cuenta el push va con hash-gating (sin forzar): siembra la
        // cuenta la primera vez y evita re-subir el catálogo en cada arranque.
        forceSyncAllPOSData(deviceId, !accountCtx)
          .then((result) => {
            if (result && !result.ok) {
              console.warn(
                "[CloudSync] No se completó la sincronización inicial:",
                result.error,
              );
            }
          })
          .catch((error) => {
            console.warn(
              "[CloudSync] Falló la sincronización inicial:",
              error?.message || error,
            );
          });

        // ── Pull Inicial / Sincronización de Importación ──
        // Declarar el snapshot fuera de la rama condicional: el bloque de
        // auto-recuperación posterior también necesita conocer qué claves
        // llegaron desde la nube.
        let docs = [];
        const backupImported =
          localStorage.getItem("pda_backup_imported_flag") === "true";

        if (backupImported) {
          console.log(
            "[CloudSync] Detectado backup importado localmente. Subiendo incondicionalmente a la nube...",
          );
          isCloudSyncActive = true;
          const criticalKeys = [
            "bodega_sales_v1",
            "bodega_products_v1",
            "bodega_customers_v1",
            "bodega_customer_ledger_v1",
            "bodega_accounts_v2",
          ];
          for (const key of criticalKeys) {
            const localValue = await appForage.getItem(key);
            if (localValue !== null) {
              const result = await pushCloudSync(key, localValue);
              if (!result?.ok) {
                throw new Error(
                  result?.error || `Falló la importación de ${key}`,
                );
              }
              const hash = await quickHash(localValue);
              localStorage.setItem(_pushHashKey(key), hash);
              localStorage.setItem(_confirmedPushKey(key), hash);
            }
          }
          localStorage.setItem("cloud_sync_ts", new Date().toISOString());
          localStorage.removeItem("pda_backup_imported_flag");
          console.log(
            "[CloudSync] Sincronización incondicional de importación completada.",
          );
        } else if (accountCtx) {
          // ── PULL MULTI-DISPOSITIVO (modo cuenta) ─────────────
          // Trae los documentos de todos los dispositivos vinculados
          // (propio + hermanos). Watermark por cuenta: solo lo nuevo
          // desde el último pull (egress). La corrección no depende
          // del watermark: _applyFromCloud ignora lo que no sea más
          // nuevo que la metadata local por documento.
          const wmKey = `cloud_pull_watermark_${accountCtx.userId}`;
          const watermark = localStorage.getItem(wmKey);
          let pullQuery = supabaseCloud
            .from("sync_documents")
            .select("collection, doc_id, data, updated_at, device_id")
            .in("device_id", accountCtx.deviceIds)
            .in("collection", ["store", "local"])
            .order("updated_at", { ascending: true })
            .limit(2000);
          if (watermark) pullQuery = pullQuery.gt("updated_at", watermark);

          const { data: initialDocs, error: docsError } = await pullQuery;

          if (docsError) throw docsError;
          docs = initialDocs || [];

          let applyFailures = 0;
          if (docs.length > 0) {
            for (const doc of docs) {
              // FASE 1 + SEC-002 + V2.1.50: documentos de sedes conocidas
              // (o globales); los legacy sin prefijo se ignoran.
              if (!isDocForKnownBusiness(doc.doc_id)) continue;
              try {
                await _applyFromCloud(
                  doc.doc_id,
                  doc.collection,
                  doc.data,
                  doc.device_id,
                );
              } catch (e) {
                applyFailures++;
                console.warn(
                  `[CloudSync] Error aplicando doc ${doc.doc_id}:`,
                  e,
                );
              }
            }
            console.log(
              `[CloudSync] Pull cuenta: ${docs.length} documentos de ${accountCtx.deviceIds.length} dispositivos.`,
            );
          }
          if (applyFailures > 0) {
            throw new Error(
              `Falló la aplicación de ${applyFailures} documento(s); se conservará el watermark para reintentar`,
            );
          }
          const maxTs = docs.reduce(
            (m, d) => (d.updated_at && d.updated_at > m ? d.updated_at : m),
            watermark || "",
          );
          if (maxTs) {
            try {
              localStorage.setItem(wmKey, maxTs);
            } catch {
              /* noop */
            }
          }
        } else {
          // Pairing legacy puede recuperar documentos propios; RLS y este
          // filtro impiden consultar los datos de otras cuentas/dispositivos.
          const { data: initialDocs, error: docsError } = await supabaseCloud
            .from("sync_documents")
            .select("collection, doc_id, data, updated_at, device_id")
            .eq("device_id", deviceId)
            .in("collection", ["store", "local"]);
          if (docsError) throw docsError;
          docs = initialDocs || [];

          let applyFailures = 0;
          for (const doc of docs) {
            if (!isDocForKnownBusiness(doc.doc_id)) continue;
            try {
              await _applyFromCloud(
                doc.doc_id,
                doc.collection,
                doc.data,
                doc.device_id,
              );
            } catch (error) {
              applyFailures++;
              console.warn(
                `[CloudSync] Error aplicando doc legacy ${doc.doc_id}:`,
                error,
              );
            }
          }
          if (applyFailures > 0) {
            throw new Error(
              `Falló la aplicación de ${applyFailures} documento(s) legacy; se reintentará`,
            );
          }
        }

        // ── Auto-recuperación: Purgar/subir datos locales que no llegaron a enviarse debido al bug anterior ──
        try {
          const criticalKeys = [
            "bodega_sales_v1",
            "bodega_products_v1",
            "bodega_customers_v1",
            "bodega_customer_ledger_v1",
            "bodega_accounts_v2",
          ];
          // FASE 1: los doc_id en la nube van namespaced; comparar contra eso.
          // Solo documentos del dispositivo propio cuentan como confirmación:
          // el doc de un equipo hermano no cubre el push de este dispositivo.
          const existingCloudKeys = new Set(
            (docs || [])
              .filter((d) => !d.device_id || d.device_id === deviceId)
              .map((d) => d.doc_id),
          );

          for (const key of criticalKeys) {
            const localValue = await appForage.getItem(key);
            if (localValue == null) continue;

            const hashKey = _pushHashKey(key);
            const confirmedHashKey = _confirmedPushHashKey(key);
            const currentHash = await quickHash(localValue);
            if (
              existingCloudKeys.has(toCloudDocId(key)) &&
              localStorage.getItem(confirmedHashKey) === currentHash
            ) {
              localStorage.setItem(hashKey, currentHash);
              continue;
            }

            // Subimos los datos locales a la base de datos para sincronizar el historial.
            // El hash solo se confirma si el upsert fue aceptado.
            const result = await pushCloudSync(key, localValue);
            // Un push SKIPPED (p. ej. "Cambio remoto en aplicación" mientras
            // el pull aplica documentos) no es un fallo: el ciclo periódico,
            // online o de visibilidad lo reintentará. Marcar el hash como
            // confirmado sin upsert taparía el dato pendiente.
            if (!result?.ok && !result?.skipped) {
              throw new Error(
                result?.error || `Falló la recuperación de ${key}`,
              );
            }
            if (result?.ok && !result?.skipped) {
              localStorage.setItem(hashKey, currentHash);
              localStorage.setItem(confirmedHashKey, currentHash);
            }
          }
        } catch (error) {
          console.warn(
            "[CloudSync] No se pudo recuperar un push pendiente:",
            error?.message,
          );
          throw error;
        }

        // ── Suscripción WebSocket Realtime ─────────────────────────
        // EGRESS-FIX (RC3): ELIMINADA la auto-suscripción a `sync:${deviceId}`.
        // El dispositivo principal es el ÚNICO escritor de su propio device_id,
        // así que ese canal solo le devolvía el ECO de sus propias escrituras
        // (egress puro de Realtime, sin valor). El monitor del dueño mantiene su
        // propia suscripción independiente en useMonitorSync (canal
        // `monitor:${pairedDeviceId}`), por lo que sigue recibiendo cambios en
        // vivo. El estado inicial se obtiene con el pull por PostgREST de arriba.
      } catch (err) {
        console.error("[CloudSync] Fallo en inicialización:", err);
        isInitialized.current = false;
        isCloudSyncActive = false;
      }
    };

    initSync().catch((error) => {
      isInitialized.current = false;
      isCloudSyncActive = false;
      console.error("[CloudSync] Fallo inesperado en inicialización:", error);
    });

    // ── MECANISMOS DE SINCRONIZACIÓN AUTOMÁTICA Y CONTINUA ──
    //
    // EGRESS-FIX (RC2): ELIMINADO el listener de `app_storage_update` que
    // re-empujaba a la nube. Era la segunda mitad del doble-push: cada escritura
    // por `storageService.setItem` ya encola el push (ahora vía queueCloudSync),
    // así que este listener solo duplicaba el upsert (y su broadcast de Realtime).
    // Ningún write local dependía SOLO de este listener.

    // Escuchar evento 'online' y temporizador periódico para sincronizar datos locales pendientes
    // HOOK: solo re-sube una key si cambió desde el último push (evita gastar cuota de
    // Supabase/Realtime subiendo el mismo dato sin cambios cada 20s — ver quickHash arriba).
    const forcePushLocalData = async () => {
      if (isSyncingFromCloud || !deviceId) return;
      try {
        const criticalKeys = [
          "bodega_sales_v1",
          "bodega_products_v1",
          "bodega_customers_v1",
          "bodega_customer_ledger_v1",
          "bodega_accounts_v2",
        ];
        for (const key of criticalKeys) {
          const localValue = await appForage.getItem(key);
          if (localValue == null) continue;

          const hashKey = _pushHashKey(key);
          const confirmedHashKey = _confirmedPushHashKey(key);
          const currentHash = await quickHash(localValue);
          if (localStorage.getItem(confirmedHashKey) === currentHash) {
            localStorage.setItem(hashKey, currentHash);
            continue;
          }

          const result = await pushCloudSync(key, localValue);
          if (!result?.ok) {
            throw new Error(result?.error || `Falló el reintento de ${key}`);
          }
          localStorage.setItem(hashKey, currentHash);
          localStorage.setItem(confirmedHashKey, currentHash);
        }
      } catch (e) {
        console.warn("[CloudSync] Reintento local no completado:", e?.message);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        forcePushLocalData();
      }
    };

    window.addEventListener("online", forcePushLocalData);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // AUTO-SYNC PERIÓDICO (2026-10-01): sincronización completa (pull+push)
    // cada 5 minutos en background. El usuario no debe pulsar ningún botón.
    const periodicSync = setInterval(
      async () => {
        if (isSyncingFromCloud || !isCloudSyncActive) return;
        if (document.visibilityState !== "visible") return;
        try {
          const res = await syncNow();
          if (res.ok && (res.pulled > 0 || res.pushed > 0)) {
            console.log(`[AutoSync] Periódico: ${res.message}`);
          }
        } catch (e) {
          // Silencioso: el próximo ciclo reintenta
        }
      },
      5 * 60 * 1000,
    );

    return () => {
      isCloudSyncActive = false;
      window.removeEventListener("online", forcePushLocalData);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(periodicSync);

      // HOOK-012: limpiar suscripción en cleanup para evitar leaks.
      if (globalSubscription) {
        try {
          supabaseCloud.removeChannel(globalSubscription).catch(() => {});
        } catch {}
        globalSubscription = null;
        isInitialized.current = false;
        _currentDeviceId = "";
      }
    };
  }, [deviceId]);
}
