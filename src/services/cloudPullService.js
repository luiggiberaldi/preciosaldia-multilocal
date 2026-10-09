import localforage from 'localforage';
import { contentHash } from '../utils/contentHash';

export const CLOUD_PULL_STATUS_EVENT = 'pda_cloud_pull_status';
export const CLOUD_PULL_PAGE_SIZE = 500;
const journal = localforage.createInstance({
    name: 'BodegaCloudPull', storeName: 'pending_documents_v1',
});
const rowIdentity = row => JSON.stringify([row.device_id, row.collection, row.doc_id]);
const versionKey = (scope, row) => 'pending:' + JSON.stringify([
    scope, rowIdentity(row), row.updated_at, contentHash(row.data),
]);
export const cloudPullScope = (access, deviceId) => JSON.stringify([deviceId, access?.userId || 'legacy']);
const statusKey = deviceId => `pda_cloud_pull_status_${encodeURIComponent(deviceId || '')}`;

export function getCloudPullStatus(deviceId) {
    try {
        const id = deviceId || localStorage.getItem('pda_device_id');
        const raw = localStorage.getItem(statusKey(id));
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function publishCloudPullStatus(deviceId, result) {
    const summary = {
        status: result.status, applied: result.applied || 0, skipped: result.skipped || 0,
        pending: result.pending || 0, failed: result.failed || 0,
        pendingByReason: result.pendingByReason || {},
        pushed: result.pushed || 0, queryFailed: Boolean(result.queryFailed),
        updatedAt: new Date().toISOString(),
        // Never replace the last complete confirmation with a partial attempt.
        lastConfirmedAt: result.status === 'confirmed' && result.confirmedSync ? new Date().toISOString()
            : getCloudPullStatus(deviceId)?.lastConfirmedAt || null,
    };
    localStorage.setItem(statusKey(deviceId), JSON.stringify(summary));
    window.dispatchEvent(new CustomEvent(CLOUD_PULL_STATUS_EVENT, { detail: summary }));
    return summary;
}

export async function getPendingCloudDocuments(scope, store = journal) {
    const keys = (await store.keys()).filter(key => key.startsWith('pending:'));
    const entries = await Promise.all(keys.map(key => store.getItem(key)));
    return entries.filter(entry => entry?.scope === scope && entry.status === 'pending');
}

/** Cuenta entradas pendientes por causa: { 'unknown-business': 3, ... }. Sin payloads. */
export function countPendingByReason(entries) {
    const byReason = {};
    for (const entry of (Array.isArray(entries) ? entries : [])) {
        if (!entry) continue;
        const reason = entry.reason || 'unknown';
        byReason[reason] = (byReason[reason] || 0) + 1;
    }
    return byReason;
}

/** Private raw stays in IndexedDB; status/UI never contains payloads or error bodies. */
export async function retainCloudPullFailure(scope, row, reason, store = journal, now = Date.now()) {
    const key = versionKey(scope, row);
    const previous = await store.getItem(key);
    const attempts = (previous?.attempts || 0) + 1;
    const entry = {
        scope, row, status: 'pending', reason, contentHash: contentHash(row.data), attempts,
        firstSeenAt: previous?.firstSeenAt ?? now, lastAttemptAt: now,
        nextRetryAt: now + Math.min(300_000, 1000 * (2 ** Math.min(attempts, 8))),
    };
    await store.setItem(key, entry);
    return entry;
}

export async function resolveCloudPullFailure(scope, row, store = journal, knownPending = null) {
    const pending = knownPending || await getPendingCloudDocuments(scope, store);
    for (const existing of pending) {
        if (rowIdentity(existing.row) !== rowIdentity(row)) continue;
        const exact = versionKey(scope, existing.row) === versionKey(scope, row);
        const newer = Date.parse(row.updated_at) > Date.parse(existing.row.updated_at);
        if (!exact && !newer) continue;
        // Retain original bytes/provenance even when a repaired revision supersedes it.
        const resolved = {
            ...existing, status: 'resolved', resolvedAt: Date.now(),
            resolution: exact ? 'applied-or-already-confirmed' : 'superseded-by-confirmed-revision',
            resolvedBy: { updated_at: row.updated_at, contentHash: contentHash(row.data) },
        };
        await store.setItem(versionKey(scope, existing.row), resolved);
        Object.assign(existing, resolved);
    }
}

/** Do not publish a snapshot for a key whose incoming data could not be merged. */
export async function hasPendingCloudKey(scope, docId, store = journal) {
    return (await getPendingCloudDocuments(scope, store)).some(({ row }) => {
        if (row.doc_id === docId) return true;
        const salesKey = docId.replace(/bodega_sales_v1$/, 'bodega_sales_delta_');
        return docId.endsWith('bodega_sales_v1') && row.doc_id.startsWith(salesKey);
    });
}

function compareRows(a, b) {
    for (const key of ['updated_at', 'device_id', 'collection', 'doc_id']) {
        if (a[key] < b[key]) return -1;
        if (a[key] > b[key]) return 1;
    }
    return 0;
}
function cursorFor(row) {
    return Object.fromEntries(['updated_at', 'device_id', 'collection', 'doc_id'].map(key => [key, row[key]]));
}
function validCursor(row) {
    return row && ['updated_at', 'device_id', 'collection', 'doc_id']
        .every(key => typeof row[key] === 'string' && row[key]) && Number.isFinite(Date.parse(row.updated_at));
}

/** PostgREST keyset query: unique composite tie-breaker, no offset/2000 cap. */
export async function fetchCloudPullPage(client, deviceIds, { after, since, pageSize = CLOUD_PULL_PAGE_SIZE } = {}) {
    let query = client.from('sync_documents')
        .select('collection, doc_id, data, updated_at, device_id')
        .in('device_id', deviceIds).in('collection', ['store', 'local'])
        .order('updated_at', { ascending: true }).order('device_id', { ascending: true })
        .order('collection', { ascending: true }).order('doc_id', { ascending: true }).limit(pageSize);
    if (after) {
        const quote = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        const t = quote(after.updated_at), d = quote(after.device_id), c = quote(after.collection), id = quote(after.doc_id);
        query = query.or([
            `updated_at.gt.${t}`, `and(updated_at.eq.${t},device_id.gt.${d})`,
            `and(updated_at.eq.${t},device_id.eq.${d},collection.gt.${c})`,
            `and(updated_at.eq.${t},device_id.eq.${d},collection.eq.${c},doc_id.gt.${id})`,
        ].join(','));
    } else if (since) query = query.gte('updated_at', since);
    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Respuesta de pull inválida');
    return data;
}

let activePull = Promise.resolve();
function serializeJournal(task) {
    const result = activePull.then(task, task);
    activePull = result.catch(() => { /* next invocation still runs; caller receives rejection */ });
    return result;
}
/** Serialize applications and backup operations in this client. */
export function runCloudPull(options) {
    return serializeJournal(() => executeCloudPull(options));
}

/** Optional extension of backup v2.0: evidence only, never cursors or session state. */
export function validateCloudPullJournalBackup(backup) {
    const invalid = () => { throw new Error('Journal de sincronización del backup inválido.'); };
    if (!backup || backup.version !== 1 || !Array.isArray(backup.entries)) invalid();
    for (const entry of backup.entries) {
        let scope;
        try { scope = JSON.parse(entry?.scope); } catch { invalid(); }
        if (!Array.isArray(scope) || scope.length !== 2 || scope.some(value => typeof value !== 'string' || !value)) invalid();
        if (!entry || !['pending', 'resolved'].includes(entry.status) || !validCursor(entry.row)
            || !['store', 'local'].includes(entry.row.collection)
            || !Object.hasOwn(entry.row, 'data') || entry.row.data === undefined
            || entry.contentHash !== contentHash(entry.row.data)
            || typeof entry.reason !== 'string' || !entry.reason
            || !Number.isSafeInteger(entry.attempts) || entry.attempts < 1
            || !['firstSeenAt', 'lastAttemptAt', 'nextRetryAt'].every(key => Number.isFinite(entry[key]) && entry[key] >= 0)) invalid();
        if (entry.status === 'resolved' && (!Number.isFinite(entry.resolvedAt) || entry.resolvedAt < 0
            || !['applied-or-already-confirmed', 'superseded-by-confirmed-revision'].includes(entry.resolution)
            || typeof entry.resolvedBy?.contentHash !== 'string'
            || !Number.isFinite(Date.parse(entry.resolvedBy?.updated_at)))) invalid();
    }
    return true;
}

export function exportCloudPullJournal(store = journal) {
    return serializeJournal(async () => {
        const entries = [];
        for (const key of (await store.keys()).filter(key => key.startsWith('pending:')).sort()) {
            const entry = await store.getItem(key);
            if (!entry) throw new Error('No se pudo leer una revisión del journal; backup cancelado.');
            entries.push(entry);
        }
        const backup = { version: 1, entries };
        validateCloudPullJournalBackup(backup);
        return backup;
    });
}

/** Merge evidence only; importing it never applies a sale, grants access or advances a cursor. */
export function restoreCloudPullJournal(backup, { deviceId = localStorage.getItem('pda_device_id'), store = journal } = {}) {
    validateCloudPullJournalBackup(backup);
    if (!backup.entries.length) return Promise.resolve({ imported: 0, preserved: 0 });
    if (!deviceId) return Promise.reject(new Error('Equipo no identificado para recuperar pendientes.'));
    return serializeJournal(async () => {
        let imported = 0, preserved = 0;
        for (const original of backup.entries) {
            const [, userId] = JSON.parse(original.scope);
            // Only the installation changes. Account and source provenance never do.
            const scope = cloudPullScope({ userId }, deviceId);
            const key = versionKey(scope, original.row);
            const existing = await store.getItem(key);
            // Local evidence/status wins: an old backup must not reopen a resolved
            // revision or clear a pending one with a stale imported confirmation.
            if (existing) { preserved++; continue; }
            const entry = { ...original, scope, originScope: original.originScope || original.scope };
            await store.setItem(key, entry);
            const saved = await store.getItem(key);
            if (JSON.stringify(saved) !== JSON.stringify(entry)) throw new Error('No se confirmó la recuperación del journal.');
            imported++;
        }
        return { imported, preserved };
    });
}

async function executeCloudPull({ scope, deviceIds, fetchPage, apply, classify,
    store = journal, manual = false, pageSize = CLOUD_PULL_PAGE_SIZE, now = Date.now() }) {
    const counts = { applied: 0, skipped: 0, failed: 0, pending: 0, queryFailed: false, rows: 0 };
    const seen = new Set();
    const allowed = new Set(deviceIds);
    // Newly authorized sources must be read from the beginning too.
    const cursorKey = 'cursor:' + scope + ':' + JSON.stringify([...allowed].sort());
    const saved = manual ? null : await store.getItem(cursorKey);
    // Inclusive restart re-reads timestamp ties/new rows at the boundary.
    const since = validCursor(saved) ? saved.updated_at : null;
    let unsafe = false;
    const knownPending = await getPendingCloudDocuments(scope, store);
    const process = async row => {
        if (!allowed.has(row.device_id)) return;
        const key = versionKey(scope, row);
        if (seen.has(key)) return;
        seen.add(key);
        counts.rows++;
        const previous = knownPending.find(entry => entry.status === 'pending' && versionKey(scope, entry.row) === key);
        if (!manual && previous?.nextRetryAt > now) return;
        const disposition = classify(row);
        if (disposition === 'skip') { counts.skipped++; return; }
        try {
            if (disposition) throw new Error(disposition);
            const applied = await apply(row);
            await resolveCloudPullFailure(scope, row, store, knownPending);
            if (applied) counts.applied++; else counts.skipped++;
        } catch (error) {
            counts.failed++;
            const reason = disposition || (/schema|envelope|inválid/i.test(error?.message || '') ? 'invalid-document' : 'apply-failed');
            try {
                const retained = await retainCloudPullFailure(scope, row, reason, store, now);
                if (previous) Object.assign(previous, retained); else knownPending.push(retained);
            } catch {
                // No durable journal = no cursor advancement and no success claim.
                unsafe = true;
            }
        }
    };
    // Refresh network rows first. A repaired row can supersede its old failure;
    // retained historical versions remain for audit, never silently overwritten.
    let after = null;
    while (true) {
        let rows;
        try { rows = await fetchPage({ after, since, pageSize }); }
        catch { counts.queryFailed = true; break; }
        if (!Array.isArray(rows) || rows.length > pageSize || rows.some(row => !validCursor(row))
            || rows.some((row, i) => (i > 0 && compareRows(rows[i - 1], row) >= 0) || (after && compareRows(after, row) >= 0))) {
            counts.queryFailed = true;
            break;
        }
        for (const row of rows) await process(row);
        if (unsafe) { counts.queryFailed = true; break; }
        if (rows.length) {
            after = cursorFor(rows[rows.length - 1]);
            try { await store.setItem(cursorKey, after); }
            catch { counts.queryFailed = true; break; }
        }
        if (rows.length < pageSize) break;
    }
    const pending = await getPendingCloudDocuments(scope, store);
    for (const entry of pending) {
        // A failed authorization/network query cannot authorize replay from disk.
        if (counts.queryFailed) break;
        if (!allowed.has(entry.row.device_id) || seen.has(versionKey(scope, entry.row))) continue;
        if (!manual && entry.nextRetryAt > now) continue;
        await process(entry.row);
    }
    if (unsafe) counts.queryFailed = true;
    const remaining = await getPendingCloudDocuments(scope, store);
    counts.pending = remaining.length;
    counts.pendingByReason = countPendingByReason(remaining);
    counts.status = counts.queryFailed ? (counts.applied || counts.pending ? 'partial' : 'failed')
        : counts.pending ? 'partial' : 'confirmed';
    return counts;
}
