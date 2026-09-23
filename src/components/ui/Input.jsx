import { forwardRef } from 'react';

/**
 * Input — Primitiva de input del design system.
 *
 * Usa .input de components.css (tokens OKLCH: surface, border, focus ring cian).
 * Garantiza min-height 48px (touch target A11y).
 *
 * @param {object} props
 * @param {boolean} [props.error=false] - Aplica estilo de error (border danger).
 * @param {string} [props.className]
 */
export const Input = forwardRef(function Input({ error = false, className = '', ...props }, ref) {
  const classes = ['input'];
  if (error) classes.push('input-error');
  if (className) classes.push(className);
  return <input ref={ref} className={classes.join(' ')} {...props} />;
});

export default Input;
