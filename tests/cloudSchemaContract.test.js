/**
 * tests/cloudSchemaContract.test.js — Contrato de forma de filas cloud.
 *
 * Contexto (BUG-7d06e1b / PGRST204): `useCloudBackup` enviaba `size_bytes`
 * como columna de `cloud_backups` y PostgREST rechazaba el upsert. Este test
 * fija el contrato: ninguna fila producida por los writers puede contener
 * claves fuera de la allowlist del esquema real.
 *
 * Capas:
 *  1. Allowlists canónicas (src/config/cloudSchema.js).
 *  2. Builders puros: aceptan y rechazan lo correcto.
 *  3. Fuentes reales de filas: el payload comprimido de useCloudBackup y las
 *     filas de sync del armature (mismo mapeo), inspeccionadas de punta a punta.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { _lfStore, _pushCloudSyncSpy } = vi.hoisted(() => ({
    _lfStore: new Map(),
    _pushCloudSyncSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('localforage', () => {
    const impl = {
        config: () => {},
        getItem: async (k) => (_lfStore.has(k) ? _lfStore.get(k) : null),
        setItem: async (k, v) => { _lfStore.set(k, v); },
        removeItem: async (k) => { _lfStore.delete(k); },
        clear: async () => { _lfStore.clear(); },
        createInstance: () => ({
            getItem: async () => null,
            setItem: async () => {},
            removeItem: async () => {},
            clear: async () => {},
        }),
    };
    return { default: impl, ...impl };
});

vi.mock('../src/hooks/useCloudSync', () => ({
    pushCloudSync: _pushCloudSyncSpy,
    queueCloudSync: _pushCloudSyncSpy,
    useCloudSync: vi.fn(),
}));

import {
    CLOUD_BACKUPS_COLUMNS,
    CLOUD_BACKUPS_WRITABLE,
    SYNC_DOCUMENTS_COLUMNS,
    SYNC_DOCUMENTS_WRITABLE,
    SYNC_COLLECTIONS,
    validateRowShape,
    buildCloudBackupsRow,
    buildSyncDocumentRow,
} from '../src/config/cloudSchema';
import { collectLocalBackupPayload, countBackupRecords } from '../src/utils/backupRestoreService';
import { _resetSyncFlag } from '../src/utils/syncFlags';

beforeEach(() => {
    _lfStore.clear();
    _pushCloudSyncSpy.mockClear();
    localStorage.clear();
    _resetSyncFlag();
});

// ─── 1. Allowlists ──────────────────────────────────────────────────────────

describe('allowlists canónicas del esquema cloud', () => {
    it('cloud_backups: esquema completo real (vía OpenAPI) con columnas legacy', () => {
        // Esquema real verificado en vivo; email/password_hash son legacy.
        expect([...CLOUD_BACKUPS_COLUMNS].sort()).toEqual(
            ['backup_data', 'device_id', 'email', 'id', 'password_hash', 'updated_at']
        );
    });

    it('cloud_backups: solo device_id, backup_data, updated_at son escribibles', () => {
        expect([...CLOUD_BACKUPS_WRITABLE].sort()).toEqual(['backup_data', 'device_id', 'updated_at']);
        // writable ⊆ esquema completo
        for (const col of CLOUD_BACKUPS_WRITABLE) {
            expect(CLOUD_BACKUPS_COLUMNS).toContain(col);
        }
    });

    it('sync_documents: esquema completo real incluye id y payload (legacy)', () => {
        expect([...SYNC_DOCUMENTS_COLUMNS].sort()).toEqual(
            ['collection', 'data', 'device_id', 'doc_id', 'id', 'payload', 'updated_at']
        );
    });

    it('sync_documents: writable excluye id y payload (legacy/autogeneradas)', () => {
        expect([...SYNC_DOCUMENTS_WRITABLE].sort()).toEqual(
            ['collection', 'data', 'device_id', 'doc_id', 'updated_at']
        );
        for (const col of SYNC_DOCUMENTS_WRITABLE) {
            expect(SYNC_DOCUMENTS_COLUMNS).toContain(col);
        }
    });

    it('las colecciones válidas son store y local', () => {
        expect(SYNC_COLLECTIONS).toEqual(['store', 'local']);
    });
});

// ─── 2. Builders ────────────────────────────────────────────────────────────

describe('buildCloudBackupsRow', () => {
    it('produce solo columnas permitidas y defaults de updated_at', () => {
        const row = buildCloudBackupsRow({ deviceId: 'PDA-TEST', backupData: { a: 1 } });
        expect(Object.keys(row).sort()).toEqual(['backup_data', 'device_id', 'updated_at']);
        expect(row.device_id).toBe('PDA-TEST');
        expect(row.backup_data).toEqual({ a: 1 });
        expect(new Date(row.updated_at).toString()).not.toBe('Invalid Date');
    });

    it('LANZA si alguien intenta reintroducir una columna inexistente (regresión PGRST204)', () => {
        // La forma exacta del bug: size_bytes como columna.
        expect(() => buildCloudBackupsRow({
            deviceId: 'PDA-TEST',
            backupData: { a: 1 },
            // @ts-expect-error — simulamos un futuro desarrollador que añade la columna prohibida
            size_bytes: 1234,
        })).toThrow(/size_bytes/);
    });

    it('lanza con cualquier columna desconocida', () => {
        expect(() => buildCloudBackupsRow({
            deviceId: 'PDA-TEST',
            backupData: {},
            // @ts-expect-error
            email: 'x@y.z',
        })).toThrow(/email/);
    });
});

describe('buildSyncDocumentRow', () => {
    it('produce solo columnas permitidas', () => {
        const row = buildSyncDocumentRow({
            deviceId: 'PDA-TEST',
            collection: 'store',
            docId: 'bodega_products_v1',
            data: { payload: [] },
        });
        expect(Object.keys(row).sort()).toEqual(
            ['collection', 'data', 'device_id', 'doc_id', 'updated_at']
        );
    });

    it('rechaza colecciones inválidas', () => {
        expect(() => buildSyncDocumentRow({
            deviceId: 'PDA-TEST',
            collection: 'otra',
            docId: 'k',
            data: {},
        })).toThrow(/collection/);
    });
});

// ─── 3. Fuentes reales de filas ─────────────────────────────────────────────

describe('contrato de punta a punta con los payloads reales', () => {
    it('el payload comprimido estilo uploadLocalBackup cabe en la fila canónica', async () => {
        // Sembrar datos mínimos y recolectar como lo hace el hook.
        await localStorage.setItem('business_name', 'Bodega Contrato');
        _lfStore.set('bodega_products_v1', [{ id: 'p1', stock: 55.5 }]);
        const localBackup = await collectLocalBackupPayload();

        const compressedPayload = {
            compressed: true,
            version: '2.0',
            timestamp: localBackup.timestamp,
            appName: localBackup.appName,
            summary: {
                idbKeys: Object.keys(localBackup.data.idb),
                lsKeys: Object.keys(localBackup.data.ls),
                recordCount: countBackupRecords(localBackup),
            },
            data: 'H4sIAAAAAAAAE-wA//8', // base64 placeholder (no se sube aquí)
        };

        // El builder no debe rechazar el payload real (ninguna clave extra).
        const row = buildCloudBackupsRow({
            deviceId: 'PDA-CONTRACT',
            backupData: compressedPayload,
        });
        expect(row.backup_data.compressed).toBe(true);
        expect(row.backup_data.summary.recordCount).toBeGreaterThan(0);

        // Y la validación de forma debe pasar contra las columnas escribibles.
        const { ok, invalidKeys } = validateRowShape(row, CLOUD_BACKUPS_WRITABLE, 'cloud_backups');
        expect(ok).toBe(true);
        expect(invalidKeys).toEqual([]);
    });

    it('las filas de sync del mapeo de uploadLocalBackup son válidas', () => {
        const idb = { bodega_products_v1: [{ id: 'p1' }] };
        const ls = { business_name: 'Bodega' };
        const rows = [
            ...Object.entries(idb).map(([key, value]) =>
                buildSyncDocumentRow({ deviceId: 'PDA-CONTRACT', collection: 'store', docId: key, data: { payload: value } })),
            ...Object.entries(ls).map(([key, value]) =>
                buildSyncDocumentRow({ deviceId: 'PDA-CONTRACT', collection: 'local', docId: key, data: { payload: value } })),
        ];
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            const { ok, invalidKeys } = validateRowShape(row, SYNC_DOCUMENTS_WRITABLE, 'sync_documents');
            expect(ok).toBe(true);
            expect(invalidKeys).toEqual([]);
        }
    });
});
