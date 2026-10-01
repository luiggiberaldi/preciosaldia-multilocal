import { useEffect } from 'react';
import { supabase } from '../core/supabaseClient';
import {
    isDeviceBackendDown,
    markDeviceBackendDown,
    markDeviceBackendUp,
    isBackendMissingError,
    noteDeviceBackendSkipped,
} from '../utils/deviceBackend';

const PRODUCT_ID = 'bodega';

// Module scope: cache subscriptions when multiple hooks are mounted in parallel
const activeSubscriptions = new Map(); // deviceId -> { channel, count, callbacks: Set<function> }

/**
 * Hook that handles heartbeat sending, license status verification,
 * and real-time subscription for license changes.
 *
 * SEC-001/SEC-007: Ya NO minteamos tokens XOR legacy en localStorage.
 * La fuente de verdad es la fila `licenses` en el servidor. Solo actualizamos
 * el estado React (via callbacks) cuando el backend confirma el cambio.
 */
export function useLicenseMonitoring({
    deviceId,
    isPremium,
    onRevoked,
    onPermanentActivated,
}) {
    useEffect(() => {
        if (!deviceId || !import.meta.env.VITE_SUPABASE_URL) return;

        const verifyStatus = async () => {
            // Guard: backend de dispositivos no implementado → no martillar con 404.
            if (isDeviceBackendDown()) { noteDeviceBackendSkipped('useLicenseMonitoring'); return; }
            try {
                let license = null;
                try {
                    const { data, error: rpcErr } = await supabase.rpc('get_license_status', { p_device_id: deviceId });
                    if (rpcErr) {
                        if (isBackendMissingError(rpcErr)) { markDeviceBackendDown(); noteDeviceBackendSkipped('useLicenseMonitoring'); return; }
                    } else if (data) {
                        const record = Array.isArray(data) ? data[0] : data;
                        if (record) {
                            license = record;
                        }
                    }
                } catch (rpcEx) {
                    if (isBackendMissingError(rpcEx)) { markDeviceBackendDown(); noteDeviceBackendSkipped('useLicenseMonitoring'); return; }
                    // Silencioso
                }

                if (!license) {
                    const { data, error } = await supabase
                        .from('licenses')
                        .select('type, is_active, expires_at, created_at')
                        .eq('device_id', deviceId)
                        .eq('product_id', PRODUCT_ID)
                        .maybeSingle();
                    if (error && isBackendMissingError(error)) { markDeviceBackendDown(); noteDeviceBackendSkipped('useLicenseMonitoring'); return; }
                    license = data;
                }

                // Llegamos aquí sin "no implementado": el backend existe.
                markDeviceBackendUp();

                if (license && (license.is_active === false || license.type === 'revoked') && isPremium) {
                    localStorage.removeItem('pda_premium_token');
                    localStorage.removeItem('pda_license_cache');
                    onRevoked("Tu licencia ha sido desactivada. Contacta al administrador.");
                } else if (license && license.is_active === true) {
                    // Sincronizar cache offline
                    const expiresAt = license.expires_at ? new Date(license.expires_at).getTime() : null;
                    localStorage.setItem('pda_license_cache', JSON.stringify({
                        type: license.type,
                        isActive: true,
                        expiresAt: expiresAt,
                        createdAt: license.created_at,
                        deviceId: deviceId,
                        updatedAt: Date.now()
                    }));

                    // Si el backend activó la licencia permanente, actualizar estado local.
                    // SEC-001: NO creamos tokens XOR; solo actualizamos estado React.
                    if (license.type === 'permanent' && !isPremium) {
                        onPermanentActivated();
                    }
                }
            } catch (e) {
                if (import.meta.env?.DEV) {
                    console.warn('[LicenseMonitoring] verifyStatus falló:', e?.message ?? e);
                }
            }
        };

        const sendHeartbeat = async () => {
            if (isDeviceBackendDown()) return;
            verifyStatus();
            try {
                const clientName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                const { error: regErr } = await supabase.rpc('auto_register_device', { p_device_id: deviceId, p_product_id: PRODUCT_ID, p_client_name: clientName });
                const { error: hbErr } = await supabase.rpc('heartbeat_device', { p_device_id: deviceId, p_product_id: PRODUCT_ID, p_client_name: clientName });
                if (isBackendMissingError(regErr) || isBackendMissingError(hbErr)) {
                    markDeviceBackendDown();
                    noteDeviceBackendSkipped('useLicenseMonitoring');
                } else {
                    markDeviceBackendUp();
                }
            } catch (e) {
                if (isBackendMissingError(e)) {
                    markDeviceBackendDown();
                    noteDeviceBackendSkipped('useLicenseMonitoring');
                } else if (import.meta.env?.DEV) {
                    console.warn('[LicenseMonitoring] heartbeat falló:', e?.message ?? e);
                }
            }
        };

        sendHeartbeat();
        // Frecuencia constante de heartbeat a 3 minutos para mantener estado online preciso en Estación Maestra
        const heartbeatIntervalMs = 3 * 60 * 1000;
        const heartbeatInterval = setInterval(sendHeartbeat, heartbeatIntervalMs);

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') verifyStatus();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        // Solo dispositivos con licencia permanente activa mantienen el
        // socket `licenses_sync_` abierto — evita gastar cupo de conexiones Realtime
        // en instalaciones sin licencia. Esas detectan una activación vía el heartbeat
        // de arriba en vez de Realtime. Si el backend no existe, ni se suscribe.
        let subscribedToChannel = false;
        if (isPremium && !isDeviceBackendDown()) {
            let subObj = activeSubscriptions.get(deviceId);
            if (subObj) {
                subObj.count++;
                subObj.callbacks.add(verifyStatus);
                subscribedToChannel = true;
            } else {
                const callbacks = new Set([verifyStatus]);
                let subscription = null;
                try {
                    subscription = supabase
                        .channel(`licenses_sync_${deviceId}`)
                        .on('postgres_changes', {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'licenses',
                            filter: `device_id=eq.${deviceId}`,
                        }, () => {
                            const current = activeSubscriptions.get(deviceId);
                            if (current) {
                                current.callbacks.forEach(cb => {
                                    try { cb(); } catch (err) { }
                                });
                            }
                        })
                        .subscribe();
                    subObj = { channel: subscription, count: 1, callbacks };
                    activeSubscriptions.set(deviceId, subObj);
                    subscribedToChannel = true;
                } catch (e) {
                    if (import.meta.env?.DEV) {
                        console.warn('[LicenseMonitoring] suscripción Realtime falló:', e?.message ?? e);
                    }
                }
            }
        }

        return () => {
            clearInterval(heartbeatInterval);
            document.removeEventListener('visibilitychange', handleVisibility);

            if (subscribedToChannel) {
                const currentSub = activeSubscriptions.get(deviceId);
                if (currentSub) {
                    currentSub.callbacks.delete(verifyStatus);
                    currentSub.count--;
                    if (currentSub.count <= 0) {
                        activeSubscriptions.delete(deviceId);
                        if (currentSub.channel) {
                            supabase.removeChannel(currentSub.channel).catch(() => {});
                        }
                    }
                }
            }
        };
    }, [isPremium, deviceId]);
}
