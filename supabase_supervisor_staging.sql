-- STAGING E2E AISLADO — MODO SUPERVISOR
-- Proyecto objetivo: tdfcpwctvumbdjmifypd (precios-al-dia-staging)
-- Este script NO debe ejecutarse en producción.
-- No contiene datos reales, claves ni tokens.
-- ROLLBACK: DROP TABLE IF EXISTS public.sync_documents, public.device_pairings CASCADE;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.device_pairings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_device_id TEXT NOT NULL UNIQUE,
    monitor_device_id TEXT,
    pairing_token TEXT,
    token_expires_at TIMESTAMPTZ,
    paired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    owner_auth_id UUID,
    monitor_auth_id UUID,
    revoked_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.sync_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    collection TEXT NOT NULL CHECK (collection IN ('store', 'local')),
    doc_id TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, doc_id)
);

ALTER TABLE public.device_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_documents FORCE ROW LEVEL SECURITY;

-- La tabla de comandos también queda forzada después de aplicar la migración
-- de RPC; se permite al definer operar solo sobre el target sintético.
DO $$
BEGIN
    IF to_regclass('public.supervisor_commands') IS NOT NULL THEN
        ALTER TABLE public.supervisor_commands FORCE ROW LEVEL SECURITY;
    END IF;
END $$;

REVOKE ALL ON TABLE public.device_pairings FROM anon, authenticated;
REVOKE ALL ON TABLE public.sync_documents FROM anon, authenticated;
GRANT SELECT ON TABLE public.device_pairings TO authenticated;
GRANT SELECT ON TABLE public.sync_documents TO authenticated;

DROP POLICY IF EXISTS staging_authenticated_sync_read ON public.sync_documents;
CREATE POLICY staging_authenticated_sync_read
    ON public.sync_documents
    FOR SELECT
    TO authenticated
    USING (device_id LIKE 'e2e-%');

DROP POLICY IF EXISTS staging_authenticated_pairing_read ON public.device_pairings;
CREATE POLICY staging_authenticated_pairing_read
    ON public.device_pairings
    FOR SELECT
    TO authenticated
    USING (primary_device_id LIKE 'e2e-%');

-- La RPC SECURITY DEFINER corre como postgres y la tabla está FORCE RLS.
-- Esta política solo permite al definer operar sobre el fixture sintético.
DROP POLICY IF EXISTS staging_definer_pairing_access ON public.device_pairings;
CREATE POLICY staging_definer_pairing_access
    ON public.device_pairings
    FOR ALL
    TO postgres
    USING (primary_device_id LIKE 'e2e-%')
    WITH CHECK (primary_device_id LIKE 'e2e-%');

DO $$
BEGIN
    IF to_regclass('public.supervisor_commands') IS NOT NULL THEN
        DROP POLICY IF EXISTS staging_definer_command_access ON public.supervisor_commands;
        CREATE POLICY staging_definer_command_access
            ON public.supervisor_commands
            FOR ALL
            TO postgres
            USING (target_device_id LIKE 'e2e-%')
            WITH CHECK (target_device_id LIKE 'e2e-%');
    END IF;
END $$;

INSERT INTO public.device_pairings (
    primary_device_id,
    monitor_device_id,
    pairing_token,
    token_expires_at,
    paired_at
) VALUES (
    'e2e-primary-device',
    'e2e-monitor-device',
    NULL,
    NULL,
    now()
)
ON CONFLICT (primary_device_id) DO UPDATE SET
    monitor_device_id = EXCLUDED.monitor_device_id,
    paired_at = EXCLUDED.paired_at,
    revoked_at = NULL;

INSERT INTO public.sync_documents (device_id, collection, doc_id, data, updated_at)
VALUES
(
    'e2e-primary-device',
    'local',
    'bodega_products_v1',
    jsonb_build_object(
        'schemaVersion', 1,
        'payload', jsonb_build_array(
            jsonb_build_object('id', 'e2e-product-1', 'name', 'Producto E2E', 'stock', 24, 'minStock', 5, 'priceUsd', 4.50, 'costUsd', 2.10, 'barcode', 'E2E0001'),
            jsonb_build_object('id', 'e2e-product-2', 'name', 'Producto Bajo Stock', 'stock', 2, 'minStock', 5, 'priceUsd', 8.00, 'costUsd', 3.00, 'barcode', 'E2E0002')
        ),
        'updatedAt', now()::text
    ),
    now()
),
(
    'e2e-primary-device',
    'local',
    'bodega_sales_v1',
    jsonb_build_object(
        'schemaVersion', 1,
        'payload', jsonb_build_array(
            jsonb_build_object('id', 'e2e-sale-1', 'tipo', 'VENTA', 'timestamp', now()::text, 'totalUsd', 4.50, 'totalBs', 405.00, 'status', 'COMPLETADA', 'items', jsonb_build_array(jsonb_build_object('productId', 'e2e-product-1', 'name', 'Producto E2E', 'quantity', 1, 'totalUsd', 4.50)), 'paymentMethod', 'efectivo_usd'),
            jsonb_build_object('id', 'e2e-opening-1', 'tipo', 'APERTURA_CAJA', 'timestamp', now()::text, 'openingUsd', 50, 'openingBs', 1000, 'openingCop', 0, 'cajaCerrada', false)
        ),
        'updatedAt', now()::text
    ),
    now()
),
(
    'e2e-primary-device',
    'local',
    'monitor_rates_v12',
    jsonb_build_object(
        'schemaVersion', 1,
        'payload', jsonb_build_object('bcv', 90, 'effectiveRate', 90, 'updatedAt', now()::text),
        'updatedAt', now()::text
    ),
    now()
),
(
    'e2e-primary-device',
    'local',
    'cop_enabled',
    jsonb_build_object('schemaVersion', 1, 'payload', false, 'updatedAt', now()::text),
    now()
),
(
    'e2e-primary-device',
    'local',
    'tasa_cop',
    jsonb_build_object('schemaVersion', 1, 'payload', 0, 'updatedAt', now()::text),
    now()
)
ON CONFLICT (device_id, doc_id) DO UPDATE SET
    data = EXCLUDED.data,
    updated_at = EXCLUDED.updated_at;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'sync_documents'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_documents;
    END IF;
END $$;

COMMIT;
