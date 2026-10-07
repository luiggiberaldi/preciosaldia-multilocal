import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const directory = path.join(root, 'docs/auditoria-2026-10-04');
const evidence = path.join(directory, 'evidencias');
const readJson = name => JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'));
const reports = ['INFORME.md', 'PLAN-FIXEO.md'];
const linkChecks = [];
for (const file of reports) {
  const content = fs.readFileSync(path.join(directory, file), 'utf8');
  assert(!/\b(TODO|TBD)\b/.test(content), `Marcador pendiente en ${file}`);
  assert(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(content), `Posible JWT en ${file}`);
  assert(!/sbp_[A-Za-z0-9]{20,}/.test(content), `Posible token management en ${file}`);
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (link.startsWith('https://') || link.startsWith('http://')) continue;
    const [relative, fragment] = link.split('#');
    const target = path.resolve(directory, decodeURIComponent(relative));
    assert(target.startsWith(root + path.sep), `Enlace fuera del workspace: ${link}`);
    assert(fs.existsSync(target), `Enlace roto en ${file}: ${link}`);
    if (fragment?.startsWith('L')) {
      const numbers = fragment.match(/\d+/g).map(Number);
      const lines = fs.readFileSync(target, 'utf8').split('\n').length;
      assert(numbers.every(n => n > 0 && n <= lines), `Línea fuera de rango: ${link}`);
    }
    linkChecks.push({ report: file, link });
  }
}
const report = fs.readFileSync(path.join(directory, 'INFORME.md'), 'utf8');
const plan = fs.readFileSync(path.join(directory, 'PLAN-FIXEO.md'), 'utf8');
const annex = fs.readFileSync(path.join(evidence, 'sync-real-interpretacion.md'), 'utf8');
const ids = [...report.matchAll(/^### (AUD-\d{3})\b/gm)].map(m => m[1]);
assert.equal(ids.length, 34);
assert.equal(new Set(ids).size, 34);
for (let n = 1; n <= 34; n++) {
  const id = `AUD-${String(n).padStart(3, '0')}`;
  assert(ids.includes(id), `Hallazgo ausente: ${id}`);
  const covered = plan.includes(id) || [...plan.matchAll(/AUD-(\d{3})[–-](\d{3})/g)].some(m => n >= Number(m[1]) && n <= Number(m[2]));
  assert(covered, `Hallazgo sin trazabilidad: ${id}`);
}
for (let n = 1; n <= 9; n++) assert(annex.includes(`SR-00${n}`), `Hallazgo SR-${String(n).padStart(3, '0')} ausente del anexo`);
assert(plan.includes('F0-S') && plan.includes('F1.6') && plan.includes('F1.7'));
const unit = readJson('vitest-final.json');
assert.equal(unit.numTotalTests, 934);
assert.equal(unit.numPassedTests, 910);
assert.equal(unit.numFailedTests, 13);
assert.equal(unit.numPendingTests, 11);
assert.equal(unit.success, false);
assert.equal(unit.testResults.length, 81);
const e2e = readJson('e2e-aislados-final.json');
assert.equal(e2e.stats.expected, 4);
assert.equal(e2e.stats.unexpected, 0);
assert.equal(e2e.stats.skipped, 0);
const checkout = readJson('e2e-checkout-run.json');
assert.equal(checkout.externalWrites, false);
assert.equal(checkout.attempts.find(attempt => attempt.name === 'single cobro simple test').failed, 1);
const views = readJson('pestanas-390-final.json');
assert.equal(views.rows.length, 8);
assert(views.rows.every(row => row.rendered && row.overflow === 0));
assert.equal(views.rows.find(row => row.tab === 'nomina').expectedAccess, 'restricted-admin');
assert.equal(views.errors.length, 0);
const reproduced = readJson('reproducciones-locales.json');
assert.equal(reproduced.externalRequests, 0);
assert.equal(reproduced.findings.length, 10);
assert.equal(reproduced.findings.find(row => row.id === 'AUD-009').observed.rejectedPushes, 5);
const coverage = readJson('coverage-final/coverage-summary.json');
assert.equal(coverage.total.lines.pct, 54.12);
const backend = readJson('supabase-manifest.json');
assert.equal(backend.projectRef, 'oshexsmweswzbwaksvra');
assert.equal(backend.queries.length, 15);
assert(backend.queries.every(row => row.status === 201));
assert.equal(backend.endpoints.length, 4);
assert(backend.endpoints.every(row => row.status === 200));
const security = readJson('supabase-security-advisors.json');
const performance = readJson('supabase-performance-advisors.json');
assert.equal(security.data.lints.length, 29);
assert.equal(performance.data.lints.length, 24);
const live = readJson('sync-real-autenticado.json');
assert.equal(live.projectRef, 'oshexsmweswzbwaksvra');
assert.equal(live.devices.length, 4);
assert.equal(live.devices.filter(d => !d.revoked).length, 3);
assert.equal(live.devices.filter(d => d.revoked).length, 1);
assert.equal(live.accountPull.received, 72);
assert.equal(live.accessiblePull.received, 120);
assert.equal(live.accessiblePull.outsideActiveDeviceRows, 48);
assert.equal(live.realtime.subscribed, true);
assert.equal(live.realtime.eventsReceived, 0);
assert.equal(live.realtime.writesSent, 0);
assert.equal(live.originalQuery.payloadsReadInMemory, true);
assert.equal(live.devices.filter(d => !d.revoked).length, 3);
assert.equal(live.applicationMounted, false);
assert.equal(live.deviceRegistered, false);
const aggregates = readJson('sync-real-agregados.json');
assert.equal(aggregates.readOnly, true);
assert.equal(Object.keys(aggregates.queries).length, 14);
assert(Object.values(aggregates.queries).every(query => query.status === 201));
const aggregateLog = fs.readFileSync(path.join(evidence, 'sync-real-agregados.log'), 'utf8');
assert.equal((aggregateLog.match(/^\w+ 201 rows /gm) || []).length, 14);
assert(aggregateLog.includes('EXIT_CODE=0'));
assert.equal(aggregates.queries.unique_payload_producers.data.length, 12);
assert(aggregates.queries.unique_payload_producers.data.every(row => /^source-\d{2}$/.test(row.producer_alias) && !('device_id' in row)));
assert.equal(aggregates.queries.overview.data[0].rows, 120);
assert.equal(aggregates.queries.overview.data[0].source_devices, 16);
assert.equal(aggregates.queries.collisions.data[0].multi_source_documents, 22);
assert.equal(aggregates.queries.collisions.data[0].differing_payload_documents, 7);
assert.equal(aggregates.queries.revoked_access_paths.data[0].revoked_sync_rows, 36);
assert.equal(aggregates.queries.revoked_access_paths.data[0].matching_owner_identity_rows, 36);
assert.equal(aggregates.queries.sales_ticket_republication.data[0].identical_republished_ticket_ids, 4);
assert.equal(aggregates.queries.sales_ticket_republication.data[0].different_republished_ticket_ids, 0);
assert.equal(aggregates.queries.envelopes.data.find(row => row.schema_version === null).rows, 58);
assert.equal(aggregates.queries.sales_ticket_republication.data[0].multi_source_ticket_ids, 4);
const bundle = readJson('sync-real-bundle.json');
assert.equal(bundle.rootStatus, 200);
assert.equal(bundle.assetStatus, 200);
assert.equal(bundle.identical, false);
const execution = readJson('sync-real-execution.json');
assert.equal(execution.confirmedScope.active, 3);
assert.equal(execution.confirmedScope.revoked, 1);
assert.equal(execution.notExecuted.includes('trigger Realtime event'), true);
assert.equal(execution.tools.find(tool => tool.name === 'read-only-sql').effect.startsWith('14 aggregated Management API SQL queries'), true);
assert(execution.limitations.some(limitation => limitation.includes('No true two-device round trip')));
const result = {
  verifiedAt: new Date().toISOString(),
  status: 'verified',
  scope: 'Integridad de entrega y coherencia de evidencia; no certificación del producto ni de sync live',
  reports,
  baselineFindings: ids.length,
  syncReadOnlyFindings: 9,
  localLinksVerified: linkChecks.length,
  unitTests: { total: 934, passed: 910, failed: 13, skipped: 11 },
  isolatedE2E: { passed: 4, failed: 0, productionBackend: false },
  checkoutE2E: { status: 'blocked-by-e2e-bootstrap', isolatedFlowsPassed: 4, baselineSuite: 'timeout/selector failure', productionBackend: false },
  productionSyncReadOnly: { devices: '3 active / 1 revoked', activeFilteredDocuments: 72, ownerVisibleDocuments: 120, realtimeJoin: 'ok/no test event', productionBundleMatchesLocal: false },
  aggregateQueryHttpStatuses: '14/14 returned 201; wrapper exited 0',
  aggregateQueriesReadOnly: 14,
  coverageScope: 'src/utils y src/core; no toda la aplicación',
  productFixesImplemented: false,
};
fs.writeFileSync(path.join(evidence, 'entrega-verificada.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
