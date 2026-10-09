import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

let server, origin;
test.beforeAll(async () => {
    const root = resolve('dist');
    await readFile(resolve(root, 'sw.js')); // incomplete builds must fail, not skip
    server = createServer(async (request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
        try {
            const bytes = await readFile(file);
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
            response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(bytes);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

test('built PWA activates, caches assets and reloads offline without production services', async ({ page, context }) => {
    test.setTimeout(90_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
        await route.continue();
    });
    await page.goto(origin);
    await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        return registration.active?.state;
    });
    await expect(page.getByRole('heading', { name: 'Activa tu licencia' })).toBeVisible({ timeout: 30_000 });
    const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        const name = names.find(name => name.includes('precache'));
        const cache = await caches.open(name);
        return (await cache.keys()).map(request => new URL(request.url).pathname);
    });
    expect(cached).toContain('/index.html');
    expect(cached.filter(path => path.endsWith('.js')).length).toBeGreaterThan(25);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Activa tu licencia' })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(errors).toEqual([]);
});
