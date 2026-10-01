/**
 * backupKeys.js — Listas canónicas de claves de backup.
 *
 * Problema que resuelve:
 *   - HOOK-041: Las listas `IDB_KEYS` y `LS_KEYS` estaban duplicadas en
 *     `useCloudBackup.js`, `useAutoBackup.js` y `useRemoteBackupListener.js`,
 *     con pequeñas divergencias (ej: `payment_methods_v1` aparece en un archivo
 *     pero no en otro; `bodega_supplier_invoices_v1` falta en uno).
 *     Cada divergencia significa que un backup puede omitir datos críticos.
 *
 * Solución:
 *   - Una sola fuente de verdad aquí. Los tres hooks importan y re-exportan
 *     (si quieren mantener API pública) o usan directamente.
 *
 * @module config/backupKeys
 */

/**
 * Claves persistentes en IndexedDB (vía localforage) que componen un backup
 * completo de la app. Orden alfabético para diffs estables.
 */
export const IDB_KEYS = Object.freeze([
  'abasto_audit_log_v1',
  'bodega_accounts_v2',
  'bodega_customer_ledger_v1',
  'bodega_customers_v1',
  'bodega_payment_methods_v1',
  'bodega_pending_cart_v1',
  'bodega_pending_holds_v1', // ALTO-9 (2026-10-01): ventas en espera — se perdían al restaurar
  'bodega_products_v1',
  'bodega_sales_v1',
  'bodega_supplier_invoices_v1',
  'bodega_suppliers_v1',
  'my_categories_v1',
]);

/**
 * Claves persistentes en localStorage que componen un backup completo.
 * NO incluye `sb-*` (sesión de Supabase) ni flags de migración ni claves
 * efímeras, ni abasto-auth-storage (datos locales de sesión/PIN hasheado).
 */
export const LS_KEYS = Object.freeze([
  'admin_auto_lock_minutes', // ALTO-9 (2026-10-01)
  'allow_cash_advance', // ALTO-9 (2026-10-01)
  'allow_negative_stock',
  'auto_cop_enabled',
  'bodega_custom_rate',
  'bodega_inventory_view',
  'bodega_rate_mode', // ALTO-9 (2026-10-01): modo de tasa
  'bodega_use_auto_rate',
  'business_address', // ALTO-9 (2026-10-01)
  'business_direccion', // ALTO-9 (2026-10-01)
  'business_instagram', // ALTO-9 (2026-10-01)
  'business_name',
  'business_phone', // ALTO-9 (2026-10-01)
  'business_rif',
  'business_telefono', // ALTO-9 (2026-10-01)
  'cart_live_resync', // ALTO-9 (2026-10-01)
  'cash_advance_default_pct', // ALTO-9 (2026-10-01)
  'cashea_enabled', // ALTO-9 (2026-10-01)
  'cashea_min_amount', // ALTO-9 (2026-10-01)
  'catalog_custom_usdt_price',
  'catalog_show_cash_price',
  'catalog_use_auto_usdt',
  'checkout_bs_round_mode', // ALTO-9 (2026-10-01): modo de redondeo Bs
  'checkout_bs_round_step', // ALTO-9 (2026-10-01): paso de redondeo Bs
  'checkout_mode', // ALTO-9 (2026-10-01)
  'checkout_shell_v2', // ALTO-9 (2026-10-01)
  'checkout_smallest_usd_bill', // ALTO-9 (2026-10-01)
  'cop_enabled',
  'cop_primary',
  'label_currency_mode', // ALTO-9 (2026-10-01)
  'monitor_rates_v12',
  'premium_token',
  'printer_paper_width',
  'receipt_currency_mode', // ALTO-9 (2026-10-01)
  'reportes_fiado_split', // ALTO-9 (2026-10-01)
  'reportes_reparacion_ledger', // ALTO-9 (2026-10-01)
  'street_rate_bs',
  'tasa_cop',
  'theme', // ALTO-9 (2026-10-01)
  'ui_scale', // ALTO-9 (2026-10-01)
]);

/**
 * Claves de flags de migración/config que NUNCA deben borrarse al importar
 * un backup o al hacer `localforage.clear()` (HOOK-025). Borrarlas podría
 * re-disparar migraciones o resetear estados críticos.
 */
export const PROTECTED_KEYS = Object.freeze([
  'pda_demo_flag_v1',         // Flag legado de demo (ya no se escribe)
  'bodega_autobackup_v1',     // Último backup local (emergencia)
  'priceCop_migration_v1',    // Migración one-time de priceCop
]);

export default { IDB_KEYS, LS_KEYS, PROTECTED_KEYS };
