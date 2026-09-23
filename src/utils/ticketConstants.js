/**
 * Constantes compartidas para generación de tickets y etiquetas.
 */

// ── Paleta de colores (PDF) ──
export const INK = [33, 37, 41];
export const BODY = [73, 80, 87];
export const MUTED = [134, 142, 150];
export const GREEN = [16, 124, 65];
export const RULE = [206, 212, 218];
export const RED = [220, 53, 69];

// ── Dimensiones del ticket PDF 80mm ──
export const PDF_WIDTH = 80;
export const PDF_MARGIN = 6;
export const PDF_CENTER_X = PDF_WIDTH / 2;
export const PDF_RIGHT = PDF_WIDTH - PDF_MARGIN;

/**
 * Devuelve los tamaños CSS según el ancho de papel (58mm o 80mm).
 */
export function getPaperConfig(paperWidth) {
    const is80 = paperWidth === '80';
    return {
        is80,
        cssPageSize: is80 ? '80mm auto' : '58mm auto',
        cssBodyWidth: is80 ? '76mm' : '46mm',
        cssLogoW: is80 ? '60mm' : '40mm',
        fDisclaimer: is80 ? '9px' : '7px',
        fTiny: is80 ? '11px' : '8.5px',
        fSmall: is80 ? '12px' : '10px',
        fBase: is80 ? '14px' : '11px',
        fTitle: is80 ? '18px' : '13px',
        fTotalU: is80 ? '32px' : '22px',
        fTotalB: is80 ? '18px' : '13px',
    };
}
