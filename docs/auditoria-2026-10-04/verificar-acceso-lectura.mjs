import fs from 'node:fs';
const out = 'docs/auditoria-2026-10-04/evidencias';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.match(/^([^#=\s]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim().replace(/^(['"])(.*)\1$/,'$2')]));
const ref = new URL(env.VITE_SUPABASE_CLOUD_URL).hostname.split('.')[0];
if(ref !== 'oshexsmweswzbwaksvra') throw new Error('Proyecto inesperado');
const headers = { Authorization: `Bearer ${env.SUPABASE_MGMT_TOKEN}`, 'Content-Type': 'application/json' };
const checks = {
  'anon-rls-counts': `BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SET LOCAL ROLE anon; SELECT current_user AS role, (select count(*) from public.device_pairings) AS visible_pairings, (select count(*) from public.device_pairings where pairing_token is not null and token_expires_at > now()) AS visible_live_tokens, (select count(*) from public.sync_documents) AS visible_sync_rows, (select count(*) from public.cloud_backups) AS visible_backups; COMMIT;`,
  'integrity-summary': `BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SELECT (select count(*) from public.account_devices where revoked) as revoked_devices, (select count(*) from public.device_sessions ds where not exists(select 1 from public.account_devices ad where ad.device_id=ds.device_id and not ad.revoked)) as sessions_without_active_account, (select count(*) from public.sync_documents s where not exists(select 1 from public.device_sessions ds where ds.device_id=s.device_id)) as sync_without_device_session, (select count(*) from public.cloud_backups) as backup_rows, (select count(*) from public.cloud_backups where backup_data is null or backup_data='{}'::jsonb) as empty_backup_rows, (select count(*) from public.schema_version) as schema_version_rows; COMMIT;`,
  'monitor-header-binding': `BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SELECT set_config('request.headers', json_build_object('x-device-id', (select monitor_device_id from public.device_pairings where monitor_device_id is not null limit 1))::text, true) IS NOT NULL AS header_configured; SET LOCAL ROLE anon; SELECT auth.uid() IS NULL AS no_user_identity, public.current_device_id() IS NOT NULL AS resolves_device_without_user, (select count(*) from public.sync_documents) AS visible_sync_rows, (select count(*) from public.cloud_backups) AS visible_backups; COMMIT;`
};
for(const [name,query] of Object.entries(checks)) {
 const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{ method:'POST',headers,body:JSON.stringify({query}),signal:AbortSignal.timeout(30_000)});
 let data=await response.json();
 fs.writeFileSync(`${out}/${name}.json`,JSON.stringify({at:new Date().toISOString(),status:response.status,data},null,2));
 console.log(name,response.status,JSON.stringify(data));
}
const http = [];
for(const url of ['https://preciosaldiaoficial.vercel.app/','https://preciosaldiaoficial.vercel.app/manifest.webmanifest','https://preciosaldiaoficial.vercel.app/api/rates']) {
 const start=performance.now();const res=await fetch(url,{signal:AbortSignal.timeout(30_000)});
 const h=Object.fromEntries(['content-type','content-security-policy','x-frame-options','x-content-type-options','strict-transport-security','referrer-policy','permissions-policy','cache-control'].map(k=>[k,res.headers.get(k)]));
 const body=await res.text();
 http.push({url,status:res.status,headers:h,bytes:Buffer.byteLength(body),durationMs:Math.round(performance.now()-start),...(url.endsWith('manifest.webmanifest')?{manifest:JSON.parse(body)}:{})});
}
fs.writeFileSync(`${out}/produccion-http.json`,JSON.stringify(http,null,2));
console.log('HTTP metadata collected');
