import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'flujos-aislados.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'evidencias/e2e-aislados-final.json' }]],
  outputDir: 'evidencias/e2e-aislados-final',
  use: { baseURL: 'http://127.0.0.1:4181', viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', video: 'retain-on-failure', serviceWorkers: 'block' },
});
