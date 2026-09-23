import React from 'react';
import { StandaloneLogoAnimation } from './StandaloneLogoAnimation';

/**
 * SplashScreenPlayer — Componente Reutilizable de Splash Screen
 * 
 * Renderiza la animación del logo de Precios al Día a 60 FPS
 * en tiempo real para web, PWA o Electron.
 */
export default function SplashScreenPlayer({
    onComplete,
    loop = true,
    mode = 'full',
}) {
    return (
        <div className="w-full h-full flex items-center justify-center bg-white dark:bg-[#1a1917] overflow-hidden relative">
            <StandaloneLogoAnimation onComplete={onComplete} loop={loop} mode={mode} />
        </div>
    );
}
