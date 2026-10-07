// tests/withLock.test.js — Tests para el wrapper navigator.locks con fallback.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withLock, isLocksSupported } from "../src/utils/withLock";

describe("isLocksSupported", () => {
  it("devuelve un booleano", () => {
    expect(typeof isLocksSupported()).toBe("boolean");
  });
});

describe("withLock — camino nativo (navigator.locks disponible)", () => {
  it("ejecuta el callback y devuelve su resultado", async () => {
    const result = await withLock("test_lock_1", async () => 42);
    expect(result).toBe(42);
  });

  it("propaga errores del callback sin reejecutar efectos parciales", async () => {
    const originalRequest = navigator.locks.request;
    let callbackCount = 0;
    navigator.locks.request = (name, options, callback) => callback();
    try {
      await expect(
        withLock("test_lock_2", async () => {
          callbackCount++;
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(callbackCount).toBe(1);
    } finally {
      navigator.locks.request = originalRequest;
    }
  });

  it("garantiza exclusión mutua entre llamadas concurrentes", async () => {
    const order = [];
    const slow = async (id) => {
      await withLock("mutex_test", async () => {
        order.push(`start_${id}`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`end_${id}`);
      });
    };
    await Promise.all([slow(1), slow(2), slow(3)]);
    // Deben estar start/end intercalados (no overlapping).
    expect(order).toEqual([
      "start_1",
      "end_1",
      "start_2",
      "end_2",
      "start_3",
      "end_3",
    ]);
  });
});

describe("withLock — fallback (sin navigator.locks)", () => {
  let originalLocks;
  beforeEach(() => {
    originalLocks = navigator.locks;
    // Eliminar navigator.locks para forzar el fallback.
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: originalLocks,
      configurable: true,
    });
  });

  it("cae al fallback y sigue garantizando exclusión", async () => {
    expect(isLocksSupported()).toBe(false);
    const order = [];
    const slow = async (id) => {
      await withLock("fallback_same_name_test", async () => {
        order.push(`start_${id}`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`end_${id}`);
      });
    };
    await Promise.all([slow(1), slow(2)]);
    expect(order).toEqual(["start_1", "end_1", "start_2", "end_2"]);
  });

  it("B-8: el mutex cross-tab escribe y libera la llave en localStorage", async () => {
    expect(isLocksSupported()).toBe(false);
    let keyDuringRun = null;
    await withLock("b8_lock_lifecycle", async () => {
      keyDuringRun = localStorage.getItem("pda_lock_b8_lock_lifecycle");
      expect(keyDuringRun).not.toBeNull();
      expect(JSON.parse(keyDuringRun).token).toBeTruthy();
    });
    expect(localStorage.getItem("pda_lock_b8_lock_lifecycle")).toBeNull();
  });

  it("B-8: propaga errores del callback y aun así libera la llave", async () => {
    await expect(
      withLock("b8_lock_error", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(localStorage.getItem("pda_lock_b8_lock_error")).toBeNull();
  });
});

describe("withLock — validación de argumentos", () => {
  it("lanza TypeError si name no es string", async () => {
    await expect(withLock(null, async () => 1)).rejects.toThrow(TypeError);
    await expect(withLock("", async () => 1)).rejects.toThrow(TypeError);
  });

  it("lanza TypeError si fn no es función", async () => {
    await expect(withLock("x", null)).rejects.toThrow(TypeError);
    await expect(withLock("x", "notafn")).rejects.toThrow(TypeError);
  });
});

describe("withLock — recuperación ante fallo del mecanismo nativo", () => {
  let originalRequest;
  beforeEach(() => {
    originalRequest = navigator.locks.request;
  });
  afterEach(() => {
    navigator.locks.request = originalRequest;
  });

  it("cae al mutex si navigator.locks.request lanza antes del callback", async () => {
    let callbackCount = 0;
    navigator.locks.request = () => {
      throw new Error("transient");
    };
    const result = await withLock("recovery_test", async () => {
      callbackCount++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(callbackCount).toBe(1);
  });

  it("no reejecuta el callback si request lo ejecutó y luego rechazó", async () => {
    let callbackCount = 0;
    navigator.locks.request = async (_name, _opts, fn) => {
      await fn();
      throw new Error("request rejected after callback");
    };
    await expect(
      withLock("no_retry_after_callback", async () => {
        callbackCount++;
        throw new Error("business effect failed");
      }),
    ).rejects.toThrow("business effect failed");
    expect(callbackCount).toBe(1);
  });
});

describe("withLock — timeout cross-tab sin ejecución no exclusiva", () => {
  let originalLocks;
  let originalGetItem;
  let originalSetItem;
  beforeEach(() => {
    originalLocks = navigator.locks;
    originalGetItem = Storage.prototype.getItem;
    originalSetItem = Storage.prototype.setItem;
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    });
    Storage.prototype.getItem = function getHeldLease() {
      return JSON.stringify({ token: "another-tab", ts: Date.now() });
    };
    Storage.prototype.setItem = function keepOtherTabLease() {};
  });
  afterEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: originalLocks,
      configurable: true,
    });
    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.setItem = originalSetItem;
  });

  it("rechaza sin ejecutar el callback cuando no logra adquirir el lock", async () => {
    let callbackCount = 0;
    await expect(
      withLock("busy_cross_tab_lock", async () => {
        callbackCount++;
        return "unsafe";
      }),
    ).rejects.toThrow(/no se pudo adquirir el lock cross-tab/);
    expect(callbackCount).toBe(0);
  }, 15000);
});
