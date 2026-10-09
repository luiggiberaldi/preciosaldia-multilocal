/**
 * stockLedger.js — Registro de movimientos de stock (ledger) para la nube.
 *
 * Cada cambio de stock (venta, anulación o ajuste manual) se registra como
 * movimientos con `movement_id` determinista: `${negocioId}:${sourceRef}:${productId}`.
 * Como `apply_stock_movements` ignora ids repetidos, reenviar un lote no
 * duplica nada, y un reintento de checkout con el mismo intentId produce los
 * mismos ids.
 *
 * La cola vive en localStorage (sobrevive a cierres y a modo offline). Un
 * movimiento solo sale de la cola cuando el servidor confirma su lote, así
 * que un fallo de red nunca lo pierde.
 *
 * Este módulo NO cambia el stock que ve la app: el stock local sigue como
 * antes. Es un registro adicional para la nube.
 */

import { supabaseCloud } from '../config/supabaseCloud.js';
import { round3 } from './dinero.js';

export const STOCK_OUTBOX_KEY = 'pda_stock_movements_outbox_v1';
export const STOCK_BATCH_SIZE = 500; // mismo tope que apply_stock_movements
const WARN_OUTBOX_SIZE = 5000;
const REASONS = new Set(['SALE', 'VOID', 'ADJUST']);

/**
 * Construye los movimientos de un cambio de stock.
 * @param {object} p
 * @param {string} p.negocioId
 * @param {string} p.deviceId
 * @param {'SALE'|'VOID'|'ADJUST'} p.reason
 * @param {string} p.sourceRef  id de la venta o ajuste (ej. `sale:<uuid>`)
 * @param {Array<{productId:string|number, delta:number}>} p.changes
 * @param {string} [p.clientCreatedAt] ISO; por defecto ahora
 */
export function buildStockMovements({ negocioId, deviceId, reason, sourceRef, changes, clientCreatedAt }) {
  if (!REASONS.has(reason)) throw new Error(`reason inválido: ${reason}`);
  if (!negocioId || !deviceId || !sourceRef) {
    throw new Error('negocioId, deviceId y sourceRef son obligatorios');
  }
  const at = clientCreatedAt || new Date().toISOString();
  const out = [];
  for (const c of changes || []) {
    const delta = round3(c?.delta);
    if (!Number.isFinite(delta) || delta === 0 || c.productId == null) continue;
    const productId = String(c.productId);
    out.push({
      movement_id: `${negocioId}:${sourceRef}:${productId}`,
      negocio_id: String(negocioId),
      product_id: productId,
      device_id: String(deviceId),
      delta,
      reason,
      source_ref: sourceRef,
      client_created_at: at,
    });
  }
  return out;
}

function getStorage(storage) {
  return storage || (typeof localStorage !== 'undefined' ? localStorage : null);
}

export function readStockOutbox(storage) {
  const s = getStorage(storage);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s.getItem(STOCK_OUTBOX_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((m) => m && typeof m.movement_id === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeStockOutbox(entries, storage) {
  const s = getStorage(storage);
  if (!s) return;
  if (entries.length > WARN_OUTBOX_SIZE) {
    console.warn(`[stockLedger] Cola de movimientos grande: ${entries.length} pendientes`);
  }
  s.setItem(STOCK_OUTBOX_KEY, JSON.stringify(entries));
}

/**
 * Encola movimientos sin duplicar ids ya pendientes.
 * Retorna cuántos se agregaron.
 */
export function enqueueStockMovements(movements, storage) {
  if (!Array.isArray(movements) || movements.length === 0) return 0;
  const existing = readStockOutbox(storage);
  const seen = new Set(existing.map((m) => m.movement_id));
  const fresh = movements.filter((m) => {
    if (seen.has(m.movement_id)) return false;
    seen.add(m.movement_id);
    return true;
  });
  if (fresh.length) writeStockOutbox([...existing, ...fresh], storage);
  return fresh.length;
}

/**
 * Envía la cola al servidor en lotes. Solo quita de la cola los movimientos
 * que el servidor confirmó; si un lote falla, el resto queda pendiente.
 *
 * @param {object} [opts]
 * @param {(name:string, params:object)=>Promise<{error?:any}>} [opts.rpc]
 *        inyectable para pruebas; por defecto usa supabaseCloud.rpc.
 * @param {Storage} [opts.storage]
 * @returns {Promise<{ok:boolean, sent:number, pending:number, error?:string}>}
 */
export async function flushStockMovements({ rpc, storage } = {}) {
  const call = rpc || ((name, params) => supabaseCloud.rpc(name, params));
  const pending = readStockOutbox(storage);
  if (pending.length === 0) return { ok: true, sent: 0, pending: 0 };

  let sent = 0;
  for (let i = 0; i < pending.length; i += STOCK_BATCH_SIZE) {
    const batch = pending.slice(i, i + STOCK_BATCH_SIZE);
    try {
      const { error } = await call('apply_stock_movements', { p_movements: batch });
      if (error) {
        return {
          ok: false,
          sent,
          pending: readStockOutbox(storage).length,
          error: error.message || String(error),
        };
      }
    } catch (err) {
      return {
        ok: false,
        sent,
        pending: readStockOutbox(storage).length,
        error: err?.message || String(err),
      };
    }
    // Quitar solo los confirmados (los nuevos encolados mientras tanto se conservan).
    const sentIds = new Set(batch.map((m) => m.movement_id));
    writeStockOutbox(
      readStockOutbox(storage).filter((m) => !sentIds.has(m.movement_id)),
      storage,
    );
    sent += batch.length;
  }
  return { ok: true, sent, pending: readStockOutbox(storage).length };
}

let flushTimer = null;

/**
 * Arranca el envío periódico y al volver la conexión. Idempotente.
 * Se llama una vez al iniciar la app.
 */
export function startStockLedgerFlush({ intervalMs = 30000 } = {}) {
  if (flushTimer || typeof window === 'undefined') return;
  const run = () => {
    if (readStockOutbox().length === 0) return;
    flushStockMovements().catch(() => {});
  };
  window.addEventListener('online', run);
  flushTimer = setInterval(run, intervalMs);
  run();
}
