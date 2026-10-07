/**
 * analyze-baselines.mjs — Auditoría visual de los screenshots baseline (360/390/430).
 *
 * Para cada PNG:
 *  - dimensiones reales
 *  - color de fondo (esquina) y % de píxeles de "tinta" (no fondo)
 *  - bandas de contenido (filas contiguas con tinta) → densidad vertical
 *  - contacto con los 4 bordes (¿algo cortado?)
 *  - fila más densa y su posición (¿footer saturado?)
 *
 * Uso: node scripts/analyze-baselines.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const DIR = 'tests/e2e/__screenshots__';
const TOL = 18; // tolerancia de distancia al fondo

const dist = (a, b) => Math.abs(a - b);
const isBg = (px, bg) =>
    dist(px.r, bg.r) <= TOL && dist(px.g, bg.g) <= TOL && dist(px.b, bg.b) <= TOL;

function analyze(file) {
    const png = PNG.sync.read(readFileSync(join(DIR, file)));
    const { width: W, height: H, data } = png;

    const get = (x, y) => {
        const i = (y * W + x) * 4;
        return { r: data[i], g: data[i + 1], b: data[i + 2] };
    };

    // Fondo: píxel de la esquina superior derecha (header suele tener color,
    // pero la esquina derecha del header en esta app es gris claro; si coincide
    // con la inferior, es fiable).
    const bg = get(W - 4, 4);

    // Tinta por fila (muestreo cada 2 px en x para velocidad).
    const rowInk = new Array(H).fill(0);
    for (let y = 0; y < H; y++) {
        let ink = 0;
        for (let x = 0; x < W; x += 2) if (!isBg(get(x, y), bg)) ink++;
        rowInk[y] = ink;
    }
    const samplesPerRow = Math.ceil(W / 2);
    const rowsWithInk = rowInk.filter((v) => v / samplesPerRow > 0.02).length;

    // Bandas: filas contiguas con tinta separadas por ≥6 filas de fondo.
    const bands = [];
    let start = -1;
    let gap = 0;
    for (let y = 0; y < H; y++) {
        const has = rowInk[y] / samplesPerRow > 0.02;
        if (has) {
            if (start === -1) start = y;
            gap = 0;
        } else if (start !== -1) {
            gap++;
            if (gap >= 6) {
                bands.push([start, y - gap]);
                start = -1;
                gap = 0;
            }
        }
    }
    if (start !== -1) bands.push([start, H - 1]);

    // Contacto con bordes (filas/cols con tinta pegada al borde).
    const edge = (side) => {
        let ink = 0;
        let total = 0;
        const scanRow = (y) => {
            for (let x = 0; x < W; x++) {
                total++;
                if (!isBg(get(x, y), bg)) ink++;
            }
        };
        const scanCol = (x) => {
            for (let y = 0; y < H; y++) {
                total++;
                if (!isBg(get(x, y), bg)) ink++;
            }
        };
        if (side === 'top') for (let y = 0; y < 2; y++) scanRow(y);
        if (side === 'bottom') for (let y = H - 2; y < H; y++) scanRow(y);
        if (side === 'left') for (let x = 0; x < 2; x++) scanCol(x);
        if (side === 'right') for (let x = W - 2; x < W; x++) scanCol(x);
        return total ? (ink / total) * 100 : 0;
    };

    // Densidad por tercios verticales (header / cuerpo / footer).
    const third = (a, b) => {
        let ink = 0;
        for (let y = a; y < b; y++) ink += rowInk[y];
        return (ink / ((b - a) * samplesPerRow)) * 100;
    };

    // Fila más densa.
    let maxY = 0;
    let maxV = 0;
    for (let y = 0; y < H; y++) {
        const v = rowInk[y] / samplesPerRow;
        if (v > maxV) { maxV = v; maxY = y; }
    }

    return { file, W, H, bg, coverage: (rowsWithInk / H) * 100, bands, edge, third, maxY, maxV };
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.png') && f.startsWith('checkout-')).sort();
console.log(`Fondo detectado en cada imagen (tolerancia ${TOL}). Umbral de banda: >2% de tinta.\n`);

for (const f of files) {
    const a = analyze(f);
    console.log(`━━ ${f} (${a.W}×${a.H}) — fondo rgb(${a.bg.r},${a.bg.g},${a.bg.b})`);
    console.log(`   cobertura vertical: ${a.coverage.toFixed(1)}% de filas con contenido`);
    console.log(`   bandas: ${a.bands.length} → ${a.bands.map(([s, e]) => `${s}–${e} (${e - s + 1}px)`).join(' | ')}`);
    console.log(
        `   bordes con tinta: top ${a.edge('top').toFixed(0)}% | bottom ${a.edge('bottom').toFixed(0)}% | left ${a.edge('left').toFixed(0)}% | right ${a.edge('right').toFixed(0)}%`,
    );
    console.log(
        `   densidad: tercio-sup ${a.third(0, Math.floor(a.H / 3)).toFixed(0)}% | medio ${a.third(Math.floor(a.H / 3), Math.floor((2 * a.H) / 3)).toFixed(0)}% | inf ${a.third(Math.floor((2 * a.H) / 3), a.H).toFixed(0)}% | fila máx ${a.maxY} (${(a.maxV * 100).toFixed(0)}% tinta)`,
    );
    console.log();
}
