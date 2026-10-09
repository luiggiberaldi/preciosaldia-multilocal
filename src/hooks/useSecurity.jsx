import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { supabase } from '../core/supabaseClient';
import { verifyLicenseToken } from '../security/tokenCrypto';
import { getOrCreateInstallationId, verifyInstallationIdentity } from '../security/installationIdentity';
import { useLicenseMonitoring } from './useLicenseMonitoring';
import { LICENSE_POLICY } from '../utils/securityConstants';
import { isAccountLinkedLocally } from '../services/cloudAccount';
import {
    isDeviceBackendDown,
    markDeviceBackendDown,
    markDeviceBackendUp,
    isBackendMissingError,
    noteDeviceBackendSkipped,
} from '../utils/deviceBackend';

const APP_VERSION = '1.0.0';
const PRODUCT_ID = 'bodega';

// Helper seguro para obtener el estado de la licencia respetando RLS o haciendo fallback.
// Guard deviceBackend: si el backend no está implementado, no se llama (evita 404).
//
// Auditoría post-plan (2026-10-01): el monitoreo remoto legacy queda
// DESACTIVADO en Pro (consultaba `licenses` con product_id='bodega', ID de
// Lite — mina de scoping — y disparaba 404 cada sesión). El gate real es
// CloudGate. La verificación local de tokens RSA sigue viva en checkLicense.
// Las funciones de activación manual legadas más abajo (auto_register_device,
// heartbeat_device, verify_activation_code) quedan pendientes de limpieza en
// el refactor de licencias; solo se invocan desde acciones explícitas del
// usuario, no en cada sesión.
async function _fetchRemoteLicense(currentDeviceId) {
    void currentDeviceId;
    return { data: null, error: null };
}

// SEC-022 / INFRA-011: Security headers (CSP, X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy) deben configurarse en el servidor que sirve el build (Cloudflare
// Worker, Vercel o index.html <meta http-equiv>). No se pueden aplicar correctamente
// desde el bundle. Ver ISSUES.md SEC-022 / INFRA-011 — pendiente para Agente D.

// HOOK: useSecurity() lee de un Context compartido (SecurityProvider) en vez de
// correr su propio ciclo de estado por cada componente que lo consume. Antes, cada
// uno de los ~7 componentes que llaman useSecurity() (App, DashboardView, SettingsView,
// WalletView, SettingsModal, PremiumGuard, ManualMode) disparaba su propio auto-registro,
// verificación de licencia y heartbeat al montar — generando ráfagas de RPCs duplicadas
// contra Supabase en cada arranque/navegación. Con Context, el ciclo corre una sola vez
// por sesión de app, sin importar cuántos componentes consuman el estado.
function useSecurityState() {
    const [deviceId, setDeviceId] = useState('');
    const [isPremium, setIsPremium] = useState(false);
    const [loading, setLoading] = useState(true);
    const [integrityWarning, setIntegrityWarning] = useState(false);
    const [identityReady, setIdentityReady] = useState(false);
    const [identityError, setIdentityError] = useState('');
    const lastIntegrityCheckRef = useRef(0);
    // Mensaje cuando la licencia fue desactivada por el administrador.
    const [licenseExpiredMsg, setLicenseExpiredMsg] = useState('');
    const dismissLicenseExpiredMsg = useCallback(() => setLicenseExpiredMsg(''), []);

    // Licencia binaria: solo una licencia 'permanent' activa otorga premium.
    // Demo y mensualidad ya no existen en el Pro.
    const applyLicenseState = useCallback((type, isActive) => {
        const isPrem = isActive === true && type === 'permanent';
        setIsPremium(isPrem);
        return isPrem;
    }, []);

    // License monitoring hook
    useLicenseMonitoring({
        deviceId,
        isPremium,
        onRevoked: (msg) => {
            setIsPremium(false);
            setLicenseExpiredMsg(msg);
            setLoading(false);
        },
        onPermanentActivated: () => {
            setIsPremium(true);
        },
    });

    // HOOK-040: checkLicense memoizado para evitar recreate en cada render.
    // SEC-001/SEC-007: Solo aceptar tokens con firma RSA válida.
    const checkLicense = useCallback(async (currentDeviceId) => {
        // V2.1.35: flag sincrónico de CloudGate (sin imports async, sin race).
        // Si el equipo completó la activación, la licencia es válida.
        try {
            if (localStorage.getItem('pda_pro_activated') === 'true') {
                setIsPremium(true);
                setLoading(false);
                return;
            }
        } catch {}
        // Si hay código Pro activo (CloudGate), la licencia es válida sin más validación.
        try {
            const { getCustomerProject } = await import('../config/supabaseCloud.js');
            const proj = getCustomerProject();
            if (proj?.code) {
                setIsPremium(true);
                setLoading(false);
                return;
            }
        } catch {}
        // SEC-001/SEC-007: Solo aceptar tokens con firma RSA válida.
        // Si el token almacenado es legacy (XOR, sin '.') se elimina y se cae
        // al flujo de validación contra el servidor.
        const rawStored = localStorage.getItem('pda_premium_token');
        let tokenObj = null;

        if (rawStored) {
            if (rawStored.includes('.')) {
                const { valid, payload } = await verifyLicenseToken(rawStored);
                if (valid) tokenObj = payload;
            } else {
                // SEC-001: Token legacy XOR — rechazar y limpiar.
                if (import.meta.env?.DEV) {
                    console.warn('[Security] Token legacy XOR detectado y rechazado (SEC-001).');
                }
                localStorage.removeItem('pda_premium_token');
            }
        }
            if (!tokenObj) {
            // GATE-CLOUD (2026-10-01): el gate real de Pro es CloudGate
            // (código de licencia → login de dueño → registro del equipo con
            // tope de 6 en el servidor). Si el equipo completó ese flujo,
            // `pda_account_linked` está en 'true' y la licencia es válida:
            // no exigir además el token RSA legacy ni el fetch remoto
            // (actualmente stub). Sin esto, todo equipo activado por
            // CloudGate caía en PremiumGuard ("Solicitar Licencia").
            try {
                if (isAccountLinkedLocally()) {
                    setIsPremium(true);
                    setLoading(false);
                    return;
                }
            } catch { /* noop: si no se puede leer, seguir al fallback */ }
            // Fallback: verificar si existe licencia activa en Supabase (ej: reactivada remotamente).
            // Aquí confiamos en la fila del servidor, no en un token local minteado.
            let remoteLicense = null;
            let netError = false;
            try {
                const { data, error } = await _fetchRemoteLicense(currentDeviceId);
                if (error) {
                    netError = true;
                } else {
                    remoteLicense = data;
                }
            } catch (e) {
                netError = true;
                if (import.meta.env?.DEV) {
                    console.warn('[Security] Sin red al validar licencia remota:', e?.message ?? e);
                }
            }

            if (remoteLicense && remoteLicense.is_active === true) {
                const { type, is_active, expires_at, created_at } = remoteLicense;
                const isPrem = applyLicenseState(type, is_active);

                if (isPrem) {
                    // Guardar en cache offline si es válida
                    localStorage.setItem('pda_license_cache', JSON.stringify({
                        type,
                        isActive: true,
                        expiresAt: expires_at ? new Date(expires_at).getTime() : null,
                        createdAt: created_at,
                        deviceId: currentDeviceId,
                        updatedAt: Date.now()
                    }));
                } else {
                    localStorage.removeItem('pda_license_cache');
                }

                setLoading(false);
                return;
            } else if (remoteLicense && remoteLicense.is_active === false) {
                // Si está explícitamente inactiva en Supabase, limpiar caché
                localStorage.removeItem('pda_license_cache');
                setIsPremium(false);
                setLoading(false);
                return;
            }

            // Si hay error de red o no hay respuesta del servidor, usar caché offline
            if (netError || !remoteLicense) {
                const cached = localStorage.getItem('pda_license_cache');
                if (cached) {
                    try {
                        const cacheObj = JSON.parse(cached);
                        if (cacheObj.deviceId === currentDeviceId && cacheObj.isActive) {
                            const isPrem = applyLicenseState(cacheObj.type, cacheObj.isActive);
                            if (isPrem) {
                                setLoading(false);
                                return;
                            }
                        }
                    } catch (err) {
                        // Cache corrupto
                    }
                }
            }

            setIsPremium(false);
            setLoading(false);
            return;
        }

        let isPremiumConfirmed = false;

        try {
            if (tokenObj && tokenObj.deviceId === currentDeviceId) {
                // Verificar estado remoto antes de confiar en el token local.
                let revokedRemotely = false;
                try {
                    const { data: remoteLicense } = await _fetchRemoteLicense(currentDeviceId);
 
                    if (remoteLicense && remoteLicense.is_active === false) {
                        revokedRemotely = true;
                    }
                } catch (e) {
                    if (import.meta.env?.DEV) {
                        console.warn('[Security] Sin red al verificar revocación:', e?.message ?? e);
                    }
                }

                if (revokedRemotely) {
                    localStorage.removeItem('pda_premium_token');
                    setIsPremium(false);
                    setLicenseExpiredMsg("Tu licencia ha sido desactivada por el administrador.");
                    setLoading(false);
                    return;
                }

                // Token RSA válido para este dispositivo: licencia permanente.
                setIsPremium(true);
                isPremiumConfirmed = true;
            } else {
                setIsPremium(false);
            }
        } catch (e) {
            if (import.meta.env?.DEV) {
                console.warn('[Security] Token no parseable:', e?.message ?? e);
            }
            setIsPremium(false);
        }

        // FIX 5: Guardar backup en sessionStorage si licencia valida.
        // SEC-007: ya no usamos XOR para ofuscar; almacenamos un flag simple.
        if (isPremiumConfirmed) {
            try {
                sessionStorage.setItem(
                    '_pda_s',
                    JSON.stringify({ v: 1, deviceId: currentDeviceId, ts: Date.now() })
                );
            } catch { }
        }

        // Registro y heartbeat garantizado en Supabase para el 100% de los dispositivos.
        // Guard deviceBackend: si el backend no existe, se omite (evita 404).
        const registerAndHeartbeat = async () => {
            if (isDeviceBackendDown()) return;
            try {
                const bName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                const mEmail = localStorage.getItem('marketing_email') || '';
                const clientName = mEmail ? `${bName} | ${mEmail}` : bName;
                const { error: regErr } = await supabase.rpc('auto_register_device', {
                    p_device_id: currentDeviceId,
                    p_product_id: PRODUCT_ID,
                    p_client_name: clientName
                });
                const { error: hbErr } = await supabase.rpc('heartbeat_device', {
                    p_device_id: currentDeviceId,
                    p_product_id: PRODUCT_ID,
                    p_client_name: clientName
                });
                if (isBackendMissingError(regErr) || isBackendMissingError(hbErr)) {
                    markDeviceBackendDown();
                    noteDeviceBackendSkipped('useSecurity');
                } else {
                    markDeviceBackendUp();
                }
            } catch (e) {
                if (isBackendMissingError(e)) {
                    markDeviceBackendDown();
                    noteDeviceBackendSkipped('useSecurity');
                } else if (import.meta.env?.DEV) {
                    console.warn('[Security] Registro / heartbeat falló:', e?.message ?? e);
                }
            }
        };

        registerAndHeartbeat();

        setLoading(false);
    }, [setLicenseExpiredMsg]);

    useEffect(() => {
        let cancelled = false;
        const initDeviceId = async () => {
            let storedId;
            try {
                storedId = await getOrCreateInstallationId();
                if (cancelled) return;
                if (!verifyInstallationIdentity(storedId)) throw new Error('Identidad local inconsistente');
            } catch {
                if (cancelled) return;
                setIntegrityWarning(true);
                setIdentityError('No se pudo verificar la identidad de esta instalación. Conserva los datos y solicita revisión; no borres el almacenamiento ni cambies el ID.');
                setIsPremium(false);
                setLoading(false);
                return;
            }
            setDeviceId(storedId);
            setIdentityReady(true);

            // Auto-registro: registrar dispositivo si no existe (sin importar licencia).
            // Guard deviceBackend: si el backend no existe, se omite (evita 404).
            try {
                if (import.meta.env.VITE_SUPABASE_URL && !isDeviceBackendDown()) {
                    const bName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
                    const mEmail = localStorage.getItem('marketing_email') || '';
                    const clientName = mEmail ? `${bName} | ${mEmail}` : bName;
                    const { error: regErr } = await supabase.rpc('auto_register_device', { p_device_id: storedId, p_product_id: PRODUCT_ID, p_client_name: clientName });
                    if (isBackendMissingError(regErr)) {
                        markDeviceBackendDown();
                        noteDeviceBackendSkipped('useSecurity');
                    } else {
                        markDeviceBackendUp();
                    }
                }
            } catch (e) {
                if (isBackendMissingError(e)) {
                    markDeviceBackendDown();
                    noteDeviceBackendSkipped('useSecurity');
                } else if (import.meta.env?.DEV) console.warn('[Security] auto_register_device falló:', e?.message ?? e);
            }

            if (!cancelled) await checkLicense(storedId);
        };

        initDeviceId().catch(() => {
            if (cancelled) return;
            setIsPremium(false);
            setLoading(false);
            setIdentityError('No se pudo completar el inicio seguro. Conserva los datos y solicita revisión.');
        });
        return () => { cancelled = true; };
    }, [checkLicense]);

    // FIX 4: Integrity check periodico cada 30 minutos
    useEffect(() => {
        if (!deviceId) return;
        const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between checks

        const interval = setInterval(async () => {
            const now = Date.now();
            if (now - lastIntegrityCheckRef.current < COOLDOWN_MS) return;
            lastIntegrityCheckRef.current = now;

            // Un conflicto conserva ID, tokens y datos; no hay rotación automática.
            if (!verifyInstallationIdentity(deviceId)) {
                setIntegrityWarning(true);
                setIsPremium(false);
                setDeviceId('');
                setIdentityError('La identidad local cambió durante la sesión. Se detuvo el acceso cloud; conserva los datos y solicita revisión.');
                return;
            }

            const raw = localStorage.getItem('pda_premium_token');

            // Si localStorage fue borrado o no hay token local (flujo sin token local en licencias DB),
            // intentar validar remotamente o contra cache offline.
            if (!raw) {
                // GATE-CLOUD (2026-10-01): equipo activado por CloudGate
                // (sin token RSA legacy). El integrity check no debe revocar
                // su premium: el vínculo cuenta↔equipo ya fue validado en el
                // servidor al registrarse (tope de 6).
                try {
                    if (isAccountLinkedLocally()) return;
                } catch { /* noop */ }
                let remoteLicense = null;
                let netError = false;
                try {
                    const { data, error } = await _fetchRemoteLicense(deviceId);
                    if (error) netError = true;
                    else remoteLicense = data;
                } catch (e) {
                    netError = true;
                    if (import.meta.env?.DEV) {
                        console.warn('[Security] Sin red en integrity check:', e?.message ?? e);
                    }
                }

                if (remoteLicense) {
                    const { type, is_active, expires_at, created_at } = remoteLicense;
                    const isPrem = applyLicenseState(type, is_active);

                    if (isPrem) {
                        // Sincronizar cache offline
                        localStorage.setItem('pda_license_cache', JSON.stringify({
                            type,
                            isActive: true,
                            expiresAt: expires_at ? new Date(expires_at).getTime() : null,
                            createdAt: created_at,
                            deviceId,
                            updatedAt: Date.now()
                        }));
                        return;
                    } else {
                        // Licencia explícitamente revocada
                        localStorage.removeItem('pda_license_cache');
                        setIsPremium(false);
                        setLicenseExpiredMsg("Tu licencia ha sido desactivada por el administrador.");
                        return;
                    }
                }

                // Si hay error de red, validar contra el caché offline
                if (netError) {
                    const cached = localStorage.getItem('pda_license_cache');
                    if (cached) {
                        try {
                            const cacheObj = JSON.parse(cached);
                            if (cacheObj.deviceId === deviceId && cacheObj.isActive) {
                                const isPrem = applyLicenseState(cacheObj.type, cacheObj.isActive);
                                if (isPrem) {
                                    return; // Caché offline válido, no revocar
                                }
                            }
                        } catch (err) {
                            // Caché corrupto
                        }
                    }
                }

                if (isPremium) {
                    console.warn('[Security] No active server license and cache invalid/missing. Revoking premium.');
                    setIsPremium(false);
                    setIntegrityWarning(true);
                }
                return;
            }

            // Verificar integridad del token almacenado (SOLO RSA-signed).
            if (raw) {
                try {
                    let obj = null;
                    if (raw.includes('.')) {
                        const { valid, payload } = await verifyLicenseToken(raw);
                        if (valid) obj = payload;
                    } else {
                        // SEC-001: Token legacy XOR → eliminar.
                        throw new Error('Legacy XOR token rejected');
                    }

                    if (!obj) {
                        throw new Error('Invalid token structure');
                    }
                } catch {
                    if (isPremium) {
                        localStorage.removeItem('pda_premium_token');
                        localStorage.removeItem('pda_license_cache');
                        setIsPremium(false);
                        setIntegrityWarning(true);
                        console.warn('[Security] Corrupt or legacy token detected. Revoking premium state.');
                    }
                }
            }
        }, LICENSE_POLICY.HEARTBEAT_MS);

        return () => clearInterval(interval);
    }, [deviceId, isPremium, checkLicense]);


    /**
     * Desbloquea con codigo de activacion.
     * La licencia Pro es siempre permanente (pago único): el código solo
     * otorga premium si la fila del servidor es 'permanent' y activa.
     *
     * SEC-001: La fuente de verdad es la fila en `licenses` del servidor; ya NO
     * se crea un token legacy XOR local. El estado en memoria queda activo hasta
     * la próxima verificación periódica.
     */
    const unlockApp = async (inputCode) => {
        try {
            const cleanCode = (inputCode || "").replace(/-/g, "").trim().toUpperCase().replace(/O/g, '0');
            let isValid = false;
            let activeLicense = null;

            try {
                const { data, error } = await supabase.rpc('verify_activation_code', {
                    p_device_id: deviceId,
                    p_code: cleanCode
                });
                if (!error && data === true) {
                    isValid = true;
                    const { data: remoteLicense } = await _fetchRemoteLicense(deviceId);
                    activeLicense = remoteLicense;
                }
            } catch (e) {
                // Silencioso
            }

            // Fallback por compatibilidad si la RPC no existe o falla
            if (!isValid) {
                const { data: license, error } = await supabase
                    .from('licenses')
                    .select('type, is_active, expires_at, code, created_at')
                    .eq('device_id', deviceId)
                    .eq('product_id', PRODUCT_ID)
                    .maybeSingle();

                const cleanDbCode = (license?.code || "").replace(/-/g, "").trim().toUpperCase().replace(/O/g, '0');
                if (error || !license || cleanDbCode !== cleanCode) {
                    return { success: false, status: 'INVALID_CODE' };
                }
                activeLicense = license;
            }

            const { type, is_active } = activeLicense;

            if (!is_active || type !== 'permanent') {
                return { success: false, status: 'LICENSE_REVOKED' };
            }

            // Permanente
            setIsPremium(true);

            // Guardar en cache offline
            localStorage.setItem('pda_license_cache', JSON.stringify({
                type,
                isActive: true,
                expiresAt: null,
                createdAt: activeLicense.created_at || new Date().toISOString(),
                deviceId,
                updatedAt: Date.now()
            }));

            return { success: true, status: 'PREMIUM_ACTIVATED' };

        } catch (err) {
            console.error('Error validating license:', err);
            return { success: false, status: 'SERVER_ERROR' };
        }
    };

    const generateCodeForClient = async () => null;

    /**
     * Fuerza un heartbeat manual para sincronizar cambios como el nombre del negocio de inmediato.
     */
    const forceHeartbeat = async () => {
        // Guard deviceBackend: si el backend no existe, se omite (evita 404).
        if (isDeviceBackendDown()) return;
        const bName = localStorage.getItem('business_name') || localStorage.getItem('restaurant_name') || '';
        const mEmail = localStorage.getItem('marketing_email') || '';
        const clientName = mEmail ? `${bName} | ${mEmail}` : bName;
        try {
            const { error: hbErr } = await supabase.rpc('heartbeat_device', {
                p_device_id: deviceId || localStorage.getItem('pda_device_id'),
                p_product_id: PRODUCT_ID,
                p_client_name: clientName
            });
            if (isBackendMissingError(hbErr)) {
                markDeviceBackendDown();
            } else {
                markDeviceBackendUp();
            }
        } catch(e) {
            if (isBackendMissingError(e)) markDeviceBackendDown();
            else console.error('Error forcing heartbeat:', e);
        }
    };

    return {
        deviceId,
        isPremium,
        loading,
        identityReady,
        identityError,
        unlockApp,
        generateCodeForClient,
        licenseExpiredMsg,
        dismissLicenseExpiredMsg,
        forceHeartbeat,
        integrityWarning,
        dismissIntegrityWarning: () => setIntegrityWarning(false),
    };
}

const SecurityContext = createContext(null);

export function SecurityProvider({ children }) {
    const value = useSecurityState();
    useEffect(() => {
        // AppRouter normalmente retira el splash; ante un fallo no llega a montar.
        if (value.identityError) document.getElementById('initial-splash-overlay')?.remove();
    }, [value.identityError]);
    // CloudGate/App no se montan hasta verificar una identidad persistida.
    // Una bandera premium o una sesión guardada no puede saltar este bloqueo.
    return (
        <SecurityContext.Provider value={value}>
            {value.identityError ? (
                <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50 text-slate-900">
                    <section role="alert" className="max-w-md rounded-2xl bg-white p-6 shadow">
                        <h1 className="text-xl font-bold mb-3">Identidad de instalación pendiente de revisión</h1>
                        <p>{value.identityError}</p>
                        <p className="mt-3 text-sm">No se cambió el ID ni se eliminaron datos. No reinstales ni fuerces la sincronización.</p>
                    </section>
                </main>
            ) : value.identityReady ? children : (
                <main className="min-h-screen flex items-center justify-center" role="status">Verificando identidad de instalación…</main>
            )}
        </SecurityContext.Provider>
    );
}

export function useSecurity() {
    const ctx = useContext(SecurityContext);
    if (!ctx) throw new Error('useSecurity debe usarse dentro de un SecurityProvider');
    return ctx;
}
