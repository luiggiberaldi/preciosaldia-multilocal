import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^VERCEL_TOKEN\s*=\s*([^\r\n]+)/m);
  if (match) {
    TOKEN = match[1].trim().replace(/^['"]|['"]$/g, '');
  }
}

if (!TOKEN) {
  console.error('Error: La variable de entorno VERCEL_TOKEN no está definida en process.env ni en .env.');
  process.exit(1);
}

const TEAM_ID = process.env.VERCEL_TEAM_ID || '';
const PROJECT_ID = 'prj_SOSo1x1i6YYom5kDrA69IVb6JXaU';
const PROJECT_NAME = 'preciosaldia-multilocal';

function vercelUrl(endpoint) {
  const separator = endpoint.includes('?') ? '&' : '?';
  return TEAM_ID ? `https://api.vercel.com${endpoint}${separator}teamId=${encodeURIComponent(TEAM_ID)}` : `https://api.vercel.com${endpoint}`;
}

async function uploadFile(buffer, sha1) {
  const url = vercelUrl('/v2/files');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'x-vercel-digest': sha1,
      'Content-Length': buffer.length.toString(),
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
  });

  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    throw new Error(`Upload failed for ${sha1}: ${res.status} ${text}`);
  }
}

function getFiles(dir, base = '') {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const relPath = base ? `${base}/${file}` : file;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFiles(fullPath, relPath));
    } else {
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

async function main() {
  console.log('🚀 Preparando despliegue de Vercel para', PROJECT_NAME);

  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('El directorio dist/ no existe. Ejecuta npm run build primero.');
  }

  const rawFiles = getFiles(distDir);
  console.log(`📦 Encontrados ${rawFiles.length} archivos en dist/`);

  const fileMapBySha = new Map();
  const filesPayload = [];

  for (const item of rawFiles) {
    const buffer = fs.readFileSync(item.fullPath);
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
    fileMapBySha.set(sha1, { fullPath: item.fullPath, buffer });
    filesPayload.push({
      file: item.relPath,
      sha: sha1,
      size: buffer.length,
    });
  }

  // Agregar vercel.json para rewrites de SPA
  const vercelJsonPath = path.resolve('vercel.json');
  if (fs.existsSync(vercelJsonPath)) {
    const buffer = fs.readFileSync(vercelJsonPath);
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
    fileMapBySha.set(sha1, { fullPath: vercelJsonPath, buffer });
    filesPayload.push({
      file: 'vercel.json',
      sha: sha1,
      size: buffer.length,
    });
  }

  async function createDeployment() {
    return fetch(vercelUrl('/v13/deployments'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: PROJECT_NAME,
        project: PROJECT_ID,
        target: 'production',
        files: filesPayload,
        routes: [
          { handle: 'filesystem' },
          { src: '/(.*)', dest: '/index.html' },
        ],
        projectSettings: {
          framework: null,
        },
      }),
    });
  }

  console.log('📡 Verificando estado de sincronización con Vercel...');
  let deployRes = await createDeployment();
  let deployData = await deployRes.json();

  if (!deployRes.ok && deployData.error && deployData.error.code === 'missing_files') {
    const missing = deployData.error.missing || [];
    console.log(`⚡ Subiendo únicamente ${missing.length} archivo(s) nuevo(s) / modificados a la CDN...`);
    for (const sha of missing) {
      const fileInfo = fileMapBySha.get(sha);
      if (!fileInfo) {
        throw new Error(`Archivo no encontrado para SHA faltante: ${sha}`);
      }
      await uploadFile(fileInfo.buffer, sha);
    }
    console.log('✅ Archivos sincronizados. Creando despliegue final...');
    deployRes = await createDeployment();
    deployData = await deployRes.json();
  }

  if (!deployRes.ok) {
    console.error('Error al crear despliegue:', deployData);
    process.exit(1);
  }

  const deploymentId = deployData.id;
  console.log(`⏳ Despliegue iniciado (ID: ${deploymentId}). URL previa: https://${deployData.url}`);
  console.log('Esperando confirmación de estado READY...');

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(vercelUrl(`/v13/deployments/${deploymentId}`), {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const statusData = await statusRes.json();

    if (statusData.readyState === 'READY') {
      console.log('\n🎉 ¡DESPLIEGUE COMPLETADO EXITOSAMENTE!');
      console.log(`🔗 URL de Despliegue: https://${statusData.url}`);
      console.log(`🌐 Dominio de Producción: https://preciosaldia-multilocal.vercel.app`);
      if (statusData.alias && statusData.alias.length) {
        console.log('Aliases asignados:', statusData.alias.join(', '));
      }
      ready = true;
      break;
    } else if (statusData.readyState === 'ERROR' || statusData.readyState === 'CANCELED') {
      console.error('\n❌ Despliegue falló:', statusData.errorCode, statusData.readyStateReason);
      process.exit(1);
    } else {
      process.stdout.write(`.`);
    }
  }

  if (!ready) {
    console.log('\n⚠️ El despliegue aún se está procesando en segundo plano.');
  }
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
