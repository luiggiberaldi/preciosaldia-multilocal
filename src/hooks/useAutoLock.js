import { useEffect, useCallback, useRef, useState } from 'react';
import { useAuthStore } from './store/useAuthStore';
import { logEvent } from '../services/auditService';
import { AUTOLOCK_POLICY } from '../utils/securityConstants';

/**
 * useAutoLock — Bloqueo automático de sesión por inactividad o minimizar la app.
 *
 * Fixes cubiertos:
 *   - SEC-004 / HOOK-001: Ya NO depende de `adminEmail/adminPassword` (vestigio de un
 *     flujo cloud email/password anterior). Ahora `isLoginRequired` se basa en
 *     `requireLogin && usuarioActivo` del store. `setAdminCredentials` se implementa
 *     en `useAuthStore` (sessionStorage).
 *   - SEC-015: Al volver de inactividad, NO basta con `logout()`; requerimos
 *     re-autenticación (PIN) vía `unlock(pin)`. Si el PIN falla, la sesión permanece
 *     bloqueada hasta que se ingrese el correcto (o se haga `logout()` manual).
 *     `usuarioActivo` se re-valida contra el store al desbloquear.
 *
 * El hook expone:
 *   - `manualLock()`: bloquea manualmente (e.g. botón "Bloquear").
 *   - `isLocked`: si la sesión está bloqueada por inactividad (esperando PIN).
 *
 * @module hooks/useAutoLock
 */
export function useAutoLock() {
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);
    const requireLogin = useAuthStore(s => s.requireLogin);
    const requireCajeroPin = useAuthStore(s => s.requireCajeroPin ?? true);
    const isCloudConfigured = useAuthStore(s => s.isCloudConfigured);
    const logout = useAuthStore(s => s.logout);
    const unlock = useAuthStore(s => s.unlock);
    const isCajeroNoPin = usuarioActivo?.rol === 'CAJERO' && requireCajeroPin === false;

    // SEC-004/HOOK-001: el auto-lock aplica cuando hay sesión activa y el login es requerido.
    // Si el usuario activo es Cajero y tiene deshabilitado el PIN, no requiere auto-lock.
    const isLoginRequired = Boolean(requireLogin && usuarioActivo && !isCajeroNoPin);
    // Si hay cloud, también aplicamos auto-lock para no-admin (antes solo ADMIN).
    // Si no hay cloud pero requireLogin=true, igual aplicamos (POS local con PIN).
    const timeoutRef = useRef(null);

    // Estado interno de "sesión bloqueada por inactividad" (SEC-015).
    // Lo mantenemos en un ref + state local para forzar re-render del caller.
    const [isLocked, setIsLocked] = useLockedState(false);

    const performLock = useCallback((reason = 'manual') => {
        if (!isLoginRequired) return; // Sin login requerido → no bloquear
        if (!usuarioActivo) return;

        logEvent('AUTH', 'SESION_BLOQUEADA', `Bloqueo de seguridad: ${reason}`, usuarioActivo);
        // SEC-015: no hacemos logout automático; marcamos como bloqueado.
        // El caller debe mostrar LockScreen y llamar a `unlock(pin)` para re-entrar.
        setIsLocked(true);
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, [usuarioActivo, isLoginRequired, setIsLocked]);

    const resetTimer = useCallback(() => {
        if (!isLoginRequired || !usuarioActivo) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            return;
        }
        // Si la sesión está bloqueada, no reiniciar el timer hasta que se desbloquee.
        if (isLocked) return;

        // Timeout más corto para ADMIN (politica más estricta).
        const isAdmin = usuarioActivo.rol === 'ADMIN';
        const defaultMs = isAdmin
            ? AUTOLOCK_POLICY.ADMIN_IDLE_TIMEOUT_MS
            : AUTOLOCK_POLICY.IDLE_TIMEOUT_MS;

        // Permitir override por config local (minutos). Mínimo 1 min.
        const minutesStr = (() => {
            try { return localStorage.getItem('admin_auto_lock_minutes') || ''; } catch { return ''; }
        })();
        const minutes = parseInt(minutesStr, 10);
        const ms = (isNaN(minutes) || minutes < 1) ? defaultMs : minutes * 60 * 1000;

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            performLock('inactividad');
        }, ms);
    }, [usuarioActivo, performLock, isLoginRequired, isLocked]);

    /**
     * SEC-015: Desbloquea tras re-validar el PIN contra el store.
     * @param {string} pin
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    const handleUnlock = useCallback(async (pin) => {
        const result = await unlock(pin);
        if (result?.success) {
            setIsLocked(false);
            // Re-validar usuarioActivo contra el store (debe seguir presente).
            const current = useAuthStore.getState().usuarioActivo;
            if (!current) {
                // Si por alguna razón no hay usuario activo, forzar logout.
                logout();
            }
        }
        return result;
    }, [unlock, logout, setIsLocked]);

    const manualLock = useCallback(() => performLock('manual'), [performLock]);

    useEffect(() => {
        if (!isLoginRequired || !usuarioActivo) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            return;
        }

        const events = ['mousedown', 'keydown', 'touchstart'];

        let debounceTimer = null;
        const debouncedResetTimer = () => {
            if (debounceTimer) return;
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                resetTimer();
            }, 2000);
        };

        events.forEach(e => window.addEventListener(e, debouncedResetTimer, { passive: true }));

        const handleVisibilityChange = () => {
            if (document.hidden) {
                // SEC-015: minimizar app → bloquear inmediatamente (no logout).
                if (AUTOLOCK_POLICY.BACKGROUND_LOCK_MS === 0) {
                    performLock('app_minimizada');
                } else {
                    setTimeout(() => {
                        if (document.hidden) performLock('app_minimizada');
                    }, AUTOLOCK_POLICY.BACKGROUND_LOCK_MS);
                }
            } else {
                resetTimer();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        resetTimer();

        return () => {
            events.forEach(e => window.removeEventListener(e, debouncedResetTimer));
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            if (debounceTimer) clearTimeout(debounceTimer);
        };
    }, [usuarioActivo, resetTimer, performLock]);

    return { manualLock, isLocked, unlock: handleUnlock };
}

/**
 * Hook mínimo para estado `isLocked` con ref + setter para evitar stale closures.
 */
function useLockedState(initial) {
    const [val, setVal] = useState(initial);
    const ref = useRef(val);
    const setter = useCallback((v) => {
        ref.current = v;
        setVal(v);
    }, []);
    return [val, setter, ref];
}
