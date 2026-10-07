import React from 'react';
import { Composition } from 'remotion';
import { LogoAnimation } from './LogoAnimation';

export const RemotionRoot = () => {
    return (
        <>
            <Composition
                id="PreciosAlDiaLogoIntro"
                component={LogoAnimation}
                durationInFrames={150}
                fps={30}
                width={1080}
                height={1080}
                defaultProps={{
                    primaryColor: '#01696f',
                    accentColor: '#008080',
                    backgroundColor: '#FFFFFF',
                    title: 'PRECIOS AL DÍA',
                    subtitle: 'PUNTO DE VENTA & INVENTARIO',
                }}
            />
        </>
    );
};
