import { useCallback, useEffect, useRef } from 'react';

/**
 * Hook de sonidos sintéticos con Web Audio API.
 * Cero archivos de audio — todo generado programáticamente.
 *
 * HOOK-020: cleanup de AudioContext y timeout IDs para evitar leaks.
 *  - `ctx.close()` al desmontar (libera recursos de audio del navegador).
 *  - `setTimeout` IDs guardados en ref y limpiados en cleanup / re-llamada.
 */
export function useSounds() {
    const ctxRef = useRef(null);
    // HOOK-020: Track timeouts para limpiarlos en cleanup.
    const timeoutsRef = useRef([]);

    const getCtx = useCallback(() => {
        if (!ctxRef.current) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            ctxRef.current = new Ctor();
        }
        // Resume si está suspendido (política de autoplay del navegador)
        if (ctxRef.current.state === 'suspended') {
            ctxRef.current.resume();
        }
        return ctxRef.current;
    }, []);

    // HOOK-020: Al desmontar, cerrar el AudioContext y limpiar timeouts pendientes.
    useEffect(() => {
        return () => {
            for (const id of timeoutsRef.current) {
                clearTimeout(id);
            }
            timeoutsRef.current = [];
            if (ctxRef.current) {
                try {
                    // `close` libera el recurso de audio a nivel sistema operativo.
                    ctxRef.current.close();
                } catch (e) {
                    console.warn('[useSounds] Error cerrando AudioContext:', e);
                }
                ctxRef.current = null;
            }
        };
    }, []);

    // HOOK-020: wrapper para setTimeout que trackea el ID.
    const _trackedTimeout = useCallback((fn, delay) => {
        const id = setTimeout(() => {
            // Auto-remover del array al disparar.
            timeoutsRef.current = timeoutsRef.current.filter((x) => x !== id);
            try { fn(); } catch (e) { /* noop */ }
        }, delay);
        timeoutsRef.current.push(id);
        return id;
    }, []);

    // ── Helpers ──
    const beep = useCallback((freq, duration = 0.08, type = 'sine', vol = 0.15) => {
        try {
            const ctx = getCtx();
            if (!ctx) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(vol, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            // HOOK-022: no silenciar completamente; loguear en dev.
            console.warn('[useSounds] beep falló:', e);
        }
    }, [getCtx]);

    // ── Sonidos públicos ──

    /** Agregar producto al carrito — tono ascendente rápido */
    const playAdd = useCallback(() => {
        beep(800, 0.06, 'sine', 0.12);
        _trackedTimeout(() => beep(1200, 0.08, 'sine', 0.1), 50);
    }, [beep, _trackedTimeout]);

    /** Quitar producto del carrito — tono descendente */
    const playRemove = useCallback(() => {
        beep(600, 0.06, 'sine', 0.1);
        _trackedTimeout(() => beep(400, 0.08, 'sine', 0.08), 50);
    }, [beep, _trackedTimeout]);

    /** Checkout exitoso — ka-ching! */
    const playCheckout = useCallback(() => {
        beep(523, 0.08, 'sine', 0.12);
        _trackedTimeout(() => beep(659, 0.08, 'sine', 0.12), 80);
        _trackedTimeout(() => beep(784, 0.1, 'sine', 0.14), 160);
        _trackedTimeout(() => beep(1047, 0.15, 'sine', 0.16), 260);
    }, [beep, _trackedTimeout]);

    /** Error — buzzer corto */
    const playError = useCallback(() => {
        beep(200, 0.15, 'square', 0.08);
        _trackedTimeout(() => beep(180, 0.15, 'square', 0.06), 120);
    }, [beep, _trackedTimeout]);

    /** Éxito genérico — doble beep */
    const playSuccess = useCallback(() => {
        beep(880, 0.08, 'sine', 0.1);
        _trackedTimeout(() => beep(1100, 0.1, 'sine', 0.12), 100);
    }, [beep, _trackedTimeout]);

    /** Toque de botón/navegación — click sutil */
    const playTap = useCallback(() => {
        beep(1000, 0.03, 'sine', 0.06);
    }, [beep]);

    return { playAdd, playRemove, playCheckout, playError, playSuccess, playTap };
}
