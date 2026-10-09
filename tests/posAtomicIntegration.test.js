import { beforeEach, describe, expect, it, vi } from 'vitest';

const { records, failCommit, commits, storageMock } = vi.hoisted(() => ({
  records: new Map(),
  failCommit: { current: false },
  commits: [],
  storageMock: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    readAtomicSnapshot: vi.fn(),
    commitAtomicSnapshot: vi.fn(),
  },
}));

vi.mock('../src/utils/storageService', () => ({ storageService: storageMock }));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn() }));
vi.mock('../src/hooks/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ usuarioActivo: { id: 'tester', nombre: 'Tester' } }) },
}));

import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { CUSTOMER_LEDGER_KEY } from '../src/utils/customerLedger';

const SALES_KEY = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';
const KEYS = [SALES_KEY, PRODUCTS_KEY, CUSTOMERS_KEY, CUSTOMER_LEDGER_KEY];

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

storageMock.getItem.mockImplementation(async (key, fallback = null) =>
  records.has(key) ? copy(records.get(key)) : fallback,
);
storageMock.setItem.mockImplementation(async (key, value) => records.set(key, copy(value)));
storageMock.readAtomicSnapshot.mockImplementation(async (keys, { defaults = {} } = {}) => {
  const values = Object.fromEntries(keys.map(key => [key, copy(records.has(key) ? records.get(key) : defaults[key])]));
  return { values, baseline: copy(values) };
});
storageMock.commitAtomicSnapshot.mockImplementation(async ({ snapshot, writes }) => {
  if (failCommit.current) throw new Error('simulated atomic commit failure');
  for (const key of Object.keys(writes)) {
    if (JSON.stringify(records.has(key) ? records.get(key) : snapshot.values[key]) !== JSON.stringify(snapshot.baseline[key])) {
      throw Object.assign(new Error('snapshot conflict'), { code: 'ATOMIC_SNAPSHOT_CONFLICT' });
    }
  }
  commits.push(copy(writes));
  for (const [key, value] of Object.entries(writes)) records.set(key, copy(value));
  return { committed: true };
});

function opts(intentId) {
  const customer = { id: 'c1', name: 'Ana', deuda: 0, favor: 0 };
  return {
    intentId,
    cart: [{ id: 'p1', name: 'Producto', qty: 1, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
    cartTotalUsd: 10,
    cartTotalBs: 400,
    cartSubtotalUsd: 10,
    payments: [],
    changeBreakdown: { esCredito: true },
    selectedCustomerId: customer.id,
    customers: [customer],
    products: [{ id: 'p1', name: 'Producto', stock: 5, costUsd: 4 }],
    effectiveRate: 40,
    tasaCop: 0,
    copEnabled: false,
    discountData: null,
    useAutoRate: false,
  };
}

beforeEach(() => {
  records.clear();
  commits.length = 0;
  failCommit.current = false;
  storageMock.getItem.mockClear();
  storageMock.setItem.mockClear();
  records.set(SALES_KEY, []);
  records.set(PRODUCTS_KEY, [{ id: 'p1', name: 'Producto', stock: 5, costUsd: 4 }]);
  records.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }]);
  records.set(CUSTOMER_LEDGER_KEY, []);
});

describe('atomic POS integration', () => {
  it('commits sale, stock, customer and ledger together and replays the same intent once', async () => {
    const first = await processSaleTransaction(opts('checkout-intent-1'));
    expect(first.success).toBe(true);
    expect(first.sale.id).toBe('checkout-intent-1');
    expect(records.get(SALES_KEY)).toHaveLength(1);
    expect(records.get(PRODUCTS_KEY)[0].stock).toBe(4);
    expect(records.get(CUSTOMERS_KEY)[0].deuda).toBe(10);
    expect(records.get(CUSTOMER_LEDGER_KEY).filter(entry => entry.sourceSaleId === first.sale.id)).toHaveLength(1);
    expect(commits[0]).toEqual(expect.objectContaining({
      [SALES_KEY]: expect.any(Array),
      [PRODUCTS_KEY]: expect.any(Array),
      [CUSTOMERS_KEY]: expect.any(Array),
      [CUSTOMER_LEDGER_KEY]: expect.any(Array),
    }));

    const replay = await processSaleTransaction(opts('checkout-intent-1'));
    expect(replay).toMatchObject({ success: true, replayed: true, sale: { id: first.sale.id } });
    expect(commits).toHaveLength(1);
    expect(records.get(PRODUCTS_KEY)[0].stock).toBe(4);
    expect(records.get(CUSTOMER_LEDGER_KEY).filter(entry => entry.sourceSaleId === first.sale.id)).toHaveLength(1);
  });

  it('leaves every projection unchanged when the atomic sale commit fails', async () => {
    const before = Object.fromEntries(KEYS.map(key => [key, copy(records.get(key))]));
    failCommit.current = true;

    await expect(processSaleTransaction(opts('checkout-intent-fail')))
      .rejects.toThrow('simulated atomic commit failure');
    for (const key of KEYS) expect(records.get(key)).toEqual(before[key]);
    expect(commits).toHaveLength(0);
  });

  it('voids sale projections atomically and makes repeated void requests harmless', async () => {
    const sold = await processSaleTransaction(opts('checkout-intent-void'));
    expect(sold.success).toBe(true);
    const commitCountAfterSale = commits.length;

    const voided = await processVoidSale(sold.sale, records.get(SALES_KEY), records.get(PRODUCTS_KEY));
    expect(records.get(SALES_KEY)[0].status).toBe('ANULADA');
    expect(records.get(PRODUCTS_KEY)[0].stock).toBe(5);
    expect(records.get(CUSTOMERS_KEY)[0]).toMatchObject({ deuda: 0, favor: 0 });
    expect(records.get(CUSTOMER_LEDGER_KEY).filter(entry => entry.type === 'ANULACION')).toHaveLength(1);
    expect(commits).toHaveLength(commitCountAfterSale + 1);

    const repeated = await processVoidSale(sold.sale, voided.updatedSales, voided.updatedProducts);
    expect(repeated.replayed).toBe(true);
    expect(commits).toHaveLength(commitCountAfterSale + 1);
    expect(records.get(PRODUCTS_KEY)[0].stock).toBe(5);
    expect(records.get(CUSTOMER_LEDGER_KEY).filter(entry => entry.type === 'ANULACION')).toHaveLength(1);
  });
});
