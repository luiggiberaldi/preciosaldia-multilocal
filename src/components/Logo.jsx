import React from 'react';

/**
 * Icono Isotipo: "El Pulso del Mercado"
 * Representa la actividad financiera en tiempo real mediante un gráfico de pulso (ECG)
 * contenido dentro de un anillo circular (la moneda/mundo).
 */
export const LogoIcon = ({ className = "w-10 h-10" }) => {
  return (
    <svg 
      viewBox="0 0 64 64" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={`transition-transform duration-300 group-hover:scale-110 ${className}`}
      aria-label="Icono de pulso financiero"
    >
      {/* 1. EL ANILLO BASE (La Moneda)
        - Light Mode: Slate-900 (Oscuro para contraste fuerte)
        - Dark Mode: Slate-100 (Blanco para resaltar sobre fondo negro)
        Esto asegura que el anillo siempre sea visible y elegante.
      */}
      <circle 
        cx="32" cy="32" r="28" 
        stroke="currentColor" 
        strokeWidth="6" 
        className="text-slate-900 dark:text-slate-100 transition-colors duration-300"
      />

      {/* 2. EL PULSO (La Actividad)
        - Siempre usa el color 'brand' (Amarillo) para mantener identidad.
        - Entra por la izquierda, hace el pico (latido) y sigue.
      */}
      <path 
        d="M16 32H24L29 16L35 48L40 32H48" 
        stroke="currentColor" 
        strokeWidth="4" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className="text-brand drop-shadow-sm"
      />

      {/* 3. EL PUNTO ACTIVO (Live Status)
        - Indica que el dato es "de ahora".
      */}
      <circle 
        cx="48" cy="32" r="3" 
        className="fill-brand animate-pulse"
      />
    </svg>
  );
};

/**
 * Logotipo Completo (Icono + Texto)
 * Optimizado para la barra de navegación.
 */
export const LogoFull = ({ className = "" }) => {
  return (
    <div className={`flex items-center gap-3 group cursor-default ${className}`}>
      {/* El icono tiene su propio contenedor para alinear el hover */}
      <div className="relative flex items-center justify-center">
         <LogoIcon className="w-9 h-9" />
         {/* Un brillo sutil detrás del icono en hover */}
         <div className="absolute inset-0 bg-brand/20 rounded-full blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      </div>
      
      <div className="flex flex-col justify-center">
        {/* Título Principal */}
        <h1 className="text-xl font-black tracking-tighter leading-none text-slate-800 dark:text-white transition-colors duration-300">
          TasasAl<span className="text-brand inline-block group-hover:-translate-y-0.5 transition-transform duration-300">Día</span>
        </h1>
        {/* Subtítulo técnico */}
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 leading-none mt-0.5">
          Live Monitor
        </span>
      </div>
    </div>
  );
};
