// EXCEL-IMPORT-001: importación de inventario desde Excel (.xlsx) a la sede activa.
// Lógica pura y testeable: detección de columnas, parseo de números es-VE y
// reglas de limpieza. El parseo del archivo (SheetJS) vive en ExcelImportModal.
import { buildProductPayload } from './productProcessor.js';

const normHeader = (v) =>
    String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Detecta los índices de columna en una fila de encabezado.
 * Acepta variantes: "VENTA USD", "VENTA ", "ESTIMADO", etc.
 * @returns {{nombre,codigo,precio,existencia}|null}
 */
export function detectarColumnas(fila) {
    const idx = { nombre: -1, codigo: -1, precio: -1, existencia: -1 };
    (fila || []).forEach((c, i) => {
        const h = normHeader(c);
        if (idx.nombre < 0 && h.startsWith('PRODUCTO')) idx.nombre = i;
        else if (idx.codigo < 0 && h.startsWith('CODIGO')) idx.codigo = i;
        else if (idx.precio < 0 && h.startsWith('VENTA')) idx.precio = i;
        else if (idx.existencia < 0 && h.startsWith('EXISTENCIA')) idx.existencia = i;
    });
    return idx.nombre >= 0 ? idx : null;
}

/**
 * Parsea un número en formatos es-VE: 1234.56, "1.234,56", "160,00", "1,234.56".
 * @returns {number} NaN si no es parseable.
 */
export function parseNumero(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim().replace(/\s/g, '');
    if (s === '') return 0;
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
        // El separador decimal es el último de los dos.
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
        } else {
            s = s.replace(/,/g, ''); // 1,234.56
        }
    } else if (hasComma) {
        s = s.replace(',', '.'); // 160,00
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

const genId = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `imp_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

/**
 * Mapea filas crudas (arrays, con o sin encabezado) a productos del esquema
 * de la app + estadísticas de limpieza.
 *
 * Reglas:
 * - Filas sin nombre se omiten.
 * - Código duplicado dentro del archivo: el primero conserva el código, los
 *   demás se importan SIN código (barcode null) para no romper el lookup del POS.
 * - Existencia negativa se importa tal cual (dato fiel) y se reporta.
 * - Existencia decimal se redondea a entero (la app solo permite decimales en granel).
 */
export function mapInventarioRows(filasCrudas, { effectiveRate = 1, idGen = genId } = {}) {
    const stats = {
        total: 0, importados: 0, omitidos: 0,
        duplicadosSinCodigo: 0, negativos: 0, precioCero: 0,
        decimalesRedondeados: 0, sinCodigo: 0,
    };
    // Localizar encabezado: primera fila que parezca cabecera.
    let cols = null;
    let inicio = 0;
    for (let i = 0; i < Math.min(filasCrudas.length, 5); i++) {
        const d = detectarColumnas(filasCrudas[i]);
        if (d) { cols = d; inicio = i + 1; break; }
    }
    if (!cols) {
        return { products: [], stats, columnas: null, error: 'No se encontró la fila de encabezado (PRODUCTO, CODIGO, VENTA, EXISTENCIA).' };
    }

    const vistos = new Set();
    const products = [];
    for (let i = inicio; i < filasCrudas.length; i++) {
        const f = filasCrudas[i] || [];
        const nombre = String(f[cols.nombre] ?? '').trim();
        if (!nombre) { stats.omitidos++; continue; }
        stats.total++;

        let codigo = cols.codigo >= 0 ? String(f[cols.codigo] ?? '').trim() : '';
        if (!codigo) stats.sinCodigo++;
        else if (vistos.has(codigo)) {
            codigo = ''; // duplicado: sin código para no romper el POS
            stats.duplicadosSinCodigo++;
            stats.sinCodigo++;
        } else {
            vistos.add(codigo);
        }

        const precioRaw = cols.precio >= 0 ? f[cols.precio] : 0;
        let precio = parseNumero(precioRaw);
        if (!Number.isFinite(precio) || precio < 0) precio = 0;
        if (precio === 0) stats.precioCero++;

        const existRaw = cols.existencia >= 0 ? f[cols.existencia] : 0;
        let exist = parseNumero(existRaw);
        if (!Number.isFinite(exist)) exist = 0;
        if (exist < 0) stats.negativos++;
        if (exist !== Math.round(exist)) stats.decimalesRedondeados++;
        exist = Math.round(exist);

        const payload = buildProductPayload({
            // Los Excel vienen en MAYÚSCULAS: normalizar a minúsculas para que
            // el formateo propio del payload (primera letra de cada palabra)
            // deje nombres legibles en el POS ("Mayonesa Kraft 175gr").
            name: nombre.toLowerCase(),
            barcode: codigo || null,
            priceUsd: precio,
            stock: exist,
            packagingType: 'unidad',
            pricingMode: 'tasa_dia',
        }, effectiveRate);

        products.push({
            id: idGen(),
            ...payload,
            createdAt: new Date().toISOString(),
        });
        stats.importados++;
    }
    return { products, stats, columnas: cols, error: null };
}
