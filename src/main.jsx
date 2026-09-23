import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ResetPasswordView from './views/ResetPasswordView.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { SecurityProvider } from './hooks/useSecurity.jsx'
import { supabaseCloud } from './config/supabaseCloud.js'
import { registerSW } from 'virtual:pwa-register'
import './index.css'

// ── Interceptor global de Fetch para Electron (protocolo file://) ──
if (window.location.protocol === 'file:') {
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      const baseUrl = import.meta.env.VITE_API_URL || 'https://preciosaldiaoficial.vercel.app';
      input = `${baseUrl}${input}`;
    }
    return originalFetch(input, init);
  };
}

// ── OFFLINE-IMG: pedir almacenamiento persistente ──
// Evita que el navegador purgue Cache Storage (imágenes de producto) e
// IndexedDB (datos) bajo presión de disco en equipos de gama baja.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => { /* denegado o no soportado: best-effort */ });
}

// ── Gestión del Service Worker y notificaciones de actualización (A-001/B-003) ──
// El registro del SW ocurre antes de montar React. Guardamos el estado en window
// además de emitir el evento para no perder la notificación cuando UpdateBanner
// todavía no instaló su listener.
const notifySwUpdateAvailable = () => {
  window.__pdaSwUpdateAvailable = true;
  window.dispatchEvent(new CustomEvent('sw-update-available'));
};

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    notifySwUpdateAvailable();
  },
  onOfflineReady() {
    console.log('[PWA] Aplicación lista para operar offline');
  },
  onRegistered(registration) {
    if (registration) {
      // Comprobar actualizaciones periódicamente (cada 30 min)
      setInterval(() => {
        registration.update().catch(() => {});
      }, 30 * 60 * 1000);
    }
  },
  onRegisterError(error) {
    console.error('[PWA] Error al registrar Service Worker:', error);
  }
});

window.__pdaUpdateSW = updateSW;

// ── Manejo global de chunks obsoletos tras nuevos despliegues en Vercel/PWA ──
window.addEventListener('vite:preloadError', (event) => {
  console.warn('[Vite] Error al precargar chunk dinámico (nueva versión desplegada). Recargando...', event);
  const lastReload = parseInt(sessionStorage.getItem('__pda_preload_reload') || '0', 10);
  if (Date.now() - lastReload > 8000) {
    sessionStorage.setItem('__pda_preload_reload', String(Date.now()));
    window.location.reload();
  }
});

window.addEventListener('error', (event) => {
  const msg = event?.message || '';
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  ) {
    const lastReload = parseInt(sessionStorage.getItem('__pda_uncaught_reload') || '0', 10);
    if (Date.now() - lastReload > 8000) {
      sessionStorage.setItem('__pda_uncaught_reload', String(Date.now()));
      console.warn('[App] Error de import dinámico detectado. Recargando para cargar la versión más reciente...');
      window.location.reload();
    }
  }
});

// ── Evitar que la rueda del mouse cambie valores en inputs numéricos ──
// HOOK-033: Antes este listener se registraba a nivel módulo (sin cleanup),
// lo que causaba:
//   1) En HMR, se acumulaban listeners en cada reload.
//   2) El listener sobrevivía al unmount del root en tests.
// Lo movemos dentro de `AppRouter` (useEffect) para que tenga cleanup correcto.
function _attachWheelGuard() {
  const handler = (e) => {
    if (e.target?.type === 'number') {
      e.target.blur();
      e.preventDefault();
    }
  };
  document.addEventListener('wheel', handler, { passive: false });
  return () => document.removeEventListener('wheel', handler);
}

// Detectar token de recuperación en la URL al cargar (antes de React)
function detectRecovery() {
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);
  return hash.includes('type=recovery') || params.has('code');
}

function AppRouter() {
  const [isRecovery, setIsRecovery] = useState(detectRecovery);

  // HOOK-033: wheel listener con cleanup correcto.
  useEffect(() => _attachWheelGuard(), []);

  // Retirar el splash nativo HTML en cuanto React se hidrata y monta en el DOM
  useEffect(() => {
    const initialSplash = document.getElementById('initial-splash-overlay');
    if (initialSplash) {
      initialSplash.style.opacity = '0';
      const timer = setTimeout(() => initialSplash.remove(), 250);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!supabaseCloud) return;
    const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (isRecovery) {
    return (
      <ResetPasswordView
        onDone={() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          setIsRecovery(false);
        }}
      />
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <SecurityProvider>
        <AppRouter />
      </SecurityProvider>
    </ToastProvider>
  </React.StrictMode>,
)

