/**
 * retentionPolicy.js — Política de retención y cuotas (QUOTA-001).
 *
 * Centraliza las ventanas de retención del plan de purga + optimización
 * de cuotas de Supabase (tier gratis: 500MB DB, 5GB egress/mes, 1GB Storage).
 *
 *  - SALES_SYNC_DAYS: ventana de ventas que viaja a sync_documents.
 *  - SALES_DETAIL_MONTHS: detalle de tickets en el teléfono; lo más viejo se
 *    compacta a resúmenes mensuales (nunca se pierde el total).
 *  - AUDIT_MAX_ENTRIES / AUDIT_MAX_DAYS: tope de la bitácora local.
 *
 * Cambiar un número aquí cambia el comportamiento en syncDelta, purgeService
 * e imageMaintenance. No hay otra fuente de verdad.
 */
export const RETENTION = Object.freeze({
    /** Ventana de ventas que se sincroniza a la nube (días). */
    SALES_SYNC_DAYS: 90,
    /** Meses de detalle de tickets conservados en el teléfono. */
    SALES_DETAIL_MONTHS: 12,
    /** Cada cuánto corre la purga diaria (ms). */
    PURGE_INTERVAL_MS: 24 * 60 * 60 * 1000,
    /** Cada cuánto se purgan imágenes huérfanas de Storage (días). */
    ORPHAN_IMAGE_PURGE_DAYS: 30,
    /** La purga de ventas exige un respaldo exitoso no más viejo que esto (ms). */
    BACKUP_FRESHNESS_MS: 24 * 60 * 60 * 1000,
});

export const PURGE_KEYS = Object.freeze({
    LAST_RUN: 'pda_purge_last_run',
    LAST_ORPHAN_RUN: 'pda_purge_orphan_images_last_run',
    SALES_MONTHLY_SUMMARY: 'bodega_sales_monthly_v1',
});
