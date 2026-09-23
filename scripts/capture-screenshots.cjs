const { chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4199;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUTPUT_DIR_LANDING_PUBLIC = path.join('C:', 'Users', 'luigg', 'Desktop', 'precios al dia final', 'pagina precios al dia', 'public');
const OUTPUT_DIR_LANDING_SCREENSHOTS = path.join(OUTPUT_DIR_LANDING_PUBLIC, 'screenshots');
const OUTPUT_DIR_BODEGA_SCREENSHOTS = path.join(__dirname, '..', 'screenshots');
const BACKUP_PATH = path.join(__dirname, 'imported-backup.json');

const backupJson = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));

[OUTPUT_DIR_LANDING_PUBLIC, OUTPUT_DIR_LANDING_SCREENSHOTS, OUTPUT_DIR_BODEGA_SCREENSHOTS].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function startServer(port = PORT) {
  const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(DIST_DIR, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      const indexPath = path.join(DIST_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[Server] Corriendo en http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

async function saveToTargets(filename, buffer) {
  const target1 = path.join(OUTPUT_DIR_LANDING_PUBLIC, filename);
  const target2 = path.join(OUTPUT_DIR_LANDING_SCREENSHOTS, filename);
  const target3 = path.join(OUTPUT_DIR_BODEGA_SCREENSHOTS, filename);

  fs.writeFileSync(target1, buffer);
  fs.writeFileSync(target2, buffer);
  fs.writeFileSync(target3, buffer);
  console.log(`[Saved] ${filename} -> Guardado (${buffer.length} bytes)`);
}

async function captureAll() {
  const server = await startServer(PORT);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'es-VE'
  });

  // Mock Supabase License RPC & Queries
  await context.route('**/rest/v1/rpc/get_license_status*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ type: 'permanent', is_active: true, expires_at: null, created_at: '2026-01-01' }])
    });
  });

  await context.route('**/rest/v1/licenses*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ type: 'permanent', is_active: true, expires_at: null, created_at: '2026-01-01' }])
    });
  });

  await context.route('**/rest/v1/rpc/auto_register_device*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const activeApertura = {
    id: 'apertura_hoy_' + Date.now(),
    tipo: 'APERTURA_CAJA',
    openingUsd: 50.00,
    openingBs: 2500.00,
    openingCop: 0,
    timestamp: now.toISOString(),
    cajaCerrada: false
  };

  const salesWithOpenRegister = [activeApertura, ...(backupJson.data.idb.bodega_sales_v1 || [])];

  await context.addInitScript(({ backup, today, openSales }) => {
    localStorage.setItem('pda_terms_accepted', 'true');
    localStorage.setItem('pda_welcome_dismissed', 'true');
    localStorage.setItem('pda_last_splash_date', today);
    localStorage.setItem('pda_onboarding_completed', 'true');
    localStorage.setItem('theme', 'light');
    localStorage.setItem('cashea_enabled', 'true');
    localStorage.setItem('pda_custom_rate', '784.66');
    localStorage.setItem('pda_rate_mode', 'bcv');
    localStorage.setItem('allow_cash_advance', 'true');

    if (backup.data.ls) {
      for (const [k, v] of Object.entries(backup.data.ls)) {
        localStorage.setItem(k, typeof v === 'object' ? JSON.stringify(v) : v);
      }
    }

    if (backup.data.idb) {
      for (const [k, v] of Object.entries(backup.data.idb)) {
        localStorage.setItem(k, JSON.stringify(v));
      }
    }

    localStorage.setItem('bodega_sales_v1', JSON.stringify(openSales));

    localStorage.setItem('abasto-device-session', JSON.stringify({
      id: 1,
      nombre: 'Administrador',
      rol: 'ADMIN'
    }));
    localStorage.setItem('abasto-auth-storage', JSON.stringify({
      state: {
        usuarioActivo: { id: 1, nombre: 'Administrador', rol: 'ADMIN' },
        requireLogin: false,
        usuarios: [
          { id: 1, nombre: 'Administrador', rol: 'ADMIN' },
          { id: 2, nombre: 'Cajero', rol: 'CAJERO' }
        ]
      },
      version: 0
    }));
  }, { backup: backupJson, today: todayStr, openSales: salesWithOpenRegister });

  const page = await context.newPage();

  async function cleanAllOverlays() {
    await page.evaluate(() => {
      document.querySelectorAll('.fixed').forEach(el => {
        const text = el.innerText || '';
        if (
          text.includes('Términos y Condiciones') || 
          text.includes('Acepto los Términos') || 
          text.includes('Cargando Precios Al Día') || 
          text.includes('Buscar acciones, productos o clientes') ||
          el.getAttribute('role') === 'status'
        ) {
          el.remove();
        }
      });
    });
  }

  // 1. Dashboard
  console.log('\n--- 1. Capturando Dashboard (dashboard.png) ---');
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await cleanAllOverlays();
  const dashBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('dashboard.png', dashBuf);

  // 2. Inventario con Fotos Reales
  console.log('\n--- 2. Capturando Inventario con Fotos Reales (inventory.png) ---');
  await page.evaluate(() => {
    const tab = document.querySelector('[data-tour="tab-catalogo"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Inventario'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(3000);
  await cleanAllOverlays();
  const invBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('inventory.png', invBuf);

  // 3. POS con Carrito y Fotos de Productos
  console.log('\n--- 3. Capturando Punto de Venta con Carrito (pos.png) ---');
  await page.evaluate(() => {
    const tab = document.querySelector('[data-tour="tab-ventas"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Vender'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(2500);
  await cleanAllOverlays();

  // Click en botones de producto
  const harinaBtn = page.locator('button').filter({ hasText: 'Harina PAN 1kg' }).first();
  if (await harinaBtn.isVisible()) {
    await harinaBtn.click();
    await page.waitForTimeout(300);
    await harinaBtn.click();
    await page.waitForTimeout(300);
  }

  const mavesaBtn = page.locator('button').filter({ hasText: 'Mayonesa Mavesa 500g' }).first();
  if (await mavesaBtn.isVisible()) {
    await mavesaBtn.click();
    await page.waitForTimeout(300);
  }

  const pamperoBtn = page.locator('button').filter({ hasText: 'Salsa de Tomate Pampero 397g' }).first();
  if (await pamperoBtn.isVisible()) {
    await pamperoBtn.click();
    await page.waitForTimeout(300);
  }

  const jamonBtn = page.locator('button').filter({ hasText: 'Jamon De Pierna La Montserratina 200g' }).first();
  if (await jamonBtn.isVisible()) {
    await jamonBtn.click();
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(1000);
  await cleanAllOverlays();
  const posBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('pos.png', posBuf);

  // 4. Modal de Checkout / Cobro
  console.log('\n--- 4. Capturando Modal de Cobro / Checkout (checkout.png) ---');
  await page.click('button:has-text("COBRAR")');
  await page.waitForTimeout(1500);
  const checkBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('checkout.png', checkBuf);

  // 5. Reportes
  console.log('\n--- 5. Capturando Reportes y Cierres (reports.png) ---');
  await page.evaluate(() => {
    const checkoutModal = document.querySelector('.fixed.z-\\[100\\]') || document.querySelector('.fixed.z-\\[50\\]');
    if (checkoutModal) checkoutModal.remove();
    const tab = document.querySelector('[data-tour="tab-reportes"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reportes'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(2000);
  await cleanAllOverlays();
  const repBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('reports.png', repBuf);

  // 6. Login
  console.log('\n--- 6. Capturando Login / Control de Acceso (login.png) ---');
  const loginContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'es-VE'
  });

  await loginContext.addInitScript(({ today }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('pda_terms_accepted', 'true');
    localStorage.setItem('pda_welcome_dismissed', 'true');
    localStorage.setItem('pda_last_splash_date', today);
    localStorage.setItem('pda_onboarding_completed', 'true');
    localStorage.setItem('abasto-auth-storage', JSON.stringify({
      state: {
        usuarioActivo: null,
        requireLogin: true,
        requireAdminPin: true,
        requireCajeroPin: true,
        usuarios: [
          { id: 1, nombre: 'Administrador', rol: 'ADMIN', pin: '1234' },
          { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: '0000' }
        ]
      },
      version: 0
    }));
  }, { today: todayStr });

  const loginPage = await loginContext.newPage();
  await loginPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await loginPage.waitForTimeout(2000);
  await loginPage.evaluate(() => {
    document.querySelectorAll('.fixed').forEach(el => {
      const text = el.innerText || '';
      if (
        text.includes('Términos y Condiciones') || 
        text.includes('Acepto los Términos') || 
        text.includes('Cargando Precios Al Día') || 
        el.getAttribute('role') === 'status'
      ) {
        el.remove();
      }
    });
  });
  const loginBuf = await loginPage.screenshot({ fullPage: false });
  await saveToTargets('login.png', loginBuf);

  await browser.close();
  server.close();
  console.log('\n✅ ¡TODAS las 6 capturas fueron completadas con éxito!');
}

captureAll().catch(err => {
  console.error('Error durante la captura:', err);
  process.exit(1);
});
