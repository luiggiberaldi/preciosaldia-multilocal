import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TTL_SECONDS = 7 * 24 * 60 * 60;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const base64url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const { deviceId } = await request.json();
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 120) return json({ error: 'Invalid device' }, 400);
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const privateJwkRaw = Deno.env.get('OFFLINE_LEASE_PRIVATE_JWK');
    if (!url || !anonKey || !privateJwkRaw) return json({ error: 'Lease issuer is not configured' }, 503);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Device session required' }, 401);

    // Authenticate both the caller and this installation: owner sessions use
    // their own account_devices row; code-linked devices use the constrained
    // my_account_device_ids() RPC, which resolves membership through auth.uid().
    const { data: identity, error: identityError } = await userClient
      .from('device_sessions')
      .select('device_id')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (identityError) return json({ error: 'Device identity could not be verified' }, 503);
    if (!identity) return json({ error: 'Device identity mismatch' }, 403);

    let active = false;
    if (!userData.user.is_anonymous) {
      const { data: membership, error: membershipError } = await userClient
        .from('account_devices')
        .select('device_id, revoked')
        .eq('user_id', userData.user.id)
        .eq('device_id', deviceId)
        .maybeSingle();
      if (membershipError) return json({ error: 'Membership could not be verified' }, 503);
      active = Boolean(membership && membership.revoked === false);
      if (!active) {
        const { data: linkedIds, error: linkedError } = await userClient.rpc('my_account_device_ids');
        if (linkedError || !Array.isArray(linkedIds)) return json({ error: 'Membership could not be verified' }, 503);
        active = linkedIds.includes(deviceId);
      }
    } else {
      const { data: deviceIds, error: membershipError } = await userClient.rpc('my_account_device_ids');
      if (membershipError || !Array.isArray(deviceIds)) return json({ error: 'Membership could not be verified' }, 503);
      active = deviceIds.includes(deviceId);
    }
    if (!active) return json({ error: 'Device is not active' }, 403);

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
    const payload = base64url(new TextEncoder().encode(JSON.stringify({
      iss: 'pda-offline-lease',
      aud: url,
      device_id: deviceId,
      iat: now,
      exp: now + TTL_SECONDS,
    })));
    const key = await crypto.subtle.importKey('jwk', JSON.parse(privateJwkRaw), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, key,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    return json({ lease: `${header}.${payload}.${base64url(new Uint8Array(signature))}`, expiresAt: new Date((now + TTL_SECONDS) * 1000).toISOString() });
  } catch {
    return json({ error: 'Lease request failed' }, 400);
  }
});
