/**
 * cloudAccount.js — Cuenta del dueño en Supabase (sync multi-dispositivo).
 *
 * Versión simplificada (mockup aprobado 2026-09-30): solo login con email +
 * contraseña. Sin crear-cuenta ni códigos en la UI (el backend de códigos
 * sigue en la DB para retomarlo después). Máximo 6 equipos por cuenta,
 * aplicado en el servidor (RPC register_account_device, migración 004).
 *
 * Al entrar, el dispositivo se vincula solo: sus datos suben a la nube y
 * recibe los de las otras sedes (useCloudSync entra en "modo cuenta").
 *
 * Todo sigue offline-first: sin red la app funciona igual; la nube es espejo.
 *
 * @module services/cloudAccount
 */

import {
  supabaseCloud,
  getCustomerProject,
  clearCustomerProject,
} from "../config/supabaseCloud";
import { ensureDeviceSessionRegistered } from "../utils/deviceIdentity";

/** Vigencia del código de vinculación (flujo oculto de la UI por ahora). */
export const PAIRING_CODE_TTL_MIN = 10;
/** Cuántos códigos activos puede tener un dueño (se rotan). */
const MAX_ACTIVE_CODES = 3;
/** Máximo de equipos vinculados por cuenta (tope aplicado en el servidor). */
export const MAX_DEVICES_PER_ACCOUNT = 6;
/** Mensaje de error de la DB cuando la cuenta llegó al tope. */
const LIMIT_REACHED_TOKEN = "LIMIT_REACHED";
let revalidatedLicenseDeviceId = null;

/** Marca temporalmente el equipo tras validar el código en CloudGate. */
export function authorizeDeviceRebindAfterLicenseCode() {
  const deviceId = getLocalDeviceId();
  if (!deviceId) return false;
  revalidatedLicenseDeviceId = deviceId;
  return true;
}


export function getLocalDeviceId() {
  try {
    return localStorage.getItem("pda_device_id") || "";
  } catch {
    return "";
  }
}

function randomSixDigits() {
  // crypto.getRandomValues en vez de Math.random (códigos no predecibles).
  const buf = new Uint32Array(1);
  (window.crypto || {}).getRandomValues?.(buf);
  const n = (buf[0] ?? Math.floor(Math.random() * 1e9)) % 900000;
  return String(100000 + n);
}

/**
 * Sesión del dueño (email+contraseña). Las sesiones anónimas del POS NO
 * cuentan como "dueño": se reportan aparte para no confundir los flujos.
 */
export async function getOwnerSession() {
  if (!supabaseCloud?.auth)
    return { session: null, error: "Supabase no disponible" };
  try {
    const { data, error } = await supabaseCloud.auth.getSession();
    if (error) return { session: null, error: error.message };
    const session = data?.session;
    if (!session?.user) return { session: null };
    if (session.user.is_anonymous) return { session: null, anonymous: true };
    return { session };
  } catch (e) {
    return { session: null, error: e?.message || "Error leyendo sesión" };
  }
}

export async function signUpOwner(email, password) {
  if (!supabaseCloud?.auth)
    return { ok: false, error: "Supabase no disponible" };
  const cleanEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return { ok: false, error: "Email inválido" };
  }
  if (String(password || "").length < 6) {
    return {
      ok: false,
      error: "La contraseña debe tener al menos 6 caracteres",
    };
  }
  try {
    const { data, error } = await supabaseCloud.auth.signUp({
      email: cleanEmail,
      password,
    });
    if (error) return { ok: false, error: error.message };
    // Si el proyecto exige confirmar el email, no hay sesión todavía.
    if (!data?.session) {
      return { ok: true, needsConfirmation: true };
    }
    const reg = await registerCurrentDevice();
    if (reg.limitReached) {
      await signOutOwner().catch(() => {});
      return { ok: false, limitReached: true };
    }
    if (!reg.ok) {
      await signOutOwner().catch(() => {});
      return {
        ok: false,
        error: reg.error || "No se pudo autorizar este dispositivo",
      };
    }
    return { ok: true, session: data.session, deviceRegistered: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Error creando la cuenta" };
  }
}

export async function signInOwner(email, password, deviceAlias = null) {
  if (!supabaseCloud?.auth)
    return { ok: false, error: "Supabase no disponible" };
  try {
    const { data, error } = await supabaseCloud.auth.signInWithPassword({
      email: String(email || "")
        .trim()
        .toLowerCase(),
      password: String(password || ""),
    });
    if (error) return { ok: false, error: error.message };
    const reg = await registerCurrentDevice(deviceAlias);
    if (reg.limitReached) {
      // Credenciales válidas pero la cuenta está llena: no dejar una
      // sesión a medias en un equipo que no puede sincronizar.
      await signOutOwner().catch(() => {});
      return { ok: false, limitReached: true };
    }
    if (!reg.ok) {
      // No dejar que un login válido omita el vínculo del dispositivo:
      // el CloudGate solo debe abrir tras confirmar la membresía en servidor.
      await signOutOwner().catch(() => {});
      return {
        ok: false,
        error: reg.error || "No se pudo autorizar este dispositivo",
      };
    }
    return { ok: true, session: data.session, deviceRegistered: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Error iniciando sesión" };
  }
}

export async function signOutOwner() {
  if (!supabaseCloud?.auth) return { ok: false };
  try {
    await supabaseCloud.auth.signOut();
    // La próxima inicialización del sync recrea la sesión anónima del POS.
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Registra el dispositivo actual en la cuenta del dueño vía RPC
 * `register_account_device` (migración 004). El tope de
 * MAX_DEVICES_PER_ACCOUNT equipos se aplica en el servidor: re-vincular un
 * equipo ya conocido no consume cupo; un equipo nuevo con la cuenta llena
 * devuelve `limitReached: true`.
 * Requiere sesión de dueño activa.
 */
export async function registerCurrentDevice(alias) {
  const { session } = await getOwnerSession();
  if (!session) return { ok: false, error: "Sin sesión de dueño" };
  const deviceId = getLocalDeviceId();
  if (!deviceId) return { ok: false, error: "Dispositivo sin identidad" };
  // Límite dinámico desde el directorio (default 6)
  const project = getCustomerProject();
  const maxDevices = project?.maxDevices ?? MAX_DEVICES_PER_ACCOUNT;
  // La revocación de servidor (o del directorio) solo se puede reactivar en
  // esta sesión después de validar otra vez el código de licencia.
  let membershipQuery;
  try {
    membershipQuery = await supabaseCloud
      .from("account_devices")
      .select("device_id, revoked")
      .eq("user_id", session.user.id)
      .eq("device_id", deviceId);
  } catch (error) {
    return { ok: false, error: error?.message || "No se pudo validar el dispositivo" };
  }
  if (membershipQuery?.error) {
    return { ok: false, error: membershipQuery.error.message || "No se pudo validar el dispositivo" };
  }
  const currentMembership = (Array.isArray(membershipQuery?.data) ? membershipQuery.data : [])
    .find((row) => row?.device_id === deviceId);
  const wasRevoked = currentMembership?.revoked === true
    || (project?.revokedDeviceIds || []).includes(deviceId);
  if (wasRevoked && revalidatedLicenseDeviceId !== deviceId) {
    return {
      ok: false,
      error: "Este dispositivo fue revocado. Ingresa nuevamente el código de licencia para reautorizarlo.",
    };
  }
  if (!wasRevoked) revalidatedLicenseDeviceId = null;
  try {
    // 1. Puente de identidad (también lo usa el RLS de 001/002).
    const identity = await ensureDeviceSessionRegistered(deviceId);
    if (!identity?.ok) {
      return {
        ok: false,
        error: identity?.error?.message || identity?.error || "No se pudo verificar la identidad del dispositivo",
      };
    }
    // 2. Vínculo cuenta <-> dispositivo (con tope en el servidor).
    const { error } = await supabaseCloud.rpc("register_account_device", {
      p_device_id: deviceId,
      p_alias: alias || null,
      p_max_devices: maxDevices,
    });
    if (error) {
      if (String(error.message || "").includes(LIMIT_REACHED_TOKEN)) {
        return {
          ok: false,
          limitReached: true,
          error: `Límite de ${maxDevices} equipos alcanzado`,
        };
      }
      return { ok: false, error: error.message };
    }
    revalidatedLicenseDeviceId = null;
    try {
      localStorage.setItem("pda_account_linked", "true");
    } catch {
      /* noop */
    }
    return { ok: true, deviceId };
  } catch (e) {
    return { ok: false, error: e?.message || "Error registrando dispositivo" };
  }
}

/**
 * Genera un código de 6 dígitos para vincular otro dispositivo sin escribir
 * la contraseña en él. Requiere sesión de dueño. Rota los anteriores.
 * @returns {{ok, code?, expiresAt?, error?}}
 */
export async function generatePairingCode() {
  const { session } = await getOwnerSession();
  if (!session) return { ok: false, error: "Inicia sesión como dueño primero" };
  try {
    // Rotación: borrar códigos viejos del dueño antes de crear uno nuevo.
    await supabaseCloud
      .from("pairing_codes")
      .delete()
      .eq("user_id", session.user.id);

    const { count } = await supabaseCloud
      .from("pairing_codes")
      .select("code", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString());

    if ((count ?? 0) >= MAX_ACTIVE_CODES) {
      return {
        ok: false,
        error: "Ya tienes códigos activos; espera a que expiren",
      };
    }

    const code = randomSixDigits();
    const expiresAt = new Date(
      Date.now() + PAIRING_CODE_TTL_MIN * 60_000,
    ).toISOString();
    const { error } = await supabaseCloud.from("pairing_codes").insert({
      code,
      user_id: session.user.id,
      expires_at: expiresAt,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, code, expiresAt };
  } catch (e) {
    return { ok: false, error: e?.message || "Error generando código" };
  }
}

/**
 * Canjea un código de vinculación en ESTE dispositivo. No requiere sesión
 * previa: la función RPC valida el código y crea el vínculo. Después registra
 * la identidad del dispositivo para que el RLS lo resuelva.
 * (Flujo oculto de la UI por ahora; el RPC también aplica el tope de 6.)
 */
export async function redeemPairingCode(code) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== 6)
    return { ok: false, error: "El código tiene 6 dígitos" };
  const deviceId = getLocalDeviceId();
  if (!deviceId) return { ok: false, error: "Dispositivo sin identidad" };
  if (!supabaseCloud) return { ok: false, error: "Supabase no disponible" };
  try {
    const { error } = await supabaseCloud.rpc("redeem_pairing_code", {
      p_code: clean,
      p_device_id: deviceId,
    });
    if (error) return { ok: false, error: error.message };
    // Registrar identidad (sesión anónima actual) para el RLS de 002.
    await ensureDeviceSessionRegistered(deviceId).catch(() => {});
    try {
      localStorage.setItem("pda_account_linked", "true");
    } catch {
      /* noop */
    }
    return { ok: true, deviceId };
  } catch (e) {
    return { ok: false, error: e?.message || "Error canjeando el código" };
  }
}

/** Dispositivos vinculados a la cuenta del dueño (requiere sesión). */
export async function getMyDevices() {
  const { session } = await getOwnerSession();
  if (!session) return { ok: false, error: "Sin sesión de dueño", devices: [] };
  try {
    const { data, error } = await supabaseCloud
      .from("account_devices")
      .select("device_id, alias, revoked, created_at, last_seen")
      .eq("user_id", session.user.id)
      .order("last_seen", { ascending: false });
    if (error) return { ok: false, error: error.message, devices: [] };
    return { ok: true, devices: data || [] };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || "Error listando dispositivos",
      devices: [],
    };
  }
}

/** Revoca un dispositivo: deja de leer/escribir en la cuenta al instante. */
export async function revokeDevice(deviceId) {
  const { session } = await getOwnerSession();
  if (!session) return { ok: false, error: "Sin sesión de dueño" };
  try {
    const { error } = await supabaseCloud
      .from("account_devices")
      .update({ revoked: true })
      .eq("user_id", session.user.id)
      .eq("device_id", deviceId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Error revocando dispositivo" };
  }
}

/**
 * Contexto de sincronización para useCloudSync: si hay sesión de dueño,
 * devuelve los device_id de la cuenta (propio + hermanos) para el pull
 * multi-dispositivo. Si el dispositivo se vinculó por CÓDIGO (sesión anónima),
 * los resuelve vía RPC `my_account_device_ids()`.
 * Null si no hay cuenta (flujo anterior intacto).
 */
export async function getAccountSyncContext() {
  if (!supabaseCloud) return null;
  const deviceId = getLocalDeviceId();

  // 1. Sesión de dueño: lectura directa (RLS owner-only).
  const { session } = await getOwnerSession();
  if (session) {
    try {
      const { data, error } = await supabaseCloud
        .from("account_devices")
        .select("device_id")
        .eq("user_id", session.user.id)
        .eq("revoked", false);
      if (error) return null;
      // La lista activa de servidor es la autoridad: no agregar el deviceId
      // local a ciegas, porque eso revalidaría un equipo revocado/no registrado.
      const ids = [
        ...new Set((data || []).map((r) => r.device_id).filter(Boolean)),
      ];
      if (!deviceId || !ids.includes(deviceId)) return null;
      return {
        userId: session.user.id,
        deviceIds: ids,
        ownDeviceId: deviceId,
        mode: "owner",
      };
    } catch {
      return null;
    }
  }

  // 2. Vinculado por código: la función resuelve la cuenta vía device_sessions.
  if (!isAccountLinkedLocally() || !deviceId) return null;
  try {
    const { data, error } = await supabaseCloud.rpc("my_account_device_ids");
    if (error || !Array.isArray(data)) return null;
    // No agregar la identidad local al resultado del servidor: debe existir
    // una membresía activa para permitir pull/push desde este dispositivo.
    const ids = [...new Set(data.filter(Boolean))];
    if (!deviceId || !ids.includes(deviceId)) return null;
    return {
      userId: "linked",
      deviceIds: ids,
      ownDeviceId: deviceId,
      mode: "linked",
    };
  } catch {
    return null;
  }
}

/** Comprueba el vínculo de este equipo antes de saltar el CloudGate al arrancar. */
export async function getCurrentDeviceMembershipStatus() {
  const deviceId = getLocalDeviceId();
  if (!deviceId) return { status: "unavailable", error: "Equipo no identificado" };

  const { session, error: sessionError } = await getOwnerSession();
  if (sessionError) return { status: "unavailable", error: sessionError };
  if (!session) {
    if (!isAccountLinkedLocally()) return { status: "no-owner-session" };
    // Equipos vinculados por código usan una sesión anónima y solo pueden
    // consultar su membresía mediante el RPC que devuelve device_ids activos.
    try {
      const { data, error } = await supabaseCloud.rpc("my_account_device_ids");
      if (error || !Array.isArray(data)) {
        return { status: "unavailable", error: error?.message || "No se pudo comprobar la membresía activa" };
      }
      return data.includes(deviceId) ? { status: "active" } : { status: "missing" };
    } catch (error) {
      return {
        status: "unavailable",
        error: error?.message || "No se pudo comprobar la membresía activa",
      };
    }
  }

  try {
    const { data, error } = await supabaseCloud
      .from("account_devices")
      .select("device_id, revoked")
      .eq("user_id", session.user.id)
      .eq("device_id", deviceId);
    if (error) return { status: "unavailable", error: error.message };
    const membership = (Array.isArray(data) ? data : []).find(
      (row) => row?.device_id === deviceId,
    );
    if (!membership) return { status: "missing" };
    if (membership.revoked === true) return { status: "revoked" };
    if (membership.revoked !== false) {
      return { status: "unavailable", error: "Estado de membresía inválido" };
    }
    return { status: "active" };
  } catch (error) {
    return {
      status: "unavailable",
      error: error?.message || "No se pudo comprobar la membresía del dispositivo",
    };
  }
}

export function resolveCloudGateEntry(session, membershipStatus) {
  if (!session || session.user?.is_anonymous) return "login";
  if (membershipStatus === "active") return "ready";
  if (membershipStatus === "revoked" || membershipStatus === "missing") return "code";
  return "blocked";
}

export function isAccountLinkedLocally() {
  try {
    return localStorage.getItem("pda_account_linked") === "true";
  } catch {
    return false;
  }
}

/** Valida la membresía actual antes de leer o escribir datos sincronizados. */
export async function validateCurrentDeviceSyncAccess(expectedDeviceId) {
  const deviceId = getLocalDeviceId();
  if (!deviceId) return { ok: false, error: "Equipo no identificado" };
  if (expectedDeviceId && expectedDeviceId !== deviceId) {
    return {
      ok: false,
      error: "La sesión de sincronización pertenece a otro equipo",
    };
  }

  let context;
  try {
    context = await getAccountSyncContext();
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "No se pudo validar la membresía activa",
    };
  }
  if (context) {
    const authorized =
      context.ownDeviceId === deviceId && context.deviceIds.includes(deviceId);
    return authorized
      ? { ok: true, mode: context.mode, context }
      : { ok: false, error: "El equipo no pertenece a la cuenta" };
  }

  let owner;
  try {
    owner = await getOwnerSession();
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "No se pudo validar la sesión del dueño",
    };
  }
  if (isAccountLinkedLocally() || owner.session || owner.error) {
    return { ok: false, error: "No se pudo validar la membresía activa" };
  }

  const revocation = await checkDeviceRevocation();
  if (!revocation.ok || revocation.revoked) {
    return {
      ok: false,
      error: revocation.error || "El equipo no tiene autorización activa",
    };
  }

  return { ok: true, mode: "legacy", context: null };
}

/**
 * Reporta los dispositivos vinculados al directorio (Estación).
 * La Estación muestra la lista y permite desvincular.
 * FIX (2026-10-02): actualiza last_seen en account_devices antes de reportar,
 * para que la Estación muestre la última conexión real en vez de "nunca".
 */
export async function reportDevicesToDirectory() {
  try {
    const project = getCustomerProject();
    if (!project?.code) return;
    const deviceId = getLocalDeviceId();
    // Actualizar last_seen del equipo actual (best-effort, no bloquea)
    if (deviceId && supabaseCloud) {
      const { session } = await getOwnerSession().catch(() => ({}));
      if (session?.user?.id) {
        await supabaseCloud
          .from("account_devices")
          .update({ last_seen: new Date().toISOString() })
          .eq("user_id", session.user.id)
          .eq("device_id", deviceId)
          .then(
            () => {},
            () => {},
          );
      }
    }
    const devices = await getMyDevices().catch(() => []);
    const payload = (devices || []).map((d) => ({
      id: d.device_id || d.id,
      // Si es el equipo actual, usar el timestamp fresco
      last_seen:
        d.device_id === deviceId || d.id === deviceId
          ? new Date().toISOString()
          : d.last_seen || null,
      alias: d.alias || null,
    }));
    // Llamar al RPC del directorio via fetch directo
    const dirUrl = import.meta.env.VITE_DIRECTORY_URL;
    const dirKey = import.meta.env.VITE_DIRECTORY_ANON_KEY;
    if (!dirUrl || !dirKey) return;
    await fetch(`${dirUrl}/rest/v1/rpc/report_pro_devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: dirKey,
        Authorization: `Bearer ${dirKey}`,
      },
      body: JSON.stringify({ p_code: project.code, p_devices: payload }),
    }).catch(() => {});
  } catch {
    /* no bloquea el sync */
  }
}

/**
 * Verifica si este equipo sigue autorizado en la cuenta o directorio.
 * Un fallo al comprobarlo devuelve ok:false para que syncNow falle cerrado.
 */
export async function checkDeviceRevocation() {
  const deviceId = getLocalDeviceId();
  if (!deviceId)
    return { ok: false, revoked: false, error: "Equipo no identificado" };

  try {
    const ownerSession = await getOwnerSession();
    if (ownerSession.error) {
      return { ok: false, revoked: false, error: ownerSession.error };
    }
    if (ownerSession.session) {
      const { data, error } = await supabaseCloud
        .from("account_devices")
        .select("device_id")
        .eq("user_id", ownerSession.session.user.id)
        .eq("revoked", false);
      if (error) return { ok: false, revoked: false, error: error.message };
      const activeIds = new Set(
        (data || []).map((row) => row.device_id).filter(Boolean),
      );
      return {
        ok: true,
        revoked: !activeIds.has(deviceId),
        source: "account_devices",
      };
    }

    if (isAccountLinkedLocally()) {
      // Una cuenta vinculada no puede degradarse al directorio legacy: su
      // membresía activa debe seguir confirmándose con el RPC de cuenta.
      return {
        ok: false,
        revoked: false,
        error: "No se pudo validar la membresía activa",
      };
    }
    const project = getCustomerProject();
    if (!project?.code) return { ok: true, revoked: false, source: "unlinked" };
    // Re-consultar el directorio para lista actualizada de revocados.
    const { lookupProjectByCode } = await import("./customerDirectory.js");
    const res = await lookupProjectByCode(project.code);
    if (!res.ok)
      return {
        ok: false,
        revoked: false,
        error: res.error || "No se pudo validar el equipo",
      };
    const revoked = (res.project.revokedDeviceIds || []).includes(deviceId);
    if (revoked) {
      await clearCustomerProject();
      try {
        localStorage.removeItem("pda_account_linked");
      } catch {
        // La marca local no concede acceso sin membresía de servidor.
      }
    }
    return { ok: true, revoked, source: "customer_directory" };
  } catch (error) {
    return {
      ok: false,
      revoked: false,
      error: error?.message || "No se pudo validar el equipo",
    };
  }
}
