import { useEffect, useRef } from 'react';
import { unShiftBarcode } from '../utils/barcodeNormalizer';

/**
 * Hook para escuchar eventos del teclado globalmente y detectar
 * lecturas de escáneres de código de barras (emuladores de teclado rápidos).
 *
 * HOOK-028: antes, `onScan` estaba en las deps del `useEffect`, lo que hacía
 * que el listener se re-creara en cada render del caller (porque la mayoría
 * pasaba un callback inline). Ahora `onScan` se guarda en ref y el listener
 * se crea una sola vez (al montar o cuando cambia `enabled`/`timeout`).
 */
export function useBarcodeScanner({ onScan, enabled = true, timeout = 50 }) {
    const buffer = useRef('');
    const lastKeyTime = useRef(Date.now());
    // HOOK-028: ref al callback más reciente, sin que afecte las deps del effect.
    const onScanRef = useRef(onScan);
    useEffect(() => { onScanRef.current = onScan; }, [onScan]);

    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e) => {
            // Ignorar si el usuario está enfocado y escribiendo en un input
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
                return;
            }

            // Ignorar teclas modificadoras u otras teclas de control (solo tomamos Enter para confirmar)
            if (e.key.length > 1 && e.key !== 'Enter') {
                return;
            }

            const currentTime = Date.now();

            // Si el tiempo entre teclas supera el 'timeout', asumimos teclado manual y limpiamos buffer
            if (currentTime - lastKeyTime.current > timeout) {
                buffer.current = '';
            }

            lastKeyTime.current = currentTime;

            if (e.key === 'Enter') {
                if (buffer.current.length >= 3) {
                    // Prevenir comportamientos por defecto si asimilamos que es un escaneo
                    e.preventDefault();
                    const rawCode = buffer.current;
                    buffer.current = '';
                    const translatedCode = unShiftBarcode(rawCode) || rawCode.trim();
                    // HOOK-028: invocar vía ref en vez de closure directa.
                    if (typeof onScanRef.current === 'function') {
                        onScanRef.current(translatedCode);
                    }
                } else {
                    buffer.current = '';
                }
                return;
            }

            buffer.current += e.key;
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
        // HOOK-028: deps reducidas a `enabled` y `timeout` (primitivos estables).
    }, [enabled, timeout]);
}
