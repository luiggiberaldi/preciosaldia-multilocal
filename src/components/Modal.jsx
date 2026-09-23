import React from 'react';
import CloseButton from './ui/CloseButton';

export const Modal = ({ isOpen, onClose, title, children, className = '', size = 'max-w-sm' }) => {
  if (!isOpen) return null;

  return (
    // ✅ z-[100] asegura que esté por encima de la barra de navegación (z-30)
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      
      {/* Backdrop con desenfoque */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      
      {/* Contenido del Modal */}
      <div 
        role="dialog"
        aria-modal="true"
        aria-label={title || "Diálogo"}
        className={`relative bg-white dark:bg-slate-900 w-full ${size} rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 transition-all ${className}`}
      >
        
        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
          <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">{title}</h3>
          <CloseButton onClick={onClose} />
        </div>

        {/* Body con Scroll Mejorado */}
        {/* ✅ CAMBIO: max-h-[85vh] para más espacio y pb-10 para margen inferior seguro */}
        <div className="p-6 max-h-[85vh] overflow-y-auto custom-scrollbar pb-10">
          {children}
        </div>
      </div>
    </div>
  );
};
