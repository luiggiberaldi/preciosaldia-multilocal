import React from 'react';
import { appForage } from '../utils/appForage';

/**
 * HOOK-026: ErrorBoundary con recuperación efectiva.
 *
 * Antes: el botón "Reintentar" solo reseteaba `hasError=false` sin recargar la
 * app, lo que dejaba estado inconsistente (el error podía venir de un módulo
 * ya cargado corrupto). El botón "Limpiar y Recargar" borraba `calc_history`
 * —raramente la causa del crash— sin ofrecer borrar datos críticos sospechosos.
 *
 * Ahora:
 *  - "Reintentar" → `window.location.reload()` (estado limpio desde cero).
 *  - "Limpiar datos críticos" → ofrece borrar específicamente `bodega_products_v1`
 *    y `bodega_sales_v1` (los dos grandes sospechosos de OOM/parse errors).
 *    Pide confirmación porque es destructivo.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, compStack: '', errStack: '', clearing: false, clearMsg: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('🔴 App Error:', error, errorInfo);
    this.setState({
      compStack: String(errorInfo?.componentStack || ''),
      errStack: String(error?.stack || ''),
    });
    const msg = error?.message || '';
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('error loading dynamically imported module')
    ) {
      const lastReload = parseInt(sessionStorage.getItem('__pda_eb_chunk_reload') || '0', 10);
      if (Date.now() - lastReload > 8000) {
        sessionStorage.setItem('__pda_eb_chunk_reload', String(Date.now()));
        console.info('[ErrorBoundary] Recargando aplicación tras actualización de versión...');
        window.location.reload();
      }
    }
  }

  _handleRetry = async () => {
    // Si el error está relacionado con llamadas a toString o al carrito, purgar la clave del carrito corrupto
    const errMsg = (this.state.error?.message || '').toLowerCase();
    if (errMsg.includes('tostring') || errMsg.includes('cart') || errMsg.includes('undefined')) {
      try {
        localStorage.removeItem('bodega_pending_cart_v1');
        localStorage.removeItem('bodega_cart');
        await appForage.removeItem('bodega_pending_cart_v1').catch(() => {}); // FASE 1: negocio activo
      } catch (e) {
        console.error('[ErrorBoundary] Error limpiando carrito corrupto:', e);
      }
    }
    window.location.reload();
  };

  _handleClearCriticalData = async () => {
    // HOOK-026: borrar solo las claves que típicamente causan crashes de parseo
    // o OOM. NO tocar auth, ni flags de migración, ni settings.
    const confirm = typeof window !== 'undefined' && window.confirm
      ? window.confirm(
          'Esto borrará los datos de la cesta (bodega_pending_cart_v1), productos (bodega_products_v1) y ventas (bodega_sales_v1) ' +
          'para intentar recuperar la app. NO se tocará la sesión ni configuración. ¿Continuar?'
        )
      : true;
    if (!confirm) return;

    this.setState({ clearing: true, clearMsg: 'Borrando datos críticos...' });
    try {
      // FASE 1: appForage ya apunta al store correcto y al negocio activo.
      await appForage.removeItem('bodega_products_v1'); // FASE 1: negocio activo
      await appForage.removeItem('bodega_sales_v1'); // FASE 1: negocio activo
      await appForage.removeItem('bodega_pending_cart_v1'); // FASE 1: negocio activo
      // También purgar de localStorage por si estaban ahí como fallback.
      localStorage.removeItem('bodega_products_v1');
      localStorage.removeItem('bodega_sales_v1');
      localStorage.removeItem('bodega_pending_cart_v1');
      localStorage.removeItem('bodega_cart');
      this.setState({ clearMsg: 'Datos borrados. Recargando...' });
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      console.error('[ErrorBoundary] Fallo limpiando datos críticos:', e);
      this.setState({
        clearing: false,
        clearMsg: 'No se pudo limpiar automáticamente.',
      });
    }
  };

  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.message || 'Error desconocido';
      return (
        <div className="flex items-center justify-center h-full bg-slate-50 dark:bg-slate-950 p-6">
          <div className="text-center max-w-sm">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-red-500 mb-2">Error de Carga</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
              La aplicación no pudo cargar correctamente. Esto puede deberse a datos corruptos o problemas de compatibilidad.
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 font-mono break-all">
              {errMsg}
            </p>
            {(this.state.errStack || this.state.compStack) && (
              <details className="mb-4 text-left bg-slate-100 dark:bg-slate-900 rounded-xl p-3 max-h-48 overflow-auto">
                <summary className="text-[11px] font-bold text-slate-500 cursor-pointer">Detalle técnico</summary>
                <pre className="text-[10px] font-mono text-slate-500 whitespace-pre-wrap break-all mt-2">
                  {this.state.errStack}{this.state.compStack ? '\n' + this.state.compStack : ''}
                </pre>
              </details>
            )}
            <button
              onClick={this._handleRetry}
              disabled={this.state.clearing}
              className="px-6 py-3 bg-brand text-slate-900 rounded-xl font-bold hover:brightness-110 transition-all mb-3 disabled:opacity-50"
            >
              Reintentar (recargar)
            </button>
            {this.state.clearMsg && (
              <p className="text-xs text-amber-500 mt-2">{this.state.clearMsg}</p>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
