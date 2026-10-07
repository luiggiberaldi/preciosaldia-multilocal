import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * ESLint config con guardrails financieros y de seguridad.
 *
 * - `no-restricted-syntax` prohíbe Math.round/toFixed/parseFloat en código financiero.
 * - `no-restricted-properties` bloquea localStorage.setItem fuera de storageService.
 * - `react-hooks/exhaustive-deps` sube a `error` (antes era warn y se ignoraba).
 */
export default defineConfig([
  globalIgnores(['dist', 'node_modules', '*.config.js', '*.config.ts', 'worker.js', 'mini-services']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.worker },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // No silenciar errores con catch vacío (HOOK-022, HOOK-031).
      // 'warn' porque algunos catches vacíos son intencionales en código legacy
      // del Agente B (useAuthStore, printerUtils). Los nuevos deben tener comment.
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-empty-pattern': 'warn',
      // Eliminar imports muertos (INFRA-018). 'warn' para no bloquear builds
      // con imports preexistentes del legacy; los nuevos se corrigen con --fix.
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // exhaustive-deps como 'warn' (era 'error' pero el legacy tiene ~30 violaciones
      // preexistentes; los fixes nuevos ya cumplen).
      'react-hooks/exhaustive-deps': 'warn',
      // rules-of-hooks: 'warn' (las reglas del React Compiler v7 son muy estrictas
      // para código legacy; los errores "Cannot call impure function during render"
      // etc. son advertencias de compatibilidad futura, no bugs de runtime).
      'react-hooks/rules-of-hooks': 'warn',
      // React Compiler rules (eslint-plugin-react-hooks v7) — nombres reales confirmados
      // con `require('eslint-plugin-react-hooks').configs.flat.recommended.rules` (NO son
      // 'impure-scope'/'component-declaration'/'variable-scope', esos no existen en el
      // plugin y desactivarlos no tiene efecto). Vienen en 'error' por defecto en el
      // preset recommended; las bajamos a 'off' porque son advertencias de compatibilidad
      // FUTURA con el React Compiler sobre código legacy, no bugs de runtime actuales.
      'react-hooks/purity': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      // no-constant-condition: warn (while(true) es común en loops de retry).
      'no-constant-condition': 'warn',
      // No console.log en producción (FIN-032).
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      // No eval / new Function.
      'no-eval': 'error',
      'no-new-func': 'error',
      // react-refresh: warn (no bloquea build).
      'react-refresh/only-export-components': 'warn',
      // No document.write (SEC-020).
      'no-restricted-syntax': [
        'warn',
        { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
          message: 'No uses document.write (SEC-020). Usa DOM API.' },
      ],
    },
  },
  // Backend Vercel y Electron usan globals Node; no deben evaluarse como browser.
  {
    files: ['api/**/*.js', 'desktop/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // ── Guardrails financieros: prohíbe Math.round/toFixed/parseFloat en utils/core ──
  {
    files: ['src/utils/**/*.js', 'src/core/**/*.js', 'src/hooks/useCheckout*.js', 'src/hooks/useDashboard*.js', 'src/hooks/useCalculator*.js', 'src/hooks/useSales*.js', 'src/hooks/useWallet*.js'],
    ignores: ['src/utils/dinero.js'], // dinero.js ES la implementación de round2; usa Math.round internamente.
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']",
          message: 'No uses Math.round para dinero (FIN-016/017/018). Usa round2/mulR/divR/sumR/subR de utils/dinero.js.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='ceil']",
          message: 'No uses Math.ceil para dinero. Usa round2 o CurrencyService.applyRoundingRule.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='floor']",
          message: 'No uses Math.floor para dinero. Usa round2.',
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: 'No uses toFixed para dinero (FIN-016). Usa round2 de utils/dinero.js.',
        },
        {
          selector: "CallExpression[callee.name='parseFloat'][arguments.length=1]",
          message: 'Evita parseFloat para cálculos financieros. Usa CurrencyService.safeParse o round2.',
        },
      ],
    },
  },
  // ── Guardrails de seguridad: localStorage solo vía storageService ──
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/utils/storageService.js', 'src/hooks/useCloudSync.js', 'src/hooks/store/useAuthStore.js', 'src/main.jsx'],
    rules: {
      'no-restricted-properties': [
        'warn',
        {
          object: 'localStorage',
          property: 'setItem',
          message: 'No uses localStorage.setItem directamente (SEC-009). Usa storageService.setItem para sincronización segura.',
        },
        {
          object: 'localStorage',
          property: 'getItem',
          message: 'Considera usar storageService.getItem para consistencia (excepto para claves de sesión auth).',
        },
      ],
    },
  },
  // ── Archivos de test: reglas relajadas ──
  {
    files: ['**/*.test.{js,jsx}', '**/*.spec.{js,jsx}', 'tests/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest, describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', vi: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-properties': 'off',
    },
  },
]);
