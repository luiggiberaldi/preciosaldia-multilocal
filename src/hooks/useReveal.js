import { useEffect, useRef } from 'react';

/**
 * useReveal — hook para animación reveal-on-scroll.
 *
 * Retorna un ref a attachar al contenedor padre. Todos los elementos con
 * clase `.reveal` dentro del contenedor se animan (fade + translateY) al
 * entrar al viewport, con stagger automático vía :nth-child en CSS.
 *
 * Respeta prefers-reduced-motion (la animación se desactiva vía CSS).
 *
 * @param {{ threshold?: number, rootMargin?: string, once?: boolean }} [opts]
 * @returns {React.RefObject} Ref para attachar al contenedor.
 *
 * @example
 *   import { useReveal } from '../hooks/useReveal';
 *   function MyView() {
 *     const revealRef = useReveal();
 *     return (
 *       <div ref={revealRef}>
 *         <article className="card reveal">...</article>
 *         <article className="card reveal">...</article>
 *       </div>
 *     );
 *   }
 */
export function useReveal(opts = {}) {
  const ref = useRef(null);
  const { threshold = 0.12, rootMargin = '0px 0px -40px 0px', once = true } = opts;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // Fallback: si no hay IntersectionObserver, mostrar todo inmediatamente.
    if (!('IntersectionObserver' in window)) {
      const reveals = root.querySelectorAll('.reveal');
      reveals.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            entry.target.classList.remove('is-visible');
          }
        });
      },
      { threshold, rootMargin }
    );

    const observeNewElements = () => {
      const reveals = root.querySelectorAll('.reveal:not([data-reveal-observed])');
      reveals.forEach((el) => {
        el.setAttribute('data-reveal-observed', 'true');
        
        // Check inmediato: si el elemento ya está en el viewport, marcarlo visible ya.
        const rect = el.getBoundingClientRect();
        const inViewport = rect.top < window.innerHeight && rect.bottom > 0;
        if (inViewport) {
          el.classList.add('is-visible');
          if (once) return; // no necesita observarse
        }
        observer.observe(el);
      });
    };

    // Initial run
    observeNewElements();

    // Set up MutationObserver to watch for additions of .reveal elements
    const mutationObserver = new MutationObserver(() => {
      observeNewElements();
    });

    mutationObserver.observe(root, {
      childList: true,
      subtree: true
    });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [threshold, rootMargin, once]);

  return ref;
}

export default useReveal;
