/**
 * Hook que conecta auditService con el usuario activo del auth store.
 * Uso: const { log } = useAudit();
 *      log('VENTA', 'VENTA_COMPLETADA', 'Venta $25.50', { saleId: '...' });
 */
import { useCallback } from 'react';
import { useAuthStore } from './store/useAuthStore';
import { logEvent } from '../services/auditService';

export function useAudit() {
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);

    const log = useCallback((cat, action, desc, meta = null) => {
        logEvent(cat, action, desc, usuarioActivo, meta);
    }, [usuarioActivo]);

    return { log };
}
