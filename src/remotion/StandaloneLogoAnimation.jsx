import React, { useState, useEffect, useRef } from 'react';
import { LogoMark } from './LogoMark';

/**
 * StandaloneLogoAnimation — Animación en tiempo real a 60-120 Hz
 *
 * Utiliza `LogoMark.jsx` unificado y maneja la cadencia continua de rAF.
 */
export const StandaloneLogoAnimation = ({
    primaryColor = '#01696f',
    backgroundColor = '#FFFFFF',
    title = 'PRECIOS AL DÍA',
    subtitle = 'PUNTO DE VENTA & INVENTARIO',
    onComplete,
    loop = true,
    mode = 'full', // 'full' (5.0s / 150 frames) | 'express' (1.5s / 45 frames)
}) => {
    const [frame, setFrame] = useState(0);
    const animRef = useRef(null);
    const startTimeRef = useRef(null);
    const onCompleteRef = useRef(onComplete);

    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    const isExpress = mode === 'express';
    const DURATION_FRAMES = isExpress ? 36 : 75;
    const FPS = 30;

    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    useEffect(() => {
        if (prefersReducedMotion) {
            setFrame(DURATION_FRAMES);
            if (onCompleteRef.current) onCompleteRef.current();
            return;
        }

        const animate = (timestamp) => {
            if (!startTimeRef.current) startTimeRef.current = timestamp;
            const elapsedSeconds = (timestamp - startTimeRef.current) / 1000;
            // Renderizado continuo sin Math.floor (Fix M1)
            let currentFrame = elapsedSeconds * FPS;

            if (currentFrame >= DURATION_FRAMES) {
                if (loop) {
                    startTimeRef.current = timestamp;
                    currentFrame = 0;
                } else {
                    currentFrame = DURATION_FRAMES;
                    setFrame(DURATION_FRAMES);
                    if (onCompleteRef.current) onCompleteRef.current();
                    return; // Detener rAF al completar (Fix A4)
                }
            }

            setFrame(currentFrame);
            animRef.current = requestAnimationFrame(animate);
        };

        animRef.current = requestAnimationFrame(animate);
        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current);
        };
    }, [loop, DURATION_FRAMES, prefersReducedMotion]);

    const clamp = (val, min = 0, max = 1) => Math.min(max, Math.max(min, val));

    // Cálculos de progreso calibrados (Full: 75f/2.5s | Express: 36f/1.2s)
    const progressD = clamp(frame / (isExpress ? 8 : 16));
    const progressBar1 = clamp((frame - (isExpress ? 6 : 14)) / (isExpress ? 8 : 14));
    const progressBar2 = clamp((frame - (isExpress ? 10 : 20)) / (isExpress ? 8 : 14));
    const progressArrow = clamp((frame - (isExpress ? 14 : 26)) / (isExpress ? 8 : 16));
    const progressTitle = clamp((frame - (isExpress ? 18 : 36)) / (isExpress ? 8 : 16));
    const progressSub = clamp((frame - (isExpress ? 22 : 44)) / (isExpress ? 8 : 14));
    const progressPulse = clamp((frame - (isExpress ? 26 : 52)) / (isExpress ? 8 : 18));

    return (
        <LogoMark
            primaryColor={primaryColor}
            backgroundColor={backgroundColor}
            title={title}
            subtitle={subtitle}
            progressD={progressD}
            progressBar1={progressBar1}
            progressBar2={progressBar2}
            progressArrow={progressArrow}
            progressTitle={progressTitle}
            progressSub={progressSub}
            progressPulse={progressPulse}
        />
    );
};
