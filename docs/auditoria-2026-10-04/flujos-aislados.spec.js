import { test, expect } from '@playwright/test';
import { SEED_INDEXEDDB_SNIPPET, SEED_LOCALSTORAGE_SNIPPET } from '../../tests/e2e/helpers/seedBrowserState.js';
import fs from 'node:fs';
const output = 'docs/auditoria-2026-10-04/evidencias';
const evidencePath = name => `${output}/${name}`;
async function isolate(page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4181') return route.continue();
    if (url.hostname.endsWith('.supabase.co')) {
      if (url.pathname === '/auth/v1/user') return route.fulfill({json:{id:'11111111-1111-4111-8111-111111111111',email:'audit@example.invalid',is_anonymous:false}});
      if (url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill({json:true});
      if (url.pathname.startsWith('/rest/v1/')) return route.fulfill({json:[]});
      if (url.pathname.startsWith('/auth/v1/')) return route.fulfill({json:{}});
    }
    if (/\/api\/rates|dolarapi/.test(url.href)) return route.fulfill({json:{usd:{price:40},eur:{price:43},usdt:{price:40}}});
    return route.abort('blockedbyclient');
  });
}
async function seed(page) {
  await isolate(page);
  await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
  await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
  await page.addInitScript(() => {
    const ref='auditproject';
    const encode=v=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    const accessToken=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'11111111-1111-4111-8111-111111111111',role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.audit`;
    localStorage.setItem('pda_customer_project',JSON.stringify({url:`https://${ref}.supabase.co`,key:'audit-public-key',code:'AUDIT-SYNTHETIC',maxDevices:6}));
    localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify({access_token:accessToken,refresh_token:'audit-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'11111111-1111-4111-8111-111111111111',email:'audit@example.invalid',is_anonymous:false}}));
    localStorage.setItem('pda_pro_activated','true');
    localStorage.setItem('pda_account_linked','true');
    localStorage.setItem('pda_business_config_done','true');
    localStorage.setItem('pda_initial_pins_shown','true');
    localStorage.setItem('pda_last_splash_date',new Date().toLocaleDateString('en-CA'));
  });
}
async function readLogical(page,key) {
  return page.evaluate(k=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('BodegaApp');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result;const tx=db.transaction('bodega_app_data','readonly');const store=tx.objectStore('bodega_app_data');const r=store.get(`nb_neg-1:${k}`);r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};
  }),key);
}
test('instalación limpia muestra licencia y explica directorio no configurado',async({page})=>{
  await isolate(page);await page.goto('/');
  await expect(page.getByRole('heading',{name:'Activa tu licencia'})).toBeVisible();
  await page.getByPlaceholder('LIC-XXXXXX').fill('AUDIT-INEXISTENTE');
  await page.getByRole('button',{name:'Verificar código'}).click();
  await expect(page.getByText(/Falta configurar el directorio/)).toBeVisible();
  await page.screenshot({path:`${output}/gate-sin-directorio.png`});
});
test('cobro exacto persiste venta y descuenta stock',async({page})=>{
  await seed(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await expect(page.locator('[data-tour="tab-ventas"]')).toBeVisible();
  await page.locator('[data-tour="tab-ventas"]').click();
  const search=page.locator('input[placeholder="Buscar producto..."]:visible').first();
  await search.fill('Cafe E2E');await search.press('Enter');await expect(search).toHaveValue('');
  await page.getByText('Ver Cesta',{exact:true}).click();await page.getByRole('button',{name:/COBRAR/}).click();
  await page.locator('div.sm\\:hidden input[type="text"][inputmode="decimal"][placeholder="0.00"]').first().fill('2.00');
  await page.getByRole('button',{name:'CONFIRMAR VENTA',exact:true}).click();
  await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible();
  const sales=await readLogical(page,'bodega_sales_v1');const products=await readLogical(page,'bodega_products_v1');
  expect(sales.filter(s=>s.tipo==='VENTA')).toHaveLength(1);expect(products.find(p=>p.id==='p_cafe').stock).toBe(49);expect(errors).toEqual([]);
  await page.screenshot({path:`${output}/cobro-exacto.png`});
});
test('las vistas permitidas al ADMIN montan y Nómina restringe acceso a 390px',async({page})=>{
  test.setTimeout(180_000);
  await seed(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await expect(page.locator('[data-tour="tab-inicio"]')).toBeVisible();
  const expectedViews = {
    inicio: page.getByText('Cerrar Caja', { exact: true }),
    ventas: page.locator('input[placeholder="Buscar producto..."]:visible').first(),
    catalogo: page.locator('input[placeholder="Buscar producto..."]:visible').first(),
    clientes: page.getByRole('heading', { name: 'Contactos', exact: true }),
    reportes: page.getByRole('heading', { name: 'Reportes', exact: true }),
    ajustes: page.getByRole('heading', { name: 'Configuración', exact: true }),
    supervision: page.getByRole('heading', { name: 'Control', exact: true }),
    nomina: page.getByText('La Zona de Nómina es solo para el dueño.', { exact: true }),
  };
  const rows=[];
  const consoleErrors=[];
  page.on('console', msg => { if(msg.type()==='error' && !/ERR_BLOCKED_BY_CLIENT/.test(msg.text())) consoleErrors.push(msg.text()); });
  for(const [tab, content] of Object.entries(expectedViews)){
    await page.locator(`[data-tour="tab-${tab}"]`).click();
    let rendered=true;
    try { await expect(content).toBeVisible({ timeout: 15_000 }); } catch { rendered=false; }
    const row=await page.evaluate(t=>({tab:t,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,text:document.body.innerText.slice(0,1000)}),tab);
    rows.push({...row,rendered,expectedAccess:tab==='nomina'?'restricted-admin':'allowed-admin'});
    await page.screenshot({path:evidencePath(`vista-${tab}.png`)});
  }
  fs.writeFileSync(evidencePath('pestanas-390-final.json'),JSON.stringify({rows,errors,consoleErrors},null,2));
  expect(rows.filter(r=>!r.rendered)).toEqual([]);
  expect(rows.filter(r=>r.overflow>1)).toEqual([]);
  expect(errors).toEqual([]);
  expect(consoleErrors.filter(m=>/App Error|ReferenceError|is not defined/.test(m))).toEqual([]);
});
test('el arranque intenta un pull de cuenta con backend simulado',async({page})=>{
  await seed(page);const pull=[];page.on('request',r=>{if(r.url().includes('/rest/v1/sync_documents')&&r.method()==='GET')pull.push(r.url());});
  await page.goto('/');await expect(page.locator('[data-tour="tab-inicio"]')).toBeVisible();
  await page.waitForTimeout(4000);
  fs.writeFileSync(evidencePath('sync-requests-final.json'),JSON.stringify(pull,null,2));
  expect(pull.some(u=>u.includes('device_id=in.')&&u.includes('collection=in.'))).toBe(true);
});
