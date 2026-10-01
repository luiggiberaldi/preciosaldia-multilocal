import React, { useEffect, useRef } from 'react';
import CloseButton from './ui/CloseButton';

/**
 * Pila de modales abiertos (nivel módulo): solo el superior responde a Escape.
 * Evita que cerrar un modal anidado cierre también el de atrás.
 */
const openStack = [];

/**
 * Hook: comportamiento común de modales (M-27/M-28/M-29).
 * - Escape cierra (solo el modal superior de la pila).
 * - Bloquea el scroll del body mientras está abierto.
 * - Focus trap + foco inicial + retorno al elemento que abrió el modal.
 */
export function useModalBehavior(isOpen, onClose) {
  const panelRef = useRef(null);
  const openerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // M-28: scroll-lock del body.
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    openerRef.current = document.activeElement;
    const token = {};
    openStack.push(token);

    const focusables = () => {
      const root = panelRef.current;
      if (!root) return [];
      return [...root.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )].filter(el => !el.disabled && el.offsetParent !== null);
    };

    const onKey = (e) => {
      // Solo el modal superior de la pila maneja el teclado.
      if (openStack[openStack.length - 1] !== token) return;
      // M-27: Escape cierra.
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      // M-29: focus trap.
      if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    // M-29: foco inicial en el primer control del panel.
    const t = setTimeout(() => {
      const list = focusables();
      if (list.length > 0) list[0].focus({ preventScroll: true });
      else panelRef.current?.focus?.({ preventScroll: true });
    }, 60);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      clearTimeout(t);
      const i = openStack.indexOf(token);
      if (i >= 0) openStack.splice(i, 1);
      // M-29: retorno de foco al elemento que abrió el modal.
      try { openerRef.current?.focus?.({ preventScroll: true }); } catch {}
    };
  }, [isOpen]);

  return panelRef;
}

export const Modal = ({ isOpen, onClose, title, children, className = '', size = 'max-w-sm', disableClose = false }) => {
  // B-18 (2026-10-01): disableClose bloquea X, backdrop-click y Escape mientras
  // se envía una orden remota (evita cerrar a mitad del ack).
  const guardedClose = disableClose ? undefined : onClose;
  const panelRef = useModalBehavior(isOpen, guardedClose);
  if (!isOpen) return null;

  return (
    // ✅ z-[100] asegura que esté por encima de la barra de navegación (z-30)
    <div className="fixed inset-x-0 top-0 h-dvh z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">

      {/* Backdrop con desenfoque */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={guardedClose}
      />

      {/* Contenido del Modal */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || "Diálogo"}
        tabIndex={-1}
        className={`relative bg-white dark:bg-slate-900 w-full ${size} rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 transition-all ${className}`}
      >

        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
          <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">{title}</h3>
          {!disableClose && <CloseButton onClick={onClose} />}
        </div>

        {/* Body con Scroll Mejorado */}
        {/* ✅ CAMBIO: max-h-[85vh] para más espacio y pb-10 para margen inferior seguro */}
        <div className="p-6 max-h-[85dvh] overflow-y-auto custom-scrollbar pb-10">
          {children}
        </div>
      </div>
    </div>
  );
};
