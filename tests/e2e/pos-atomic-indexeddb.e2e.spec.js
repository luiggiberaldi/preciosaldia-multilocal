import { test, expect } from '@playwright/test';

const SALES = 'bodega_sales_v1';
const PRODUCTS = 'bodega_products_v1';
const CUSTOMERS = 'bodega_customers_v1';
const LEDGER = 'bodega_customer_ledger_v1';
const KEYS = [SALES, PRODUCTS, CUSTOMERS, LEDGER];

async function bootHarness(page) {
  await page.addInitScript(() => localStorage.clear());
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/__pos_atomic_indexeddb__') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>POS IndexedDB integration test</title><script type="module">
          import localforage from '/node_modules/.vite/deps/localforage.js';
          import { storageService } from '/src/utils/storageService.js';
          import { processSaleTransaction } from '/src/utils/checkoutProcessor.js';
          import { processVoidSale } from '/src/utils/voidSaleProcessor.js';
          await localforage.ready();
          const db = localforage._dbInfo.db;
          const objectStoreName = localforage.config('storeName');
          const routeKey = key => 'nb_neg-1:' + key;
          const seedItem = (key, value) => new Promise((resolve, reject) => {
            const tx = db.transaction(objectStoreName, 'readwrite');
            tx.objectStore(objectStoreName).put(value, routeKey(key));
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          await seedItem('bodega_sales_v1', []);
          await seedItem('bodega_products_v1', [{ id: 'p1', name: 'Producto', stock: 5, costUsd: 4 }]);
          await seedItem('bodega_customers_v1', [{ id: 'c1', name: 'Cliente', deuda: 0, favor: 0 }]);
          await seedItem('bodega_customer_ledger_v1', []);
          window.__posHarness = { localforage, storageService, processSaleTransaction, processVoidSale };
          window.__posHarnessReady = true;
        </script><script>window.addEventListener('error', event => { window.__posHarnessError = event.message + ':' + (event.error && event.error.stack || ''); });</script>`,
      });
    }
    return route.continue();
  });
  await page.goto('/__pos_atomic_indexeddb__');
  await page.waitForFunction(() => window.__posHarnessReady === true || window.__posHarnessError, null, { timeout: 15000 });
  const status = await page.evaluate(() => ({ ready: window.__posHarnessReady, error: window.__posHarnessError }));
  if (!status.ready) throw new Error(`Browser harness failed to load: ${JSON.stringify(status)}`);
  return undefined;
}

function checkoutOptions(intentId) {
  const customer = { id: 'c1', name: 'Cliente', deuda: 0, favor: 0 };
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

async function readProjections(page) {
  return page.evaluate(async keys => {
    const { storageService } = window.__posHarness;
    return Object.fromEntries(await Promise.all(keys.map(async key => [key, await storageService.getItem(key, [])])));
  }, KEYS);
}

async function processSale(page, intentId) {
  return page.evaluate(options => {
    return window.__posHarness.processSaleTransaction(options);
  }, checkoutOptions(intentId));
}

test('production POS checkout and void persist atomically in browser IndexedDB and replay once', async ({ page }) => {
  await bootHarness(page);
  const sale = await processSale(page, 'browser-intent-1');
  expect(sale.success).toBe(true);
  expect(sale.sale.id).toBe('browser-intent-1');
  let state = await readProjections(page);
  expect(state[SALES]).toHaveLength(1);
  expect(state[PRODUCTS][0].stock).toBe(4);
  expect(state[CUSTOMERS][0].deuda).toBe(10);
  expect(state[LEDGER].filter(entry => entry.sourceSaleId === sale.sale.id)).toHaveLength(1);

  expect(await processSale(page, 'browser-intent-1')).toMatchObject({ success: true, replayed: true });
  state = await readProjections(page);
  expect(state[SALES]).toHaveLength(1);
  expect(state[PRODUCTS][0].stock).toBe(4);
  expect(state[LEDGER].filter(entry => entry.sourceSaleId === sale.sale.id)).toHaveLength(1);

  const voidResult = await page.evaluate(async saleRecord => {
    const { processVoidSale, storageService } = window.__posHarness;
    return processVoidSale(saleRecord, await storageService.getItem('bodega_sales_v1', []),
      await storageService.getItem('bodega_products_v1', []));
  }, sale.sale);
  expect(voidResult.replayed).toBeUndefined();
  state = await readProjections(page);
  expect(state[SALES][0].status).toBe('ANULADA');
  expect(state[PRODUCTS][0].stock).toBe(5);
  expect(state[CUSTOMERS][0]).toMatchObject({ deuda: 0, favor: 0 });
  expect(state[LEDGER].filter(entry => entry.type === 'ANULACION')).toHaveLength(1);

  const replayedVoid = await page.evaluate(async saleRecord => {
    const { processVoidSale } = window.__posHarness;
    return processVoidSale(saleRecord, [], []);
  }, sale.sale);
  expect(replayedVoid.replayed).toBe(true);
  state = await readProjections(page);
  expect(state[PRODUCTS][0].stock).toBe(5);
  expect(state[LEDGER].filter(entry => entry.type === 'ANULACION')).toHaveLength(1);
});

test('real IndexedDB abort leaves every checkout projection intact and the same intent can retry', async ({ page }) => {
  await bootHarness(page);
  const before = await readProjections(page);
  const failed = await page.evaluate(async options => {
    const { localforage, processSaleTransaction } = window.__posHarness;
    const databasePrototype = Object.getPrototypeOf(localforage._dbInfo.db);
    const originalTransaction = databasePrototype.transaction;
    let injected = false;
    databasePrototype.transaction = function (...transactionArgs) {
      const tx = Reflect.apply(originalTransaction, this, transactionArgs);
      if (transactionArgs[1] !== 'readwrite') return tx;
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = storeName => {
        const store = objectStore(storeName);
        const originalPut = store.put.bind(store);
        store.put = (...putArgs) => {
          const request = originalPut(...putArgs);
          if (!injected && (putArgs[1] === 'nb_neg-1:bodega_customers_v1' || putArgs[0]?.[0]?.id === 'c1')) {
            injected = true;
            request.addEventListener('success', () => tx.abort());
          }
          return request;
        };
        return store;
      };
      return tx;
    };
    try {
      await processSaleTransaction(options);
      return { injected, rejected: false };
    } catch (error) {
      return { injected, rejected: true, error: String(error) };
    } finally {
      databasePrototype.transaction = originalTransaction;
    }
  }, checkoutOptions('browser-intent-retry'));
  expect(failed, JSON.stringify(failed)).toMatchObject({ injected: true, rejected: true });
  expect(await readProjections(page)).toEqual(before);

  expect((await processSale(page, 'browser-intent-retry')).success).toBe(true);
  const afterRetry = await readProjections(page);
  expect(afterRetry[SALES]).toHaveLength(1);
  expect(afterRetry[PRODUCTS][0].stock).toBe(4);
  expect(afterRetry[CUSTOMERS][0].deuda).toBe(10);
  expect(afterRetry[LEDGER]).toHaveLength(1);
});
