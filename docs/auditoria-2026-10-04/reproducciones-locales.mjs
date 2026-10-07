import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const findings = [];
const record = (id, detail, observed) => findings.push({id,detail,observed});
const locks = fs.readFileSync('src/utils/withLock.js','utf8').replace(/export default withLock;/,'').replace(/export /g,'').replace(/import\.meta\.env\?\.DEV/g,'false');
const context = {navigator:{locks:{request:async(_n,_o,fn)=>fn()}},window:{isSecureContext:true},console,Date,Math,Map,Promise,setTimeout};
vm.createContext(context);vm.runInContext(locks,context);
let executions=0;
try { await context.withLock('audit_callback',async()=>{executions++;throw new Error('callback error');}); } catch {}
record('AUD-004','Un callback que falla se ejecuta dos veces por fallback del lock nativo',{executions});
let swallowedExecutions=0;
const result=await context.withLock('audit_callback_transient',async()=>{swallowedExecutions++;if(swallowedExecutions===1)throw new Error('first attempt');return 'second execution accepted';});
record('AUD-004b','El mismo fallo puede transformarse en éxito tras ejecutar otra vez efectos parciales',{executions:swallowedExecutions,result});
const sync=fs.readFileSync('src/hooks/useCloudSync.js','utf8');
const hashSource=sync.match(/function quickHash\(value\) \{[\s\S]*?\n\}/)[0];
vm.runInContext(hashSource,context);
const original={padding:'a'.repeat(5100),stock:10};const changed={padding:'a'.repeat(5100),stock:11};
record('AUD-005','Cambios del mismo tamaño después del carácter 5000 generan el mismo hash',{original:context.quickHash(original),changed:context.quickHash(changed),equal:context.quickHash(original)===context.quickHash(changed)});
const delta=fs.readFileSync('src/utils/syncDelta.js','utf8').replace(/import \{ RETENTION \} from '\.\/retentionPolicy';/,'const RETENTION = {SALES_SYNC_DAYS:90};').replace(/export /g,'');
vm.runInContext(delta,context);
const start=[{id:'audit-product',stock:10}];
const remoteA={"audit-product":8};const remoteB={"audit-product":7};
// Cada fuente tiene baseline 10: ésta es la condición del contrato delta.
const afterA=context.applyStockMapDelta(start,remoteA,{"audit-product":10});const afterB=context.applyStockMapDelta(afterA.products,remoteB,{"audit-product":10});
if(afterB.products[0].stock!==5) throw new Error('Los deltas concurrentes con baseline no convergieron');
record('AUD-006','Dos fuentes con baseline conocido aplican ambos deltas concurrentes',{stockAfterA:afterA.products[0].stock,stockAfterBoth:afterB.products[0].stock,expected:5});
// A publica el stock agregado (5) como suyo; en B el último mapa de A era 8,
// por lo que el delta se cuenta de nuevo y el stock cae a 2.
const reemittedA=context.applyStockMapDelta(afterB.products,{"audit-product":5},remoteA);
record('AUD-006b','Un stock agregado re-publicado se vuelve a contar como actividad propia',{stockAfterBoth:afterB.products[0].stock,afterAggregatedRepublish:reemittedA.products[0].stock,expected:5});
const storage=fs.readFileSync('src/utils/storageService.js','utf8');
const getItem=storage.slice(storage.indexOf('    async getItem('),storage.indexOf('    /**\n     * Guarda un item'));
const storageCtx={localforage:{getItem:async()=>{throw new Error('IndexedDB unavailable');}},localStorage:{getItem:()=> '[1]'},routeStorageKey:k=>`nb_audit:${k}`,console:{error:()=>{},log:()=>{}}};
vm.createContext(storageCtx);vm.runInContext(`globalThis.storage={${getItem}}`,storageCtx);
try {await storageCtx.storage.getItem('audit',[]);record('AUD-003','La contingencia de lectura devolvió datos',{error:null});} catch(e){record('AUD-003','La contingencia de lectura falla con ReferenceError',{name:e.name,message:e.message});}
// Diagnóstico de sync manual: se ejecuta su función real con dependencias simuladas.
const manualSource=sync.slice(sync.indexOf('export const syncNow = async () => {'),sync.indexOf('/**\n * Empuja de forma forzada TODOS'))
  .replace('export const syncNow', 'globalThis.syncNow')
  .replace("await import('../services/cloudAccount.js')", 'mockCloudAccount');
let accountQueries=0;
const manualContext={supabaseCloud:{from:()=>{accountQueries++;throw new Error('Unexpected account pull');}},_currentDeviceId:'audit-device',isCloudSyncActive:true,pullBusinessRegistry:async()=>{},getAccountSyncContext:async()=>({userId:'audit-user',deviceIds:['audit-device']}),appForage:{getItem:async()=>null},pushCloudSync:async()=>({ok:false,error:'simulated rejected write'}),localStorage:{getItem:()=>null,setItem:()=>{}},mockCloudAccount:{checkDeviceRevocation:async()=>false,reportDevicesToDirectory:async()=>{}},console:{log:()=>{},warn:()=>{},error:()=>{}}};
vm.createContext(manualContext);vm.runInContext(manualSource,manualContext);
const manualResult=await manualContext.syncNow();
record('AUD-007','syncNow omite el pull de cuenta porque usa la Promise sin await',{accountQueries,result:manualResult});
manualContext.appForage.getItem=async()=>[];
let rejectedPushes=0;
manualContext.pushCloudSync=async()=>{rejectedPushes++;return {ok:false,error:'simulated rejected write'};};
const rejectedPushResult=await manualContext.syncNow();
record('AUD-009','syncNow reporta éxito aunque los cinco pushes críticos son rechazados',{rejectedPushes,result:rejectedPushResult});

const setItem=storage.slice(storage.indexOf('    async setItem('),storage.indexOf('    /**\n     * Elimina un item'));
let idbWriteAttempts=0;let lsWriteAttempts=0;
const failedWriteContext={routeStorageKey:k=>`nb_audit:${k}`,localforage:{setItem:async()=>{idbWriteAttempts++;throw new Error('simulated IDB failure');}},localStorage:{setItem:()=>{lsWriteAttempts++;throw new Error('simulated LS failure');}},_isQuotaError:()=>false,console:{error:()=>{},warn:()=>{}}};
vm.createContext(failedWriteContext);vm.runInContext(`globalThis.storage={${setItem}}`,failedWriteContext);
let writeRejected=false;
try {await failedWriteContext.storage.setItem('bodega_sales_v1',[]);}catch{writeRejected=true;}
record('AUD-011','setItem resuelve sin rechazar aunque fallan los dos medios de persistencia',{idbWriteAttempts,lsWriteAttempts,writeRejected});

const autoBackup=fs.readFileSync('src/hooks/useAutoBackup.js','utf8');
const backupContext={Math};vm.createContext(backupContext);vm.runInContext(autoBackup.match(/function quickHash\(obj\) \{[\s\S]*?\n\}/)[0],backupContext);
record('AUD-005c','El hash de respaldos también ignora cambios posteriores de igual longitud',{equal:backupContext.quickHash(original)===backupContext.quickHash(changed)});

assert.equal(executions,2);assert.equal(swallowedExecutions,2);
assert.equal(context.quickHash(original),context.quickHash(changed));
assert.equal(afterB.products[0].stock,5);assert.equal(reemittedA.products[0].stock,2);
assert.equal(findings.find(f=>f.id==='AUD-003').observed.name,'ReferenceError');
assert.equal(accountQueries,0);assert.equal(manualResult.ok,true);assert.equal(rejectedPushResult.ok,true);assert.equal(rejectedPushes,5);
assert.equal(idbWriteAttempts,1);assert.equal(lsWriteAttempts,1);assert.equal(writeRejected,false);
assert.equal(backupContext.quickHash(original),backupContext.quickHash(changed));
const data={at:new Date().toISOString(),usesRealSource:true,externalRequests:0,dependencyMode:'simulated',purpose:'Reproducción de defectos, no prueba de corrección del producto',findings};
fs.writeFileSync('docs/auditoria-2026-10-04/evidencias/reproducciones-locales.json',JSON.stringify(data,null,2));console.log(JSON.stringify(data,null,2));
