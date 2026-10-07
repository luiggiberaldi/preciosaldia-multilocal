/**
 * bootNegocios.test.js — Migración automática sin pérdida (Fase 1).
 *
 * Simula una instalación legacy (claves sin prefijo en IndexedDB y
 * localStorage) y verifica que bootNegocios():
 *  - crea el registro con "Mi negocio" (neg-1),
 *  - MUEVE (no copia) cada clave de datos a nb_neg-1:<clave>,
 *  - mueve las claves de auth al namespace,
 *  - deja intactas las claves globales,
 *  - no re-migra si el registro ya existe.
 *
 * localforage se mockea con un Map en memoria (jsdom no tiene IndexedDB).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const memStore = new Map();

vi.mock("localforage", () => ({
  default: {
    config: vi.fn(),
    createInstance: vi.fn(() => ({
      getItem: async (k) => (memStore.has(k) ? memStore.get(k) : null),
      setItem: async (k, v) => {
        memStore.set(k, v);
        return v;
      },
      removeItem: async (k) => {
        memStore.delete(k);
      },
      keys: async () => [...memStore.keys()],
      clear: async () => {
        memStore.clear();
      },
    })),
    getItem: async (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: async (k, v) => {
      memStore.set(k, v);
      return v;
    },
    removeItem: async (k) => {
      memStore.delete(k);
    },
    keys: async () => [...memStore.keys()],
    clear: async () => {
      memStore.clear();
    },
  },
}));

const { bootNegocios } = await import("../src/utils/bootNegocios");
const { setNegocioActivoId } = await import("../src/utils/negocioContext");

beforeEach(() => {
  memStore.clear();
  localStorage.clear();
  setNegocioActivoId(null);
  vi.resetModules();
});

function seedLegacy() {
  // Datos legacy: claves sin prefijo.
  memStore.set("bodega_products_v1", [{ id: 1, nombre: "Arroz" }]);
  memStore.set("bodega_sales_v1", [{ id: 9, total: 100 }]);
  memStore.set("monitor_rates_v12", { bcv: 100 }); // global: no se mueve
  localStorage.setItem(
    "abasto-auth-storage",
    JSON.stringify({ state: { usuarios: [{ id: 1 }] } }),
  );
  localStorage.setItem(
    "abasto-device-session",
    JSON.stringify({ id: 1, nombre: "Admin", rol: "ADMIN" }),
  );
  localStorage.setItem("business_name", "Bodega Legacy");
  localStorage.setItem("business_rif", "J-00000000-0");
}

describe("migración automática (primer arranque)", () => {
  it("mueve claves de datos a nb_neg-1: sin copiar y sin perder", async () => {
    seedLegacy();
    const res = await bootNegocios();

    expect(res.migrated).toBe(true);
    expect(res.negocioActivoId).toBe("neg-1");
    // Movidas: destino existe…
    expect(memStore.get("nb_neg-1:bodega_products_v1")).toEqual([
      { id: 1, nombre: "Arroz" },
    ]);
    expect(memStore.get("nb_neg-1:bodega_sales_v1")).toEqual([
      { id: 9, total: 100 },
    ]);
    // …y origen borrado (mover, no copiar).
    expect(memStore.has("bodega_products_v1")).toBe(false);
    expect(memStore.has("bodega_sales_v1")).toBe(false);
    // Globales intactas.
    expect(memStore.get("monitor_rates_v12")).toEqual({ bcv: 100 });
  });

  it("mueve la sesión al namespace y deja abasto-auth-storage GLOBAL (nota M-1)", async () => {
    seedLegacy();
    await bootNegocios();
    // La sesión es por negocio: se mueve y se elimina del origen.
    expect(localStorage.getItem("nb_neg-1:abasto-device-session")).toContain(
      '"Admin"',
    );
    expect(localStorage.getItem("abasto-device-session")).toBeNull();
    // El store auth es global (clave sin enrutado en useAuthStore): NO se mueve.
    expect(localStorage.getItem("abasto-auth-storage")).toContain('"usuarios"');
    expect(localStorage.getItem("nb_neg-1:abasto-auth-storage")).toBeNull();
  });

  it("repara instalaciones con abasto-auth-storage namespaced por la versión anterior", async () => {
    // Estado dañado: la global fue movida (y borrada) por bootNegocios viejo.
    localStorage.setItem(
      "pda-negocios-registry",
      JSON.stringify({
        state: {
          negocios: [{ id: "neg-1", nombre: "Mi negocio" }],
          negocioActivoId: "neg-1",
        },
        version: 0,
      }),
    );
    localStorage.setItem(
      "nb_neg-1:abasto-auth-storage",
      JSON.stringify({
        state: { usuarios: [{ id: 1, nombre: "Admin", rol: "ADMIN" }] },
      }),
    );
    const res = await bootNegocios();
    expect(res.migrated).toBe(false);
    // Restaurada a la clave global que el store realmente lee.
    expect(localStorage.getItem("abasto-auth-storage")).toContain('"usuarios"');
  });

  it('crea el registro con "Mi negocio" heredando los datos fiscales', async () => {
    seedLegacy();
    await bootNegocios();
    const reg = JSON.parse(localStorage.getItem("pda-negocios-registry"));
    expect(reg.state.negocios).toHaveLength(1);
    expect(reg.state.negocios[0].id).toBe("neg-1");
    expect(reg.state.negocios[0].nombre).toBe("Bodega Legacy");
    expect(reg.state.negocios[0].rif).toBe("J-00000000-0");
    expect(reg.state.negocioActivoId).toBe("neg-1");
    // Espejo fiscal sincronizado.
    expect(localStorage.getItem("business_name")).toBe("Bodega Legacy");
  });

  it("no re-migra ni agrega sedes si el registro ya existe", async () => {
    const existingBusinesses = [
      { id: "neg-1", nombre: "Primera sede" },
      { id: "neg-2", nombre: "Segunda sede" },
    ];
    localStorage.setItem("pda-negocios-registry", JSON.stringify({
      state: { negocios: existingBusinesses, negocioActivoId: "neg-2" },
      version: 0,
    }));

    const res = await bootNegocios();
    expect(res.migrated).toBe(false);
    const registry = JSON.parse(localStorage.getItem("pda-negocios-registry"));
    expect(registry.state.negocios).toEqual(existingBusinesses);
    expect(registry.state.negocioActivoId).toBe("neg-2");
  });

  it("la migración de primer arranque crea solo una sede", async () => {
    seedLegacy();
    await bootNegocios();
    const registry = JSON.parse(localStorage.getItem("pda-negocios-registry"));
    expect(registry.state.negocios).toHaveLength(1);
    expect(registry.state.negocios[0].id).toBe("neg-1");
  });
});
