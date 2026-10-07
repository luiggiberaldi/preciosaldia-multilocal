/**
 * MobileCheckout — shell formalizado de la zona de cobro en móvil (Fase 5).
 *
 * Componentes compartidos por los modos "basic" y "pos" en teléfono:
 * - PaymentStatusSummary: barra de estado única (Total → Pagado → Resta/Vuelto).
 * - MobileChangeAllocation: vuelto progresivo (fila inline + bottom sheet).
 *
 * Feature flag `checkout_shell_v2`: cuando localStorage['checkout_shell_v2']
 * === 'true', SalesView fuerza el modo "basic" incluso en pantallas ≥1024px.
 * Es la palanca de rollback/soporte en campo del rediseño: apagar el flag
 * devuelve el comportamiento anterior sin desplegar código nuevo.
 *
 * Convención: un componente por archivo, lógica financiera 100% en
 * useCheckoutCalculations (los componentes solo presentan y delegan).
 */
export { default as PaymentStatusSummary } from './PaymentStatusSummary';
export { default as MobileChangeAllocation } from './MobileChangeAllocation';
