/**
 * auditHarness.js — Utilidades para la auditoría e2e de flujos.
 *
 * A diferencia de los specs de regresión (que afirman un comportamiento
 * concreto), este arnés está pensado para RECORRER todos los flujos de la app
 * y dejar evidencia:
 *   - errores de consola y excepciones no capturadas,
 *   - respuestas locales >= 400,
 *   - desbordes horizontales a 360 px (app mobile-first),
 *   - diálogos nativos aceptados por el test,
 * y un registro acumulado que se escribe en `test-results/auditoria-flujos.json`.
 *
 * El spec de auditoría usa `record()` para dejar el resultado de cada flujo y
 * `writeAuditReport()` al final.
 */

import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
    SEED_INDEXEDDB_SNIPPET,
    SEED_LOCALSTORAGE_SNIPPET,
    neutralizeExternalNetwork,
} from './seedBrowserState';

export const AUDIT_RATE = 40; // Bs por USD en todos los flujos auditados

// ── Registro de la auditoría ──────────────────────────────────────────────
const AUDIT_LOG = [];

/** Añade una fila al reporte de auditoría. status: 'ok' | 'finding' | 'fail'. */
export function record(flow, status, detail, evidence = null) {
    AUDIT_LOG.push({ flow, status, detail, evidence, at: new Date().toISOString() });
    const icon = status === 'ok' ? '✅' : status === 'finding' ? '⚠️ ' : '❌';
    console.log(`${icon} [${flow}] ${detail}${evidence ? `\n      ↳ ${JSON.stringify(evidence)}` : ''}`);
}

export function writeAuditReport() {
    const dir = path.resolve('test-results');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'auditoria-flujos.json');

    // Merge con corridas previas (la auditoría se puede ejecutar por flujos con
    // --grep) sin duplicar filas: clave única = flujo + detalle.
    let previas = [];
    try {
        previas = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(previas)) previas = [];
    } catch { previas = []; }

    const key = (row) => `${row.flow}::${row.detail}`;
    const vistos = new Set(previas.map(key));
    const nuevas = AUDIT_LOG.filter(row => !vistos.has(key(row)));
    const merged = [...previas, ...nuevas];

    fs.writeFileSync(file, JSON.stringify(merged, null, 2));
    console.log(`\n[e2e-audit] +${nuevas.length} filas (${merged.length} en total) → ${file}`);
}

// ── Colectores de evidencia ───────────────────────────────────────────────
/**
 * Engancha listeners de errores. Devuelve el objeto donde se acumulan.
 * No falla por sí solo: el spec decide qué es un hallazgo.
 */
export function attachCollectors(page) {
    const log = { consoleErrors: [], pageErrors: [], badResponses: [], jsDialogs: [] };

    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const loc = msg.location();
        const where = loc?.url ? ` @ ${loc.url.replace('http://127.0.0.1:4173', '')}:${loc.lineNumber}` : '';
        log.consoleErrors.push(`${msg.text().slice(0, 240)}${where}`);
    });
    page.on('pageerror', (err) => log.pageErrors.push(String(err?.message || err).slice(0, 300)));
    page.on('response', (res) => {
        const url = res.url();
        if (url.startsWith('http://127.0.0.1:4173') && res.status() >= 400) {
            log.badResponses.push(`${res.status()} ${url.replace('http://127.0.0.1:4173', '')}`);
        }
    });
    page.on('dialog', (dialog) => {
        log.jsDialogs.push(`${dialog.type()}: ${dialog.message().slice(0, 120)}`);
        dialog.accept();
    });

    return log;
}

/** Excepciones no capturadas: siempre son un fallo, no un hallazgo. */
export function expectNoPageErrors(log, flow) {
    if (log.pageErrors.length > 0) {
        record(flow, 'fail', `${log.pageErrors.length} excepción(es) no capturada(s)`, log.pageErrors);
    }
    expect(log.pageErrors, `excepciones no capturadas en ${flow}`).toEqual([]);
}

/** Errores de consola y respuestas 4xx/5xx: se registran como hallazgos. */
/**
 * Ruido que NO es del producto: el propio arnés aborta fuentes/imágenes
 * remotas (`route.abort('blockedbyclient')`), y Chrome lo reporta como error
 * de consola. Se filtra para que el reporte solo traiga defectos reales.
 */
const BENIGN_CONSOLE = [/ERR_BLOCKED_BY_CLIENT/i, /net::ERR_FAILED.*(fonts\.|googleapis)/i];

export function reportNoise(log, flow) {
    log.consoleErrors = log.consoleErrors.filter(msg => !BENIGN_CONSOLE.some(re => re.test(msg)));
    if (log.consoleErrors.length > 0) {
        record(flow, 'finding', `${log.consoleErrors.length} error(es) de consola`, log.consoleErrors.slice(0, 5));
    }
    if (log.badResponses.length > 0) {
        record(flow, 'finding', `${log.badResponses.length} respuesta(s) local(es) >= 400`, log.badResponses.slice(0, 5));
    }
}

// ── Siembra y navegación ──────────────────────────────────────────────────
/**
 * Siembra el estado base (licencia, sesión ADMIN, tasa manual 40, productos,
 * clientes, métodos de pago, caja abierta) sin datos de venta del día.
 */
export async function seedAudit(page, { extraInitScripts = [], reseedOnReload = true } = {}) {
    await neutralizeExternalNetwork(page);

    // El auto-backup apunta al backend real de producción: la auditoría NUNCA
    // debe disparar escrituras contra producción (y de paso evitamos el ruido
    // de CORS que genera desde localhost).
    await page.route('**estacion-2026.vercel.app/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    if (reseedOnReload) {
        await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
        await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
    } else {
        // Los snippets de siembra se ejecutan en CADA carga, así que una recarga
        // borraría los datos que el propio flujo acaba de crear. Con este guardia
        // la recarga se convierte en una prueba real de persistencia.
        await page.addInitScript(`
if (!localStorage.getItem('__e2e_audit_seeded_v1')) {
    try { localStorage.setItem('__e2e_audit_seeded_v1', '1'); } catch (_) {}
    ${SEED_LOCALSTORAGE_SNIPPET}
    ${SEED_INDEXEDDB_SNIPPET}
}
`);
    }

    for (const script of extraInitScripts) await page.addInitScript(script);
}

export const TABS = {
    inicio: 'Inicio',
    ventas: 'Vender',
    catalogo: 'Inventario',
    clientes: 'Clientes',
    reportes: 'Reportes',
    ajustes: 'Ajustes',
};

export async function startApp(page) {
    await page.goto('/');
    // La nav inferior expone [data-tour="tab-*"] único: el nombre «Inicio»
    // también existe en la barra de pestañas superior y rompe el modo estricto.
    await expect(page.locator('[data-tour="tab-inicio"]')).toBeVisible({ timeout: 30_000 });
}

export async function goTo(page, tab) {
    await page.locator(`[data-tour="tab-${tab}"]`).click();
}

/**
 * Lee una clave de IndexedDB (localforage) tal como quedó persistida. Es la
 * forma de auditar el estado FINAL de la app, no solo lo que se ve en pantalla.
 */
export async function readIdb(page, key) {
    return page.evaluate((k) => new Promise((resolve) => {
        const req = indexedDB.open('BodegaApp');
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('bodega_app_data')) { db.close(); resolve(null); return; }
            const get = db.transaction('bodega_app_data', 'readonly').objectStore('bodega_app_data').get(k);
            get.onsuccess = () => { const v = get.result ?? null; db.close(); resolve(v); };
            get.onerror = () => { db.close(); resolve(null); };
        };
    }), key);
}

// ── Desborde horizontal ───────────────────────────────────────────────────
/**
 * Mide desborde horizontal del documento y lista los elementos que se salen
 * del viewport. La app es mobile-first: cualquier desborde a 360 px es un
 * hallazgo de UX, no un detalle.
 */
export async function measureOverflow(page) {
    return page.evaluate(() => {
        const doc = document.documentElement;
        const viewport = window.innerWidth;
        const TOLERANCE = 4; // px de sombra/borde: no es un desborde real
        const offenders = [];

        /** ¿Algún ancestro lo recorta o lo desplaza a propósito? */
        const estaContenido = (el) => {
            for (let p = el.parentElement; p && p !== doc; p = p.parentElement) {
                const s = getComputedStyle(p);
                if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) return true;
            }
            return false;
        };

        for (const el of document.querySelectorAll('body *')) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.right <= viewport + TOLERANCE) continue;
            const style = getComputedStyle(el);
            // Elementos fijos (diálogos, FAB, banners) no definen el ancho del documento.
            if (style.position === 'fixed') continue;
            // Contenido dentro de un carrusel/tabla con scroll propio: por diseño.
            if (estaContenido(el)) continue;
            offenders.push(
                `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} right=${Math.round(rect.right)} overflowX=${style.overflowX}`
            );
            if (offenders.length >= 6) break;
        }
        return { docOverflow: doc.scrollWidth - doc.clientWidth, viewport, offenders };
    });
}

/** Registra el desborde de una vista. Devuelve la medición para poder afirmarla. */
export async function auditOverflow(page, flow, label) {
    const m = await measureOverflow(page);
    if (m.docOverflow > 2 || m.offenders.length > 0) {
        record(flow, 'finding',
            `desborde horizontal en ${label} (documento ${m.docOverflow}px, ${m.offenders.length} elemento(s) fuera del viewport)`,
            m.offenders);
    } else {
        record(flow, 'ok', `${label}: sin desborde horizontal a ${m.viewport}px`);
    }
    return m;
}
