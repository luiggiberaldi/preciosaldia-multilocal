// tests/cloudGate.test.js — CloudGate: resolución del proyecto por código.
// Cubre normalización del código, directorio sin configurar, RPC ok/error
// y el Proxy perezoso de supabaseCloud (lanza antes de resolver el proyecto).
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();

vi.mock("../src/config/supabaseCloud.js", () => {
  let project = null;
  let client = null;
  return {
    // Directorio: el test controla si existe y qué devuelve el RPC.
    __setDirectory: (c) => {
      mod.directoryClient = c;
    },
    get directoryClient() {
      return mod.directoryClient;
    },
    hasDirectory: () => !!mod.directoryClient,
    ensureCustomerClient: () => client,
    hasCustomerProject: () => !!project,
    setCustomerProject: (p) => {
      project = p;
      client = { from: () => "ok", auth: {} };
      return p;
    },
    getCustomerProject: () => project,
    clearCustomerProject: async () => {
      project = null;
      client = null;
    },
    supabaseCloud: new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then" || typeof prop === "symbol") return undefined;
          if (!client) {
            throw new Error("[CloudGate] Proyecto del cliente sin resolver");
          }
          const v = client[prop];
          return typeof v === "function" ? v.bind(client) : v;
        },
      },
    ),
  };
});
const mod = { directoryClient: null };

import { lookupProjectByCode } from "../src/services/customerDirectory.js";
import {
  supabaseCloud,
  ensureCustomerClient,
  setCustomerProject,
  clearCustomerProject,
  hasCustomerProject,
} from "../src/config/supabaseCloud.js";

beforeEach(() => {
  mod.directoryClient = null;
  rpcMock.mockReset();
  return clearCustomerProject();
});

describe("lookupProjectByCode", () => {
  it("normaliza el código a mayúsculas sin espacios", async () => {
    rpcMock.mockResolvedValue({
      data: { supabase_url: "https://a.supabase.co", supabase_anon_key: "k" },
      error: null,
    });
    mod.directoryClient = { rpc: rpcMock };
    const res = await lookupProjectByCode("  lic-abc123  ");
    expect(res.ok).toBe(true);
    expect(res.project.code).toBe("LIC-ABC123");
    expect(rpcMock).toHaveBeenCalledWith("lookup_customer_project", {
      p_code: "LIC-ABC123",
    });
  });

  it("rechaza el código vacío sin tocar la red", async () => {
    mod.directoryClient = { rpc: rpcMock };
    const res = await lookupProjectByCode("   ");
    expect(res.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("avisa si el directorio no está configurado", async () => {
    const res = await lookupProjectByCode("LIC-1");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/directorio/i);
  });

  it("código inexistente → error claro", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    mod.directoryClient = { rpc: rpcMock };
    const res = await lookupProjectByCode("LIC-NOPE");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no encontrado/i);
  });

  it("error del RPC → mensaje sin exponer detalles internos", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("PGRST205") });
    mod.directoryClient = { rpc: rpcMock };
    const res = await lookupProjectByCode("LIC-1");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no se pudo verificar/i);
  });

  it("devuelve url + key del proyecto en el formato que espera setCustomerProject", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { supabase_url: "https://c.supabase.co", supabase_anon_key: "anon-k" },
      ],
      error: null,
    });
    mod.directoryClient = { rpc: rpcMock };
    const res = await lookupProjectByCode("LIC-9");
    expect(res.ok).toBe(true);
    expect(res.project).toEqual({
      url: "https://c.supabase.co",
      key: "anon-k",
      code: "LIC-9",
      maxDevices: 6,
      revokedDeviceIds: [],
    });
    // El formato encaja directo en setCustomerProject.
    const { getCustomerProject } =
      await import("../src/config/supabaseCloud.js");
    setCustomerProject(res.project);
    expect(hasCustomerProject()).toBe(true);
    expect(getCustomerProject()).toEqual(res.project);
    expect(ensureCustomerClient()).toBeTruthy();
  });
});

describe("supabaseCloud perezoso", () => {
  it("lanza un error claro si se usa antes de resolver el proyecto", () => {
    expect(() => supabaseCloud.from("x")).toThrow(/sin resolver/i);
  });

  it("deja de lanzar una vez resuelto el proyecto", () => {
    setCustomerProject({ url: "u", key: "k", code: "C" });
    expect(supabaseCloud.from("x")).toBe("ok");
  });

  it("clearCustomerProject vuelve a dejarlo sin resolver", async () => {
    setCustomerProject({ url: "u", key: "k", code: "C" });
    await clearCustomerProject();
    expect(hasCustomerProject()).toBe(false);
    expect(() => supabaseCloud.auth).toThrow(/sin resolver/i);
  });
});
