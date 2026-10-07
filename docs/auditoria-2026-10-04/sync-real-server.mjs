import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const root = process.cwd();
const folder = path.join(root, 'docs/auditoria-2026-10-04');
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).map(line => line.match(/^([^#=\s]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^(['"])(.*)\1$/, '$2')]));
const url = env.VITE_SUPABASE_CLOUD_URL;
const key = env.VITE_SUPABASE_CLOUD_KEY || env.VITE_SUPABASE_ANON_KEY;
if (new URL(url).hostname !== 'oshexsmweswzbwaksvra.supabase.co' || !key) throw new Error('Destino/configuración inesperados');
http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405); res.end('Read-only diagnostic'); return; }
  if (req.url === '/config') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ url, key }));
    return;
  }
  const routes = { '/': ['sync-real.html', 'text/html; charset=utf-8'], '/sync-real-browser.js': ['sync-real-browser.js', 'text/javascript; charset=utf-8'] };
  const file = routes[req.url];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file[1]);
  res.end(fs.readFileSync(path.join(folder, file[0])));
}).listen(4182, '127.0.0.1', () => console.log('Read-only sync diagnostic ready: http://127.0.0.1:4182'));
