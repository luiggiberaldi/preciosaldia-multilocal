import { useEffect, useRef } from "react";
import { appForage } from "../utils/appForage";
import { supabaseCloud } from "../config/supabaseCloud";
import { useAuthStore } from "./store/useAuthStore";
import {
  toCloudDocId,
  parseCloudDocId,
  isDocForKnownBusiness,
  getNegocioActivoId,
  isGlobalKey,
} from "../utils/negocioContext";
import {
  SUPERVISOR_SYNC_KEYS,
  isSupervisorSyncKey,
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
  buildOwnStockMap,
  accumulateReceivedStock,
  preserveLocalStock,
  isSalesDeltaKey,
  normalizeSalesDeltaPayload,
  isValidSalesDelta,
  isValidStockMap,
  mergeSales,
  pruneSalesForSync,
  salesDayString,
  salesDeltaKeyForDate,
  salesDeltaTickets,
  physicalDocId,
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
  isUnconfirmedLocalConflict,
} from "../utils/syncConflicts";
import { contentHash } from "../utils/contentHash";
import {
  cloudPullScope,
  fetchCloudPullPage,
  runCloudPull,
  publishCloudPullStatus,
  retainCloudPullFailure,
  resolveCloudPullFailure,
  hasPendingCloudKey,
  getCloudPullStatus,
} from "../services/cloudPullService";

// Claves con semántica append-only o de fusión: su descarte/merge no es un
// conflicto a reportar (M-17 solo vigila documentos NO append-only).
const MERGED_SYNC_KEYS = new Set([
  "bodega_sales_v1",
  "bodega_customer_ledger_v1",
  "bodega_stock_v1",
  "bodega_users_catalog_v1",
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
const LOCAL_SYNC_BASELINE_PREFIX = "bodega_local_sync_baseline_hash_";
const _pushHashKey = (key) => LAST_PUSH_HASH_PREFIX + toCloudDocId(key);
const _confirmedPushHashKey = (key) =>
  CONFIRMED_PUSH_HASH_PREFIX + toCloudDocId(key);
const _confirmedDocHashKey = (docId) => CONFIRMED_PUSH_HASH_PREFIX + docId;
const _localSyncBaselineKey = (docId) => LOCAL_SYNC_BASELINE_PREFIX + docId;
const syncConflictHash = (key, value) =>
  quickHash(key === "bodega_products_v1" ? catalogFingerprint(value) : value);


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

/* Recibido de otras fuentes por producto (suma de deltas aplicados). Se resta al
   publicar el stock propio para no re-publicar cambios ajenos (eco). */
const receivedStockKey = (docId) => `pda_stock_received_${docId}`;
function readReceivedStockMap(docId) {
  try {
    const raw = localStorage.getItem(receivedStockKey(docId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeReceivedStockMap(docId, map) {
  try {
    localStorage.setItem(receivedStockKey(docId), JSON.stringify(map || {}));
  } catch {
    /* cuota llena: el próximo pull vuelve a acumular desde el último visto */
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
const pendingPush = new Map(); // Debounce por destino físico + instalación.
let pushSequence = Promise.resolve();

// Una revisión vieja no puede completar su retry DESPUÉS de la revisión nueva.
// Serializar el ciclo completo (incluidos stock/catálogo/días) evita ese rollback.
function serializePush(task) {
  const result = pushSequence.then(task, task);
  pushSequence = result.catch(() => {
    /* el caller recibe el error; la cola continúa */
  });
  return result;
}

function capturePushTarget(key) {
  const docId = toCloudDocId(key);
  const parsed = parseCloudDocId(docId);
  return Object.freeze({
    key: parsed.key,
    docId,
    negocioId: parsed.negocioId,
    deviceId: _currentDeviceId || localStorage.getItem("pda_device_id"),
  });
}

const relatedPushTarget = (target, key) =>
  Object.freeze({
    ...target,
    key,
    docId: isGlobalKey(key) ? key : physicalDocId(target.negocioId, key),
  });
const isCurrentPushTarget = (target) =>
  isCloudSyncActive &&
  target.deviceId === _currentDeviceId &&
  target.deviceId === localStorage.getItem("pda_device_id");
const changedPushSession = () => ({
  ok: false,
  skipped: false,
  error: "La sesión de sincronización cambió; escritura no confirmada",
});
let _currentDeviceId = ""; // Device ID activo para pushCloudSync
let isCloudSyncActive = false; // Evita empujar a la nube si el dispositivo no está autenticado/emparejado
let pullCoverageIncomplete = true; // No publicar snapshots antes de completar lectura/checkpoint.

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
  const target = capturePushTarget(key);
  const slot = JSON.stringify([target.deviceId, target.docId]);
  const snapshot = structuredClone(value);
  if (pendingPush.has(slot)) clearTimeout(pendingPush.get(slot));
  key = target.key;
  const delay = HEAVY_KEYS.includes(key)
    ? DEBOUNCE_HEAVY_MS
    : DEBOUNCE_LIGHT_MS;
  pendingPush.set(
    slot,
    setTimeout(() => {
      pendingPush.delete(slot);
      // B-13 (2026-10-01): antes los errores se tragaban con `.catch(() => {})`
      // y el push fallaba en silencio. Ahora se registran (evento + último
      // error consultable) para que la UI pueda avisar.
      serializePush(() => pushCloudSyncImpl(key, snapshot, false, target))
        .then((res) => {
          if (res && res.ok === false && !res.skipped)
            recordSyncPushError(key, res.error);
        })
        .catch((err) => {
          recordSyncPushError(key, err?.message || String(err));
        });
    }, delay),
  );
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
  const target = capturePushTarget(key);
  const snapshot = structuredClone(value);
  return serializePush(() =>
    pushCloudSyncImpl(target.key, snapshot, forceUnconditional, target),
  );
};

const pushCloudSyncImpl = async (key, value, forceUnconditional, target) => {
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

  if (!isCurrentPushTarget(target)) return changedPushSession();
  const deviceAccess = await validateCurrentDeviceSyncAccess(target.deviceId);
  if (!isCurrentPushTarget(target)) return changedPushSession();
  if (!deviceAccess.ok) {
    return {
      ok: false,
      skipped: false,
      error: deviceAccess.error || "Equipo sin autorización activa",
    };
  }

  if (pullCoverageIncomplete) {
    return {
      ok: true,
      skipped: true,
      pending: true,
      reason: "Pull pendiente de completar",
    };
  }
  // Un pendiente remoto de esta clave no debe ser tapado por un snapshot local.
  // Las otras claves/sedes siguen operativas y los cambios locales se conservan.
  if (
    key !== "bodega_sales_v1" &&
    (await hasPendingCloudKey(
      cloudPullScope(deviceAccess.context, target.deviceId),
      target.docId,
    ))
  ) {
    return {
      ok: true,
      skipped: true,
      pending: true,
      reason: "Documento remoto pendiente de revisión",
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
    const stockResult = await pushCloudSyncImpl(
      "bodega_stock_v1",
      buildOwnStockMap(
        value,
        readReceivedStockMap(relatedPushTarget(target, "bodega_stock_v1").docId),
      ),
      forceUnconditional,
      relatedPushTarget(target, "bodega_stock_v1"),
    );
    if (!stockResult?.ok || stockResult.pending) return stockResult;
    if (!forceUnconditional) {
      const chKey = `${LAST_PUSH_HASH_PREFIX}catalog:${target.docId}`;
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

  const docId = target.docId;
  const hashKey = LAST_PUSH_HASH_PREFIX + docId;
  const confirmedHashKey = CONFIRMED_PUSH_HASH_PREFIX + docId;
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
    return await pushSalesDelta(value, forceUnconditional, target);
  }
  const payloadValue = value;

  const collectionType = LOCAL_KEYS.includes(key) ? "local" : "store";
  const updatedAt = new Date().toISOString();
  const document = {
    device_id: target.deviceId,
    collection: collectionType,
    doc_id: docId,
    data: buildSyncEnvelope(payloadValue, updatedAt),
    updated_at: updatedAt,
  };

  try {
    const result = await withSyncRetry(async () => {
      if (!isCurrentPushTarget(target))
        throw new Error("La sesión de sincronización cambió");
      const response = await supabaseCloud
        .from("sync_documents")
        .upsert(document, { onConflict: "device_id,collection,doc_id" });
      if (response.error) throw response.error;
      if (!isCurrentPushTarget(target))
        throw new Error(
          "La sesión de sincronización cambió; ACK no confirmado",
        );
      return response;
    });

    // Solo confirmar los hashes después de que Supabase confirmó el upsert.
    localStorage.setItem(hashKey, currentHash);
    localStorage.setItem(confirmedHashKey, currentHash);
    if (key === "bodega_products_v1" || key === "bodega_accounts_v2") {
      localStorage.setItem(
        _localSyncBaselineKey(docId),
        await syncConflictHash(key, value),
      );
    }
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
  target,
) => {
  if (!isCurrentPushTarget(target)) return changedPushSession();
  const deviceAccess = await validateCurrentDeviceSyncAccess(target.deviceId);
  if (!isCurrentPushTarget(target)) return changedPushSession();
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
  const docId = relatedPushTarget(target, deltaKey).docId;
  if (
    pullCoverageIncomplete ||
    (await hasPendingCloudKey(
      cloudPullScope(deviceAccess.context, target.deviceId),
      docId,
    ))
  )
    return {
      ok: true,
      skipped: true,
      pending: true,
      reason: "Delta de este día pendiente de revisión",
    };
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
    device_id: target.deviceId,
    collection: "store",
    doc_id: docId,
    data: buildSyncEnvelope(payload, updatedAt),
    updated_at: updatedAt,
  };

  try {
    const result = await withSyncRetry(async () => {
      if (!isCurrentPushTarget(target))
        throw new Error("La sesión de sincronización cambió");
      const response = await supabaseCloud
        .from("sync_documents")
        .upsert(document, { onConflict: "device_id,collection,doc_id" });
      if (response.error) throw response.error;
      if (!isCurrentPushTarget(target))
        throw new Error(
          "La sesión de sincronización cambió; ACK no confirmado",
        );
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
  const target = capturePushTarget(docKey);
  const snapshot = structuredClone(value);
  return serializePush(() => pushPayrollDocImpl(target.key, snapshot, target));
};
const pushPayrollDocImpl = async (docKey, value, target) => {
  if (!supabaseCloud || !isCloudSyncActive || !_currentDeviceId) {
    return { ok: false, skipped: true, error: "Sync no activo" };
  }
  if (!isCurrentPushTarget(target)) return changedPushSession();
  const deviceAccess = await validateCurrentDeviceSyncAccess(target.deviceId);
  if (!isCurrentPushTarget(target)) return changedPushSession();
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
  const docId = target.docId;
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
    device_id: target.deviceId,
    collection: "store",
    doc_id: docId,
    data: buildSyncEnvelope(value, updatedAt),
    updated_at: updatedAt,
  };
  try {
    const response = await withSyncRetry(async () => {
      if (!isCurrentPushTarget(target))
        throw new Error("La sesión de sincronización cambió");
      const res = await supabaseCloud
        .from("sync_documents")
        .upsert(document, { onConflict: "device_id,collection,doc_id" });
      if (res.error) throw res.error;
      if (!isCurrentPushTarget(target))
        throw new Error(
          "La sesión de sincronización cambió; ACK no confirmado",
        );
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

const pushSalesDelta = async (salesArray, forceUnconditional, target) => {
  const result = await pushSingleSalesDelta(
    salesArray,
    salesDayString(),
    forceUnconditional,
    target,
  );
  // CRÍTICO-2(a) (2026-10-01): si el equipo estuvo offline días previos, sus
  // deltas nunca se empujaron. Esperar los ACK, conservando sede e instalación.
  if (result?.ok) {
    const previous = await pushPendingSalesDeltas(salesArray, target);
    if (!previous.ok) return previous;
    if (previous.pending) return { ...result, pending: true };
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
const pushPendingSalesDeltas = async (salesArray, target) => {
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
  let pending = false;
  for (const day of days) {
    if (checked >= MAX_PENDING_DELTA_DAYS_PER_CYCLE) break;
    checked++;
    const r = await pushSingleSalesDelta(salesArray, day, false, target);
    if (!r?.ok) return r;
    if (r.pending) pending = true;
    if (!r?.skipped) pushed++;
  }
  if (pushed > 0)
    console.info(`[CloudSync] Deltas de días previos re-empujados: ${pushed}`);
  // CRÍTICO-2(b) (2026-10-01): la ventana de 90 días se sube como respaldo
  // al menos 1 vez al día (además del cierre de caja explícito). Así un
  // supervisor que pida historial siempre tiene de dónde reconstruir.
  const windowResult = await maybePushDailySalesWindow(target);
  if (windowResult && !windowResult.ok) return windowResult;
  if (windowResult?.pending) pending = true;
  return { ok: true, pushed, checked, pending };
};

/** Sube la ventana de 90 días si hace más de 24h que no se sube. */
const salesWindowDailyKey = (target) =>
  `${SALES_WINDOW_DAILY_KEY}:${target.docId}`;
const maybePushDailySalesWindow = async (target) => {
  try {
    const last = Number(localStorage.getItem(salesWindowDailyKey(target)) || 0);
    if (Date.now() - last < SALES_WINDOW_DAILY_MS) return;
  } catch {
    return;
  }
  const result = await pushSalesWindowImpl(
    relatedPushTarget(target, "bodega_sales_v1"),
  );
  // Un push explícito puede aportar tickets sin que exista snapshot local.
  if (result.error === "Sin ventas locales") return;
  if (result.ok && !result.skipped)
    console.info("[CloudSync] Ventana de ventas diaria subida");
  return result;
};

/**
 * QUOTA-003: sube la ventana completa de 90 días de ventas (podada).
 * Uso: 1 vez al día al cierre del negocio, o bajo demanda cuando un
 * supervisor pide historial completo. NO se llama en cada venta.
 */
export const pushSalesWindow = async () => {
  const target = capturePushTarget("bodega_sales_v1");
  return serializePush(() => pushSalesWindowImpl(target));
};
const pushSalesWindowImpl = async (target) => {
  if (!supabaseCloud || !isCloudSyncActive || !_currentDeviceId) {
    return { ok: false, skipped: true, error: "Sync no activo" };
  }
  if (!isCurrentPushTarget(target)) return changedPushSession();
  const deviceAccess = await validateCurrentDeviceSyncAccess(target.deviceId);
  if (!isCurrentPushTarget(target)) return changedPushSession();
  if (!deviceAccess.ok) {
    return {
      ok: false,
      skipped: false,
      error: deviceAccess.error || "Equipo sin autorización activa",
    };
  }
  // La ventana no puede saltarse el bloqueo de su clave ni el checkpoint.
  if (
    pullCoverageIncomplete ||
    (await hasPendingCloudKey(
      cloudPullScope(deviceAccess.context, target.deviceId),
      target.docId,
    ))
  )
    return {
      ok: true,
      skipped: true,
      pending: true,
      reason: "Ventas pendientes de conciliación remota",
    };
  // La ventana también es una escritura del device_id propio, protegida por
  // la validación legacy de revocación o por membresía activa de cuenta.
  try {
    const salesArray = await appForage.getItem(target.docId);
    if (!Array.isArray(salesArray))
      return { ok: false, error: "Sin ventas locales" };
    const payloadValue = pruneSalesForSync(
      salesArray,
      RETENTION.SALES_SYNC_DAYS,
    );
    const docId = target.docId;
    const updatedAt = new Date().toISOString();
    const document = {
      device_id: target.deviceId,
      collection: "store",
      doc_id: docId,
      data: buildSyncEnvelope(payloadValue, updatedAt),
      updated_at: updatedAt,
    };
    await withSyncRetry(async () => {
      if (!isCurrentPushTarget(target))
        throw new Error("La sesión de sincronización cambió");
      const res = await supabaseCloud
        .from("sync_documents")
        .upsert(document, { onConflict: "device_id,collection,doc_id" });
      if (res.error) throw res.error;
      if (!isCurrentPushTarget(target))
        throw new Error(
          "La sesión de sincronización cambió; ACK no confirmado",
        );
      return res;
    });
    try {
      localStorage.setItem(salesWindowDailyKey(target), String(Date.now()));
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
  const baseKey = parseCloudDocId(key).key;
  if (!LOCAL_KEYS.includes(baseKey) && !SYNC_KEYS.includes(baseKey)) return;
  if (baseKey === "abasto-auth-storage") return; // SEC-002
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
  const baseKey = parseCloudDocId(key).key;
  if (!SYNC_KEYS.includes(baseKey)) return;
  if (baseKey === "abasto-auth-storage") return; // SEC-002
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
    } = await import("../utils/businessRegistry.js");
    // Traer las versiones del registro visibles para los dispositivos de la cuenta.
    const { data, error } = await supabaseCloud
      .from("sync_documents")
      .select("collection, doc_id, device_id, data, updated_at")
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
    let invalidRegistries = 0;
    const validRows = [];
    const scope = cloudPullScope(deviceAccess.context, activeDeviceId);
    for (const row of data) {
      const payload = row?.data?.payload;
      if (
        !readSyncEnvelope(row.data).valid ||
        !isValidBusinessRegistryDoc(payload)
      ) {
        await retainCloudPullFailure(scope, row, "invalid-registry");
        invalidRegistries++;
        continue;
      }
      validRows.push(row);
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
    if (validRows.length) await st.aplicarRegistroRemoto(finalList, tombstones);
    for (const row of validRows) await resolveCloudPullFailure(scope, row);
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
      partial: invalidRegistries > 0,
      pending: invalidRegistries,
      message: `${finalList.length} sedes${invalidRegistries ? `; ${invalidRegistries} registros pendientes` : ""}`,
    };
  } catch (e) {
    console.warn("[pullBusinessRegistry] Error:", e?.message ?? e);
    return { ok: false, count: 0, message: e?.message ?? "Error" };
  }
};

async function pullCloudDocuments(access, deviceId, manual = false) {
  const deviceIds = access.context?.deviceIds || [deviceId];
  const result = await runCloudPull({
    scope: cloudPullScope(access.context, deviceId),
    deviceIds,
    manual,
    fetchPage: async (options) => {
      const current = await validateCurrentDeviceSyncAccess(deviceId);
      if (!current.ok) throw new Error("Acceso de pull no disponible");
      const currentIds = current.context?.deviceIds || [deviceId];
      if (deviceIds.some((id) => !currentIds.includes(id)))
        throw new Error("Membresía cambió durante el pull");
      return fetchCloudPullPage(supabaseCloud, deviceIds, options);
    },
    classify: (row) => {
      const { key } = parseCloudDocId(row.doc_id);
      if (!isSupervisorSyncKey(key)) return "skip";
      if (!isDocForKnownBusiness(row.doc_id)) return "unknown-business";
      return null;
    },
    apply: async (row) => {
      if (!isCloudSyncActive || deviceId !== _currentDeviceId)
        throw new Error("Sesión de pull cambió");
      return _applyFromCloud(
        row.doc_id,
        row.collection,
        row.data,
        row.device_id,
      );
    },
  });
  pullCoverageIncomplete = result.queryFailed;
  publishCloudPullStatus(deviceId, {
    ...result,
    status: result.status === "confirmed" ? "pulling" : result.status,
  });
  return result;
}

let syncCycle = Promise.resolve();
function serializeSyncCycle(task) {
  const result = syncCycle.then(task, task);
  syncCycle = result.catch(() => {
    /* caller observes failure; allow the next cycle */
  });
  return result;
}
export const syncNow = (options) => {
  const target = capturePushTarget("bodega_sales_v1");
  return serializeSyncCycle(() => syncNowImpl(options, target));
};
const syncNowImpl = async ({ manual = true } = {}, cycleTarget) => {
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
  let pullResult = null;
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

    // Manual re-reads current revisions and explicitly retries retained failures.
    pullResult = await pullCloudDocuments(deviceAccess, activeDeviceId, manual);
    pulled = pullResult.applied;
    // A query/storage failure is not merely a bad document: do not publish
    // snapshots from a pull whose coverage could not be established.
    if (pullResult.queryFailed) {
      return {
        ok: false,
        partial: true,
        pulled,
        pushed,
        pending: pullResult.pending,
        message:
          "Sync parcial: consulta o almacenamiento incompleto; los pendientes se conservan",
      };
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
      const physicalKey = relatedPushTarget(cycleTarget, key).docId;
      const val = await appForage.getItem(physicalKey);
      if (val !== null) {
        const res = await pushCloudSync(physicalKey, val);
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
        publishCloudPullStatus(activeDeviceId, {
          ...pullResult,
          pushed,
          status: "partial",
        });
        return {
          ok: false,
          pulled,
          pushed,
          message:
            finalAccess.error ||
            "No se pudo validar el estado del equipo; sincronización cancelada",
        };
      }
      if (pullResult.pending === 0)
        localStorage.setItem("cloud_sync_ts", new Date().toISOString());
      reportDevicesToDirectory().catch(() => {});
    } catch (e) {
      console.warn(
        "[syncNow] No se pudo validar el estado del equipo:",
        e?.message,
      );
      publishCloudPullStatus(activeDeviceId, {
        ...pullResult,
        pushed,
        status: "partial",
      });
      return {
        ok: false,
        pulled,
        pushed,
        message:
          "No se pudo validar el estado del equipo; sincronización cancelada",
      };
    }
    publishCloudPullStatus(activeDeviceId, {
      ...pullResult,
      pushed,
      confirmedSync: pullResult.pending === 0,
    });
    if (pullResult.pending > 0) {
      return {
        ok: false,
        partial: true,
        pulled,
        pushed,
        pending: pullResult.pending,
        skipped: pullResult.skipped,
        message: `Sync parcial: ${pulled} aplicados, ${pushed} subidos y ${pullResult.pending} pendientes de revisión/reintento`,
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
    publishCloudPullStatus(activeDeviceId, {
      ...pullResult,
      applied: pulled,
      pushed,
      status: pulled || pushed || pullResult?.pending ? "partial" : "failed",
    });
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
  const cycleTarget = capturePushTarget("bodega_sales_v1");
  // Los usuarios/tumbas del store corresponden a la sede en este instante.
  const userCatalog = buildUserCatalogDoc(
    useAuthStore.getState().usuarios,
    readUserTombstones(),
  );
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
      const physicalKey = relatedPushTarget(cycleTarget, key).docId;
      const val = await appForage.getItem(physicalKey);
      if (val !== null) {
        const result = await pushCloudSync(
          physicalKey,
          val,
          forceUnconditional,
        );
        if (!result?.ok) {
          throw new Error(result?.error || `Falló el push de ${key}`);
        }
      }
    }
    // Catálogo de usuarios sin PINs (SEC-002): vive en el auth store, no en appForage.
    if (userCatalog.users.length > 0) {
      const result = await pushCloudSync(
        relatedPushTarget(cycleTarget, "bodega_users_catalog_v1").docId,
        userCatalog,
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
    // La nube puede conservar claves de versiones antiguas retiradas del
    // contrato actual. Ignorarlas evita que un documento obsoleto bloquee
    // toda la inicialización; las claves permitidas siguen validándose abajo.
    if (!isSupervisorSyncKey(key)) {
      console.info(`[CloudSync] Documento obsoleto ignorado: ${docId}`);
      return false;
    }
    // V2.1.50: si el doc es de una sede NO activa, escribir directo con
    // el namespace correcto, sin pasar por el router (que usa la activa).
    // El documento remoto ya tiene sede. Nunca volver a enrutar por la activa
    // tras un await: tanto lectura como escritura usan el mismo destino físico.
    const { default: localforage } = await import("localforage");
    const nsKey = (k) => (isGlobalKey(k) ? k : physicalDocId(negocioId, k));
    const nsGet = (k) => localforage.getItem(nsKey(k));
    const nsSet = (k, v) => localforage.setItem(nsKey(k), v);

    const envelope = readSyncEnvelope(data);
    if (!envelope.valid) {
      console.warn(`[CloudSync] Envelope remoto rechazado: ${envelope.error}`);
      throw new Error(
        `Envelope remoto inválido para ${docId}: ${envelope.error}`,
      );
    }

    // Deltas legados sin `date`: la fecha sale de la clave del documento.
    const payload = normalizeSalesDeltaPayload(key, envelope.payload);
    let payloadToStore = payload;
    // Validate before timestamp skipping: an old malformed revision is still
    // pending evidence, not an already-confirmed document.
    const validation = validateSupervisorSyncDocument(key, payload);
    if (
      !validation.valid ||
      (STORE_SCHEMAS[key] && !STORE_SCHEMAS[key](payload))
    ) {
      throw new Error(`Schema inválido para documento remoto ${docId}`);
    }

    // Las ventas/deltas son fusión append-only: cada equipo aporta una
    // versión independiente y no debe descartarse usando el watermark de otro.
    const metadataKey = getSyncMetadataKey(
      docId,
      isMergeSemanticsKey(key) ? sourceDeviceId : null,
    );
    const previousUpdatedAt = localStorage.getItem(metadataKey);
    console.log(
      `[syncNow] ${docId}: remoto=${envelope.updatedAt} local=${previousUpdatedAt || "nunca"}`,
    );
    if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
      // Las filas de cada equipo conservan snapshots anteriores. Que un
      // snapshot antiguo difiera del más reciente no demuestra conflicto: es
      // convergencia normal del pull multi-dispositivo, no una edición perdida.
      console.log(`[syncNow] ${docId}: DESCARTADO (remoto no es más nuevo)`);
      return false;
    }

    // Solo alertar si el usuario cambió localmente el documento desde la
    // última versión convergida y este pull realmente va a reemplazarlo.
    // No usar CONFIRMED_PUSH_HASH_PREFIX: el pull lo actualiza con snapshots
    // de otros equipos y convertía cada fila antigua en un falso conflicto.
    if (
      (key === "bodega_products_v1" || key === "bodega_accounts_v2") &&
      sourceDeviceId !== _currentDeviceId
    ) {
      try {
        const baseline = localStorage.getItem(_localSyncBaselineKey(docId));
        const localValue = await nsGet(key);
        if (localValue != null && baseline) {
          const localHash = await syncConflictHash(key, localValue);
          const incomingHash = await syncConflictHash(key, payload);
          if (isUnconfirmedLocalConflict(localHash, incomingHash, baseline)) {
            recordSyncConflict({
              key,
              docId,
              direction: "local-overwritten",
              detail: `Tus cambios sin sincronizar en ${friendlyConflictName(key)} fueron reemplazados por la versión más reciente de otro equipo.`,
              fingerprint: `${docId}:${localHash}:${incomingHash}:${baseline}`,
            });
          }
        }
      } catch (error) {
        console.warn(
          "[CloudSync] No se pudo evaluar conflicto local:",
          error?.message ?? error,
        );
      }
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
        } else if (
          Array.isArray(localProducts) &&
          !isOwnDoc
        ) {
          const lastRemote = readLastRemoteStockMap(docId, sourceDeviceId);
          const {
            products: mergedProducts,
            nextRemoteMap,
            deltas,
          } = applyStockMapDelta(localProducts, payload, lastRemote);
          if (mergedProducts !== localProducts) {
            await nsSet("bodega_products_v1", mergedProducts);
            window.dispatchEvent(
              new CustomEvent("app_storage_update", {
                detail: { key: "bodega_products_v1", source: "remote" },
              }),
            );
          }
          // Solo tras persistir el stock: si la escritura falla, el próximo ciclo
          // reintenta con el mismo "último visto" y no duplica lo recibido.
          writeLastRemoteStockMap(docId, sourceDeviceId, nextRemoteMap);
          if (Object.keys(deltas).length > 0) {
            writeReceivedStockMap(
              docId,
              accumulateReceivedStock(readReceivedStockMap(docId), deltas),
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
          // El store de auth corresponde solo a la sede activa. No aplicar
          // personal de otra sede sobre sus usuarios/PINs: retener para retry.
          if (negocioId !== getNegocioActivoId())
            throw new Error("Catálogo de usuarios requiere su sede activa");
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
        localStorage.setItem(
          _localSyncBaselineKey(docId),
          await syncConflictHash(key, payload),
        );
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
          console.log(
            `[syncNow] ${docId}: fusionados=${merged.length}, tumbas=${tombstones.length}`,
          );
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
        localStorage.setItem(
          _localSyncBaselineKey(docId),
          await syncConflictHash(key, payload),
        );
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
      // El catálogo remoto trae stock absoluto de otro equipo: conservar el stock
      // local para no pisar ventas propias ni reintroducir deltas ajenos.
      if (key === "bodega_products_v1" && Array.isArray(payloadToStore)) {
        payloadToStore = preserveLocalStock(await nsGet(key), payloadToStore);
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
    if (!isMergeSemanticsKey(key)) {
      localStorage.setItem(
        _localSyncBaselineKey(docId),
        await syncConflictHash(key, payloadToStore),
      );
    }
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
    pullCoverageIncomplete = true;
    let cancelled = false;
    let initializationScheduled = false;
    let realtimePullTimer = null;
    let realtimeChannel = null;

    const scheduleRealtimePull = () => {
      if (realtimePullTimer) clearTimeout(realtimePullTimer);
      realtimePullTimer = setTimeout(() => {
        realtimePullTimer = null;
        if (cancelled || !isCloudSyncActive || deviceId !== _currentDeviceId)
          return;
        syncNow({ manual: false })
          .then((result) => {
            if (!result?.ok && !result?.partial) {
              console.warn(
                "[CloudSync] Pull disparado por Realtime no completado; sigue activo el sondeo de respaldo",
              );
            }
          })
          .catch((error) => {
            console.warn(
              "[CloudSync] Pull disparado por Realtime no completado; sigue activo el sondeo de respaldo",
              error?.message || error,
            );
          });
      }, 100);
    };

    const initSync = () => {
      if (cancelled || isInitialized.current || initializationScheduled)
        return Promise.resolve();
      initializationScheduled = true;
      return serializeSyncCycle(async () => {
        if (cancelled || isInitialized.current) return;
        try {
          const { session, error: sessionError } =
            await ensureSupervisorSession();
          if (cancelled) return;
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
          let deviceAccess = {
            ok: false,
            error: "No se pudo validar el equipo",
          };
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
          if (cancelled) return;
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
          const startInitialSync = () =>
            forceSyncAllPOSData(deviceId, !accountCtx)
              .then((result) => {
                if (result && !result.ok) {
                  console.warn(
                    "[CloudSync] No se completó la sincronización inicial:",
                    result.error,
                  );
                }
                return result;
              })
              .catch((error) => {
                console.warn(
                  "[CloudSync] Falló la sincronización inicial:",
                  error?.message || error,
                );
                return { ok: false, error };
              });

          // ── Pull Inicial / Sincronización de Importación ──
          // Consultar y fusionar antes de publicar: no se debe subir un snapshot
          // local anterior que gane LWW solo por tener un timestamp posterior.
          let initialPull = null;
          const backupImported =
            localStorage.getItem("pda_backup_imported_flag") === "true";

          if (backupImported) {
            // Import remains explicit, but must not bypass a failed read or a
            // retained remote conflict when confirming upload hashes.
            initialPull = await pullCloudDocuments(
              deviceAccess,
              deviceId,
              true,
            );
            if (cancelled || initialPull.queryFailed) return;
            // Restored journal failures must not disable the engine: unaffected
            // keys continue and the retained revisions remain manually retryable.
            let importIncomplete = initialPull.pending > 0;
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
              const physicalKey = toCloudDocId(key);
              const localValue = await appForage.getItem(physicalKey);
              if (localValue !== null) {
                const result = await pushCloudSync(physicalKey, localValue);
                if (!result?.ok) {
                  throw new Error(
                    result?.error || `Falló la importación de ${key}`,
                  );
                }
                if (result.pending) {
                  importIncomplete = true;
                  continue;
                }
                const hash = await quickHash(localValue);
                localStorage.setItem(_pushHashKey(physicalKey), hash);
                localStorage.setItem(_confirmedPushKey(physicalKey), hash);
              }
            }
            if (!importIncomplete) {
              localStorage.setItem("cloud_sync_ts", new Date().toISOString());
              localStorage.removeItem("pda_backup_imported_flag");
              console.info(
                "[CloudSync] Sincronización de importación completada.",
              );
            } else {
              console.info(
                "[CloudSync] Importación parcial; pendientes conservados para reintento.",
              );
            }
          } else {
            if (accountCtx) {
              // Discover valid registry versions; invalid siblings stay pending.
              const registry = await pullBusinessRegistry();
              if (
                !registry.ok &&
                registry.message !== "No hay registro en la nube"
              ) {
                throw new Error(registry.message);
              }
            }
            initialPull = await pullCloudDocuments(deviceAccess, deviceId);
            if (cancelled || initialPull.queryFailed) return;
            // A transient query failure keeps the engine available for the next
            // periodic/manual retry; snapshots stay gated until coverage is complete.
            // Invalid docs are durable pending, not a fatal initialization error.
            // Affected snapshot keys are blocked by pushCloudSync; other keys proceed.
          }

          if (backupImported && accountCtx) {
            initialPull = await pullCloudDocuments(
              deviceAccess,
              deviceId,
              true,
            );
            if (cancelled || initialPull.queryFailed) return;
          }

          if (!backupImported) {
            const verifyAccess =
              await validateCurrentDeviceSyncAccess(deviceId);
            if (!verifyAccess.ok)
              throw new Error(
                verifyAccess.error || "Equipo sin autorización activa",
              );
            if (cancelled) return;
            const initialResult = await startInitialSync();
            if (!initialResult?.ok) {
              throw new Error(
                initialResult?.error?.message ||
                  initialResult?.error ||
                  "Sincronización inicial incompleta",
              );
            }
          }

          // ── Auto-recuperación: Purgar/subir datos locales que no llegaron a enviarse debido al bug anterior ──
          try {
            const recoveryAccess =
              await validateCurrentDeviceSyncAccess(deviceId);
            if (!recoveryAccess.ok || !isCloudSyncActive)
              throw new Error(
                recoveryAccess.error || "La sincronización no está autorizada",
              );
            const criticalKeys = [
              "bodega_sales_v1",
              "bodega_products_v1",
              "bodega_customers_v1",
              "bodega_customer_ledger_v1",
              "bodega_accounts_v2",
            ];
            // Confirmed hashes are only written after a successful own push.

            for (const key of criticalKeys) {
              const physicalKey = toCloudDocId(key);
              const localValue = await appForage.getItem(physicalKey);
              if (localValue == null) continue;

              const hashKey = _pushHashKey(physicalKey);
              const confirmedHashKey = _confirmedPushHashKey(physicalKey);
              const currentHash = await quickHash(localValue);
              if (localStorage.getItem(confirmedHashKey) === currentHash) {
                localStorage.setItem(hashKey, currentHash);
                continue;
              }

              // Subimos los datos locales a la base de datos para sincronizar el historial.
              // El hash solo se confirma si el upsert fue aceptado.
              const result = await pushCloudSync(physicalKey, localValue);
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

          if (cancelled) return;
          if (initialPull)
            publishCloudPullStatus(deviceId, {
              ...initialPull,
              status: initialPull.pending ? "partial" : "idle",
            });
          // Realtime es solo una señal para arrancar el mismo pull autenticado y
          // validado por RLS; nunca aplicamos el payload del socket directamente.
          // Cuenta/membresía limita las filas visibles en Supabase y se vuelve a
          // validar antes de sincronizar. Legacy/pairing no amplía sus permisos.
          if (accountCtx && !realtimeChannel) {
            realtimeChannel = supabaseCloud
              .channel(`cloud-sync:${deviceId}`)
              .on(
                "postgres_changes",
                {
                  event: "*",
                  schema: "public",
                  table: "sync_documents",
                },
                (change) => {
                  const row = change?.new;
                  if (!row || row.device_id === deviceId) return;
                  if (!accountCtx.deviceIds.includes(row.device_id)) return;
                  if (!isDocForKnownBusiness(row.doc_id)) return;
                  const { key } = parseCloudDocId(row.doc_id);
                  const isRate =
                    row.collection === "local" && LOCAL_KEYS.includes(key);
                  const isInventory =
                    row.collection === "store" &&
                    ["bodega_products_v1", "bodega_stock_v1"].includes(key);
                  if (isRate || isInventory) scheduleRealtimePull();
                },
              )
              .subscribe((status) => {
                if (cancelled) return;
                if (status === "SUBSCRIBED") {
                  // Recupera cambios que ocurrieron mientras la conexión estaba caída.
                  scheduleRealtimePull();
                } else if (
                  status === "CHANNEL_ERROR" ||
                  status === "TIMED_OUT"
                ) {
                  console.warn(
                    "[CloudSync] Canal Realtime no disponible; sigue activo el sondeo de respaldo",
                  );
                }
              });
          }
        } catch (err) {
          if (cancelled) return;
          console.error("[CloudSync] Fallo en inicialización:", err);
          publishCloudPullStatus(deviceId, {
            ...getCloudPullStatus(deviceId),
            status: "failed",
          });
          isInitialized.current = false;
          isCloudSyncActive = false;
        }
      }).finally(() => {
        initializationScheduled = false;
      });
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
        const access = await validateCurrentDeviceSyncAccess(deviceId);
        if (!access.ok || !isCloudSyncActive) return;
        const criticalKeys = [
          "bodega_sales_v1",
          "bodega_products_v1",
          "bodega_customers_v1",
          "bodega_customer_ledger_v1",
          "bodega_accounts_v2",
        ];
        for (const key of criticalKeys) {
          const physicalKey = toCloudDocId(key);
          const localValue = await appForage.getItem(physicalKey);
          if (localValue == null) continue;

          const hashKey = _pushHashKey(physicalKey);
          const confirmedHashKey = _confirmedPushHashKey(physicalKey);
          const currentHash = await quickHash(localValue);
          if (localStorage.getItem(confirmedHashKey) === currentHash) {
            localStorage.setItem(hashKey, currentHash);
            continue;
          }

          const result = await pushCloudSync(physicalKey, localValue);
          if (!result?.ok) {
            throw new Error(result?.error || `Falló el reintento de ${key}`);
          }
          if (result.pending) continue;
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

    const handleOnline = () => {
      if (cancelled) return;
      if (!isCloudSyncActive) {
        // Network may have failed while initial auth/membership was being
        // checked. Re-run the full fail-closed initialization; do not resume
        // writes merely because navigator/browser reports online.
        isInitialized.current = false;
        initSync().catch((error) => {
          isInitialized.current = false;
          isCloudSyncActive = false;
          console.error("[CloudSync] Fallo al reanudar tras conexión:", error);
        });
        return;
      }
      forcePushLocalData();
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // AUTO-SYNC PERIÓDICO (2026-10-01): sincronización completa (pull+push)
    // cada 5 minutos en background. El usuario no debe pulsar ningún botón.
    const periodicSync = setInterval(
      async () => {
        if (isSyncingFromCloud || !isCloudSyncActive) return;
        if (document.visibilityState !== "visible") return;
        try {
          const access = await validateCurrentDeviceSyncAccess(deviceId);
          if (!access.ok || !isCloudSyncActive) return;
          const res = await syncNow({ manual: false });
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
      cancelled = true;
      if (realtimePullTimer) clearTimeout(realtimePullTimer);
      realtimePullTimer = null;
      if (realtimeChannel) {
        const channelToRemove = realtimeChannel;
        realtimeChannel = null;
        if (globalSubscription === channelToRemove) globalSubscription = null;
        try {
          supabaseCloud.removeChannel(channelToRemove).catch(() => {});
        } catch {
          /* teardown should not block effect cleanup */
        }
      }
      isCloudSyncActive = false;
      isInitialized.current = false;
      window.removeEventListener("online", handleOnline);
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
