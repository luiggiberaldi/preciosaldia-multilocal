/**
 * audit-checkout-visual.mjs — Auditoría visual/DOM del checkout móvil (360/390/430).
 *
 * Revisa en vivo, sobre la app real sembrada (mismo estado que los e2e):
 *  - Overflow horizontal y elementos cortados por el borde derecho.
 *  - Texto recortado (scrollWidth > clientWidth sin ellipsis).
 *  - Contraste WCAG AA de todo el texto visible (mezclando alpha con el fondo).
 *  - Targets táctiles < 44×44 px (incluyendo pseudo-elementos ::before/::after).
 *  - Visibilidad del CTA del footer (¿queda fuera del viewport?) y densidad
 *    de controles interactivos en el tercio inferior (colapso).
 *  - Inputs sin etiqueta accesible.
 *
 * Uso: node scripts/audit-checkout-visual.mjs
 */
import { writeFileSync } from 'node:fs';
import { SEED_INDEXEDDB_SNIPPET, SEED_LOCALSTORAGE_SNIPPET, neutralizeExternalNetwork } from '../tests/e2e/helpers/seedBrowserState.js';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
const WIDTHS = [360, 390, 430];
const HEIGHT = 740;

// ── Auditoría que corre DENTRO del navegador ─────────────────────────────
async function auditPage(page) {
    return page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const report = { vw, vh, overflowX: [], clipped: [], contrast: [], tapTargets: [], unlabeledInputs: [], interactiveLower: [], cta: null, horizontalScrollers: [] };

        const parseRgb = (s) => {
            const m = s.match(/rgba?\(([^)]+)\)/);
            if (!m) return null;
            const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
            if (m[0].includes('rgba') || s.includes('/')) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
            return { r: p[0], g: p[1], b: p[2], a: 1 };
        };
        const blend = (fg, bg) => ({
            r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
            g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
            b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
        });
        const lum = ({ r, g, b }) => {
            const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (a, b) => {
            const l1 = lum(a), l2 = lum(b);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const effBg = (el) => {
            let node = el;
            while (node && node !== document.documentElement) {
                const c = parseRgb(getComputedStyle(node).backgroundColor);
                if (c && c.a > 0.05) return node === el && c.a < 1 ? blend(c, { r: 255, g: 255, b: 255 }) : (c.a < 1 ? blend(c, { r: 255, g: 255, b: 255 }) : c);
                node = node.parentElement;
            }
            return { r: 255, g: 255, b: 255 };
        };

        const all = [...document.querySelectorAll('body *')];
        for (const el of all) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) continue;

            // 1) Overflow horizontal real.
            if (rect.right > vw + 1 || rect.left < -1) {
                // Excepción: hijos de un scroller horizontal designado (aria-label).
                // Asomarse dentro de un carrusel con scroll intencional es el affordance esperado.
                let anc = el.parentElement, inScroller = false;
                while (anc && anc !== document.body) {
                    const acs = getComputedStyle(anc);
                    if (['auto', 'scroll'].includes(acs.overflowX) && anc.getAttribute('aria-label')) { inScroller = true; break; }
                    anc = anc.parentElement;
                }
                if (!inScroller) report.overflowX.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), left: Math.round(rect.left), right: Math.round(rect.right) });
            }
            // 2) Texto recortado sin ellipsis.
            if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible') {
                if (cs.textOverflow !== 'ellipsis' && !el.hasAttribute('title')) {
                    report.clipped.push({ text: el.textContent.trim().slice(0, 40), clientW: el.clientWidth, scrollW: el.scrollWidth });
                }
            }
            // 3) Contaste de texto propio.
            const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (own && cs.color) {
                const fg = parseRgb(cs.color);
                if (fg) {
                    const blended = fg.a < 1 ? blend(fg, effBg(el)) : fg;
                    const r = ratio(blended, effBg(el));
                    const px = parseFloatSafe(cs.fontSize);
                    const bold = Number(cs.fontWeight) >= 700;
                    const large = px >= 24 || (px >= 18.66 && bold);
                    const min = large ? 3 : 4.5;
                    if (r < min) report.contrast.push({ text: el.textContent.trim().slice(0, 40), ratio: +r.toFixed(2), min, px, cls: String(el.className).slice(0, 50) });
                }
            }
            // 4) Targets táctiles.
            if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && cs.pointerEvents !== 'none')) {
                let w = rect.width, h = rect.height;
                for (const pseudo of ['::before', '::after']) {
                    const p = getComputedStyle(el, pseudo);
                    if (p.position === 'absolute' && p.width !== 'auto') {
                        const pw = parseFloatSafe(p.width), ph = parseFloatSafe(p.height);
                        if (pw > 0 && ph > 0) { w = Math.max(w, pw); h = Math.max(h, ph); }
                    }
                }
                const name = el.tagName === 'INPUT' ? (el.getAttribute('aria-label') || el.placeholder || '') : (el.getAttribute('aria-label') || el.textContent.trim() || el.getAttribute('title') || '');
                report.tapTargets.push({ name: String(name).slice(0, 30), w: Math.round(w), h: Math.round(h), bottom: Math.round(rect.bottom), small: w < 44 || h < 44 });
                if (el.tagName === 'INPUT' && !el.getAttribute('aria-label') && !el.labels?.length && !el.placeholder) report.unlabeledInputs.push({ type: el.type });
            }
            // 5) Scrollers horizontales.
            if (el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(cs.overflowX)) {
                report.horizontalScrollers.push({ tag: el.tagName, cls: String(el.className).slice(0, 50), clientW: el.clientWidth, scrollW: el.scrollWidth });
            }
        }

        // 6) CTA del footer y densidad inferior.
        const ctaEl = [...document.querySelectorAll('button')].find((b) => {
            if (b.offsetParent === null) return false;
            const t = (b.getAttribute('aria-label') || b.textContent).toUpperCase();
            return /CONFIRMAR VENTA|INGRESA LOS PAGOS|FIAR RESTANTE|ASIGNA EL VUELTO|ERROR DE TASA/.test(t);
        });
        if (ctaEl) {
            const r = ctaEl.getBoundingClientRect();
            report.cta = { text: ctaEl.textContent.trim().slice(0, 40), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), visibleInViewport: r.bottom <= vh + 1 && r.top >= 0, w: Math.round(r.width) };
        }
        const lowerEdge = vh * 0.6;
        report.interactiveLower = report.tapTargets.filter((t) => t.bottom > lowerEdge).length;
        report.tapTargets = report.tapTargets.filter((t) => t.small);

        function parseFloatSafe(v) { const n = Number.parseFloat(v); return Number.isNaN(n) ? 0 : n; }
        return report;
    });
}

// ── Flujo reutilizado del spec e2e ───────────────────────────────────────
async function reachCheckout(page) {
    await page.goto(BASE + '/');
    await page.getByRole('button', { name: 'Vender' }).click();
    await page.getByRole('heading', { name: 'Caja Cerrada' }).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => { });
    const search = page.getByPlaceholder('Buscar producto...');
    await search.fill('Caraota E2E');
    await search.press('Enter');
    await page.getByText('Ver Cesta', { exact: true }).click();
    await page.getByRole('button', { name: /COBRAR/ }).click();
    await page.getByRole('heading', { name: 'COBRAR' }).waitFor({ timeout: 10_000 });
}
const usdInput = (page) => page.locator('div.sm\\:hidden input[type="text"][inputmode="decimal"][placeholder="0.00"]').first();

// ── Main ─────────────────────────────────────────────────────────────────
const results = [];
const browser = await chromium.launch();
try {
    for (const width of WIDTHS) {
        const context = await browser.newContext({
            viewport: { width, height: HEIGHT }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
        });
        const page = await context.newPage();
        await neutralizeExternalNetwork(page);
        await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
        await page.addInitScript(SEED_INDEXEDDB_SNIPPET);

        await reachCheckout(page);
        const pendiente = await auditPage(page);
        results.push({ width, state: 'pendiente', ...pendiente });

        await usdInput(page).fill('10.00');
        await page.getByText('Vuelto:', { exact: false }).waitFor({ timeout: 5_000 });
        const vuelto = await auditPage(page);
        results.push({ width, state: 'vuelto', ...vuelto });

        await context.close();
    }
} finally {
    await browser.close();
}

writeFileSync('test-results/audit-checkout-visual.json', JSON.stringify(results, null, 2));

// ── Resumen legible ──────────────────────────────────────────────────────
for (const r of results) {
    console.log(`\n━━━ ${r.width}px — ${r.state.toUpperCase()} (viewport ${r.vw}×${r.vh})`);
    console.log(`  overflow-X: ${r.overflowX.length} | texto recortado: ${r.clipped.length} | scrollers: ${r.horizontalScrollers.length}`);
    console.log(`  contraste AA insuficiente: ${r.contrast.length} | targets <44px: ${r.tapTargets.length} | inputs sin etiqueta: ${r.unlabeledInputs.length}`);
    if (r.cta) console.log(`  CTA "${r.cta.text}" h=${r.cta.h}px bottom=${r.cta.bottom}/${r.vh} visible=${r.cta.visibleInViewport} w=${r.cta.w}`);
    console.log(`  controles interactivos en tercio inferior: ${r.interactiveLower}`);
    if (r.overflowX.length) console.log('  ⚠ overflowX:', JSON.stringify(r.overflowX.slice(0, 5)));
    if (r.clipped.length) console.log('  ⚠ clipped:', JSON.stringify(r.clipped.slice(0, 6)));
    if (r.contrast.length) console.log('  ⚠ contraste:', JSON.stringify(r.contrast.slice(0, 8)));
    if (r.tapTargets.length) console.log('  ⚠ targets pequeños:', JSON.stringify(r.tapTargets.slice(0, 10)));
    if (r.unlabeledInputs.length) console.log('  ⚠ inputs sin etiqueta:', JSON.stringify(r.unlabeledInputs));
    if (r.horizontalScrollers.length) console.log('  ⓘ scrollers-x:', JSON.stringify(r.horizontalScrollers.slice(0, 4)));
}
console.log('\nJSON completo: test-results/audit-checkout-visual.json');
