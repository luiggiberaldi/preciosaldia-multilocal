import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook that manages the demo countdown timer.
 * Returns formatted time left and expiration message.
 *
 * HOOK-039: `onExpired` se guarda en ref para evitar stale closure dentro del
 * intervalo de 60s. Antes, el callback capturado era el del primer render y
 * nunca se actualizaba, causando que referencias a props/estado stale fueran
 * usadas al expirar.
 */
export function useDemoCountdown({ isDemo, demoExpiresAt, onExpired }) {
    const [demoTimeLeft, setDemoTimeLeft] = useState('');
    const [demoExpiredMsg, setDemoExpiredMsg] = useState('');

    // HOOK-039: ref al callback más reciente.
    const onExpiredRef = useRef(onExpired);
    useEffect(() => { onExpiredRef.current = onExpired; }, [onExpired]);

    // Calcular tiempo restante formateado
    const updateTimeLeft = useCallback((expiresAt) => {
        if (!expiresAt) { setDemoTimeLeft(''); return; }
        const diff = expiresAt - Date.now();
        if (diff <= 0) { setDemoTimeLeft(''); return; }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (days > 0) setDemoTimeLeft(`${days}d ${hours}h`);
        else if (hours > 0) setDemoTimeLeft(`${hours}h ${mins}m`);
        else setDemoTimeLeft(`${mins}m`);
    }, []);

    // Countdown timer para demo
    useEffect(() => {
        if (!isDemo || !demoExpiresAt) return;
        updateTimeLeft(demoExpiresAt);
        const interval = setInterval(() => {
            const diff = demoExpiresAt - Date.now();
            if (diff <= 0) {
                // Demo expiro en tiempo real
                clearInterval(interval);
                localStorage.removeItem('pda_premium_token');
                setDemoTimeLeft('');
                setDemoExpiredMsg("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
                // HOOK-039: invocar vía ref para obtener siempre el callback más reciente.
                if (typeof onExpiredRef.current === 'function') onExpiredRef.current();
            } else {
                updateTimeLeft(demoExpiresAt);
            }
        }, 60000); // Cada minuto
        return () => clearInterval(interval);
    }, [isDemo, demoExpiresAt, updateTimeLeft]);

    const dismissExpiredMsg = useCallback(() => setDemoExpiredMsg(''), []);

    return {
        demoTimeLeft,
        demoExpiredMsg,
        setDemoExpiredMsg,
        dismissExpiredMsg,
    };
}
