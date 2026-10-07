// tests/setup.js — Setup global para Vitest (jsdom).
// Provee polyfills mínimos para APIs del navegador usadas en tests.

// jsdom no implementa navigator.locks por defecto; lo mockeamos si falta.
if (!('locks' in navigator)) {
  const queues = new Map();
  Object.defineProperty(navigator, 'locks', {
    value: {
      request: async (name, _optsOrFn, fnMaybe) => {
        const fn = typeof _optsOrFn === 'function' ? _optsOrFn : fnMaybe;
        const prev = queues.get(name) ?? Promise.resolve();
        let resolve;
        const next = new Promise((r) => { resolve = r; });
        queues.set(name, prev.then(() => next));
        try {
          await prev;
          return await fn();
        } finally {
          resolve();
          if (queues.get(name) === next) queues.delete(name);
        }
      },
    },
    configurable: true,
  });
}

// crypto.subtle sí está en jsdom reciente (Node 20+), pero garantizamos crypto.randomUUID.
if (!globalThis.crypto?.randomUUID) {
  const { webcrypto } = require('node:crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// Silenciar console.warn/error en tests salvo que se esperen.
global.console = {
  ...console,
  warn: (...args) => { if (process.env.VITEST_VERBOSE) console.warn(...args); },
};
