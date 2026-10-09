import { supabaseCloud, getCustomerProject } from '../config/supabaseCloud';

const STORAGE_KEY = 'pda_offline_lease_v1';
const OFFLINE_LEASE_EVENT = 'pda_offline_lease_status';

function publishLeaseStatus(status, expiresAt = null) {
  try { window.dispatchEvent(new CustomEvent(OFFLINE_LEASE_EVENT, { detail: { status, expiresAt } })); } catch { /* no window */ }
}
const MAX_LEASE_SECONDS = 7 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 300;
const PUBLIC_KEY = {
  kty: 'EC', crv: 'P-256', ext: true, key_ops: ['verify'],
  x: '3lZwUd2tOB1pKIiQ89NGa6oTeWNKEBaCjjZXoP_ArQ4',
  y: 'iHfH8l3NtASyzQuVN3-_JHiVTV4AEWM6p7rZ7hwGv4Y',
};

const decode = (part) => {
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const OFFLINE_LEASE_STATUS_EVENT = OFFLINE_LEASE_EVENT;

export const readOfflineLease = () => {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
};

export const storeOfflineLease = (lease) => {
  try {    localStorage.setItem(STORAGE_KEY, lease); publishLeaseStatus('valid'); return true; } catch { return false; }
};

export const clearOfflineLease = () => {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* unavailable storage */ }
  publishLeaseStatus('missing');
};

/** Verify signature, expiry and binding to this installation and Supabase project. */
export async function verifyOfflineLease(lease, { deviceId, projectUrl, now = Date.now(), publicKey = PUBLIC_KEY } = {}) {
  try {
    if (!lease || !deviceId || !projectUrl || !globalThis.crypto?.subtle) return false;
    const parts = lease.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const seconds = Math.floor(now / 1000);
    if (header.alg !== 'ES256' || header.typ !== 'JWT' || claims.iss !== 'pda-offline-lease') return false;
    if (claims.aud !== projectUrl || claims.device_id !== deviceId) return false;
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return false;
    if (claims.iat > seconds + CLOCK_SKEW_SECONDS || claims.exp <= seconds) return false;
    if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_LEASE_SECONDS) return false;
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch { return false; }
}

export async function getStoredOfflineAuthorization(deviceId, now = Date.now()) {
  const projectUrl = getCustomerProject()?.url;
  const lease = readOfflineLease();
  if (await verifyOfflineLease(lease, { deviceId, projectUrl, now })) return { ok: true, lease };
  return { ok: false, lease: null };
}

export async function requestOfflineLease(deviceId) {
  if (!deviceId) return { ok: false, error: 'Dispositivo sin identidad' };
  try {
    const { data, error } = await supabaseCloud.functions.invoke('offline-lease', {
      body: { deviceId },
    });
    if (error) { publishLeaseStatus('renewal-failed'); return { ok: false, error: error.message || 'No se pudo renovar la autorización offline' }; }
    const token = data?.lease;
    const valid = await verifyOfflineLease(token, { deviceId, projectUrl: getCustomerProject()?.url });
    if (!valid) { publishLeaseStatus('invalid'); return { ok: false, error: 'Autorización offline inválida' }; }
    if (!storeOfflineLease(token)) return { ok: false, error: 'No se pudo guardar la autorización offline' };
    publishLeaseStatus('valid', data.expiresAt);
    return { ok: true, expiresAt: data.expiresAt };
  } catch (error) {
    return { ok: false, error: error?.message || 'No se pudo renovar la autorización offline' };
  }
}
