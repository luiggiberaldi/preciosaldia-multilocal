# REBRAND-PLAN — Migración al Design System "Precios al Día"

> **Documento:** Plan completo de rebranding del POS `preciosaldia-bodega`
> **Baseline:** v1.1.0 (post-auditoría, 130 issues cerrados, 165 tests)
> **Target:** Design system OKLCH + Instrument Serif/Work Sans + dark mode nativo
> **Fecha:** 2026-03-30

---

## Tabla de contenidos

1. [Estado actual vs. target](#1-estado-actual-vs-target)
2. [Estrategia de migración](#2-estrategia-de-migración)
3. [Fase 0 — Foundation: design tokens](#fase-0--foundation-design-tokens)
4. [Fase 1 — Tailwind config + fonts](#fase-1--tailwind-config--fonts)
5. [Fase 2 — Primitivas UI nuevas](#fase-2--primitivas-ui-nuevas)
6. [Fase 3 — Migración de componentes existentes](#fase-3--migración-de-componentes-existentes)
7. [Fase 4 — Migración vista por vista](#fase-4--migración-vista-por-vista)
8. [Fase 5 — Dark mode nativo](#fase-5--dark-mode-nativo)
9. [Fase 6 — Animaciones reveal + accessibility](#fase-6--animaciones-reveal--accessibility)
10. [Fase 7 — Build, tests, verificación](#fase-7--build-tests-verificación)
11. [Inventario de archivos](#inventario-de-archivos)
12. [Riesgos y rollback](#riesgos-y-rollback)
13. [Timeline y esfuerzo](#timeline-y-esfuerzo)
14. [Criterios de aceptación](#criterios-de-aceptación)

---

## 1. Estado actual vs. target

### Estado actual (v1.1.0)

| Aspecto | Actual | Problema |
|---|---|---|
| **Color primario** | Azul (`#3b82f6` blue-500) en CSS vars, aunque comentarios dicen "verde" | Inconsistencia: `index.html` theme-color es `#10B981` (emerald) pero las vars son blue. Confusión de marca. |
| **Espacio de color** | RGB separado por espacios (`59 130 246`) para `rgb(var() / <alpha>)` | No OKLCH. No hay consistencia perceptual de luminosidad. |
| **Neutrals** | Slate (gris cool, H≈220) | Frío, industrial. El styleguide pide cream cálido (H=85 oliva). |
| **Texto** | `#1e293b` (slate-800, cool) | El styleguide pide marrón carbón cálido (H=60). |
| **Fuentes** | Inter (sans) + JetBrains Mono | El styleguide pide Instrument Serif (display) + Work Sans (body). |
| **Tipografía fluida** | Tamaños fijos (text-sm, text-lg) | No hay `clamp()`. No se adapta a viewport. |
| **Sombras** | `shadow-sm/md/lg` de Tailwind (negro `rgba(0,0,0,0.1)`) | No son tone-matched. Negro puro sobre cream se ve sucio. |
| **Dark mode** | `class` strategy con `html.dark` | Funciona pero el target usa `[data-theme="dark"]`. Reconciliar. |
| **Border radius** | Tailwind defaults (4/8/12/16px) | El styleguide pide 8/13.6/20/28/999px. |
| **Espaciado** | Tailwind defaults (4/8/12/16/24px) | El styleguide confirma base 4px — compatible. |
| **Animaciones** | `fade-in`, `slide-up`, `shimmer`, `shake` | Falta `reveal` con IntersectionObserver. |
| **Accesibilidad** | Parcial (algunos `aria-hidden`, `alt`) | Falta `prefers-reduced-motion` y 48px touch targets consistentes. |
| **Componentes** | 85 JSX con ~2000+ clases `slate-*`, 108 `dark:` variants | Migración clase-por-clase = inviable. Reapuntar vars = viable. |

### Target (del styleguide)

| Aspecto | Target |
|---|---|
| **Primario** | `oklch(0.50 0.085 192)` = `#01696f` (cian/turquesa) — light mode |
| **Primario dark** | `oklch(0.72 0.105 192)` = `#1ce2ee` (cian brillante) |
| **Background** | `oklch(0.985 0.010 85)` = `#fbfaf7` (cream cálido) — light |
| **Background dark** | `oklch(0.165 0.010 85)` = `#1a1917` (carbón cálido) |
| **Surface** | `oklch(0.965 0.014 85)` = `#f5f3ee` (tarjetas) |
| **Text** | `oklch(0.28 0.020 60)` = `#2c2924` (marrón carbón) |
| **Text muted** | `oklch(0.50 0.020 60)` = `#605c56` |
| **Border** | `oklch(0.89 0.018 85)` = `#e2dfd7` |
| **Accent** | `oklch(0.62 0.110 55)` = `#c16729` (naranja/óxido) |
| **Success** | `oklch(0.62 0.130 150)` = `#24a870` (verde menta) |
| **Warning** | `oklch(0.74 0.140 75)` = `#df9d1a` (amarillo oro) |
| **Display font** | "Instrument Serif", Georgia, serif (encabezados, itálicas editoriales) |
| **Body font** | "Work Sans", -apple-system, sans-serif |
| **Tipografía** | `clamp()` fluida en 7 escalas (xs → display) |
| **Radios** | 8 / 13.6 / 20 / 28 / 999px |
| **Sombras** | Tone-matched con marrón cálido (`oklch(0.28 0.02 60 / 0.04)`) |
| **Animaciones** | `reveal` con IntersectionObserver + stagger |
| **Dark mode** | `[data-theme="dark"]` + `prefers-color-scheme` |
| **A11y** | `prefers-reduced-motion`, 48px touch, semántica HTML5, WCAG AA |

---

## 2. Estrategia de migración

### Principio rector: "Reapuntar, no reescribir"

El sistema tiene **85 componentes con ~2000+ clases `slate-*`** y **108 variantes `dark:`**. Renombrar cada clase a un nuevo namespace (`surface-*`, `neutral-*`) sería un cambio de 2000+ líneas con alto riesgo de regresión visual.

**En su lugar, reapuntamos las variables CSS subyacentes:**

```
Antes:  --color-surface-400: 148 163 184   (slate-400, gris cool)
Después: --color-surface-400: 141 136 129   (oklch(0.68 0.015 60) → marrón cálido)

Clase Tailwind "text-slate-400" NO cambia en el JSX.
Pero ahora renderiza marrón cálido en vez de gris cool.
```

**Resultado:** toda la app cambia de paleta con **cero cambios en componentes**. Luego añadimos una capa nueva de primitivas OKLCH para componentes nuevos que quieran usar `color-mix()` y transiciones perceptuales.

### Tres capas de migración

| Capa | Riesgo | Esfuerzo | Impacto visual |
|---|---|---|---|
| **A. Repoint CSS vars** (slate→warm, blue→cian) | Bajo | 1 día | **Alto** — paleta global cambia |
| **B. Nuevas primitivas UI** (btn, card, modal con styleguide) | Medio | 3 días | Medio — componentes nuevos usan esto |
| **C. Migración incremental de vistas** (opt-in por vista) | Bajo | 5 días | Medio — pulido progresivo |

### Decisión técnica: OKLCH + Tailwind 3.4

Tailwind 3.4 usa `rgb(var(--x) / <alpha-value>)` que requiere vars en formato `R G B` separado por espacios. OKLCH no encaja ahí directamente.

**Solución híbrida:**
1. **Vars Tailwind** (`--color-surface-400: 141 136 129`): derivadas DE los valores OKLCH del styleguide, convertidas a RGB. Mantienen compatibilidad con `<alpha-value>`.
2. **Vars OKLCH puras** (`--primary: oklch(0.50 0.085 192)`): para uso directo en CSS custom (`color-mix()`, gradientes, sombras tone-matched).
3. **Fallback HEX** documentado en comentarios para navegadores sin soporte OKLCH (Chrome 111+, Safari 15.4+, Firefox 113+ — cobertura >95% en 2026).

No se migra a Tailwind 4 (sería un cambio disruptivo adicional; Tailwind 3.4 + vars híbridas cubre el 100% del styleguide).

### Dark mode: reconciliación

- **Actual:** `html.dark` class (Tailwind `darkMode: 'class'`).
- **Styleguide:** `[data-theme="dark"]`.
- **Decisión:** mantener `class` strategy (Tailwind lo soporta nativamente) PERO añadir también `data-theme` attribute en el `<html>` para que el CSS del styleguide funcione. El toggle de tema actualiza AMBOS.

---

## Fase 0 — Foundation: design tokens

**Objetivo:** crear la capa de tokens OKLCH + RGB derivados. Cero cambios visuales aún.

### Archivos a crear

#### `src/styles/tokens.css` (nuevo)

Contiene TODOS los tokens del styleguide en OKLCH puro + RGB derivados para Tailwind:

```css
:root {
  /* ── OKLCH puros (para CSS custom: color-mix, gradients, shadows) ── */
  /* Hue 192: Cian de marca / Turquesa Premium */
  --primary:           oklch(0.50 0.085 192);
  --primary-hover:     oklch(0.44 0.090 192);
  --primary-soft:      oklch(0.94 0.035 192);
  --primary-contrast:  oklch(0.99 0.005 192);

  /* Hue 85: Oliva / Cream cálido para fondos y superficies */
  --bg:                oklch(0.985 0.010 85);
  --surface:           oklch(0.965 0.014 85);
  --surface-2:         oklch(0.935 0.022 85);

  /* Hue 60: Marrón carbón cálido para textos */
  --text:              oklch(0.28 0.020 60);
  --text-muted:        oklch(0.50 0.020 60);
  --text-faint:        oklch(0.68 0.015 60);

  /* Bordes */
  --border:            oklch(0.89 0.018 85);
  --border-strong:     oklch(0.80 0.025 85);

  /* Status / Alertas */
  --accent:            oklch(0.62 0.110 55);   /* naranja/óxido */
  --success:           oklch(0.62 0.130 150);  /* verde menta */
  --warning:           oklch(0.74 0.140 75);   /* amarillo oro */
  --danger:            oklch(0.55 0.180 27);   /* rojo cálido */

  /* ── RGB derivados (para Tailwind rgb(var() / <alpha>)) ── */
  /* Convertidos desde OKLCH con @oklch-to-rgb. Comentario = fallback HEX. */
  /* Primary (H=192) */
  --color-primary-50:  230 244 245;   /* #e6f4f5 — primary-soft */
  --color-primary-100: 200 230 233;
  --color-primary-200: 165 215 218;
  --color-primary-300: 120 195 200;
  --color-primary-400: 70 170 178;
  --color-primary-500: 1 105 111;     /* #01696f — primary */
  --color-primary-600: 0 87 93;       /* #00575d — primary-hover */
  --color-primary-700: 0 73 78;
  --color-primary-800: 5 60 65;
  --color-primary-900: 7 50 54;

  /* Surface (H=85, oliva/cream) — reemplaza slate */
  --color-surface-50:  251 250 247;   /* #fbfaf7 — bg */
  --color-surface-100: 245 243 238;   /* #f5f3ee — surface */
  --color-surface-200: 237 234 226;   /* #edeae2 — surface-2 */
  --color-surface-300: 226 223 215;   /* #e2dfd7 — border */
  --color-surface-400: 141 136 129;   /* #8d8881 — text-faint */
  --color-surface-500: 96 92 86;      /* #605c56 — text-muted */
  --color-surface-600: 60 57 53;      /* #3c3935 */
  --color-surface-700: 44 41 36;      /* #2c2924 — text */
  --color-surface-800: 30 28 25;      /* #1e1c19 */
  --color-surface-900: 26 25 23;      /* #1a1917 — bg dark */
  --color-surface-950: 18 17 15;      /* #12110f */

  /* Success (verde menta H=150) */
  --color-success-50:  230 247 238;
  --color-success-100: 204 239 221;
  --color-success-400: 60 200 130;
  --color-success-500: 36 168 112;    /* #24a870 */
  --color-success-600: 28 140 95;
  --color-success-900: 18 70 48;

  /* Warning (amarillo oro H=75) */
  --color-warning-50:  252 244 226;
  --color-warning-100: 249 233 195;
  --color-warning-400: 240 175 40;
  --color-warning-500: 223 157 26;    /* #df9d1a */
  --color-warning-600: 195 135 20;
  --color-warning-900: 110 75 12;

  /* Danger (rojo cálido H=27) */
  --color-danger-50:  251 232 225;
  --color-danger-100: 247 205 190;
  --color-danger-400: 220 90 60;
  --color-danger-500: 200 65 40;
  --color-danger-600: 175 50 30;
  --color-danger-900: 95 28 18;

  /* Accent (naranja/óxido H=55) */
  --color-accent-400:  210 130 60;
  --color-accent-500:  193 103 41;    /* #c16729 */
  --color-accent-600:  170 85 30;

  /* ── Tipografía fluida (clamp) ── */
  --text-xs:      clamp(0.72rem, 0.70rem + 0.10vw, 0.80rem);
  --text-sm:      clamp(0.82rem, 0.78rem + 0.20vw, 0.94rem);
  --text-base:    clamp(0.95rem, 0.91rem + 0.20vw, 1.06rem);
  --text-lg:      clamp(1.12rem, 1.05rem + 0.35vw, 1.32rem);
  --text-xl:      clamp(1.35rem, 1.25rem + 0.50vw, 1.62rem);
  --text-2xl:     clamp(1.68rem, 1.50rem + 0.90vw, 2.18rem);
  --text-display: clamp(2.75rem, 2.05rem + 3.50vw, 5.25rem);

  /* ── Espaciado (base 4px, confirma Tailwind defaults) ── */
  --space-1: 0.25rem;  --space-2: 0.5rem;   --space-3: 0.75rem;
  --space-4: 1rem;     --space-5: 1.25rem;  --space-6: 1.5rem;
  --space-8: 2rem;     --space-10: 2.5rem;  --space-12: 3rem;
  --space-16: 4rem;    --space-24: 6rem;

  /* ── Radios ── */
  --radius-sm: 8px;
  --radius: 13.6px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-full: 999px;

  /* ── Sombras tone-matched (marrón cálido, no negro) ── */
  --shadow-sm:       0 2px 8px oklch(0.28 0.02 60 / 0.04);
  --shadow-md:       0 6px 16px oklch(0.28 0.02 60 / 0.06);
  --shadow-lg:       0 16px 32px oklch(0.28 0.02 60 / 0.09);
  --shadow-primary:  0 8px 24px oklch(0.50 0.085 192 / 0.20);

  /* ── Transiciones ── */
  --transition: 200ms cubic-bezier(0.16, 1, 0.3, 1);

  /* ── Fuentes ── */
  --font-display: "Instrument Serif", Georgia, "Times New Roman", serif;
  --font-sans: "Work Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

/* ── Dark mode: [data-theme="dark"] ── */
[data-theme="dark"] {
  --primary:           oklch(0.72 0.105 192);  /* #1ce2ee — cian brillante */
  --primary-hover:     oklch(0.68 0.100 192);
  --primary-soft:      oklch(0.25 0.040 192);
  --primary-contrast:  oklch(0.15 0.010 85);

  --bg:                oklch(0.165 0.010 85);  /* #1a1917 — carbón cálido */
  --surface:           oklch(0.25 0.012 85);   /* #2d2b28 */
  --surface-2:         oklch(0.20 0.010 85);   /* #22211f */
  --surface-3:         oklch(0.28 0.012 85);   /* #35332f — hover */

  --text:              oklch(0.94 0.010 85);   /* #f2f0ec */
  --text-muted:        oklch(0.68 0.015 85);   /* #97948e */
  --text-faint:        oklch(0.50 0.012 85);

  --border:            oklch(0.28 0.015 85);   /* #383633 */
  --border-strong:     oklch(0.38 0.018 85);

  /* RGB overrides para dark */
  --color-surface-50:  26 25 23;       /* bg dark */
  --color-surface-100: 45 43 40;       /* surface dark */
  --color-surface-200: 34 33 31;       /* surface-2 dark */
  --color-surface-300: 53 51 47;       /* border dark */
  --color-surface-400: 151 148 142;    /* text-muted dark */
  --color-surface-500: 120 117 112;
  --color-surface-600: 90 88 84;
  --color-surface-700: 242 240 236;    /* text dark (invertido) */
  --color-surface-800: 230 228 224;
  --color-surface-900: 250 249 246;
  --color-surface-950: 252 251 248;

  --color-primary-500: 28 226 238;     /* #1ce2ee — cian brillante dark */
  --color-primary-600: 20 200 210;

  /* Sombras dark: más profundas, sin tinte cálido */
  --shadow-sm: 0 2px 8px oklch(0 0 0 / 0.30);
  --shadow-md: 0 6px 16px oklch(0 0 0 / 0.40);
  --shadow-lg: 0 16px 32px oklch(0 0 0 / 0.50);
}

/* ── prefers-reduced-motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .reveal { opacity: 1; transform: none; }
}
```

#### `src/styles/animations.css` (nuevo)

```css
/* ── Reveal on scroll (IntersectionObserver) ── */
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 600ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 600ms cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.is-visible {
  opacity: 1;
  transform: none;
}
.reveal:nth-child(2) { transition-delay: 60ms; }
.reveal:nth-child(3) { transition-delay: 120ms; }
.reveal:nth-child(4) { transition-delay: 180ms; }
.reveal:nth-child(5) { transition-delay: 240ms; }
.reveal:nth-child(6) { transition-delay: 300ms; }

/* ── Skeleton shimmer (tone-matched) ── */
.skeleton {
  background: linear-gradient(90deg,
    oklch(0.89 0.018 85) 25%,
    oklch(0.965 0.014 85) 50%,
    oklch(0.89 0.018 85) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius);
}
[data-theme="dark"] .skeleton {
  background: linear-gradient(90deg,
    oklch(0.25 0.012 85) 25%,
    oklch(0.20 0.010 85) 50%,
    oklch(0.25 0.012 85) 75%);
  background-size: 200% 100%;
}

/* ── Scrollbar tone-matched ── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: oklch(0.80 0.025 85);
  border-radius: var(--radius-full);
}
[data-theme="dark"] ::-webkit-scrollbar-thumb {
  background: oklch(0.38 0.018 85);
}
```

#### `src/hooks/useReveal.js` (nuevo)

Hook que aplica IntersectionObserver a elementos `.reveal`:

```js
import { useEffect, useRef } from 'react';

/**
 * useReveal — hook para animación reveal-on-scroll.
 * Retorna un ref a attachar al contenedor padre. Todos los `.reveal`
 * hijos se animan al entrar al viewport.
 *
 * @param {{ threshold?: number, rootMargin?: string, once?: boolean }} [opts]
 * @returns {React.RefObject}
 */
export function useReveal(opts = {}) {
  const ref = useRef(null);
  const { threshold = 0.12, rootMargin = '0px 0px -40px 0px', once = true } = opts;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reveals = root.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
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
    reveals.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return ref;
}
```

### Archivos a modificar

#### `src/index.css` — reescritura completa

- Eliminar las vars antiguas (azul/slate cool).
- Importar `./styles/tokens.css` y `./styles/animations.css`.
- Actualizar `html, body` para usar las nuevas vars y `--font-sans: Work Sans`.
- Migrar `html.dark` → `[data-theme="dark"]` (mantener `.dark` como alias para compat Tailwind).

#### `src/main.jsx` — añadir tema inicial

Cargar `data-theme` desde localStorage antes del render (evita FOUC):

```js
// Antes de createRoot:
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
if (savedTheme === 'dark') document.documentElement.classList.add('dark');
```

---

## Fase 1 — Tailwind config + fonts

**Objetivo:** exponer los nuevos tokens a Tailwind para que `bg-brand`, `text-surface-*`, `font-display`, `shadow-tone-md` funcionen.

### `tailwind.config.js` — actualizar

```js
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ['class', '[data-theme="dark"]'],  // ambos selectores
  theme: {
    extend: {
      colors: {
        // brand apunta a --color-primary-* (ahora cian H=192)
        brand: {
          light: 'rgb(var(--color-primary-50) / <alpha-value>)',
          DEFAULT: 'rgb(var(--color-primary-500) / <alpha-value>)',
          dark: 'rgb(var(--color-primary-600) / <alpha-value>)',
        },
        // surface-* ahora es warm cream/oliva (H=85)
        surface: {
          50: 'rgb(var(--color-surface-50) / <alpha-value>)',
          // ... 100-950
        },
        // Mantener alias slate→surface para compat con 2000+ clases existentes
        slate: {
          50: 'rgb(var(--color-surface-50) / <alpha-value>)',
          100: 'rgb(var(--color-surface-100) / <alpha-value>)',
          // ... idéntico a surface
        },
        emerald: { /* → success */ },
        red: { /* → danger */ },
        amber: { /* → warning */ },
        accent: { /* nuevo: naranja/óxido */ },
      },
      fontFamily: {
        sans: ['"Work Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
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
        'sm': 'var(--radius-sm)',     // 8px
        DEFAULT: 'var(--radius)',      // 13.6px
        'lg': 'var(--radius-lg)',      // 20px
        'xl': 'var(--radius-xl)',      // 28px
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
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        // reveal se maneja via CSS class, no animation
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
};
```

### `index.html` — actualizar fonts y meta

```html
<!-- Cambiar fonts: Inter+JetBrains → Instrument Serif + Work Sans + JetBrains Mono -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">

<!-- theme-color: cian H=192 (#01696f) en vez de emerald -->
<meta name="theme-color" content="#01696f" />
<meta name="color-scheme" content="light dark" />

<!-- script anti-FOUC: aplicar tema antes del render -->
<script>
  (function() {
    var t = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', t);
    if (t === 'dark') document.documentElement.classList.add('dark');
  })();
</script>

<!-- body: usar font-sans de Work Sans, bg-surface-50 (cream), text-surface-700 (marrón) -->
<body class="bg-surface-50 dark:bg-surface-900 text-surface-700 dark:text-surface-100 font-sans transition-colors duration-300">
```

### `src/App.jsx` — actualizar toggle de tema

El toggle actual usa `classList.add('dark')`. Actualizar para también setear `data-theme`:

```js
useEffect(() => {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
  }
  localStorage.setItem('theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#1a1917' : '#01696f');
}, [theme]);
```

---

## Fase 2 — Primitivas UI nuevas

**Objetivo:** crear componentes reutilizables que encapsulan el styleguide. Los componentes nuevos los usan; los viejos se migran en Fase 3.

### Archivos a crear

#### `src/components/ui/Button.jsx` (nuevo)

```jsx
import { forwardRef } from 'react';

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
};

export const Button = forwardRef(({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => (
  <button ref={ref} className={`btn ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
    {children}
  </button>
));
Button.displayName = 'Button';
```

#### `src/components/ui/Card.jsx` (nuevo)

```jsx
export function Card({ className = '', children, ...props }) {
  return <article className={`card reveal ${className}`} {...props}>{children}</article>;
}
export function CardIcon({ icon: Icon }) {
  return (
    <div className="card-icon">
      <Icon size={22} aria-hidden="true" />
    </div>
  );
}
```

#### `src/styles/components.css` (nuevo)

Clases del styleguide (btn, card, etc.) usando los tokens:

```css
/* ── Buttons ── */
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--space-2);
  font-family: var(--font-sans); font-size: var(--text-sm); font-weight: 600;
  padding: 12px 24px; border-radius: var(--radius); border: none; cursor: pointer;
  transition: background var(--transition), transform var(--transition), box-shadow var(--transition);
  min-height: 48px; text-decoration: none;
}
.btn-primary { background: var(--primary); color: var(--primary-contrast); }
.btn-primary:hover { background: var(--primary-hover); box-shadow: var(--shadow-primary); }
.btn-primary:active { transform: translateY(1px); }
.btn-ghost { background: transparent; color: var(--primary); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--primary-soft); border-color: var(--primary); }
.btn-ghost:active { transform: translateY(1px); }
.btn-accent { background: var(--accent); color: var(--primary-contrast); }
.btn-danger { background: var(--danger); color: var(--primary-contrast); }
.btn-sm { padding: 8px 16px; min-height: 40px; font-size: var(--text-xs); }
.btn-lg { padding: 16px 32px; min-height: 56px; font-size: var(--text-base); }

/* ── Card ── */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition), box-shadow var(--transition), border-color var(--transition);
}
.card:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); border-color: var(--primary); }
.card-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: var(--primary-soft); color: var(--primary);
  display: grid; place-items: center; margin-bottom: var(--space-4);
}
.card h3 { font-family: var(--font-sans); font-weight: 600; font-size: var(--text-lg); margin-bottom: var(--space-2); }
.card p { color: var(--text-muted); font-size: var(--text-sm); line-height: 1.5; }

/* ── Inputs ── */
.input {
  width: 100%; padding: 12px 16px;
  font-family: var(--font-sans); font-size: var(--text-base);
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  transition: border-color var(--transition), box-shadow var(--transition);
  min-height: 48px;
}
.input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.input::placeholder { color: var(--text-faint); }

/* ── Badge / Pill ── */
.badge {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: 4px 12px; border-radius: var(--radius-full);
  font-size: var(--text-xs); font-weight: 600;
  background: var(--primary-soft); color: var(--primary);
}
.badge-success { background: oklch(0.94 0.04 150); color: var(--success); }
.badge-warning { background: oklch(0.94 0.04 75); color: var(--warning); }
.badge-danger { background: oklch(0.94 0.04 27); color: var(--danger); }

/* ── Display headings (Instrument Serif) ── */
.display { font-family: var(--font-display); font-weight: 400; }
.display-italic { font-family: var(--font-display); font-style: italic; font-weight: 400; }
```

Importar en `index.css`:
```css
@import './styles/tokens.css';
@import './styles/animations.css';
@import './styles/components.css';
@tailwind base;
@tailwind components;
@tailwind utilities;
```

---

## Fase 3 — Migración de componentes existentes

**Objetivo:** los 85 componentes existentes adoptan la nueva paleta SIN cambios de código (gracias al reapuntado de vars). Solo se migran a primitivas nuevas los componentes clave.

### 3.1 — Migración automática (zero code change)

Estos cambios son **invisibles para el código** porque solo reapuntan vars:

| Clase Tailwind | Antes (RGB) | Después (RGB OKLCH-derived) | Efecto visual |
|---|---|---|---|
| `bg-slate-50` | `248 250 252` (cool) | `251 250 247` (cream) | Fondo crema cálido |
| `bg-slate-800` | `30 41 59` (slate dark) | `30 28 25` (carbón cálido) | Dark mode cálido |
| `bg-slate-900` | `15 23 42` | `26 25 23` | Dark bg cálido |
| `text-slate-400` | `148 163 184` (cool gray) | `141 136 129` (marrón claro) | Texto tenue cálido |
| `text-slate-500` | `100 116 139` | `96 92 86` | Texto muted cálido |
| `text-slate-700` | `51 65 85` | `44 41 36` | Texto principal marrón |
| `bg-brand` | `59 130 246` (azul) | `1 105 111` (cian) | Botones cian/turquesa |
| `bg-emerald-500` | `16 185 129` | `36 168 112` | Verde menta (más cálido) |

**Resultado:** los 565 `text-slate-400`, 293 `bg-slate-800`, etc. cambian de paleta automáticamente.

### 3.2 — Limpieza de residuos blue/indigo

A pesar de que el Agente D eliminó los aliases `blue`/`purple`/`indigo` del config, hay usos directos de las clases nativas de Tailwind que NO se eliminaron (porque no eran aliases, eran clases reales):

```
62 text-blue-500      → reemplazar por text-brand
44 bg-blue-900        → reemplazar por bg-brand dark / bg-surface-800
58 bg-indigo-900      → reemplazar por bg-brand dark
49 text-indigo-400    → reemplazar por text-brand
46 text-blue-400      → reemplazar por text-brand
40 text-indigo-500    → reemplazar por text-brand
```

**Script de migración:** `scripts/rebrand-colors.sh` (sed masivo):

```bash
#!/bin/bash
# Reemplaza clases blue/indigo nativas por brand
find src/ -name "*.jsx" -exec sed -i \
  -e 's/\bbg-blue-900\b/bg-surface-800/g' \
  -e 's/\btext-blue-400\b/text-brand/g' \
  -e 's/\btext-blue-500\b/text-brand/g' \
  -e 's/\bbg-indigo-900\b/bg-surface-800/g' \
  -e 's/\btext-indigo-400\b/text-brand/g' \
  -e 's/\btext-indigo-500\b/text-brand/g' \
  {} \;
```

Después ejecutar `bun run lint:fix` para limpiar imports huérfanos.

### 3.3 — Migración de fuentes (display headings)

Los encabezados clave (h1, h2 de landing/login) migran a `font-display` (Instrument Serif). Los body/ui siguen `font-sans` (Work Sans).

**Criterio:** solo encabezados principales de vistas públicas/landing. NO migrar encabezados de POS operativo (densidad informativa > estética).

Archivos a tocar (selectivo):
- `src/components/Logo.jsx` — tagline en serif italic
- `src/views/ResetPasswordView.jsx` — título
- `src/components/TermsOverlay.jsx` — títulos de secciones
- `src/components/OnboardingOverlay.jsx` — títulos
- `src/components/SpotlightTour.jsx` — tooltips

### 3.4 — Migración de componentes clave a primitivas

Solo los componentes más visibles migran a las primitivas `Button`/`Card` de Fase 2 (los demás quedan con clases Tailwind reapuntadas):

- `src/components/Modal.jsx` → usar `--radius-lg`, `--shadow-lg`, `--surface`
- `src/components/ConfirmModal.jsx` → usar `<Button variant="primary">`
- `src/components/EmptyState.jsx` → usar `<Card>`
- `src/components/Skeleton.jsx` → ya usa `.skeleton` (auto-migrado)
- `src/components/Toast.jsx` → usar `--radius-full`, tone shadows

---

## Fase 4 — Migración vista por vista

**Objetivo:** pulido visual opt-in por vista. Cada vista puede migrarse independientemente. Orden por visibilidad/impacto.

### Priorización (de mayor a menor impacto visual)

| Prioridad | Vista | Cambios clave | Esfuerzo |
|---|---|---|---|
| P0 | `ResetPasswordView` | Es la pantalla de login pública. Display serif, fondo cream, botón primary cian. | S |
| P0 | `TermsOverlay` | Modal de términos (first-run). Display serif para títulos. | S |
| P0 | `OnboardingOverlay` | Tour inicial. Cards con reveal animation. | M |
| P1 | `DashboardView` | Cards de stats con tone shadows, `font-display` en totales. | M |
| P1 | `SalesView` | Header con brand cian, cart panel con surface-2. | M |
| P2 | `ProductsView` | Grid de ProductCard con hover lift. | M |
| P2 | `ReportsView` | Charts con accent color, tablas con border warm. | S |
| P3 | `CustomersView` | Lista con tone shadows. | S |
| P3 | `SettingsView` | Tabs con border-strong, inputs con focus ring cian. | S |
| P4 | `CalculatorView` | Display serif en resultado. | S |
| P4 | `TesterView` | Solo dev. Baja prioridad. | XS |

### Plantilla de migración por vista

Cada vista sigue este checklist:
1. Añadir `const revealRef = useReveal();` y `ref={revealRef}` al contenedor.
2. Añadir clase `reveal` a cards/secciones principales.
3. Reemplazar `font-bold`/`font-black` en h1/h2 por `font-display` donde aplique.
4. Verificar contraste: texto `text-surface-700` sobre `bg-surface-50` (debe pasar WCAG AA).
5. Verificar touch targets: botones ≥ 48px (`min-h-[48px]` o `btn` class).
6. Testar dark mode: `data-theme="dark"` en `<html>`.
7. Testar `prefers-reduced-motion`: animaciones se desactivan.

---

## Fase 5 — Dark mode nativo

**Objetivo:** dark mode funcione con `[data-theme="dark"]` + `prefers-color-scheme`.

### Cambios

1. **`src/App.jsx`** — toggle actualiza AMBOS `class` y `data-theme` (ver Fase 1).
2. **`src/main.jsx`** — script anti-FOUC (ver Fase 1).
3. **`tailwind.config.js`** — `darkMode: ['class', '[data-theme="dark"]']` (soporta ambos selectores).
4. **`src/hooks/useAutoLock.js`** — no cambios (no toca DOM de tema).
5. **CSS** — `[data-theme="dark"]` overridea las vars (ver `tokens.css`).
6. **`prefers-color-scheme`** — añadir media query que respete el sistema si no hay preferencia guardada:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* aplicar vars dark automáticamente si el usuario no ha elegido light */
  }
}
```

### Validación

- Toggle manual: click en theme-toggle → cambia `data-theme` y `class`.
- Recarga: tema persiste (localStorage).
- Sistema: cambiar OS a dark → app sigue si no hay preferencia guardada.
- `prefers-reduced-motion`: animations se desactivan.

---

## Fase 6 — Animaciones reveal + accessibility

### Reveal animation

1. `src/hooks/useReveal.js` creado en Fase 0.
2. Aplicar a vistas en Fase 4 (P0 primero).
3. Stagger automático vía `:nth-child` en CSS.

### Accessibility checklist (WCAG AA)

| Criterio | Implementación | Verificación |
|---|---|---|
| **Contraste texto** | `--text` sobre `--bg` = 7.2:1 (AAA) | axe DevTools |
| **Contraste muted** | `--text-muted` sobre `--surface` = 4.8:1 (AA) | axe DevTools |
| **Touch targets** | `.btn` min-height 48px | Manual: medir en mobile |
| **Focus visible** | `.input:focus` ring 3px `--primary-soft` | Tab navigation |
| **Reduced motion** | `@media (prefers-reduced-motion)` | OS setting toggle |
| **Semantic HTML** | `<main>`, `<header>`, `<article>` | Lighthouse |
| **Alt text** | Todas las imágenes con `alt=""` | Lighthouse |
| **aria-hidden** | Íconos decorativos | Manual review |

---

## Fase 7 — Build, tests, verificación

### Tests visuales

No hay tests visuales automatizados (requieren Playwright/Chromatic, fuera de scope). En su lugar:

1. **Storybook mínimo** (opcional): crear `src/stories/` con 1 story por primitiva (`Button`, `Card`, `Input`).
2. **Manual visual QA:** checklist por vista en desktop + mobile + dark.
3. **Lighthouse:** correr en `dist/` build, target ≥ 90 en Performance/Accessibility/Best Practices.

### Tests unitarios

- `tests/dinero.test.js`, `tests/financialEngine.test.js`, etc. NO se ven afectados (lógica pura).
- Añadir `tests/useReveal.test.js` — verifica que el hook añade `is-visible` a elementos en viewport (mock IntersectionObserver).

### Build

```bash
bun run build
# Verificar:
# - No errores de compilación
# - dist/index.html incluye fonts de Google (Instrument Serif, Work Sans)
# - dist/assets/*.css incluye oklch() y clamp()
# - PWA manifest theme-color = #01696f
```

### Lint

```bash
bun run lint
# Debe mantener 0 errores nuevos (los 5 del React Compiler v7 son preexistentes)
```

---

## Inventario de archivos

### Archivos nuevos (crear)

| Archivo | Propósito | Fase |
|---|---|---|
| `src/styles/tokens.css` | OKLCH + RGB derivados + tipografía fluida + radii + shadows | 0 |
| `src/styles/animations.css` | reveal, skeleton, scrollbar tone-matched | 0 |
| `src/styles/components.css` | .btn, .card, .input, .badge, .display | 2 |
| `src/hooks/useReveal.js` | IntersectionObserver hook | 0 |
| `src/components/ui/Button.jsx` | Primitiva botón | 2 |
| `src/components/ui/Card.jsx` | Primitiva tarjeta | 2 |
| `src/components/ui/Input.jsx` | Primitiva input | 2 |
| `scripts/rebrand-colors.sh` | Sed masivo blue/indigo → brand | 3 |

### Archivos a modificar

| Archivo | Cambios | Fase |
|---|---|---|
| `src/index.css` | Reescritura: import tokens/animations/components, eliminar vars viejas | 0 |
| `tailwind.config.js` | Exponer nuevos tokens, fontFamily, fontSize fluid, borderRadius, boxShadow | 1 |
| `index.html` | Fonts (Instrument Serif + Work Sans), theme-color #01696f, anti-FOUC script, body classes | 1 |
| `src/main.jsx` | Anti-FOUC theme init antes de render | 1 |
| `src/App.jsx` | Toggle tema actualiza `data-theme` + `class` | 1 |
| 85 componentes `.jsx` | **Zero cambios** (reapuntado de vars) — excepto limpieza blue/indigo (Fase 3.2) | 3 |
| ~12 vistas `.jsx` | Migración opt-in a `font-display`, `reveal`, primitivas | 4 |

### Archivos a eliminar

Ninguno. Los archivos antiguos (`index.css` viejo) se reescriben in-place.

---

## Riesgos y rollback

### Riesgos identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **OKLCH no soportado en navegadores viejos** | Baja (Chrome 111+ = 95% coverage en 2026) | Medio — colores se ven mal | Fallbacks HEX en comentarios; `@supports` queries |
| **Slates reapuntados se ven mal en algún componente** | Media | Bajo — componente específico feo | Revisión vista-por-vista en Fase 4; ajustar vars puntuales |
| **Fonts de Google bloqueadas (offline-first PWA)** | Media | Medio — texto fallback a Georgia/sans | PWA runtime caching de fonts (ya en vite.config.js) |
| **Dark mode regressions** (108 `dark:` variants) | Media | Medio — modo oscuro roto | Test exhaustivo en Fase 5; mantener `.dark` alias |
| **Anti-FOUC script falla** | Baja | Bajo — flash de tema incorrecto | Script inline síncrono en `<head>` |
| **Tailwind purge elimina clases nuevas** | Baja | Alto — estilos desaparecen | `content` config ya incluye `./src/**/*.{js,jsx}` |

### Plan de rollback

1. **Git branch dedicada:** `feat/rebrand-design-system`. Todo el trabajo va ahí.
2. **Commit por fase:** si Fase 3 rompe algo, revertir solo ese commit.
3. **Feature flag** (opcional): `localStorage.setItem('rebrand_enabled', 'true')` para activar/desactivar el nuevo theme en producción sin redeploy.
4. **Rollback total:** `git revert` del branch merge. El `main` vuelve al estado pre-rebrand.

### Estrategia de deploy

1. **Staging:** deploy del branch `feat/rebrand` a un subdominio.
2. **QA visual:** 1 día de revisión manual (desktop + mobile + dark + reduced-motion).
3. **Merge gradual:** si hay regresiones, fix-forward en el branch antes de merge a `main`.
4. **Producción:** merge + deploy. Monitorear `console.error` en Sentry/analytics por 48h.

---

## Timeline y esfuerzo

### Estimación (1 desarrollador senior)

| Fase | Esfuerzo | Duración | Dependencias |
|---|---|---|---|
| **Fase 0** — Tokens | 1 día | Día 1 | Ninguna |
| **Fase 1** — Tailwind + fonts | 0.5 día | Día 1 | Fase 0 |
| **Fase 2** — Primitivas UI | 1.5 días | Día 2-3 | Fase 1 |
| **Fase 3** — Limpieza blue/indigo + sed | 0.5 día | Día 3 | Fase 1 |
| **Fase 4** — Migración vistas (P0+P1) | 2 días | Día 4-5 | Fase 2 |
| **Fase 4** — Migración vistas (P2-P4) | 1.5 días | Día 6-7 | Fase 4 P0-P1 |
| **Fase 5** — Dark mode | 0.5 día | Día 7 | Fase 1 |
| **Fase 6** — A11y + reveal | 0.5 día | Día 7 | Fase 4 |
| **Fase 7** — Build + tests + QA | 1 día | Día 8 | Todas |
| **Total** | **~8 días dev** | **8 días calendario** | |

### Aceleración con subagentes

Las Fases 0-1 son secuenciales (foundation). Las Fases 2-4 pueden paralelizarse con 2-3 subagentes:
- Agente 1: Fase 2 (primitivas) + Fase 3 (sed masivo)
- Agente 2: Fase 4 P0-P1 (vistas prioritarias)
- Agente 3: Fase 4 P2-P4 (vistas secundarias) + Fase 5 (dark mode)

**Con 3 agentes en paralelo: ~4 días calendario.**

---

## Criterios de aceptación

El rebrand se considera completo cuando:

### Visuales
- [ ] Paleta cream cálido (H=85) en fondos y superficies
- [ ] Color primario cian/turquesa (H=192, `#01696f`) en botones y acentos
- [ ] Texto marrón carbón (H=60) en vez de slate cool
- [ ] Instrument Serif en encabezados display de landing/login
- [ ] Work Sans en todo el body/UI
- [ ] Tipografía fluida con `clamp()` en al menos 7 escalas
- [ ] Sombras tone-matched (tinte marrón, no negro)
- [ ] Radios 8/13.6/20/28/999px consistentes

### Funcionales
- [ ] Dark mode funciona con toggle + `prefers-color-scheme` + persistencia
- [ ] `prefers-reduced-motion` desactiva animaciones
- [ ] Todos los botones ≥ 48px de altura
- [ ] Focus visible en inputs (ring cian 3px)
- [ ] Reveal animation en al menos vistas P0 (Onboarding, Terms, ResetPassword)

### Calidad
- [ ] `bun run build` sin errores
- [ ] `bun run test` — 165+ tests pasan (sin regresiones)
- [ ] `bun run lint` — 0 errores nuevos
- [ ] Lighthouse Accessibility ≥ 90 en `dist/`
- [ ] Sin clases `blue-*` o `indigo-*` nativas en `src/`
- [ ] `theme-color` meta = `#01696f` (light) / `#1a1917` (dark)

### Documentación
- [ ] `AGENT.md` actualizado con sección de design system
- [ ] `CHANGES.md` registra el rebrand como v1.2.0
- [ ] Worklog actualizado con `Task ID: REBRAND`

---

## Apéndice: conversión OKLCH → RGB

Los valores RGB en `tokens.css` se derivan de los OKLCH del styleguide. Para regenerar si cambian:

```js
// Usar la librería @csstools/convert-colors o culori
import { oklchToSrgb } from '@csstools/convert-colors';

// Ejemplo: --primary oklch(0.50 0.085 192)
const [r, g, b] = oklchToSrgb(0.50, 0.085, 192);
// → [1, 105, 111] → "1 105 111" → #01696f ✓
```

O usar el conversor online: https://oklch.com/

---

*Plan elaborado por el orquestador senior. Para ejecución, crear branch `feat/rebrand-design-system` y seguir las 7 fases en orden. Ver `AGENT.md` §5 para contexto de la infraestructura compartida existente que este plan extiende.*
