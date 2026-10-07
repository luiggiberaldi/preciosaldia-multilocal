import React, { useId } from 'react';

/**
 * LogoMark — Componente Vectorial Unificado del Logo de Precios al Día.
 *
 * Consumido por:
 * 1. LogoAnimation (Remotion Studio / Video Render)
 * 2. StandaloneLogoAnimation (Reproductor Web / PWA a 60-120 Hz)
 */
export const LogoMark = ({
    primaryColor = '#01696f',
    backgroundColor = '#FFFFFF',
    title = 'PRECIOS AL DÍA',
    subtitle = 'PUNTO DE VENTA & INVENTARIO',
    // Progreso de animación (0 a 1 para cada capa)
    progressD = 1,
    progressBar1 = 1,
    progressBar2 = 1,
    progressArrow = 1,
    progressTitle = 1,
    progressSub = 1,
    progressPulse = 0,
    fontFamily = "'Outfit', 'Plus Jakarta Sans', system-ui, sans-serif",
}) => {
    const rawId = useId();
    // Sanitizar ID para evitar caracteres especiales en selectores SVG
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const tealGradId = `tealGrad_${safeId}`;
    const maskDId = `maskD_${safeId}`;

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const computedBg = backgroundColor === '#FFFFFF' && isDark ? '#1a1917' : backgroundColor;
    const computedSubColor = isDark ? '#94a3b8' : '#475569';

    // Curvas suavizadas de transformación
    const easeOutCubic = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
    const easeOutQuart = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

    const easedD = easeOutCubic(progressD);
    const outerOpacity = 0.4 + easedD * 0.6;
    const outerScale = 0.95 + easedD * 0.05;

    const bar1ScaleY = easeOutQuart(progressBar1);
    const bar2ScaleY = easeOutQuart(progressBar2);
    const arrowScaleY = easeOutQuart(progressArrow);
    const arrowOpacity = easeOutCubic(progressArrow);

    const titleOpacity = easeOutCubic(progressTitle);
    const titleTranslateY = (1 - titleOpacity) * 18;
    const titleBlur = (1 - titleOpacity) * 8;
    const titleTracking = 0.14 + (1 - titleOpacity) * 0.08;

    const subOpacity = easeOutCubic(progressSub);
    const subTranslateY = (1 - subOpacity) * 12;
    const subBlur = (1 - subOpacity) * 5;
    const subTracking = 0.28 + (1 - subOpacity) * 0.1;

    const pulseScale = 1 + Math.sin(progressPulse * Math.PI) * 0.025;
    const glowOpacity = Math.sin(progressPulse * Math.PI) * 0.18;

    return (
        <div
            style={{
                backgroundColor: computedBg,
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily,
                position: 'relative',
                overflow: 'hidden',
                padding: '16px',
                boxSizing: 'border-box',
            }}
        >
            {/* Resplandor Teal */}
            <div
                style={{
                    position: 'absolute',
                    width: '75%',
                    height: '75%',
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${primaryColor} 0%, transparent 70%)`,
                    opacity: glowOpacity,
                    transform: `scale(${pulseScale})`,
                    pointerEvents: 'none',
                }}
            />

            {/* Logo Vectorial Responsivo */}
            <div
                style={{
                    transform: `scale(${outerScale * pulseScale})`,
                    filter: 'drop-shadow(0px 8px 16px rgba(1, 105, 113, 0.15))',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    maxWidth: 'min(320px, 62vw)',
                    maxHeight: '45vh',
                }}
            >
                <svg
                    style={{
                        width: '100%',
                        height: 'auto',
                        maxHeight: '45vh',
                    }}
                    viewBox="0 0 500 500"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <defs>
                        <linearGradient id={tealGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#01696f" />
                            <stop offset="100%" stopColor="#004D53" />
                        </linearGradient>

                        <mask id={maskDId}>
                            <path
                                d="M 90 70 H 250 A 180 180 0 0 1 250 430 H 90 V 70 Z"
                                fill="none"
                                stroke="#FFFFFF"
                                strokeWidth="450"
                                pathLength="1"
                                strokeDasharray="1"
                                strokeDashoffset={1 - easedD}
                            />
                        </mask>
                    </defs>

                    {/* CAPA 1: Silueta "D" */}
                    <g opacity={outerOpacity}>
                        <path
                            d="M 90 70
                               H 250
                               A 180 180 0 0 1 250 430
                               H 90
                               V 70 Z
                               M 250 390
                               A 140 140 0 1 0 250 110
                               A 140 140 0 0 0 250 390 Z"
                            fill={`url(#${tealGradId})`}
                            fillRule="evenodd"
                            mask={`url(#${maskDId})`}
                        />
                    </g>

                    {/* CAPA 2: Barra 1 (Izquierda) */}
                    <g
                        style={{
                            transformOrigin: '186px 390px',
                            transform: `scaleY(${bar1ScaleY})`,
                        }}
                    >
                        <rect x="168" y="305" width="36" height="85" rx="3" fill={`url(#${tealGradId})`} />
                    </g>

                    {/* CAPA 3: Barra 2 (Centro) */}
                    <g
                        style={{
                            transformOrigin: '246px 390px',
                            transform: `scaleY(${bar2ScaleY})`,
                        }}
                    >
                        <rect x="228" y="225" width="36" height="165" rx="3" fill={`url(#${tealGradId})`} />
                    </g>

                    {/* CAPA 4: Flecha Principal (Derecha) */}
                    <g
                        style={{
                            transformOrigin: '306px 390px',
                            transform: `scaleY(${arrowScaleY})`,
                            opacity: arrowOpacity,
                        }}
                    >
                        <rect x="288" y="195" width="36" height="195" rx="3" fill={`url(#${tealGradId})`} />
                        <path d="M 306 128 L 352 205 H 260 Z" fill={`url(#${tealGradId})`} />
                    </g>
                </svg>
            </div>

            {/* Texto Institucional (Clamp + whiteSpace nowrap) */}
            <div
                style={{
                    marginTop: 'clamp(12px, 3vh, 24px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    width: '100%',
                    textAlign: 'center',
                }}
            >
                <h1
                    style={{
                        margin: 0,
                        fontSize: 'clamp(20px, 7.2vw, 36px)',
                        fontWeight: 900,
                        whiteSpace: 'nowrap',
                        letterSpacing: `${titleTracking}em`,
                        background: 'linear-gradient(135deg, #01696f 0%, #004D53 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        textTransform: 'uppercase',
                        opacity: titleOpacity,
                        transform: `translateY(${titleTranslateY}px) scale(${0.93 + titleOpacity * 0.07})`,
                        filter: `blur(${titleBlur}px) drop-shadow(0px 3px 10px rgba(1, 105, 113, 0.22))`,
                        lineHeight: 1.1,
                    }}
                >
                    {title}
                </h1>
                <p
                    style={{
                        margin: 0,
                        fontSize: 'clamp(9px, 2.8vw, 13px)',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        letterSpacing: `${subTracking}em`,
                        color: computedSubColor,
                        textTransform: 'uppercase',
                        opacity: subOpacity,
                        transform: `translateY(${subTranslateY}px)`,
                        filter: `blur(${subBlur}px)`,
                    }}
                >
                    {subtitle}
                </p>
            </div>
        </div>
    );
};
