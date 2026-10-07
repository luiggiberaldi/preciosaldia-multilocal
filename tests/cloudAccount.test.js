/**
 * tests/cloudAccount.test.js — Cuenta del dueño en Supabase (versión simplificada).
 *
 * Cubre el módulo src/services/cloudAccount.js con supabaseCloud mockeado:
 *  - getOwnerSession distingue sesión de dueño vs anónima vs ausente.
 *  - signUp/signIn validan entrada y registran el dispositivo al entrar.
 *  - registerCurrentDevice usa el RPC register_account_device (tope de 6 en
 *    el servidor); LIMIT_REACHED se mapea a limitReached y el signIn/signUp
 *    cierra la sesión a medias en ese caso.
 *  - generatePairingCode exige sesión de dueño y produce código de 6 dígitos
 *    con expiración de 10 minutos (flujo oculto de la UI por ahora).
 *  - redeemPairingCode valida formato y llama al RPC con el código limpio.
 *  - getAccountSyncContext: modo owner (lee account_devices) y modo linked
 *    (RPC my_account_device_ids); null sin cuenta.
 *  - revokeDevice marca revoked=true solo del dueño.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

/** Query builder thenable: `await from().select().eq()...` resuelve `result`. */
function makeQuery(result) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    then: (resolve) => resolve(result),
  };
  return q;
}

const dbMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  lastQuery: null,
}));

const projectMock = vi.hoisted(() => ({
  current: null,
}));

const deviceSessionMock = vi.hoisted(() => ({
  ensure: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../src/config/supabaseCloud", () => ({
  getCustomerProject: () => projectMock.current,
  setCustomerProject: vi.fn(),
  hasDirectory: () => false,
  directoryClient: { rpc: vi.fn() },
  supabaseCloud: {
    auth: authMocks,
    from: (...args) => dbMocks.from(...args),
    rpc: (...args) => dbMocks.rpc(...args),
  },
}));

vi.mock("../src/utils/deviceIdentity", () => ({
  ensureDeviceSessionRegistered: (...args) => deviceSessionMock.ensure(...args),
}));

import {
  getOwnerSession,
  signUpOwner,
  signInOwner,
  signOutOwner,
  generatePairingCode,
  redeemPairingCode,
  registerCurrentDevice,
  getMyDevices,
  revokeDevice,
  getAccountSyncContext,
  validateCurrentDeviceSyncAccess,
  checkDeviceRevocation,
  getLocalDeviceId,
  PAIRING_CODE_TTL_MIN,
  MAX_DEVICES_PER_ACCOUNT,
} from "../src/services/cloudAccount";

const OWNER_SESSION = {
  user: { id: "uid-dueno-1", email: "dueno@abasto.com" },
};
const ANON_SESSION = { user: { id: "uid-anon-9", is_anonymous: true } };

beforeEach(() => {
  vi.clearAllMocks();
  projectMock.current = null;
  deviceSessionMock.ensure.mockResolvedValue({ ok: true });
  localStorage.clear();
  localStorage.setItem("pda_device_id", "PDA-TEST-001");
  authMocks.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
  dbMocks.from.mockImplementation(() => makeQuery({ data: [], error: null }));
  dbMocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("getOwnerSession", () => {
  it("null sin sesión", async () => {
    const r = await getOwnerSession();
    expect(r.session).toBeNull();
  });

  it("la sesión anónima del POS no cuenta como dueño", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: ANON_SESSION },
      error: null,
    });
    const r = await getOwnerSession();
    expect(r.session).toBeNull();
    expect(r.anonymous).toBe(true);
  });

  it("devuelve la sesión del dueño", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    const r = await getOwnerSession();
    expect(r.session.user.email).toBe("dueno@abasto.com");
  });
});

describe("signUpOwner / signInOwner", () => {
  it("rechaza email inválido sin llamar a Supabase", async () => {
    const r = await signUpOwner("no-es-email", "secreta123");
    expect(r.ok).toBe(false);
    expect(authMocks.signUp).not.toHaveBeenCalled();
  });

  it("rechaza contraseña corta", async () => {
    const r = await signUpOwner("a@b.com", "123");
    expect(r.ok).toBe(false);
    expect(authMocks.signUp).not.toHaveBeenCalled();
  });

  it("signup sin sesión = necesita confirmación de email", async () => {
    authMocks.signUp.mockResolvedValue({
      data: { session: null, user: { id: "x" } },
      error: null,
    });
    const r = await signUpOwner("nuevo@abasto.com", "secreta123");
    expect(r.ok).toBe(true);
    expect(r.needsConfirmation).toBe(true);
  });

  it("signin propaga errores de Supabase", async () => {
    authMocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });
    const r = await signInOwner("a@b.com", "mala");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid login/);
  });

  it("signin exitoso registra el dispositivo vía RPC", async () => {
    authMocks.signInWithPassword.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    const r = await signInOwner("dueno@abasto.com", "secreta123");
    expect(r.ok).toBe(true);
    expect(r.deviceRegistered).toBe(true);
    expect(dbMocks.rpc).toHaveBeenCalledWith("register_account_device", {
      p_device_id: "PDA-TEST-001",
      p_alias: null,
      p_max_devices: MAX_DEVICES_PER_ACCOUNT,
    });
    expect(localStorage.getItem("pda_account_linked")).toBe("true");
  });

  it("signin con cuenta llena cierra la sesión y reporta el límite", async () => {
    authMocks.signInWithPassword.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "LIMIT_REACHED" },
    });
    const r = await signInOwner("dueno@abasto.com", "secreta123");
    expect(r.ok).toBe(false);
    expect(r.limitReached).toBe(true);
    expect(authMocks.signOut).toHaveBeenCalled();
    expect(localStorage.getItem("pda_account_linked")).not.toBe("true");
  });

  it("signup con cuenta llena cierra la sesión y reporta el límite", async () => {
    authMocks.signUp.mockResolvedValue({
      data: { session: OWNER_SESSION, user: { id: "x" } },
      error: null,
    });
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "LIMIT_REACHED: cuenta llena" },
    });
    const r = await signUpOwner("nuevo@abasto.com", "secreta123");
    expect(r.ok).toBe(false);
    expect(r.limitReached).toBe(true);
    expect(authMocks.signOut).toHaveBeenCalled();
  });

  it("signOut cierra sesión", async () => {
    const r = await signOutOwner();
    expect(r.ok).toBe(true);
    expect(authMocks.signOut).toHaveBeenCalled();
  });
});

describe("registerCurrentDevice / límite de equipos", () => {
  it("el tope es 6 equipos por cuenta", () => {
    expect(MAX_DEVICES_PER_ACCOUNT).toBe(6);
  });

  it("registra vía RPC con el device_id y alias", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.rpc.mockResolvedValue({ data: null, error: null });
    const r = await registerCurrentDevice("Caja 1");
    expect(r.ok).toBe(true);
    expect(r.deviceId).toBe("PDA-TEST-001");
    expect(dbMocks.rpc).toHaveBeenCalledWith("register_account_device", {
      p_device_id: "PDA-TEST-001",
      p_alias: "Caja 1",
      p_max_devices: MAX_DEVICES_PER_ACCOUNT,
    });
  });

  it("LIMIT_REACHED del servidor se mapea a limitReached", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "LIMIT_REACHED" },
    });
    const r = await registerCurrentDevice();
    expect(r.ok).toBe(false);
    expect(r.limitReached).toBe(true);
    expect(r.error).toMatch(/6 equipos/);
    expect(localStorage.getItem("pda_account_linked")).not.toBe("true");
  });

  it("otros errores del RPC se propagan tal cual", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await registerCurrentDevice();
    expect(r.ok).toBe(false);
    expect(r.limitReached).toBeUndefined();
    expect(r.error).toBe("boom");
  });

  it("sin sesión de dueño no intenta registrar", async () => {
    const r = await registerCurrentDevice();
    expect(r.ok).toBe(false);
    expect(dbMocks.rpc).not.toHaveBeenCalled();
  });
});

describe("generatePairingCode", () => {
  it("exige sesión de dueño", async () => {
    const r = await generatePairingCode();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/dueño/);
  });

  it("genera código de 6 dígitos con expiración de 10 min", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    const insertQ = makeQuery({ data: null, error: null });
    const calls = [];
    dbMocks.from.mockImplementation((table) => {
      calls.push(table);
      if (table === "pairing_codes") return makeQuery({ count: 0 });
      return insertQ;
    });
    // Primer llamado (delete) y count usan el genérico; el insert se verifica aparte.
    const r = await generatePairingCode();
    expect(r.ok).toBe(true);
    expect(r.code).toMatch(/^\d{6}$/);
    expect(PAIRING_CODE_TTL_MIN).toBe(10);
    const ttlMs = new Date(r.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60_000 + 5000);
    expect(calls).toContain("pairing_codes");
  });
});

describe("redeemPairingCode", () => {
  it("rechaza códigos que no son 6 dígitos sin llamar al RPC", async () => {
    for (const bad of ["123", "abcdef", "", "1234567"]) {
      const r = await redeemPairingCode(bad);
      expect(r.ok).toBe(false);
      expect(dbMocks.rpc).not.toHaveBeenCalled();
    }
  });

  it("limpia el código y llama al RPC con p_code y p_device_id", async () => {
    const r = await redeemPairingCode(" 48-39 20 ");
    expect(r.ok).toBe(true);
    expect(dbMocks.rpc).toHaveBeenCalledWith("redeem_pairing_code", {
      p_code: "483920",
      p_device_id: "PDA-TEST-001",
    });
    expect(localStorage.getItem("pda_account_linked")).toBe("true");
  });

  it("propaga el error del RPC (código inválido/expirado)", async () => {
    dbMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Código inválido o expirado" },
    });
    const r = await redeemPairingCode("000000");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expirado/);
  });
});

describe("getAccountSyncContext", () => {
  it("null sin sesión ni vínculo", async () => {
    expect(await getAccountSyncContext()).toBeNull();
  });

  it("modo owner: devuelve propio + hermanos", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.from.mockImplementation(() =>
      makeQuery({
        data: [{ device_id: "PDA-TEST-001" }, { device_id: "PDA-CAJA-2" }],
        error: null,
      }),
    );
    const ctx = await getAccountSyncContext();
    expect(ctx.mode).toBe("owner");
    expect(ctx.userId).toBe("uid-dueno-1");
    expect(ctx.deviceIds).toEqual(
      expect.arrayContaining(["PDA-TEST-001", "PDA-CAJA-2"]),
    );
  });

  it("modo linked: resuelve por RPC cuando se vinculó con código", async () => {
    localStorage.setItem("pda_account_linked", "true");
    dbMocks.rpc.mockResolvedValue({
      data: ["PDA-TEST-001", "PDA-CAJA-2"],
      error: null,
    });
    const ctx = await getAccountSyncContext();
    expect(ctx.mode).toBe("linked");
    expect(dbMocks.rpc).toHaveBeenCalledWith("my_account_device_ids");
    expect(ctx.deviceIds).toEqual(
      expect.arrayContaining(["PDA-TEST-001", "PDA-CAJA-2"]),
    );
  });

  it("null si el RPC no devuelve dispositivos activos", async () => {
    localStorage.setItem("pda_account_linked", "true");
    dbMocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await getAccountSyncContext()).toBeNull();
  });

  it("rechaza el contexto vinculado si el servidor ya no incluye al equipo actual", async () => {
    localStorage.setItem("pda_account_linked", "true");
    dbMocks.rpc.mockResolvedValue({ data: ["PDA-CAJA-2"], error: null });
    expect(await getAccountSyncContext()).toBeNull();
  });

  it("rechaza el contexto del dueño si el equipo actual no está activo en la cuenta", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.from.mockImplementation(() =>
      makeQuery({
        data: [{ device_id: "PDA-CAJA-2" }],
        error: null,
      }),
    );
    expect(await getAccountSyncContext()).toBeNull();
  });
});

describe("validateCurrentDeviceSyncAccess", () => {
  it("autoriza solo si el dueño conserva el equipo en la lista activa del servidor", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.from.mockImplementation(() =>
      makeQuery({ data: [{ device_id: "PDA-TEST-001" }], error: null }),
    );

    await expect(
      validateCurrentDeviceSyncAccess("PDA-TEST-001"),
    ).resolves.toMatchObject({
      ok: true,
      mode: "owner",
    });
  });

  it("falla cerrado para un equipo del dueño que ya no está activo", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.from.mockImplementation(() =>
      makeQuery({ data: [{ device_id: "PDA-CAJA-2" }], error: null }),
    );

    const access = await validateCurrentDeviceSyncAccess("PDA-TEST-001");
    expect(access.ok).toBe(false);
    expect(access.error).toMatch(/membresía activa/);
  });

  it("no trata un error al consultar membresía del dueño como acceso legacy", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.from.mockImplementation(() =>
      makeQuery({ data: null, error: { message: "sin conexión" } }),
    );

    const access = await validateCurrentDeviceSyncAccess("PDA-TEST-001");
    expect(access.ok).toBe(false);
    expect(access.error).toMatch(/membresía activa/);
  });

  it("falla cerrado si el id activo difiere de la identidad local", async () => {
    const access = await validateCurrentDeviceSyncAccess("PDA-OTRO-EQUIPO");
    expect(access).toMatchObject({ ok: false });
    expect(access.error).toMatch(/otro equipo/);
    expect(authMocks.getSession).not.toHaveBeenCalled();
  });

  it("mantiene el flujo legacy cuando no existe vínculo o sesión de dueño", async () => {
    await expect(validateCurrentDeviceSyncAccess()).resolves.toMatchObject({
      ok: true,
      mode: "legacy",
    });
  });

  it("valida por servidor el equipo vinculado por código", async () => {
    localStorage.setItem("pda_account_linked", "true");
    dbMocks.rpc.mockResolvedValue({ data: ["PDA-TEST-001"], error: null });

    await expect(validateCurrentDeviceSyncAccess()).resolves.toMatchObject({
      ok: true,
      mode: "linked",
    });
  });
});

describe("getMyDevices / revokeDevice", () => {
  it("lista dispositivos del dueño", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.from.mockImplementation(() =>
      makeQuery({
        data: [{ device_id: "PDA-TEST-001", alias: "Caja 1", revoked: false }],
        error: null,
      }),
    );
    const r = await getMyDevices();
    expect(r.ok).toBe(true);
    expect(r.devices).toHaveLength(1);
  });

  it("revocar marca revoked=true del dispositivo del dueño", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    const updateQ = makeQuery({ data: null, error: null });
    dbMocks.from.mockImplementation(() => updateQ);
    const r = await revokeDevice("PDA-CAJA-2");
    expect(r.ok).toBe(true);
    expect(updateQ.update).toHaveBeenCalledWith({ revoked: true });
  });
});

describe("checkDeviceRevocation", () => {
  it("usa la lista activa de cuenta como autoridad para el dueño", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: OWNER_SESSION },
      error: null,
    });
    dbMocks.from.mockImplementation(() => makeQuery({ data: [], error: null }));
    const status = await checkDeviceRevocation();
    expect(status).toEqual({
      ok: true,
      revoked: true,
      source: "account_devices",
    });
  });

  it("falla cerrado si no puede consultar la membresía del equipo vinculado", async () => {
    localStorage.setItem("pda_account_linked", "true");
    dbMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "sin red" },
    });
    const status = await checkDeviceRevocation();
    expect(status.ok).toBe(false);
    expect(status.revoked).toBe(false);
    expect(status.error).toMatch(/membresía activa/);
  });

  it("no cae a revocación del directorio si la cuenta está vinculada", async () => {
    projectMock.current = { code: "TEST-PROJECT" };
    localStorage.setItem("pda_account_linked", "true");
    dbMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "sin red" },
    });
    const status = await checkDeviceRevocation();
    expect(status.ok).toBe(false);
    expect(status.source).toBeUndefined();
    expect(status.error).toMatch(/membresía activa/);
  });
});

describe("getLocalDeviceId", () => {
  it("lee pda_device_id", () => {
    expect(getLocalDeviceId()).toBe("PDA-TEST-001");
  });
});
