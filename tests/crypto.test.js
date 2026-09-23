// tests/crypto.test.js — Tests para utils/crypto (PBKDF2 PIN hashing).

import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, constantTimeEqual, toBase64, fromBase64 } from '../src/utils/crypto';

describe('hashPin / verifyPin — formato nuevo PBKDF2', () => {
  it('hashea un PIN y devuelve el formato pbkdf2$iter$salt$hash', async () => {
    const hash = await hashPin('246810');
    expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/);
  });

  it('verifica un PIN correcto', async () => {
    const hash = await hashPin('135724');
    const result = await verifyPin('135724', hash);
    expect(result.valid).toBe(true);
    expect(result.legacy).toBe(false);
  });

  it('rechaza un PIN incorrecto', async () => {
    const hash = await hashPin('135724');
    const result = await verifyPin('999999', hash);
    expect(result.valid).toBe(false);
  });

  it('marca needsRehash si las iteraciones son menores a la policy', async () => {
    const hash = await hashPin('135724', undefined, 1000); // pocas iteraciones
    const result = await verifyPin('135724', hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it('no marca needsRehash si las iteraciones son las actuales', async () => {
    const hash = await hashPin('135724');
    const result = await verifyPin('135724', hash);
    expect(result.needsRehash).toBe(false);
  });

  it('cada hash tiene salt distinto (aleatorio)', async () => {
    const h1 = await hashPin('samepin');
    const h2 = await hashPin('samepin');
    expect(h1).not.toBe(h2); // salt distinto → hash distinto
    const r1 = await verifyPin('samepin', h1);
    const r2 = await verifyPin('samepin', h2);
    expect(r1.valid && r2.valid).toBe(true);
  });
});

describe('verifyPin — formato legacy SHA-256 sin salt', () => {
  // Hash SHA-256 de '123456' (el que estaba embebido en el bundle).
  const LEGACY_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

  it('verifica un PIN contra hash legacy y marca legacy:true', async () => {
    const result = await verifyPin('123456', LEGACY_HASH);
    expect(result.valid).toBe(true);
    expect(result.legacy).toBe(true);
    expect(result.needsRehash).toBe(true); // debe migrarse
  });

  it('rechaza PIN incorrecto contra legacy', async () => {
    const result = await verifyPin('000000', LEGACY_HASH);
    expect(result.valid).toBe(false);
    expect(result.legacy).toBe(true);
  });
});

describe('verifyPin — casos borde', () => {
  it('PIN vacío → invalid', async () => {
    expect((await verifyPin('', 'pbkdf2$1$aa$bb')).valid).toBe(false);
  });

  it('hash malformado → invalid', async () => {
    expect((await verifyPin('123456', 'garbage')).valid).toBe(false);
    expect((await verifyPin('123456', 'pbkdf2$1$only$two$extra')).valid).toBe(false);
  });

  it('hash vacío → invalid', async () => {
    expect((await verifyPin('123456', '')).valid).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('true para strings iguales', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('false para strings distintos', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false); // distinta longitud
    expect(constantTimeEqual('abc', '')).toBe(false);
  });

  it('false para no-strings', () => {
    expect(constantTimeEqual(null, 'abc')).toBe(false);
    expect(constantTimeEqual(123, 123)).toBe(false);
  });
});

describe('toBase64 / fromBase64 — round-trip', () => {
  it('codifica y decodifica correctamente', () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64, 32]);
    const b64 = toBase64(original);
    const decoded = fromBase64(b64);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('maneja arrays vacíos', () => {
    const b64 = toBase64(new Uint8Array([]));
    expect(fromBase64(b64)).toBeInstanceOf(Uint8Array);
    expect(fromBase64(b64).length).toBe(0);
  });

  it('fromBase64 devuelve null para input inválido', () => {
    expect(fromBase64('!!!invalid!!!')).toBeNull();
  });
});
