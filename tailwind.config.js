/** @type {import('tailwindcss').Config} */
// tailwind.config.js
//
// v1.2.0: Design system "Precios al Día" (OKLCH + Instrument Serif/Work Sans).
// Los colores se derivan de tokens.css (vars RGB separadas por espacios).
// slate-* ahora renderiza warm cream/oliva (H=85) en vez de gris cool (H=220).
// brand-* ahora renderiza cian/turquesa (H=192) en vez de azul.

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Soporta AMBOS selectores: .dark class (legacy) + [data-theme="dark"] (styleguide)
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Brand: cian/turquesa H=192 (antes azul)
        brand: {
          light: 'rgb(var(--color-primary-50) / <alpha-value>)',
          DEFAULT: 'rgb(var(--color-primary-500) / <alpha-value>)',
          dark: 'rgb(var(--color-primary-600) / <alpha-value>)',
        },
        // Accent: naranja/óxido H=55 (nuevo, para tasas y estados especiales)
        accent: {
          50: 'rgb(var(--color-accent-50) / <alpha-value>)',
          100: 'rgb(var(--color-accent-100) / <alpha-value>)',
          400: 'rgb(var(--color-accent-400) / <alpha-value>)',
          500: 'rgb(var(--color-accent-500) / <alpha-value>)',
          600: 'rgb(var(--color-accent-600) / <alpha-value>)',
          900: 'rgb(var(--color-accent-900) / <alpha-value>)',
        },
        background: {
          light: 'rgb(var(--color-bg-light) / <alpha-value>)',
          dark: 'rgb(var(--color-bg-dark) / <alpha-value>)',
        },
        // slate-* reapuntado: ahora es warm cream/oliva (H=85), no gris cool.
        // Los 2000+ clases slate-* existentes cambian de paleta automáticamente.
        slate: {
          50: 'rgb(var(--color-surface-50) / <alpha-value>)',
          100: 'rgb(var(--color-surface-100) / <alpha-value>)',
          200: 'rgb(var(--color-surface-200) / <alpha-value>)',
          300: 'rgb(var(--color-surface-300) / <alpha-value>)',
          400: 'rgb(var(--color-surface-400) / <alpha-value>)',
          500: 'rgb(var(--color-surface-500) / <alpha-value>)',
          600: 'rgb(var(--color-surface-600) / <alpha-value>)',
          700: 'rgb(var(--color-surface-700) / <alpha-value>)',
          800: 'rgb(var(--color-surface-800) / <alpha-value>)',
          900: 'rgb(var(--color-surface-900) / <alpha-value>)',
          950: 'rgb(var(--color-surface-950) / <alpha-value>)',
        },
        // Alias surface-* (nuevo namespace semántico, mismo valor que slate)
        surface: {
          DEFAULT: 'rgb(var(--color-surface-100) / <alpha-value>)',
          50: 'rgb(var(--color-surface-50) / <alpha-value>)',
          100: 'rgb(var(--color-surface-100) / <alpha-value>)',
          200: 'rgb(var(--color-surface-200) / <alpha-value>)',
          300: 'rgb(var(--color-surface-300) / <alpha-value>)',
          400: 'rgb(var(--color-surface-400) / <alpha-value>)',
          500: 'rgb(var(--color-surface-500) / <alpha-value>)',
          600: 'rgb(var(--color-surface-600) / <alpha-value>)',
          700: 'rgb(var(--color-surface-700) / <alpha-value>)',
          800: 'rgb(var(--color-surface-800) / <alpha-value>)',
          900: 'rgb(var(--color-surface-900) / <alpha-value>)',
          950: 'rgb(var(--color-surface-950) / <alpha-value>)',
        },
        // Status: ahora OKLCH-derived (más cálidos)
        emerald: {
          50: 'rgb(var(--color-success-50) / <alpha-value>)',
          100: 'rgb(var(--color-success-100) / <alpha-value>)',
          400: 'rgb(var(--color-success-400) / <alpha-value>)',
          500: 'rgb(var(--color-success-500) / <alpha-value>)',
          600: 'rgb(var(--color-success-600) / <alpha-value>)',
          900: 'rgb(var(--color-success-900) / <alpha-value>)',
        },
        red: {
          50: 'rgb(var(--color-danger-50) / <alpha-value>)',
          100: 'rgb(var(--color-danger-100) / <alpha-value>)',
          400: 'rgb(var(--color-danger-400) / <alpha-value>)',
          500: 'rgb(var(--color-danger-500) / <alpha-value>)',
          600: 'rgb(var(--color-danger-600) / <alpha-value>)',
          900: 'rgb(var(--color-danger-900) / <alpha-value>)',
        },
        amber: {
          50: 'rgb(var(--color-warning-50) / <alpha-value>)',
          100: 'rgb(var(--color-warning-100) / <alpha-value>)',
          400: 'rgb(var(--color-warning-400) / <alpha-value>)',
          500: 'rgb(var(--color-warning-500) / <alpha-value>)',
          600: 'rgb(var(--color-warning-600) / <alpha-value>)',
          900: 'rgb(var(--color-warning-900) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Work Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', '"Times New Roman"', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        outfit: ['"Outfit"', 'sans-serif'],
      },
      fontSize: {
        // Fluid typography via clamp()
        'fluid-xs': 'var(--text-xs)',
        'fluid-sm': 'var(--text-sm)',
        'fluid-base': 'var(--text-base)',
        'fluid-lg': 'var(--text-lg)',
        'fluid-xl': 'var(--text-xl)',
        'fluid-2xl': 'var(--text-2xl)',
        'fluid-display': 'var(--text-display)',
      },
      borderRadius: {
        'sm': 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        'lg': 'var(--radius-lg)',
        'xl': 'var(--radius-xl)',
      },
      boxShadow: {
        'tone-sm': 'var(--shadow-sm)',
        'tone-md': 'var(--shadow-md)',
        'tone-lg': 'var(--shadow-lg)',
        'primary': 'var(--shadow-primary)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        '200': '200ms',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
