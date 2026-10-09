// tests/offlineLease.test.js — Autorización offline firmada (lease ES256).
//
// Cubre la verificación cliente de src/services/offlineLease.js con claves
// generadas en el propio test (sin red, sin servidor):
//  - lease válido dentro de la ventana → acepta;
//  - rechaza: otro equipo, otro proyecto, expirado, firma alterada, payload
//    alterado, firma de otra clave, algoritmo distinto, vigencia > 7 días,
//    iat en el futuro y formato inválido;
//  - con la clave fijada por defecto no se aceptan leases de otra clave.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/supabaseCloud', () => ({
  supabaseCloud: { functions: { invoke: vi.fn() } },
  getCustomerProject: () => ({ url: 'https://proyecto.supabase.co' }),
}));

import { verifyOfflineLease } from '../src/services/offlineLease';

const PROJECT = 'https://proyecto.supabase.co';
const DEVICE = 'PDA-TEST-LEASE-1';
const NOW_MS = Date.UTC(2026, 9, 9, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);
const WEEK = 7 * 24 * 60 * 60;

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

async function makeKeyPair() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  return { publicJwk: await crypto.subtle.exportKey('jwk', publicKey), privateKey };
}

async function signLease(privateKey, claims, header = { alg: 'ES256', typ: 'JWT' }) {
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
}

const validClaims = (overrides = {}) => ({
  iss: 'pda-offline-lease',
  aud: PROJECT,
  device_id: DEVICE,
  iat: NOW_S - 60,
  exp: NOW_S - 60 + WEEK,
  ...overrides,
});

describe('verifyOfflineLease', () => {
  it('acepta un lease firmado por el servidor para este equipo y proyecto', async () => {
    const { publicJwk, privateKey } = await makeKeyPair();
    const lease = await signLease(privateKey, validClaims());
    await expect(
      verifyOfflineLease(lease, { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS, publicKey: publicJwk }),
    ).resolves.toBe(true);
  });

  it('rechaza un lease emitido para otro equipo', async () => {
    const { publicJwk, privateKey } = await makeKeyPair();
    const lease = await signLease(privateKey, validClaims({ device_id: 'PDA-OTRO' }));
    await expect(
      verifyOfflineLease(lease, { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS, publicKey: publicJwk }),
    ).resolves.toBe(false);
  });

  it('rechaza un lease de otro proyecto (aud)', async () => {
    const { publicJwk, privateKey } = await makeKeyPair();
    const lease = await signLease(privateKey, validClaims({ aud: 'https://otro.supabase.co' }));
    await expect(
      verifyOfflineLease(lease, { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS, publicKey: publicJwk }),
    ).resolves.toBe(false);
  });

  it('rechaza un lease expirado (reinicio offline después de la vigencia)', async () => {
    const { publicJwk, privateKey } = await makeKeyPair();
    const claims = validClaims();
    const lease = await signLease(privateKey, claims);
    await expect(
      verifyOfflineLease(lease, {
        deviceId: DEVICE,
        projectUrl: PROJECT,
        now: (claims.exp + 1) * 1000,
        publicKey: publicJwk,
      }),
    ).resolves.toBe(false);
  });

  it('acepta el lease justo antes de expirar y rechaza en el instante de expiración', async () => {
    const { publicJwk, privateKey } = await makeKeyPair();
    const claims = validClaims();
    const lease = await signLease(privateKey, claims);
    const options = { deviceId: DEVICE, projectUrl: PROJECT, publicKey: publicJwk };
    await expect(verifyOfflineLease(lease, { ...options, now: (claims.exp - 1) * 1000 })).resolves.toBe(true);
    await expect(verifyOfflineLease(lease, { ...options, now: claims.exp * 1000 })).resolves.toBe(false);
  });

  it('rechaza un payload alterado aunque la firma original sea válida', async () => {
    const { publicJwk, privateKey } = await makeKeyPair();
    const lease = await signLease(privateKey, validClaims());
    const [header, , signature] = lease.split('.');
    const forged = `${header}.${b64url(validClaims({ exp: NOW_S + 10 * WEEK }))}.${signature}`;
    await expect(
      verifyOfflineLease(forged, { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS, publicKey: publicJwk }),
    ).resolves.toBe(false);
  });

  it('rechaza una firma de otra clave', async () => {
    const trusted = await makeKeyPair();
    const attacker = await makeKeyPair();
    const lease = await signLease(attacker.privateKey, validClaims());
    await expect(
      verifyOfflineLease(lease, { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS, publicKey: trusted.publicJwk }),
    ).resolves.toBe(false);
  });

  it('rechaza algoritmo distinto de ES256 y vigencias fuera de 7 días', async () => {
    const { publicJwk, privateKey } = await makeKeyPair();
    const badAlg = await signLease(privateKey, validClaims(), { alg: 'HS256', typ: 'JWT' });
    const tooLong = await signLease(privateKey, validClaims({ exp: NOW_S - 60 + WEEK + 3600 }));
    const options = { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS, publicKey: publicJwk };
    await expect(verifyOfflineLease(badAlg, options)).resolves.toBe(false);
    await expect(verifyOfflineLease(tooLong, options)).resolves.toBe(false);
  });

  it('rechaza iat en el futuro fuera de la tolerancia de reloj', async () => {
    const { publicJwk, privateKey } = await makeKeyPair();
    const lease = await signLease(privateKey, validClaims({ iat: NOW_S + 3600, exp: NOW_S + 3600 + WEEK }));
    await expect(
      verifyOfflineLease(lease, { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS, publicKey: publicJwk }),
    ).resolves.toBe(false);
  });

  it('rechaza cadenas mal formadas o vacías sin lanzar excepciones', async () => {
    const { publicJwk } = await makeKeyPair();
    const options = { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS, publicKey: publicJwk };
    await expect(verifyOfflineLease('', options)).resolves.toBe(false);
    await expect(verifyOfflineLease('a.b', options)).resolves.toBe(false);
    await expect(verifyOfflineLease('x.y.z', options)).resolves.toBe(false);
    await expect(verifyOfflineLease(null, options)).resolves.toBe(false);
  });

  it('con la clave fijada por defecto no acepta leases de otra clave', async () => {
    const { privateKey } = await makeKeyPair();
    const lease = await signLease(privateKey, validClaims());
    await expect(
      verifyOfflineLease(lease, { deviceId: DEVICE, projectUrl: PROJECT, now: NOW_MS }),
    ).resolves.toBe(false);
  });
});
