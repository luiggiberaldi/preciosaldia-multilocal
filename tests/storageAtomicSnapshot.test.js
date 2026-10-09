import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, failGetKey, failPutKey, queueCloudSync, localforageMock } = vi.hoisted(() => ({
  store: new Map(),
  failGetKey: { current: null },
  failPutKey: { current: null },
  queueCloudSync: vi.fn(),
  localforageMock: {
    config: vi.fn(),
    ready: vi.fn().mockResolvedValue(undefined),
    driver: vi.fn(() => 'asyncStorage'),
    _dbInfo: { db: null, storeName: 'bodega_app_data' },
  },
}));

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createDatabase() {
  return {
    objectStoreNames: { contains: name => name === 'bodega_app_data' },
    transaction(_storeName, mode) {
      let pending = 0;
      let aborted = false;
      let completed = false;
      let cause;
      const pendingWrites = new Map();
      const tx = {
        error: null,
        objectStore() {
          return {
            get(key) {
              const request = { result: undefined, error: null };
              schedule(request, () => {
                if (failGetKey.current === key) throw new Error('simulated read failure');
                request.result = clone(store.get(key));
              });
              return request;
            },
            put(value, key) {
              const request = { error: null };
              schedule(request, () => {
                if (failPutKey.current === key) throw new Error('simulated write failure');
                pendingWrites.set(key, clone(value));
              });
              return request;
            },
          };
        },
        abort() {
          if (aborted || completed) return;
          aborted = true;
          tx.error = cause;
          queueMicrotask(() => tx.onabort?.());
        },
      };
      function schedule(request, action) {
        pending++;
        queueMicrotask(() => {
          if (aborted) return;
          try {
            action();
            request.onsuccess?.();
          } catch (error) {
            request.error = error;
            cause ||= error;
            tx.error = error;
            request.onerror?.();
            tx.onerror?.({ target: { error } });
          } finally {
            pending--;
            finishIfReady();
          }
        });
      }
      function finishIfReady() {
        if (pending !== 0 || aborted || completed) return;
        completed = true;
        if (mode === 'readwrite') {
          for (const [key, value] of pendingWrites) store.set(key, value);
        }
        queueMicrotask(() => tx.oncomplete?.());
      }
      return tx;
    },
  };
}

const serializer = {
  serialize(value, callback) {
    try { callback(structuredClone(value)); } catch (error) { callback(null, error); }
  },
  deserialize(value) { return structuredClone(value); },
};
function seed(key, value) { store.set(key, structuredClone(value)); }
function decodeRawValue(value) { return value; }
const database = createDatabase();
localforageMock._dbInfo = { db: database, storeName: 'bodega_app_data', serializer };

vi.mock('localforage', () => ({ default: localforageMock, ...localforageMock }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync }));
vi.mock('../src/utils/shadowBackupService', () => ({ shadowBackupService: { saveShadow: vi.fn() } }));
vi.mock('../src/utils/syncFlags', () => ({ isSyncingFromCloud: () => false }));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn() }));
vi.mock('../src/hooks/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ usuarioActivo: { id: 'atomic-test-user', nombre: 'Tester' } }) },
}));

import { storageService } from '../src/utils/storageService';
import { setNegocioActivoId } from '../src/utils/negocioContext';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { CUSTOMER_LEDGER_KEY } from '../src/utils/customerLedger';

beforeEach(() => {
  store.clear();
  failGetKey.current = null;
  failPutKey.current = null;
  queueCloudSync.mockClear();
  localStorage.clear();
  setNegocioActivoId('atomic-test');
});

function atomicSaleOptions(intentId) {
  const customer = { id: 'customer-atomic', name: 'Cliente', deuda: 0, favor: 0 };
  return {
    intentId,
    cart: [{ id: 'product-atomic', name: 'Producto', qty: 1, priceUsd: 10, costUsd: 4, isWeight: false }],
    cartTotalUsd: 10,
    cartTotalBs: 400,
    cartSubtotalUsd: 10,
    payments: [],
    changeBreakdown: { esCredito: true },
    selectedCustomerId: customer.id,
    customers: [customer],
    products: [{ id: 'product-atomic', name: 'Producto', stock: 5, costUsd: 4 }],
    effectiveRate: 40,
    tasaCop: 0,
    copEnabled: false,
    discountData: null,
    useAutoRate: false,
  };
}

describe('storageService atomic snapshots', () => {
  it('reads a namespaced coherent set and atomically commits its projections', async () => {
    seed('nb_atomic-test:bodega_sales_v1', [{ id: 'sale-old' }]);
    seed('nb_atomic-test:bodega_customers_v1', [{ id: 'customer-old', balance: 0 }]);

    const snapshot = await storageService.readAtomicSnapshot(
      ['bodega_sales_v1', 'bodega_customers_v1'],
      { defaults: { bodega_sales_v1: [], bodega_customers_v1: [] } },
    );
    expect(Object.fromEntries(Object.entries(snapshot.values).map(([key, value]) => [key, decodeRawValue(value)]))).toEqual({
      bodega_sales_v1: [{ id: 'sale-old' }],
      bodega_customers_v1: [{ id: 'customer-old', balance: 0 }],
    });

    const writes = {
      bodega_sales_v1: [{ id: 'sale-new' }],
      bodega_customers_v1: [{ id: 'customer-new', balance: 12 }],
    };
    await expect(storageService.commitAtomicSnapshot({ snapshot, writes }))
      .resolves.toMatchObject({ committed: true });
    expect(decodeRawValue(store.get('nb_atomic-test:bodega_sales_v1'))).toEqual(writes.bodega_sales_v1);
    expect(decodeRawValue(store.get('nb_atomic-test:bodega_customers_v1'))).toEqual(writes.bodega_customers_v1);
    expect(queueCloudSync).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(snapshot.values.bodega_sales_v1)).toBe(true);
  });

  it('rejects when any included value changed after the snapshot', async () => {
    seed('nb_atomic-test:bodega_sales_v1', [{ id: 'before' }]);
    const snapshot = await storageService.readAtomicSnapshot(['bodega_sales_v1']);
    seed('nb_atomic-test:bodega_sales_v1', [{ id: 'concurrent' }]);

    await expect(storageService.commitAtomicSnapshot({
      snapshot,
      writes: { bodega_sales_v1: [{ id: 'mine' }] },
    })).rejects.toMatchObject({ code: 'ATOMIC_SNAPSHOT_CONFLICT' });
    expect(decodeRawValue(store.get('nb_atomic-test:bodega_sales_v1'))).toEqual([{ id: 'concurrent' }]);
  });

  it('rejects instead of treating pending legacy localStorage data as an empty snapshot', async () => {
    localStorage.setItem('nb_atomic-test:bodega_sales_v1', JSON.stringify([{ id: 'legacy' }]));

    await expect(storageService.readAtomicSnapshot(['bodega_sales_v1']))
      .rejects.toMatchObject({ code: 'ATOMIC_LEGACY_MIGRATION_REQUIRED' });
    expect(store.has('nb_atomic-test:bodega_sales_v1')).toBe(false);
    expect(localStorage.getItem('nb_atomic-test:bodega_sales_v1')).not.toBeNull();
  });

  it('rejects on a transaction read failure without writing any projection', async () => {
    seed('nb_atomic-test:bodega_sales_v1', [{ id: 'sale' }]);
    seed('nb_atomic-test:bodega_customers_v1', []);
    failGetKey.current = 'nb_atomic-test:bodega_customers_v1';
    const snapshotPromise = storageService.readAtomicSnapshot(['bodega_sales_v1', 'bodega_customers_v1']);

    await expect(snapshotPromise).rejects.toThrow('simulated read failure');
  });

  it('aborts every projection when an IndexedDB put fails', async () => {
    seed('nb_atomic-test:bodega_sales_v1', [{ id: 'sale-old' }]);
    seed('nb_atomic-test:bodega_customers_v1', []);
    const snapshot = await storageService.readAtomicSnapshot(['bodega_sales_v1', 'bodega_customers_v1']);
    failPutKey.current = 'nb_atomic-test:bodega_customers_v1';

    await expect(storageService.commitAtomicSnapshot({
      snapshot,
      writes: { bodega_sales_v1: [{ id: 'sale-new' }], bodega_customers_v1: [{ id: 'new' }] },
    })).rejects.toThrow('simulated write failure');
    expect(decodeRawValue(store.get('nb_atomic-test:bodega_sales_v1'))).toEqual([{ id: 'sale-old' }]);
    expect(decodeRawValue(store.get('nb_atomic-test:bodega_customers_v1'))).toEqual([]);
  });

  it('runs checkout, replay and void against the IndexedDB transaction-backed storage API', async () => {
    const logicalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', CUSTOMER_LEDGER_KEY];
    const physicalKeys = logicalKeys.map(key => `nb_atomic-test:${key}`);
    seed(physicalKeys[0], []);
    seed(physicalKeys[1], [{ id: 'product-atomic', name: 'Producto', stock: 5, costUsd: 4 }]);
    seed(physicalKeys[2], [{ id: 'customer-atomic', name: 'Cliente', deuda: 0, favor: 0 }]);
    seed(physicalKeys[3], []);

    const saleResult = await processSaleTransaction(atomicSaleOptions('atomic-intent-1'));
    expect(saleResult.success).toBe(true);
    expect(decodeRawValue(store.get(physicalKeys[0]))).toHaveLength(1);
    expect(decodeRawValue(store.get(physicalKeys[1]))[0].stock).toBe(4);
    expect(decodeRawValue(store.get(physicalKeys[2]))[0].deuda).toBe(10);
    expect(decodeRawValue(store.get(physicalKeys[3])).filter(m => m.sourceSaleId === saleResult.sale.id)).toHaveLength(1);

    const replay = await processSaleTransaction(atomicSaleOptions('atomic-intent-1'));
    expect(replay).toMatchObject({ success: true, replayed: true, sale: { id: saleResult.sale.id } });
    expect(decodeRawValue(store.get(physicalKeys[0]))).toHaveLength(1);
    expect(decodeRawValue(store.get(physicalKeys[1]))[0].stock).toBe(4);

    const voidResult = await processVoidSale(saleResult.sale, [saleResult.sale], decodeRawValue(store.get(physicalKeys[1])));
    expect(voidResult.replayed).toBeUndefined();
    expect(decodeRawValue(store.get(physicalKeys[0]))[0].status).toBe('ANULADA');
    expect(decodeRawValue(store.get(physicalKeys[1]))[0].stock).toBe(5);
    expect(decodeRawValue(store.get(physicalKeys[2]))[0]).toMatchObject({ deuda: 0, favor: 0 });
    expect(decodeRawValue(store.get(physicalKeys[3])).filter(m => m.type === 'ANULACION')).toHaveLength(1);

    const repeatedVoid = await processVoidSale(saleResult.sale, [saleResult.sale], decodeRawValue(store.get(physicalKeys[1])));
    expect(repeatedVoid.replayed).toBe(true);
    expect(decodeRawValue(store.get(physicalKeys[1]))[0].stock).toBe(5);
    expect(decodeRawValue(store.get(physicalKeys[3])).filter(m => m.type === 'ANULACION')).toHaveLength(1);
  });

  it('preserves all persisted POS keys if a sale projection put fails in IndexedDB', async () => {
    const logicalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', CUSTOMER_LEDGER_KEY];
    const physicalKeys = logicalKeys.map(key => `nb_atomic-test:${key}`);
    seed(physicalKeys[0], []);
    seed(physicalKeys[1], [{ id: 'product-atomic', name: 'Producto', stock: 5, costUsd: 4 }]);
    seed(physicalKeys[2], [{ id: 'customer-atomic', name: 'Cliente', deuda: 0, favor: 0 }]);
    seed(physicalKeys[3], []);
    const before = physicalKeys.map(key => store.get(key));
    failPutKey.current = physicalKeys[2];

    await expect(processSaleTransaction(atomicSaleOptions('atomic-intent-failure')))
      .rejects.toThrow('simulated write failure');
    expect(physicalKeys.map(key => store.get(key))).toEqual(before);
  });
});
