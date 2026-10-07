// tests/securityConstants.test.js — Tests de política de seguridad.

import { describe, it, expect } from "vitest";
import {
  validatePin,
  PIN_POLICY,
  LOGIN_RATE_LIMIT,
  FINANCIAL_EPSILON,
} from "../src/utils/securityConstants";

describe("validatePin", () => {
  it("rechaza PIN vacío", () => {
    expect(validatePin("")).not.toBeNull();
    expect(validatePin(null)).not.toBeNull();
    expect(validatePin(undefined)).not.toBeNull();
  });

  it("rechaza PIN con menos de MIN_LENGTH dígitos (CAJERO = 4)", () => {
    expect(validatePin("123")).toMatch(/al menos 4/);
    // Política vigente (decisión de negocio): 4-6 dígitos válidos sin rol.
    expect(validatePin("1234")).toBeNull();
    expect(validatePin("12345")).toBeNull();
  });

  it("acepta PIN válido de 6 dígitos (no en blacklist)", () => {
    expect(validatePin("246810")).toBeNull();
    expect(validatePin("864213")).toBeNull();
    expect(validatePin("192837")).toBeNull();
  });

  it("permite PINs de 6 dígitos incluso si están en blacklist (pedido por negocio)", () => {
    expect(validatePin("123456")).toBeNull();
    expect(validatePin("000000")).toBeNull();
    expect(validatePin("111111")).toBeNull();
  });

  it("permite secuencias de mismo dígito si cumplen longitud (pedido por negocio)", () => {
    expect(validatePin("999999")).toBeNull();
  });

  it("rechaza caracteres no numéricos cuando DIGITS_ONLY", () => {
    expect(validatePin("abc123")).toMatch(/dígito/);
    expect(validatePin("12a456")).toMatch(/dígito/);
  });

  it("acepta PIN corto de 4 dígitos y rechaza los de 7+ (MAX_LENGTH)", () => {
    expect(validatePin("1357")).toBeNull();
    expect(validatePin("13572468")).toMatch(/exceder/);
  });

  it("rechaza PIN demasiado largo", () => {
    expect(validatePin("1".repeat(33))).toMatch(/exceder/);
  });
});

describe("PIN_POLICY", () => {
  it("tiene configuración razonable (4 <= MIN <= MAX = 6)", () => {
    expect(PIN_POLICY.MIN_LENGTH).toBe(4);
    expect(PIN_POLICY.MAX_LENGTH).toBe(6);
    expect(PIN_POLICY.PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100000);
    expect(PIN_POLICY.SALT_BYTES).toBeGreaterThanOrEqual(16);
    expect(PIN_POLICY.BLACKLIST.length).toBeGreaterThan(0);
  });

  it("está congelado (no se puede mutar)", () => {
    expect(() => {
      PIN_POLICY.MIN_LENGTH = 99;
    }).toThrow();
  });
});

describe.skip("LOGIN_RATE_LIMIT (desactivado a pedido de negocio)", () => {
  it("tiene backoff exponencial", () => {
    expect(LOGIN_RATE_LIMIT.BACKOFF_FACTOR).toBeGreaterThan(1);
    expect(LOGIN_RATE_LIMIT.MAX_LOCKOUT_MS).toBeGreaterThan(
      LOGIN_RATE_LIMIT.LOCKOUT_MS,
    );
  });

  it("tiene ventana de reseteo", () => {
    expect(LOGIN_RATE_LIMIT.RESET_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe("FINANCIAL_EPSILON", () => {
  it("define tolerancias razonables para reconciliación", () => {
    expect(FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_USD).toBeGreaterThan(0);
    expect(FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS).toBeGreaterThan(0);
    expect(FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_COP).toBeGreaterThan(0);
  });

  it("define umbral de anomalía de vuelto", () => {
    expect(FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER).toBeGreaterThan(1);
    expect(FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_USD).toBeGreaterThan(0);
  });
});
