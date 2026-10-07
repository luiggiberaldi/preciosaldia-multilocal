import { describe, expect, it } from "vitest";
import { contentHash } from "../src/utils/contentHash";

describe("contentHash", () => {
  it("detecta cambios posteriores al prefijo de 5.000 caracteres", () => {
    const first = `${"x".repeat(5000)}a`;
    const changed = `${"x".repeat(5000)}b`;
    expect(contentHash(first)).not.toBe(contentHash(changed));
  });

  it("es determinista para el mismo contenido", () => {
    const data = { sede: "central", productos: [{ id: "arroz", stock: 12 }] };
    expect(contentHash(data)).toBe(contentHash(data));
  });

  it("usa un hash completo síncrono compatible con WebViews", () => {
    const first = `${"x".repeat(5000)}a`;
    const changed = `${"x".repeat(5000)}b`;
    const firstHash = contentHash(first);
    expect(firstHash).toMatch(/^full_/);
    expect(firstHash).not.toBe(contentHash(changed));
  });
});
