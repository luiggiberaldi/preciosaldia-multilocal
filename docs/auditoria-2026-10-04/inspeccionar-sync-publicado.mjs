import fs from 'node:fs';
const origin = 'https://preciosaldiaoficial.vercel.app';
const metadata = JSON.parse(fs.readFileSync('docs/auditoria-2026-10-04/evidencias/sync-real-bundle.json'));
const root = await fetch(new URL(metadata.productionAssetPath, origin), { signal: AbortSignal.timeout(30_000) }).then(r => r.text());
const paths = [...new Set([...root.matchAll(/["'](?:\.\/)?(?:assets\/)?([^"'\s]+\.js)["']/g)].map(m => m[1]).filter(p => !p.includes('://')))];
console.log('Public chunk names:', paths.filter(p => /(sync|cloud|App|Supervision|Owner|Security|Gate|main|index)/i.test(p)).join(', '));
const selected = paths.filter(p => /(useCloudSync|cloudAccount|App-|CloudGate|SupervisionView|OwnerMonitorView|useSecurity)/.test(p));
const modules = [{ path: metadata.productionAssetPath, source: root }];
for (const p of selected) {
  const u = new URL(`/assets/${p}`, origin);
  const response = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  if (response.ok) modules.push({ path: u.pathname, source: await response.text() });
}
const terms = ['Sincronizado correctamente', 'Sincronización pausada', 'sin_monitor', 'bodega_stock_v1', 'pda_stock_lastremote_', 'cloud_pull_watermark_', 'bodega_users_catalog_v1', 'forcePushLocalData', 'nsGet', 'getAccountSyncContext', 'device_pairings', 'sync_documents', 'bodega_sales_v1', 'schemaVersion', 'Sincronizar', 'supervisor_sync_updated_at_', 'nb_', 'Modo cuenta activo', 'setInterval', 'CloudGate', '2.1.', 'pda_customer_project'];
function safeSnippet(text) {
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[PUBLIC_JWT_REDACTED]').replace(/sbp_[A-Za-z0-9]+/g, '[TOKEN_REDACTED]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]');
}
const result = { at: new Date().toISOString(), purpose: 'Análisis estático del artefacto público real; no ejecución ni prueba de escrituras', relatedChunkNames: selected, modules: modules.map(m => ({ path: m.path, bytes: Buffer.byteLength(m.source), markers: terms.filter(t => m.source.includes(t)), snippets: terms.flatMap(t => { const i = m.source.indexOf(t); return i < 0 ? [] : [{ marker: t, text: safeSnippet(m.source.slice(Math.max(0, i - 350), i + 650)) }]; }) })) };
fs.writeFileSync('docs/auditoria-2026-10-04/evidencias/sync-real-publicado.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
