const config = await fetch('/config').then(r => r.json());
const base = new URL(config.url).origin;
let session = null;
let devices = [];
const requestLog = [];
const aliases = new Map();
const alias = id => {
  if (!aliases.has(id)) aliases.set(id, `equipo-${aliases.size + 1}`);
  return aliases.get(id);
};
const status = document.querySelector('#status');
const output = document.querySelector('#results');
const report = { projectRef: new URL(base).hostname.split('.')[0], mode: 'authenticated-read-only', auth: null, snapshots: [], requests: requestLog, applicationMounted: false, deviceRegistered: false };
window.__syncAuditReport = report;
const render = () => { output.textContent = JSON.stringify(report, null, 2); };
async function call(endpoint, { method = 'GET', body, authenticated = true, count = false } = {}) {
  const destination = new URL(endpoint, base);
  if (destination.origin !== base) throw new Error('Destino externo no autorizado');
  const authLogin = destination.pathname === '/auth/v1/token' && destination.search === '?grant_type=password';
  if (method !== 'GET' && !(method === 'POST' && authLogin && !session)) throw new Error('Mutación bloqueada por guard de auditoría');
  if (method === 'GET' && !['/auth/v1/user', '/rest/v1/account_devices', '/rest/v1/device_sessions', '/rest/v1/sync_documents'].includes(destination.pathname)) throw new Error('Lectura no allowlisted');
  const headers = { apikey: config.key, 'Content-Type': 'application/json' };
  if (authenticated && session) headers.Authorization = `Bearer ${session.access_token}`;
  if (count) headers.Prefer = 'count=exact';
  const start = performance.now();
  const response = await fetch(destination, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const raw = await response.text();
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  requestLog.push({ method, path: destination.pathname, status: response.status, durationMs: Math.round(performance.now() - start), bytes: new TextEncoder().encode(raw).length, contentRange: response.headers.get('content-range'), errorCode: response.ok ? null : data?.code || data?.error_code || null });
  return { ok: response.ok, status: response.status, data, range: response.headers.get('content-range') };
}
const rest = (table, params, options) => call(`/rest/v1/${table}?${new URLSearchParams(params)}`, options);
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(b => b.toString(16).padStart(2, '0')).join('');
function family(docId) {
  const key = docId.includes(':') ? docId.slice(docId.indexOf(':') + 1) : docId;
  if (key.startsWith('bodega_sales_delta_')) return 'sales_delta';
  if (key.startsWith('bodega_payroll_')) return 'payroll';
  const allowed = ['bodega_products_v1', 'bodega_stock_v1', 'bodega_sales_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2', 'bodega_users_catalog_v1', 'bodega_businesses_registry_v1'];
  return allowed.includes(key) ? key : 'other';
}
function summarize(docs) {
  const grouped = {};
  for (const row of docs) {
    const device = alias(row.device_id);
    const f = family(row.doc_id);
    const key = `${device}/${f}`;
    const group = grouped[key] ||= { device, family: f, rows: 0, namespaced: 0, newestUpdatedAt: null, oldestUpdatedAt: null };
    group.rows++;
    if (row.doc_id.startsWith('nb_')) group.namespaced++;
    if (!group.newestUpdatedAt || row.updated_at > group.newestUpdatedAt) group.newestUpdatedAt = row.updated_at;
    if (!group.oldestUpdatedAt || row.updated_at < group.oldestUpdatedAt) group.oldestUpdatedAt = row.updated_at;
  }
  return Object.values(grouped);
}
async function pageMetadata(params) {
  const docs = [];
  let total = null;
  for (let offset = 0; offset < 5000; offset += 500) {
    const res = await rest('sync_documents', { ...params, select: 'id,device_id,collection,doc_id,updated_at', order: 'updated_at.asc,id.asc', limit: '500', offset: String(offset) }, { count: true });
    if (!res.ok || !Array.isArray(res.data)) return { ok: false, status: res.status, docs, total };
    const n = res.range?.split('/')[1];
    if (n && n !== '*') total = Number(n);
    docs.push(...res.data);
    if (res.data.length < 500) return { ok: true, docs, total, complete: true };
  }
  return { ok: true, docs, total, complete: total !== null && docs.length >= total };
}
async function inspect() {
  status.textContent = 'Consultando backend real con GET...';
  document.querySelector('#inspect').disabled = true;
  try {
    const res = await rest('account_devices', { select: 'device_id,revoked,created_at,last_seen,business_id', user_id: `eq.${session.user.id}`, order: 'last_seen.desc' });
    if (!res.ok || !Array.isArray(res.data)) throw new Error(`Lectura de equipos falló: HTTP ${res.status}`);
    devices = res.data;
    const identity = await rest('device_sessions', { select: 'device_id,first_seen,last_seen', user_id: `eq.${session.user.id}` });
    const active = devices.filter(d => !d.revoked);
    const ids = active.map(d => d.device_id);
    const params = { collection: 'in.(store,local)', ...(ids.length ? { device_id: `in.(${ids.join(',')})` } : { device_id: 'eq.AUDIT-NO-ACTIVE-DEVICE' }) };
    const account = await pageMetadata(params);
    const accessible = await pageMetadata({ collection: 'in.(store,local)' });
    const knownSessions = new Set((identity.data || []).map(d => d.device_id));
    const activeIds = new Set(ids);
    const snapshot = {
      at: new Date().toISOString(),
      devices: devices.map(d => ({ device: alias(d.device_id), revoked: d.revoked, createdAt: d.created_at, lastSeen: d.last_seen, businessAssigned: Boolean(d.business_id), ownedSessionVisible: knownSessions.has(d.device_id) })),
      identityRead: { status: identity.status, ownSessionRows: Array.isArray(identity.data) ? identity.data.length : null },
      accountPull: { ok: account.ok, total: account.total, received: account.docs.length, complete: account.complete, metadataDigest: await digest(account.docs), families: summarize(account.docs) },
      accessiblePull: { ok: accessible.ok, total: accessible.total, received: accessible.docs.length, complete: accessible.complete, outsideActiveDeviceRows: accessible.docs.filter(d => !activeIds.has(d.device_id)).length, metadataDigest: await digest(accessible.docs), families: summarize(accessible.docs) },
    };
    // Mismo select/filtros/límite que el pull inicial: validar contrato real,
    // sin mostrar, persistir ni aplicar el contenido privado de los documentos.
    const original = await rest('sync_documents', { select: 'collection,doc_id,data,updated_at,device_id', ...params, order: 'updated_at.asc', limit: '2000' });
    snapshot.originalQuery = { status: original.status, rows: Array.isArray(original.data) ? original.data.length : null, envelopes: {}, payloadsPersisted: false };
    if (Array.isArray(original.data)) {
      for (const row of original.data) {
        const shape = row.data && typeof row.data === 'object' && !Array.isArray(row.data) && 'payload' in row.data ? 'envelope-payload' : Array.isArray(row.data) ? 'raw-array' : typeof row.data;
        snapshot.originalQuery.envelopes[shape] = (snapshot.originalQuery.envelopes[shape] || 0) + 1;
      }
    }
    const firstDevice = active[0]?.device_id;
    if (firstDevice) {
      snapshot.realtime = await new Promise(resolve => {
        const socketUrl = new URL(base.replace('https:', 'wss:') + '/realtime/v1/websocket');
        socketUrl.searchParams.set('apikey', config.key);
        socketUrl.searchParams.set('vsn', '1.0.0');
        const socket = new WebSocket(socketUrl);
        const topic = `realtime:audit-read-${crypto.randomUUID()}`;
        const result = { device: alias(firstDevice), connected: false, subscribed: false, eventsReceived: 0, writesSent: 0, serverStatus: null };
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.close();
          resolve(result);
        };
        const timeout = setTimeout(finish, 8000);
        socket.onopen = () => {
          result.connected = true;
          socket.send(JSON.stringify({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'sync_documents', filter: `device_id=eq.${firstDevice}` }], private: false }, access_token: session.access_token }, ref: '1', join_ref: '1' }));
        };
        socket.onmessage = event => {
          const message = JSON.parse(event.data);
          if (message.event === 'phx_reply' && message.ref === '1') {
            result.serverStatus = message.payload?.status || null;
            result.subscribed = message.payload?.status === 'ok' && Array.isArray(message.payload?.response?.postgres_changes) && message.payload.response.postgres_changes.length > 0;
            setTimeout(finish, 1000);
          }
          if (message.event === 'postgres_changes') result.eventsReceived++;
        };
        socket.onerror = finish;
        socket.onclose = finish;
      });
    }
    report.snapshots.push(snapshot);
    status.textContent = 'Lecturas reales terminadas. No se ejecutaron escrituras ni registro de equipos.';
    render();
  } catch (error) {
    report.snapshots.push({ at: new Date().toISOString(), error: error.message });
    status.textContent = error.message;
    render();
  } finally { document.querySelector('#inspect').disabled = false; }
}
document.querySelector('#login').addEventListener('submit', async event => {
  event.preventDefault();
  document.querySelector('#loginButton').disabled = true;
  const email = document.querySelector('#email').value;
  const password = document.querySelector('#password').value;
  try {
    const result = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, authenticated: false });
    document.querySelector('#password').value = '';
    if (!result.ok || !result.data?.access_token) throw new Error(`Autenticación falló: HTTP ${result.status}`);
    session = result.data;
    report.auth = { authenticated: true, anonymous: Boolean(session.user?.is_anonymous), persisted: false, expiresAt: session.expires_at || null };
    const user = await call('/auth/v1/user');
    report.auth.userVerificationStatus = user.status;
    status.textContent = 'Sesión de dueño autenticada, sólo en memoria.';
    document.querySelector('#login').hidden = true;
    document.querySelector('#inspect').disabled = false;
    render();
  } catch (error) { status.textContent = error.message; document.querySelector('#loginButton').disabled = false; }
});
document.querySelector('#inspect').addEventListener('click', inspect);
