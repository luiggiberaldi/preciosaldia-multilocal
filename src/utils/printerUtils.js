/**
 * Utilidades para abrir ventana/iframe de impresion y escribir HTML.
 *
 * Fix SEC-020: El template HTML inserta campos dinámicos (nombre de producto,
 * cliente, etc.) directamente en el HTML enviado a `document.write`. Si un campo
 * contiene `<script>` o `"><img onerror=...>`, se ejecuta en el contexto del
 * popup/iframe. Aunque el contexto está aislado del opener por la misma política
 * de origen, sigue siendo un vector de XSS para modificar el ticket impreso o
 * explotar el DOM del navegador. Se introduce `escapeHtml()` para neutralizar
 * caracteres peligrosos antes de interpolar.
 *
 * @module utils/printerUtils
 */

/**
 * Escapa caracteres HTML peligrosos para evitar XSS al interpolar en un template.
 *
 * @param {string|number|undefined|null} str
 * @returns {string} String seguro para insertar en HTML.
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Abre una ventana de impresion, escribe el HTML y dispara window.print().
 * Si la ventana emergente es bloqueada, usa un iframe oculto como fallback.
 *
 * SEC-020: El caller es responsable de sanitizar con `escapeHtml()` cualquier
 * campo dinámico ANTES de pasarlo en `html`. Se expone el helper para tal fin.
 *
 * @param {string} html
 */
export function openPrintWindow(html) {
    const printWindow = window.open('', '_blank', 'width=350,height=600');
    if (!printWindow) {
        // Fallback: iframe oculto
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:80mm;height:auto;';
        document.body.appendChild(iframe);
        iframe.contentDocument.open();
        iframe.contentDocument.write(html);
        iframe.contentDocument.close();
        iframe.onload = () => {
            setTimeout(() => {
                iframe.contentWindow.print();
                setTimeout(() => document.body.removeChild(iframe), 2000);
            }, 300);
        };
        return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    // Escuchar el evento afterprint para cerrar la ventana tan pronto termine
    printWindow.addEventListener('afterprint', () => {
        try { printWindow.close(); } catch(_) {}
    });

    // Esperar a que cargue la imagen del logo antes de imprimir
    printWindow.onload = () => {
        setTimeout(() => {
            printWindow.print();
        }, 400);
    };

    // Fallback si onload no dispara
    setTimeout(() => {
        try { printWindow.print(); } catch(_) {}
    }, 1500);
}

export default { openPrintWindow, escapeHtml };
