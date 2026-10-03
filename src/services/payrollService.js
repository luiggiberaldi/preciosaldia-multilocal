/**
 * payrollService.js — Lógica de nómina v1 (módulo PLANO, sin hooks de React).
 *
 * Modelo (plan PLAN-NOMINA-PRO.md):
 * - Empleados con sueldo en USD/Bs y frecuencia semanal/quincenal/mensual.
 * - Consumos: el empleado retira mercancía a precio de venta → descuenta stock
 *   → se resta del sueldo del período. Documentos INDIVIDUALES en sync
 *   (nunca un array: dos equipos escribiendo un array con LWW se pisan).
 * - Período con snapshot salarial congelado al primer movimiento.
 * - Liquidación: neto = sueldo − consumos; genera GASTO_INTERNO en caja.
 *
 * Roles (re-validados en cada función mutadora, no solo en UI):
 * - gestionar empleados / anular consumos / liquidar = SOLO dueño.
 * - registrar consumo = dueño o admin.
 * - Sin sesión y requireLogin=false → acceso total legacy (igual que
 *   visibleTabIds en roles.js): se trata como dueño.
 *
 * @module services/payrollService
 */
import { storageService } from '../utils/storageService.js';
import { appForage } from '../utils/appForage.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { isOwner, isAdministrador, ROL_DUENO } from '../utils/roles.js';
import { logEvent } from './auditService.js';
import { adjustStockForItems } from '../utils/stockAdjust.js';
import { pushCloudSync, pushPayrollDoc } from '../hooks/useCloudSync.js';
import { getNegocioActivoId } from '../utils/negocioContext.js';
import { isGranelProduct } from '../utils/granel.js';
import { round2 } from '../utils/dinero.js';
import {
    periodKeyFor,
    periodBounds,
    currentPeriodKey,
    summarizeConsumos,
    calculateNeto,
    consumoExcedeLimite,
    toUsd,
    payrollFolio,
} from '../utils/payroll.js';

// ─── Keys ──────────────────────────────────────────────
export const EMPLOYEES_KEY = 'bodega_employees_v1';
export const PRODUCTS_KEY = 'bodega_products_v1';
export const SALES_KEY = 'bodega_sales_v1';
const CONSUMO_PREFIX = 'bodega_payroll_consumo_';
const PERIODO_PREFIX = 'bodega_payroll_periodo_';
const LIQUIDACION_PREFIX = 'bodega_payroll_liquidacion_';
const PENDING_PUSH_KEY = 'bodega_payroll_pending_push_v1'; // [{docId, negocioId}]

const FRECUENCIAS_VALIDAS = ['semanal', 'quincenal', 'mensual'];
const MONEDAS_VALIDAS = ['USD', 'Bs'];

// ─── Errores ───────────────────────────────────────────
function _err(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
}

// ─── Sesión y roles ────────────────────────────────────
function _session() {
    try {
        return useAuthStore.getState().usuarioActivo || null;
    } catch {
        return null;
    }
}

/** Legacy: sin login requerido y sin sesión → acceso total (igual que visibleTabIds). */
function _isLegacyFullAccess() {
    try {
        const st = useAuthStore.getState();
        return !st.usuarioActivo && st.requireLogin === false;
    } catch {
        return false;
    }
}

function _legacyOwnerSession() {
    return { id: 'legacy', nombre: 'Dueño', rol: ROL_DUENO };
}

/** Solo dueño. Lanza PAYROLL_OWNER_ONLY si no cumple. */
function _requireOwner() {
    if (_isLegacyFullAccess()) return _legacyOwnerSession();
    const s = _session();
    if (!isOwner(s)) {
        throw _err('PAYROLL_OWNER_ONLY', 'Permiso denegado: solo el dueño puede realizar esta acción de nómina.');
    }
    return s;
}

/** Dueño o admin. Lanza PAYROLL_DUENO_ADMIN_ONLY si no cumple. */
function _requireOwnerOrAdmin() {
    if (_isLegacyFullAccess()) return _legacyOwnerSession();
    const s = _session();
    if (!isOwner(s) && !isAdministrador(s)) {
        throw _err('PAYROLL_DUENO_ADMIN_ONLY', 'Permiso denegado: solo el dueño o el administrador pueden registrar consumos de nómina.');
    }
    return s;
}

// ─── Utilidades ────────────────────────────────────────
function _uuid() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch { /* fallback */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function _nowISO() {
    return new Date().toISOString();
}

function _deviceId() {
    try {
        return localStorage.getItem('pda_device_id') || 'desconocido';
    } catch {
        return 'desconocido';
    }
}

function _negocioId() {
    try {
        return getNegocioActivoId() || null;
    } catch {
        return null;
    }
}

/** De una clave física `nb_<id>:<lógica>` extrae la parte lógica. */
function _logicalKey(rawKey) {
    if (typeof rawKey !== 'string') return null;
    const i = rawKey.lastIndexOf(':');
    return i >= 0 ? rawKey.slice(i + 1) : rawKey;
}

// ─── Push con reintento offline ────────────────────────
// Si el push falla (offline), el doc queda marcado como pendiente y se
// reintenta al inicio de la próxima operación de nómina del mismo negocio.
function _getPendientes() {
    try {
        const raw = localStorage.getItem(PENDING_PUSH_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function _setPendientes(arr) {
    try {
        localStorage.setItem(PENDING_PUSH_KEY, JSON.stringify(arr));
    } catch { /* noop */ }
}

function _marcarPendiente(docId) {
    const negocioId = _negocioId();
    const list = _getPendientes().filter((p) => p && p.docId !== docId);
    list.push({ docId, negocioId });
    _setPendientes(list);
}

function _quitarPendiente(docId) {
    _setPendientes(_getPendientes().filter((p) => p && p.docId !== docId));
}

async function _flushPendingPushes() {
    const pendientes = _getPendientes();
    if (pendientes.length === 0) return 0;
    const negocioId = _negocioId();
    const restantes = [];
    let ok = 0;
    for (const p of pendientes) {
        if (!p || !p.docId || p.negocioId !== negocioId) {
            if (p) restantes.push(p); // otro negocio: se reintenta cuando ese negocio esté activo
            continue;
        }
        try {
            const doc = await appForage.getItem(p.docId, null);
            if (!doc) continue; // ya no existe localmente
            const r = await pushPayrollDoc(p.docId, doc);
            if (r && r.ok) { ok++; continue; }
        } catch { /* queda pendiente */ }
        restantes.push(p);
    }
    _setPendientes(restantes);
    return ok;
}

/** Guarda un doc de nómina local y lo sube; si el push falla queda pendiente. */
async function _savePayrollDoc(doc) {
    await appForage.setItem(doc.id, doc);
    let r = null;
    try {
        r = await pushPayrollDoc(doc.id, doc);
    } catch (e) {
        r = { ok: false, error: e?.message || String(e) };
    }
    if (r && r.ok) {
        _quitarPendiente(doc.id);
    } else {
        _marcarPendiente(doc.id);
        console.warn('[Nomina] Push diferido (offline?):', doc.id, r?.error || r?.reason || '');
    }
    try {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: doc.id } }));
        }
    } catch { /* noop */ }
    return r;
}

/** Enumera docs de nómina por prefijo (claves lógicas del negocio activo). */
async function _listDocsByPrefix(prefix) {
    const rawKeys = await appForage.keys();
    const out = [];
    for (const rk of rawKeys) {
        const logical = _logicalKey(rk);
        if (!logical || !logical.startsWith(prefix)) continue;
        try {
            const doc = await appForage.getItem(logical, null);
            if (doc) out.push(doc);
        } catch { /* omitir claves ilegibles */ }
    }
    return out;
}

async function _getEmployeeOrThrow(employeeId) {
    const empleados = await storageService.getItem(EMPLOYEES_KEY, []);
    const emp = (Array.isArray(empleados) ? empleados : []).find((e) => e && e.id === employeeId);
    if (!emp) throw _err('PAYROLL_EMPLEADO_NO_ENCONTRADO', 'Empleado no encontrado.');
    return { emp, empleados };
}

/** Consumos APPLIED del empleado en el período (los que cuentan para límite y neto). */
async function _consumosAplicados(employeeId, periodoKey) {
    const docs = await _listDocsByPrefix(CONSUMO_PREFIX);
    return docs.filter(
        (d) => d.kind === 'consumo'
            && d.employeeId === employeeId
            && d.periodoKey === periodoKey
            && d.status === 'APPLIED'
            && !d.settlementId
    );
}

function _periodId(employeeId, periodKey) {
    return `${PERIODO_PREFIX}${employeeId}_${periodKey}`;
}

/**
 * Lee el período corriente del empleado; lo crea al primer consumo con el
 * snapshot del sueldo vigente (patrón DondeJuancho: el sueldo se congela).
 */
async function _getOrCreatePeriod(emp) {
    const periodKey = currentPeriodKey(emp.frecuenciaPago);
    const id = _periodId(emp.id, periodKey);
    let period = await appForage.getItem(id, null);
    if (period && period.status === 'LIQUIDADO') {
        throw _err('PAYROLL_PERIODO_CERRADO', `El período ${periodKey} ya fue liquidado.`);
    }
    if (!period) {
        const bounds = periodBounds(periodKey);
        const now = _nowISO();
        period = {
            kind: 'periodo',
            id,
            employeeId: emp.id,
            periodKey,
            frecuencia: emp.frecuenciaPago,
            inicioISO: bounds.inicioISO,
            finISO: bounds.finISO,
            salarioSnapshot: { monto: emp.salarioMonto, moneda: emp.salarioMoneda },
            status: 'ABIERTO',
            liquidacionId: null,
            createdAt: now,
            updatedAt: now,
        };
        await _savePayrollDoc(period);
    }
    return period;
}

// ─── EMPLEADOS ─────────────────────────────────────────

/** Lista empleados del negocio activo. */
export async function listEmployees() {
    const arr = await storageService.getItem(EMPLOYEES_KEY, []);
    return Array.isArray(arr) ? arr : [];
}

/**
 * Crea un empleado. SOLO dueño.
 * @param {object} data {nombre, cedula?, cargo?, userId?, salarioMonto, salarioMoneda:'USD'|'Bs', frecuenciaPago, limiteConsumoPorc?=100}
 */
export async function createEmployee(data) {
    const session = _requireOwner();
    await _flushPendingPushes();

    const nombre = String(data?.nombre || '').trim();
    const salarioMonto = Number(data?.salarioMonto);
    const salarioMoneda = data?.salarioMoneda;
    const frecuenciaPago = data?.frecuenciaPago;
    if (!nombre) throw _err('PAYROLL_DATOS_INVALIDOS', 'El nombre del empleado es requerido.');
    if (!Number.isFinite(salarioMonto) || salarioMonto <= 0) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'El sueldo debe ser un número mayor a 0.');
    }
    if (!MONEDAS_VALIDAS.includes(salarioMoneda)) {
        throw _err('PAYROLL_DATOS_INVALIDOS', "La moneda del sueldo debe ser 'USD' o 'Bs'.");
    }
    if (!FRECUENCIAS_VALIDAS.includes(frecuenciaPago)) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'La frecuencia debe ser semanal, quincenal o mensual.');
    }
    const limite = data?.limiteConsumoPorc == null ? 100 : Number(data.limiteConsumoPorc);
    if (!Number.isFinite(limite) || limite < 0) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'El límite de consumo debe ser un porcentaje >= 0.');
    }

    const now = _nowISO();
    const emp = {
        id: 'emp_' + _uuid().replace(/-/g, '').slice(0, 12),
        nombre,
        cedula: String(data?.cedula || '').trim(),
        cargo: String(data?.cargo || '').trim(),
        userId: data?.userId ?? null,
        salarioMonto,
        salarioMoneda,
        frecuenciaPago,
        limiteConsumoPorc: limite,
        activo: true,
        fechaIngreso: now,
        deactivatedAt: null,
        deactivatedBy: null,
        createdAt: now,
        updatedAt: now,
    };
    const arr = await listEmployees();
    arr.push(emp);
    await storageService.setItem(EMPLOYEES_KEY, arr); // setItem encola el push a la nube
    await logEvent('NOMINA', 'EMPLEADO_CREADO',
        `Empleado creado: ${nombre} — sueldo ${salarioMoneda} ${salarioMonto} (${frecuenciaPago})`,
        session, { employeeId: emp.id });
    return emp;
}

/**
 * Edita un empleado. SOLO dueño. El cambio de sueldo/frecuencia NO toca el
 * snapshot del período abierto (rige desde el próximo período).
 */
export async function updateEmployee(id, patch) {
    const session = _requireOwner();
    await _flushPendingPushes();
    if (!id) throw _err('PAYROLL_DATOS_INVALIDOS', 'Se requiere el id del empleado.');

    const { emp, empleados } = await _getEmployeeOrThrow(id);
    const p = patch || {};
    const CAMPOS = ['nombre', 'cedula', 'cargo', 'userId', 'salarioMonto', 'salarioMoneda', 'frecuenciaPago', 'limiteConsumoPorc', 'activo'];
    const next = { ...emp };
    for (const k of CAMPOS) {
        if (p[k] !== undefined) next[k] = p[k];
    }
    // Validar lo que venga en el patch
    if (p.nombre !== undefined && !String(p.nombre).trim()) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'El nombre no puede quedar vacío.');
    }
    if (p.salarioMonto !== undefined && (!Number.isFinite(Number(p.salarioMonto)) || Number(p.salarioMonto) <= 0)) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'El sueldo debe ser un número mayor a 0.');
    }
    if (p.salarioMoneda !== undefined && !MONEDAS_VALIDAS.includes(p.salarioMoneda)) {
        throw _err('PAYROLL_DATOS_INVALIDOS', "La moneda del sueldo debe ser 'USD' o 'Bs'.");
    }
    if (p.frecuenciaPago !== undefined && !FRECUENCIAS_VALIDAS.includes(p.frecuenciaPago)) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'La frecuencia debe ser semanal, quincenal o mensual.');
    }
    if (p.limiteConsumoPorc !== undefined && (!Number.isFinite(Number(p.limiteConsumoPorc)) || Number(p.limiteConsumoPorc) < 0)) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'El límite de consumo debe ser un porcentaje >= 0.');
    }
    next.nombre = String(next.nombre).trim();
    next.salarioMonto = Number(next.salarioMonto);
    next.limiteConsumoPorc = Number(next.limiteConsumoPorc);
    next.updatedAt = _nowISO();

    const idx = empleados.findIndex((e) => e.id === id);
    empleados[idx] = next;
    await storageService.setItem(EMPLOYEES_KEY, empleados);
    await logEvent('NOMINA', 'EMPLEADO_ACTUALIZADO', `Empleado actualizado: ${next.nombre}`, session, { employeeId: id, patch: p });
    return next;
}

/** Desactiva un empleado (no borra: conserva historial). SOLO dueño. */
export async function deactivateEmployee(id) {
    const session = _requireOwner();
    await _flushPendingPushes();
    const { emp, empleados } = await _getEmployeeOrThrow(id);
    const now = _nowISO();
    const next = { ...emp, activo: false, deactivatedAt: now, deactivatedBy: session.id, updatedAt: now };
    empleados[empleados.findIndex((e) => e.id === id)] = next;
    await storageService.setItem(EMPLOYEES_KEY, empleados);
    await logEvent('NOMINA', 'EMPLEADO_DESACTIVADO', `Empleado desactivado: ${next.nombre}`, session, { employeeId: id });
    return next;
}

// ─── CONSUMOS ──────────────────────────────────────────

/**
 * Registra un consumo del empleado. Dueño o admin.
 * @param {object} args {employeeId, items:[{productId, qty}], tasaBcv, overrideLimite?=false, idempotencyKey?}
 * @returns {Promise<object>} el documento del consumo
 */
export async function registerConsumo({ employeeId, items, tasaBcv, overrideLimite = false, idempotencyKey = null }) {
    const session = _requireOwnerOrAdmin();
    await _flushPendingPushes();

    if (!employeeId) throw _err('PAYROLL_DATOS_INVALIDOS', 'Se requiere el empleado.');
    if (!Array.isArray(items) || items.length === 0) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'El consumo debe incluir al menos un producto.');
    }
    if (!(tasaBcv > 0)) throw _err('PAYROLL_TASA_INVALIDA', 'Se requiere la tasa BCV vigente para registrar el consumo.');

    const { emp } = await _getEmployeeOrThrow(employeeId);
    if (emp.activo === false) {
        throw _err('PAYROLL_EMPLEADO_INACTIVO', `El empleado ${emp.nombre} está desactivado.`);
    }

    // Idempotencia: si el caller reintenta con la misma key, devolver el existente.
    if (idempotencyKey) {
        const docs = await _listDocsByPrefix(CONSUMO_PREFIX);
        const existing = docs.find((d) => d.idempotencyKey === idempotencyKey);
        if (existing) return existing;
    }

    // Período corriente (crea con snapshot del sueldo si es el primer movimiento).
    const period = await _getOrCreatePeriod(emp);
    const snap = period.salarioSnapshot;

    // Resolver ítems contra el catálogo: precio de venta y stock.
    const products = await storageService.getItem(PRODUCTS_KEY, []);
    const allowNeg = (() => { try { return localStorage.getItem('allow_negative_stock') === 'true'; } catch { return false; } })();
    const resolved = items.map((it, i) => {
        const productId = it?.productId;
        const qty = Number(it?.qty);
        if (!productId) throw _err('PAYROLL_DATOS_INVALIDOS', `Ítem ${i + 1}: falta productId.`);
        if (!Number.isFinite(qty) || qty <= 0) throw _err('PAYROLL_DATOS_INVALIDOS', `Ítem ${i + 1}: cantidad inválida.`);
        const prod = (Array.isArray(products) ? products : []).find((p) => p && p.id === productId);
        if (!prod) throw _err('PAYROLL_PRODUCTO_NO_ENCONTRADO', `Producto no encontrado (${productId}).`);
        const priceUsd = Number(prod.priceUsd ?? prod.priceUsdt ?? 0);
        if (!(priceUsd > 0)) {
            throw _err('PAYROLL_SIN_PRECIO', `El producto "${prod.name || productId}" no tiene precio de venta.`);
        }
        if (!allowNeg && Number(prod.stock ?? 0) < qty) {
            throw _err('PAYROLL_STOCK_INSUFICIENTE',
                `Stock insuficiente de "${prod.name}": hay ${prod.stock ?? 0}, se piden ${qty}.`);
        }
        return {
            productId,
            nombre: prod.name || productId,
            qty,
            priceUsd,
            costUsd: Number(prod.costUsd ?? 0),
            isWeight: isGranelProduct(prod),
        };
    });

    const totalUsd = round2(resolved.reduce((s, r) => s + r.priceUsd * r.qty, 0));
    const totalBs = round2(totalUsd * tasaBcv);

    // Límite % del sueldo (el sueldo se convierte a USD con la tasa vigente si es en Bs).
    const previos = await _consumosAplicados(emp.id, period.periodKey);
    const consumidoUsd = Number(summarizeConsumos(previos)?.totalUsd || 0);
    const salarioUsd = toUsd(snap.monto, snap.moneda, tasaBcv);
    const excede = consumoExcedeLimite(
        salarioUsd,
        consumidoUsd,
        totalUsd,
        emp.limiteConsumoPorc ?? 100,
    );
    if (excede && !overrideLimite) {
        throw _err('PAYROLL_LIMITE_EXCEDIDO',
            `El consumo de $${totalUsd.toFixed(2)} supera el límite del ${emp.limiteConsumoPorc ?? 100}% del sueldo ($${salarioUsd.toFixed(2)}).`);
    }

    // Descontar stock (helper compartido con ventas: lock + re-lectura + granel).
    await adjustStockForItems(
        resolved.map((r) => ({ productId: r.productId, qty: r.qty, isWeight: r.isWeight })),
        -1,
        'Consumo de nómina'
    );

    const now = _nowISO();
    const id = CONSUMO_PREFIX + _uuid();
    const doc = {
        kind: 'consumo',
        id,
        employeeId: emp.id,
        employeeNombre: emp.nombre,
        periodoKey: period.periodKey,
        timestamp: now,
        status: 'APPLIED',
        items: resolved.map((r) => ({
            productId: r.productId, nombre: r.nombre, qty: r.qty, priceUsd: r.priceUsd, costUsd: r.costUsd,
        })),
        totalUsd,
        totalBs,
        tasaBsPorUsd: tasaBcv,
        tasaFuente: 'bcv',
        settlementId: null,
        actor: session.id,
        actorNombre: session.nombre,
        deviceId: _deviceId(),
        idempotencyKey: idempotencyKey || ('idem_' + _uuid()),
    };
    await _savePayrollDoc(doc);
    await logEvent('NOMINA', 'CONSUMO_REGISTRADO',
        `Consumo de ${emp.nombre}: $${totalUsd.toFixed(2)} (${resolved.length} ítem(s))${excede ? ' [override de límite]' : ''}`,
        session, { consumoId: id, employeeId: emp.id, totalUsd, overrideLimite: Boolean(excede && overrideLimite) });
    return doc;
}

/**
 * Anula un consumo (devuelve el stock). SOLO dueño.
 * Solo APPLIED sin liquidación; VOIDED es terminal.
 */
export async function anularConsumo(consumoId, motivo) {
    const session = _requireOwner();
    await _flushPendingPushes();

    if (!String(motivo || '').trim()) {
        throw _err('PAYROLL_DATOS_INVALIDOS', 'El motivo de anulación es requerido.');
    }
    const doc = await appForage.getItem(consumoId, null);
    if (!doc || doc.kind !== 'consumo') {
        throw _err('PAYROLL_CONSUMO_NO_ENCONTRADO', 'Consumo no encontrado.');
    }
    if (doc.status !== 'APPLIED' || doc.settlementId) {
        throw _err('PAYROLL_CONSUMO_NO_ANULABLE', 'Solo se puede anular un consumo aplicado y no liquidado.');
    }

    await adjustStockForItems(
        (doc.items || []).map((i) => ({ productId: i.productId, qty: i.qty })),
        +1,
        'Anulación de consumo de nómina'
    );

    const now = _nowISO();
    const updated = {
        ...doc,
        status: 'VOIDED',
        voidedAt: now,
        voidedBy: session.id,
        voidedByNombre: session.nombre,
        voidReason: String(motivo).trim(),
        updatedAt: now,
    };
    await _savePayrollDoc(updated);
    await logEvent('NOMINA', 'CONSUMO_ANULADO',
        `Consumo de ${doc.employeeNombre} anulado: $${Number(doc.totalUsd || 0).toFixed(2)}. Motivo: ${String(motivo).trim()}`,
        session, { consumoId, motivo: String(motivo).trim() });
    return updated;
}

/** Lista consumos (más recientes primero). Filtros opcionales. */
export async function listConsumos(employeeId = null, periodoKey = null) {
    const docs = await _listDocsByPrefix(CONSUMO_PREFIX);
    return docs
        .filter((d) => d.kind === 'consumo'
            && (!employeeId || d.employeeId === employeeId)
            && (!periodoKey || d.periodoKey === periodoKey))
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

// ─── RESUMEN ───────────────────────────────────────────

/**
 * Resumen del período corriente del empleado.
 * @param {string} employeeId
 * @param {number|null} tasaBcv tasa vigente (requerida si el sueldo es en Bs)
 */
export async function getResumen(employeeId, tasaBcv = null) {
    const { emp } = await _getEmployeeOrThrow(employeeId);
    const periodKey = currentPeriodKey(emp.frecuenciaPago);
    const period = await appForage.getItem(_periodId(emp.id, periodKey), null);
    const snap = (period && period.salarioSnapshot)
        ? period.salarioSnapshot
        : { monto: emp.salarioMonto, moneda: emp.salarioMoneda };

    const consumos = await _consumosAplicados(emp.id, periodKey);
    const summary = summarizeConsumos(consumos) || {};
    const totalConsumosUsd = Number(summary.totalUsd || 0);
    const count = Number(summary.count || 0);

    let salarioUsd = null;
    let netoUsd = null;
    let pct = null;
    if (snap.moneda === 'USD' || tasaBcv > 0) {
        salarioUsd = toUsd(snap.monto, snap.moneda, tasaBcv || 0);
        netoUsd = calculateNeto(salarioUsd, consumos).netoUsd;
        pct = salarioUsd > 0 ? (totalConsumosUsd / salarioUsd) * 100 : 0;
    }

    return {
        empleado: emp,
        periodo: period,
        periodoKey: periodKey,
        salarioSnapshot: snap,
        salarioUsd,
        totalConsumosUsd,
        netoUsd,
        count,
        pct,
    };
}

// ─── LIQUIDACIONES ─────────────────────────────────────

/** Lista liquidaciones (más recientes primero). */
export async function listLiquidaciones(employeeId = null) {
    const docs = await _listDocsByPrefix(LIQUIDACION_PREFIX);
    return docs
        .filter((d) => d.kind === 'liquidacion' && (!employeeId || d.employeeId === employeeId))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/**
 * Liquida el período corriente del empleado. SOLO dueño.
 * Marca consumos, crea la liquidación con folio, genera el GASTO_INTERNO
 * en caja (categoría 'personal') y cierra el período. Idempotente por
 * idempotencyKey 'settle_<employeeId>_<periodKey>'.
 * @param {object} args {employeeId, metodoPago, tasaBcv}
 * @returns {Promise<{liquidacion}>}
 */
export async function liquidar({ employeeId, metodoPago, tasaBcv }) {
    const session = _requireOwner();
    await _flushPendingPushes();

    if (!employeeId) throw _err('PAYROLL_DATOS_INVALIDOS', 'Se requiere el empleado.');
    if (!(tasaBcv > 0)) throw _err('PAYROLL_TASA_INVALIDA', 'Se requiere la tasa BCV vigente para liquidar.');

    const { emp } = await _getEmployeeOrThrow(employeeId);
    const resumen = await getResumen(employeeId, tasaBcv);
    if (resumen.netoUsd == null) {
        throw _err('PAYROLL_TASA_REQUERIDA', 'No se pudo calcular el neto: falta la tasa de conversión.');
    }
    if (resumen.netoUsd < 0) {
        throw _err('PAYROLL_NETO_NEGATIVO',
            `El neto es negativo ($${resumen.netoUsd.toFixed(2)}): los consumos superan el sueldo. No se puede liquidar.`);
    }

    const periodKey = resumen.periodoKey;
    const idemKey = `settle_${employeeId}_${periodKey}`;
    const previas = await listLiquidaciones(employeeId);
    if (previas.some((l) => l.idempotencyKey === idemKey && l.status === 'PAID')) {
        throw _err('PAYROLL_YA_LIQUIDADO', `El período ${periodKey} de ${emp.nombre} ya fue liquidado.`);
    }

    const now = _nowISO();
    const netoUsd = round2(resumen.netoUsd);
    const netoBs = round2(netoUsd * tasaBcv);
    const liqId = LIQUIDACION_PREFIX + _uuid();
    const folio = payrollFolio(periodKey, liqId.slice(-8));

    // 1. Marcar consumos del período con el settlementId.
    const consumos = await _consumosAplicados(employeeId, periodKey);
    for (const c of consumos) {
        await _savePayrollDoc({ ...c, settlementId: liqId, updatedAt: now });
    }

    // 2. Documento de liquidación.
    const liquidacion = {
        kind: 'liquidacion',
        id: liqId,
        employeeId: emp.id,
        employeeNombre: emp.nombre,
        periodoKey,
        frecuencia: emp.frecuenciaPago,
        salarioOriginal: { monto: resumen.salarioSnapshot.monto, moneda: resumen.salarioSnapshot.moneda },
        salarioUsd: resumen.salarioUsd,
        totalConsumosUsd: resumen.totalConsumosUsd,
        netoUsd,
        netoBs,
        tasaBcvLiquidacion: tasaBcv,
        consumptionIds: consumos.map((c) => c.id),
        payments: [{ metodo: metodoPago || 'efectivo', montoUsd: netoUsd }],
        status: 'PAID',
        folio,
        actor: session.id,
        actorNombre: session.nombre,
        deviceId: _deviceId(),
        createdAt: now,
        idempotencyKey: idemKey,
    };
    await _savePayrollDoc(liquidacion);

    // 3. Egreso de caja (misma forma que useGastosInternos: GASTO_INTERNO 'personal').
    const descripcion = `Pago nómina: ${emp.nombre} ${periodKey}`;
    const gasto = {
        id: _uuid(),
        timestamp: now,
        tipo: 'GASTO_INTERNO',
        cajaCerrada: false,
        afectaCaja: true,
        description: descripcion,
        category: 'personal',
        note: `Folio ${folio}`,
        totalBs: -netoBs,
        totalUsd: -netoUsd,
        paymentMethod: metodoPago || 'efectivo',
        payments: [{
            methodId: metodoPago || 'efectivo',
            amountUsd: -netoUsd,
            amountBs: -netoBs,
            currency: 'USD',
            methodLabel: 'Pago de nómina',
        }],
        items: [{ name: `Nómina: ${emp.nombre} (${periodKey})`, qty: 1, priceUsd: -netoUsd, costBs: 0 }],
    };
    const sales = await storageService.getItem(SALES_KEY, []);
    const arr = Array.isArray(sales) ? sales : [];
    arr.unshift(gasto);
    await storageService.setItem(SALES_KEY, arr); // encola el push
    try {
        await pushCloudSync(SALES_KEY, arr);
    } catch { /* el push encolado lo reintentará */ }

    // 4. Cerrar el período.
    if (resumen.periodo) {
        await _savePayrollDoc({ ...resumen.periodo, status: 'LIQUIDADO', liquidacionId: liqId, updatedAt: now });
    }

    await logEvent('NOMINA', 'LIQUIDACION_REGISTRADA',
        `Nómina liquidada: ${emp.nombre} (${periodKey}) — neto $${netoUsd.toFixed(2)} / Bs ${netoBs.toFixed(2)}. Folio ${folio}`,
        session, { liquidacionId: liqId, folio, employeeId, periodoKey, netoUsd, netoBs });
    return { liquidacion };
}

/** Reintento manual de pushes pendientes (offline). Retorna cuántos se lograron. */
export async function reintentarPushPendientes() {
    return _flushPendingPushes();
}
