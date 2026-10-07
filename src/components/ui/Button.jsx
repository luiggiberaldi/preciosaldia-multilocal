import { forwardRef } from 'react';

/**
 * Button — Primitiva de botón del design system.
 *
 * Usa las clases .btn-* de components.css que a su vez usan los tokens OKLCH.
 * Garantiza min-height 48px (touch target A11y) y focus visible.
 *
 * @param {object} props
 * @param {'primary'|'ghost'|'accent'|'danger'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'|'icon'} [props.size='md']
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
const variants = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  accent: 'btn-accent',
  danger: 'btn-danger',
};
const sizes = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
  icon: 'btn-icon',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className = '', children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={`btn ${variants[variant] || ''} ${sizes[size] || ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
});

export default Button;
