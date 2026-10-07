// postcss.config.js
//
// ISSUES cubiertos:
// - INFRA-027: postcss-import añadido al array de plugins. Antes estaba
//   instalado como dependencia (devDependencies en package.json) pero no
//   registrado aquí, por lo que cualquier `@import` en CSS no se resolvía.

export default {
  plugins: {
    'postcss-import': {},   // INFRA-027: resolver @import en CSS antes de Tailwind.
    tailwindcss: {},
    autoprefixer: {},
  },
}
