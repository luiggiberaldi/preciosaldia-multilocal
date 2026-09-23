/**
 * Card — Primitiva de tarjeta del design system.
 *
 * Usa .card de components.css (tokens OKLCH: surface, border, shadow-sm).
 * Opcionalmente añade .card-hover para lift on hover y .reveal para
 * animación on-scroll (usar junto a useReveal).
 *
 * @param {object} props
 * @param {boolean} [props.hover=true] - Activa lift on hover.
 * @param {boolean} [props.reveal=false] - Añade clase reveal (requiere useReveal en parent).
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export function Card({ hover = true, reveal = false, className = '', children, ...props }) {
  const classes = ['card'];
  if (hover) classes.push('card-hover');
  if (reveal) classes.push('reveal');
  if (className) classes.push(className);
  return (
    <article className={classes.join(' ')} {...props}>
      {children}
    </article>
  );
}

/**
 * CardIcon — Contenedor de ícono para tarjetas.
 * @param {object} props
 * @param {React.ComponentType<{size?: number, className?: string}>} props.icon - Componente de ícono (Lucide).
 * @param {number} [props.size=22]
 */
export function CardIcon({ icon: Icon, size = 22 }) {
  if (!Icon) return null;
  return (
    <div className="card-icon">
      <Icon size={size} aria-hidden="true" />
    </div>
  );
}

export default Card;
