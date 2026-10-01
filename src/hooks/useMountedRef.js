import { useEffect, useRef } from 'react';

/**
 * useMountedRef.js — B-19 (2026-10-01).
 *
 * Los modales remotos esperan `ackPromise` (orden → caja → confirmación),
 * que puede tardar segundos. Si el usuario cierra el modal a mitad del ack,
 * el `setState` posterior dispara el warning "setState on unmounted".
 *
 * Uso:
 *   const mountedRef = useMountedRef();
 *   ...
 *   const ack = await result.ackPromise;
 *   if (!mountedRef.current) return;   // el modal se cerró: no tocar estado
 *   setIsSubmitting(false);
 */
export function useMountedRef() {
    const ref = useRef(true);
    useEffect(() => {
        ref.current = true;
        return () => { ref.current = false; };
    }, []);
    return ref;
}

export default useMountedRef;
