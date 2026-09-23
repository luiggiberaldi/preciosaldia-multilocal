import { useEffect } from 'react';
import { supabase } from '../core/supabaseClient';

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
    isDemo,
    onRevoked,
    onPermanentActivated,
    onDemoActivated,
    onMonthlyActivated,
}) {
    useEffect(() => {
        if (!deviceId || !import.meta.env.VITE_SUPABASE_URL) return;

        const verifyStatus = async () => {
            try {
                let license = null;
                try {
                    const { data, error: rpcErr } = await supabase.rpc('get_license_status', { p_device_id: deviceId });
                    if (!rpcErr && data) {
                        const record = Array.isArray(data) ? data[0] : data;
                        if (record) {
                            license = record;
                        }
                    }
                } catch (rpcEx) {
                    // Silencioso
                }

                if (!license) {
                    const { data, error } = await supabase
                        .from('licenses')
                        .select('type, is_active, expires_at, created_at')
                        .eq('device_id', deviceId)
                        .eq('product_id', PRODUCT_ID)
                        .maybeSingle();
                    license = data;
                }

                if (license && (license.is_active === false || license.type === 'revoked') && isPremium) {
                    localStorage.removeItem('pda_premium_token');
                    localStorage.removeItem('pda_license_cache');
                    onRevoked("Tu licencia ha sido desactivada. Contacta al administrador.");
                } else if (license && license.is_active === true) {
                    // Verificar si demo venció por fecha
                    if ((license.type === 'demo7' || license.type === 'demo3') && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() >= expiresAt && isPremium) {
                            localStorage.removeItem('pda_premium_token');
                            localStorage.removeItem('pda_license_cache');
                            onRevoked("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
                            return;
                        }
                    }

                    // Verificar si mensual venció por fecha incluyendo 5 días de gracia
                    if (license.type === 'monthly' && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        const gracePeriodEnd = expiresAt + 5 * 24 * 60 * 60 * 1000;
                        if (Date.now() >= gracePeriodEnd && isPremium) {
                            localStorage.removeItem('pda_premium_token');
                            localStorage.removeItem('pda_license_cache');
                            onRevoked("Tu suscripción mensual ha expirado y el período de gracia de 5 días ha finalizado. Por favor, regulariza tu pago.");
                            return;
                        }
                    }

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

                    // Si el backend cambió el tipo de licencia, actualizar estado local.
                    // SEC-001: NO creamos tokens XOR; solo actualizamos estado React.
                    if (license.type === 'permanent' && (!isPremium || isDemo)) {
                        onPermanentActivated();
                    } else if ((license.type === 'demo7' || license.type === 'demo3') && (!isPremium || !isDemo) && license.expires_at) {
                        const expiresAt = new Date(license.expires_at).getTime();
                        if (Date.now() < expiresAt) {
                            onDemoActivated(expiresAt);
                        }
                    } else if (license.type === 'monthly' && license.expires_at) {
                        const expiresAtValue = new Date(license.expires_at).getTime();
                        const gracePeriodEnd = expiresAtValue + 5 * 24 * 60 * 60 * 1000;
                        if (Date.now() < gracePeriodEnd) {
                            const isGrace = Date.now() >= expiresAtValue;
                            const graceDays = isGrace 
                                ? Math.max(0, Math.ceil((gracePeriodEnd - Date.now()) / (1000 * 60 * 60 * 24)))
                                : 0;
                            if (onMonthlyActivated) {
                                onMonthlyActivated(expiresAtValue, isGrace, graceDays);
                            }
                        }
                    }
                }
            } catch (e) {
                if (import.meta.env?.DEV) {
                    console.warn('[LicenseMonitoring] verifyStatus falló:', e?.message ?? e);
                }
            }
        };

        const sendHeartbeat = async () => {
            verifyStatus();
            try {
                const clientName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                await supabase.rpc('auto_register_device', { p_device_id: deviceId, p_product_id: PRODUCT_ID, p_client_name: clientName });
                await supabase.rpc('heartbeat_device', { p_device_id: deviceId, p_product_id: PRODUCT_ID, p_client_name: clientName });
            } catch (e) {
                if (import.meta.env?.DEV) {
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

        // Solo dispositivos con cuenta activa (permanent/monthly/demo) mantienen el
        // socket `licenses_sync_` abierto — evita gastar cupo de conexiones Realtime
        // en instalaciones sin licencia. Esas detectan una activación vía el heartbeat
        // de arriba en vez de Realtime.
        let subscribedToChannel = false;
        if (isPremium) {
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
    }, [isPremium, isDemo, deviceId]);
}
