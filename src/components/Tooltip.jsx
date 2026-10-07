import React from 'react';

export default function Tooltip({ text, children, position = 'top', className = '' }) {
  // Distintas posiciones según a donde deba apuntar el globito
  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2'
  };

  // La flecha del tooltip
  const arrows = {
    top: 'top-full left-1/2 -translate-x-1/2 -mt-[5px] border-t-slate-800 dark:border-t-slate-700 border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 -mb-[5px] border-b-slate-800 dark:border-b-slate-700 border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 -ml-[5px] border-l-slate-800 dark:border-l-slate-700 border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 -mr-[5px] border-r-slate-800 dark:border-r-slate-700 border-y-transparent border-l-transparent'
  };

  return (
    <div className={`relative group items-center justify-center ${className || 'inline-flex'}`}>
      {children}
      {/* Caja envolvente del Tooltip */}
      <div 
        className={`absolute ${positions[position]} z-50 w-max max-w-[200px] pointer-events-none 
          opacity-0 scale-95 origin-bottom 
          group-hover:opacity-100 group-hover:scale-100 
          transition-all duration-200 delay-150 ease-out`}
      >
        <div className="bg-slate-800 dark:bg-slate-700 text-slate-100 text-[11px] font-medium leading-snug px-2.5 py-1.5 rounded-lg shadow-xl text-center">
          {text}
        </div>
        {/* Triangulito de la burbuja */}
        <div className={`absolute w-0 h-0 border-[6px] ${arrows[position]}`}></div>
      </div>
    </div>
  );
}
