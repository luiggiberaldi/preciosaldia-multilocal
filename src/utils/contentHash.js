/**
 * Hash completo y síncrono para detectar cambios en documentos del POS.
 * Recorre todo el contenido (incluidos documentos grandes) y funciona en
 * navegadores y WebViews sin requerir Web Crypto.
 */
export function contentHash(value) {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `full_${text.length}_${(first >>> 0).toString(16)}_${(second >>> 0).toString(16)}`;
}
