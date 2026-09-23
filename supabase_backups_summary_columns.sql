-- ============================================================
-- Columnas resumen para cloud_backups (optimización de egress)
-- ============================================================
-- Problema: Estación Maestra (getBackups en actions.ts) traía el JSON
-- completo de `backup_data` de TODOS los dispositivos solo para mostrar
-- una tabla con tamaño/conteos. Estas columnas se pueblan en el momento
-- del backup (useAutoBackup.js) para que la vista de lista pueda leer
-- solo metadata liviana, sin tocar `backup_data`.
--
-- Idempotente: seguro correr múltiples veces.

ALTER TABLE public.cloud_backups
    ADD COLUMN IF NOT EXISTS size_bytes     BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS product_count  INT    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sales_count    INT    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS customer_count INT    NOT NULL DEFAULT 0;
