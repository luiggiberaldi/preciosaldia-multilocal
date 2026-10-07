import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Outfit';
import { LogoMark } from './LogoMark';

const { fontFamily } = loadFont('normal', {
    weights: ['800', '900'],
    subsets: ['latin'],
});

/**
 * LogoAnimation — Composición Remotion Auditada con Tipografía Outfit
 * Utiliza LogoMark.jsx para garantizar paridad visual 1:1 con la app.
 */
export const LogoAnimation = ({
    primaryColor = '#01696f',
    backgroundColor = '#FFFFFF',
    title = 'PRECIOS AL DÍA',
    subtitle = 'PUNTO DE VENTA & INVENTARIO',
}) => {
    const frame = useCurrentFrame();

    const progressD = interpolate(frame, [0, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const progressBar1 = interpolate(frame, [24, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const progressBar2 = interpolate(frame, [34, 56], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const progressArrow = interpolate(frame, [44, 68], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const progressTitle = interpolate(frame, [62, 86], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const progressSub = interpolate(frame, [76, 98], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const progressPulse = interpolate(frame, [100, 120, 140], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

    return (
        <AbsoluteFill>
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
                fontFamily={fontFamily}
            />
        </AbsoluteFill>
    );
};
