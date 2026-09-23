/**
 * tests/backupRestore.test.js — Tests de respaldo/restauración (BACKUP-FIXES).
 *
 * Cubre:
 *  - BACKUP-001: round-trip nube → dispositivo (payload completo en cloud_backups).
 *    Antes la fila guardaba solo metadatos y la restauración era imposible.
 *  - BACKUP-002: validación estricta de JSON importado ANTES de borrar datos.
 *  - BACKUP-003/004: applyBackupToStorage anti-eco (no dispara queueCloudSync
 *    durante la restauración via storageService).
 *  - Round-trip de archivo: export payload → clear → import → datos intactos.
 *  - Compatibilidad legacy (backups pre-2.0).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { _lfStore, _pushCloudSyncSpy } = vi.hoisted(() => ({
    _lfStore: new Map(),
    _pushCloudSyncSpy: vi.fn().mockResolvedValue(undefined),
}));

// Mock de localforage (in-memory), mismo patrón que hooks.test.js
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

// Mock de useCloudSync (evita supabase/authStore reales)
vi.mock('../src/hooks/useCloudSync', () => ({
    pushCloudSync: _pushCloudSyncSpy,
    queueCloudSync: _pushCloudSyncSpy,
    useCloudSync: vi.fn(),
}));

import { storageService } from '../src/utils/storageService';
import {
    collectLocalBackupPayload,
    validateBackupJson,
    decompressCloudBackup,
    applyBackupToStorage,
    clearAppKeysForRestore,
    countBackupRecords,
    CRITICAL_SYNC_KEYS,
} from '../src/utils/backupRestoreService';
import { _resetSyncFlag, isSyncingFromCloud } from '../src/utils/syncFlags';

beforeEach(async () => {
    _lfStore.clear();
    _pushCloudSyncSpy.mockClear();
    localStorage.clear();
    _resetSyncFlag();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function seedDevice() {
    const products = [
        { id: 'p1', name: 'Queso Blanco', stock: 55.5, unit: 'kg', packagingType: 'granel' },
        { id: 'p2', name: 'Refresco', stock: 10, unit: 'unidad' },
    ];
    const sales = [{ id: 's1', total: 100, items: [{ productId: 'p1', qty: 0.35 }] }];
    await storageService.setItem('bodega_products_v1', products);
    await storageService.setItem('bodega_sales_v1', sales);
    localStorage.setItem('business_name', 'Bodega Doña María');
    localStorage.setItem('street_rate_bs', '40.5');
    return { products, sales };
}

// ─── COLECCIÓN ──────────────────────────────────────────────────────────────

describe('collectLocalBackupPayload', () => {
    it('recolecta IndexedDB + localStorage con formato v2.0', async () => {
        await seedDevice();
        const backup = await collectLocalBackupPayload();

        expect(backup.version).toBe('2.0');
        expect(backup.data.idb.bodega_products_v1).toHaveLength(2);
        expect(backup.data.idb.bodega_sales_v1).toHaveLength(1);
        expect(backup.data.ls.business_name).toBe('Bodega Doña María');
        expect(backup.data.ls.street_rate_bs).toBe('40.5');
    });

    it('omite claves vacías', async () => {
        const backup = await collectLocalBackupPayload();
        expect(backup.data.idb.bodega_products_v1).toBeUndefined();
        expect(countBackupRecords(backup)).toBe(0);
    });
});

// ─── VALIDACIÓN (BACKUP-002) ────────────────────────────────────────────────

describe('validateBackupJson', () => {
    it('acepta un backup v2.0 válido', () => {
        const ok = validateBackupJson({
            version: '2.0',
            data: { idb: { bodega_products_v1: [{ id: 'p1' }] }, ls: {} },
        });
        expect(ok).toBe(true);
    });

    it('rechaza JSON sin data', () => {
        expect(() => validateBackupJson({ version: '2.0' })).toThrow(/falta campo "data"/);
    });

    it('rechaza v2.0 sin data.idb (antes borraba el dispositivo sin restaurar)', () => {
        expect(() => validateBackupJson({ version: '2.0', data: { ls: {} } })).toThrow(/data\.idb/);
    });

    it('rechaza v2.0 completamente vacío', () => {
        expect(() => validateBackupJson({ version: '2.0', data: { idb: {}, ls: {} } })).toThrow(/vacio/i);
    });

    it('rechaza no-objetos y arrays', () => {
        expect(() => validateBackupJson(null)).toThrow();
        expect(() => validateBackupJson([1, 2])).toThrow();
        expect(() => validateBackupJson('backup')).toThrow();
    });

    it('acepta formato legado con claves conocidas', () => {
        const isV2 = validateBackupJson({
            data: { bodega_products_v1: [{ id: 'p1' }], business_name: 'Mi Bodega' },
        });
        expect(isV2).toBe(false);
    });
});

// ─── RESTAURACIÓN DESDE LA NUBE (BACKUP-001) ────────────────────────────────

describe('cloud backup round-trip', () => {
    it('payload comprimido se normaliza y restaura íntegro en el dispositivo', async () => {
        // 1. Dispositivo origen: seed + recolección
        await seedDevice();
        const localBackup = await collectLocalBackupPayload();

        // 2. Simular la fila `cloud_backups.backup_data` como la guarda ahora
        //    uploadLocalBackup (comprimida). Usamos compresión real si existe;
        //    en jsdom no hay CompressionStream, así que probamos ambas formas.
        let cloudRow;
        try {
            const { compressString, isCompressionSupported } = await import('../src/utils/compression');
            if (isCompressionSupported()) {
                cloudRow = {
                    compressed: true,
                    version: '2.0',
                    timestamp: localBackup.timestamp,
                    data: await compressString(JSON.stringify(localBackup)),
                };
            } else {
                cloudRow = { ...localBackup };
            }
        } catch {
            cloudRow = { ...localBackup };
        }

        // 3. Dispositivo destino: vacío
        _lfStore.clear();
        localStorage.clear();

        // 4. Descargar → normalizar → validar → aplicar (mismo pipeline que applyCloudBackup)
        const backup = await decompressCloudBackup(cloudRow);
        validateBackupJson(backup);
        await applyBackupToStorage(backup, { writeMode: 'storageService' });

        // 5. Verificar integridad bit a bit
        const restoredProducts = await storageService.getItem('bodega_products_v1', null);
        const restoredSales = await storageService.getItem('bodega_sales_v1', null);
        expect(restoredProducts).toHaveLength(2);
        expect(restoredProducts[0].stock).toBe(55.5);
        expect(restoredProducts[0].packagingType).toBe('granel');
        expect(restoredSales).toEqual([{ id: 's1', total: 100, items: [{ productId: 'p1', qty: 0.35 }] }]);
        expect(localStorage.getItem('business_name')).toBe('Bodega Doña María');
        expect(localStorage.getItem('street_rate_bs')).toBe('40.5');
    });

    it('fila legacy de solo-metadatos NO cuenta como datos en la nube', async () => {
        const metadataOnlyRow = { drive_url: 'https://drive.example/x', size_bytes: 1234, updated_at: '...' };
        expect(countBackupRecords(metadataOnlyRow)).toBe(0);
        // Y decompressCloudBackup no debe lanzar por ella (tolerante), pero
        // validateBackupJson sí debe rechazarla (sin datos).
        const normalized = await decompressCloudBackup(metadataOnlyRow);
        expect(() => validateBackupJson(normalized)).toThrow();
    });
});

// ─── ROUND-TRIP DE ARCHIVO (export → clear → import) ────────────────────────

describe('file backup round-trip', () => {
    it('export → clearAppKeysForRestore → apply mantiene los datos intactos', async () => {
        // 1. Export
        await seedDevice();
        const exported = await collectLocalBackupPayload();
        const exportedJson = JSON.parse(JSON.stringify(exported));

        // 2. Simular cambio local posterior (datos que deben ser reemplazados)
        await storageService.setItem('bodega_products_v1', [{ id: 'otro', name: 'Nuevo', stock: 1 }]);
        localStorage.setItem('business_name', 'Otro Negocio');

        // 3. Import: limpiar y aplicar (writeMode 'direct', como handleFileChange)
        validateBackupJson(exportedJson);
        await clearAppKeysForRestore();
        await applyBackupToStorage(exportedJson, { writeMode: 'direct' });

        // 4. Verificar
        const products = await storageService.getItem('bodega_products_v1', null);
        expect(products).toHaveLength(2);
        expect(products.map(p => p.id).sort()).toEqual(['p1', 'p2']);
        expect(localStorage.getItem('business_name')).toBe('Bodega Doña María');
    });

    it('clearAppKeysForRestore preserva PROTECTED_KEYS', async () => {
        await seedDevice();
        _lfStore.set('bodega_autobackup_v1', { timestamp: 'x', data: { idb: {} } });
        _lfStore.set('pda_demo_flag_v1', true);
        _lfStore.set('priceCop_migration_v1', 'done');

        const { removedIdb } = await clearAppKeysForRestore();

        expect(removedIdb).not.toContain('bodega_autobackup_v1');
        expect(removedIdb).not.toContain('pda_demo_flag_v1');
        expect(removedIdb).not.toContain('priceCop_migration_v1');
        expect(_lfStore.get('bodega_autobackup_v1')).toEqual({ timestamp: 'x', data: { idb: {} } });
        expect(_lfStore.get('pda_demo_flag_v1')).toBe(true);
    });
});

// ─── ANTI-ECO (BACKUP-004) ──────────────────────────────────────────────────

describe('anti-eco durante restauración', () => {
    it('applyBackupToStorage no dispara queueCloudSync (modo storageService)', async () => {
        const backup = {
            version: '2.0',
            data: {
                idb: { bodega_products_v1: [{ id: 'p1' }], bodega_sales_v1: [] },
                ls: {},
            },
        };
        await applyBackupToStorage(backup, { writeMode: 'storageService' });
        // Los writes se envuelven en runWithoutEco → el interceptor de
        // storageService (queueCloudSync) debe ser ignorado.
        expect(_pushCloudSyncSpy).not.toHaveBeenCalled();
        expect(isSyncingFromCloud()).toBe(false); // flag restaurado tras aplicar
        expect(await storageService.getItem('bodega_products_v1', null)).toEqual([{ id: 'p1' }]);
    });

    it('CRITICAL_SYNC_KEYS coincide con las claves que re-sincroniza useCloudSync', () => {
        // Contrato entre backupRestoreService y el flag pda_backup_imported_flag
        expect(CRITICAL_SYNC_KEYS).toContain('bodega_products_v1');
        expect(CRITICAL_SYNC_KEYS).toContain('bodega_sales_v1');
        expect(CRITICAL_SYNC_KEYS).toHaveLength(5);
    });
});

// ─── COMPATIBILIDAD LEGADO ──────────────────────────────────────────────────

describe('formato legado (pre-2.0)', () => {
    it('restaura claves legacy IDB y LS', async () => {
        const legacy = {
            version: '1.0',
            data: {
                bodega_products_v1: JSON.stringify([{ id: 'old1', name: 'Harina' }]),
                business_name: 'Bodega Vieja',
                street_rate_bs: '36',
            },
        };
        validateBackupJson(legacy);
        await applyBackupToStorage(legacy, { writeMode: 'direct' });

        const products = await storageService.getItem('bodega_products_v1', null);
        expect(products).toEqual([{ id: 'old1', name: 'Harina' }]);
        expect(localStorage.getItem('business_name')).toBe('Bodega Vieja');
        expect(localStorage.getItem('street_rate_bs')).toBe('36');
    });
});
