import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const output = path.join(root, 'docs/auditoria-2026-10-04/evidencias');
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
const token = env.SUPABASE_MGMT_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('No hay token de gestión local.');
const ref = new URL(env.VITE_SUPABASE_CLOUD_URL).hostname.split('.')[0];
if (ref !== 'oshexsmweswzbwaksvra') throw new Error('El proyecto cambió; revisar destino antes de auditar.');
const secretPattern = /(password|secret|token|api_key|anon_key|service_role_key|smtp_pass|hook_.*uri)/i;
function redact(value, key = '') {
  if (secretPattern.test(key)) return value == null || value === '' ? '[EMPTY]' : '[REDACTED]';
  if (Array.isArray(value)) return value.map(v => redact(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,redact(v,k)]));
  return value;
}
async function request(endpoint, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}${endpoint}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 500); }
  return { status: response.status, ok: response.ok, data };
}
fs.mkdirSync(output, { recursive: true });
const queries = JSON.parse(fs.readFileSync(path.join(root, 'docs/auditoria-2026-10-04/consultas-solo-lectura.json'), 'utf8'));
const manifest = { projectRef: ref, startedAt: new Date().toISOString(), queries: [], endpoints: [] };
for (const [name, query] of Object.entries(queries)) {
  if (!/^select\b/i.test(query) || /;|\b(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/i.test(query)) throw new Error(`Consulta no permitida: ${name}`);
  const result = await request('/database/query', { method: 'POST', body: JSON.stringify({ query: `BEGIN READ ONLY; SET LOCAL statement_timeout = '15s'; ${query}; COMMIT;` }) });
  fs.writeFileSync(path.join(output, `supabase-${name}.json`), JSON.stringify({ collectedAt: new Date().toISOString(), projectRef: ref, ...result }, null, 2));
  manifest.queries.push({ name, status: result.status, rows: Array.isArray(result.data) ? result.data.length : null });
  console.log(`${name}: HTTP ${result.status}`);
}
for (const [name, endpoint] of [['auth-config','/config/auth'],['functions-list','/functions'],['security-advisors','/advisors/security'],['performance-advisors','/advisors/performance']]) {
  const result = await request(endpoint);
  fs.writeFileSync(path.join(output, `supabase-${name}.json`), JSON.stringify({ collectedAt: new Date().toISOString(), projectRef: ref, ...result, data: redact(result.data) }, null, 2));
  manifest.endpoints.push({ name, status: result.status });
  console.log(`${name}: HTTP ${result.status}`);
}
manifest.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(output,'supabase-manifest.json'),JSON.stringify(manifest,null,2));
