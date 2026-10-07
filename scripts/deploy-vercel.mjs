import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN) {
  console.error('Error: La variable de entorno VERCEL_TOKEN es requerida.');
  process.exit(1);
}
const TEAM_ID = 'team_OLXRkrH0ePlZ5laXI5zVU9lg';
const PROJECT_ID = 'prj_SOSo1x1i6YYom5kDrA69IVb6JXaU';
const PROJECT_NAME = 'preciosaldia-multilocal';

async function uploadFile(buffer, sha1) {
  const url = `https://api.vercel.com/v2/files?teamId=${TEAM_ID}`;
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

  const filesPayload = [];

  for (const item of rawFiles) {
    const buffer = fs.readFileSync(item.fullPath);
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
    await uploadFile(buffer, sha1);
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
    await uploadFile(buffer, sha1);
    filesPayload.push({
      file: 'vercel.json',
      sha: sha1,
      size: buffer.length,
    });
  }

  console.log(`✅ ${filesPayload.length} archivos sincronizados con Vercel.`);
  console.log('📡 Creando despliegue en producción...');

  const deployRes = await fetch(`https://api.vercel.com/v13/deployments?teamId=${TEAM_ID}`, {
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

  const deployData = await deployRes.json();
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
    const statusRes = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}?teamId=${TEAM_ID}`, {
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
