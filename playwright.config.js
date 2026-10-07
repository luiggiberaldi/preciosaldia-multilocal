import { defineConfig, devices } from '@playwright/test';

const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,
    reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: process.env.SUPERVISOR_E2E_BASE_URL || 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        ...devices['Desktop Chrome'],
        ...(vercelBypassSecret
            ? {
                  extraHTTPHeaders: {
                      'x-vercel-protection-bypass': vercelBypassSecret,
                      'x-vercel-set-bypass-cookie': 'true',
                  },
              }
            : {}),
    },
    webServer: {
        command: 'bun run dev -- --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
